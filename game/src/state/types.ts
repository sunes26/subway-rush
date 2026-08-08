import type { Vec2, Vec3 } from '../core/math'
import type { InteractKind } from '../data/interactables'
import type { ObsId } from '../data/obstacles'
import type { ZoneId } from '../data/world'

export type { InteractKind }

export type { ObsId }

export type { ZoneId }

export type Phase = 'title' | 'playing' | 'boarding' | 'ended'

/** P0은 2종. 배열 구조는 완성해 두고 P1~P2에서 항목만 추가한다 (GDD §9.4) */
export type EndingId =
  | 'E-01' | 'E-02' | 'E-03' | 'E-04' | 'E-05'
  | 'E-06' | 'E-07' | 'E-08' | 'E-09' | 'E-10' | 'E-11'
  | 'E-12' | 'E-13' | 'E-14' | 'E-15' | 'E-16'

/** P1 예약 — 지금은 선언만 */
export type ItemId =
  | 'I-01' | 'I-02' | 'I-04' | 'I-05' | 'I-06' | 'I-07' | 'I-08'
  | 'I-09' | 'I-10' | 'I-11' | 'I-12' | 'I-13' | 'I-14' | 'I-15'
  | 'I-16' | 'I-17' | 'I-18'

export type FlagId =
  | 'GRANDPA_ANGRY'      // 절도 — O-14 발동원
  // 붕어빵 or 대화 완주. **P1에서는 읽는 곳이 없다** — E-12(히든 굿엔딩)의 조건 중
  // 하나이므로 P2에서 소비된다. 지금 지우면 그때 절도/선행 구분을 다시 만들어야 한다.
  | 'GRANDPA_HELPED'
  | 'HINT_GRANDPA'       // 대화 완주 보상 — 안내 LED가 정상 게이트를 지목한다
  | 'MASK_ON'            // 마스크 착용 (O-04 저항 +50%)
  | 'CHASE_DONE'         // 추격이 한 번 끝났다 — 재발동 금지
  | 'WALLET_RETURNED'    // 유실물 지갑 반납 — 비상게이트 개방원 (E-12 조건)
  | 'SEAT_YIELDED'       // 임산부 배려석 양보 (E-12 조건)
  // ── P2 착용 ──
  | 'EARBUDS_ON'         // 이어폰 착용 — 전단지·아주머니 무시. 대가: LED 힌트가 안 들린다
  | 'CARRIER_ON'         // 캐리어 견인 — 인파 관통. 대가: 이동속도 −20%
  | 'CAFFEINE'           // 커피를 마셨다 — 스태미너 소모 감소
  | 'MAP_OPEN'           // 노선도를 펼쳤다 — 미니맵 확대
  // ── P2 개찰 ──
  | 'EMERGENCY_OPEN'     // 비상게이트가 열려 있다
  | 'FARE_EVADED'        // 요금을 안 내고 통과했다 — 역무원 시야에 들면 E-09
  | 'TOILET_USED'        // Z2 화장실 진입 (E-13)
  | 'OPPOSITE_SIDE'      // Z5 반대편 승강장 도달 (E-08)
  | 'BUSTED'             // 역무원에게 적발됐다 — E-09 의 단일 조건
  | 'GIFT_BOUGHT'        // 편의점 선물 구매 — 1회 한정. 되돌리기 없음

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
  /**
   * 못 움직이는 남은 시간(ms) — P2 방해요소 공용 (`systems/obstacles.ts`).
   *
   * P1의 `surge.stallMs` 와 **의미가 같다.** 합치지 않은 이유는 역류가 자기 웨이브
   * 안에서만 유효한 `fell` 과 짝지어 있기 때문이고, 대신 이동 봉쇄는 둘 다 같은 수법
   * (`MOVE` 재발행)을 쓴다. 겹치면 **더 긴 쪽이 이긴다** — 짧은 쪽이 끝났다고 풀리면
   * 두 방해가 겹칠 때 하나가 공짜가 된다.
   */
  stallMs: number
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

/**
 * 상호작용 상태 (P1).
 *
 * 타겟팅 결과를 **상태에 쓴다** — 렌더가 매 프레임 다시 계산하지 않게 하려는 것이 절반이고,
 * 헤드리스 테스트가 "지금 무엇을 조준 중인가"를 단정할 수 있게 하려는 것이 나머지 절반이다.
 */
export type ActState = Readonly<{
  /** 현재 대상 id — 없으면 null */
  targetId: string | null
  /** 조준(레이 등가)인가. false면 근접 폴백 → 아웃라인이 얇다 */
  aimed: boolean
  /** 진행 중 상호작용 */
  busyId: string | null
  busyKind: InteractKind | null
  busyTotalMs: number
  busyLeftMs: number
  /** 사유 텍스트 — 남은 수명이 0이면 표시하지 않는다 */
  denyText: string
  denyMs: number
  /** 소진된 대상 id (습득 완료·자판기 성공·비켜세움 등) */
  consumed: readonly string[]
  /** 선택 UI가 열린 대상 (P1은 할아버지 전용) */
  dialogId: string | null
}>

/** 바닥에 떨어진 아이템 — 슬롯 교체 시 생긴다. 되돌아가 주울 수 있다 */
export type Drop = Readonly<{ id: string; item: ItemId; x: number; y: number; z: number }>

/**
 * UI-14 교체 창 (P2).
 *
 * ★ **P1 동작이 먼저 일어나고, 그 뒤 0.9초 동안 되돌릴 수 있다.**
 *   모달을 띄우고 *기다리는* 방식이 아니다 — 그렇게 짜면 무입력 플레이(헤드리스·자동조종)가
 *   습득 지점마다 0.9초씩 멈추고, P1 회귀 테스트 2건이 통째로 뒤집힌다.
 *   지금 방식은 아무것도 안 눌러도 P1과 **완전히 같은 결과**이고, 누르면 자리를 바꾼다.
 */
export type SwapState = Readonly<{
  active: boolean
  /** 새 아이템이 들어간 칸 (항상 0 — 리듀서의 `chooseSlot` 규칙) */
  newSlot: number
  /** 밀려나 바닥에 놓인 드랍 id */
  dropId: string | null
  /** 남은 창(ms) */
  leftMs: number
}>

/**
 * 자판기 긁기 QTE — **P2에서 타이밍 바로 바뀌었다.**
 *
 * P1은 마우스 좌↔우 왕복 드래그였다(누적 이동량 + 리듬 판정). 손목 왕복이 동사였는데,
 * 그건 마우스 감도·DPI 에 따라 난이도가 갈리고 판정 이유가 화면에 안 보였다.
 * P2는 **좌우로 왕복하는 마커를 중앙 구간에서 클릭**한다 — 언제 눌러야 하는지가
 * 게이지 하나에 전부 그려진다.
 *
 * ★ 마커는 `ADVANCE` 에서만 움직인다(타이머 단일 감산 규칙). 시스템이 자기 위치를
 *   따로 밀면 프레임당 두 번 움직여 판정이 프레임레이트를 탄다.
 */
export type QteState = Readonly<{
  active: boolean
  vendorId: string | null
  /** 성공 횟수 0..3 */
  strokes: number
  /** 마커 위치 0(왼쪽 끝) ~ 1(오른쪽 끝) */
  pos: number
  /** 진행 방향. +1 = 오른쪽 */
  dirSign: -1 | 1
  /** 초당 왕복 배수 — 성공할 때마다 빨라진다 */
  speedMul: number
  misses: number
  elapsedMs: number
}>

/**
 * O-14 단소 추격 (P1).
 *
 * P0에는 `active/remainingMs/hitCount/swingCooldownMs` 네 개만 있었고 **위치가 없었다** —
 * 추격이 구현되지 않은 진짜 이유가 그것이다. 쫓아오는 물건은 좌표가 있어야 한다.
 */
export type ChasePhase =
  | 'idle'     // 벤치에 앉아 있다
  | 'draw'     // 발도 0.6s — 이 동안엔 안 때린다
  | 'chase'    // 추격
  | 'swing'    // 스윙 동작 0.32s (제자리)
  | 'return'   // 벤치로 돌아간다 (게임은 계속된다)

export type ChaseState = Readonly<{
  /** draw~swing 구간인가. 렌더·판정의 단일 스위치 */
  active: boolean
  phase: ChasePhase
  /** 현재 phase 경과(ms) */
  phaseMs: number
  /** 30s 카운트다운 잔여 */
  remainingMs: number
  hitCount: number
  swingCooldownMs: number
  pos: Vec2
  /** 바라보는 방향 rad (+x 기준 CCW) */
  facing: number
  /** 실이동이 없는 상태의 누적(ms) — 끼임 탈출 판정 */
  stuckMs: number
}>

/**
 * O-04 역류 (P1). 웨이브 자체는 `surgeAt(elapsedMs, seed)` 로 파생되므로 상태가 없다 —
 * 여기 남는 건 **한 번만 일어나야 하는 일**뿐이다.
 */
export type SurgeState = Readonly<{
  /** 이번 웨이브에서 이미 넘어졌는가 — 연속 넘어짐 방지 */
  fell: boolean
  /** 넘어져 못 움직이는 남은 시간(ms) */
  stallMs: number
}>

/**
 * 손 — **지금 들고 있는 것** (디렉터 지시 2026-08-07).
 *
 * P2까지 슬롯 키(`1`~`0`)는 곧 "쓴다"였다. 그래서 쓸 대상이 없으면 사유만 뜨고
 * 아이템은 영영 손에 안 들어왔다 — 인벤토리는 있는데 **가진 것이 화면에 없었다.**
 * 이제 대상이 없으면 그 자리에서 **든다.** 쓰는 것은 대상이 있을 때만 일어난다.
 *
 * ★ `slot` 을 같이 들고 있는 이유: 인벤토리가 바뀌면(소모·교체·낙하) 손이 유령이 된다.
 *   `reducer.applyAll` 이 매 액션 뒤에 `inventory[slot] === item` 을 확인해 어긋나면 비운다.
 */
export type HandState = Readonly<{
  /** 들고 있는 아이템. null 이면 빈손 */
  item: ItemId | null
  /** 들고 있는 칸. 빈손이면 −1 */
  slot: number
  /** 우산을 펼쳤는가 — `item === 'I-09'` 일 때만 참일 수 있다 */
  open: boolean
}>

/**
 * 펼친 우산에 맞아 날아간 사람 — **방향만** 상태에 남긴다.
 *
 * 경과 시간은 렌더가 자기 시계로 센다(`render/actors.ts` 의 `cpAsideSec` 와 같은 방식).
 * 시뮬이 들고 있어야 할 이유가 없다: 판정은 맞은 그 순간 이미 끝났고(`ACT_CONSUME`),
 * 그 뒤는 연출이다. 방향만 시뮬이 정하는 이유는 **플레이어가 어디서 훑었는지**가
 * 렌더에 없기 때문이다.
 */
export type KnockState = Readonly<{
  /** 맞은 사람의 상호작용 id (`ACT-CP*`) */
  id: string
  /** 날아가는 방향 단위벡터 (월드 x 동 · y 북) */
  dx: number
  dy: number
}>

/** 채점 보조 집계 — 엔딩 조건식이 읽는다 */
export type TallyState = Readonly<{
  /** 자판기·바닥에서 얻은 누적 동전액 (E-14 조건) */
  coinsEarned: number
  /** 사용한 아이템 **종류** (스타일 축) */
  itemsUsed: readonly ItemId[]
  /** 발견한 시크릿 id (지식 축) — 중복 카운트 방지용으로 집합 성격 */
  secrets: readonly string[]
  /** 우산으로 인파를 밀어낸 횟수 (E-11 조건). GDD §9.4 "3회 이상" */
  pushes: number
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
  /** 시작 후 경과(ms). 열차 스케줄의 단일 입력 — 위치 트리거 이후엔 `trainTriggerMs` 와 함께 쓴다 */
  elapsedMs: number
  /**
   * 열차 위치 트리거(디렉터 지시) — 계단/엘리베이터 앞에 처음 도착한 시각(ms). null이면
   * 아직 안 밟음. `systems/train.ts trainClock` 이 이 값과 `elapsedMs` 로 열차의 유효
   * 시각을 계산한다 — 트리거 전엔 원래 스케줄(168~182s) 그대로, 트리거 후엔 그 순간부터
   * 앞당겨진다. 기존 시간 기반 테스트가 `elapsedMs` 만 조작해도 깨지지 않게, 트리거가
   * 없으면(null) `trainClock`은 `elapsedMs` 를 그대로 돌려준다.
   */
  trainTriggerMs: number | null
  /**
   * 반대 방면 열차(디렉터 지시) — 게이트9 동쪽 새 통로 끝 플랫폼. `train`/`trainTriggerMs`
   * 와 완전히 독립된 두 번째 열차다. 여길 타면 `OPPOSITE_SIDE` 플래그가 서고
   * 기존 E-08("반대편 탑승") 엔딩이 그대로 집어간다 — 새 엔딩을 안 만들었다.
   */
  train2: TrainStatus
  trainTriggerMs2: number | null
  zone: ZoneId
  player: PlayerState
  cardBalance: number
  gates: GatesState
  train: TrainStatus
  /** 신호등 위상(ms) — 0..cycleMs */
  lightMs: number
  boarded: boolean
  boardedDoorX: number | null
  /** 탄 게 `train2`(반대 방면)인가 — 출발 판정이 어느 열차를 볼지 이걸로 가른다 */
  boardedTrain2: boolean
  endingId: EndingId | null
  fx: readonly Fx[]
  nextFxId: number

  /** 3슬롯 고정. 교통카드·동전은 슬롯 미점유 (GDD §5.2) */
  inventory: readonly (ItemId | null)[]
  scores: Readonly<{ conscience: number; style: number; knowledge: number }>
  chase: ChaseState
  flags: readonly FlagId[]

  // ── P1 신설 ──
  act: ActState
  drops: readonly Drop[]
  nextDropId: number
  qte: QteState
  surge: SurgeState
  tally: TallyState
  /** 손에 든 물건 — 슬롯 키로 들고 놓는다 */
  hand: HandState
  /** 펼친 우산에 날아간 사람들. 한 번 들어가면 안 빠진다(그 자리에 널브러져 있다) */
  knocks: readonly KnockState[]

  // ── P2 신설 ──
  /** UI-14 교체 창 — 슬롯이 가득 찬 채로 습득한 직후 0.9초 */
  swap: SwapState
  /**
   * 이번 판에 켜진 방해요소 8종 (`data/obstacles.ts rollObstacles`).
   * **판정 시스템은 이 배열에 없는 id 를 무시한다** — 조건을 만족해도 침묵한다.
   */
  obstacles: readonly ObsId[]
  /** 방해요소별 재발동 쿨다운 잔여(ms). 키가 없으면 0 */
  obsCooldown: Readonly<Partial<Record<ObsId, number>>>
  /**
   * ACT-08 역무원 경보 누적(ms). 시야에서 벗어나면 0으로 돌아간다.
   * **위치는 여기 없다** — 순찰이 정해진 구간 왕복이라 `staffAt(elapsedMs)` 로 파생한다.
   */
  staffAlertMs: number
  /** 승차 대기줄 ⓐⓑⓒ 인원. 합계 고정·분포 시드 (R3 해소) */
  queues: readonly number[]
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
  /** `opp` 면 반대 방면 열차 — `boardedTrain2` 로 기록해서 종료 판정이 어느 열차를 볼지 안다 */
  | { t: 'BOARD'; doorX: number; opp?: boolean }
  /** 계단/엘리베이터 위치 트리거 — 한 번만 유효(멱등) */
  | { t: 'TRAIN_TRIGGER' }
  | { t: 'TRAIN_TRIGGER2' }
  | { t: 'PHASE'; phase: Phase }
  | { t: 'END'; endingId: EndingId }
  | { t: 'FX'; kind: Fx['kind']; text: string; lifeMs: number; value: number }
  | { t: 'RESPAWN' }

  // ── P1 상호작용 ──
  | { t: 'ACT_TARGET'; id: string | null; aimed: boolean }
  | { t: 'ACT_BEGIN'; id: string; kind: InteractKind; totalMs: number }
  | { t: 'ACT_CANCEL' }
  | { t: 'ACT_DENY'; text: string }
  | { t: 'ACT_CONSUME'; id: string }
  | { t: 'DIALOG'; id: string | null }
  /** slot < 0 이면 빈 칸 자동 선택. 가득 차면 slot 0 을 바닥에 떨군다 */
  | { t: 'PICKUP'; item: ItemId; slot: number; dropId: string | null }
  | { t: 'ITEM_SPEND'; slot: number }
  | { t: 'ITEM_USED'; item: ItemId }
  | { t: 'BALANCE'; delta: number; label: string }
  | { t: 'CONSCIENCE'; delta: number }
  | { t: 'SECRET'; id: string }
  | { t: 'FLAG'; id: FlagId; on: boolean }

  // ── QTE (P2 — 타이밍 바) ──
  | { t: 'QTE_BEGIN'; vendorId: string }
  /** 클릭 판정 1회. 성공이면 마커가 빨라진다 */
  | { t: 'QTE_HIT'; hit: boolean }
  | { t: 'QTE_END'; success: boolean }

  // ── P1 단소 추격 (O-14) ──
  /**
   * 발도 시작. **`facing` 을 반드시 같이 준다** — 안 주면 `EMPTY_CHASE` 의 0(동쪽)이
   * 발도 0.6초 내내 남아서, 훔친 직후 할아버지가 엉뚱한 쪽을 보고 일어선다.
   */
  | { t: 'CHASE_START'; x: number; y: number; facing: number }
  | { t: 'CHASE_MOVE'; x: number; y: number; facing: number; stuckMs: number }
  | { t: 'CHASE_PHASE'; phase: ChasePhase }
  | { t: 'CHASE_HIT' }
  /** 해제. `returned` 면 효자손을 반납한 것이다 — 2대째 즉사(E-16)는 `END` 로 직접 끝난다 */
  | { t: 'CHASE_END'; reason: 'gate' | 'timeout' | 'returned' }

  // ── P1 인파 (O-04) ──
  | { t: 'SURGE_FALL' }

  // ── P2 방해요소 ──
  /** 이동 봉쇄. 더 긴 쪽이 이긴다 (누적이 아니라 최대) */
  | { t: 'STALL'; ms: number }
  /** 방해요소가 발동했다 — 쿨다운 시작. `obsId` 는 `data/obstacles.ts` 의 id */
  | { t: 'OBS_FIRE'; id: ObsId; cooldownMs: number }
  /** 슬롯 하나를 바닥에 떨어뜨린다 (물청소 미끄럼) */
  | { t: 'FUMBLE'; slot: number }
  /** 역무원 경보 누적 갱신 — 절대값으로 쓴다(누적은 시스템이 계산한다) */
  | { t: 'STAFF_ALERT'; ms: number }
  /** 우산으로 인파를 밀어냈다 (E-11 계수) */
  | { t: 'PUSH' }

  // ── 손 (디렉터 지시 2026-08-07) ──
  /** 들거나 놓는다. `item: null` 이면 빈손으로 만든다 */
  | { t: 'EQUIP'; slot: number; item: ItemId | null }
  /** 우산을 펼치거나 접는다. 우산을 안 들고 있으면 무시된다 */
  | { t: 'UMBRELLA'; open: boolean }
  /** 펼친 우산이 사람을 날렸다 — 방향은 단위벡터 */
  | { t: 'KNOCK'; id: string; dx: number; dy: number }

  // ── P2 슬롯 교체 (UI-14) ──
  /** 교체 창 안에서 `1``2``3` — 새 아이템을 그 칸으로 옮기고 원래 있던 것을 바닥으로 */
  | { t: 'SWAP_TO'; slot: number }
  /** 교체 창 안에서 `ESC` — 습득 자체를 되돌린다 (새 아이템이 바닥에 남는다) */
  | { t: 'SWAP_CANCEL' }
