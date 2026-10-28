"use client";

/**
 * 실시간 시세 + 모의투자 ↔ 사무실 연결. (가상 거래만 — 실제 주문 없음)
 * 판단과 기록은 서버(/api/paper, build/paper-vite-plugin.ts)가 하고,
 * 화면은 15초마다 상태를 받아 패널에 보여주고 새 가상 거래가 생기면 자동화 운영팀이 보고한다.
 */
import { useSyncExternalStore } from "react";
import { PAPER } from "../company.config";
import { notify, notifyOnce } from "./autopilot";
import { coinLabel, TARGET } from "./backtestLink";
import type { Company } from "./game/sim";
import { signedPct, won } from "./upbitLink";

export type PaperStrategy = { market: string; interval: "day" | "4h"; fast: number; slow: number; stop: number };
export type PaperExpect = { monthly: number; mdd: number };

export type PaperTrade = {
  id: number;
  side: "buy" | "sell";
  reason: "신호" | "손절";
  market: string;
  price: number;
  qty: number;
  krw: number;
  returnPct?: number;
  at: string;
};

export type PaperStatus = {
  ok: boolean;
  error?: string;
  running: boolean;
  strategy: PaperStrategy | null;
  pending: PaperStrategy | null;
  capital: number;
  cash: number;
  coins: number;
  entryPrice: number | null;
  entryAt: string | null;
  stoppedOut: boolean;
  startedAt: string | null;
  equity: number | null;
  returnPct: number | null;
  holdReturnPct: number | null;
  tradeCount: number;
  /** 모의투자 가상 자산의 최대 낙폭 (%, 음수) */
  maxDrawdown: number;
  /** 전략을 고를 때 백테스트 기대치 */
  expect: PaperExpect | null;
  live: {
    price: number | null;
    priceAt: string | null;
    fastMa: number | null;
    slowMa: number | null;
    wantLong: boolean | null;
    lastBar: string | null;
    error: string;
  };
  daily: [string, number][];
  trades: PaperTrade[];
};

type State = { status: PaperStatus | null; error: string; busy: boolean };

let state: State = { status: null, error: "", busy: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function usePaper() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

/** 자동 운영 하루 요약에서 읽을 때 */
export const getPaper = () => state.status;

export const strategyText =(s: PaperStrategy) =>
  `${coinLabel(s.market)} ${s.interval === "4h" ? "4시간봉" : "일봉"} ${s.fast}/${s.slow} · 손절 ${Math.round(s.stop * 100)}%`;

// ── 사무실 연출 ─────────────────────────────────────────
const opsLead = (engine: Company) => engine.agents.find((a) => a.deptId === "ops" && a.rank === "lead");

function reportTrade(engine: Company | null, t: PaperTrade) {
  const name = coinLabel(t.market);
  const title =
    t.side === "buy"
      ? `모의 매수 — ${name} ${won(t.price)}`
      : `모의 매도(${t.reason}) — ${name} ${signedPct(t.returnPct)}`;
  const body =
    t.side === "buy"
      ? `가상 자금 ${won(t.krw)}으로 샀다고 기록했어요. (실제 주문 아님)`
      : `가상으로 ${won(t.krw)}에 팔았다고 기록했어요. 이번 거래 ${signedPct(t.returnPct)} (실제 주문 아님)`;
  notify(t.side === "buy" ? "info" : (t.returnPct ?? 0) > 0 ? "good" : "warn", title, body);
  if (!engine) return;
  const lead = opsLead(engine);
  engine.pushChat("staff", `${lead?.name ?? "자동화 운영팀"} · 자동화 운영팀`, `${title}\n${body}`);
  engine.pushLog("📝", title, t.side === "buy" ? "lav" : (t.returnPct ?? 0) > 0 ? "mint" : "yellow");
  if (lead && lead.status !== "출근 전" && lead.status !== "출근 중") {
    engine.say(lead, t.side === "buy" ? "모의 매수 기록!" : "모의 매도 기록!", 3);
  }
}

// ── 서버와 주고받기 ─────────────────────────────────────
let lastSeen: number | null = null;

export async function refreshPaper(engine: Company | null) {
  try {
    const s = (await (await fetch("/api/paper/status")).json()) as PaperStatus;
    if (!s.ok) return set({ error: s.error ?? "모의투자 상태를 못 읽었어요" });
    const newest = s.trades[0]?.id ?? 0;
    // 처음 읽을 때는 이미 있던 거래로 알림을 띄우지 않는다
    if (lastSeen !== null) {
      for (const t of [...s.trades].reverse()) if (t.id > lastSeen) reportTrade(engine, t);
    }
    lastSeen = Math.max(lastSeen ?? 0, newest);
    set({ status: s, error: "" });
  } catch (e) {
    set({ error: `서버에 닿지 못했어요: ${String(e)}` });
  }
}

let poller: number | null = null;
export function startPaperPolling(engine: Company) {
  void refreshPaper(engine);
  if (poller !== null) window.clearInterval(poller);
  poller = window.setInterval(() => void refreshPaper(engine), 5_000);
  return () => {
    if (poller !== null) window.clearInterval(poller);
    poller = null;
  };
}

async function post(route: string, body?: object): Promise<PaperStatus & { note?: string }> {
  set({ busy: true });
  try {
    const res = await fetch(`/api/paper/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json();
    set({ busy: false, ...(data.ok ? { status: data, error: "" } : { error: data.error ?? "요청 실패" }) });
    return data;
  } catch (e) {
    const error = `서버에 닿지 못했어요: ${String(e)}`;
    set({ busy: false, error });
    return { ok: false, error } as PaperStatus;
  }
}

export const pausePaper = () => post("pause");
export const resumePaper = () => post("resume");

/** 전략을 모의투자에 넘긴다 (자동 결재 또는 패널 버튼) */
export async function applyPaperStrategy(engine: Company | null, s: PaperStrategy, expect?: PaperExpect) {
  const r = await post("strategy", { ...s, capital: PAPER.capital, expect });
  if (!engine) return r;
  const lead = opsLead(engine);
  const who = `${lead?.name ?? "자동화 운영팀"} · 자동화 운영팀`;
  if (!r.ok) {
    engine.pushChat("staff", who, `모의투자에 전략을 못 넣었어요.\n${r.error}`);
    return r;
  }
  const text: Record<string, string> = {
    started: `모의투자 시작했어요 — ${strategyText(s)}\n가상 자금 ${won(r.capital)}, 30초마다 실시간 시세로 판단해요. (실제 주문 없음)`,
    same: `오늘 TOP1 도 지금 모의투자 중인 전략과 같아요 — 그대로 계속 돌려요.`,
    pending: `새 전략(${strategyText(s)})은 지금 가상으로 들고 있는 코인을 판 뒤에 바꿀게요.`,
    switched: `모의투자 전략을 바꿨어요 — ${strategyText(s)}`,
  };
  engine.pushChat("staff", who, text[r.note ?? "switched"] ?? text.switched);
  engine.pushLog("📝", `모의투자: ${strategyText(s)}`, "lav");
  return r;
}

// ── 모의투자 감시팀 (research) — 아침마다 성적을 백테스트 기대치와 비교 ──
/** 이 기간보다 짧으면 월 환산 수익으로 판단하지 않는다 */
const MIN_DAYS = 30;

export async function reviewPaper(engine: Company) {
  const lead = engine.agents.find((a) => a.deptId === "research" && a.rank === "lead");
  const who = `${lead?.name ?? "김서연"} · 모의투자 감시팀`;
  await refreshPaper(engine);
  const s = state.status;

  if (!s) {
    engine.pushChat("staff", who, `모의투자 상태를 못 읽었어요.\n${state.error}`);
    return;
  }
  if (!s.strategy) {
    engine.pushChat("staff", who, "아직 돌고 있는 모의투자가 없어요. 오늘 자동 결재 때 TOP1 전략으로 시작돼요.");
    engine.pushLog("👀", "모의투자 감시팀: 감시할 모의투자 없음 (결재 후 시작)", "lav");
    return;
  }

  const days = s.startedAt ? Math.max(0, (Date.now() - Date.parse(s.startedAt)) / 86_400_000) : 0;
  const monthly = s.returnPct !== null && days >= 1 ? (Math.pow(1 + s.returnPct / 100, 30.44 / days) - 1) * 100 : null;
  const ddOver = -s.maxDrawdown > TARGET.maxDrawdown;

  let verdict: string;
  if (ddOver) verdict = `🔴 최대 낙폭이 기준(${TARGET.maxDrawdown}%)을 넘었어요. 전략을 다시 봐야 해요.`;
  else if (days < MIN_DAYS) verdict = `아직 ${Math.floor(days)}일째라 판단하기 일러요. 최소 ${MIN_DAYS}일은 지켜볼게요.`;
  else if (monthly === null) verdict = "시세를 못 받아 수익을 계산하지 못했어요.";
  else if (monthly < TARGET.monthlyMin) verdict = `월 환산 ${signedPct(monthly)} — 목표(월 ${TARGET.monthlyMin}%) 미달이에요. 백테스트만큼 안 나오고 있어요.`;
  else if (monthly > TARGET.monthlyMax) verdict = `월 환산 ${signedPct(monthly)} — 목표보다 높아요. 운이 좋은 구간일 수 있으니 더 지켜볼게요.`;
  else verdict = `월 환산 ${signedPct(monthly)} — 목표 범위(${TARGET.monthlyMin}~${TARGET.monthlyMax}%) 안이에요.`;

  const lines = [
    `적용 전략: ${strategyText(s.strategy)} (${Math.floor(days)}일째, 가상 거래 ${s.tradeCount}건)`,
    `가상 자산 ${won(s.equity)} — 모의 ${signedPct(s.returnPct)} · 그냥 들고 있었다면 ${signedPct(s.holdReturnPct)}`,
    `모의투자 최대 낙폭 ${s.maxDrawdown.toFixed(1)}% (기준 ${TARGET.maxDrawdown}%)`,
    s.expect ? `백테스트 기대: 월 ${signedPct(s.expect.monthly)} · 최대 낙폭 ${s.expect.mdd.toFixed(1)}%` : "",
    s.live.error ? `⚠️ ${s.live.error}` : "",
    verdict,
  ].filter(Boolean);

  engine.pushChat("staff", who, `모의투자 아침 점검이에요. (가상 거래만)\n${lines.join("\n")}`);
  engine.pushLog("👀", `모의투자 감시팀: ${signedPct(s.returnPct)} · 낙폭 ${s.maxDrawdown.toFixed(1)}%`, ddOver ? "pink" : "mint");
  if (lead && lead.status !== "출근 전" && lead.status !== "출근 중") {
    engine.say(lead, ddOver ? "낙폭 기준 넘었어요!" : `모의 ${signedPct(s.returnPct)}예요`, 3);
  }
  if (ddOver) {
    // 정기 점검마다 반복하지 않게 하루 한 번
    notifyOnce(`dd:${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`, "warn", `모의투자 낙폭 기준 초과 (${s.maxDrawdown.toFixed(1)}%)`, `${strategyText(s.strategy)} — 기준 ${TARGET.maxDrawdown}%. 전략 재검토가 필요해요.`);
  }
}
