"use client";

/**
 * 업비트 잔고 ↔ 사무실 연결. (조회 전용 — 주문 기능 없음)
 * 패널 버튼이든 대표 지시창("잔고 알려줘")이든 여기로 들어와서,
 * 실제 조회는 /api/upbit/balance 가 하고 사무실에서는 손익·정산팀이 확인해 보고한다.
 */
import { useSyncExternalStore } from "react";
import type { Agent, Company } from "./game/sim";
import { saveRecord } from "./records";

export type Asset = {
  currency: string;
  qty: number;
  avg: number;
  price: number | null;
  value: number | null;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
};

export type Balance = {
  ok: boolean;
  error?: string;
  at?: string;
  cash?: number;
  coinValue?: number;
  total?: number;
  pnl?: number;
  pnlPct?: number | null;
  assets?: Asset[];
};

type State = { configured: boolean | null; loading: boolean; balance: Balance | null };

let state: State = { configured: null, loading: false, balance: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

/** 자동 운영에서 조회 결과를 읽을 때 */
export const getUpbit = () => state;

export function useUpbit() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

export async function checkUpbit() {
  try {
    const d = await (await fetch("/api/upbit/status")).json();
    set({ configured: Boolean(d.configured) });
  } catch {
    set({ configured: false });
  }
}

export function isBalanceOrder(text: string) {
  return /잔고|잔액|자산|평가금|내 계좌|계좌 조회|보유 코인/.test(text);
}

// ── 숫자 표시 ──────────────────────────────────────────
export const won = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `${Math.round(v).toLocaleString("ko-KR")}원`;
export const signedPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
export const qtyText = (v: number) => (v >= 1 ? v.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : v.toPrecision(4));

// ── 사무실 연출 ─────────────────────────────────────────
const team = (engine: Company) => engine.agents.filter((a) => a.deptId === "finance");
const onDuty = (a: Agent) => a.status !== "출근 전" && a.status !== "출근 중";

export async function fetchBalance(engine: Company | null, fromChat = false) {
  if (state.loading) return;
  set({ loading: true });

  const crew = engine ? team(engine) : [];
  const lead = crew.find((a) => a.rank === "lead");
  if (engine) {
    if (!fromChat) engine.pushChat("ceo", "대표님", "업비트 잔고 확인해줘");
    for (const a of crew) {
      if (!onDuty(a)) continue;
      a.status = "업무 중";
      a.taskLabel = "업비트 잔고 조회";
    }
    if (lead && onDuty(lead)) engine.say(lead, "업비트 잔고 조회할게요 (조회만!)", 3);
    engine.deptStatus.finance = "진행 중";
  }

  let balance: Balance;
  try {
    balance = await (await fetch("/api/upbit/balance")).json();
  } catch (error) {
    balance = { ok: false, error: `서버에 닿지 못했어요: ${String(error)}` };
  }
  set({ loading: false, balance, configured: balance.ok ? true : state.configured });
  if (balance.ok) {
    void saveRecord("balance", {
      total: balance.total,
      cash: balance.cash,
      coinValue: balance.coinValue,
      pnl: balance.pnl,
      pnlPct: balance.pnlPct,
      assets: (balance.assets ?? []).map(({ currency, qty, avg, price, value, pnlPct }) => ({ currency, qty, avg, price, value, pnlPct })),
    });
  }

  if (!engine) return;
  for (const a of crew) if (onDuty(a)) a.status = "대기";
  const who = `${lead?.name ?? "오재민"} · 손익·정산팀`;

  if (!balance.ok) {
    engine.deptStatus.finance = "연동 대기";
    if (lead && onDuty(lead)) engine.say(lead, "조회가 막혔어요…", 3);
    engine.pushChat("staff", who, `잔고 조회 실패했어요.\n${balance.error}`);
    engine.pushLog("⚠️", `업비트 잔고 조회 실패 — ${balance.error}`, "pink");
    return;
  }

  engine.deptStatus.finance = "완료";
  const assets = balance.assets ?? [];
  const lines = [
    `총 평가 ${won(balance.total)} (원화 ${won(balance.cash)} · 코인 ${won(balance.coinValue)})`,
    assets.length ? `코인 평가손익 ${won(balance.pnl)} (${signedPct(balance.pnlPct)})` : "보유 코인은 없어요.",
    ...assets
      .slice(0, 5)
      .map((a) => `${a.currency}: ${won(a.value)} · ${a.pnlPct === null ? "원화마켓 시세 없음" : signedPct(a.pnlPct)}`),
  ];
  if (assets.length > 5) lines.push(`…외 ${assets.length - 5}개 (패널에서 확인)`);
  if (lead && onDuty(lead)) engine.say(lead, `총 ${won(balance.total)}이에요`, 3.4);
  engine.pushChat("staff", who, `업비트 잔고 확인했어요. (조회만 했고 주문은 안 넣었어요)\n${lines.join("\n")}`);
  engine.pushLog("🧾", `손익·정산팀: 업비트 잔고 조회 완료 — 코인 ${assets.length}종`, "mint");
}
