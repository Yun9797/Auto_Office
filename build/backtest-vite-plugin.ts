import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 로컬 개발 서버 전용: /api/backtest 로 'auto-risk' 폴더의 백테스트를 실행한다.
 * (화면 서버는 Cloudflare 워커 안에서 돌아 Python 을 못 부르므로 Vite 서버에서 처리)
 *
 * 폴더 위치는 환경변수 AUTO_RISK_DIR 로 바꿀 수 있고, 기본값은 이 프로젝트 안의 "auto-risk" 폴더.
 */
export function backtest(): Plugin {
  return {
    name: "auto-risk-backtest",
    enforce: "pre",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const projectDir = process.env.AUTO_RISK_DIR ?? path.resolve(root, "auto-risk");
      const venvPython = path.join(projectDir, ".venv", "Scripts", "python.exe");
      const python = existsSync(venvPython) ? venvPython : "python";
      const runner = path.join(root, "bridge", "run_backtest.py");

      server.config.logger.info(`[backtest] auto-risk 폴더: ${projectDir}`);
      server.middlewares.use("/api/backtest", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        };

        if (req.method === "GET") {
          return send(200, { connected: existsSync(path.join(projectDir, "backtest.py")), projectDir });
        }
        if (req.method !== "POST") return send(405, { ok: false, error: "POST only" });

        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          let opts: Record<string, unknown>;
          try {
            const input = JSON.parse(raw || "{}");
            const markets = String(input.markets ?? "KRW-BTC");
            if (!/^[\p{L}\p{N}, -]{1,200}$/u.test(markets)) throw new Error("코인 이름에 쓸 수 없는 글자가 있어요.");
            opts = {
              markets,
              interval: input.interval === "4h" ? "4h" : "day",
              fast: Math.max(2, Math.min(1000, Math.floor(Number(input.fast) || 20))),
              slow: Math.max(3, Math.min(2000, Math.floor(Number(input.slow) || 60))),
              stop: Math.max(0.005, Math.min(0.9, Number(input.stop) || 0.08)),
              demo: Boolean(input.demo),
            };
            // 전략 탐색: 각 목록 최대 8개 숫자만 허용
            if (input.sweep) {
              const list = (v: unknown, lo: number, hi: number) =>
                (Array.isArray(v) ? v : [])
                  .map(Number)
                  .filter((n) => Number.isFinite(n) && n >= lo && n <= hi)
                  .slice(0, 8);
              const sweep = {
                fast: list(input.sweep.fast, 2, 1000).map(Math.floor),
                slow: list(input.sweep.slow, 3, 2000).map(Math.floor),
                stop: list(input.sweep.stop, 0.005, 0.9),
              };
              if (!sweep.fast.length || !sweep.slow.length || !sweep.stop.length) throw new Error("탐색 조합이 비어 있어요.");
              opts.sweep = sweep;
            }
          } catch (error) {
            return send(400, { ok: false, error: String((error as Error).message ?? error) });
          }

          const child = spawn(python, [runner, projectDir, JSON.stringify(opts)], {
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          });
          let out = "";
          let log = "";
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (log += d));
          const timer = setTimeout(() => child.kill(), 5 * 60_000);
          child.on("error", (error) => {
            clearTimeout(timer);
            send(500, { ok: false, error: `Python 실행 실패: ${error.message}` });
          });
          child.on("close", () => {
            clearTimeout(timer);
            if (res.writableEnded) return;
            try {
              const result = JSON.parse(out);
              send(result.ok ? 200 : 500, { ...result, log: log.trim().split("\n").slice(-20) });
            } catch {
              send(500, { ok: false, error: "결과를 읽지 못했어요.", log: log.trim().split("\n").slice(-20) });
            }
          });
        });
      });
    },
  };
}
