"use client";

import { useEffect, useState } from "react";
import type { PaperStatus, PaperStrategy } from "./paperLink";
import { won } from "./upbitLink";

/** /api/paper/chart 응답 — 최근 확정 봉 종가 + 현재가 + 서버가 마지막으로 판단한 시각 */
type ChartData = {
  ok: boolean;
  error?: string;
  strategy: PaperStrategy | null;
  barMs?: number;
  bars?: { t: string; c: number }[];
  price?: number;
  priceAt?: string;
  decidedAt?: string | null;
  decideEveryMs?: number;
};

const SHOW = 60; // 보여줄 확정 봉 개수
const W = 320;
const H = 150;
const PAD = { l: 4, r: 52, t: 8, b: 14 };

const ma = (closes: number[], n: number, i: number) =>
  i + 1 < n ? null : closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n;

/** 📝 모의투자 실시간 차트 — 3초마다 현재가, 확정 봉 위로 이평선·가상 거래·산 값·손절선 */
export default function PaperChart({ s }: { s: PaperStatus }) {
  const [d, setD] = useState<ChartData | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = (await (await fetch("/api/paper/chart")).json()) as ChartData;
        if (alive) setD(r);
      } catch (e) {
        if (alive) setD({ ok: false, error: `서버에 닿지 못했어요: ${String(e)}`, strategy: null });
      }
    };
    void load();
    const poll = window.setInterval(load, 3_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [s.strategy?.market, s.strategy?.interval, s.strategy?.fast, s.strategy?.slow]);

  if (!d) return <div className="pc-box pc-wait">실시간 차트 불러오는 중…</div>;
  if (!d.ok) return <div className="pc-box pc-wait">{d.error}</div>;
  if (!d.strategy || !d.bars?.length || d.price == null || !d.barMs) return null;

  const st = d.strategy;
  const closes = d.bars.map((b) => b.c);
  const from = Math.max(0, closes.length - SHOW);
  const idx = closes.map((_, i) => i).slice(from);
  const fast = idx.map((i) => ma(closes, st.fast, i));
  const slow = idx.map((i) => ma(closes, st.slow, i));
  const holding = s.coins > 0 && s.entryPrice != null;
  const stopPrice = holding ? s.entryPrice! * (1 - st.stop) : null;

  const vals = [...idx.map((i) => closes[i]), d.price, ...fast, ...slow, s.entryPrice ?? null, stopPrice].filter(
    (v): v is number => v != null,
  );
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || hi * 0.01) * 0.08;
  lo -= pad;
  hi += pad;

  // 마지막 칸 = 지금 진행 중인 봉 (현재가)
  const n = idx.length + 1;
  const x = (k: number) => PAD.l + (k / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = (vs: (number | null)[]) =>
    vs.map((v, k) => (v == null ? "" : `${vs[k - 1] == null ? "M" : "L"}${x(k).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");

  const pricePath = `${line(idx.map((i) => closes[i]))} L${x(n - 1).toFixed(1)},${y(d.price).toFixed(1)}`;
  const liveX = x(n - 1);
  const liveY = y(d.price);
  const lastC = closes[closes.length - 1];

  // 가상 거래 표시 — 거래 시각이 든 봉 위에 (아직 진행 중인 봉이면 맨 오른쪽)
  const start0 = Date.parse(d.bars[from].t);
  const lastEnd = Date.parse(d.bars[d.bars.length - 1].t) + d.barMs;
  const marks = s.trades
    .filter((t) => t.market === st.market)
    .map((t) => {
      const at = Date.parse(t.at);
      if (at < start0) return null;
      const k = at >= lastEnd ? n - 1 : Math.min(n - 2, Math.floor((at - start0) / d.barMs!));
      return { id: t.id, side: t.side, x: x(k), y: y(t.price), title: `${t.side === "buy" ? "가상 매수" : `가상 매도·${t.reason}`} ${won(t.price)}` };
    })
    .filter((m) => m !== null);

  const next = d.decidedAt && d.decideEveryMs ? Math.max(0, Math.ceil((Date.parse(d.decidedAt) + d.decideEveryMs - now) / 1000)) : null;
  const age = d.priceAt ? Math.max(0, Math.round((now - Date.parse(d.priceAt)) / 1000)) : null;
  const liveEquity = s.cash + s.coins * d.price;
  const liveRet = (liveEquity / s.capital - 1) * 100;
  const bar = st.interval === "4h" ? "4시간봉" : "일봉";

  return (
    <div className="pc-box">
      <div className="pc-head">
        <span className="pc-live">
          <i /> LIVE
        </span>
        <b className={d.price >= lastC ? "up" : "down"}>{won(d.price)}</b>
        <small>
          가상 자산 {won(liveEquity)} <em className={liveRet > 0 ? "up" : liveRet < 0 ? "down" : undefined}>{liveRet >= 0 ? "+" : ""}{liveRet.toFixed(2)}%</em>
        </small>
      </div>

      <svg className="pc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="모의투자 실시간 차트">
        {stopPrice != null ? (
          <>
            <line className="pc-stop" x1={PAD.l} x2={W - PAD.r} y1={y(stopPrice)} y2={y(stopPrice)} />
            <text className="pc-tag stop" x={W - PAD.r + 3} y={y(stopPrice) + 3}>손절</text>
          </>
        ) : null}
        {holding ? (
          <>
            <line className="pc-entry" x1={PAD.l} x2={W - PAD.r} y1={y(s.entryPrice!)} y2={y(s.entryPrice!)} />
            <text className="pc-tag entry" x={W - PAD.r + 3} y={y(s.entryPrice!) + 3}>산 값</text>
          </>
        ) : null}
        <path className="pc-slow" d={line(slow)} />
        <path className="pc-fast" d={line(fast)} />
        <path className="pc-price" d={pricePath} />
        {marks.map((m) =>
          m.side === "buy" ? (
            <path key={m.id} className="pc-buy" d={`M${m.x},${m.y + 3} l-4,7 h8 z`}>
              <title>{m.title}</title>
            </path>
          ) : (
            <path key={m.id} className="pc-sell" d={`M${m.x},${m.y - 3} l-4,-7 h8 z`}>
              <title>{m.title}</title>
            </path>
          ),
        )}
        <line className="pc-now" x1={PAD.l} x2={W - PAD.r} y1={liveY} y2={liveY} />
        <circle className="pc-dot" cx={liveX} cy={liveY} r="3" />
        <text className="pc-tag now" x={W - PAD.r + 3} y={liveY + 3}>지금</text>
      </svg>

      <div className="pc-legend">
        <span className="price">가격</span>
        <span className="fast">단기 {st.fast}</span>
        <span className="slow">장기 {st.slow}</span>
        <span className="buy">▲ 가상 매수</span>
        <span className="sell">▼ 가상 매도</span>
      </div>
      <small className="pc-foot">
        {bar} 최근 {idx.length}개 + 지금 진행 중인 봉 · 현재가 3초마다
        {age != null ? ` (${age}초 전 체결가)` : ""}
        {s.running ? (next != null ? ` · 다음 사고팔기 판단 ${next ? `${next}초 뒤` : "중…"}` : "") : " · 모의투자 멈춤"}
      </small>
    </div>
  );
}
