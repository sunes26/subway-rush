import type { Vec2, Vec3 } from '../core/math'
import type { ZoneId } from '../data/world'

export type { ZoneId }

export type Phase = 'title' | 'playing' | 'boarding' | 'ended'

/** P0은 2종. 배열 구조는 완성해 두고 P1~P2에서 항목만 추가한다 (GDD §9.4) */
export type EndingId =
  | 'E-01' | 'E-02' | 'E-03' | 'E-04' | 'E-05'
  | 'E-06' | 'E-07' | 'E-08' | 'E-09' | 'E-10' | 'E-11'
  | 'E-12' | 'E-13' | 'E-14'

/** P1 예약 — 지금은 선언만 */
export type ItemId =
  | 'I-01' | 'I-02' | 'I-04' | 'I-05' | 'I-06' | 'I-07' | 'I-08'
  | 'I-09' | 'I-10' | 'I-11' | 'I-12' | 'I-13' | 'I-14' | 'I-15'

/** P1 예약 */
export type FlagId = 'GRANDPA_ANGRY' | 'WALLET_RETURNED' | 'GRANDPA_HELPED' | 'SEAT_YIELDED'

export type GateState = 'idle' | 'tagging' | 'open' | 'reject'

export type TrainState = 'incoming' | 'arriving' | 'open' | 'closing' | 'closed' | 'departed'

export type PlayerState = Readonly<{
  pos: Vec3
  vel: Vec2
  facing: number
  stamina: number
  /** 스프린트 잠금 (스태미너 0 도달 후 unlockAt까지) */
  sprintLocked: boolean
  /** 마지막 스프린트 종료 후 경과(ms) — 회복 지연용 */
  sinceSprintMs: number
  /** 0..1 — 단소 피격 누적. P0 미사용 */
  speedPenalty: number
  /** 수직 속도 m/s (양수 = 상승) */
  vz: number
  /** 지면에 닿아 있는가 */
  grounded: boolean
  /** 지면을 벗어난 뒤 경과(ms) — 코요테 타임 판정 */
  airborneMs: number
  /** 점프 입력 버퍼 잔여(ms) */
  jumpBufferMs: number
  /** 현재 밟고 있는 램프 id */
  rampId: string | null
  /** 이동 중 여부 (애니 선택용) */
  moving: boolean
  sprinting: boolean
}>

export type GatesState = Readonly<{
  /** 시드로 결정된 정상 게이트 번호 */
  workingIds: readonly number[]
  /** 안내 LED에 힌트를 띄울지 (60% 시드) */
  ledHint: boolean
  /** LED가 지목하는 고장 게이트 (ledHint일 때만) */
  ledBrokenId: number | null
  state: GateState
  /** 현재 태그 중이거나 통과 중인 게이트 */
  activeId: number | null
  /** 현재 상태 남은 시간(ms) */
  timerMs: number
  /** 거부 쿨다운 남은 시간(ms) */
  cooldownMs: number
  /** 운임구역 진입 완료 — 비가역 */
  passed: boolean
  /** 마지막 거부 사유 (HUD 표시용) */
  lastReject: 'broken' | 'low' | null
  attempts: number
}>

export type TrainStatus = Readonly<{
  state: TrainState
  /** 1량 앞단 x */
  x: number
  /** 0(닫힘) ~ 1(완전 열림) */
  doorProgress: number
}>

/** 화면에 잠깐 뜨는 피드백. 렌더가 읽고 만료되면 리듀서가 지운다. */
export type Fx = Readonly<{
  id: number
  kind: 'timePenalty' | 'balance' | 'toast' | 'shake'
  text: string
  /** 남은 수명(ms) */
  lifeMs: number
  value: number
}>

export type GameState = Readonly<{
  phase: Phase
  seed: number
  /** 남은 시간(ms) */
  timeLeftMs: number
  /**
   * 자유 탐색 모드 — `?freeplay` 로 켠다. **임시 확인용이고 기본값은 꺼짐이다.**
   *
   * 두 가지를 멈춘다.
   *  · HUD 카운트다운(`timeLeftMs`) 이 안 줄어든다
   *  · 열차가 떠나도 게임이 안 끝난다
   *
   * `elapsedMs` 는 그대로 흐른다 — 열차 스케줄의 단일 입력이라 멈추면 열차가 아예 안 온다.
   * 맵을 보러 들어온 사람도 열차는 봐야 한다.
   */
  freeplay: boolean
  /** 시작 후 경과(ms). 열차 스케줄의 단일 입력 */
  elapsedMs: number
  zone: ZoneId
  player: PlayerState
  cardBalance: number
  gates: GatesState
  train: TrainStatus
  /** 신호등 위상(ms) — 0..cycleMs */
  lightMs: number
  boarded: boolean
  boardedDoorX: number | null
  endingId: EndingId | null
  fx: readonly Fx[]
  nextFxId: number

  // ── P1 예약 (P0 미사용, 초기값 고정) ──
  inventory: readonly (ItemId | null)[]
  scores: Readonly<{ conscience: number; style: number; knowledge: number }>
  chase: Readonly<{ active: boolean; remainingMs: number; hitCount: number; swingCooldownMs: number }>
  flags: readonly FlagId[]
}>

export type Action =
  | { t: 'ADVANCE'; dtMs: number }
  | { t: 'MOVE'; pos: Vec3; vel: Vec2; facing: number; rampId: string | null; moving: boolean; sprinting: boolean
      vz: number; grounded: boolean; airborneMs: number; jumpBufferMs: number }
  | { t: 'STAMINA'; value: number; locked: boolean; sinceSprintMs: number }
  | { t: 'ZONE'; zone: ZoneId }
  | { t: 'GATE_BEGIN_TAG'; gateId: number }
  | { t: 'GATE_ACCEPT'; gateId: number }
  | { t: 'GATE_REJECT'; gateId: number; reason: 'broken' | 'low' }
  | { t: 'GATE_SET'; state: GateState; timerMs: number }
  | { t: 'GATE_PASSED' }
  | { t: 'TIME_PENALTY'; ms: number; label: string }
  | { t: 'BOARD'; doorX: number }
  | { t: 'PHASE'; phase: Phase }
  | { t: 'END'; endingId: EndingId }
  | { t: 'FX'; kind: Fx['kind']; text: string; lifeMs: number; value: number }
