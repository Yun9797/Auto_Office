import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 로컬 개발 서버 전용: 실시간 시세 + 모의투자. (진짜 주문은 절대 하지 않는다 — 업비트 키도 쓰지 않음)
 *
 *   GET  /api/paper/status    현재가 · 이동평균 신호 · 가상 보유 · 가상 자산 · 최근 가상 거래
 *   POST /api/paper/strategy  전략 적용 {market, interval, fast, slow, stop, capital, expect: {monthly, mdd}}
 *                             가상으로 들고 있는 코인이 있으면 팔릴 때까지 "다음 전략"으로 대기
 *   GET  /api/paper/chart     📝 패널 실시간 차트 — 최근 확정 봉 종가 + 현재가 + 마지막 판단 시각
 *   GET  /api/paper/market?market=KRW-BTC  현재가·24시간 변동·투자유의·응답 시간 (시세 데이터팀·거래소 연동팀 점검)
 *   POST /api/paper/pause     가상 거래 멈춤 (시세는 계속 받음)
 *   POST /api/paper/resume    다시 시작
 *
 * 규칙은 auto-risk/backtest.py 와 같다.
 *  - 확정된 봉 기준 단기 이평 > 장기 이평이면 "사고 싶음", 아니면 "팔고 싶음"
 *  - 손절: 산 값 대비 stop% 아래로 내려가면 즉시 매도, 신호가 한 번 꺼질 때까지 재진입 안 함
 *  - 비용: 수수료 0.05% + 슬리피지 0.05%
 * 서버가 켜져 있는 동안 30초마다 업비트 공개 시세를 받아 판단한다 (브라우저를 닫아도 계속).
 *
 * 저장: records/paper-state.json (현재 상태) · records/paper.jsonl (가상 거래, 뒤에 붙이기만)
 */
const API = "https://api.upbit.com/v1";
const FEE = 0.0005;
const SLIPPAGE = 0.0005;
const POLL_MS = 30_000;
const BAR_MS = { day: 24 * 3600_000, "4h": 4 * 3600_000 } as const;

type Interval = keyof typeof BAR_MS;
type Strategy = { market: string; interval: Interval; fast: number; slow: number; stop: number };
type Trade = {
  id: number;
  side: "buy" | "sell";
  reason: "신호" | "손절";
  market: string;
  price: number;
  qty: number;
  krw: number;
  /** 매도일 때 이번 거래 수익률(%) — 비용 포함 */
  returnPct?: number;
  at: string;
};

type State = {
  running: boolean;
  strategy: Strategy | null;
  /** 코인을 들고 있을 때 들어온 새 전략 — 팔고 나면 바뀐다 */
  pending: Strategy | null;
  capital: number;
  cash: number;
  coins: number;
  entryPrice: number | null;
  entryAt: string | null;
  stoppedOut: boolean;
  startedAt: string | null;
  /** 시작 시점 가격 (같은 기간 그냥 들고 있었으면 얼마인지 비교용) */
  startPrice: number | null;
  tradeSeq: number;
  /** 이번 모의투자를 시작한 뒤 가상 거래 수 */
  tradeCount: number;
  /** 가상 자산 최고점과 그때부터의 최대 낙폭(%, 음수) — 모의투자 감시팀이 기준과 비교 */
  peak: number;
  maxDrawdown: number;
  /** 전략을 고를 때 백테스트가 낸 기대치 (월평균 %, 최대낙폭 %) */
  expect: Expect | null;
  pendingExpect: Expect | null;
  /** 날짜(한국 시간)별 마지막 가상 자산 */
  daily: Record<string, number>;
};

type Expect = { monthly: number; mdd: number };

type Live = {
  price: number | null;
  priceAt: string | null;
  fastMa: number | null;
  slowMa: number | null;
  wantLong: boolean | null;
  lastBar: string | null;
  error: string;
};

const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const fresh = (capital: number): State => ({
  running: false,
  strategy: null,
  pending: null,
  capital,
  cash: capital,
  coins: 0,
  entryPrice: null,
  entryAt: null,
  stoppedOut: false,
  startedAt: null,
  startPrice: null,
  tradeSeq: 0,
  tradeCount: 0,
  peak: capital,
  maxDrawdown: 0,
  expect: null,
  pendingExpect: null,
  daily: {},
});

async function getJson(url: string) {
  const res = await fetch(url);
  if (res.status === 429) throw new Error("업비트 요청이 많아 잠깐 쉬는 중이에요");
  if (!res.ok) throw new Error(`업비트 시세 응답 오류 (${res.status})`);
  return res.json();
}

type Candle = { candle_date_time_utc: string; trade_price: number };

/** 확정된 봉 종가만, 오래된 순으로 need 개 (진행 중인 봉은 뺀다) */
async function confirmedCloses(s: Strategy, need: number) {
  const unit = s.interval === "day" ? "days" : "minutes/240";
  const now = Date.now();
  const rows: Candle[] = [];
  let to = "";
  while (rows.length < need + 1) {
    const batch = (await getJson(
      `${API}/candles/${unit}?market=${s.market}&count=200${to ? `&to=${encodeURIComponent(to)}` : ""}`,
    )) as Candle[];
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < 200) break;
    to = batch[batch.length - 1].candle_date_time_utc.replace("T", " ");
  }
  return rows
    .filter((c) => Date.parse(`${c.candle_date_time_utc}Z`) + BAR_MS[s.interval] <= now)
    .slice(0, need)
    .reverse();
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type MarketInfo = {
  market: string;
  korean_name: string;
  market_warning?: string;
  market_event?: { warning?: boolean; caution?: Record<string, boolean> };
};

/** 시세 데이터팀·거래소 연동팀 점검용 — 공개 API만 (현재가·24시간 변동·투자유의·응답 시간) */
async function marketCheck(market: string) {
  const t0 = Date.now();
  const [ticker] = (await getJson(`${API}/ticker?markets=${market}`)) as {
    trade_price: number;
    signed_change_rate: number;
    acc_trade_price_24h: number;
    timestamp: number;
  }[];
  const ms = Date.now() - t0;
  const info = ((await getJson(`${API}/market/all?is_details=true`)) as MarketInfo[]).find((m) => m.market === market);
  const cautions = Object.entries(info?.market_event?.caution ?? {})
    .filter(([, on]) => on)
    .map(([k]) => k);
  return {
    ok: true,
    market,
    name: info?.korean_name ?? market,
    listed: Boolean(info),
    price: ticker.trade_price,
    change24h: ticker.signed_change_rate * 100,
    volume24h: ticker.acc_trade_price_24h,
    tradedAt: new Date(ticker.timestamp).toISOString(),
    responseMs: ms,
    warning: Boolean(info?.market_event?.warning) || info?.market_warning === "CAUTION",
    cautions,
  };
}

export function paper(): Plugin {
  return {
    name: "paper-trading",
    enforce: "pre",
    apply: "serve",
    configureServer(server) {
      const dir = path.join(server.config.root, "records");
      const stateFile = path.join(dir, "paper-state.json");
      const tradeFile = path.join(dir, "paper.jsonl");

      let state: State = fresh(10_000_000);
      try {
        if (existsSync(stateFile)) state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")) };
      } catch {
        server.config.logger.warn("[paper] 모의투자 상태 파일을 못 읽어 새로 시작해요");
      }
      const live: Live = { price: null, priceAt: null, fastMa: null, slowMa: null, wantLong: null, lastBar: null, error: "" };
      let recent: Trade[] = [];
      try {
        if (existsSync(tradeFile)) {
          recent = readFileSync(tradeFile, "utf8")
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l) as Trade)
            .slice(-30);
        }
      } catch {
        /* 거래 기록을 못 읽어도 모의투자는 계속 */
      }

      const save = () => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
      };

      const record = (t: Omit<Trade, "id" | "at">) => {
        const trade: Trade = { ...t, id: ++state.tradeSeq, at: new Date().toISOString() };
        state.tradeCount += 1;
        mkdirSync(dir, { recursive: true });
        appendFileSync(tradeFile, JSON.stringify({ ...trade, date: kstDate() }) + "\n", "utf8");
        recent = [...recent, trade].slice(-30);
      };

      const buy = (s: Strategy, price: number) => {
        const fill = price * (1 + SLIPPAGE);
        const krw = state.cash;
        state.coins = (krw * (1 - FEE)) / fill;
        state.cash = 0;
        state.entryPrice = fill;
        state.entryAt = new Date().toISOString();
        record({ side: "buy", reason: "신호", market: s.market, price: fill, qty: state.coins, krw });
      };

      const sell = (s: Strategy, price: number, reason: Trade["reason"]) => {
        const qty = state.coins;
        const krw = qty * price * (1 - FEE - SLIPPAGE);
        const returnPct = state.entryPrice ? ((price * (1 - FEE - SLIPPAGE)) / state.entryPrice - 1) * 100 : undefined;
        state.cash = krw;
        state.coins = 0;
        state.entryPrice = null;
        state.entryAt = null;
        record({ side: "sell", reason, market: s.market, price, qty, krw, returnPct });
      };

      /** 전략이 바뀌면 예전 전략의 이평 값을 지운다 (새 값은 다음 확인 때 계산) */
      const clearSignal = () => {
        live.fastMa = live.slowMa = live.wantLong = null;
        live.lastBar = null;
      };

      /** 기다리던 새 전략으로 바꾼다 (코인이 없을 때만) */
      const applyPending = () => {
        if (!state.pending || state.coins > 0) return false;
        // 코인이 바뀌면 "그냥 들고 있었다면" 비교 기준도 새 코인으로
        if (state.strategy?.market !== state.pending.market) state.startPrice = null;
        state.strategy = state.pending;
        state.expect = state.pendingExpect;
        state.pending = null;
        state.pendingExpect = null;
        state.stoppedOut = false;
        clearSignal();
        return true;
      };

      let busy = false;
      const tick = async () => {
        const s = state.strategy;
        if (!s || busy) return;
        busy = true;
        try {
          const [ticker] = (await getJson(`${API}/ticker?markets=${s.market}`)) as { trade_price: number }[];
          const price = ticker.trade_price;
          const bars = await confirmedCloses(s, s.slow);
          if (state.strategy !== s) return; // 받는 사이 전략이 바뀌었으면 버리고 다음 확인 때 새로
          const closes = bars.map((c) => c.trade_price);
          live.price = price;
          live.priceAt = new Date().toISOString();
          live.error = "";
          if (closes.length < s.slow) {
            live.fastMa = live.slowMa = live.wantLong = null;
            live.error = `확정된 봉이 ${closes.length}개뿐이라 장기 이평(${s.slow})을 못 구해요`;
            return;
          }
          live.fastMa = avg(closes.slice(-s.fast));
          live.slowMa = avg(closes);
          live.wantLong = live.fastMa > live.slowMa;
          live.lastBar = bars[bars.length - 1].candle_date_time_utc;
          if (state.startPrice === null) state.startPrice = price;

          if (state.running) {
            // backtest.py 와 같은 순서: 신호로 매수·매도 → 손절 확인
            if (!live.wantLong) state.stoppedOut = false;
            if (state.coins === 0 && live.wantLong && !state.stoppedOut) buy(s, price);
            else if (state.coins > 0 && !live.wantLong) sell(s, price, "신호");
            if (state.coins > 0 && state.entryPrice && price <= state.entryPrice * (1 - s.stop)) {
              sell(s, price, "손절");
              state.stoppedOut = true;
            }
            applyPending(); // 다음 확인(30초 뒤)부터 새 전략
          }
          const equity = state.cash + state.coins * price;
          state.daily[kstDate()] = equity;
          state.peak = Math.max(state.peak, equity);
          state.maxDrawdown = Math.min(state.maxDrawdown, (equity / state.peak - 1) * 100);
          save();
        } catch (error) {
          live.error = `시세를 못 받았어요: ${(error as Error).message}`;
        } finally {
          busy = false;
        }
      };

      const timer = setInterval(() => void tick(), POLL_MS);
      timer.unref?.();
      server.httpServer?.once("close", () => clearInterval(timer));
      void tick();

      const status = () => {
        const equity = live.price !== null ? state.cash + state.coins * live.price : null;
        return {
          ok: true,
          running: state.running,
          strategy: state.strategy,
          pending: state.pending,
          capital: state.capital,
          cash: state.cash,
          coins: state.coins,
          entryPrice: state.entryPrice,
          entryAt: state.entryAt,
          stoppedOut: state.stoppedOut,
          startedAt: state.startedAt,
          equity,
          returnPct: equity !== null ? (equity / state.capital - 1) * 100 : null,
          holdReturnPct: live.price !== null && state.startPrice ? (live.price / state.startPrice - 1) * 100 : null,
          tradeCount: state.tradeCount,
          maxDrawdown: state.maxDrawdown,
          expect: state.expect,
          live,
          daily: Object.entries(state.daily).slice(-60),
          trades: [...recent].reverse().slice(0, 20),
        };
      };

      // 📝 패널 실시간 차트용 — 확정 봉은 1분에 한 번, 현재가는 2초에 한 번만 업비트에 묻는다
      let barCache: { key: string; at: number; bars: Candle[] } | null = null;
      let tickCache: { market: string; at: number; price: number; tradedAt: string } | null = null;
      const CHART_BARS = 60;
      const chart = async () => {
        const s = state.strategy;
        if (!s) return { ok: true, strategy: null };
        const key = JSON.stringify(s);
        if (!barCache || barCache.key !== key || Date.now() - barCache.at > 60_000) {
          barCache = { key, at: Date.now(), bars: await confirmedCloses(s, s.slow + CHART_BARS) };
        }
        if (!tickCache || tickCache.market !== s.market || Date.now() - tickCache.at > 2_000) {
          const [t] = (await getJson(`${API}/ticker?markets=${s.market}`)) as { trade_price: number; timestamp: number }[];
          tickCache = { market: s.market, at: Date.now(), price: t.trade_price, tradedAt: new Date(t.timestamp).toISOString() };
        }
        return {
          ok: true,
          strategy: s,
          barMs: BAR_MS[s.interval],
          bars: barCache.bars.map((c) => ({ t: `${c.candle_date_time_utc}Z`, c: c.trade_price })),
          price: tickCache.price,
          priceAt: tickCache.tradedAt,
          /** 서버가 마지막으로 판단한 시각 — 다음 판단은 이로부터 30초 뒤 */
          decidedAt: live.priceAt,
          decideEveryMs: POLL_MS,
        };
      };

      server.middlewares.use("/api/paper", (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { ok: false, error: "허용되지 않은 요청" });
        const route = (req.url ?? "/").split("?")[0];

        if (req.method === "GET" && route === "/status") return send(200, status());
        if (req.method === "GET" && route === "/chart") {
          void chart()
            .then((r) => send(200, r))
            .catch((error) => send(502, { ok: false, error: `차트 시세를 못 받았어요: ${(error as Error).message}` }));
          return;
        }
        if (req.method === "GET" && route === "/market") {
          const market = new URL(req.url ?? "/", "http://local").searchParams.get("market") ?? "";
          if (!/^KRW-[A-Z0-9]{1,15}$/.test(market)) return send(400, { ok: false, error: "KRW-BTC 같은 티커로 주세요" });
          void marketCheck(market)
            .then((r) => send(200, r))
            .catch((error) => {
              const msg = (error as Error).message;
              send(502, { ok: false, error: msg.includes("(404)") ? `업비트에 ${market} 시세가 없어요 (상장 폐지 확인 필요)` : `업비트 공개 API에 닿지 못했어요: ${msg}` });
            });
          return;
        }
        if (req.method !== "POST") return send(404, { ok: false, error: "없는 주소" });

        if (route === "/pause" || route === "/resume") {
          if (!state.strategy) return send(400, { ok: false, error: "아직 적용된 전략이 없어요" });
          state.running = route === "/resume";
          save();
          return send(200, status());
        }
        if (route !== "/strategy") return send(404, { ok: false, error: "없는 주소" });

        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 10_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const input = JSON.parse(raw || "{}");
            const market = String(input.market ?? "");
            if (!/^KRW-[A-Z0-9]{1,15}$/.test(market)) throw new Error("코인은 KRW-BTC 같은 업비트 원화마켓 티커로 주세요");
            const next: Strategy = {
              market,
              interval: input.interval === "4h" ? "4h" : "day",
              fast: Math.max(2, Math.min(200, Math.floor(Number(input.fast) || 20))),
              slow: Math.max(3, Math.min(400, Math.floor(Number(input.slow) || 60))),
              stop: Math.max(0.005, Math.min(0.9, Number(input.stop) || 0.08)),
            };
            if (next.fast >= next.slow) throw new Error("단기 이평은 장기 이평보다 짧아야 해요");

            const expect: Expect | null =
              Number.isFinite(Number(input.expect?.monthly)) && Number.isFinite(Number(input.expect?.mdd))
                ? { monthly: Number(input.expect.monthly), mdd: Number(input.expect.mdd) }
                : null;

            const same = (a: Strategy | null) => a !== null && JSON.stringify(a) === JSON.stringify(next);
            let note: string;
            if (!state.strategy) {
              // 처음 시작: 가상 자금으로 새로 출발
              const capital = Math.max(100_000, Math.min(10_000_000_000, Number(input.capital) || 10_000_000));
              state = { ...fresh(capital), strategy: next, expect, running: true, startedAt: new Date().toISOString(), tradeSeq: state.tradeSeq };
              clearSignal();
              note = "started";
            } else if (same(state.strategy)) {
              state.pending = state.pendingExpect = null;
              if (expect) state.expect = expect; // 오늘 데이터로 다시 돌린 기대치로 갱신
              note = "same";
            } else if (state.coins > 0) {
              state.pending = next;
              state.pendingExpect = expect;
              note = "pending";
            } else {
              state.pending = next;
              state.pendingExpect = expect;
              applyPending();
              note = "switched";
            }
            save();
            void tick();
            send(200, { ...status(), note });
          } catch (error) {
            send(400, { ok: false, error: (error as Error).message });
          }
        });
      });

      server.config.logger.info("[paper] 모의투자 엔진 준비 (가상 거래만, 실제 주문 없음)");
    },
  };
}
