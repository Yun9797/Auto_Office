"use client";

import { useEffect } from "react";
import { coinLabel } from "./backtestLink";
import { loadSummary, useRecords, type DaySummary } from "./records";
import { signedPct, won } from "./upbitLink";
import "./history.css";

const coin = (m: string) => coinLabel(m);
const strat = (c: NonNullable<DaySummary["search"]>["top"]) =>
  c ? `${coin(c.market)} ${c.fast}/${c.slow} 손절${Math.round(c.stop * 100)}% · 월 ${signedPct(c.monthly)}` : "-";

/** 총 잔고 추이 (오래된 날 → 최근) */
function Trend({ days }: { days: DaySummary[] }) {
  const pts = [...days].reverse().filter((d) => d.balance).map((d) => d.balance!.total);
  if (pts.length < 2) return null;
  const W = 300;
  const H = 46;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className={`hi-trend ${up ? "up" : "down"}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="총 잔고 추이">
      <path d={d} />
    </svg>
  );
}

export default function HistoryPanel() {
  const { days, loading, error } = useRecords();

  useEffect(() => {
    void loadSummary();
  }, []);

  return (
    <section className="win rail-card hi-card" id="history">
      <div className="win-bar">
        <span>📒 history — 날짜별 기록</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body hi-body">
        <div className="hi-top">
          <span className="hi-hint">탐색 결과·잔고·알림이 날짜별로 쌓여요 (최근 60일)</span>
          <button className="hi-reload" onClick={() => loadSummary()} disabled={loading}>
            {loading ? "…" : "새로고침"}
          </button>
        </div>

        {error ? <p className="hi-hint">{error}</p> : null}

        {days.length ? (
          <>
            <Trend days={days} />
            <ul className="hi-list">
              {days.map((d, i) => {
                const prev = days[i + 1]?.balance?.total;
                const change = d.balance && prev ? ((d.balance.total / prev - 1) * 100) : null;
                return (
                  <li key={d.date}>
                    <div className="hi-row">
                      <b className="hi-date">{d.date.slice(5).replace("-", ".")}</b>
                      <span className="hi-bal">
                        {d.balance ? won(d.balance.total) : "잔고 기록 없음"}
                        {change !== null ? <em className={change >= 0 ? "up" : "down"}> {signedPct(change)}</em> : null}
                      </span>
                      <span className="hi-alerts" title={`알림 ${d.alerts.count}건`}>
                        {d.alerts.good ? `🟢${d.alerts.good}` : ""}
                        {d.alerts.warn ? `⚠️${d.alerts.warn}` : ""}
                        {d.alerts.bad ? `🔴${d.alerts.bad}` : ""}
                      </span>
                    </div>
                    {d.search ? (
                      <p className="hi-strat">
                        {d.search.passed ? (
                          <>
                            <span className="pass">통과 {d.search.passed}/{d.search.runs}</span> TOP1 {strat(d.search.top)}
                          </>
                        ) : (
                          <>
                            <span className="fail">통과 0/{d.search.runs}</span> 근접 {strat(d.search.nearest)}
                          </>
                        )}
                      </p>
                    ) : null}
                    {d.search?.byCoin?.length ? (
                      <p className="hi-coins">
                        {d.search.byCoin.map((c) => (
                          <span key={c.market} className={c.passed ? "pass" : "fail"}>
                            {coin(c.market)} {c.passed ? "✓" : "✕"}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="hi-hint">아직 기록이 없어요. 업무를 시작하거나 잔고를 조회하면 오늘 기록이 생겨요.</p>
        )}
      </div>
    </section>
  );
}
