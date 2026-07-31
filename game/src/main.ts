/**
 * 부트스트랩 · 고정스텝 루프 · 씬 조립.
 *
 * 시뮬은 고정 60Hz, 렌더는 가변. 프레임이 튀어도 물리와 밸런스가 튀지 않는다.
 */

import { Frustum, Matrix4, Raycaster, Vector2, Vector3 } from 'three'
import { createInput, EMPTY_INPUT, type InputFrame } from './core/input'
import { resolveSeed } from './core/rng'
import { CAMERA, FPV, MAX_FRAME_MS, MAX_STEPS_PER_FRAME, STEP_MS } from './data/tuning'
import { GATES, GATE_BODY, GATE_LAMP_Z, TRAFFIC_LIGHT } from './data/world'
import { createCameraRig } from './render/camera-rig'
import { createGuideArrows } from './render/guide-arrows'
import { loadPlayerRig, type PlayerRig } from './render/player-rig'
import { createStage } from './render/scene'
import { loadStation, type Station } from './render/station'
import { buildWorld } from './render/world-builder'
import { initialState } from './state/reducer'
import type { GameState } from './state/types'
import { lightIsGreen, rebuildDynamics, tick } from './systems/tick'
import { createDebug } from './ui/debug'
import { createHud } from './ui/hud'
import { createScreens } from './ui/screens'

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

const hud = createHud(uiRoot)
const screens = createScreens(uiRoot)
const debug = createDebug(uiRoot, stage.renderer)

let state: GameState = initialState(resolveSeed(location.search))
let player: PlayerRig | null = null
let station: Station | null = null
let shakeUntil = 0

stage.resize()

const restart = (): void => {
  const seed = (state.seed * 1664525 + 1013904223) >>> 0
  state = initialState(seed)
  prevPos = state.player.pos
  rebuildDynamics(state)
}

const handleMeta = (f: InputFrame): void => {
  if (f.pressDebug) debug.toggle()
  if (f.pressToggleView) { cameraRig.toggleMode(); applyView() }
  if (state.phase === 'title' && f.pressStart) state = { ...state, phase: 'playing' }
  if (state.phase === 'ended' && f.pressRestart) restart()
}

/** 신호등 잔여 시간(초) — 현재 위상에서 다음 전환까지 */
const lightRemainSec = (s: GameState): number =>
  (lightIsGreen(s) ? TRAFFIC_LIGHT.greenMs - s.lightMs : TRAFFIC_LIGHT.cycleMs - s.lightMs) / 1000

// ─────────────────── 루프 ───────────────────

let prev = performance.now()
let acc = 0
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

  let steps = 0
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    prevPos = state.player.pos
    state = tick(state, STEP_MS, { input: sample, cameraYaw: cameraRig.yaw() })
    acc -= STEP_MS
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0

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
  cameraRig.update(state, sample, dtSec, renderPos)
  stage.setMood(state.zone, dtSec)
  station?.sync(state, dtSec, lightIsGreen(state), lightRemainSec(state))
  // 흐름은 **경과 시간** 기준이다. dt 누적으로 굴리면 프레임 흔들림이 그대로 위상 지터가 된다
  guideArrows.update(now / 1000, renderPos)
  player?.sync(state, dtSec, renderPos)
  hud.sync(state, sample.locked && cameraRig.mode() === 'fp')
  screens.sync(state)
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
  const [stationResult, playerResult] = await Promise.allSettled([
    loadStation(BASE, stage.camera, (d, t) => screens.setLoading(`역사 로딩 ${d} / ${t}`)),
    loadPlayerRig(`${BASE}models/mc_character_rigged.glb`, false),
  ])

  if (stationResult.status === 'fulfilled') {
    station = stationResult.value
    stage.scene.add(station.root)
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
      /** 1인칭 시선을 강제한다 (E2E용 — 포인터 락 없이 시점 검증) */
      look(yaw: number, pitch?: number): void
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
}

export { EMPTY_INPUT }
