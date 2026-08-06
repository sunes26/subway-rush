/**
 * S17 — 역무원(OBS-13) · 비상게이트 3경로 (`docs/P2-TECH-PLAN.md` §4 S17)
 */

import { describe, expect, it } from 'vitest'
import { byId } from '../../src/data/interactables'
import { EMERGENCY, STAFF } from '../../src/data/tuning'
import { EMERGENCY_GATE, FLOOR } from '../../src/data/world'
import type { FlagId, GameState } from '../../src/state/types'
import { emergencyDoor } from '../../src/systems/emergency'
import { inVision, staffAt } from '../../src/systems/staff'
import { holdFor, put, start, tap, wait, yawTo } from './_pilot'

const armed = (patch: Partial<GameState> = {}): GameState =>
  start(7, { obstacles: ['OBS-13'], ...patch })

/** 역무원 바로 앞(시야 정면 2m)에 세운다 */
const inFront = (s: GameState): GameState => {
  const pose = staffAt(s.elapsedMs)
  return put(s, pose.x + 2 * Math.cos(pose.facing), pose.y + 2 * Math.sin(pose.facing), FLOOR.B1)
}

describe('S17-1 순찰', () => {
  it('구간을 왕복한다', () => {
    const xs = Array.from({ length: 40 }, (_, i) => staffAt(i * (STAFF.periodMs / 40)).x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(STAFF.xMin - 0.01)
    expect(Math.max(...xs)).toBeLessThanOrEqual(STAFF.xMax + 0.01)
    expect(Math.max(...xs) - Math.min(...xs), '실제로 움직인다').toBeGreaterThan(6)
  })

  it('시야가 이동 방향을 따라 뒤집힌다', () => {
    expect(staffAt(STAFF.periodMs * 0.25).facing).toBe(0)
    expect(staffAt(STAFF.periodMs * 0.75).facing).toBeCloseTo(Math.PI, 5)
  })

  it('주기가 반복된다 — 시간의 순수 함수', () => {
    expect(staffAt(1234).x).toBeCloseTo(staffAt(1234 + STAFF.periodMs).x, 6)
  })
})

describe('S17-2 시야콘 · 적발', () => {
  it('정면 2m 는 시야 안, 뒤 2m 는 밖', () => {
    const s = armed()
    const pose = staffAt(s.elapsedMs)
    const front = put(s, pose.x + 2 * Math.cos(pose.facing), pose.y, FLOOR.B1)
    const back = put(s, pose.x - 2 * Math.cos(pose.facing), pose.y, FLOOR.B1)
    expect(inVision(front)).toBe(true)
    expect(inVision(back)).toBe(false)
  })

  it('사거리 밖이면 정면이어도 안 보인다', () => {
    const s = armed()
    const pose = staffAt(s.elapsedMs)
    const far = put(s, pose.x + STAFF.visionM + 2, pose.y, FLOOR.B1)
    expect(inVision(far)).toBe(false)
  })

  it('요금을 냈으면 시야 안이어도 아무 일이 없다', () => {
    const s = holdFor(inFront(armed()), {}, 120)
    expect(s.endingId).toBeNull()
    expect(s.staffAlertMs).toBe(0)
  })

  it('부정통과 + 시야 → 0.8초 뒤 E-09', () => {
    const s = holdFor(inFront(armed({ flags: ['FARE_EVADED'] })), {}, 120)
    expect(s.endingId).toBe('E-09')
  })

  it('0.8초 전에는 아직 안 걸린다 — 도망칠 유예가 있다', () => {
    const early = holdFor(inFront(armed({ flags: ['FARE_EVADED'] })), {}, 20)   // 0.33s
    expect(early.endingId).toBeNull()
    expect(early.staffAlertMs).toBeGreaterThan(0)
  })

  it('시야에서 벗어나면 경보가 식는다', () => {
    const s0 = inFront(armed({ flags: ['FARE_EVADED'] }))
    const warmed = holdFor(s0, {}, 20)
    expect(warmed.staffAlertMs).toBeGreaterThan(0)
    const pose = staffAt(warmed.elapsedMs)
    const fled = holdFor(put(warmed, pose.x, pose.y + STAFF.visionM + 4, FLOOR.B1), {}, 3)
    expect(fled.staffAlertMs).toBe(0)
    expect(fled.endingId).toBeNull()
  })

  it('OBS-13 이 비활성인 시드에서는 순찰이 아무 판정도 안 한다', () => {
    const s = holdFor(inFront(start(7, { obstacles: [], flags: ['FARE_EVADED'] })), {}, 200)
    expect(s.endingId).toBeNull()
  })
})

describe('S17-3~5 비상게이트 3경로', () => {
  const atWindow = (patch: Partial<GameState>): GameState => {
    const it = byId('OBJ-13-RETURN')!
    const s = put(start(7, patch), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s, it.x, it.y)
    return wait(tap(s, { pressInteract: true }, yaw), 2600, yaw)
  }

  it('지갑 반납 — 문이 열리고 양심 +2', () => {
    const s = atWindow({ inventory: ['I-11', null, null] })
    expect(s.flags).toContain('EMERGENCY_OPEN')
    expect(s.flags).toContain('WALLET_RETURNED')
    expect(s.scores.conscience).toBe(2)
    expect(s.inventory[0], '지갑은 맡겼다').toBeNull()
  })

  it('지갑이 없으면 사유만 나온다', () => {
    const s = atWindow({ inventory: [null, null, null] })
    expect(s.flags).not.toContain('EMERGENCY_OPEN')
    expect(s.act.denyText.length).toBeGreaterThan(0)
  })

  it('인터폰 — 문이 열리고 −15s, 양심은 그대로', () => {
    const it = byId('OBJ-22')!
    const s0 = put(start(7), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    const s = wait(tap(s0, { pressInteract: true }, yaw), 1400, yaw)
    expect(s.flags).toContain('EMERGENCY_OPEN')
    expect(s.scores.conscience).toBe(0)
    expect(180_000 - s.timeLeftMs).toBeGreaterThan(EMERGENCY.intercomWaitMs)
  })

  it('닫혀 있으면 문이 충돌체다 · 열리면 사라진다', () => {
    expect(emergencyDoor(start(7)).length).toBe(1)
    expect(emergencyDoor(start(7, { flags: ['EMERGENCY_OPEN'] })).length).toBe(0)
  })

  it('열린 문을 잔액 부족으로 지나면 부정승차 — 양심 −3', () => {
    const s0 = start(7, { flags: ['EMERGENCY_OPEN'] as FlagId[], cardBalance: 0 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(true)
    expect(s.flags).toContain('FARE_EVADED')
    expect(s.scores.conscience).toBe(-3)
  })

  it('잔액이 있으면 자동으로 낸다 — 부정승차가 아니다', () => {
    const s0 = start(7, { flags: ['EMERGENCY_OPEN'] as FlagId[], cardBalance: 2200 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(true)
    expect(s.flags).not.toContain('FARE_EVADED')
    expect(s.cardBalance).toBe(2200 - EMERGENCY.fare)
  })

  it('문이 닫혀 있으면 통과되지 않는다', () => {
    const s0 = start(7, { cardBalance: 0 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x - 1.2, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(false)
  })
})

describe('S17-6 잔액 0원 시드에서도 완주 경로가 있다', () => {
  it('인터폰만으로 개찰을 통과할 수 있다 (자판기 없이)', () => {
    const it = byId('OBJ-22')!
    let s = put(start(3, { cardBalance: 0 }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s, it.x, it.y)
    s = wait(tap(s, { pressInteract: true }, yaw), 1400, yaw)
    expect(s.flags).toContain('EMERGENCY_OPEN')
    s = holdFor(put(s, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed, '요금이 없어도 문은 지날 수 있다').toBe(true)
  })
})
