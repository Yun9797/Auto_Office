"use client";

import { useEffect } from "react";
import { AUTOPILOT } from "../company.config";
import { describe, useAutopilot } from "./autopilot";
import { coinLabel, TARGET } from "./backtestLink";
import PaperChart from "./PaperChart";
import type { Company } from "./game/sim";
import {
  applyPaperStrategy,
  pausePaper,
  resumePaper,
  startPaperPolling,
  strategyText,
  usePaper,
  type PaperStrategy,
} from "./paperLink";
import { qtyText, signedPct, won } from "./upbitLink";
import "./paper.css";

const sameStrategy = (a: PaperStrategy | null | undefined, b: PaperStrategy) =>
  !!a && a.market === b.market && a.interval === b.interval && a.fast === b.fast && a.slow === b.slow && Math.abs(a.stop - b.stop) < 1e-9;

const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? undefined : v > 0 ? "up" : "down");
const hhmm = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 대시보드팀이 갱신하는 가상 자산 추이 (하루 한 점, 점선 = 시작 자금) */
function EquityTrend({ daily, capital }: { daily: [string, number][]; capital: number }) {
  const W = 240;
  const H = 60;
  const values = daily.map(([, v]) => v);
  const lo = Math.min(capital, ...values);
  const hi = Math.max(capital, ...values);
  const y = (v: number) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8));
  const x = (i: number) => (i / (values.length - 1)) * W;
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= capital;
  return (
    <div className="pp-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="모의투자 가상 자산 추이">
        <line x1="0" x2={W} y1={y(capital)} y2={y(capital)} className="pp-base" />
        <path d={path} className={up ? "pp-line up" : "pp-line down"} />
      </svg>
      <small>
        {daily[0][0]} ~ {daily[daily.length - 1][0]} · {daily.length}일 (점선 = 시작 자금)
      </small>
    </div>
  );
}

export default function PaperPanel({ engine }: { engine: Company }) {
  const { status: s, error, busy } = usePaper();
  const { passed, pick } = useAutopilot();
  const top = pick ?? passed[0];

  useEffect(() => startPaperPolling(engine), [engine]);

  const applyTop = () =>
    top &&
    applyPaperStrategy(
      engine,
      { market: top.market, interval: AUTOPILOT.interval, fast: top.fast, slow: top.slow, stop: top.stop },
      { monthly: top.monthly, mdd: top.mdd },
    );

  // 결재 전략이 이미 모의투자에 들어갔는지 (돌고 있음 / 코인 판 뒤 교체 대기 / 아직)
  const topStrategy: PaperStrategy | null = top
    ? { market: top.market, interval: AUTOPILOT.interval, fast: top.fast, slow: top.slow, stop: top.stop }
    : null;
  const applied = topStrategy && sameStrategy(s?.strategy, topStrategy) ? "running" : topStrategy && sameStrategy(s?.pending, topStrategy) ? "pending" : null;

  const live = s?.live;
  const holding = s ? s.coins > 0 : false;

  return (
    <section className="win rail-card pp-card" id="paper-trade">
      <div className="win-bar">
        <span>📝 paper.trade</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body pp-body">
        <div className="pp-status">
          {!s ? (
            <span className="mini-badge">확인 중…</span>
          ) : !s.strategy ? (
            <span className="mini-badge yellow">전략 대기</span>
          ) : s.running ? (
            <span className="mini-badge mint">모의투자 중 · 30초마다 확인</span>
          ) : (
            <span className="mini-badge yellow">멈춤</span>
          )}
          {live?.priceAt ? <span className="pp-time">{new Date(live.priceAt).toLocaleTimeString("ko-KR")} 시세</span> : null}
        </div>

        {error ? <div className="pp-error">{error}</div> : null}
        {live?.error ? <div className="pp-error">{live.error}</div> : null}

        {s && !s.strategy ? (
          <p className="pp-note">
            자동 결재 때 오늘의 TOP1 전략이 여기로 들어와요. 가상 자금으로 "샀다고 치자"를 기록만 해요.
          </p>
        ) : null}

        {s?.strategy ? (
          <>
            <div className="pp-strategy">
              <span>적용 전략</span>
              <b>{strategyText(s.strategy)}</b>
              {s.pending ? <small>다음 전략 대기: {strategyText(s.pending)} (가상 보유분을 판 뒤 교체)</small> : null}
            </div>

            <PaperChart s={s} />

            <div className="pp-price">
              <span>{coinLabel(s.strategy.market)} 현재가</span>
              <b>{won(live?.price)}</b>
              {live?.fastMa != null && live.slowMa != null ? (
                <small>
                  단기 {s.strategy.fast}봉 {won(live.fastMa)} {live.wantLong ? ">" : "≤"} 장기 {s.strategy.slow}봉 {won(live.slowMa)}
                  <em className={live.wantLong ? "up" : "down"}>{live.wantLong ? " → 상승 추세 (사고 싶음)" : " → 하락·횡보 (관망)"}</em>
                </small>
              ) : null}
              {s.stoppedOut ? <small>손절 후 쉬는 중 — 신호가 한 번 꺼졌다 다시 켜지면 재진입</small> : null}
            </div>

            <div className="pp-total">
              <span>가상 자산 (시작 {won(s.capital)})</span>
              <b>{won(s.equity)}</b>
              <small>
                모의투자 <em className={tone(s.returnPct)}>{signedPct(s.returnPct)}</em> · 그냥 들고 있었다면{" "}
                <em className={tone(s.holdReturnPct)}>{signedPct(s.holdReturnPct)}</em>
              </small>
              <small>
                {holding
                  ? `가상 보유 ${qtyText(s.coins)}개 · 산 값 ${won(s.entryPrice)} · 손절가 ${won((s.entryPrice ?? 0) * (1 - s.strategy.stop))}`
                  : `현금 ${won(s.cash)} (코인 없음)`}
              </small>
              <small>
                최대 낙폭 <em className={-s.maxDrawdown > TARGET.maxDrawdown ? "down" : undefined}>{s.maxDrawdown.toFixed(1)}%</em>
                {s.expect ? ` · 백테스트 기대 월 ${signedPct(s.expect.monthly)} · 낙폭 ${s.expect.mdd.toFixed(1)}%` : ""}
              </small>
              {s.startedAt ? <small>{hhmm(s.startedAt)} 부터 진행 · 가상 거래 {s.tradeCount}건</small> : null}
            </div>

            {s.daily.length > 1 ? <EquityTrend daily={s.daily} capital={s.capital} /> : null}

            <div className="pp-actions">
              {s.running ? (
                <button className="btn" onClick={() => pausePaper()} disabled={busy}>
                  ⏸ 모의투자 멈춤
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => resumePaper()} disabled={busy}>
                  ▶ 다시 시작
                </button>
              )}
            </div>
            {!s.running && holding ? <p className="pp-note">멈춘 동안에는 손절도 하지 않아요.</p> : null}
          </>
        ) : null}

        {top && topStrategy ? (
          applied === "running" ? (
            <p className="pp-applied">✅ 오늘 결재 전략이 모의투자에 적용돼 돌고 있어요 — {strategyText(topStrategy)}</p>
          ) : applied === "pending" ? (
            <p className="pp-applied wait">⏳ 오늘 결재 전략 적용 예약됨 — 가상 보유 코인을 판 뒤 바로 바뀌어요</p>
          ) : (
            <div className="pp-apply-box">
              <small>오늘 결재 전략: {describe(top)}</small>
              <button className="btn pp-apply" onClick={applyTop} disabled={busy}>
                {busy ? "적용 중…" : "이 전략을 모의투자에 적용"}
              </button>
            </div>
          )
        ) : null}

        {s?.trades.length ? (
          <table className="pp-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>가상 거래</th>
                <th>가격</th>
                <th>수익</th>
              </tr>
            </thead>
            <tbody>
              {s.trades.slice(0, 6).map((t) => (
                <tr key={t.id} title={`${qtyText(t.qty)}개 · ${won(t.krw)}`}>
                  <td>{hhmm(t.at)}</td>
                  <td className={t.side === "buy" ? "up" : undefined}>
                    {t.side === "buy" ? "매수" : `매도·${t.reason}`}
                  </td>
                  <td>{won(t.price)}</td>
                  <td className={tone(t.returnPct)}>{t.side === "sell" ? signedPct(t.returnPct) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : s?.strategy ? (
          <p className="pp-note">아직 가상 거래가 없어요. 신호가 오면 기록돼요.</p>
        ) : null}

        <p className="pp-note">
          가상 거래만 기록해요 (실제 주문 없음). 모의투자·백테스트 성과는 미래 수익을 보장하지 않아요.
        </p>
      </div>
    </section>
  );
}
