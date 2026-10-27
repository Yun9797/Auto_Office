import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 로컬 개발 서버 전용: 결과 기록을 날짜별로 쌓는다. (지우거나 덮어쓰지 않고 뒤에 붙이기만)
 *
 *   POST /api/records/search   전략 탐색 결과 1건 추가
 *   POST /api/records/balance  잔고 조회 결과 1건 추가
 *   POST /api/records/alert    중요 알림 1건 추가
 *   GET  /api/records/summary?days=60   날짜별 한 줄 요약 (최근 순)
 *   GET  /api/records/today             오늘 기록 (새로고침 뒤 복원용)
 *
 * 저장 위치: 프로젝트의 records/{search|balance|alert}.jsonl (한 줄 = 기록 1건)
 * ⚠️ balance 기록에는 잔고 금액이 들어 있다. 남에게 공유하지 말 것.
 */
const KINDS = ["search", "balance", "alert"] as const;
type Kind = (typeof KINDS)[number];
type Row = Record<string, unknown> & { date: string; at: string };

/** 한국 시간 기준 날짜 (YYYY-MM-DD) */
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

function readRows(dir: string, kind: Kind): Row[] {
  const file = path.join(dir, `${kind}.jsonl`);
  if (!existsSync(file)) return [];
  const rows: Row[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 깨진 줄은 건너뛴다 */
    }
  }
  return rows;
}

function lastOfDay(rows: Row[]) {
  const map = new Map<string, Row>();
  for (const r of rows) map.set(r.date, r); // 파일은 시간 순이라 마지막 것이 남는다
  return map;
}

function summary(dir: string, days: number) {
  const search = lastOfDay(readRows(dir, "search"));
  const balance = lastOfDay(readRows(dir, "balance"));
  const alerts = new Map<string, Row[]>();
  for (const a of readRows(dir, "alert")) alerts.set(a.date, [...(alerts.get(a.date) ?? []), a]);

  const dates = [...new Set([...search.keys(), ...balance.keys(), ...alerts.keys()])].sort().reverse().slice(0, days);
  return dates.map((date) => {
    const s = search.get(date);
    const b = balance.get(date);
    const a = alerts.get(date) ?? [];
    return {
      date,
      balance: b ? { total: b.total, cash: b.cash, coinValue: b.coinValue, pnlPct: b.pnlPct, coins: (b.assets as unknown[] | undefined)?.length ?? 0 } : null,
      search: s ? { coins: s.coins, byCoin: ((s.byCoin as { market: string; passed: number; runs: number }[] | undefined) ?? []).map((c) => ({ market: c.market, passed: c.passed, runs: c.runs })), runs: s.runs, passed: (s.passed as unknown[] | undefined)?.length ?? 0, top: (s.passed as unknown[] | undefined)?.[0] ?? null, nearest: s.nearest ?? null } : null,
      alerts: { count: a.length, bad: a.filter((x) => x.level === "bad").length, warn: a.filter((x) => x.level === "warn").length, good: a.filter((x) => x.level === "good").length },
    };
  });
}

export function records(): Plugin {
  return {
    name: "records",
    enforce: "pre",
    apply: "serve",
    // 기록 파일이 바뀌어도 화면이 새로고침되지 않게 감시에서 뺀다
    config: () => ({ server: { watch: { ignored: ["**/records/**"] } } }),
    configureServer(server) {
      const dir = path.join(server.config.root, "records");

      server.middlewares.use("/api/records", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { ok: false, error: "허용되지 않은 요청" });

        const url = new URL(req.url ?? "/", "http://local");
        const route = url.pathname.replace(/^\/+/, "");

        if (req.method === "GET") {
          if (route === "summary") {
            const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 60));
            return send(200, { ok: true, days: summary(dir, days) });
          }
          if (route === "today") {
            const today = kstDate();
            const pick = (k: Kind) => readRows(dir, k).filter((r) => r.date === today);
            return send(200, { ok: true, date: today, search: pick("search").at(-1) ?? null, balance: pick("balance").at(-1) ?? null, alerts: pick("alert") });
          }
          return send(404, { ok: false, error: "없는 주소" });
        }

        if (req.method !== "POST" || !(KINDS as readonly string[]).includes(route)) {
          return send(404, { ok: false, error: "없는 주소" });
        }

        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 200_000) req.destroy(); // 기록 1건이 이렇게 클 리 없다
        });
        req.on("end", () => {
          try {
            const body = JSON.parse(raw || "{}");
            if (typeof body !== "object" || Array.isArray(body) || body === null) throw new Error("형식 오류");
            const now = new Date();
            const row = { ...body, date: kstDate(now), at: now.toISOString() };
            mkdirSync(dir, { recursive: true });
            appendFileSync(path.join(dir, `${route}.jsonl`), JSON.stringify(row) + "\n", "utf8");
            send(200, { ok: true, date: row.date });
          } catch (error) {
            send(400, { ok: false, error: (error as Error).message });
          }
        });
      });
    },
  };
}
