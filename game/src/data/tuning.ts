/**
 * 모든 밸런싱 상수. 한 곳.
 *
 * 출처가 있는 값은 반드시 주석으로 문서를 인용한다.
 * 코드를 읽는 사람이 "이 숫자 왜 이래?"를 문서까지 추적할 수 있어야 한다.
 */

/** 시뮬레이션 고정 스텝 (ms). 60Hz. */
export const STEP_MS = 1000 / 60

/** 탭 백그라운드 복귀 시 스파이럴 차단. 이 이상 벌어진 dt는 1스텝으로 잘라낸다. */
export const MAX_FRAME_MS = 250

/** 한 프레임에 돌릴 수 있는 최대 시뮬 스텝 */
export const MAX_STEPS_PER_FRAME = 5

// ─────────────────────────────── 시간 ───────────────────────────────

/** GDD §3 — 총 제한시간 180초 */
export const TOTAL_TIME_MS = 180_000

/** GDD §7.2 — 타이머 연출 4단계 경계 (ms) */
export const TIMER_STAGES = {
  calm: 60_000,   // 180~60s 흰색
  warn: 30_000,   // 60~30s 노랑 + 초당 펄스
  hot: 10_000,    // 30~10s 주황 + 심박
  // 10~0s 적색 + 비네팅
} as const

// ─────────────────────────────── 이동 ───────────────────────────────

/** MAP §1.3 — 맵 치수를 역산한 근거표. 바꾸면 맵 전체를 다시 계산해야 한다. */
export const SPEED = {
  walk: 5.0,
  sprint: 8.3,
  stairsDown: 3.5,
  stairsTwoStep: 5.5,
  escalatorRide: 1.5,
  escalatorWalk: 5.5,
  crowdDense: 2.5,
} as const

export const MOVE = {
  /** 가속 시정수(초) — 입력 있을 때 */
  accelTau: 0.12,
  /** 감속 시정수(초) — 입력 없을 때. 미끄러지는 느낌 금지 */
  decelTau: 0.09,
  /** 캐릭터 회전 속도 rad/s */
  turnRate: 14,
  /** 캡슐 반경 m — 3등신 SD */
  radius: 0.32,
  /** 시선 높이 m (카메라 lookAt 오프셋) */
  eyeHeight: 0.9,
} as const

export const STAMINA = {
  max: 100,
  drainPerSec: 22,
  regenPerSec: 14,
  /** 스프린트 종료 후 회복 시작까지 지연(초) */
  regenDelaySec: 1.0,
  /** 0 도달 후 재사용 가능해지는 임계 — 히스테리시스 (없으면 0 근처에서 깜빡인다) */
  unlockAt: 30,
} as const

// ─────────────────────────────── 개찰구 ───────────────────────────────

/** GDD §5.4 — 개찰구 통과 1회 요금 */
export const FARE = 1400

export const GATE = {
  /** 태그 판정 소요(ms) */
  tagMs: 350,
  /** 통과 소요(ms) — GDD §8.1 Z3 최소 예산의 "통과 2s" */
  passMs: 2000,
  /** 거부 후 재시도 쿨다운(ms). 무작위 대입 방지 — 없으면 6개를 5초에 다 시도한다 */
  rejectCooldownMs: 3000,
  /** GDD §2 — 잘못된 선택: 8초 + 뒤로 밀림 */
  brokenPenaltyMs: 8000,
  /** GDD §4 O-02 — 잔액부족: 6초 */
  lowBalancePenaltyMs: 6000,
  /** 거부 시 후퇴 거리 m */
  knockbackM: 1.6,
  /** GDD §8.3 — 정상 게이트가 2개인 라운드 확률 */
  twoWorkingChance: 0.15,
  /** GDD §5.4 ④ — 안내 LED가 힌트를 표시하는 시드 비율 */
  ledHintChance: 0.6,
} as const

/** P0 한정 초기 잔액 풀 — 충전 수단이 하나도 없으므로 항상 요금 이상.
 *  P1에서 자판기가 붙으면 GDD §8.3 원본(0/900/1250/1600/2200)으로 원복한다. */
export const P0_BALANCE_POOL = [1600, 2200] as const

// ─────────────────────────────── 열차 ───────────────────────────────

/** P0-SPEC §2.7 — 열차 스케줄. t = 게임 시작 후 경과(ms) */
export const TRAIN = {
  approachStartMs: 168_000,
  stopMs: 172_000,
  warnMs: 177_000,
  /** 타이머 0 = 문이 "닫히기 시작"하는 시점 (GDD §1.1 문자 그대로) */
  closeStartMs: 180_000,
  closeDoneMs: 181_200,
  departMs: 182_000,
  doorAnimMs: 1200,
  /** 8량 × 16m */
  carCount: 8,
  carLength: 16,
  /** MAP 부록 A — 가동문 32개소: x = 78 + 16k + {2,6,10,14} */
  doorOffsets: [2, 6, 10, 14] as const,
  firstCarX: 78,
  /** 개구 1.60m → 판정 반폭 0.8 */
  doorHalfWidth: 0.8,
  /** 탑승 판정 y 범위 — 안전문 12.15 ~ 차체 앞면 12.42 관통.
   *  하한은 안전문 앞 0.65m까지 관대하게 (GDD §11 — 판정은 관대하게) */
  boardYMin: 11.5,
  boardYMax: 13.2,
  /** 진입 시작 x (화면 밖) */
  spawnX: 330,
  /** 차체 y 범위 (MAP 부록 A) */
  bodyYMin: 12.42,
  bodyYMax: 15.58,
} as const

// ─────────────────────────────── 카메라 ───────────────────────────────

export const CAMERA = {
  fovDeg: 38,
  near: 0.5,
  far: 260,
  /** 추적 지수 보간 시정수(초) */
  followTau: 1 / 6.0,
  /** 선행 오프셋 = 속도 × 이 값(초) */
  lookAheadSec: 0.28,
  /** 존 전환 보간 시간(초) — 컷 없음 */
  zoneBlendSec: 1.2,
  /** 마우스 오빗 → 프리셋 복귀 지연(초) */
  orbitReturnSec: 2.5,
} as const

// ─────────────────────────────── 렌더 ───────────────────────────────

export const PALETTE = {
  line2: 0x00a84d,     // 2호선 그린
  line1: 0x0052a4,     // 1호선 블루
  fluor: 0xf5f5f0,     // 지하 대합실 형광등 화이트
  gold: 0xffc83d,      // 상호작용 아웃라인 (GDD §5.1)
  ink: 0x0b0b0a,       // 아웃라인 잉크
  danger: 0xe5484d,
  concrete: 0xd9d7cf,
  concreteDark: 0xb4b1a8,
  tileB1: 0xe8e6dd,
  tileB2: 0xdedbd1,
  asphalt: 0x585650,
  sidewalk: 0xcfccc3,
  metal: 0x9aa0a6,
  sky: 0xbfd8e8,
  trainBody: 0xdfe3e6,
} as const
