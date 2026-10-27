"use client";

import { useEffect } from "react";
import { AUTOPILOT } from "../company.config";
import { coinLabel } from "./backtestLink";
import { askNotifyPermission, clearAlerts, describe, restoreToday, setAutopilot, syncPermission, useAutopilot } from "./autopilot";
import "./alerts.css";

/** 🔔 중요 알림만 모아 보는 창 + 자동 운영 스위치 */
export default function AlertsPanel() {
  const ap = useAutopilot();

  useEffect(() => {
    syncPermission();
    void restoreToday();
  }, []);

  return (
    <section className="win rail-card al-card" id="alerts">
      <div className="win-bar">
        <span>🔔 alerts — 중요 알림</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body al-body">
        <div className="al-top">
          <button
            className={`al-switch ${ap.enabled ? "on" : ""}`}
            onClick={() => setAutopilot(!ap.enabled)}
            title="켜면 업무 시작 한 번으로 잔고 확인·전략 탐색·결재까지 알아서 합니다"
          >
            🤖 자동 운영 {ap.enabled ? "ON" : "OFF"}
          </button>
          <span className="al-step">{ap.enabled ? ap.step : "대표가 직접 결재"}</span>
        </div>

        {ap.permission === "default" ? (
          <button className="al-perm" onClick={() => askNotifyPermission()}>
            🖥️ 데스크톱 알림 켜기 (창을 안 보고 있어도 알림)
          </button>
        ) : ap.permission === "denied" ? (
          <p className="al-hint">브라우저에서 알림이 차단돼 있어요. 이 창에서만 알림이 보여요.</p>
        ) : null}

        <div className="al-coins">
          <span className="al-coins-title">🎯 타겟 코인 {AUTOPILOT.coins.length}개</span>
          {AUTOPILOT.coins.map((market) => {
            const r = ap.byCoin.find((c) => c.market === market);
            const state = ap.searching ? "busy" : !r ? "idle" : r.runs === 0 ? "none" : r.passed ? "pass" : "fail";
            const badge = { busy: "탐색 중…", idle: "대기", none: "데이터 없음", pass: `통과 ${r?.passed}`, fail: "통과 0" }[state];
            return (
              <div key={market} className={`al-coin ${state}`}>
                <b>{coinLabel(market)}</b>
                <em>{badge}</em>
                <small>{r?.best ? describe(r.best).replace(`${coinLabel(market)} `, "") : market}</small>
              </div>
            );
          })}
        </div>

        {ap.passed[0] ? (
          <div className="al-best">
            <span>오늘의 TOP1 전략</span>
            <b>{describe(ap.passed[0])}</b>
            <small>
              {ap.runs}개 조합 중 통과 {ap.passed.length}개 · {AUTOPILOT.coins.map((c) => c.replace("KRW-", "")).join("·")}
            </small>
          </div>
        ) : null}

        {ap.alerts.length ? (
          <ul className="al-list">
            {ap.alerts.map((a) => (
              <li key={a.id} className={a.level}>
                <b>{a.title}</b>
                <p>{a.body}</p>
                <small>{a.time}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="al-hint">
            아직 중요한 소식이 없어요. 목표 달성 전략 발견 · 손실 경보 · 오류 · 하루 요약만 여기에 와요.
          </p>
        )}
        {ap.alerts.length ? (
          <button className="al-clear" onClick={clearAlerts}>
            알림 비우기
          </button>
        ) : null}
      </div>
    </section>
  );
}
