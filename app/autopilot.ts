"use client";

/**
 * 자동 운영 — "오늘 업무 시작하기" 한 번이면 하루 단계에 맞춰 진짜 일을 하고, 중요한 것만 알린다.
 *
 *   ② 모의투자 점검     → 손익·정산팀이 업비트 잔고 조회 (조회만) + 모의투자 감시팀이 모의투자 성적 점검
 *   ⑤ 백테스트 검증     → 검증·리스크팀이 코인 × 조합 전부 탐색 → 목표(월 1~3%, MDD 이내) 후보 선정
 *   ⑧ 대표 승인 대기    → 탐색이 끝나면 자동 결재 (실제 주문 없음)
 *   🌙 퇴근 버튼        → 하루 요약 (퇴근은 대표가 버튼을 눌러야만. 근무 중에는 6시간마다 보고서 자동 발행)
 *
 * 엔진(app/game/)은 고치지 않고, 화면이 엔진 상태(phaseIndex 등)를 보고 끼어든다.
 */
import { useSyncExternalStore } from "react";
import { AUTOPILOT, PAPER } from "../company.config";
import { coinLabel, TARGET, VERDICT_LABEL, verdictOf, type Verdict } from "./backtestLink";
import type { Agent, Company, Snapshot } from "./game/sim";
import { checkExchange, checkLivePrice, updateDashboard, verifyImplementation } from "./crewWork";
import { applyPaperStrategy, getPaper, reviewPaper, type PaperStrategy } from "./paperLink";
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
  /** AI 모델팀 과적합 검사를 거쳐 결재에 올릴 전략 (없으면 passed[0]) */
  pick: Candidate | null;
  /** pick 주변 조합 중 버틴 비율 (주변 조합이 없으면 null) */
  pickRobust: { ok: number; total: number } | null;
  approvedText: string | null;
  /** 근무 중 — "오늘 업무 시작하기"로 켜지고 대표가 "퇴근"을 눌러야만 꺼진다 */
  onDuty: boolean;
  dutySince: string | null;
  /** 다음 자동 보고서 발행 시각 (ms) — 근무 중에만 */
  nextReportAt: number | null;
  /** 다음 정기 점검 시각 (ms) — 출근 장면이 끝난 뒤 근무 중에만 */
  nextCheckAt: number | null;
  /** 이번 근무에서 돈 정기 점검 횟수 */
  cycles: number;
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
  pick: null,
  pickRobust: null,
  approvedText: null,
  onDuty: false,
  dutySince: null,
  nextReportAt: null,
  nextCheckAt: null,
  cycles: 0,
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

/** 보고서 등 화면 밖에서 읽을 때 */
export const getAutopilot = () => state;

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
    const pick = (today.search as { pick?: Omit<Candidate, "verdict"> | null }).pick;
    patch.pick = pick ? withVerdict(pick) : (patch.passed[0] ?? null);
    patch.pickRobust = (today.search as { pickRobust?: State["pickRobust"] }).pickRobust ?? null;
  }
  set(patch);
}

// ── 하루 진행 ───────────────────────────────────────────
const done = new Set<string>();
let searchJob: Promise<void> | null = null;
let approveJob: Promise<PaperStrategy | null> | null = null;
/** 전략 설계팀이 짠 오늘의 탐색 조합 */
let todayGrid: Grid | null = null;

export function newDay() {
  done.clear();
  searchJob = null;
  approveJob = null;
  todayGrid = null;
  set({ day: state.day + 1, step: "출근 중", searching: false, searched: false, runs: 0, passed: [], nearest: null, byCoin: [], pick: null, pickRobust: null, approvedText: null });
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
  if (snap.phaseIndex >= 2 && once("paperReview")) void reviewPaper(engine);
  if (snap.phaseIndex >= 3 && once("livePrice")) void checkLivePrice(engine);
  if (snap.phaseIndex >= 3 && once("exchange")) void checkExchange(engine);
  if (snap.phaseIndex >= 4 && once("design")) designReport(engine);
  if (snap.phaseIndex >= 5 && once("search")) searchJob = search(engine);
  if (snap.phaseIndex >= 6 && once("robust")) void robustReport(engine);
  if (snap.approvalPending && once("approve")) approveJob = autoApprove(engine);
  if (snap.phaseIndex >= 8 && once("verify")) void (async () => verifyImplementation(engine, approveJob ? await approveJob : null))();
  if (snap.phaseIndex >= 9 && once("dashboard")) void updateDashboard(engine);
  // 출근 장면이 끝나면 퇴근 전까지 정기 점검으로 이어간다
  if (snap.dayComplete && once("sceneDone") && state.onDuty) set({ nextCheckAt: Date.now() + CHECK_MS, step: "근무 중 · 다음 점검 대기" });
}

// ── 근무 · 정기 점검 · 정기 보고 · 퇴근 ─────────────────
const REPORT_MS = AUTOPILOT.reportEveryHours * 3600_000;
const CHECK_MS = AUTOPILOT.checkEveryHours * 3600_000;

/** 출근 */
export function startDuty() {
  if (state.onDuty) return;
  sentKeys.clear();
  set({ onDuty: true, dutySince: new Date().toISOString(), nextReportAt: Date.now() + REPORT_MS, nextCheckAt: null, cycles: 0 });
}

/** 정기 보고 시각이 됐는지 (화면이 1분마다 확인) */
export const reportDue = () => state.onDuty && state.nextReportAt !== null && Date.now() >= state.nextReportAt;
export const markReported = () => set({ nextReportAt: Date.now() + REPORT_MS });

/** 정기 점검 시각이 됐는지 — 출근 장면이 끝난 뒤, 근무 중일 때만 */
export const checkDue = (snap: Snapshot) =>
  state.enabled &&
  state.onDuty &&
  !cycleBusy &&
  !snap.running &&
  // 일정이 없으면(자동 운영을 껐다 켠 경우 등) 출근 장면이 끝난 뒤 바로 한 번
  (state.nextCheckAt === null ? snap.dayComplete : Date.now() >= state.nextCheckAt);

let cycleBusy = false;

/**
 * 정기 점검 — 출근 장면 없이 사무실에 있는 그대로, 출근 때와 같은 진짜 일을 한 바퀴 돈다.
 * 결재는 엔진 회의 없이 모의투자에 바로 적용 (실제 주문 없음).
 */
export async function runCheckCycle(engine: Company) {
  if (cycleBusy || !state.onDuty) return;
  cycleBusy = true;
  const n = state.cycles + 1;
  searchJob = null;
  todayGrid = null;
  set({ cycles: n, nextCheckAt: null, step: `정기 점검 ${n}회차`, searching: false, searched: false, runs: 0, passed: [], nearest: null, byCoin: [], pick: null, pickRobust: null });
  engine.pushLog("🔁", `정기 점검 ${n}회차 시작 (근무 중 ${AUTOPILOT.checkEveryHours}시간마다)`, "lav");
  try {
    await morningBalance(engine);
    await reviewPaper(engine);
    await Promise.all([checkLivePrice(engine), checkExchange(engine)]);
    designReport(engine);
    searchJob = search(engine);
    await searchJob;
    await robustReport(engine);
    const applied = await applyPick(engine, announcePick(engine));
    await verifyImplementation(engine, applied);
    await updateDashboard(engine);
  } finally {
    cycleBusy = false;
    if (state.onDuty) set({ step: `근무 중 · 정기 점검 ${n}회차 완료`, nextCheckAt: Date.now() + CHECK_MS });
  }
}

/** 퇴근 — 대표가 버튼을 눌렀을 때만. 하루 요약을 남기고 근무를 끝낸다 (모의투자는 서버에서 계속) */
export function endDuty(engine: Company) {
  if (!state.onDuty) return;
  summary(engine);
  set({ onDuty: false, nextReportAt: null, nextCheckAt: null, step: "퇴근" });
}

// 같은 근무 시간 안에 똑같은 알림이 정기 점검마다 반복되지 않게 — 내용이 바뀌었을 때만 다시 알린다
const sentKeys = new Set<string>();
export function notifyOnce(key: string, level: AlertLevel, title: string, body: string) {
  if (sentKeys.has(key)) return;
  sentKeys.add(key);
  notify(level, title, body);
}

// ── 전략 설계팀 (strategy1) — 탐색 조합 설계 ─────────────
type Grid = { fast: number[]; slow: number[]; stop: number[] };

/** 기본 조합 + 지금 모의투자 중인 전략 바로 옆 값 (각 목록 최대 8개 — 서버 제한) */
function designGrid(): { grid: Grid; anchor: PaperStrategy | null } {
  if (todayGrid) return { grid: todayGrid, anchor: getPaper()?.strategy ?? null };
  const base = AUTOPILOT.grid;
  const p = getPaper()?.strategy ?? null;
  const anchor = p && p.interval === AUTOPILOT.interval && AUTOPILOT.coins.includes(p.market) ? p : null;
  const merge = (list: number[], extra: number[], lo: number) =>
    [...new Set([...list, ...extra.filter((v) => v >= lo)])].sort((a, b) => a - b).slice(0, 8);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  todayGrid = anchor
    ? {
        fast: merge(base.fast, [anchor.fast - 5, anchor.fast, anchor.fast + 5], 2),
        slow: merge(base.slow, [anchor.slow - 20, anchor.slow, anchor.slow + 20], 3),
        stop: merge(base.stop, [anchor.stop - 0.01, anchor.stop, anchor.stop + 0.01].map(round), 0.005),
      }
    : { fast: [...base.fast], slow: [...base.slow], stop: [...base.stop] };
  return { grid: todayGrid, anchor };
}

const comboCount = (g: Grid) => g.fast.reduce((n, f) => n + g.slow.filter((s) => f < s).length, 0) * g.stop.length;

function designReport(engine: Company) {
  const { grid, anchor } = designGrid();
  const lead = crewOf(engine, "strategy1").find((a) => a.rank === "lead");
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  engine.pushChat(
    "staff",
    `${lead?.name ?? "최아름"} · 전략 설계팀`,
    [
      `오늘 탐색 조합 짰어요. 코인 ${AUTOPILOT.coins.length}개 × ${comboCount(grid)}개 조합.`,
      `단기 이평: ${grid.fast.join(", ")}`,
      `장기 이평: ${grid.slow.join(", ")}`,
      `손절: ${grid.stop.map(pct).join(", ")}`,
      anchor
        ? `지금 모의투자 중인 전략(${anchor.fast}/${anchor.slow} · 손절 ${pct(anchor.stop)}) 바로 옆 값도 넣었어요.`
        : "모의투자 전략이 아직 없어 기본 조합만 써요.",
    ].join("\n"),
  );
  engine.pushLog("💡", `전략 설계팀: 탐색 조합 ${comboCount(grid)}개 설계`, "mint");
}

// ── AI 모델팀 (reels) — 과적합 검사 ──────────────────────
/** 주변 조합(단기·장기 이평 한 칸씩 옆, 같은 손절)도 버티는지: 월 목표 하한 이상 + 낙폭 기준 안 */
function robustness(c: Candidate, all: Candidate[], grid: Grid) {
  const fi = grid.fast.indexOf(c.fast);
  const si = grid.slow.indexOf(c.slow);
  const near = all.filter(
    (r) =>
      r.market === c.market &&
      r.stop === c.stop &&
      r !== c &&
      Math.abs(grid.fast.indexOf(r.fast) - fi) <= 1 &&
      Math.abs(grid.slow.indexOf(r.slow) - si) <= 1,
  );
  if (!near.length) return null;
  const ok = near.filter((r) => r.monthly >= TARGET.monthlyMin && r.mdd >= -TARGET.maxDrawdown).length;
  return { ok, total: near.length };
}

async function robustReport(engine: Company) {
  if (searchJob) await searchJob;
  const lead = crewOf(engine, "reels").find((a) => a.rank === "lead");
  const who = `${lead?.name ?? "AI 모델팀"} · AI 모델팀`;
  const { passed, pick, pickRobust } = state;
  if (!passed.length) {
    engine.pushChat("staff", who, "통과 전략이 없어서 오늘은 과적합 검사할 게 없어요.");
    return;
  }
  const rate = (r: State["pickRobust"]) => (r ? `${r.ok}/${r.total}` : "주변 조합 없음");
  const lines = [
    `과적합 검사했어요. 통과 전략의 주변 조합(이평 한 칸씩 옆)도 버티는지 봤어요.`,
    pick ? `결재 올릴 전략: ${describe(pick)} — 주변 ${rate(pickRobust)} 버팀` : "",
    pick && pick !== passed[0] ? `(1위 ${describe(passed[0])} 는 주변이 약해서 뒤로 뺐어요)` : "",
    pickRobust && pickRobust.ok / pickRobust.total < 0.5 ? "⚠️ 주변이 약해요. 우연히 잘 맞은 조합일 수 있어요 (과적합 의심)." : "",
  ].filter(Boolean);
  engine.pushChat("staff", who, lines.join("\n"));
  engine.pushLog("🧠", `AI 모델팀: 과적합 검사 — 주변 ${rate(pickRobust)} 버팀`, pickRobust && pickRobust.ok / pickRobust.total >= 0.5 ? "mint" : "yellow");
}

async function morningBalance(engine: Company) {
  set({ step: "잔고 확인" });
  engine.pushLog("🤖", "자동 운영: 손익·정산팀이 잔고를 확인합니다 (조회만).", "lav");
  await fetchBalance(engine, true);
  const { balance, configured } = getUpbit();
  if (!configured) return; // 키가 없으면 조용히 넘어간다 (오류 아님)
  if (!balance?.ok) {
    notifyOnce(`balance-fail:${balance?.error}`, "bad", "업비트 잔고 조회 실패", balance?.error ?? "알 수 없는 오류");
    return;
  }
  const losers = (balance.assets ?? []).filter((a) => a.pnlPct !== null && a.pnlPct <= AUTOPILOT.lossAlertPct);
  if (losers.length) {
    // 같은 코인들이 계속 손실이면 근무 중 한 번만 (코인 구성이 바뀌면 다시)
    notifyOnce(
      `loss:${losers.map((a) => a.currency).sort().join(",")}`,
      "warn",
      `손실 경보 — ${losers.length}개 코인이 ${AUTOPILOT.lossAlertPct}% 아래`,
      losers.map((a) => `${a.currency} ${signedPct(a.pnlPct)} (평가 ${won(a.value)})`).join(" · "),
    );
  }
}

const crewOf = (engine: Company, dept: string) => engine.agents.filter((a) => a.deptId === dept);
const onDuty = (a: Agent) => a.status !== "출근 전" && a.status !== "출근 중";

async function search(engine: Company) {
  const { coins, interval } = AUTOPILOT;
  const { grid } = designGrid();
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
    notifyOnce(`search-fail:${error}`, "bad", "전략 탐색 실패", error);
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

  // AI 모델팀 과적합 검사: 주변의 절반 이상이 버티는 첫 통과 전략을 결재에 올린다 (없으면 1위 그대로)
  const scored = passed.map((c) => ({ c, r: robustness(c, all, grid) }));
  const chosen =
    scored.find((x) => x.r && x.r.ok / x.r.total >= 0.5) ?? scored.find((x) => !x.r) ?? scored[0] ?? null;
  const pick = chosen?.c ?? null;
  const pickRobust = chosen?.r ?? null;

  set({ searching: false, searched: true, runs: all.length, passed, nearest, byCoin, pick, pickRobust, step: "탐색 완료" });
  void saveRecord("search", { coins, interval, grid, target: TARGET, runs: all.length, passed: passed.slice(0, 10), nearest, byCoin, pick, pickRobust });

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

  // 정기 점검마다 같은 결과면 다시 알리지 않는다 (결재 전략이 바뀌면 다시 알림)
  if (passed.length) {
    const best = pick ?? passed[0];
    notifyOnce(`search-pass:${describe(best)}`, "good", `목표 달성 전략 ${passed.length}개 발견`, `결재 전략 ${describe(best)}`);
  } else {
    notifyOnce(
      `search-none:${nearest ? describe(nearest) : all.length}`,
      "warn",
      "목표 통과 전략 없음",
      nearest ? `가장 가까운 후보: ${describe(nearest)}` : `${all.length}개 조합 모두 기준 미달`,
    );
  }
}

async function autoApprove(engine: Company): Promise<PaperStrategy | null> {
  set({ step: "탐색 결과 기다리는 중" });
  if (searchJob) await searchJob;
  const top = announcePick(engine);
  engine.approve();
  return applyPick(engine, top);
}

/** 비서실 자동 결재 발표 (출근 장면에서는 엔진 회의 결재, 정기 점검에서는 회의 없이) */
function announcePick(engine: Company) {
  const top = state.pick ?? state.passed[0] ?? null;
  const text = top
    ? `자동 결재: ${describe(top)} — 모의투자에 적용`
    : "자동 결재: 통과 전략이 없어 기존 모의투자 전략 유지";
  set({ approvedText: text, step: "자동 결재 완료" });
  engine.pushChat("staff", "김세리", `${text}\n(실제 주문은 하지 않아요. 실전 전환은 대표님이 직접 결정하세요.)`);
  engine.pushLog("🤖", text, "mint");
  return top;
}

/** 결재 전략을 모의투자에 넣는다 */
async function applyPick(engine: Company, top: Candidate | null): Promise<PaperStrategy | null> {
  if (!top || !PAPER.autoApply) return null;
  const strategy: PaperStrategy = { market: top.market, interval: AUTOPILOT.interval, fast: top.fast, slow: top.slow, stop: top.stop };
  await applyPaperStrategy(engine, strategy, { monthly: top.monthly, mdd: top.mdd });
  return strategy;
}

function summary(engine: Company) {
  const { passed, nearest, runs } = state;
  const bal = getUpbit().balance;
  const paper = getPaper();
  const parts = [
    runs ? `전략 ${runs}개 조합 탐색 · 통과 ${passed.length}개` : "전략 탐색 안 됨",
    passed[0] ? `TOP1 ${describe(passed[0])}` : nearest ? `가장 가까운 후보 ${describe(nearest)}` : "",
    bal?.ok ? `잔고 ${won(bal.total)}` : "",
    paper?.strategy && paper.equity !== null ? `모의투자 ${won(paper.equity)} (${signedPct(paper.returnPct)})` : "",
  ].filter(Boolean);
  engine.pushLog("🤖", `퇴근 요약 — ${parts.join(" / ")}`, "yellow");
  notify("info", "퇴근 — 오늘 요약", parts.join("\n"));
}
