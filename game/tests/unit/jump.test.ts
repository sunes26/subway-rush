import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { JUMP, TOTAL_TIME_MS } from '../../src/data/tuning'
import { CROSSWALK, FLOOR, GATES, PAID_AREA_X } from '../../src/data/world'
import { initialState, rollSeed } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { hold, tick } from '../../src/systems/tick'

const STEP = 1000 / 60
const start = (seed = 1): GameState => ({ ...initialState(seed), phase: 'playing' })
const put = (s: GameState, x: number, y: number, z: number): GameState =>
  ({ ...s, player: { ...s.player, pos: { x, y, z }, vel: { x: 0, y: 0 }, vz: 0, grounded: true } })
const run = (s: GameState, script: readonly InputFrame[], yaw = 0): GameState =>
  script.reduce((acc, input) => tick(acc, STEP, { input, cameraYaw: yaw }), s)

describe('점프 — 물리', () => {
  it('정점 높이가 설계값(0.55m 내외)에 든다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    const z0 = s.player.pos.z
    let apex = 0
    for (let i = 0; i < 90; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, jump: i < 3 }, cameraYaw: 0 })
      apex = Math.max(apex, s.player.pos.z - z0)
    }
    const expected = (JUMP.speed * JUMP.speed) / (2 * JUMP.gravity)
    expect(apex).toBeGreaterThan(expected * 0.9)
    expect(apex).toBeLessThan(expected * 1.15)
    expect(apex, `정점 ${apex.toFixed(2)}m`).toBeLessThan(0.62)
  })

  it('반드시 착지하고 접지 상태로 돌아온다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    s = run(s, hold({ jump: true }, 3))
    expect(s.player.grounded).toBe(false)
    s = run(s, hold({}, 90))
    expect(s.player.grounded).toBe(true)
    expect(s.player.pos.z).toBeCloseTo(FLOOR.B2, 2)
    expect(s.player.vz).toBe(0)
  })

  it('공중에서 두 번 뛰지 않는다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    let peak = 0
    const z0 = s.player.pos.z
    for (let i = 0; i < 60; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, jump: true }, cameraYaw: 0 })
      peak = Math.max(peak, s.player.pos.z - z0)
    }
    expect(peak).toBeLessThan(0.62)
  })

  it('스태미너를 소모한다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    const before = s.player.stamina
    s = run(s, hold({ jump: true }, 3))
    // 점프 중에도 회복(+14/s)이 함께 돌므로 정확히 −6이 되지는 않는다
    const spent = before - s.player.stamina
    expect(spent).toBeGreaterThan(JUMP.stamina * 0.8)
    expect(spent).toBeLessThan(JUMP.stamina * 1.2)
  })

  it('공중에서도 수평 이동이 된다 (에어 컨트롤)', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    const x0 = s.player.pos.x
    s = run(s, hold({ jump: true, moveY: 1 }, 3))
    s = run(s, hold({ moveY: 1 }, 20))
    expect(s.player.grounded).toBe(false)
    expect(s.player.pos.x).toBeGreaterThan(x0 + 1)
  })
})

describe('점프 — 레벨을 깨지 않는다', () => {
  it('개찰구 플랩(1.15m)을 뛰어넘을 수 없다', () => {
    const seed = 3
    const roll = rollSeed(seed)
    const bad = GATES.map((g) => g.id).find((id) => !roll.workingIds.includes(id)) as number
    const g = GATES.find((x) => x.id === bad)!
    let s = put(start(seed), 58.6, g.y, FLOOR.B1)
    // 점프하며 계속 밀어붙인다
    for (let i = 0; i < 60 * 8; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, moveY: 1, jump: true }, cameraYaw: 0 })
      expect(s.gates.passed, '고장 게이트를 도약으로 통과했다').toBe(false)
    }
    expect(s.player.pos.x).toBeLessThan(PAID_AREA_X)
  })

  it('적신호 차단(1.1m)을 뛰어넘을 수 없다', () => {
    // 신호등 위상을 적색 구간으로 고정
    let s = { ...put(start(), CROSSWALK.xMin - 1.2, 27.5, FLOOR.L0), lightMs: 20_000 }
    for (let i = 0; i < 60 * 6; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, moveY: 1, jump: true }, cameraYaw: 0 })
      // 적색 유지 (주기 30s · 녹 12s → 12~30s 구간)
      s = { ...s, lightMs: 20_000 }
    }
    expect(s.player.pos.x, '적신호를 뛰어넘었다').toBeLessThan(CROSSWALK.xMin)
  })

  it('점프해도 맵 밖으로 못 나간다', () => {
    let s = put(start(), 150, 6, FLOOR.B2)
    let r = 12345
    const rand = (): number => { r = (r * 1664525 + 1013904223) >>> 0; return r / 0xffffffff }
    for (let i = 0; i < 60 * 20; i++) {
      s = tick(s, STEP, {
        input: { ...EMPTY_INPUT, moveX: Math.round(rand() * 2) - 1, moveY: Math.round(rand() * 2) - 1, jump: rand() > 0.7 },
        cameraYaw: rand() * Math.PI * 2,
      })
      expect(Number.isFinite(s.player.pos.z)).toBe(true)
      expect(s.player.pos.z).toBeLessThan(FLOOR.B2 + 1.0)
      expect(s.player.pos.z).toBeGreaterThan(FLOOR.B2 - 0.5)
    }
  })

  it('타이틀 화면에서는 점프해도 아무 일이 없다', () => {
    let s = initialState(1)
    const z0 = s.player.pos.z
    s = run(s, hold({ jump: true }, 60))
    expect(s.player.pos.z).toBe(z0)
    expect(s.timeLeftMs).toBe(TOTAL_TIME_MS)
  })
})
