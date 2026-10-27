"use client";

/**
 * 연출만 하던 팀들의 진짜 일. 자동 운영(app/autopilot.ts)이 하루 단계에 맞춰 부른다.
 *
 *   ③ 시세 데이터팀(brand)   실시간 시세가 들어오는지 점검 + 24시간 변동 보고 → 정상이면 "완료"
 *   ③ 거래소 연동팀(partner) 업비트 공개 API 응답·투자유의 점검 (주문 기능은 없음)
 *   ⑨ 개발팀(strategy2)      결재된 전략이 모의투자 엔진에 실제로 들어갔는지 확인
 *   ⑩ 대시보드팀(carousel)   모의투자 가상 자산 추이 정리 (그래프는 📝 paper.trade 패널)
 *
 * 전략 설계팀(조합 설계)·AI 모델팀(과적합 검사)은 전략 탐색과 붙어 있어 autopilot.ts 안에 있다.
 * 엔진(app/game/)은 고치지 않고 deptStatus 와 대사·채팅만 바꾼다.
 */
import { AUTOPILOT } from "../company.config";
import { notifyOnce } from "./autopilot";
import { coinLabel } from "./backtestLink";
import type { Company } from "./game/sim";
import { getPaper, refreshPaper, strategyText, type PaperStrategy } from "./paperLink";
import { signedPct, won } from "./upbitLink";

type Market = {
  ok: boolean;
  error?: string;
  market: string;
  name: string;
  listed: boolean;
  price: number;
  change24h: number;
  volume24h: number;
  tradedAt: string;
  responseMs: number;
  warning: boolean;
  cautions: string[];
};

/** 업비트 투자유의 세부 항목 → 쉬운 말 */
const CAUTION: Record<string, string> = {
  PRICE_FLUCTUATIONS: "가격 급등락",
  TRADING_VOLUME_SOARING: "거래량 급등",
  DEPOSIT_AMOUNT_SOARING: "입금량 급등",
  GLOBAL_PRICE_DIFFERENCES: "해외 가격 차이",
  CONCENTRATION_OF_SMALL_ACCOUNTS: "소수 계정 집중",
};

const lead = (engine: Company, dept: string) => engine.agents.find((a) => a.deptId === dept && a.rank === "lead");
const onDuty = (engine: Company, dept: string) => {
  const a = lead(engine, dept);
  return a && a.status !== "출근 전" && a.status !== "출근 중" ? a : null;
};
const who = (engine: Company, dept: string, team: string) => `${lead(engine, dept)?.name ?? team} · ${team}`;

/** 오늘 점검할 코인 — 모의투자 중인 코인, 없으면 타겟 코인 첫 번째 */
const watchMarket = () => getPaper()?.strategy?.market ?? AUTOPILOT.coins[0];

async function market(code: string): Promise<Market> {
  try {
    return await (await fetch(`/api/paper/market?market=${code}`)).json();
  } catch (e) {
    return { ok: false, error: `서버에 닿지 못했어요: ${String(e)}` } as Market;
  }
}

// ── ③ 시세 데이터팀 ─────────────────────────────────────
export async function checkLivePrice(engine: Company) {
  const code = watchMarket();
  const name = who(engine, "brand", "시세 데이터팀");
  engine.deptStatus.brand = "진행 중";
  const [m] = await Promise.all([market(code), refreshPaper(engine)]);
  const paper = getPaper();

  if (!m.ok) {
    engine.deptStatus.brand = "연동 대기";
    engine.pushChat("staff", name, `실시간 시세를 못 받았어요. 없는 숫자는 만들지 않을게요.\n${m.error}`);
    engine.pushLog("🧬", "시세 데이터팀: 실시간 시세 점검 실패", "pink");
    notifyOnce(`live-fail:${m.error}`, "bad", "실시간 시세 점검 실패", m.error ?? "알 수 없는 오류");
    return;
  }

  // 모의투자 엔진이 최근 2분 안에 시세를 받았는지
  const age = paper?.live.priceAt ? (Date.now() - Date.parse(paper.live.priceAt)) / 1000 : null;
  const engineLine = !paper?.strategy
    ? "모의투자 엔진: 아직 전략이 없어 시세를 받기 전이에요."
    : paper.live.error
      ? `모의투자 엔진: ⚠️ ${paper.live.error}`
      : age !== null && age < 120
        ? `모의투자 엔진: ${Math.round(age)}초 전에 시세 받음 (정상)`
        : "모의투자 엔진: 시세가 2분 넘게 안 들어왔어요.";

  engine.deptStatus.brand = "완료";
  engine.pushChat(
    "staff",
    name,
    `업비트 실시간 시세 점검했어요.\n${coinLabel(code)} ${won(m.price)} (24시간 ${signedPct(m.change24h)})\n24시간 거래대금 ${won(m.volume24h)}\n${engineLine}`,
  );
  engine.pushLog("🧬", `시세 데이터팀: ${coinLabel(code)} ${won(m.price)} · 24h ${signedPct(m.change24h)}`, "mint");
  const bora = onDuty(engine, "brand");
  if (bora) engine.say(bora, `${coinLabel(code)} ${signedPct(m.change24h)}!`, 3);
}

// ── ③ 거래소 연동팀 ─────────────────────────────────────
export async function checkExchange(engine: Company) {
  const code = watchMarket();
  const name = who(engine, "partner", "거래소 연동팀");
  engine.deptStatus.partner = "진행 중";
  const m = await market(code);

  if (!m.ok) {
    engine.deptStatus.partner = "연동 대기";
    engine.pushChat("staff", name, `업비트 공개 API 점검이 막혔어요.\n${m.error}`);
    engine.pushLog("🔌", "거래소 연동팀: 업비트 공개 API 점검 실패", "pink");
    notifyOnce(`exchange-fail:${m.error}`, "bad", "업비트 공개 API 점검 실패", m.error ?? "알 수 없는 오류");
    return;
  }

  const cautions = m.cautions.map((c) => CAUTION[c] ?? c);
  const lines = [
    `업비트 공개 API 응답 ${m.responseMs}ms${m.responseMs > 2000 ? " (느려요)" : " (정상)"}`,
    !m.listed
      ? `⚠️ ${code} 를 업비트 원화마켓에서 못 찾았어요 (상장 폐지 확인 필요)`
      : m.warning || cautions.length
        ? `⚠️ ${m.name}: 투자유의/주의 지정${cautions.length ? ` — ${cautions.join(", ")}` : ""}`
        : `${m.name}: 투자유의·주의 지정 없음`,
    "주문 기능은 일부러 없어요. 지금은 모의투자만 해요.",
  ];
  engine.deptStatus.partner = "완료";
  engine.pushChat("staff", name, `거래소 점검했어요. (조회만)\n${lines.join("\n")}`);
  engine.pushLog("🔌", `거래소 연동팀: API ${m.responseMs}ms · ${m.warning || cautions.length ? "유의 지정 있음" : "유의 지정 없음"}`, "mint");
  if (!m.listed || m.warning || cautions.length) {
    notifyOnce(`market-warn:${lines[1]}`, "warn", `${m.name} 거래 유의 신호`, lines[1].replace(/^⚠️ /, ""));
  }
}

// ── ⑨ 개발팀 ───────────────────────────────────────────
export async function verifyImplementation(engine: Company, approved: PaperStrategy | null) {
  const name = who(engine, "strategy2", "개발팀");
  await refreshPaper(engine);
  // 전략을 막 넣었으면 서버가 시세를 받아 첫 계산을 할 때까지 기다린다 (서버는 30초마다 확인)
  for (let i = 0; i < 8; i++) {
    const p = getPaper();
    if (!p?.strategy || p.live.fastMa != null || p.live.error) break;
    await new Promise((r) => setTimeout(r, 5_000));
    await refreshPaper(engine);
  }
  const s = getPaper();
  const same = (a: PaperStrategy | null | undefined) =>
    Boolean(a && approved && a.market === approved.market && a.interval === approved.interval && a.fast === approved.fast && a.slow === approved.slow && a.stop === approved.stop);

  let lines: string[];
  let ok = true;
  if (!s) {
    lines = ["모의투자 엔진 상태를 못 읽었어요."];
    ok = false;
  } else if (!approved) {
    lines = [
      "오늘은 새로 결재된 전략이 없어요.",
      s.strategy ? `기존 전략 계속: ${strategyText(s.strategy)} (${s.running ? "실행 중" : "멈춤"})` : "모의투자 엔진에 전략이 없어요.",
    ];
  } else if (same(s.strategy)) {
    lines = [`결재 전략이 모의투자 엔진에 적용된 것 확인했어요: ${strategyText(approved)}`, s.running ? "엔진 상태: 실행 중" : "엔진 상태: ⚠️ 멈춤 — 패널에서 다시 시작해야 해요"];
    ok = s.running;
  } else if (same(s.pending)) {
    lines = [`결재 전략은 대기 중이에요: ${strategyText(approved)}`, "지금 가상으로 들고 있는 코인을 판 뒤에 자동으로 바뀌어요."];
  } else {
    lines = [`⚠️ 결재 전략(${strategyText(approved)})이 엔진에 안 들어갔어요.`, "📝 paper.trade 패널의 'TOP1 적용' 버튼으로 다시 넣어 주세요."];
    ok = false;
  }
  if (s?.live.fastMa != null && s.live.slowMa != null) {
    lines.push(`신호 계산 정상: 단기 ${won(s.live.fastMa)} / 장기 ${won(s.live.slowMa)} → ${s.live.wantLong ? "사고 싶음" : "관망"}`);
  } else if (s?.strategy) {
    lines.push(`⚠️ 신호 계산이 안 되고 있어요${s.live.error ? `: ${s.live.error}` : ""}`);
    ok = false;
  }

  engine.pushChat("staff", name, `모의투자 엔진 적용 점검이에요.\n${lines.join("\n")}`);
  engine.pushLog("🛠️", `개발팀: 모의투자 적용 점검 ${ok ? "정상" : "문제 있음"}`, ok ? "mint" : "pink");
  if (!ok) notifyOnce(`verify:${lines.join("|")}`, "warn", "모의투자 적용 점검에서 문제 발견", lines.join(" / "));
}

// ── ⑩ 대시보드팀 ───────────────────────────────────────
export async function updateDashboard(engine: Company) {
  const name = who(engine, "carousel", "대시보드팀");
  await refreshPaper(engine);
  const s = getPaper();
  if (!s?.strategy || !s.daily.length) {
    engine.pushChat("staff", name, "아직 모의투자 기록이 없어서 그래프는 비어 있어요. 내일부터 하루 한 점씩 쌓여요.");
    engine.pushLog("📊", "대시보드팀: 모의투자 기록 없음", "lav");
    return;
  }
  const values = s.daily.map(([, v]) => v);
  const week = values.slice(-8); // 오늘 포함 최근 7일 변화
  const weekChange = week.length > 1 ? (week[week.length - 1] / week[0] - 1) * 100 : null;
  const best = Math.max(...values);
  const lines = [
    `모의투자 가상 자산 그래프 갱신 (${s.daily.length}일치) — 📝 paper.trade 패널`,
    `지금 ${won(s.equity)} · 시작 대비 ${signedPct(s.returnPct)}`,
    weekChange !== null ? `최근 ${week.length - 1}일 변화 ${signedPct(weekChange)}` : "",
    `최고점 ${won(best)} · 최대 낙폭 ${s.maxDrawdown.toFixed(1)}%`,
  ].filter(Boolean);
  engine.pushChat("staff", name, lines.join("\n"));
  engine.pushLog("📊", `대시보드팀: 가상 자산 ${s.daily.length}일치 그래프 갱신`, "mint");
}
