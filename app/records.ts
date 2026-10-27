"use client";

/**
 * 날짜별 결과 기록 — 서버(records/*.jsonl)에 뒤에 붙이기만 한다.
 * 탐색 결과 · 잔고 · 중요 알림이 생길 때마다 saveRecord 로 1건씩 남기고,
 * 기록 패널은 날짜별 요약을 읽어 보여준다.
 */
import { useSyncExternalStore } from "react";

export type RecordKind = "search" | "balance" | "alert";

export type DaySummary = {
  date: string;
  balance: { total: number; cash: number; coinValue: number; pnlPct: number | null; coins: number } | null;
  search: {
    coins: string[];
    byCoin: { market: string; passed: number; runs: number }[];
    runs: number;
    passed: number;
    top: { market: string; fast: number; slow: number; stop: number; monthly: number; mdd: number } | null;
    nearest: { market: string; fast: number; slow: number; stop: number; monthly: number; mdd: number } | null;
  } | null;
  alerts: { count: number; bad: number; warn: number; good: number };
};

type State = { loading: boolean; days: DaySummary[]; error: string };
let state: State = { loading: false, days: [], error: "" };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function useRecords() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

/** 기록 1건 추가 (실패해도 화면 동작은 막지 않는다) */
export async function saveRecord(kind: RecordKind, data: object) {
  try {
    await fetch(`/api/records/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    void loadSummary(); // 기록 패널 갱신
  } catch {
    /* 기록 실패는 조용히 넘어간다 */
  }
}

export async function loadSummary(days = 60) {
  set({ loading: true });
  try {
    const d = await (await fetch(`/api/records/summary?days=${days}`)).json();
    set({ loading: false, days: d.ok ? d.days : [], error: d.ok ? "" : d.error ?? "기록을 못 읽었어요" });
  } catch (e) {
    set({ loading: false, error: `기록을 못 읽었어요: ${String(e)}` });
  }
}

/** 오늘 기록 — 새로고침 뒤 알림·TOP1 복원용 */
export async function loadToday(): Promise<{
  search: Record<string, unknown> | null;
  balance: Record<string, unknown> | null;
  alerts: { at: string; level: string; title: string; body: string }[];
} | null> {
  try {
    const d = await (await fetch("/api/records/today")).json();
    return d.ok ? d : null;
  } catch {
    return null;
  }
}
