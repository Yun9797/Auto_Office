"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BacktestPanel from "./BacktestPanel";
import BalancePanel from "./BalancePanel";
import AlertsPanel from "./AlertsPanel";
import HistoryPanel from "./HistoryPanel";
import PaperPanel from "./PaperPanel";
import {
  askNotifyPermission,
  checkDue,
  describe,
  endDuty,
  getAutopilot,
  markReported,
  newDay,
  onPhase,
  reportDue,
  runCheckCycle,
  startDuty,
  useAutopilot,
} from "./autopilot";
import { fetchBalance, isBalanceOrder, signedPct, useUpbit } from "./upbitLink";
import { refreshPaper, usePaper } from "./paperLink";
import { withTrading } from "./tradingReport";
import { isBacktestOrder, parseBacktestOrder, runBacktest, VERDICT_LABEL } from "./backtestLink";
import OfficeWorld from "./game/OfficeWorld";
import {
  buildReport,
  fetchIntegrations,
  publish,
  type IntegrationStatus,
  type PublishResult,
} from "./game/report";
import { Company, PHASES, type Agent, type DeptStatus, type Snapshot } from "./game/sim";
import { CEO, DEPT_BRIEF, DEPT_LEAD, STAFF } from "./game/staff";
import { DEPT_ROOMS } from "./game/world";
import { AUTOPILOT, COMPANY, STORAGE_LINK } from "../company.config";

type View = "live" | "dashboard";

const statusClass: Record<DeptStatus, string> = {
  "완료": "done",
  "진행 중": "working",
  "승인 대기": "approval",
  "연동 대기": "blocked",
  "대기": "waiting",
};

/** 링크만 걸려 있는 항목 (서버 연동과 무관) */
const integrations2Static = STORAGE_LINK
  ? [{ name: "결과물 보관함", status: "링크 연결", tone: "mint", href: STORAGE_LINK }]
  : [];

function PixelEmployee({ hair, shirt, accent }: { hair: string; shirt: string; accent: string }) {
  const style = {
    "--pixel-hair": hair,
    "--pixel-shirt": shirt,
    "--pixel-accent": accent,
  } as CSSProperties;
  return (
    <span className="pixel-employee" style={style} aria-hidden="true">
      <i className="pixel-shadow" />
      <i className="pixel-legs" />
      <i className="pixel-body" />
      <i className="pixel-arm left" />
      <i className="pixel-arm right" />
      <i className="pixel-face">
        <b className="pixel-eyes" />
      </i>
      <i className="pixel-hair" />
      <i className="pixel-headset" />
    </span>
  );
}

export default function Home() {
  const [engine] = useState(() => new Company());
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());
  const [view, setView] = useState<View>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [briefing, setBriefing] = useState(false);
  const [filter, setFilter] = useState<"전체" | DeptStatus>("전체");
  const [toast, setToast] = useState("");
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [publishState, setPublishState] = useState<{ busy: boolean; result: PublishResult | null; error: string }>({
    busy: false,
    result: null,
    error: "",
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    // 한 번에 큰 시간이 흘러도 엔진은 짧은 걸음(0.05초)으로 나눠 따라잡는다
    const advance = (now: number) => {
      let dt = Math.min((now - last) / 1000, 120);
      last = now;
      acc += dt;
      while (dt > 0) {
        engine.tick(Math.min(dt, 0.05));
        dt -= 0.05;
      }
      if (acc >= 0.18) {
        acc = 0;
        setSnap(engine.snapshot());
      }
    };
    const loop = (now: number) => {
      advance(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // 탭을 숨겨도 자동 운영이 멈추지 않게: 숨김 상태에선 화면 갱신(rAF)이 멈추므로 타이머로 계속 돌린다
    const bg = window.setInterval(() => {
      // 화면 갱신이 0.5초 넘게 멈춰 있으면(탭 숨김·창 최소화) 대신 돌린다
      if (performance.now() - last > 500) advance(performance.now());
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(bg);
    };
  }, [engine]);

  useEffect(() => {
    engine.setBriefingHandler(() => setBriefing(true));
    return () => engine.setBriefingHandler(null);
  }, [engine]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const onSelect = useCallback((agent: Agent) => setSelectedId(agent.id), []);

  // 연동 설정 여부를 서버에서 받아온다 (값이 아니라 설정 여부만)
  useEffect(() => {
    fetchIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
  }, []);

  const sendReport = useCallback(
    async (auto: boolean) => {
      setPublishState((state) => ({ ...state, busy: true, error: "" }));
      try {
        // 보고 직전에 모의투자 최신 상태를 받아 매매 결과를 덧붙인다
        await refreshPaper(null);
        const result = await publish(withTrading(buildReport(engine.snapshot())));
        setPublishState({ busy: false, result, error: "" });

        const parts: string[] = [];
        parts.push(result.notion.ok ? "Notion 저장 완료" : `Notion ${result.notion.detail ?? "실패"}`);
        parts.push(result.discord.ok ? "Discord 전송 완료" : `Discord ${result.discord.detail ?? "실패"}`);
        engine.pushLog(
          result.notion.ok && result.discord.ok ? "📤" : "⚠️",
          `완료 보고 발행 — ${parts.join(" / ")}`,
          result.notion.ok && result.discord.ok ? "mint" : "lav",
        );
        engine.pushChat("staff", "김세리", `보고서 발행 결과입니다.\n· ${parts.join("\n· ")}`);
        if (!auto) showToast(result.notion.ok || result.discord.ok ? "보고서를 발행했어요" : "발행 실패 — 연동 설정 필요");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPublishState({ busy: false, result: null, error: message });
        engine.pushLog("⚠️", `완료 보고 발행 실패 — ${message}`, "lav");
        if (!auto) showToast("발행 실패 — 연동 설정을 확인해주세요");
      }
    },
    [engine, showToast],
  );

  // 자동 운영: 하루 단계가 바뀔 때마다 진짜 일을 끼워 넣는다
  useEffect(() => {
    onPhase(engine, snap);
  }, [engine, snap]);

  // 근무 중(출근 ~ 퇴근 버튼): 정기 점검(기본 1시간)·보고서 발행(기본 6시간)을 알아서 — 탭을 숨겨도 30초마다 확인
  useEffect(() => {
    const id = window.setInterval(() => {
      if (checkDue(engine.snapshot())) void runCheckCycle(engine);
      if (reportDue()) {
        markReported();
        void sendReport(true);
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [engine, sendReport]);

  const askAgent = useCallback(
    (agent: Agent) => {
      engine.command(`${agent.name} 지금 뭐해?`);
      setSelectedId(null);
      showInRail("command", "ceo-console");
    },
    [engine],
  );

  const start = () => {
    if (getAutopilot().onDuty) return; // 근무 중에는 정기 점검이 알아서 돈다
    newDay();
    startDuty();
    void askNotifyPermission();
    engine.start();
    setBriefing(false);
    setView("live");
    showToast(
      `출근! 퇴근 버튼 전까지 ${AUTOPILOT.checkEveryHours}시간마다 점검하고, 보고서는 ${AUTOPILOT.reportEveryHours}시간마다 올려요 📈`,
    );
  };

  const goHome = () => {
    endDuty(engine);
    engine.reset();
    setBriefing(false);
    showToast("퇴근했어요 🌙 모의투자는 서버에서 계속 돌아가요");
  };

  const approve = () => {
    engine.approve();
    showToast("승인 완료! 개발팀이 바로 구현해요");
  };

  const teams = useMemo(
    () =>
      DEPT_ROOMS.map((room) => {
        const lead = DEPT_LEAD[room.id];
        const status = snap.deptStatus[room.id] ?? "대기";
        return {
          id: room.id,
          icon: room.icon,
          name: room.name,
          room: room.short,
          lead,
          status,
          ...DEPT_BRIEF[room.id],
        };
      }),
    [snap.deptStatus],
  );

  const filteredTeams = filter === "전체" ? teams : teams.filter((team) => team.status === filter);
  const selected = selectedId ? engine.agentById.get(selectedId) ?? null : null;
  const todo = snap.approvalPending ? 1 : 0;
  const onDuty = engine.agents.filter((a) => a.status !== "출근 전").length;

  return (
    <main className="page-shell">
      <div className="wrap">
        <nav className="app-nav" aria-label="AI Company 화면 전환">
          <div className="brand-chip">
            <span>{COMPANY.logoLetter}</span>
            <b>{COMPANY.name}</b>
          </div>
          <div className="nav-tabs">
            <button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>
              🎮 라이브 오피스
            </button>
            <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
              📊 대시보드
            </button>
            <button
              className={`todo-tab ${todo ? "urgent" : ""}`}
              onClick={() => {
                setView("live");
                showInRail("command", "ceo-approval");
              }}
            >
              📋 대표 할 일 <i>{todo}</i>
            </button>
          </div>
        </nav>

        {view === "live" ? (
          <LiveView
            engine={engine}
            snap={snap}
            follow={follow}
            setFollow={setFollow}
            selectedId={selectedId}
            onSelect={onSelect}
            onStart={start}
            onGoHome={goHome}
            onApprove={approve}
            onDuty={onDuty}
            onPublish={() => void sendReport(false)}
            publishBusy={publishState.busy}
            publishResult={publishState.result}
            reportsUrl={(integrations?.notion as { url?: string } | undefined)?.url}
          />
        ) : (
          <DashboardView
            teams={teams}
            filteredTeams={filteredTeams}
            filter={filter}
            setFilter={setFilter}
            snap={snap}
            onStart={start}
            onApprove={approve}
            onSelect={(id) => setSelectedId(id)}
            integrations={integrations}
            publishResult={publishState.result}
          />
        )}

        <footer>
          이 툴은 갓생맘 🎀이 만들었어요
          <br />
          <a href="https://www.instagram.com/godseng.mom/" target="_blank" rel="noreferrer">
            📷 @godseng.mom — 더 많은 크리에이터 툴 보러가기 →
          </a>
          <br />© godseng.mom · 자유롭게 쓰되 무단 재판매 금지
        </footer>
      </div>

      {selected ? (
        <ProfileModal
          agent={selected}
          onClose={() => setSelectedId(null)}
          onAsk={(agent) => {
            setView("live");
            askAgent(agent);
          }}
        />
      ) : null}
      {briefing ? <BriefingModal snap={snap} onClose={() => setBriefing(false)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast}
      </div>
    </main>
  );
}

function LiveView({
  engine,
  snap,
  follow,
  setFollow,
  selectedId,
  onSelect,
  onStart,
  onGoHome,
  onApprove,
  onDuty,
  onPublish,
  publishBusy,
  publishResult,
  reportsUrl,
}: {
  engine: Company;
  snap: Snapshot;
  follow: boolean;
  setFollow: (value: boolean) => void;
  selectedId: string | null;
  onSelect: (agent: Agent) => void;
  onStart: () => void;
  onGoHome: () => void;
  onApprove: () => void;
  onDuty: number;
  onPublish: () => void;
  publishBusy: boolean;
  publishResult: PublishResult | null;
  reportsUrl?: string;
}) {
  const ap = useAutopilot();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  // 다음 정기 보고까지 남은 시간 게이지 — 보고 간격 중 지난 만큼 차오른다
  const reportMs = AUTOPILOT.reportEveryHours * 3600_000;
  const reportLeft = ap.onDuty && ap.nextReportAt ? Math.max(0, ap.nextReportAt - now) : null;
  const reportFill = reportLeft === null ? 0 : Math.round(((reportMs - reportLeft) / reportMs) * 100);
  const top = ap.pick ?? ap.passed[0];
  const paper = usePaper().status;
  const urgentAlerts = ap.alerts.filter((a) => a.level === "bad" || a.level === "warn").length;

  // 오른쪽 탭 — 마지막으로 본 탭을 기억 (저장이 막힌 브라우저면 그냥 첫 탭)
  const [railTab, setRailTab] = useState<RailTab>("command");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rail-tab");
      if (RAIL_TABS.some((t) => t.id === saved)) setRailTab(saved as RailTab);
    } catch {
      /* 무시 */
    }
    const open = (e: Event) => setRailTab((e as CustomEvent<RailTab>).detail);
    window.addEventListener("rail-tab", open);
    return () => window.removeEventListener("rail-tab", open);
  }, []);
  const pickRailTab = (id: RailTab) => {
    setRailTab(id);
    try {
      localStorage.setItem("rail-tab", id);
    } catch {
      /* 무시 */
    }
  };

  return (
    <>
      <header className="live-hero">
        <div>
          <p className="eyebrow">LIVE TRADING DESK · 32 AI AGENTS · BACKTEST LINKED</p>
          <h1>
            {COMPANY.titlePrefix} <em className="highlight">{COMPANY.titleAccent}</em>
          </h1>
          <p>모의투자 점검 → 전략 설계 → 백테스트 검증 → 개발 → 운영까지, AI 팀이 자동매매 프로그램을 만들고 대표실로 보고합니다.</p>
        </div>
        <div className="live-clock">
          <span>SEOUL</span>
          <SeoulClock />
          {/* 출근 장면 중에는 장면 단계, 그 뒤로는 자동 운영이 실제로 하고 있는 일 */}
          <small>{snap.running ? snap.phase : ap.onDuty ? ap.step : ap.step === "퇴근" ? "퇴근 · 모의투자는 계속" : "출근 전"}</small>
        </div>
      </header>

      <section className="live-bar">
        {ap.onDuty ? (
          <span className="duty-badge" title={ap.step}>
            🟢 근무 중{ap.cycles ? ` · 점검 ${ap.cycles}회` : ""}
          </span>
        ) : (
          <button className="btn btn-primary" onClick={onStart}>
            오늘 업무 시작하기
          </button>
        )}
        {ap.onDuty ? (
          <button
            className="btn btn-ghost"
            onClick={onGoHome}
            title={`퇴근하면 근무와 ${AUTOPILOT.reportEveryHours}시간 정기 보고가 멈춰요. 모의투자는 서버에서 계속 돌아가요.`}
          >
            🌙 퇴근
          </button>
        ) : null}
        {ap.onDuty && ap.nextCheckAt ? (
          <span className="next-report" title="잔고·모의투자·시세·전략 탐색·과적합 검사·적용 확인을 한 바퀴 돌아요">
            다음 점검 {hm(ap.nextCheckAt)}
          </span>
        ) : null}
        <button className="btn btn-ghost" onClick={() => engine.togglePause()}>
          {snap.paused ? "▶ 재생" : "⏸ 일시정지"}
        </button>
        <div className="speed-group" role="group" aria-label="건너뛰기">
          <button
            className={`skip ${snap.turbo ? "on" : ""}`}
            onClick={() => engine.skipToDecision()}
            disabled={!snap.running || snap.approvalPending}
            title="대표님이 결정할 일이 생길 때까지 사무실 장면을 단숨에 건너뜁니다 (실제 탐색·모의투자 속도와는 무관)"
          >
            {snap.turbo ? "건너뛰는 중…" : "⏭ 결정까지"}
          </button>
        </div>
        <button className={`btn btn-ghost ${follow ? "on" : ""}`} onClick={() => setFollow(!follow)}>
          🎥 자동 추적 {follow ? "ON" : "OFF"}
        </button>
        <button
          className={`btn btn-ghost publish-btn ${publishResult?.notion.ok || publishResult?.discord.ok ? "sent" : ""}`}
          onClick={onPublish}
          disabled={publishBusy}
          title="완료 보고를 Notion에 저장하고 같은 내용을 Discord로 보냅니다"
        >
          {publishBusy ? "발행 중…" : "📤 보고 발행"}
        </button>
        {reportsUrl ? (
          <a
            className="btn btn-ghost"
            href={reportsUrl}
            target="_blank"
            rel="noreferrer"
            title="지금까지 발행된 보고서가 쌓인 Notion '일일 보고서' 표를 새 탭으로 열어요"
          >
            📒 보고서 보기
          </a>
        ) : (
          <button className="btn btn-ghost" disabled title="Notion 연동(.dev.vars 의 NOTION_TOKEN · NOTION_BRIEFING_DB)을 설정하면 열 수 있어요">
            📒 보고서 보기
          </button>
        )}
        <div
          className="live-progress"
          title={`근무 중에는 ${AUTOPILOT.reportEveryHours}시간마다 노션·디스코드로 보고서를 자동 발행해요. 게이지가 다 차면 발행!`}
        >
          <span>
            {reportLeft === null
              ? "📤 다음 보고 · 출근하면 시작"
              : `📤 다음 보고까지 ${left(reportLeft)} (${hm(ap.nextReportAt!)})`}
          </span>
          <i>
            <b style={{ width: `${reportFill}%` }} />
          </i>
        </div>
        <div className="live-counts">
          <span className="lc on-duty">근무 {onDuty}</span>
          <span className="lc done">완료 {snap.stats.done}</span>
          <span className="lc working">진행 {snap.stats.working}</span>
          <span className="lc blocked">연동대기 {snap.stats.blocked}</span>
        </div>
      </section>

      <section className="live-grid">
        <OfficeWorld engine={engine} snap={snap} selectedId={selectedId} follow={follow} onSelect={onSelect} />

        <aside className="live-rail">
          <nav className="rail-tabs" role="tablist" aria-label="오른쪽 패널">
            {RAIL_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={railTab === t.id}
                className={railTab === t.id ? "on" : ""}
                onClick={() => pickRailTab(t.id)}
              >
                {t.label}
                {t.id === "command" && (snap.approvalPending || urgentAlerts > 0) ? <i className="rail-dot" /> : null}
                {t.id === "trade" && paper?.strategy && paper.returnPct !== null ? (
                  <small className={paper.returnPct >= 0 ? "up" : "down"}>{signedPct(paper.returnPct)}</small>
                ) : null}
              </button>
            ))}
          </nav>

          {/* 숨긴 탭도 그대로 살려 둔다 — 모의투자·잔고 갱신과 알림이 멈추지 않게 */}
          <div className="rail-pane" role="tabpanel" hidden={railTab !== "command"}>
          <AlertsPanel />

          <CeoConsole engine={engine} snap={snap} />

          <section className="win rail-card" id="ceo-approval">
            <div className="win-bar">
              <span>✅ ceo.approval</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className={`win-body approval-body ${snap.approvalPending ? "pending" : ""}`}>
              {snap.approvalPending ? (
                <>
                  <div className="approval-top">
                    <span className="mini-badge yellow">{top ? "결재 전략 · 오늘 탐색 + 과적합 검사" : "결재 전략 · 탐색 결과 기다리는 중"}</span>
                    <span className="score blink">결재 대기</span>
                  </div>
                  <h3>{top ? describe(top) : "검증·리스크팀이 조합을 돌리는 중이에요"}</h3>
                  <p>{ap.enabled ? "자동 운영 중 — 전략 탐색이 끝나면 자동으로 결재돼요." : "회의실에서 최아름·한도빈·김세리가 대표님 결재를 기다리고 있어요."}</p>
                  <div className="reason-list">
                    <span>① 백테스트 검증 통과</span>
                    <span>② 손절 규칙 내장</span>
                    <span>③ 모의투자부터 시작</span>
                  </div>
                  <button className="btn approve-button" onClick={onApprove}>
                    이 전략 승인하기
                  </button>
                </>
              ) : (
                <>
                  <div className="approval-top">
                    <span className="mini-badge mint">{snap.approved ? "오늘 결재 완료" : "결재 대기 없음"}</span>
                  </div>
                  <h3>{snap.approved ? ap.approvedText ?? "승인하신 전략을 구현 중이에요" : "아직 올라온 안건이 없어요"}</h3>
                  <p>
                    {snap.approved
                      ? "대표 승인 이후 코드 구현 → 모델 학습 → 저장까지 이어집니다."
                      : "업무를 시작하면 전략 설계팀이 TOP 3 전략을 회의실로 올려요."}
                  </p>
                </>
              )}
            </div>
          </section>
          </div>

          <div className="rail-pane" role="tabpanel" hidden={railTab !== "trade"}>
            <PaperPanel engine={engine} />
            <BacktestPanel engine={engine} />
          </div>

          <div className="rail-pane" role="tabpanel" hidden={railTab !== "assets"}>
            <BalancePanel engine={engine} />
            <HistoryPanel />
          </div>

          <div className="rail-pane" role="tabpanel" hidden={railTab !== "status"}>
          <section className="win rail-card feed-card">
            <div className="win-bar">
              <span>📡 live.feed</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body feed-body">
              {snap.meetingTitle ? <div className="feed-now">💬 회의 진행 중 — {snap.meetingTitle}</div> : null}
              <ul className="feed-list">
                {snap.log.map((entry) => (
                  <li key={entry.id} className={entry.tone}>
                    <b>{entry.time}</b>
                    <i>{entry.icon}</i>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="win rail-card">
            <div className="win-bar">
              <span>👥 staff.roster</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body roster-body">
              {DEPT_ROOMS.map((room) => (
                <div className="roster-dept" key={room.id}>
                  <p>
                    <b>
                      {room.icon} {room.name}
                    </b>
                    <i className={`rm-dot ${statusClass[snap.deptStatus[room.id] ?? "대기"]}`} />
                  </p>
                  <div className="roster-chips">
                    {STAFF.filter((s) => s.deptId === room.id).map((seed) => {
                      const agent = engine.agentById.get(seed.id);
                      return (
                        <button
                          key={seed.id}
                          className={`roster-chip ${selectedId === seed.id ? "on" : ""}`}
                          onClick={() => agent && onSelect(agent)}
                        >
                          <i style={{ background: seed.shirt, borderColor: seed.hair }} />
                          {seed.name}
                          <small>{agent?.status ?? "출근 전"}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          </div>
        </aside>
      </section>
    </>
  );
}

const hm = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
/** 오른쪽 위 시계 — 사무실 장면 시간이 아니라 실제 한국 시간 */
function SeoulClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <b title="지금 한국 시간">
      {new Date(now).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })}
    </b>
  );
}

const left = (ms: number) => {
  const min = Math.ceil(ms / 60_000);
  if (min <= 0) return "곧";
  const h = Math.floor(min / 60);
  return h ? `${h}시간 ${min % 60}분` : `${min}분`;
};

const RAIL_TABS = [
  { id: "command", label: "🧭 지휘" },
  { id: "trade", label: "📝 매매" },
  { id: "assets", label: "💰 자산" },
  { id: "status", label: "📡 현황" },
] as const;
type RailTab = (typeof RAIL_TABS)[number]["id"];

/** 오른쪽 탭을 열고 그 안의 패널로 화면을 옮긴다 (숨은 탭 안에 있으면 이동이 안 되므로) */
function showInRail(tab: RailTab, elementId: string) {
  window.dispatchEvent(new CustomEvent<RailTab>("rail-tab", { detail: tab }));
  window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}

const QUICK_ORDERS = [
  { label: "백테스트", command: "백테스트 돌려줘" },
  { label: "잔고 확인", command: "업비트 잔고 알려줘" },
  { label: "현황 보고", command: "현황 보고해줘" },
  { label: "왜 늦어져?", command: "왜 늦어지고 있어?" },
  { label: "회의 소집", command: "전 부서 회의 소집" },
  { label: "지금 브리핑", command: "지금 브리핑 올라와" },
  { label: "집중 모드", command: "집중 모드" },
];

function CeoConsole({ engine, snap }: { engine: Company; snap: Snapshot }) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const count = snap.chat.length;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value) return;
    if (isBalanceOrder(value)) {
      engine.pushChat("ceo", "대표님", value);
      fetchBalance(engine, true);
    } else if (isBacktestOrder(value)) {
      engine.pushChat("ceo", "대표님", value);
      runBacktest(engine, parseBacktestOrder(value), true);
    } else {
      engine.command(value);
    }
    setDraft("");
  };

  return (
    <section className="win rail-card console-card" id="ceo-console">
      <div className="win-bar">
        <span title="대표 지시창">🎤 ceo.console</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body console-body">
        <div className="console-status">
          <span className={`mini-badge ${snap.focusMode ? "yellow" : "mint"}`}>
            {snap.focusMode ? "집중 모드 ON" : "평시 운영"}
          </span>
          {snap.busyWithOrder ? <span className="mini-badge lav">지시 처리 중…</span> : null}
        </div>

        <div className="console-log" ref={logRef}>
          {snap.chat.map((entry) => (
            <div key={entry.id} className={`console-line ${entry.from}`}>
              <b>{entry.from === "ceo" ? "대표님" : entry.name}</b>
              <p>{entry.text}</p>
              <small>{entry.time}</small>
            </div>
          ))}
        </div>

        <div className="console-quick">
          {QUICK_ORDERS.map((item) => (
            <button key={item.label} onClick={() => send(item.command)}>
              {item.label}
            </button>
          ))}
        </div>

        <form
          className="console-input"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="예: 이더리움 4시간봉 백테스트 / 검증팀 지금 뭐해?"
            aria-label="대표 지시 입력"
          />
          <button type="submit">지시</button>
        </form>
      </div>
    </section>
  );
}

function ProfileModal({
  agent,
  onClose,
  onAsk,
}: {
  agent: Agent;
  onClose: () => void;
  onAsk: (agent: Agent) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="win team-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} 프로필`}
      >
        <div className="win-bar">
          <span>👤 employee_profile.exe</span>
          <button className="window-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="win-body employee-profile">
          <div className="profile-top">
            <PixelEmployee hair={agent.hair} shirt={agent.shirt} accent={agent.accent} />
            <div>
              <span className="status-pill working">{agent.status}</span>
              <h2>
                {agent.name}
                {agent.callsign ? <small> · {agent.callsign}</small> : null}
              </h2>
              <p>{agent.role}</p>
            </div>
          </div>
          <div className="profile-task">
            <span className="tiny-label">지금 하는 일</span>
            <strong>{agent.taskLabel}</strong>
            {agent.anim === "type" ? (
              <span className="profile-progress">
                <i style={{ width: `${Math.round(agent.progress * 100)}%` }} />
              </span>
            ) : null}
          </div>
          <div className="report-box">
            <span className="tiny-label">한마디</span>
            <strong>{agent.speech ?? agent.thoughts[0]}</strong>
          </div>
          <div className="profile-actions">
            <button className="btn btn-primary" onClick={() => onAsk(agent)}>
              🎤 지금 뭐 하는지 물어보기
            </button>
            <button className="text-button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BriefingModal({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="win team-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="김비서 브리핑"
      >
        <div className="win-bar">
          <span>📋 kim_secretary.brief</span>
          <button className="window-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="win-body">
          <p className="brief-date">{snap.clock} · 김세리 비서실장 최종 브리핑</p>
          <h3>대표님, 이번 점검이 정리됐어요.</h3>
          <ul>
            <li>
              <span className="dot green" />
              완료 {snap.stats.done}팀 — 감시·전략·검증·개발·학습·저장까지 마쳤어요
            </li>
            <li>
              <span className="dot green" />
              대표 승인 1건 반영 — TOP 1 전략 구현 완료
            </li>
            <li>
              <span className="dot gray" />
              연동 대기 {snap.stats.blocked}팀 — 외부 서비스 연결이 필요해요
            </li>
          </ul>
          <div className="decision-box">
            <span className="tiny-label">오늘 대표님이 결정할 것</span>
            <strong>
              없습니다. 실전 전환은 모의투자 결과 보고 결정하세요. 퇴근 버튼을 누르기 전까지 자리를 지키고, 보고서는{" "}
              {AUTOPILOT.reportEveryHours}시간마다 올릴게요 📈
            </strong>
          </div>
          <button className="btn btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

type TeamRow = {
  id: string;
  icon: string;
  name: string;
  room: string;
  lead: (typeof DEPT_LEAD)[string];
  status: DeptStatus;
  task: string;
  report: string;
};

function DashboardView({
  teams,
  filteredTeams,
  filter,
  setFilter,
  snap,
  onStart,
  onApprove,
  onSelect,
  integrations,
  publishResult,
}: {
  teams: TeamRow[];
  filteredTeams: TeamRow[];
  filter: "전체" | DeptStatus;
  setFilter: (value: "전체" | DeptStatus) => void;
  snap: Snapshot;
  onStart: () => void;
  onApprove: () => void;
  onSelect: (id: string) => void;
  integrations: IntegrationStatus | null;
  publishResult: PublishResult | null;
}) {
  const ap = useAutopilot();
  const pick = ap.pick ?? ap.passed[0];
  const paper = usePaper().status;
  const upbitState = useUpbit();
  // 서버가 알려준 실제 설정 상태로 표시한다 (연결됐다고 거짓 보고하지 않는다)
  const liveRows = integrations
    ? [
        {
          name: "Notion 저장",
          status: publishResult?.notion.ok
            ? "저장 성공"
            : integrations.notion?.configured
              ? "키 설정됨"
              : "키 미설정",
          tone: publishResult?.notion.ok ? "mint" : integrations.notion?.configured ? "yellow" : "lav",
          href: "",
        },
        {
          name: "Discord 전송",
          status: publishResult?.discord.ok
            ? "전송 성공"
            : integrations.discord?.configured
              ? "웹훅 설정됨"
              : "웹훅 미설정",
          tone: publishResult?.discord.ok ? "mint" : integrations.discord?.configured ? "yellow" : "lav",
          href: "",
        },
        {
          name: "실시간 시세",
          status: !paper?.strategy
            ? "모의투자 시작 전 (결재 후 연결)"
            : paper.live.error
              ? `오류 — ${paper.live.error}`
              : paper.live.priceAt
                ? "업비트 공개 시세 · 30초마다 수신"
                : "확인 중",
          tone: paper?.strategy && paper.live.priceAt && !paper.live.error ? "mint" : "lav",
          href: "",
        },
        {
          name: "거래소 API",
          status: upbitState.configured ? "업비트 조회 전용 키 · 주문 기능 없음" : "미설정 (모의투자만)",
          tone: upbitState.configured ? "mint" : "lav",
          href: "",
        },
        {
          name: "계좌 내역",
          status: upbitState.balance?.ok ? "업비트 잔고 조회 성공" : (integrations.finance?.need ?? "자료 대기"),
          tone: upbitState.balance?.ok ? "mint" : "lav",
          href: "",
        },
      ]
    : [];
  const rows = [...integrations2Static, ...liveRows];

  return (
    <>
      <header className="win hero">
        <div className="win-bar">
          <span>📈 {COMPANY.windowLabel}</span>
          <span className="window-controls" aria-hidden="true">
            —　▢　✕
          </span>
        </div>
        <div className="hero-body">
          <div className="hero-copy">
            <p className="eyebrow">TODAY · 07:00 AUTO START</p>
            <h1>
              오늘 트레이딩 데스크가 어떻게 움직이는지 <em className="highlight">한눈에</em>
            </h1>
            <p>AI는 도구, 실전 결정은 대표님. 12개 팀 32명의 모의투자 감시부터 백테스트·개발·운영·브리핑까지 한 흐름으로 관리해요.</p>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onStart} disabled={ap.onDuty}>
              {ap.onDuty ? "AI 팀원들이 근무 중… (퇴근 버튼 전까지)" : "오늘 업무 시작하기"}
            </button>
            <span className="trust-copy">실제 주문·자금 이동은 하지 않아요. 실전 전환은 대표가 직접</span>
          </div>
        </div>
      </header>

      <section className="summary-grid" aria-label="오늘 업무 요약">
        <article className="metric yellow">
          <span>AI 직원</span>
          <strong>32</strong>
          <small>STAFF</small>
        </article>
        <article className="metric mint">
          <span>완료</span>
          <strong>{snap.stats.done}</strong>
          <small>DONE</small>
        </article>
        <article className="metric pink">
          <span>진행 중</span>
          <strong>{snap.stats.working}</strong>
          <small>WORKING</small>
        </article>
        <article className="metric lav">
          <span>대표 확인</span>
          <strong>{snap.stats.approval}</strong>
          <small>APPROVAL</small>
        </article>
        <article className="metric white">
          <span>연동 대기</span>
          <strong>{snap.stats.blocked}</strong>
          <small>WAITING</small>
        </article>
      </section>

      <section className="workspace">
        <aside className="side-stack">
          <section className="win">
            <div className="win-bar">
              <span>⚡ automation.status</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body">
              <div className="schedule-card">
                <div>
                  <span className="tiny-label">NEXT RUN</span>
                  <strong>매일 오전 7:00</strong>
                  <p>컴퓨터 지시 없이 하루 업무 시작</p>
                </div>
                <span className="toggle-on">ON</span>
              </div>
              <div className="flow-list">
                {PHASES.slice(1, 12).map((item, index) => (
                  <div className={`flow-row ${snap.phaseIndex > index + 1 ? "past" : ""}`} key={item}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{item}</b>
                    <i>{snap.phaseIndex === index + 1 ? "●" : snap.phaseIndex > index + 1 ? "✓" : "·"}</i>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="win">
            <div className="win-bar">
              <span>🔗 integrations.link</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body integration-list">
              {rows.map((item) =>
                item.href ? (
                  <a key={item.name} href={item.href} target="_blank" rel="noreferrer" className="integration-row">
                    <b>{item.name}</b>
                    <span className={`mini-badge ${item.tone}`}>{item.status}</span>
                  </a>
                ) : (
                  <div key={item.name} className="integration-row">
                    <b>{item.name}</b>
                    <span className={`mini-badge ${item.tone}`}>{item.status}</span>
                  </div>
                ),
              )}
            </div>
          </section>
        </aside>

        <div className="main-stack">
          <section className="win">
            <div className="win-bar">
              <span>🏢 team_office.board</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LIVE OFFICE</p>
                  <h2>12개 부서 · 팀장 12명 근무 현황</h2>
                </div>
                <div className="filter-tabs" role="group" aria-label="팀 상태 필터">
                  {(["전체", "진행 중", "완료", "승인 대기", "연동 대기"] as const).map((item) => (
                    <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="team-grid">
                {filteredTeams.map((team) => (
                  <button className="team-card" key={team.id} onClick={() => onSelect(team.lead.id)}>
                    <span className={`status-dot ${statusClass[team.status]}`} aria-hidden="true" />
                    <span className="mini-pixel">
                      <PixelEmployee hair={team.lead.hair} shirt={team.lead.shirt} accent={team.lead.accent} />
                    </span>
                    <span className="team-copy">
                      <b>
                        {team.lead.name} · {team.name}
                      </b>
                      <small>{team.task}</small>
                    </span>
                    <span className={`status-pill ${statusClass[team.status]}`}>{team.status}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="two-col">
            <section className="win">
              <div className="win-bar">
                <span>✅ ceo.approval</span>
                <span className="window-controls">—　▢　✕</span>
              </div>
              <div className="win-body approval-body">
                <div className="approval-top">
                  <span className="mini-badge yellow">결재 전략</span>
                  <span className="score">{pick ? VERDICT_LABEL[pick.verdict] : "탐색 전"}</span>
                </div>
                <h3>{pick ? describe(pick) : "오늘 전략 탐색 전이에요"}</h3>
                <p>
                  {pick
                    ? `단기 이평이 장기 이평을 넘으면 사고, 내려가면 팔아요. 산 값 대비 -${Math.round(pick.stop * 100)}%면 즉시 손절합니다.${ap.pickRobust ? ` 주변 조합 ${ap.pickRobust.ok}/${ap.pickRobust.total} 버팀.` : ""}`
                    : "출근하면 검증·리스크팀이 조합을 돌리고, AI 모델팀이 과적합 검사를 한 전략이 여기 올라와요."}
                </p>
                <button
                  className={`btn approve-button ${snap.approved ? "approved" : ""}`}
                  onClick={onApprove}
                  disabled={!snap.approvalPending}
                >
                  {snap.approved ? "승인 완료 · 개발팀 전달됨" : snap.approvalPending ? "이 전략 승인하기" : "대기 중인 안건 없음"}
                </button>
              </div>
            </section>

            <section className="win secretary">
              <div className="win-bar">
                <span>📋 kim_secretary.brief</span>
                <span className="window-controls">—　▢　✕</span>
              </div>
              <div className="win-body">
                <p className="brief-date">2026.07.26 · {snap.clock} 현재</p>
                <h3>{snap.dayComplete ? "대표님, 이번 점검이 정리됐어요." : "대표님, 현재 진행 상황이에요."}</h3>
                <ul>
                  <li>
                    <span className="dot green" />
                    {snap.phase} 진행 중 — 완료 {snap.stats.done}팀
                  </li>
                  <li>
                    <span className={`dot ${snap.approvalPending ? "yellow" : "green"}`} />
                    {snap.approvalPending ? "TOP 1 대표 확인 필요" : "대기 중인 결재 없음"}
                  </li>
                  <li>
                    <span className="dot gray" />
                    외부 서비스 연동 대기
                  </li>
                </ul>
                <div className="decision-box">
                  <span className="tiny-label">대표님이 오늘 결정할 1개</span>
                  <strong>
                    {snap.approvalPending
                      ? "TOP 1 전략을 구현할지 승인해주세요."
                      : snap.approved
                        ? "결정 완료! 개발팀이 다음 업무를 진행해요."
                        : "아직 올라온 안건이 없어요."}
                  </strong>
                </div>
              </div>
            </section>
          </section>
        </div>
      </section>

      <section className="win storage">
        <div className="win-bar">
          <span>📦 result_storage</span>
          <span className="window-controls">—　▢　✕</span>
        </div>
        <div className="win-body">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RECENT OUTPUTS</p>
              <h2>전략·리포트 보관함</h2>
            </div>
            {STORAGE_LINK ? (
              <a className="btn btn-small" href={STORAGE_LINK} target="_blank" rel="noreferrer">
                보관함 열기
              </a>
            ) : null}
          </div>
          <div className="result-table">
            <div className="result-row header">
              <span>결과물</span>
              <span>담당팀</span>
              <span>상태</span>
              <span>바로가기</span>
            </div>
            <div className="result-row">
              <b>BTC 추세추종 백테스트 리포트</b>
              <span>검증·리스크팀</span>
              <span className="status-pill done">최종 완료</span>
              <span>—</span>
            </div>
            <div className="result-row">
              <b>모니터링 대시보드 초안</b>
              <span>대시보드팀</span>
              <span className="status-pill done">최종 완료</span>
              <span>—</span>
            </div>
          </div>
        </div>
      </section>

      <p className="dash-note">
        대표 {CEO.name}({CEO.callsign}) · AI 직원 {teams.length}개 부서 32명 · 이 화면은 라이브 오피스와 같은 상태를
        공유해요.
      </p>
    </>
  );
}
