"use client";

/**
 * 일일 보고서(노션·디스코드)에 실제 매매 결과를 덧붙인다.
 * 엔진이 만든 보고서(app/game/report.ts 의 buildReport)는 사무실 진행 상황만 담고 있어서,
 * 여기서 오늘의 전략 탐색·결재 전략·모의투자 성적·가상 거래·중요 알림을 앞쪽에 끼워 넣는다.
 * 없는 숫자는 쓰지 않는다 — 데이터가 없으면 "없음/아직"으로 적는다.
 */
import { describe, getAutopilot } from "./autopilot";
import { coinLabel, TARGET } from "./backtestLink";
import type { DayReport } from "./game/report";
import { getPaper, strategyText } from "./paperLink";
import { signedPct, won } from "./upbitLink";

const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export function withTrading(report: DayReport): DayReport {
  const ap = getAutopilot();
  const paper = getPaper();
  const today = kstDate(new Date());

  const highlights: string[] = [];
  const decisions: string[] = [];
  const risks: string[] = [];
  const next: string[] = [];

  // 전략 탐색 + 결재
  if (ap.runs) {
    highlights.push(`전략 탐색 — ${ap.runs}개 조합 중 목표 통과 ${ap.passed.length}개`);
    if (ap.pick) {
      const r = ap.pickRobust;
      highlights.push(`결재 전략 — ${describe(ap.pick)}${r ? ` (과적합 검사: 주변 ${r.ok}/${r.total} 버팀)` : ""}`);
    } else if (ap.nearest) {
      risks.push(`목표 통과 전략 없음 — 가장 가까운 후보 ${describe(ap.nearest)}`);
    }
  } else if (ap.searched) {
    risks.push("전략 탐색 실패 — 오늘 결재할 전략을 못 골랐어요");
  }
  if (ap.approvedText) decisions.push(ap.approvedText.replace(/^자동 결재: /, "자동 결재 — "));

  // 모의투자
  if (paper?.strategy) {
    const days = paper.startedAt ? Math.floor((Date.now() - Date.parse(paper.startedAt)) / 86_400_000) : 0;
    highlights.push(
      `모의투자 — ${strategyText(paper.strategy)} · ${days}일째 · 가상 자산 ${won(paper.equity)} (모의 ${signedPct(paper.returnPct)} · 그냥 보유 ${signedPct(paper.holdReturnPct)})`,
    );
    highlights.push(
      `모의투자 최대 낙폭 ${paper.maxDrawdown.toFixed(1)}% (기준 ${TARGET.maxDrawdown}%) · 가상 거래 ${paper.tradeCount}건${paper.expect ? ` · 백테스트 기대 월 ${signedPct(paper.expect.monthly)}` : ""}`,
    );
    const todays = paper.trades.filter((t) => kstDate(new Date(t.at)) === today);
    highlights.push(
      todays.length
        ? `오늘 가상 거래 — ${[...todays]
            .reverse()
            .map((t) => `${t.side === "buy" ? "매수" : `매도(${t.reason}) ${signedPct(t.returnPct)}`} ${coinLabel(t.market)} ${won(t.price)}`)
            .join(" / ")}`
        : `오늘 가상 거래 없음 — 신호: ${paper.live.wantLong === null ? "계산 전" : paper.live.wantLong ? "상승 추세(보유/매수)" : "하락·횡보(관망)"}`,
    );
    if (paper.pending) next.push(`가상 보유분을 판 뒤 새 전략으로 교체 예정: ${strategyText(paper.pending)}`);
    if (-paper.maxDrawdown > TARGET.maxDrawdown) risks.push(`모의투자 낙폭 ${paper.maxDrawdown.toFixed(1)}% — 기준 ${TARGET.maxDrawdown}% 초과, 전략 재검토 필요`);
    if (paper.live.error) risks.push(`모의투자 시세 오류 — ${paper.live.error}`);
    if (!paper.running) risks.push("모의투자가 멈춰 있어요 — 📝 패널에서 다시 시작해야 해요");
    next.push(days < 30 ? `모의투자 계속 관찰 (${30 - days}일 더 지나야 월 수익 판단 가능)` : "모의투자 월 환산 수익을 목표(월 1~3%)와 비교");
  } else {
    highlights.push("모의투자 — 아직 시작 전 (결재 전략이 생기면 자동 시작)");
  }

  // 오늘 뜬 경고·실패 알림
  for (const a of ap.alerts.filter((x) => x.level === "bad" || x.level === "warn").slice(0, 5)) {
    risks.push(`${a.level === "bad" ? "🔴" : "⚠️"} ${a.title}`);
  }

  // 엔진이 만든 사무실 내용 중 지어낸 "TOP 1 전략 승인 — 코드 구현·모델 학습…" 문구는 실제 결재로 바꾼다
  const engineDecisions = ap.approvedText ? report.decisions.filter((d) => !d.startsWith("TOP 1 전략")) : report.decisions;
  const engineNext = report.next.filter((n) => !/TOP 3 재검토|모의투자로 실제 체결 확인/.test(n));

  return {
    ...report,
    highlights: [...highlights, ...report.highlights],
    decisions: [...decisions, ...engineDecisions],
    risks: [...risks, ...report.risks],
    next: [...next, ...engineNext, "실전 주문은 하지 않음 — 실전 전환은 대표님이 직접 결정"],
  };
}
