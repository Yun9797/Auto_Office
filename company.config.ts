// ============================================================
//  나의 AI 회사 설정 — 여기 한 파일만 고치면 됩니다
// ============================================================
//  회사 이름, 부서 이름, 직원 이름·성격·머리색까지 전부 여기 있어요.
//  다른 파일은 건드리지 않아도 됩니다.
//
//  ⚠️ 딱 2가지 규칙
//   1. 부서 id(research, brand, ...)는 절대 바꾸지 마세요. 시뮬레이션 엔진이
//      이 id로 움직입니다. 바꾸면 캐릭터가 길을 잃어요.
//      → 바꿔도 되는 건 name(부서 이름) · icon · short 입니다.
//   2. 부서는 12개를 유지하세요. 사무실 배치가 4열 3행 = 12칸 고정입니다.
//      안 쓰는 부서는 지우지 말고 이름만 바꿔서 쓰세요.
//
//  직원 수는 자유롭게 늘리고 줄여도 됩니다. 한 팀에 팀장(lead) 1명은 두세요.
// ============================================================

/** 회사 기본 정보 */
export const COMPANY = {
  /** 좌측 상단 헤더에 뜨는 회사 이름 */
  name: "AUTODESK PROJECT",
  /** 헤더 로고 배지에 들어갈 글자 1개 (이모지도 됩니다) */
  logoLetter: "A",
  /** 화면 상단 큰 제목 (앞부분) */
  titlePrefix: "나만의",
  /** 화면 상단 큰 제목 (강조되는 뒷부분) */
  titleAccent: "Trading Office",
  /** 브라우저 탭 제목 */
  pageTitle: "Autodesk Project — AI 자동매매 개발 사무실",
  /** 검색·공유될 때 뜨는 설명 */
  description: "12개 AI 팀이 데이터 수집·전략 설계·백테스트·개발·운영까지 돌리는 자동매매 프로그램 개발 오피스",
  /** 창 하단 파일명 느낌의 라벨 */
  windowLabel: "autodesk_trading.exe — 대표실",
  /** 일일 브리핑 제목에 들어갈 이름 */
  reportName: "Autodesk Project",
} as const;

/** 대표(나) — 사무실 대표실에 앉아 있는 캐릭터 */
export const CEO_PROFILE = {
  name: "나",
  callsign: "대표님",
  role: "대표 · 최종 의사결정",
  hair: "#42283a",
  shirt: "#ff8fc0",
  accent: "#fff3b0",
  skin: "#ffdcc4",
  thoughts: [
    "AI는 도구, 실전 투입 결정은 내가 해요.",
    "실전 전에 모의투자부터 돌려보자.",
    "목표는 월 1~3%. 욕심내면 계좌가 터진다.",
  ],
};

/**
 * 부서 12개.
 * id = 고정(엔진용) / name·short·icon = 자유롭게 변경
 * task = 오늘 하는 일 / report = 팀장 한줄보고
 */
export const DEPARTMENTS = [
  {
    id: "research",
    name: "시장 리서치팀",
    short: "market.lab",
    icon: "🔎",
    task: "뉴스·경제지표·이슈 수집",
    report: "출처를 확인하고 오늘 시장에 영향 줄 이슈만 추려요.",
  },
  {
    id: "brand",
    name: "시세 데이터팀",
    short: "data.feed",
    icon: "📊",
    task: "가격·거래량 데이터 수집·정리",
    report: "시세 연동이 되면 실시간 데이터까지 붙습니다.",
  },
  {
    id: "strategy1",
    name: "전략 설계팀",
    short: "strategy.lab",
    icon: "💡",
    task: "매매 아이디어·진입/청산 조건 설계",
    report: "후보 전략을 점수 매겨 TOP 3까지 좁혀요.",
  },
  {
    id: "qa",
    name: "검증·리스크팀",
    short: "backtest.qa",
    icon: "🛡️",
    task: "백테스트·목표 수익(월 1~3%)·손실 한도 검사",
    report: "월 1~3% 목표와 낙폭 기준을 못 넘은 전략은 되돌려보내요.",
  },
  {
    id: "strategy2",
    name: "개발팀",
    short: "bot.dev",
    icon: "💻",
    task: "승인된 전략 코드로 구현",
    report: "대표가 승인한 전략만 코드로 옮겨요.",
  },
  {
    id: "reels",
    name: "AI 모델팀",
    short: "model.train",
    icon: "🤖",
    task: "예측 모델 학습·튜닝",
    report: "학습 데이터와 검증 데이터는 절대 섞지 않아요.",
  },
  {
    id: "carousel",
    name: "대시보드팀",
    short: "dash.ui",
    icon: "🖥️",
    task: "차트·모니터링 화면 제작",
    report: "한눈에 보이는 화면만 남기고 나머진 걷어내요.",
  },
  {
    id: "partner",
    name: "거래소 연동팀",
    short: "exchange.api",
    icon: "🔌",
    task: "주문 API 연결·모의투자 세팅",
    report: "모의투자로만 연결합니다. 실전 전환은 대표가 해요.",
  },
  {
    id: "finance",
    name: "손익·정산팀",
    short: "pnl.ledger",
    icon: "🧾",
    task: "수익·수수료·잔고 정리",
    report: "계좌 내역이 오면 바로 정리합니다.",
  },
  {
    id: "review",
    name: "성과 분석팀",
    short: "perf.review",
    icon: "📈",
    task: "수익률·최대낙폭 분석",
    report: "잘된 이유와 깨진 이유를 패턴으로 남겨요.",
  },
  {
    id: "ops",
    name: "자동화 운영팀",
    short: "bot.ops",
    icon: "⚙️",
    task: "봇 스케줄·장애·재시도 관리",
    report: "멈추면 재시도하고 로그를 남겨요.",
  },
  {
    id: "secretary",
    name: "비서실",
    short: "secretary.hq",
    icon: "📋",
    task: "전사 한줄보고·최종 브리핑",
    report: "모든 팀 상태를 모아 결정할 것만 남겨드려요.",
  },
] as const;

/**
 * 직원 명단.
 * dept = 위 부서 id / rank: "lead"(팀장) 또는 "member"(팀원)
 * colors = [머리색, 옷색, 포인트색]
 * thoughts = 자리를 비웠을 때 머리 위에 뜨는 혼잣말
 */
export type StaffEntry = {
  dept: string;
  rank: "lead" | "member";
  name: string;
  role: string;
  colors: [string, string, string];
  thoughts: string[];
  callsign?: string;
};

export const STAFF_LIST: StaffEntry[] = [
  // ① 시장 리서치팀
  { dept: "research", rank: "lead", name: "김서연", role: "시장 리서치 팀장", callsign: "김리서",
    colors: ["#6b3d34", "#fff3b0", "#ff8fc0"],
    thoughts: ["이 뉴스, 공식 발표 맞는지 확인해야 해.", "금리 발표일은 따로 표시해두자.", "소문은 데이터로 안 쳐요."] },
  { dept: "research", rank: "member", name: "오태윤", role: "뉴스 리서처",
    colors: ["#2f2a3d", "#c9b8ff", "#b8f0dd"],
    thoughts: ["헤드라인만 보고 판단하면 안 돼.", "이미 가격에 반영된 뉴스인지 보자."] },
  { dept: "research", rank: "member", name: "하은채", role: "경제지표 조사",
    colors: ["#8a4a3c", "#b8f0dd", "#ff8fc0"],
    thoughts: ["이번 주 발표 일정부터 정리.", "예상치랑 실제치 차이가 핵심이에요."] },

  // ② 시세 데이터팀
  { dept: "brand", rank: "lead", name: "박보라", role: "시세 데이터 팀장", callsign: "박브리",
    colors: ["#372b4a", "#c9b8ff", "#c9b8ff"],
    thoughts: ["연동 전엔 시세를 지어내지 않아요.", "빠진 봉 데이터부터 채워야 해."] },
  { dept: "brand", rank: "member", name: "신재원", role: "데이터 수집",
    colors: ["#3c3a4f", "#ffe6f2", "#c9b8ff"],
    thoughts: ["분봉이랑 일봉 시간대 맞췄나?", "수집 실패한 구간 다시 긁어온다."] },
  { dept: "brand", rank: "member", name: "임다혜", role: "데이터 정제",
    colors: ["#5a3450", "#fff3b0", "#ff8fc0"],
    thoughts: ["이상치 하나가 백테스트를 망쳐요.", "액면분할 반영됐는지 확인."] },

  // ③ 전략 설계팀
  { dept: "strategy1", rank: "lead", name: "최아름", role: "전략 설계 팀장", callsign: "최아이",
    colors: ["#c26e4b", "#ff8fc0", "#fff3b0"],
    thoughts: ["진입보다 청산 조건이 먼저예요.", "월 1~3%면 충분해요. 꾸준함이 먼저.", "후보는 오늘도 딱 10개."] },
  { dept: "strategy1", rank: "member", name: "정유진", role: "매매 조건 설계",
    colors: ["#7b4a2f", "#b8f0dd", "#ff8fc0"],
    thoughts: ["손절 기준이 빠졌네.", "횡보장에서도 버티는지 봐야 해."] },
  { dept: "strategy1", rank: "member", name: "배시현", role: "아이디어 발굴",
    colors: ["#2c2638", "#fff3b0", "#c9b8ff"],
    thoughts: ["단순한 규칙이 오래 가요.", "이 지표 조합, 전에 실패했던 거 아닌가?"] },

  // ④ 검증·리스크팀
  { dept: "qa", rank: "lead", name: "윤규아", role: "검증·리스크 팀장", callsign: "윤큐아",
    colors: ["#2d4b46", "#b8f0dd", "#b8f0dd"],
    thoughts: ["월 1~3% 안에 드는지부터 봐요.", "최대낙폭 기준 넘으면 반려예요."] },
  { dept: "qa", rank: "member", name: "강태오", role: "백테스트 검증",
    colors: ["#463227", "#ffe6f2", "#b8f0dd"],
    thoughts: ["학습 기간 밖에서도 되나 확인.", "월 3% 넘게 나오면 과적합부터 의심해요."] },
  { dept: "qa", rank: "member", name: "문세라", role: "리스크 점검",
    colors: ["#6c3a55", "#c9b8ff", "#fff3b0"],
    thoughts: ["한 번에 거는 비중이 너무 커요.", "연속 손실 몇 번까지 버티나 보자."] },

  // ⑤ 개발팀
  { dept: "strategy2", rank: "lead", name: "한도빈", role: "개발 팀장", callsign: "한대본",
    colors: ["#8b534a", "#fff3b0", "#ff8fc0"],
    thoughts: ["승인된 전략만 코드로 옮깁니다.", "주문 로직은 두 번 검토해요."] },
  { dept: "strategy2", rank: "member", name: "조민서", role: "매매 엔진 개발",
    colors: ["#33304a", "#ff8fc0", "#b8f0dd"],
    thoughts: ["중복 주문 방지부터 넣자.", "예외 처리 빠진 데가 있네."] },
  { dept: "strategy2", rank: "member", name: "백가온", role: "테스트 코드",
    colors: ["#5d3a2c", "#b8f0dd", "#c9b8ff"],
    thoughts: ["테스트 안 통과하면 배포 없음.", "장 마감 직전 케이스도 넣어요."] },

  // ⑥ AI 모델팀
  { dept: "reels", rank: "lead", name: "송리원", role: "AI 모델 팀장", callsign: "송릴스",
    colors: ["#2c2638", "#ff8fc0", "#ff8fc0"],
    thoughts: ["미래 데이터가 섞이면 끝이에요.", "모델보다 데이터가 먼저."] },
  { dept: "reels", rank: "member", name: "권지호", role: "모델 학습",
    colors: ["#4a3a2a", "#fff3b0", "#b8f0dd"],
    thoughts: ["학습 손실만 줄고 검증은 그대로네.", "피처 하나씩 빼보며 확인 중."] },
  { dept: "reels", rank: "member", name: "유세아", role: "튜닝·평가",
    colors: ["#7a3f58", "#c9b8ff", "#ff8fc0"],
    thoughts: ["정확도보다 수익 기여를 봐요.", "기간 바꿔서 한 번 더 검증."] },

  // ⑦ 대시보드팀
  { dept: "carousel", rank: "lead", name: "이가림", role: "대시보드 팀장", callsign: "이캐리",
    colors: ["#d88d68", "#c9b8ff", "#c9b8ff"],
    thoughts: ["중요한 숫자는 맨 위에.", "경고는 빨간색 하나로 통일."] },
  { dept: "carousel", rank: "member", name: "남주하", role: "차트 제작",
    colors: ["#3a2f4d", "#ffe6f2", "#ff8fc0"],
    thoughts: ["수익 곡선이랑 낙폭을 같이 보여주자.", "축 단위 다시 맞추는 중."] },
  { dept: "carousel", rank: "member", name: "표하늘", role: "화면 구성",
    colors: ["#274a44", "#fff3b0", "#b8f0dd"],
    thoughts: ["봇 상태가 한눈에 보여야 해요.", "모바일에서도 보이게 줄이자."] },

  // ⑧ 거래소 연동팀
  { dept: "partner", rank: "lead", name: "정파랑", role: "거래소 연동 팀장", callsign: "정파트",
    colors: ["#563a32", "#b8f0dd", "#b8f0dd"],
    thoughts: ["API 키 연동 전이라 아직 주문 못 넣어요.", "실전 전환은 대표 손으로."] },
  { dept: "partner", rank: "member", name: "구예성", role: "주문 API 연결",
    colors: ["#452d3f", "#c9b8ff", "#fff3b0"],
    thoughts: ["요청 횟수 제한 확인해야 해.", "모의투자 계정으로만 테스트해요."] },

  // ⑨ 손익·정산팀
  { dept: "finance", rank: "lead", name: "오재민", role: "손익 팀장", callsign: "오재무",
    colors: ["#313b56", "#fff3b0", "#fff3b0"],
    thoughts: ["계좌 내역이 오면 바로 정리합니다.", "수수료까지 빼야 진짜 수익이에요."] },
  { dept: "finance", rank: "member", name: "심우진", role: "정산 관리",
    colors: ["#4b3b2c", "#b8f0dd", "#c9b8ff"],
    thoughts: ["체결 기록이랑 잔고가 맞는지 대조.", "세금 계산용 기록도 남겨둬요."] },

  // ⑩ 성과 분석팀
  { dept: "review", rank: "lead", name: "강성아", role: "성과 분석 팀장", callsign: "강성과",
    colors: ["#9c5c72", "#ff8fc0", "#ff8fc0"],
    thoughts: ["수익률보다 낙폭을 먼저 봐요.", "백테스트랑 실제 차이를 기록해야 해."] },
  { dept: "review", rank: "member", name: "마지훈", role: "지표 수집",
    colors: ["#2e3a4a", "#ffe6f2", "#b8f0dd"],
    thoughts: ["승률·손익비 다시 계산합니다.", "연동되면 자동으로 쌓여요."] },
  { dept: "review", rank: "member", name: "여름", role: "개선점 정리",
    colors: ["#6b4a2f", "#c9b8ff", "#fff3b0"],
    thoughts: ["유지할 규칙 1개, 버릴 규칙 1개.", "전략팀에 넘길 개선점 정리 중."] },

  // ⑪ 자동화 운영팀
  { dept: "ops", rank: "lead", name: "안도현", role: "자동화 운영 팀장", callsign: "안오토",
    colors: ["#3b3b49", "#b8f0dd", "#b8f0dd"],
    thoughts: ["장 시작 전 점검 정상입니다.", "봇이 멈추면 재시도하고 로그 남겨요."] },
  { dept: "ops", rank: "member", name: "천유나", role: "봇 모니터링",
    colors: ["#573049", "#fff3b0", "#ff8fc0"],
    thoughts: ["연결 안 된 걸 정상으로 안 써요.", "비상 정지 버튼 동작 확인 중."] },

  // ⑫ 비서실
  { dept: "secretary", rank: "lead", name: "김세리", role: "비서실장", callsign: "김비서",
    colors: ["#7a453c", "#c9b8ff", "#c9b8ff"],
    thoughts: ["대표가 결정할 것만 추립니다.", "중복 설명은 다 지워요."] },
  { dept: "secretary", rank: "member", name: "홍보람", role: "브리핑 정리",
    colors: ["#334a3a", "#ffe6f2", "#fff3b0"],
    thoughts: ["상태별로 묶어서 올릴게요.", "막힌 건 먼저 보고해요."] },
];

/**
 * 외부 연동을 아직 안 붙인 팀 → 화면에 "연동 대기"로 표시됩니다.
 * 연동을 다 붙였거나, 그냥 전부 초록불로 보고 싶으면 빈 배열 []로 두세요.
 */
export const PENDING_INTEGRATIONS: Record<string, string> = {
  brand: "시세 데이터 연동",
  partner: "거래소 API 키",
  finance: "계좌 내역 파일",
};

/**
 * 결과 보관함 링크 (Notion 등). 비워두면 화면에서 링크 버튼이 숨겨집니다.
 * 예: "https://www.notion.so/내페이지주소"
 */
export const STORAGE_LINK = "";

/**
 * 자동 운영 — "오늘 업무 시작하기" 한 번이면 아래를 알아서 하고 중요한 것만 알려줍니다.
 *  1) 아침에 업비트 잔고 확인 (조회만)
 *  2) 백테스트 단계에서 아래 코인 × 조합을 전부 돌려 목표(월 1~3%, MDD 35% 이내)에 맞는 전략 탐색
 *  3) 대표 결재는 탐색 결과로 자동 처리 (실제 주문은 하지 않음)
 *  4) 하루 끝에 요약
 */
export const AUTOPILOT = {
  /** false 로 바꾸면 예전처럼 대표가 직접 승인 버튼을 눌러야 합니다 */
  enabled: true,
  /** 전략 탐색할 코인 (업비트 원화마켓 티커) */
  coins: ["KRW-BTC", "KRW-ETH", "KRW-DOOD", "KRW-IRYS"], // 비트코인 · 이더리움 · 두들즈 · 아이리스
  /** "day" = 일봉, "4h" = 4시간봉 */
  interval: "day" as "day" | "4h",
  /** 탐색할 조합 — 단기·장기 이동평균(봉 개수), 손절 비율. 각 최대 8개 */
  grid: {
    fast: [5, 10, 20, 30],
    slow: [60, 90, 120, 200],
    stop: [0.03, 0.05, 0.08],
  },
  /** 보유 코인 수익률이 이 값(%) 아래로 떨어져 있으면 중요 알림 */
  lossAlertPct: -8,
};
