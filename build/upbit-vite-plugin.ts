import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 로컬 개발 서버 전용: 업비트 잔고 "조회"만 한다. (주문·출금 기능 없음)
 *
 *   GET /api/upbit/status   → 키가 설정됐는지 여부만 (키 값은 절대 내보내지 않음)
 *   GET /api/upbit/balance  → 보유 자산 + 현재가로 계산한 평가금액·손익
 *
 * 키는 프로젝트의 .dev.vars 에서 UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY 로 읽는다.
 */
const API = "https://api.upbit.com/v1";

/** 업비트가 돌려주는 오류 이름 → 쉬운 말 */
const ERROR_HINT: Record<string, string> = {
  no_authorization_ip: "업비트에 등록한 허용 IP와 지금 이 컴퓨터 IP가 달라요. 업비트 Open API 관리에서 IP를 확인하세요.",
  invalid_access_key: "Access Key가 맞지 않아요. .dev.vars 의 UPBIT_ACCESS_KEY 를 다시 확인하세요.",
  jwt_verification: "Secret Key가 맞지 않아요. .dev.vars 의 UPBIT_SECRET_KEY 를 다시 확인하세요.",
  expired_access_key: "API 키가 만료됐어요. 업비트에서 새로 발급하세요.",
  out_of_scope: "이 키에 '자산 조회' 권한이 없어요. 업비트 Open API 관리에서 권한을 켜세요.",
  nonce_used: "같은 요청이 겹쳤어요. 잠시 뒤 다시 눌러주세요.",
};

function readKeys(root: string) {
  const file = path.join(root, ".dev.vars");
  if (!existsSync(file)) return null;
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const access = vars.UPBIT_ACCESS_KEY;
  const secret = vars.UPBIT_SECRET_KEY;
  return access && secret ? { access, secret } : null;
}

/** 업비트 인증 토큰 (JWT HS256). 쿼리 없는 GET 이라 query_hash 는 필요 없다 */
function token(access: string, secret: string) {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ access_key: access, nonce: randomUUID() })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

type Account = { currency: string; balance: string; locked: string; avg_buy_price: string; unit_currency: string };

async function balance(keys: { access: string; secret: string }) {
  const res = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${token(keys.access, keys.secret)}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const name: string = data?.error?.name ?? "";
    throw new Error(ERROR_HINT[name] ?? `업비트 응답 오류 (${res.status}${name ? ` · ${name}` : ""})`);
  }
  const accounts = data as Account[];

  // 원화마켓에 있는 코인만 현재가 조회 (공개 API)
  const coins = accounts.filter((a) => a.currency !== "KRW");
  const markets = new Set<string>(
    ((await (await fetch(`${API}/market/all`)).json()) as { market: string }[]).map((m) => m.market),
  );
  const wanted = coins.map((a) => `KRW-${a.currency}`).filter((m) => markets.has(m));
  const prices = new Map<string, number>();
  if (wanted.length) {
    const tickers = (await (await fetch(`${API}/ticker?markets=${wanted.join(",")}`)).json()) as {
      market: string;
      trade_price: number;
    }[];
    for (const t of tickers) prices.set(t.market, t.trade_price);
  }

  const krw = accounts.find((a) => a.currency === "KRW");
  const cash = krw ? Number(krw.balance) + Number(krw.locked) : 0;
  const assets = coins
    .map((a) => {
      const qty = Number(a.balance) + Number(a.locked);
      const avg = Number(a.avg_buy_price);
      const price = prices.get(`KRW-${a.currency}`) ?? null;
      const value = price === null ? null : qty * price;
      const cost = qty * avg;
      return {
        currency: a.currency,
        qty,
        avg,
        price,
        value,
        cost,
        pnl: value === null ? null : value - cost,
        pnlPct: value === null || cost === 0 ? null : (value / cost - 1) * 100,
      };
    })
    .filter((a) => a.qty > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const coinValue = assets.reduce((s, a) => s + (a.value ?? 0), 0);
  const coinCost = assets.reduce((s, a) => s + (a.value === null ? 0 : a.cost), 0);
  return {
    ok: true,
    at: new Date().toISOString(),
    cash,
    coinValue,
    total: cash + coinValue,
    pnl: coinValue - coinCost,
    pnlPct: coinCost ? (coinValue / coinCost - 1) * 100 : null,
    assets,
  };
}

export function upbit(): Plugin {
  return {
    name: "upbit-balance",
    enforce: "pre",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;

      server.middlewares.use("/api/upbit", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };

        // 내 화면(같은 주소)에서 온 요청만 받는다 — 다른 사이트가 잔고를 못 읽게
        if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { ok: false, error: "허용되지 않은 요청" });
        if (req.method !== "GET") return send(405, { ok: false, error: "조회(GET)만 됩니다. 주문 기능은 없어요." });

        const keys = readKeys(root);
        const route = (req.url ?? "/").split("?")[0];

        if (route === "/status") return send(200, { configured: Boolean(keys) });
        if (route !== "/balance") return send(404, { ok: false, error: "없는 주소" });
        if (!keys) {
          return send(400, { ok: false, error: ".dev.vars 에 UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY 가 없어요." });
        }
        try {
          send(200, await balance(keys));
        } catch (error) {
          send(502, { ok: false, error: (error as Error).message });
        }
      });
    },
  };
}
