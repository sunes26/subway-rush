/**
 * 부트스트랩 · 고정스텝 루프 · 씬 조립.
 *
 * 시뮬은 고정 60Hz, 렌더는 가변. 프레임이 튀어도 물리와 밸런스가 튀지 않는다.
 */

import { createInput, EMPTY_INPUT, type InputFrame } from './core/input'
import { resolveSeed } from './core/rng'
import { MAX_FRAME_MS, MAX_STEPS_PER_FRAME, STEP_MS } from './data/tuning'
import { createCameraRig } from './render/camera-rig'
import { buildDecals } from './render/decals'
import { createGateRig } from './render/gate-rig'
import { loadPlayerRig, type PlayerRig } from './render/player-rig'
import { createStage } from './render/scene'
import { createTrainRig } from './render/train-rig'
import { buildWorld } from './render/world-builder'
import { TRAFFIC_LIGHT } from './data/world'
import { initialState } from './state/reducer'
import type { GameState } from './state/types'
import { lightIsGreen, rebuildDynamics, tick } from './systems/tick'
import { createDebug } from './ui/debug'
import { createHud } from './ui/hud'
import { createScreens } from './ui/screens'

const canvas = document.getElementById('gl') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement

const stage = createStage(canvas)
const input = createInput(canvas)
const world = buildWorld(true)
const cameraRig = createCameraRig(stage.camera, world.occluders)
const gateRig = createGateRig(world.lamps)
const trainRig = createTrainRig()
const decals = buildDecals()
stage.scene.add(world.root, decals.root, gateRig.root, trainRig.root)

const hud = createHud(uiRoot)
const screens = createScreens(uiRoot)
const debug = createDebug(uiRoot, stage.renderer)

let state: GameState = initialState(resolveSeed(location.search))
let player: PlayerRig | null = null
let shakeUntil = 0

stage.resize()

const restart = (): void => {
  const seed = (state.seed * 1664525 + 1013904223) >>> 0
  state = initialState(seed)
  rebuildDynamics(state)
}

const handleMeta = (f: InputFrame): void => {
  if (f.pressDebug) debug.toggle()
  if (state.phase === 'title' && f.pressStart) state = { ...state, phase: 'playing' }
  if (state.phase === 'ended' && f.pressRestart) restart()
}

// ─────────────────── 루프 ───────────────────

let prev = performance.now()
let acc = 0

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
    state = tick(state, STEP_MS, { input: sample, cameraYaw: cameraRig.yaw() })
    acc -= STEP_MS
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0

  const dtSec = Math.min(dt, 100) / 1000
  cameraRig.update(state, sample, dtSec)
  stage.setMood(state.zone, dtSec)
  gateRig.sync(state, dtSec)
  decals.gateSigns.sync(state.gates.workingIds)
  decals.traffic.sync(
    lightIsGreen(state),
    (lightIsGreen(state)
      ? TRAFFIC_LIGHT.greenMs - state.lightMs
      : TRAFFIC_LIGHT.cycleMs - state.lightMs) / 1000,
  )
  trainRig.sync(state)
  player?.sync(state, dtSec)
  hud.sync(state)
  screens.sync(state)
  debug.sync(state)

  // 게이트 거부 화면 흔들림 (S7에서 강화)
  const shake = state.fx.find((f) => f.kind === 'shake')
  if (shake) shakeUntil = now + shake.lifeMs
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 220
    stage.camera.position.x += (Math.random() - 0.5) * 0.22 * k
    stage.camera.position.y += (Math.random() - 0.5) * 0.22 * k
  }

  stage.renderer.render(stage.scene, stage.camera)
}

// ─────────────────── 기동 ───────────────────

const boot = async (): Promise<void> => {
  try {
    player = await loadPlayerRig(`${import.meta.env.BASE_URL}models/mc_character_rigged.glb`, true)
    stage.scene.add(player.root)
  } catch (err) {
    console.error('[player] GLB 로드 실패 — 캡슐 대체로 진행합니다', err)
  }
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
    }
  }
}

let forcedInput: Partial<InputFrame> | null = null
const rawSample = input.sample.bind(input)
input.sample = (): InputFrame => (forcedInput ? { ...rawSample(), ...forcedInput } : rawSample())

// 렌더 계측 훅 (E2E 예산 검증용)
;(window as unknown as { __renderer?: unknown; __scene?: unknown }).__renderer = stage.renderer
;(window as unknown as { __scene?: unknown }).__scene = stage.scene

window.__game = {
  state: () => state,
  set: (patch) => { state = { ...state, ...patch } },
  input: (f) => { forcedInput = Object.keys(f).length ? f : null },
  minFps: () => debug.minFps(),
}

export { EMPTY_INPUT }
