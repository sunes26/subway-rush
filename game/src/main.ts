/**
 * 부트스트랩 · 고정스텝 루프 · 씬 조립.
 *
 * 시뮬은 고정 60Hz, 렌더는 가변. 프레임이 튀어도 물리와 밸런스가 튀지 않는다.
 */

import { Frustum, Matrix4, type Object3D, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { createSfx } from './audio/sfx'
import { createInput, EMPTY_INPUT, type InputFrame } from './core/input'
import { resolveSeed } from './core/rng'
import { CAMERA, FPV, MAX_FRAME_MS, MAX_STEPS_PER_FRAME, MOVE, STEP_MS } from './data/tuning'
import { CROSSWALK, FLOOR, GATES, GATE_BODY, GATE_LAMP_Z, TRAFFIC_LIGHT,
  ZONE_NAMES } from './data/world'
import { byId, type InteractKind } from './data/interactables'
import { CHAR_SCALE, loadActors, type Actors } from './render/actors'
import { createCameraRig } from './render/camera-rig'
import { buildTraffic, type Traffic } from './render/cars'
import { createGuideArrows } from './render/guide-arrows'
import { loadPlayerRig, type PlayerRig } from './render/player-rig'
import { loadProps, type Props } from './render/props'
import { createStage } from './render/scene'
import { loadStation, type Station } from './render/station'
import { buildWorld } from './render/world-builder'
import { applyAll, initialState } from './state/reducer'
import type { GameState } from './state/types'
import { carHits } from './systems/roadHazard'
import { lightIsGreen, lightRemainSec, rebuildDynamics, tick } from './systems/tick'
import { createDebug } from './ui/debug'
import { createDialog } from './ui/dialog'
import { createHud } from './ui/hud'
import { createScreens } from './ui/screens'
import { createCollection } from './ui/collection'
import { createIntro } from './ui/intro'
import { actorAt, busDx, DOORS_MS, INTRO_MS, poseAt, SHOT } from './render/intro'
import { buildBusInterior, type BusInterior } from './render/bus-interior'
import { buildWestRoad } from './render/west-road'
import { makePoseRig, type PoseRig } from './render/pose'
import { buildPhone, type Phone } from './render/phone'
import { createSettings } from './ui/settings'
import { RES_SCALES, type Settings } from './core/settings'
import { createAmbience } from './audio/ambience'
import { createFootsteps } from './audio/footsteps'
import {
  ambienceHzOf, announceOn, heartIntensity, heartbeatIntervalMs, heartbeatOn,
  stepCutoffOf, stepIntervalMs, stepKindOf,
} from './audio/cues'
import { recordEnding } from './core/save'

const BASE = import.meta.env.BASE_URL

const canvas = document.getElementById('gl') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement

const stage = createStage(canvas)
const input = createInput(canvas)

/**
 * 절차 생성 월드는 이제 **보이지 않는 프록시**다.
 * 실제 룩은 Blender에서 뽑은 station GLB가 담당하고, 이쪽은 두 가지 일만 한다.
 *  1. 카메라 차폐 레이캐스트 대상 — 바닥이 없으므로 벽만 정확히 잡힌다
 *  2. GLB 로드 실패 시 폴백 — 그레이박스로라도 게임은 끝까지 돌아가야 한다
 * 레이캐스터는 `visible`을 보지 않으므로 숨겨도 차폐 판정은 그대로 작동한다.
 */
const world = buildWorld(false)
world.root.visible = false
const cameraRig = createCameraRig(stage.camera, world.occluders)
stage.scene.add(world.root)

/** 유도블록 위를 흐르는 방향 화살표. GLB가 아니라 코드가 만든다 — 매 프레임 움직인다. */
const guideArrows = createGuideArrows()
stage.scene.add(guideArrows.mesh)

/** 지상 교통. 배경이라 시뮬 상태에 안 들어가고 렌더 쪽에서 경과 시간으로 굴린다. */
let traffic: Traffic | null = null

/** 시점 전환 — 1인칭이 기본. 3인칭 쿼터뷰는 V로 확인용 전환. */
const applyView = (): void => {
  const fp = cameraRig.mode() === 'fp'
  station?.setOverhead(fp)   // 1인칭이면 천장·지붕을 켠다
  player?.setVisible(!fp)    // 1인칭이면 자기 몸을 끈다
  hud.setCrosshair(fp)
  stage.camera.near = fp ? 0.08 : CAMERA.near
  stage.camera.fov = fp ? FPV.fovDeg : CAMERA.fovDeg
  stage.camera.updateProjectionMatrix()
}

/**
 * 절차 생성 SFX. 시뮬은 이걸 모른다 — **상태 변화를 렌더 루프가 읽어** 재생한다.
 * 그래서 헤드리스 테스트가 오디오 없이 그대로 돌고, 오디오가 실패해도 게임이 돈다.
 */
const sfx = createSfx()

const hud = createHud(uiRoot)
/** 상호작용 오버레이 — 프롬프트·진행링·사유·대화·QTE. HUD와 분리한 이유는 ui/dialog.ts 헤더 참고 */
const dialog = createDialog(uiRoot)
const screens = createScreens(uiRoot)
const collection = createCollection(uiRoot)
const intro = createIntro(uiRoot)

/**
 * UI-15 설정(ESC) — **일시정지 겸 설정**.
 *
 * ★ 값을 실제로 먹이는 곳이 여기다. UI 는 값만 만든다(`ui/settings.ts` 헤더 참고).
 * ★ 전체 화면 전환은 **사용자 제스처 안에서만** 허용된다. 드롭다운 change 는 제스처라
 *   여기서 부르면 통과하지만, 부팅 직후 초기 적용에서 부르면 브라우저가 거절한다 →
 *   `boot` 인자로 그 한 번을 건너뛴다(거절 자체는 무해하지만 콘솔이 시뻘게진다).
 */
const applySettings = (v: Settings, boot = false): void => {
  sfx.setVolumes({ master: v.master, bgm: v.bgm, sfx: v.sfx })
  input.setLook({ sens: v.sens, invertY: v.invertY })
  stage.setResScale(RES_SCALES[v.res])
  if (boot) return
  const wantFull = v.screen === 'fullscreen'
  const isFull = document.fullscreenElement !== null
  if (wantFull && !isFull) void document.documentElement.requestFullscreen?.().catch(() => {})
  if (!wantFull && isFull) void document.exitFullscreen?.().catch(() => {})
}

const settings = createSettings(uiRoot, {
  onChange: (v) => { applySettings(v) },
  onHome: () => { toTitle() },
  onToggle: (open) => {
    // 열리는 순간 포인터 락을 푼다 — 마우스로 슬라이더를 잡아야 한다
    if (open && document.pointerLockElement) document.exitPointerLock()
  },
})
// 저장된 설정을 부팅 즉시 먹인다 — 첫 프레임이 이미 그 해상도·감도여야 한다
applySettings(settings.values(), true)

const debug = createDebug(uiRoot, stage.renderer)

/**
 * `?freeplay` (또는 `?notimer`) — 시간제한 없이 맵을 둘러보는 임시 모드.
 *
 * 값을 안 받는 플래그라 `URLSearchParams.has` 로 읽는다. 정규식으로 짰다가
 * 단어 경계를 넣는다는 것이 **백스페이스 문자(0x08)** 로 들어가 한 번도 안 맞았다 —
 * 눈으로는 똑같이 보여서 화면만 보고는 못 잡는다.
 */
/**
 * `?obs=all` — **방해요소 전량 활성 디버그 스위치.**
 *
 * 시드는 12종 중 8종만 켠다. 그래서 아주머니나 좀비폰족이 **통째로 없는 판**이 정상적으로
 * 존재하는데, 화면만 보면 "구현이 안 됐다"와 구분이 안 된다. 확인할 때 다 세우는 스위치다.
 */
const ALL_OBS = /[?&]obs=all/.test(location.search)
const FREEPLAY = ((q) => q.has('freeplay') || q.has('notimer'))(
  new URLSearchParams(location.search))
let state: GameState = initialState(resolveSeed(location.search), FREEPLAY, ALL_OBS)
let player: PlayerRig | null = null
let station: Station | null = null
/** P1 — 습득 프롭 + 골드 아웃라인 */
let props: Props | null = null
/** P1 — 할아버지(GP) · 캐리어 승객(CP) */
let actors: Actors | null = null
let shakeUntil = 0
/** 차에 치인 뒤 재판정을 막는 쿨다운(ms). 0 이면 판정 가능. */
let hitCooldownMs = 0
const HIT_COOLDOWN_MS = 1200

/**
 * 관찰 모드에서 대상 종류를 한 줄로 풀어 쓴다 — 처음 보는 사람에게 동사를 알려 준다.
 *
 * 상대 이름은 여기서 안 낸다 — 그건 `t.label` 이 따로 보여준다(`main.ts` 호출부).
 * 그래서 `talk` 문구도 상대를 특정하면 안 된다. `GIFT_STALL_ID`(편의점 매대)가
 * 두 번째 `talk` 대상이 되기 전에는 `talk` = 할아버지뿐이라 "말을 건다"가 맞았지만,
 * 매대에는 말을 걸지 않는다 — 매대·할아버지 둘 다 그대로 쓸 수 있는 동사가 필요하다.
 * `talk` 은 어느 쪽이든 "선택 UI를 연다"는 뜻이라(`systems/interact.ts` `durationOf`
 * 주석 참고) '고른다'로 통일한다.
 */
const OBSERVE_NOTE: Readonly<Record<InteractKind, string>> = {
  pickup: 'E — 줍는다',
  buy: 'E — 산다',
  talk: 'E — 고른다',
  scratch: 'E — 효자손으로 긁는다',
  aside: 'E — "저기요"',
  give: 'E — 건넨다',
  story: 'E — 이야기를 듣는다',
  return: 'E — 맡긴다',
  call: 'E — 호출한다',
  enter: 'E — 들어간다',
  inspect: 'E — 살펴본다',
}

stage.resize()

/** 설정의 "홈으로 돌아가기" — 판을 새로 만들고 **타이틀로** 되돌린다 */
const toTitle = (): void => {
  restart()
  state = { ...state, phase: 'title' }
}

const restart = (): void => {
  recordedEnding = null
  collection.close()
  const seed = (state.seed * 1664525 + 1013904223) >>> 0
  state = initialState(seed, FREEPLAY, ALL_OBS)   // 재시작해도 자유 탐색·디버그 스위치는 유지한다
  prevPos = state.player.pos
  rebuildDynamics(state)
}

/** 소리 트리거 감지용 이전 값 — 상태의 **변화**를 보고 재생한다 */
let prevGateState = state.gates.state
let prevCoins = state.tally.coinsEarned
let prevHits = state.chase.hitCount
let prevTrainState = state.train.state
// ── P2 ──
const ambience = createAmbience()
const footsteps = createFootsteps()
let prevAlert = state.staffAlertMs
let prevZoneHz = 0
/** 발소리·심박은 **누적 시계**로 돈다 — 프레임레이트와 무관한 주기를 만들려면 이 방법뿐이다 */
let stepAcc = 0
let heartAcc = 0

const playSfxFor = (s: GameState, dtMs: number): void => {
  if (s.gates.state === 'open' && prevGateState !== 'open') sfx.gate()
  if (s.tally.coinsEarned > prevCoins) sfx.coin()
  if (s.chase.hitCount > prevHits) sfx.danso()
  if (s.train.state === 'closing' && prevTrainState !== 'closing') sfx.doorWarn()
  // P2 — 열차 접근 안내방송 · 역무원 호루라기
  if (announceOn(s.train.state, prevTrainState)) sfx.announce()
  if (s.staffAlertMs > 0 && prevAlert === 0) sfx.whistle()

  /**
   * 발소리 — 녹음 루프를 **이동 중에만 연다**(`audio/footsteps.ts`).
   *
   * 걸음마다 트리거하지 않는 이유는 소스가 단발이 아니라 연속 보행 루프이기 때문이다.
   * 샘플 로드가 실패하면 **절차 생성 폴백**으로 돌아간다 — 오디오가 실패해도 게임은 돈다.
   */
  const walking = s.phase === 'playing' && s.player.moving && s.player.stallMs <= 0
  if (footsteps.ready()) {
    footsteps.set(walking, s.player.sprinting, stepCutoffOf(s))
  } else if (walking) {
    stepAcc += dtMs
    const period = stepIntervalMs(s.player.sprinting)
    if (stepAcc >= period) { stepAcc %= period; sfx.step(stepKindOf(s)) }
  } else {
    // 멈추면 다음 첫 걸음이 바로 나도록 위상을 거의 채워 둔다
    stepAcc = stepIntervalMs(false) * 0.8
  }

  // 심박 — 잔여 30초 미만에서만
  if (heartbeatOn(s)) {
    heartAcc += dtMs
    const period = heartbeatIntervalMs(s.timeLeftMs)
    if (heartAcc >= period) { heartAcc = 0; sfx.heartbeat(heartIntensity(s.timeLeftMs)) }
  } else {
    heartAcc = 0
  }

  // 앰비언스 — 존 대역만 크로스페이드한다(소스를 갈면 그 순간 끊긴다)
  const hz = ambienceHzOf(s)
  if (hz !== prevZoneHz) { ambience.setZone(hz); prevZoneHz = hz }

  prevGateState = s.gates.state
  prevCoins = s.tally.coinsEarned
  prevHits = s.chase.hitCount
  prevTrainState = s.train.state
  prevAlert = s.staffAlertMs
}

/**
 * 엔딩 기록 — **엔딩 id 가 바뀌는 순간 한 번**만 쓴다.
 * `phase === 'ended'` 로 판정하면 엔딩 화면이 떠 있는 내내 매 프레임 기록된다.
 */
let recordedEnding: string | null = null
const recordIfEnded = (s: GameState): void => {
  if (s.phase !== 'ended' || !s.endingId) { return }
  if (recordedEnding === s.endingId) return
  recordedEnding = s.endingId
  recordEnding(s.endingId, s.boarded ? Math.max(0, s.timeLeftMs) : 0)
}

/**
 * ESC 를 **설정으로 쓸 수 있는가**.
 *
 * ESC 는 이미 네 곳이 먹고 있다(대화 취소·QTE 포기·교체 되돌리기·도감 닫기).
 * 설정은 그 **아무도 안 쓸 때**만 가져간다 — 우선순위를 뒤집으면 대화 도중 ESC 가
 * 설정을 열어 버리고, 플레이어는 취소하려다 일시정지를 만난다.
 */
// ─────────────────── 인트로 ───────────────────

/** 인트로 시작 시각. `null` 이면 인트로가 아니다 */
let introAt: number | null = null
/**
 * E2E 전용 — 인트로 시계를 이 값에 **못 박는다**.
 *
 * 벽시계로 스크럽하면 스크린샷을 찍기까지 흐른 시간만큼 다른 샷이 잡힌다
 * (소프트웨어 래스터에서 한 프레임이 수백 ms 다). 시각을 고정하면 몇 프레임이
 * 걸리든 같은 그림이 나온다.
 */
let introHold: number | null = null
/** 지금 인트로의 **버스 안** 구간인가 — 차량 렌더를 끊는 데 쓴다 */
let introInBus = false
/** 단계별 눈 검사(QA)용 자유 카메라. `null` 이면 평소대로 릭이 카메라를 몬다 */
let freeCamAt: { pos: [number, number, number]; look: [number, number, number] } | null = null

/**
 * 버스 실내 — 인트로에만 존재한다.
 *
 * 게임 중에는 한 번도 안 보이는 물건이라 부팅 때 짓지 않는다. 처음 인트로가
 * 돌 때 한 번 만들고 그 뒤로는 재사용한다(재시작할 때마다 다시 지으면 그때마다
 * 지오메트리를 새로 올린다).
 *
 * 외피는 station GLB 가 이미 갖고 있다. 카메라가 그 안에 들어가면 앞면이 컬링돼
 * 저절로 투명해지므로, 우리가 만들 것은 **안에서 보이는 것들**뿐이다.
 */
let busIn: BusInterior | null = null
/** 인트로 전용 서쪽 도로 연장 — 버스가 달릴 거리를 만든다 */
let westRoad: { root: Object3D; dispose(): void } | null = null
/**
 * 버스 외피 네 조각(`merged:BUS_*`). 실내가 24m 서쪽에서 다가오는 동안에는
 * **숨긴다** — 안 그러면 우리가 탄 버스가 저 앞에 주차된 버스를 향해 달린다.
 */
const busExterior = (): Object3D[] =>
  ['BUS_BODY', 'BUS_GLASS', 'BUS_TRIM', 'BUS_ROOF']
    .map((m) => station?.root.getObjectByName(`merged:${m}`))
    .filter((o): o is Object3D => !!o)
/**
 * 포즈(착석 · 휴대폰). 리그가 로드된 뒤 한 번 만든다 — 본을 이름으로 찾는
 * 작업이라 매 프레임 할 일이 아니다.
 */
let poseRig: PoseRig | null = null
/** 손에 쥔 휴대폰. 팔뚝 본에 매단다 */
let phone: Phone | null = null

const startIntro = (): void => {
  introAt = performance.now()
  state = { ...state, phase: 'intro' }
  intro.show()
  if (!busIn) { busIn = buildBusInterior(); stage.scene.add(busIn.root) }
  if (!westRoad) { westRoad = buildWestRoad(); stage.scene.add(westRoad.root) }
  westRoad.root.visible = true
  // QA — 실내가 외피를 가리는지 A/B 로 가른다
  busIn.root.visible = !/[?&]nointerior/.test(location.search)
  busIn.setDoor(0)
  player?.setVisible(true)
}

/**
 * 인트로를 끝내고 조작권을 넘긴다. 끝까지 본 경우와 건너뛴 경우가 **같은 코드**를
 * 지난다 — 건너뛰기 전용 경로를 따로 두면 거기서만 안 돌아오는 상태가 생긴다.
 */
const endIntro = (): void => {
  introAt = null
  intro.hide()
  introHold = null
  introInBus = false
  phone?.setVisible(false)
  if (westRoad) westRoad.root.visible = false
  for (const o of busExterior()) o.visible = true
  if (busIn) busIn.root.visible = false
  /**
   * ★ 화각을 **반드시** 되돌린다.
   *
   * 인트로는 질주 구간에서 화각을 74° → 85° 로 열었다가 끝에서 정확히 74° 로
   * 닫는다. 그런데 **건너뛰면 그 닫는 프레임을 안 지난다** — 85° 인 채로 조작권이
   * 넘어간다. 그리고 카메라 릭은 이걸 못 고친다: 릭은 자기 내부 `fov` 변수와
   * 목표값을 비교하는데 둘 다 74 라 "바꿀 것이 없다"고 판단하고 카메라를
   * 손대지 않는다. 실제로 화각이 벌어진 채 판이 끝까지 간다.
   */
  applyView()
  state = { ...state, phase: 'playing' }
}

const escIsFree = (s: GameState): boolean =>
  !collection.isOpen() && s.act.dialogId === null && !s.qte.active &&
  !s.swap.active && s.act.busyId === null

/**
 * 포인터 락 중에는 **ESC 키 이벤트가 페이지에 오지 않는다.** 브라우저가 먼저 먹어
 * 락을 풀어 버리기 때문이다(명세대로다). 그래서 "락이 풀렸다"를 ESC 로 읽는다.
 *
 * ⚠ 창 포커스를 잃어도 락은 풀린다. 그때까지 설정을 열면 알트탭 한 번에 게임이
 *   멈춘 채 돌아오게 된다 → `hasFocus()` 로 갈라낸다.
 */
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return
  if (!document.hasFocus()) return
  if (state.phase !== 'playing' && state.phase !== 'boarding') return
  if (!escIsFree(state)) return
  settings.open()
})

const handleMeta = (f: InputFrame): void => {
  // 첫 입력에서 오디오 컨텍스트를 깬다 — 브라우저 자동재생 정책
  if (f.pressStart || f.pressInteract || f.pressRestart) {
    sfx.unlock()
    ambience.start(sfx.context(), sfx.bus())
    void footsteps.load(sfx.context(), sfx.bus(), BASE)
  }
  if (f.pressMute) { const m = sfx.toggleMute(); ambience.setMuted(m) }
  if (f.pressSlot > 0 || f.pressCollection) sfx.click()
  if (f.pressDebug) debug.toggle()
  if (f.pressToggleView) { cameraRig.toggleMode(); applyView() }

  // 도감은 타이틀·엔딩에서만 연다 — 플레이 중에 열면 3분 타이머가 의미를 잃는다
  if (f.pressCollection && (state.phase === 'title' || state.phase === 'ended')) collection.toggle()
  if (collection.isOpen()) {
    if (f.pressCancel) collection.close()
    return                                   // 도감이 열려 있으면 다른 메타 입력을 먹는다
  }

  // 설정이 열려 있으면 ESC 로 닫고 **다른 메타 입력을 전부 먹는다**(멈춘 동안엔 멈춰 있어야 한다)
  if (settings.isOpen()) {
    if (f.pressCancel) settings.close()
    return
  }
  /**
   * 인트로는 **언제나 건너뛸 수 있고, 그 판정이 설정보다 먼저다.**
   *
   * 이 게임은 3분짜리를 반복해 엔딩 17종을 모으는 구조다. 매번 6.6초를 강제로
   * 보여 주면 그 구조가 곧 벌이 된다. ESC·ENTER 어느 쪽이든 받는다 — 급한 사람이
   * 어느 키를 누를지 정해 놓고 기다릴 이유가 없다.
   *
   * ★ 순서가 중요하다. 아래 `settings.open()` 보다 뒤에 두면 ESC 가 설정을 열어
   *   버려서 화면에 적어 둔 `ESC 건너뛰기` 가 거짓말이 된다. 인트로에서 ESC 는
   *   건너뛰기 전용이다.
   */
  if (state.phase === 'intro') {
    if (f.pressCancel || f.pressStart) endIntro()
    return
  }
  if (f.pressCancel && escIsFree(state)) { settings.open(); return }

  if (state.phase === 'title' && f.pressStart) startIntro()
  if (state.phase === 'ended' && f.pressRestart) restart()
}

// ─────────────────── 루프 ───────────────────

let prev = performance.now()
let acc = 0

/** 아직 시뮬에 전달되지 못한 원샷 입력. 아래 프레임 루프 주석 참고 */
type Pending = Pick<InputFrame, 'pressInteract' | 'pressSlot' | 'pressCancel'>
const EMPTY_PENDING: Pending = { pressInteract: false, pressSlot: 0, pressCancel: false }
let pending: Pending = EMPTY_PENDING
/** 직전 시뮬 스텝의 플레이어 위치 — 렌더 보간의 시작점 */
let prevPos = state.player.pos
/** 렌더 보간 on/off — E2E에서 이 테스트가 실제로 저더를 잡는지 확인하는 용도 */
let interpOn = true

const frame = (now: number): void => {
  requestAnimationFrame(frame)

  stage.resize()
  let dt = now - prev
  prev = now
  debug.frame(dt)
  // 탭 백그라운드 복귀 스파이럴 차단 — 없으면 5분 두고 오면 게임이 끝나 있다
  if (dt > MAX_FRAME_MS) dt = STEP_MS
  acc += dt

  const sample = input.sample()
  handleMeta(sample)

  /**
   * 설정이 열려 있으면 **시뮬을 멈춘다.** 렌더는 계속 돈다 — 뒤에 멈춘 화면이 비쳐야
   * "꺼진 것"과 "멈춘 것"이 구분된다.
   * 누적치도 같이 버린다. 안 버리면 닫는 순간 밀린 스텝이 한꺼번에 돌아 3분 타이머가
   * 훅 준다(`MAX_STEPS_PER_FRAME` 이 상한을 씌우지만 몇 스텝은 그대로 흐른다).
   */
  if (settings.isOpen()) { acc = 0; pending = EMPTY_PENDING }

  /**
   * 시뮬에 넘길 시선 방향.
   *
   * `cameraRig.yaw()` 는 **직전 프레임** `update()` 에서 계산된 값이다. 1인칭에서는
   * 그 값이 곧 `input.lookYaw` 이므로 이번 프레임 입력을 그대로 쓰면 한 프레임 빠르다 —
   * 상호작용 조준이 시선과 같은 프레임에 반응한다(예전엔 1프레임 늦어 E2E가 흔들렸다).
   * 3인칭은 오빗이 섞이므로 릭의 값을 쓴다.
   */
  const simYaw = cameraRig.mode() === 'fp' ? sample.lookYaw : cameraRig.yaw()

  /**
   * ★ 원샷 입력(E · 1/2/3 · ESC)은 **보류하고 첫 스텝에만** 실어 보낸다.
   *
   * 고정 스텝 루프와 원샷 입력을 그냥 섞으면 두 방향으로 다 틀린다.
   *
   *  1. **씹힘** — `input.sample()` 은 매 프레임 호출되어 원샷을 소비한다. 그런데
   *     `acc < STEP_MS` 인 프레임에서는 tick이 **0회** 돈다(144Hz 모니터면 프레임이
   *     7ms 라 절반이 그렇다). 그 프레임에 누른 E는 아무 시스템도 못 보고 사라진다.
   *     → 소비되지 않은 원샷을 `pending` 에 모아 다음 tick까지 들고 간다.
   *
   *  2. **중복** — 반대로 한 프레임에 2~5스텝을 돌 때 같은 sample을 모든 스텝에 넘기면
   *     E가 스텝 수만큼 발화한다. 대화가 열리자마자 분기가 선택되거나 습득이 두 번 돈다.
   *     → 첫 스텝만 원샷을 싣고, 나머지 스텝은 비운 프레임을 쓴다.
   *
   * 홀드 입력(WASD·Shift·마우스)은 이 처리가 필요 없다 — 다음 프레임에도 같은 값이 온다.
   */
  pending = {
    pressInteract: pending.pressInteract || sample.pressInteract,
    pressSlot: sample.pressSlot !== 0 ? sample.pressSlot : pending.pressSlot,
    pressCancel: pending.pressCancel || sample.pressCancel,
  }

  const withOneShots: InputFrame = { ...sample, ...pending }
  const noOneShots: InputFrame = {
    ...sample, pressInteract: false, pressSlot: 0, pressCancel: false,
  }

  let steps = 0
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    prevPos = state.player.pos
    state = tick(state, STEP_MS, { input: steps === 0 ? withOneShots : noOneShots, cameraYaw: simYaw })
    acc -= STEP_MS
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0
  // tick이 한 번이라도 돌았으면 보류분은 전달됐다. 0회면 다음 프레임으로 이월한다
  if (steps > 0) pending = EMPTY_PENDING

  /**
   * 렌더 보간 — 시뮬은 고정 60Hz, 렌더는 가변이다.
   * 보간 없이 시뮬 위치를 그대로 그리면 프레임마다 위치가 계단처럼 튄다.
   * 한 프레임에 스텝이 0회 또는 2회 도는 경우가 섞이면 그게 그대로 화면 덜컹거림이 된다.
   * 계획서 §3의 "렌더는 α로 부드럽게 그린다"가 이것이다.
   */
  const alpha = interpOn ? Math.min(1, acc / STEP_MS) : 1
  const cur = state.player.pos
  const renderPos = {
    x: prevPos.x + (cur.x - prevPos.x) * alpha,
    y: prevPos.y + (cur.y - prevPos.y) * alpha,
    z: prevPos.z + (cur.z - prevPos.z) * alpha,
  }

  const dtSec = Math.min(dt, 100) / 1000
  /**
   * 인트로 동안에는 **카메라 릭을 아예 안 돌린다.**
   *
   * 릭을 돌린 뒤 위에 덮어쓰는 방법도 되지만, 릭은 내부에 앵커·오클루전 같은
   * 상태를 들고 감쇠시킨다. 그 상태가 인트로 6.6초를 엉뚱한 값으로 채우면
   * 조작권이 넘어온 순간 카메라가 그 값에서부터 기어 나온다. 아예 안 건드리면
   * 릭은 스폰 기준 초기값 그대로 있다가 이어받는다.
   *
   * 좌표 변환은 `camera-rig.ts` 의 1인칭 분기와 **글자 그대로 같은 식**이다 —
   * 여기서 한 글자라도 달라지면 마지막 프레임이 어긋난다.
   */
  if (freeCamAt) {
    const { pos, look } = freeCamAt
    stage.camera.position.set(pos[0], pos[2], -pos[1])
    stage.camera.lookAt(look[0], look[2], -look[1])
    stage.camera.fov = FPV.fovDeg
    stage.camera.near = 0.08
    stage.camera.updateProjectionMatrix()
  } else if (introAt !== null) {
    const t = introHold ?? now - introAt
    if (t >= INTRO_MS) { endIntro() } else {
      /**
       * 3인칭 구간에서는 **주인공과 버스 실내를 직접 몰아준다.**
       *
       * 시뮬은 인트로 동안 한 발짝도 안 움직인다(`ADVANCE` 가 `playing` 에서만
       * 진행한다). 그래서 리그에 넘길 상태를 `actorAt` 값으로 만들어 준다 —
       * 리그의 클립 선택 규칙(`moving`→Walk · `sprinting`→Sprint)을 그대로 쓰려고
       * 위치만 바꾼 가짜 상태를 넘긴다. 리그를 고쳐 인트로 전용 경로를 내면
       * 게임에서 쓰는 경로와 두 벌이 된다.
       */
      const a = actorAt(t)
      introInBus = a.visible
      const at = { x: a.x, y: a.y, z: a.z }
      player?.setVisible(a.visible)
      if (a.visible) {
        player?.sync({
          ...state,
          phase: 'playing',
          player: {
            ...state.player, pos: at, facing: a.facing,
            moving: a.clip !== 'Idle', sprinting: a.clip === 'Run', grounded: true,
          },
        }, dtSec, at)
        /**
         * ★ `sync()` **뒤에** 접는다. `sync` 안의 `mixer.update()` 가 본 회전을
         *   덮어쓰므로, 앞에서 부르면 아무 일도 안 한 것처럼 보인다.
         */
        if (player && !poseRig) poseRig = makePoseRig(player.root)
        poseRig?.apply({ sit: a.sit, phone: a.phone })
        /**
         * 휴대폰은 **팔뚝 본의 자식**이다 — 포즈가 팔을 들면 같이 따라 올라간다.
         * 붙일 대상은 리그가 로드된 뒤에야 존재하므로 여기서 한 번 건다.
         */
        if (player && !phone) {
          const arm = player.root.getObjectByName('LowerArmR')
          if (arm) { phone = buildPhone(); phone.attachTo(arm) }
        }
        phone?.setVisible(a.phone > 0.02)
      }
      // 버스 안 구간에서만 외피를 숨긴다. ③ 부터는 그 버스를 정면으로 보여줘야 한다
      const inside = t < SHOT.phone
      for (const o of busExterior()) o.visible = !inside
      if (westRoad) westRoad.root.visible = inside
      if (busIn) {
        busIn.root.position.x = busDx(t)
        busIn.setDoor((t - DOORS_MS) / 620)
      }

      const p = poseAt(t)
      stage.camera.position.set(p.x, p.eye, -p.y)
      stage.camera.rotation.order = 'YXZ'
      stage.camera.rotation.set(p.pitch, p.yaw - Math.PI / 2, 0)
      stage.camera.near = 0.08
      stage.camera.fov = p.fov
      stage.camera.updateProjectionMatrix()
      intro.sync(t)
    }
  } else {
    cameraRig.update(state, sample, dtSec, renderPos)
  }
  /**
   * 타이틀에서 배경을 살려 두는 시계.
   *
   * `ADVANCE` 가 `playing`/`boarding` 이 아니면 일찍 빠져나가므로(`reducer.ts`)
   * 타이틀에서는 `lightMs` 가 얼어 있고, 그래서 신호등이 안 바뀌고 차들도 멈춘
   * 신호를 보고 선다 — 정지 사진처럼 보이던 원인이다.
   *
   * ★ 고치는 자리는 그 게이트가 아니라 **여기**다. 게이트를 열면 타이틀에서
   *   제한시간이 흐른다. 렌더에만 쓰는 값을 따로 만들어 넘기면 시뮬은 순수하게
   *   남고 헤드리스 스윕·유닛 테스트도 그대로다.
   */
  const view = state.phase === 'title' || state.phase === 'intro'
    ? { ...state, lightMs: now % TRAFFIC_LIGHT.cycleMs }
    : state
  stage.setMood(view.zone, dtSec)
  station?.sync(view, dtSec, lightIsGreen(view), lightRemainSec(view))
  // 흐름은 **경과 시간** 기준이다. dt 누적으로 굴리면 프레임 흔들림이 그대로 위상 지터가 된다
  guideArrows.update(now / 1000, renderPos)
  // 보행 신호가 녹색이면 횡단보도를 지나는 이면도로 차가 선다(`cars.ts` 교차로 규약)
  if (traffic) {
    /**
     * 지하에서는 통째로 끈다. 안 그러면 승강장에서도 차 8콜 · 38 k 삼각형이 얹힌다
     * (실측: 차를 넣자 Z2~Z5 가 전부 같이 늘었다 — 존 밖인데 계속 그리고 있었다).
     *
     * ★ 인트로에서 버스 안에 있는 동안에도 끈다. 서행 차선이 y 20.5 인데 버스는
     *   y 19.1~21.7 이라 **차가 버스를 관통한다**. 게임 중에는 버스 안에서 볼 일이
     *   없어 드러나지 않던 것이 인트로에서 정면으로 보인다(실측 스크린샷에서
     *   승용차 한 대가 실내 한복판에 서 있었다). 차선을 옮기면 정류장 앞 차도가
     *   비어 보이므로, 안 보이는 3.2초만 끄는 쪽이 싸다.
     */
    traffic.group.visible = renderPos.z > -3 && !(introAt !== null && introInBus)
    traffic.update(dtSec, lightIsGreen(view), lightRemainSec(view))
    /**
     * 차에 치이면 스폰으로. 적신호 차단벽을 걷어낸 대신 들어온 규칙이다.
     *
     * 판정을 **렌더 쪽에서** 하는 이유: 차는 열차와 달리 앞차·신호를 보고 매 프레임
     * 적분하는 물건이라 시간의 순수 함수가 아니다. 시뮬로 끌어오려면 차량 전체를
     * 다시 짜야 하고, 그 대가로 얻는 것은 결정성뿐인데 차는 채점에 안 들어간다.
     * 대신 겹침 계산은 `systems/roadHazard` 로 빼 순수 함수로 두고 단위 테스트로 덮었다.
     *
     * `sinceHit` 쿨다운이 없으면 스폰 직후 같은 프레임 판정이 다시 걸릴 수 있다.
     */
    hitCooldownMs = Math.max(0, hitCooldownMs - dt)
    if (
      state.phase === 'playing' && hitCooldownMs === 0 &&
      Math.abs(state.player.pos.z - FLOOR.L0) < 1.2 &&
      carHits(traffic.bodies(), state.player.pos.x, state.player.pos.y, MOVE.radius)
    ) {
      /**
       * **적신호에 건너다 치이면 그 자리에서 끝난다(E-17).** 보행 녹색이면
       * 예전처럼 스폰으로 되돌린다.
       *
       * 무조건 즉사로 두지 않은 이유: 이 게임은 차도를 막지 않는 대신 대가를
       * 청구한다(GDD §4). 초록불에 건너다 죽는 건 플레이어의 선택이 아니라
       * 사고라, 거기까지 즉사로 만들면 그 원칙이 Z1 에서만 깨진다.
       * 적신호 횡단은 명백한 선택이므로 즉사가 성립한다 — GDD 가 즉사를
       * 허용하는 기준("전부 명백한 선택의 결과")과도 맞는다.
       */
      const p = state.player.pos
      const inCrosswalk =
        p.x >= CROSSWALK.xMin && p.x <= CROSSWALK.xMax &&
        p.y >= CROSSWALK.yMin && p.y <= CROSSWALK.yMax
      // 신호 상태만 보면 **횡단보도 밖**에서 치인 것까지 무단횡단이 된다.
      // 차도 한복판에 서 있다 치이는 것과 신호를 무시하고 건너는 것은 다른 일이다.
      const jaywalking = inCrosswalk && !lightIsGreen(state)
      state = applyAll(state, jaywalking
        ? [
            { t: 'END', endingId: 'E-17' },
            { t: 'FX', kind: 'shake', text: '', lifeMs: 620, value: 1 },
          ]
        : [
            { t: 'RESPAWN' },
            { t: 'FX', kind: 'toast', text: '차에 치였다 — 처음 위치로', lifeMs: 2200, value: 0 },
            { t: 'FX', kind: 'shake', text: '', lifeMs: 420, value: 1 },
          ])
      prevPos = state.player.pos
      hitCooldownMs = HIT_COOLDOWN_MS
    }
  }
  /**
   * ★ 인트로 중에는 **건너뛴다.** 위 인트로 분기가 이미 `actorAt` 값으로 리그를
   *   한 번 동기화했는데, 여기서 진짜 상태로 다시 동기화하면 그 값이 덮여
   *   주인공이 스폰(−58, 24)으로 돌아간다 — 카메라는 버스 안(−62, 20.5)을 보고
   *   있으므로 화면에서는 **그냥 사라진 것처럼** 보인다. 실제로 그랬다.
   */
  if (introAt === null) player?.sync(state, dtSec, renderPos)
  // P1 렌더는 상태를 **읽기만** 한다 — 판정은 전부 systems/ 에 있다
  props?.sync(state, dtSec, now / 1000)
  actors?.sync(state, dtSec)
  playSfxFor(state, dtSec * 1000)
  /**
   * P2 관찰 모드 `Q` — 조준 대상의 상세를 띄우고 화각을 좁힌다(망원 느낌).
   * **시간은 안 멈춘다** — 3분 게임에서 정지는 곧 무한 시간이다(`docs/P2-SPEC.md` §8.2).
   */
  const observing = sample.observe && state.phase === 'playing'
  const wantFov = observing ? FPV.fovDeg - 12 : FPV.fovDeg
  if (Math.abs(stage.camera.fov - wantFov) > 0.05) {
    // 한 번에 튀면 멀미가 난다 — 시정수 0.12s 로 민다
    stage.camera.fov += (wantFov - stage.camera.fov) * Math.min(1, dtSec / 0.12)
    stage.camera.updateProjectionMatrix()
  }
  if (observing) {
    const t = state.act.targetId ? byId(state.act.targetId) : null
    const d = t ? Math.hypot(t.x - state.player.pos.x, t.y - state.player.pos.y) : 0
    hud.setObserve(true,
      t ? t.label : ZONE_NAMES[state.zone],
      t ? `${OBSERVE_NOTE[t.kind] ?? ''} · ${d.toFixed(1)}m` : '조준할 대상이 없다')
  } else {
    hud.setObserve(false, '', '')
  }

  hud.sync(state, sample.locked && cameraRig.mode() === 'fp')
  dialog.sync(state)
  screens.sync(state)
  recordIfEnded(state)
  debug.sync(state)

  // 게이트 거부 화면 흔들림
  const shake = state.fx.find((f) => f.kind === 'shake')
  if (shake) shakeUntil = now + shake.lifeMs
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 220
    stage.camera.position.x += (Math.random() - 0.5) * 0.22 * k
    stage.camera.position.y += (Math.random() - 0.5) * 0.22 * k
  }

  camTrace.push(stage.camera.position.x, now)
  if (camTrace.length > 1200) camTrace.splice(0, 2)

  stage.renderer.render(stage.scene, stage.camera)
}

// ─────────────────── 기동 ───────────────────

const boot = async (): Promise<void> => {
  const [stationResult, playerResult, propsResult, actorsResult] = await Promise.allSettled([
    loadStation(BASE, stage.camera, (d, t) => screens.setLoading(`역사 로딩 ${d} / ${t}`)),
    loadPlayerRig(`${BASE}models/mc_character_rigged.glb`, false, CHAR_SCALE),
    loadProps(BASE),
    loadActors(BASE),
  ])

  if (stationResult.status === 'fulfilled') {
    station = stationResult.value
    stage.scene.add(station.root)
    // 라이트맵이 붙은 존이 있으면 런타임 간접광을 줄인다. 라이트맵이 이미
    // 간접 성분을 담고 있어서 그대로 두면 이중 계산으로 역이 하얗게 날아간다.
    // 아틀라스가 없으면(사이드카 없이 익스포트한 빌드) 1.0 그대로 — 예전 룩.
    stage.setIndirect(station.stats.lightmaps > 0 ? 0.06 : 1)
  } else {
    console.error('[station] GLB 로드 실패 — 그레이박스로 진행합니다', stationResult.reason)
    world.root.visible = true
  }

  if (playerResult.status === 'fulfilled') {
    player = playerResult.value
    stage.scene.add(player.root)
  } else {
    console.error('[player] GLB 로드 실패', playerResult.reason)
  }

  // 프롭·NPC 는 실패해도 게임이 끝까지 돈다 — 판정은 시뮬에 있고 이건 그림이다
  if (propsResult.status === 'fulfilled') {
    props = propsResult.value
    stage.scene.add(props.root)
  } else {
    console.error('[props] items.glb 로드 실패 — 아이템이 안 보입니다', propsResult.reason)
  }
  if (actorsResult.status === 'fulfilled') {
    actors = actorsResult.value
    stage.scene.add(actors.root)
  } else {
    console.error('[actors] NPC GLB 로드 실패 — 할아버지·승객 없이 진행합니다', actorsResult.reason)
  }

  // 차는 **기동 경로에서 뺀다.** 배경이라 늦게 나타나도 무방한데, 로딩을 여기에 묶으면
  // 첫 프레임 부하가 커져 포인터 락 직후 입력 큐가 적체된다 —
  // 실측: 락 직후 300 ms 구간의 시선 이월이 0.0198 → 0.295 rad 로 뛰었다.
  // 못 불러와도 게임은 그대로 돈다.
  if (!new URLSearchParams(location.search).has('notraffic')) {
    void buildTraffic(`${BASE}models/cars/`)
      .then((t) => { traffic = t; stage.scene.add(t.group) })
      .catch((e) => console.error('[traffic] 차량 GLB 로드 실패 — 차 없이 진행합니다', e))
  }

  applyView()
  rebuildDynamics(state)
  screens.hideLoading()
  requestAnimationFrame((t) => { prev = t; requestAnimationFrame(frame) })
}

void boot()

// 테스트 훅 — Playwright에서 상태를 직접 읽고 시간을 스크럽한다
declare global {
  interface Window {
    __game?: {
      state(): GameState
      set(patch: Partial<GameState>): void
      input(f: Partial<InputFrame>): void
      minFps(): number
      stationStats(): { merged: number; dynamic: number } | null
      /** 오디오 컨텍스트가 실제로 살아 있는가 (E2E) */
      sfxReady(): boolean
      /** 지금까지 재생 시도한 소리 수 (E2E — "실제로 울렸는가"의 유일한 관측점) */
      sfxPlays(): number
      sfxMuted(): boolean
      /** 발소리 **샘플**이 로드·디코드됐는가 (E2E) */
      stepsReady(): boolean
      /** 1인칭 시선을 강제한다 (E2E용 — 포인터 락 없이 시점 검증) */
      look(yaw: number, pitch?: number): void
      /**
       * 인트로를 임의 시각으로 돌린다 (E2E — 6.6초를 실시간으로 기다리지 않는다).
       *
       * 소프트웨어 래스터에서는 한 프레임이 수백 ms 라, 벽시계로 기다리면 어느
       * 샷의 프레임이 잡힐지 알 수 없다. **보고 싶은 시각을 직접 지정한다.**
       */
      seekIntro(tMs: number): void
      /** 자유 카메라 — 단계별 눈 검사(QA)용. 월드 좌표로 세우고 한 점을 본다 */
      freeCam(pos: [number, number, number], look: [number, number, number]): void
      /** 인트로 한 프레임의 실측값 — 카메라·주인공이 실제로 어디 있는가 (E2E) */
      introProbe(): {
        cam: [number, number, number]; actor: [number, number, number]
        dist: number; visible: boolean; phone: string
        arm: Record<string, [number, number, number]>
      }
      /** 지금 화면 안에 들어온 게이트 표지 수 (0~6) */
      visibleGates(): number
      mode(): 'fp' | 'tp'
      toggleView(): void
      /** 카메라 위치 이력을 **꺼내고 비운다** — 저더(덜컹거림) 계측용 */
      camTrace(): number[]
      setInterp(on: boolean): void
      /**
       * 화면 좌표(NDC −1..1)에서 레이를 쏴 맞은 메시를 가까운 순으로 돌려준다.
       * 룩을 눈으로만 판단하면 "저 흰 면이 뭐지"에서 매번 헛짚는다 — 이름을 직접 읽는다.
       */
      pick(ndcX?: number, ndcY?: number): { name: string; dist: number; point: [number, number, number] }[]
    }
  }
}

let forcedInput: Partial<InputFrame> | null = null
const rawSample = input.sample.bind(input)
input.sample = (): InputFrame => (forcedInput ? { ...rawSample(), ...forcedInput } : rawSample())

// 렌더 계측 훅 (E2E 예산 검증용)
;(window as unknown as { __renderer?: unknown; __scene?: unknown }).__renderer = stage.renderer
;(window as unknown as { __scene?: unknown }).__scene = stage.scene
// 진단용 — 월드 좌표를 화면 픽셀로 투영해 볼 수 있게 카메라와 벡터 생성자를 노출한다.
;(window as unknown as { __camera?: unknown }).__camera = stage.camera
;(window as unknown as { __V3?: unknown }).__V3 = Vector3

/**
 * 전방축 판정 훅 (E2E 전용) — **머리는 앞으로 기운다.**
 *
 * facing 단위벡터와 (Head − Hips) 수평 성분의 내적. 양수면 모델이 앞을 본다.
 * 리그마다 전방축이 달라(GP 는 −z, MC·CP 는 +z) 눈으로 스크린샷을 판독하다 한 번
 * 틀렸다 — 그래서 숫자로 잠근다(`render/actors.ts` YAW_FIX 주석 참고).
 */
const leanDot = (rootName: string, facing: number): number => {
  let head: Vector3 | null = null
  let hips: Vector3 | null = null
  stage.scene.traverse((o) => {
    if (!(o.name || '').startsWith(rootName)) return
    o.traverse((k) => {
      if (k.name === 'Head') { const v = new Vector3(); k.getWorldPosition(v); head = v }
      if (k.name === 'Hips') { const v = new Vector3(); k.getWorldPosition(v); hips = v }
    })
  })
  if (head === null || hips === null) return NaN
  const h: Vector3 = head
  const p: Vector3 = hips
  // three(x, y, z) → 월드(x, −z)
  return Math.cos(facing) * (h.x - p.x) + Math.sin(facing) * (-h.z + p.z)
}
;(window as unknown as { __leanDot?: unknown }).__leanDot = leanDot
// 시선 방향을 밖에서 읽을 수 있게 — 마우스 경로가 실제로 카메라를 돌리는지 재려면 필요하다
;(window as unknown as { __camera?: unknown }).__camera = stage.camera

const gateFrustum = new Frustum()
const gateMat = new Matrix4()
const gatePoint = new Vector3()

/** 카메라 x와 그 시각(ms) 쌍 — 저더 계측.
 *  위치 차이만 보면 프레임 시간 변동까지 섞이므로 **속도**를 볼 수 있게 시각을 같이 남긴다. */
const camTrace: number[] = []

const pickRay = new Raycaster()
const pickNdc = new Vector2()

window.__game = {
  pick: (ndcX = 0, ndcY = 0) => {
    pickNdc.set(ndcX, ndcY)
    stage.camera.updateMatrixWorld()
    pickRay.setFromCamera(pickNdc, stage.camera)
    pickRay.far = 200
    const roots = [station?.root, player?.root].filter((r) => r !== null && r !== undefined)
    const hits = pickRay.intersectObjects(roots, true)
    return hits.slice(0, 8).map((h) => ({
      name: h.object.name || h.object.type,
      dist: Math.round(h.distance * 100) / 100,
      point: [
        Math.round(h.point.x * 100) / 100,
        Math.round(-h.point.z * 100) / 100,   // three z → 월드 y
        Math.round(h.point.y * 100) / 100,    // three y → 월드 z
      ] as [number, number, number],
    }))
  },
  // 읽으면 비운다 — 순간이동·존 전환이 섞인 구간을 계측에서 떼어내기 위해
  camTrace: () => camTrace.splice(0, camTrace.length),
  setInterp: (on: boolean) => { interpOn = on },
  look: (yaw, pitch = 0) => { forcedInput = { ...(forcedInput ?? {}), lookYaw: yaw, lookPitch: pitch } },
  introProbe: () => {
    const t = introHold ?? 0
    const a = actorAt(t)
    const c = stage.camera.position
    return {
      cam: [c.x, c.y, c.z] as [number, number, number],
      actor: [a.x, a.y, a.z] as [number, number, number],
      dist: Math.hypot(a.x - c.x, -a.y - c.z),
      visible: player?.root.visible ?? false,
      phone: (() => {
        if (!phone) return 'none'
        const v = new Vector3()
        phone.root.getWorldPosition(v)
        return `${phone.root.visible} ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
      })(),
      arm: (() => {
        const out: Record<string, [number, number, number]> = {}
        const v = new Vector3()
        for (const n of ['ShoulderR', 'UpperArmR', 'LowerArmR', 'UpperArmL', 'LowerArmL',
          'Chest', 'Spine', 'Hips']) {
          const o = player?.root.getObjectByName(n)
          if (o) { o.getWorldPosition(v); out[n] = [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] }
        }
        if (phone) { phone.root.getWorldPosition(v); out.phone = [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] }
        // 위팔 본의 로컬 축이 월드에서 어디를 가리키는가 — 회전축을 고르는 근거
        for (const bn of ['UpperArmR', 'UpperArmL', 'LowerArmR']) {
          const b = player?.root.getObjectByName(bn)
          if (!b) continue
          const q = b.getWorldQuaternion(new Quaternion())
          for (const [k, ax] of [['x', new Vector3(1, 0, 0)], ['y', new Vector3(0, 1, 0)],
            ['z', new Vector3(0, 0, 1)]] as const) {
            const d = ax.clone().applyQuaternion(q)
            out[`${bn}.${k}`] = [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)]
          }
        }
        return out
      })(),
    }
  },
  freeCam: (pos, look) => {
    freeCamAt = { pos, look }
  },
  seekIntro: (tMs) => {
    if (introAt === null) startIntro()
    introHold = tMs
  },
  mode: () => cameraRig.mode(),
  toggleView: () => { cameraRig.toggleMode(); applyView() },
  visibleGates: () => {
    stage.camera.updateMatrixWorld()
    gateMat.multiplyMatrices(stage.camera.projectionMatrix, stage.camera.matrixWorldInverse)
    gateFrustum.setFromProjectionMatrix(gateMat)
    let n = 0
    for (const g of GATES) {
      gatePoint.set((GATE_BODY.xMin + GATE_BODY.xMax) / 2, GATE_LAMP_Z, -g.y)
      if (gateFrustum.containsPoint(gatePoint)) n++
    }
    return n
  },
  state: () => state,
  set: (patch) => { state = { ...state, ...patch } },
  input: (f) => { forcedInput = Object.keys(f).length ? f : null },
  minFps: () => debug.minFps(),
  stationStats: () => station?.stats ?? null,
  sfxReady: () => sfx.ready(),
  sfxPlays: () => sfx.plays(),
  sfxMuted: () => sfx.muted(),
  stepsReady: () => footsteps.ready(),
}

export { EMPTY_INPUT }
