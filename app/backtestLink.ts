"use client";

/**
 * 백테스트 ↔ 사무실 연결.
 * 패널 버튼이든 대표 지시창("백테스트 돌려줘")이든 여기로 들어와서,
 * 실제 계산은 /api/backtest(auto-risk/backtest.py)가 하고
 * 그동안 사무실에서는 시세 데이터팀 → 검증·리스크팀 → 성과 분석팀 → 비서실 순서로 움직인다.
 * (엔진 app/game/ 은 고치지 않고 공개된 pushChat·pushLog·say·deptStatus 만 쓴다)
 */
import { useSyncExternalStore } from "react";
import { AUTOPILOT } from "../company.config";
import type { Agent, Company } from "./game/sim";

/** 기본 대상 = 대표가 정한 타겟 코인 전부 (company.config.ts 의 AUTOPILOT.coins) */
export const TARGET_MARKETS = AUTOPILOT.coins.join(",");

export type BacktestOptions = {
  markets: string;
  interval: "day" | "4h";
  fast: number;
  slow: number;
  stop: number; // 0.08 = -8%
  demo?: boolean;
};

export type Coin = {
  name: string;
  summary: Record<string, string | number>;
  yearly: { year: number; strategy: string; hold: string }[];
  curve: { date: string; strategy: number; hold: number }[];
  recentTrades: { entry: string; exit: string; return: number; reason: string }[];
};

export type BacktestResult = {
  ok: boolean;
  error?: string;
  coins?: Coin[];
  pooled?: Record<string, string | number | null> | null;
  log?: string[];
};

type State = { running: boolean; options: BacktestOptions; result: BacktestResult | null };

let state: State = {
  running: false,
  options: { markets: TARGET_MARKETS, interval: "day", fast: 20, slow: 60, stop: 0.08 },
  result: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function useBacktest() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

// ── 대표 지시창에서 알아듣기 ───────────────────────────────
const COIN_WORDS: [string, string][] = [
  ["비트코인", "KRW-BTC"], ["비트", "KRW-BTC"], ["이더리움", "KRW-ETH"], ["이더", "KRW-ETH"],
  ["리플", "KRW-XRP"], ["솔라나", "KRW-SOL"], ["도지", "KRW-DOGE"], ["에이다", "KRW-ADA"],
  ["트론", "KRW-TRX"], ["체인링크", "KRW-LINK"], ["아발란체", "KRW-AVAX"],
  ["두들즈", "KRW-DOOD"], ["아이리스", "KRW-IRYS"],
];

/** "KRW-DOOD" → "두들즈" (모르는 코인은 티커 그대로) */
export function coinLabel(market: string) {
  return COIN_WORDS.find(([, t]) => t === market)?.[0] ?? market.replace("KRW-", "");
}

export function isBacktestOrder(text: string) {
  return /백테스트|백테|backtest/i.test(text);
}

/** "이더리움 4시간봉 10/30 손절 5% 백테스트" 같은 문장을 옵션으로 바꾼다. 없는 값은 지난 설정 유지 */
export function parseBacktestOrder(text: string): BacktestOptions {
  const opts = { ...state.options, demo: /데모|가짜/.test(text) };
  const coins = new Set<string>((text.match(/KRW-[A-Z0-9]+/gi) ?? []).map((t) => t.toUpperCase()));
  for (const [word, ticker] of COIN_WORDS) if (text.includes(word)) coins.add(ticker);
  // 코인을 따로 말하지 않으면 타겟 코인 전부
  if (/타겟|목표 코인/.test(text)) opts.markets = TARGET_MARKETS;
  else if (/전체|주요|all/i.test(text)) opts.markets = "all";
  else opts.markets = coins.size ? [...coins].join(",") : TARGET_MARKETS;
  if (/4\s*시간|4h/i.test(text)) opts.interval = "4h";
  else if (/일봉|하루/.test(text)) opts.interval = "day";
  const ma = text.match(/(\d{1,4})\s*[/~,]\s*(\d{1,4})/);
  if (ma) [opts.fast, opts.slow] = [Number(ma[1]), Number(ma[2])];
  const stop = text.match(/손절\s*(\d+(?:\.\d+)?)\s*%?|(\d+(?:\.\d+)?)\s*%\s*손절/);
  if (stop) opts.stop = Number(stop[1] ?? stop[2]) / 100;
  return opts;
}

// ── 사무실 연출 ─────────────────────────────────────────
const team = (engine: Company, deptId: string) => engine.agents.filter((a) => a.deptId === deptId);
const lead = (engine: Company, deptId: string) => team(engine, deptId).find((a) => a.rank === "lead");
const onDuty = (a: Agent) => a.status !== "출근 전" && a.status !== "출근 중";

function work(engine: Company, deptId: string, label: string, line: string) {
  for (const a of team(engine, deptId)) {
    if (!onDuty(a)) continue;
    a.status = "업무 중";
    a.taskLabel = label;
    a.progress = 0;
  }
  const l = lead(engine, deptId);
  if (l && onDuty(l)) engine.say(l, line, 3.2);
  engine.deptStatus[deptId] = "진행 중";
}

function finish(engine: Company, deptId: string, line: string, status: "완료" | "대기" = "완료") {
  for (const a of team(engine, deptId)) {
    if (!onDuty(a)) continue;
    a.status = "대기";
    a.progress = 100;
  }
  const l = lead(engine, deptId);
  if (l && onDuty(l)) engine.say(l, line, 4);
  engine.deptStatus[deptId] = status;
}

const name = (engine: Company, deptId: string) => lead(engine, deptId)?.name ?? "담당자";
const label = (o: BacktestOptions) =>
  `${o.demo ? "데모 데이터" : o.markets === "all" ? "주요 코인 10개" : o.markets.replaceAll("KRW-", "")} · ${o.interval === "4h" ? "4시간봉" : "일봉"} · MA ${o.fast}/${o.slow} · 손절 ${Math.round(o.stop * 1000) / 10}%`;

export async function runBacktest(engine: Company | null, options: BacktestOptions, fromChat = false) {
  if (state.running) {
    engine?.pushChat("staff", name(engine, "qa"), "앞선 백테스트를 계산 중이에요. 끝나면 바로 다음 걸 돌릴게요.");
    return;
  }
  set({ running: true, options, result: null });

  if (engine) {
    if (!fromChat) engine.pushChat("ceo", "대표님", `백테스트 돌려줘 — ${label(options)}`);
    const anyone = engine.agents.some((a) => a.rank !== "ceo" && onDuty(a));
    engine.pushChat(
      "staff",
      "김세리",
      anyone
        ? `접수했습니다. 시세 데이터팀이 데이터 챙기고, 검증·리스크팀이 바로 계산 들어갑니다.\n(${label(options)})`
        : `아직 다들 출근 전이라 자리엔 없지만, 계산은 바로 돌릴게요.\n(${label(options)})`,
    );
    engine.pushLog("🧪", `백테스트 지시 — ${label(options)}`, "yellow");
    work(engine, "brand", "백테스트용 시세 준비", "업비트 시세 불러올게요!");
    window.setTimeout(() => {
      if (!state.running) return;
      finish(engine, "brand", "데이터 넘겼어요 →", "대기");
      work(engine, "qa", "백테스트 계산 중", "수수료·슬리피지 포함해서 돌립니다.");
      engine.pushLog("📊", "시세 데이터팀 → 검증·리스크팀: 데이터 전달", "lav");
    }, 1200);
  }

  let result: BacktestResult;
  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...options }),
    });
    result = await res.json();
  } catch (error) {
    result = { ok: false, error: `서버에 닿지 못했어요: ${String(error)}` };
  }
  set({ running: false, result });
  if (engine) report(engine, result);
}

function report(engine: Company, result: BacktestResult) {
  if (engine.deptStatus.brand === "진행 중") finish(engine, "brand", "데이터 넘겼어요 →", "대기");

  if (!result.ok || !result.coins?.length) {
    const why = result.ok ? "거래가 한 번도 안 나왔어요. 조건을 바꿔보셔야 해요." : result.error ?? "알 수 없는 오류";
    finish(engine, "qa", "계산이 막혔어요…", "대기");
    engine.pushChat("staff", `${name(engine, "qa")} · 검증·리스크팀`, `백테스트 실패했어요.\n${why}`);
    engine.pushLog("⚠️", `백테스트 실패 — ${why}`, "pink");
    return;
  }

  const coins = result.coins;
  const qaLines = coins.slice(0, 5).map((c) => {
    const s = c.summary;
    return `${c.name.replace("KRW-", "")}: 월 ${s["전략 월평균(복리)"]} (${judge(c).label}) · 총 ${s["전략 총수익률"]} · MDD ${s["전략 최대낙폭(MDD)"]} · 승률 ${s["승률"]} · 손익비 ${s["손익비(Profit factor)"]}`;
  });
  if (coins.length > 5) qaLines.push(`…외 ${coins.length - 5}개 (패널에서 확인)`);
  if (result.pooled && coins.length > 1) {
    qaLines.push(`전체 합산: ${result.pooled["전체 거래 횟수"]}회 · 승률 ${result.pooled["승률"]} · 손익비 ${result.pooled["손익비(Profit factor)"]}`);
  }

  const verdict = overall(coins);
  const worst = coins.reduce((w, c) => (judge(c).mdd < judge(w).mdd ? c : w));
  const ws = worst.summary;
  const bubble = {
    pass: `월 ${TARGET.monthlyMin}~${TARGET.monthlyMax}% 목표 달성!`,
    high: "목표보다 높아요… 과적합 의심",
    low: `월 ${TARGET.monthlyMin}% 미달이에요`,
    risk: `낙폭 ${ws["전략 최대낙폭(MDD)"]}… 너무 커요`,
  }[verdict];
  finish(engine, "qa", bubble);
  engine.pushChat(
    "staff",
    `${name(engine, "qa")} · 검증·리스크팀`,
    `백테스트 끝났습니다. (목표: 월 ${TARGET.monthlyMin}~${TARGET.monthlyMax}% · MDD ${TARGET.maxDrawdown}% 이내)\n${qaLines.join("\n")}`,
  );
  engine.pushLog("🛡️", `검증·리스크팀 판정: ${VERDICT_LABEL[verdict]} — ${coins.map((c) => `${c.name.replace("KRW-", "")} 월 ${c.summary["전략 월평균(복리)"]}`).join(" · ")}`, verdict === "pass" ? "mint" : "yellow");

  window.setTimeout(() => {
    const review = `${worst.name.replace("KRW-", "")} 기준으로, 그냥 들고 있었으면 MDD ${ws["단순보유 MDD"]}, 전략은 ${ws["전략 최대낙폭(MDD)"]}. ${
      verdict === "risk" ? "수익보다 낙폭부터 줄여야 해요." : "버티기 쉬운 쪽은 전략이에요."
    }`;
    const r = lead(engine, "review");
    if (r && onDuty(r)) engine.say(r, "단순보유랑 비교해볼게요", 3);
    engine.pushChat("staff", `${name(engine, "review")} · 성과 분석팀`, review);
    engine.pushLog("📈", "성과 분석팀: 단순보유 대비 비교 완료", "lav");
  }, 1500);

  window.setTimeout(() => {
    const wrap = {
      pass: `정리하면, 월 ${TARGET.monthlyMin}~${TARGET.monthlyMax}% 목표 안에 들어왔고 낙폭 기준도 통과했어요. 다음 단계는 거래소 연동팀의 모의투자입니다. 실전 전환은 대표님 결정이에요.`,
      high: `정리하면, 낙폭은 괜찮은데 월 ${TARGET.monthlyMax}%를 넘어요. 과거에만 잘 맞춘 걸 수 있어서, 기간이나 코인을 바꿔 한 번 더 확인하고 모의투자로 가는 게 안전해요.`,
      low: `정리하면, 월 ${TARGET.monthlyMin}% 목표에 못 미쳐요. 이동평균 기간이나 봉(일봉↔4시간봉)을 바꿔 다시 돌려볼까요?`,
      risk: `정리하면, 최대낙폭이 ${TARGET.maxDrawdown}%를 넘어서 반려예요. 수익 목표보다 손절을 더 촘촘하게 잡는 게 먼저예요.`,
    }[verdict];
    engine.pushChat("staff", "김세리", wrap);
  }, 3000);
}

// ── 목표 판정 ─────────────────────────────────────────────
/** 기본 목표: 월평균(복리) 1~3% + 최대낙폭 35% 이내. 숫자만 바꾸면 화면·보고 전부 따라 바뀐다 */
export const TARGET = { monthlyMin: 1, monthlyMax: 3, maxDrawdown: 35 };

export type Verdict = "pass" | "high" | "low" | "risk";
export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "목표 달성",
  high: "목표 초과·재검증",
  low: "목표 미달",
  risk: "낙폭 초과",
};

const pct = (v: unknown) => parseFloat(String(v).replace("%", ""));

/** 월평균(%)·최대낙폭(%, 음수) 숫자로 판정 */
export function verdictOf(monthly: number, mdd: number): Verdict {
  return mdd < -TARGET.maxDrawdown ? "risk" : monthly < TARGET.monthlyMin ? "low" : monthly > TARGET.monthlyMax ? "high" : "pass";
}

export function judge(c: Coin): { monthly: number; mdd: number; verdict: Verdict; label: string } {
  const monthly = pct(c.summary["전략 월평균(복리)"]);
  const mdd = pct(c.summary["전략 최대낙폭(MDD)"]);
  const verdict = verdictOf(monthly, mdd);
  return { monthly, mdd, verdict, label: VERDICT_LABEL[verdict] };
}

/** 여러 코인이면 가장 나쁜 쪽으로 판정 (낙폭 초과 > 미달 > 초과 > 달성) */
export function overall(coins: Coin[]): Verdict {
  const order: Verdict[] = ["risk", "low", "high", "pass"];
  return order.find((v) => coins.some((c) => judge(c).verdict === v)) ?? "pass";
}
