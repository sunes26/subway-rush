/**
 * 헤드리스 자동조종 — P1 시나리오 테스트의 공용 장치.
 *
 * P0에서는 각 테스트가 `start`/`put`/`run` 을 파일마다 다시 정의했고, 완주 시나리오는
 * `traverse.test.ts` 안에만 있었다. P1은 "효자손 체인 완주"처럼 **여러 존을 지나는
 * 시나리오**를 여러 테스트가 공유하므로 여기로 승격한다.
 *
 * 이 파일이 없으면 각 테스트가 200줄짜리 입력 스크립트를 손으로 만든다.
 */

import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { tick } from '../../src/systems/tick'

export const STEP = 1000 / 60

export const start = (seed = 1, patch: Partial<GameState> = {}): GameState =>
  ({ ...initialState(seed), phase: 'playing', ...patch })

export const put = (s: GameState, x: number, y: number, z: number): GameState =>
  ({ ...s, player: { ...s.player, pos: { x, y, z }, vel: { x: 0, y: 0 } } })

export const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over })

export const run = (s: GameState, script: readonly InputFrame[], yaw = 0): GameState =>
  script.reduce((acc, input) => tick(acc, STEP, { input, cameraYaw: yaw }), s)

/** n 프레임 동안 같은 입력 */
export const holdFor = (s: GameState, over: Partial<InputFrame>, steps: number, yaw = 0): GameState =>
  run(s, Array.from({ length: steps }, () => frame(over)), yaw)

/** ms 동안 무입력 대기 */
export const wait = (s: GameState, ms: number, yaw = 0): GameState =>
  holdFor(s, {}, Math.max(1, Math.round(ms / STEP)), yaw)

/** 한 프레임만 눌렀다 뗀다 — 원샷 입력의 정석 */
export const tap = (s: GameState, over: Partial<InputFrame>, yaw = 0): GameState =>
  run(s, [frame(over)], yaw)

/** (x, y)를 바라보는 cameraYaw. 조준 판정 테스트의 기준 */
export const yawTo = (s: GameState, x: number, y: number): number =>
  Math.atan2(y - s.player.pos.y, x - s.player.pos.x)

/**
 * 목표를 향하는 이동 입력.
 * cameraYaw = 0 기준으로 movement 변환이 dirX = moveY, dirY = −moveX 이므로
 * 원하는 월드 방향 (wx, wy) → moveY = wx, moveX = −wy.
 */
export const seek = (s: GameState, tx: number, ty: number, sprint = false): InputFrame => {
  const dx = tx - s.player.pos.x
  const dy = ty - s.player.pos.y
  const m = Math.hypot(dx, dy) || 1
  return frame({ moveY: dx / m, moveX: -dy / m, sprint })
}

export const distTo = (s: GameState, x: number, y: number): number =>
  Math.hypot(s.player.pos.x - x, s.player.pos.y - y)

/**
 * 목표 반경 안까지 걸어간다. 도달 못하면 `ok: false`.
 *
 * **끼임 탈출이 있다.** 목표를 향해 직진만 하면 기둥 하나에 영구히 걸린다 —
 * Z2 기둥(x 12/24/36/48 × y 10/20)이 정확히 그 함정이고, 스윕에서 19건이 여기서 멈췄다.
 * 사람은 벽에 부딪히면 옆으로 돌아간다. 진척이 0.4초 없으면 ±70° 로 틀어 0.35초 걷는다.
 */
export const goto = (
  s: GameState, x: number, y: number,
  opts: { r?: number; maxSec?: number; sprint?: boolean } = {},
): { s: GameState; ok: boolean; sec: number } => {
  const r = opts.r ?? 1.2
  const limit = Math.round((opts.maxSec ?? 20) * 60)
  let cur = s
  let best = distTo(cur, x, y)
  let stale = 0
  let detour = 0
  let side = 1
  for (let i = 0; i < limit; i++) {
    const d = distTo(cur, x, y)
    if (d < r) return { s: cur, ok: true, sec: (i * STEP) / 1000 }
    if (d < best - 0.02) { best = d; stale = 0 } else stale++
    if (stale > 24 && detour === 0) { detour = 21; side = -side; stale = 0 }

    let input = seek(cur, x, y, opts.sprint ?? false)
    if (detour > 0) {
      detour--
      // 목표 방향을 side·70° 만큼 틀어 옆으로 빠져나간다
      const a = Math.atan2(y - cur.player.pos.y, x - cur.player.pos.x) + side * 1.22
      input = frame({ moveY: Math.cos(a), moveX: -Math.sin(a), sprint: opts.sprint ?? false })
    }
    cur = tick(cur, STEP, { input, cameraYaw: 0 })
  }
  return { s: cur, ok: distTo(cur, x, y) < r, sec: (limit * STEP) / 1000 }
}

/** 대상 앞까지 가서 조준하고 `E`. 습득/구매의 완료까지 기다린다 */
export const interactAt = (
  s: GameState, x: number, y: number,
  opts: { stand?: number; settleMs?: number } = {},
): GameState => {
  const stand = opts.stand ?? 1.1
  const r = goto(s, x, y, { r: stand + 0.3 })
  let cur = r.s
  const yaw = yawTo(cur, x, y)
  cur = tap(cur, { pressInteract: true }, yaw)
  return wait(cur, opts.settleMs ?? 900, yaw)
}

/**
 * 자판기 QTE 를 리듬에 맞춰 통과한다.
 *
 * 스트로크당 `QTE.strokeTravel` 을 `QTE.beatMs` 에 맞춰 나눠 넣는다 —
 * 사람이 실제로 하는 동작(등속 왕복)과 같은 모양이다.
 */
export const playQte = (s: GameState, opts: { perfect?: boolean } = {}): GameState => {
  const perfect = opts.perfect ?? true
  let cur = s
  let dir = 1
  for (let stroke = 0; stroke < 8 && cur.qte.active; stroke++) {
    // 판정창 중앙(beat 소진 직전)에 임계를 넘게 만든다. 등속 8프레임 = 133ms 는
    // 창(±180ms) 안이므로, 남은 시간을 무입력으로 채워 위상을 맞춘다.
    const idleMs = perfect ? 420 : 0
    cur = wait(cur, idleMs)
    if (!cur.qte.active) break
    const steps = 8
    const per = (230 / steps) * dir
    cur = holdFor(cur, { qteDelta: per }, steps)
    dir = -dir
  }
  return cur
}
