"use client";

import { useEffect } from "react";
import type { Company } from "./game/sim";
import { checkUpbit, fetchBalance, qtyText, signedPct, useUpbit, won } from "./upbitLink";
import "./balance.css";

const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? undefined : v > 0 ? "up" : "down");

export default function BalancePanel({ engine }: { engine: Company }) {
  const { configured, loading, balance } = useUpbit();

  useEffect(() => {
    checkUpbit();
  }, []);

  const ok = balance?.ok ? balance : null;

  return (
    <section className="win rail-card bal-card" id="upbit-balance">
      <div className="win-bar">
        <span>💰 upbit.balance</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body bal-body">
        <div className="bal-status">
          {configured === null ? (
            <span className="mini-badge">확인 중…</span>
          ) : configured ? (
            <span className="mini-badge mint">키 설정됨 · 조회 전용</span>
          ) : (
            <span className="mini-badge yellow">.dev.vars 에 키 없음</span>
          )}
          {ok?.at ? <span className="bal-time">{new Date(ok.at).toLocaleTimeString("ko-KR")} 기준</span> : null}
        </div>

        <button className="btn btn-primary bal-refresh" onClick={() => fetchBalance(engine)} disabled={loading || !configured}>
          {loading ? "손익·정산팀 조회 중…" : ok ? "잔고 새로고침" : "잔고 조회하기"}
        </button>

        {balance && !balance.ok ? (
          <div className="bal-error">
            <b>조회 실패</b> {balance.error}
          </div>
        ) : null}

        {ok ? (
          <>
            <div className="bal-total">
              <span>총 평가금액</span>
              <b>{won(ok.total)}</b>
              <small>
                원화 {won(ok.cash)} · 코인 {won(ok.coinValue)}
              </small>
            </div>
            {ok.assets?.length ? (
              <>
                <p className="bal-pnl">
                  코인 평가손익 <b className={tone(ok.pnl)}>{won(ok.pnl)}</b>{" "}
                  <b className={tone(ok.pnlPct)}>({signedPct(ok.pnlPct)})</b>
                </p>
                <table className="bal-table">
                  <thead>
                    <tr>
                      <th>코인</th>
                      <th>평가금액</th>
                      <th>수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ok.assets.map((a) => (
                      <tr key={a.currency} title={`보유 ${qtyText(a.qty)} · 평단 ${won(a.avg)} · 현재가 ${won(a.price)}`}>
                        <td>
                          {a.currency}
                          <small>{qtyText(a.qty)}개</small>
                        </td>
                        <td>{won(a.value)}</td>
                        <td className={tone(a.pnlPct)}>{a.pnlPct === null ? "시세 없음" : signedPct(a.pnlPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="bal-pnl">보유 중인 코인이 없어요.</p>
            )}
          </>
        ) : null}

        <p className="bal-note">조회만 합니다. 이 화면에는 주문·출금 기능이 없어요.</p>
      </div>
    </section>
  );
}
