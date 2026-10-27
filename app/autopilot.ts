"use client";

/**
 * 자동 운영 — "오늘 업무 시작하기" 한 번이면 하루 단계에 맞춰 진짜 일을 하고, 중요한 것만 알린다.
 *
 *   ② 시장 리서치 시작  → 손익·정산팀이 업비트 잔고 조회 (조회만)
 *   ⑤ 백테스트 검증     → 검증·리스크팀이 코인 × 조합 전부 탐색 → 목표(월 1~3%, MDD 이내) 후보 선정
 *   ⑧ 대표 승인 대기    → 탐색이 끝나면 자동 결재 (실제 주문 없음)
 *   ⑬ 업무 종료         → 하루 요약
 *
 * 엔진(app/game/)은 고치지 않고, 화면이 엔진 상태(phaseIndex 등)를 보고 끼어든다.
 */
import { useSyncExternalStore } from "react";
import { AUTOPILOT } from "../company.config";
import { coinLabel, TARGET, VERDICT_LABEL, verdictOf, type Verdict } from "./backtestLink";
import type { Agent, Company, Snapshot } from "./game/sim";
import { loadToday, saveRecord } from "./records";
import { fetchBalance, getUpbit, signedPct, won } from "./upbitLink";

export type AlertLevel = "good" | "warn" | "bad" | "info";
export type Alert = { id: number; time: string; level: AlertLevel; title: string; body: string };

export type Candidate = {
  market: string;
  fast: number;
  slow: number;
  stop: number;
  monthly: number;
  mdd: number;
  total: number;
  trades: number;
  winRate: number;
  verdict: Verdict;
};

export type CoinResult = { market: string; runs: number; passed: number; best: Candidate | null };

type State = {
  enabled: boolean;
  day: number;
  step: string;
  searching: boolean;
  searched: boolean;
  runs: number;
  passed: Candidate[];
  nearest: Candidate | null;
  /** 타겟 코인별 결과 (통과 개수 + 그 코인의 최고 후보) */
  byCoin: CoinResult[];
  approvedText: string | null;
  alerts: Alert[];
  /** "unknown" = 아직 확인 전 (서버 화면과 브라우저 첫 화면을 똑같이 맞추기 위해 처음엔 모르는 상태로 둔다) */
  permission: NotificationPermission | "unsupported" | "unknown";
};

let state: State = {
  enabled: AUTOPILOT.enabled,
  day: 0,
  step: "대기 중",
  searching: false,
  searched: false,
  runs: 0,
  passed: [],
  nearest: null,
  byCoin: [],
  approvedText: null,
  alerts: [],
  permission: "unknown",
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function useAutopilot() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

export const setAutopilot = (enabled: boolean) => set({ enabled });
export const clearAlerts = () => set({ alerts: [] });

// ── 중요 알림 ───────────────────────────────────────────
let alertSeq = 0;
const ICON: Record<AlertLevel, string> = { good: "🟢", warn: "⚠️", bad: "🔴", info: "✅" };

const hhmm = (d: Date) => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function notify(level: AlertLevel, title: string, body: string) {
  set({ alerts: [{ id: alertSeq++, time: hhmm(new Date()), level, title, body }, ...state.alerts].slice(0, 30) });
  void saveRecord("alert", { level, title, body });
  // 데스크톱 알림 (허용한 경우만)
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`${ICON[level]} ${title}`, { body, tag: `autopilot-${alertSeq}` });
    }
  } catch {
    /* 알림을 못 띄우는 환경이면 화면 알림함만 쓴다 */
  }
}

export async function askNotifyPermission() {
  if (typeof Notification === "undefined") return set({ permission: "unsupported" });
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* 무시 */
    }
  }
  set({ permission: Notification.permission });
}

export function syncPermission() {
  set({ permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission });
}

/** 새로고침해도 오늘의 중요 알림·TOP1 이 사라지지 않게 기록에서 되살린다 (다시 저장하지 않음) */
let restored = false;
export async function restoreToday() {
  if (restored) return;
  restored = true;
  const today = await loadToday();
  if (!today) return;
  const alerts: Alert[] = [...today.alerts]
    .reverse()
    .slice(0, 30)
    .map((a) => ({ id: alertSeq++, time: hhmm(new Date(a.at)), level: a.level as AlertLevel, title: a.title, body: a.body }));
  const patch: Partial<State> = { alerts: [...state.alerts, ...alerts].slice(0, 30) };
  const s = today.search as { runs?: number; passed?: Omit<Candidate, "verdict">[]; nearest?: Omit<Candidate, "verdict"> | null } | null;
  if (s && !state.searched) {
    const withVerdict = (c: Omit<Candidate, "verdict">): Candidate => ({ ...c, verdict: verdictOf(c.monthly, c.mdd) });
    patch.runs = s.runs ?? 0;
    patch.passed = (s.passed ?? []).map(withVerdict);
    patch.nearest = s.nearest ? withVerdict(s.nearest) : null;
    const saved = (today.search as { byCoin?: (Omit<CoinResult, "best"> & { best: Omit<Candidate, "verdict"> | null })[] }).byCoin;
    if (saved) patch.byCoin = saved.map((c) => ({ ...c, best: c.best ? withVerdict(c.best) : null }));
  }
  set(patch);
}

// ── 하루 진행 ───────────────────────────────────────────
const done = new Set<string>();
let searchJob: Promise<void> | null = null;

export function newDay() {
  done.clear();
  searchJob = null;
  set({ day: state.day + 1, step: "출근 중", searching: false, searched: false, runs: 0, passed: [], nearest: null, byCoin: [], approvedText: null });
}

const once = (key: string) => {
  if (done.has(key)) return false;
  done.add(key);
  return true;
};

const coinName = (m: string) => coinLabel(m);
export const describe = (c: Candidate) =>
  `${coinName(c.market)} ${c.fast}/${c.slow} · 손절 ${Math.round(c.stop * 100)}% → 월 ${signedPct(c.monthly)} · MDD ${c.mdd.toFixed(1)}%`;

/** 화면이 엔진 상태가 바뀔 때마다 부른다 */
export function onPhase(engine: Company, snap: Snapshot) {
  if (!state.enabled || !snap.running && !snap.dayComplete) return;

  if (snap.phaseIndex >= 2 && once("balance")) void morningBalance(engine);
  if (snap.phaseIndex >= 5 && once("search")) searchJob = search(engine);
  if (snap.approvalPending && once("approve")) void autoApprove(engine);
  if (snap.dayComplete && once("summary")) summary(engine);
}

async function morningBalance(engine: Company) {
  set({ step: "아침 잔고 확인" });
  engine.pushLog("🤖", "자동 운영: 손익·정산팀이 아침 잔고를 확인합니다 (조회만).", "lav");
  await fetchBalance(engine, true);
  const { balance, configured } = getUpbit();
  if (!configured) return; // 키가 없으면 조용히 넘어간다 (오류 아님)
  if (!balance?.ok) {
    notify("bad", "업비트 잔고 조회 실패", balance?.error ?? "알 수 없는 오류");
    return;
  }
  const losers = (balance.assets ?? []).filter((a) => a.pnlPct !== null && a.pnlPct <= AUTOPILOT.lossAlertPct);
  if (losers.length) {
    notify(
      "warn",
      `손실 경보 — ${losers.length}개 코인이 ${AUTOPILOT.lossAlertPct}% 아래`,
      losers.map((a) => `${a.currency} ${signedPct(a.pnlPct)} (평가 ${won(a.value)})`).join(" · "),
    );
  }
}

const crewOf = (engine: Company, dept: string) => engine.agents.filter((a) => a.deptId === dept);
const onDuty = (a: Agent) => a.status !== "출근 전" && a.status !== "출근 중";

async function search(engine: Company) {
  const { coins, interval, grid } = AUTOPILOT;
  set({ step: "전략 탐색 중", searching: true });
  const crew = crewOf(engine, "qa");
  const lead = crew.find((a) => a.rank === "lead");
  for (const a of crew) if (onDuty(a)) { a.status = "업무 중"; a.taskLabel = "전략 조합 탐색"; }
  if (lead && onDuty(lead)) engine.say(lead, "조합 전부 돌려볼게요!", 3);
  engine.pushLog("🤖", `자동 운영: 검증·리스크팀이 ${coins.length}개 코인 × 조합 전략 탐색 시작`, "lav");

  let rows: Omit<Candidate, "verdict">[] = [];
  let error = "";
  try {
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markets: coins.join(","), interval, sweep: grid }),
    });
    const data = await res.json();
    if (data.ok) rows = data.sweep;
    else error = data.error ?? "알 수 없는 오류";
  } catch (e) {
    error = `서버에 닿지 못했어요: ${String(e)}`;
  }

  for (const a of crew) if (onDuty(a)) a.status = "대기";
  const who = `${lead?.name ?? "윤규아"} · 검증·리스크팀`;

  if (error) {
    set({ searching: false, searched: true, step: "전략 탐색 실패" });
    engine.pushChat("staff", who, `전략 탐색이 막혔어요.\n${error}`);
    notify("bad", "전략 탐색 실패", error);
    return;
  }

  const all: Candidate[] = rows.map((r) => ({ ...r, verdict: verdictOf(r.monthly, r.mdd) }));
  // 통과 후보: 낙폭이 작은 순 (버티기 쉬운 전략 우선), 같으면 거래가 많은 순
  const passed = all.filter((c) => c.verdict === "pass").sort((a, b) => b.mdd - a.mdd || b.trades - a.trades);
  // 통과가 없으면: 낙폭 기준 안에서 월 목표에 가장 가까운 것
  const target = (TARGET.monthlyMin + TARGET.monthlyMax) / 2;
  const nearest =
    passed[0] ??
    [...all].sort(
      (a, b) =>
        Number(a.mdd < -TARGET.maxDrawdown) - Number(b.mdd < -TARGET.maxDrawdown) ||
        Math.abs(a.monthly - target) - Math.abs(b.monthly - target),
    )[0] ??
    null;

  // 타겟 코인마다: 통과 개수와 그 코인에서 가장 나은 후보 (통과가 없으면 가장 가까운 것)
  const rank = (list: Candidate[]) =>
    [...list].sort(
      (a, b) =>
        Number(b.verdict === "pass") - Number(a.verdict === "pass") ||
        Number(a.mdd < -TARGET.maxDrawdown) - Number(b.mdd < -TARGET.maxDrawdown) ||
        (a.verdict === "pass" ? b.mdd - a.mdd : Math.abs(a.monthly - target) - Math.abs(b.monthly - target)),
    )[0] ?? null;
  const byCoin: CoinResult[] = coins.map((market) => {
    const mine = all.filter((c) => c.market === market);
    return { market, runs: mine.length, passed: mine.filter((c) => c.verdict === "pass").length, best: rank(mine) };
  });

  set({ searching: false, searched: true, runs: all.length, passed, nearest, byCoin, step: "탐색 완료" });
  void saveRecord("search", { coins, interval, grid, target: TARGET, runs: all.length, passed: passed.slice(0, 10), nearest, byCoin });

  const lines = passed.length
    ? passed.slice(0, 3).map((c, i) => `${i + 1}위 ${describe(c)}`)
    : [`목표에 맞는 조합이 없었어요.`, nearest ? `가장 가까운 후보: ${describe(nearest)} (${VERDICT_LABEL[nearest.verdict]})` : ""];
  const coinLines = byCoin.map((c) =>
    c.runs === 0
      ? `· ${coinLabel(c.market)}: 데이터 없음`
      : `· ${coinLabel(c.market)}: ${c.passed ? `통과 ${c.passed}개` : "통과 0"} — ${c.best ? describe(c.best) : "-"}`,
  );
  engine.pushChat(
    "staff",
    who,
    `전략 탐색 끝났어요. ${coins.map(coinLabel).join("·")} ${all.length}개 조합 중 목표 통과 ${passed.length}개.\n${lines.filter(Boolean).join("\n")}\n[코인별]\n${coinLines.join("\n")}`,
  );
  engine.pushLog("🛡️", `전략 탐색 완료 — ${all.length}개 중 통과 ${passed.length}개`, passed.length ? "mint" : "yellow");
  if (lead && onDuty(lead)) engine.say(lead, passed.length ? `통과 ${passed.length}개 나왔어요!` : "오늘은 통과가 없어요…", 3.4);

  if (passed.length) {
    notify("good", `목표 달성 전략 ${passed.length}개 발견`, `TOP1 ${describe(passed[0])}`);
  } else {
    notify(
      "warn",
      "오늘은 목표 통과 전략 없음",
      nearest ? `가장 가까운 후보: ${describe(nearest)}` : `${all.length}개 조합 모두 기준 미달`,
    );
  }
}

async function autoApprove(engine: Company) {
  set({ step: "탐색 결과 기다리는 중" });
  if (searchJob) await searchJob;
  const top = state.passed[0];
  const text = top
    ? `자동 결재: ${describe(top)} — 모의투자용으로 개발 진행`
    : "자동 결재: 통과 전략이 없어 오늘은 기존 전략 유지·개발만 진행";
  set({ approvedText: text, step: "자동 결재 완료" });
  engine.pushChat("staff", "김세리", `${text}\n(실제 주문은 하지 않아요. 실전 전환은 대표님이 직접 결정하세요.)`);
  engine.pushLog("🤖", text, "mint");
  engine.approve();
}

function summary(engine: Company) {
  const { passed, nearest, runs } = state;
  const bal = getUpbit().balance;
  const parts = [
    runs ? `전략 ${runs}개 조합 탐색 · 통과 ${passed.length}개` : "전략 탐색 안 됨",
    passed[0] ? `TOP1 ${describe(passed[0])}` : nearest ? `가장 가까운 후보 ${describe(nearest)}` : "",
    bal?.ok ? `잔고 ${won(bal.total)}` : "",
  ].filter(Boolean);
  set({ step: "오늘 업무 완료" });
  engine.pushLog("🤖", `자동 운영 하루 요약 — ${parts.join(" / ")}`, "yellow");
  notify("info", "오늘 업무 완료", parts.join("\n"));
}
