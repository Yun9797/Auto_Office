"use client";

import { useEffect, useState } from "react";
import { coinLabel, judge, runBacktest, TARGET, TARGET_MARKETS, useBacktest, type Coin } from "./backtestLink";
import type { Company } from "./game/sim";
import "./backtest.css";

/** "+12.3%" → 초록, "-4.5%" → 빨강 */
const tone = (v: unknown) => (String(v).startsWith("+") ? "up" : String(v).startsWith("-") ? "down" : undefined);

/** 수익 곡선: 전략(분홍) vs 단순보유(보라), 세로축은 로그 스케일 */
function Curve({ points }: { points: Coin["curve"] }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 110;
  const all = points.flatMap((p) => [p.strategy, p.hold]).filter((v) => v > 0);
  const lo = Math.log(Math.min(...all));
  const hi = Math.log(Math.max(...all));
  const y = (v: number) => H - 6 - ((Math.log(Math.max(v, 1e-9)) - lo) / (hi - lo || 1)) * (H - 12);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const line = (key: "strategy" | "hold") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  return (
    <svg className="bt-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="수익 곡선">
      <line x1="0" x2={W} y1={y(1)} y2={y(1)} className="base" />
      <path d={line("hold")} className="hold" />
      <path d={line("strategy")} className="strategy" />
    </svg>
  );
}

export default function BacktestPanel({ engine }: { engine: Company }) {
  const { running, options, result } = useBacktest();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [markets, setMarkets] = useState(options.markets);
  const [interval, setInterval] = useState<"day" | "4h">(options.interval);
  const [fast, setFast] = useState(options.fast);
  const [slow, setSlow] = useState(options.slow);
  const [stop, setStop] = useState(options.stop * 100);
  const [pick, setPick] = useState(0);

  // 대표 지시창에서 돌린 설정도 입력칸에 그대로 보이게
  useEffect(() => {
    setMarkets(options.markets);
    setInterval(options.interval);
    setFast(options.fast);
    setSlow(options.slow);
    setStop(Math.round(options.stop * 1000) / 10);
    setPick(0);
  }, [options]);

  useEffect(() => {
    fetch("/api/backtest")
      .then((r) => r.json())
      .then((d) => setConnected(Boolean(d.connected)))
      .catch(() => setConnected(false));
  }, []);

  const run = (demo = false) => runBacktest(engine, { markets, interval, fast, slow, stop: stop / 100, demo });

  const coin = result?.coins?.[pick];

  return (
    <section className="win rail-card bt-card" id="backtest">
      <div className="win-bar">
        <span>🧪 backtest.lab</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body bt-body">
        <div className="bt-status">
          {connected === null ? (
            <span className="mini-badge">확인 중…</span>
          ) : connected ? (
            <span className="mini-badge mint">auto-risk 연결됨</span>
          ) : (
            <span className="mini-badge yellow">auto-risk 폴더 미연결</span>
          )}
          <span className="bt-hint">목표 월 {TARGET.monthlyMin}~{TARGET.monthlyMax}% · MDD {TARGET.maxDrawdown}% 이내</span>
        </div>

        <div className="bt-form">
          <div className="bt-targets wide">
            {TARGET_MARKETS.split(",").map((m) => (
              <span key={m} className={markets.split(",").includes(m) ? "on" : ""}>
                {coinLabel(m)}
              </span>
            ))}
            <button type="button" onClick={() => setMarkets(TARGET_MARKETS)} disabled={markets === TARGET_MARKETS}>
              🎯 타겟 전체
            </button>
          </div>
          <label className="wide">
            코인
            <input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="KRW-BTC,이더리움 / all" />
          </label>
          <label>
            봉
            <select value={interval} onChange={(e) => setInterval(e.target.value as "day" | "4h")}>
              <option value="day">일봉</option>
              <option value="4h">4시간봉</option>
            </select>
          </label>
          <label>
            단기 MA
            <input type="number" min={2} value={fast} onChange={(e) => setFast(Number(e.target.value))} />
          </label>
          <label>
            장기 MA
            <input type="number" min={3} value={slow} onChange={(e) => setSlow(Number(e.target.value))} />
          </label>
          <label>
            손절 %
            <input type="number" min={0.5} step={0.5} value={stop} onChange={(e) => setStop(Number(e.target.value))} />
          </label>
        </div>

        <div className="bt-actions">
          <button className="btn btn-primary" onClick={() => run(false)} disabled={running || !connected}>
            {running ? "검증팀 계산 중…" : "백테스트 실행"}
          </button>
          <button className="btn btn-ghost" onClick={() => run(true)} disabled={running || !connected} title="인터넷 없이 가짜 데이터로 동작만 확인">
            데모
          </button>
        </div>

        {result && !result.ok ? (
          <div className="bt-error">
            <b>실패했어요</b> {result.error}
            {result.log?.length ? <pre>{result.log.join("\n")}</pre> : null}
          </div>
        ) : null}

        {result?.ok && !result.coins?.length ? <div className="bt-error">거래가 없었어요. 조건을 바꿔보세요.</div> : null}

        {coin ? (
          <div className="bt-result">
            {result!.coins!.length > 1 ? (
              <div className="bt-tabs">
                {result!.coins!.map((c, i) => (
                  <button key={c.name} className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
                    {coinLabel(c.name)}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="bt-period">{coinLabel(coin.name)} ({coin.name}) · {coin.summary["기간"]}</p>
            <div className={`bt-verdict ${judge(coin).verdict}`}>
              <div>
                <span>월평균 수익 (복리)</span>
                <b className={tone(coin.summary["전략 월평균(복리)"])}>{coin.summary["전략 월평균(복리)"]}</b>
              </div>
              <em>{judge(coin).label}</em>
              <small>목표 월 {TARGET.monthlyMin}~{TARGET.monthlyMax}%</small>
            </div>
            <div className="bt-kpis">
              <div><span>전략 수익</span><b className={tone(coin.summary["전략 총수익률"])}>{coin.summary["전략 총수익률"]}</b></div>
              <div><span>전략 MDD</span><b className={tone(coin.summary["전략 최대낙폭(MDD)"])}>{coin.summary["전략 최대낙폭(MDD)"]}</b></div>
              <div><span>보유 수익</span><b className={tone(coin.summary["단순보유 총수익률"])}>{coin.summary["단순보유 총수익률"]}</b></div>
              <div><span>보유 MDD</span><b className={tone(coin.summary["단순보유 MDD"])}>{coin.summary["단순보유 MDD"]}</b></div>
              <div><span>거래·승률</span><b>{coin.summary["거래 횟수"]}회 · {coin.summary["승률"]}</b></div>
              <div><span>손익비</span><b className={tone(coin.summary["손익비(Profit factor)"])}>{coin.summary["손익비(Profit factor)"]}</b></div>
            </div>
            <Curve points={coin.curve} />
            <p className="bt-legend"><i className="s" /> 전략 <i className="h" /> 단순보유 (로그 눈금)</p>
            <table className="bt-years">
              <thead><tr><th>연도</th><th>전략</th><th>보유</th></tr></thead>
              <tbody>
                {coin.yearly.map((r) => (
                  <tr key={r.year}><td>{r.year}</td><td className={tone(r.strategy)}>{r.strategy}</td><td className={tone(r.hold)}>{r.hold}</td></tr>
                ))}
              </tbody>
            </table>
            {result!.pooled && result!.coins!.length > 1 ? (
              <p className="bt-pooled">
                전체 합산: 거래 {result!.pooled["전체 거래 횟수"]}회 · 승률 {result!.pooled["승률"]} · 손익비 {result!.pooled["손익비(Profit factor)"]}
              </p>
            ) : null}
            <p className="bt-note">과거 성과일 뿐 미래 수익을 보장하지 않아요. 실전 전에 모의투자로 확인하세요.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
