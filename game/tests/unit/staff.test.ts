/**
 * S17 — 역무원(OBS-13) · 비상게이트 3경로 (`docs/P2-TECH-PLAN.md` §4 S17)
 */

import { describe, expect, it } from 'vitest'
import { byId, INTERCOM_ID, PATROL_STAFF_ID } from '../../src/data/interactables'
import { EMERGENCY, FARE, STAFF } from '../../src/data/tuning'
import { EMERGENCY_GATE, FLOOR, GATES, GATE_TRIGGER_X } from '../../src/data/world'
import type { FlagId, GameState } from '../../src/state/types'
import { emergencyDoor } from '../../src/systems/emergency'
import { greetingFor, patrolStaffTarget } from '../../src/systems/interact'
import { inVision, patrolPeriodMs, staffAt } from '../../src/systems/staff'
import { holdFor, put, start, tap, wait, yawTo } from './_pilot'

const armed = (patch: Partial<GameState> = {}): GameState =>
  start(7, { obstacles: ['OBS-13'], ...patch })

/** 역무원 진행 방향 0.9m 앞에 세운다 — 적발 거리(2m) 안. 유예가 0이라 한 프레임이면 끝난다 */
const inFront = (s: GameState, m = 0.9): GameState => {
  const pose = staffAt(s.elapsedMs)
  return put(s, pose.x + m * Math.cos(pose.facing), pose.y + m * Math.sin(pose.facing), FLOOR.B1)
}

const XS = STAFF.path.map((p) => p[0])
const YS = STAFF.path.map((p) => p[1])

describe('S17-1 순찰', () => {
  it('사각 루프를 벗어나지 않는다', () => {
    const poses = Array.from({ length: 80 }, (_, i) => staffAt(i * (patrolPeriodMs / 80)))
    for (const p of poses) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...XS) - 0.01)
      expect(p.x).toBeLessThanOrEqual(Math.max(...XS) + 0.01)
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...YS) - 0.01)
      expect(p.y).toBeLessThanOrEqual(Math.max(...YS) + 0.01)
    }
    // 왕복이 아니라 루프다 — 두 축 모두 실제로 움직인다
    const xs = poses.map((p) => p.x)
    const ys = poses.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(6)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20)
  })

  it('속도가 일정하다 — 같은 시간이면 같은 거리', () => {
    const step = 200
    const gaps = Array.from({ length: 40 }, (_, i) => {
      const a = staffAt(i * patrolPeriodMs / 40)
      const b = staffAt(i * patrolPeriodMs / 40 + step)
      return Math.hypot(b.x - a.x, b.y - a.y)
    })
    // 꼭짓점을 낀 구간은 직선거리가 짧아지므로 상한만 본다(2.6 m/s × 0.2s = 0.52m)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(STAFF.speedMps * (step / 1000) + 1e-6)
  })

  it('전방축이 이동 방향을 따라간다', () => {
    const p = staffAt(patrolPeriodMs * 0.02)                 // 첫 변: −y 진행
    expect(p.facing).toBeCloseTo(-Math.PI / 2, 3)
    const q = staffAt(patrolPeriodMs * 0.6)                  // 반대편 변: +y 진행
    expect(q.facing).toBeCloseTo(Math.PI / 2, 3)
  })

  it('주기가 반복된다 — 시간의 순수 함수', () => {
    expect(staffAt(1234).x).toBeCloseTo(staffAt(1234 + patrolPeriodMs).x, 6)
    expect(staffAt(1234).y).toBeCloseTo(staffAt(1234 + patrolPeriodMs).y, 6)
  })
})

describe('S17-2 적발 판정 — 정면 + 2m · 즉발', () => {
  it('정면 0.6m 는 걸리고, 뒤 0.6m 는 안 걸린다', () => {
    const s = armed()
    const pose = staffAt(s.elapsedMs)
    const d = 0.6
    const front = put(s, pose.x + d * Math.cos(pose.facing), pose.y + d * Math.sin(pose.facing), FLOOR.B1)
    const back = put(s, pose.x - d * Math.cos(pose.facing), pose.y - d * Math.sin(pose.facing), FLOOR.B1)
    expect(inVision(front)).toBe(true)
    expect(inVision(back)).toBe(false)
  })

  it('적발 거리를 넘으면 정면이어도 안 걸린다', () => {
    const s = armed()
    const pose = staffAt(s.elapsedMs)
    const d = STAFF.visionM + 0.5
    const far = put(s, pose.x + d * Math.cos(pose.facing), pose.y + d * Math.sin(pose.facing), FLOOR.B1)
    expect(inVision(far)).toBe(false)
  })

  it('요금을 냈으면 시야 안이어도 아무 일이 없다', () => {
    const s = holdFor(inFront(armed()), {}, 120)
    expect(s.endingId).toBeNull()
    expect(s.staffAlertMs).toBe(0)
  })

  it('부정통과 + 정면 → 첫 프레임에 E-09. 유예가 없다', () => {
    const s = holdFor(inFront(armed({ flags: ['FARE_EVADED'] })), {}, 1)
    expect(s.endingId).toBe('E-09')
    expect(s.flags).toContain('BUSTED')
  })

  it('판정 밖이면 몇 초를 서 있어도 아무 일이 없다 — 즉발이라 더 그렇다', () => {
    const s0 = armed({ flags: ['FARE_EVADED'] })
    const pose = staffAt(s0.elapsedMs)
    // 순찰선에서 옆으로 크게 비켜 선다(루프 안쪽/바깥 어느 변에도 안 닿는 거리)
    const aside = put(s0, pose.x + 6, pose.y - 6, FLOOR.B1)
    const s = holdFor(aside, {}, 120)
    expect(s.endingId).toBeNull()
    expect(s.staffAlertMs).toBe(0)
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

  it('지갑 반납 — 문이 열린다', () => {
    const s = atWindow({ inventory: ['I-11', null, null] })
    expect(s.flags).toContain('EMERGENCY_OPEN')
    expect(s.flags).toContain('WALLET_RETURNED')
    expect(s.inventory[0], '지갑은 맡겼다').toBeNull()
  })

  it('지갑이 없으면 사유만 나온다', () => {
    const s = atWindow({ inventory: [null, null, null] })
    expect(s.flags).not.toContain('EMERGENCY_OPEN')
    expect(s.act.denyText.length).toBeGreaterThan(0)
  })

  /**
   * 인터폰은 이제 **선택지 있는 대화**다(디렉터 지시 2026-08-10). 예전엔 `E` 한 번에
   * −15초를 물고 무조건 열렸다 — 아래 테스트들이 그 거래가 되살아나지 않게 지킨다.
   */
  const atIntercom = (patch: Partial<GameState> = {}): { s: GameState; yaw: number } => {
    const it = byId(INTERCOM_ID)!
    const s0 = put(start(7, patch), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    return { s: tap(s0, { pressInteract: true }, yaw), yaw }
  }

  it('인터폰 — E 는 대화창만 연다 (문은 아직 안 열린다)', () => {
    const { s } = atIntercom()
    expect(s.act.dialogId).toBe(INTERCOM_ID)
    expect(s.flags).not.toContain('EMERGENCY_OPEN')
  })

  it('[1] 정중히 부탁 — 문이 열리고 시간은 안 깎인다', () => {
    const { s: opened, yaw } = atIntercom()
    const s = tap(opened, { pressSlot: 1 }, yaw)
    expect(s.flags).toContain('EMERGENCY_OPEN')
    // 예전 −15s 통행료가 사라졌다는 것이 이 줄의 전부다
    expect(180_000 - s.timeLeftMs).toBeLessThan(2_000)
  })

  it('[3] 재촉 — 거절당하고 무례로 기록된다', () => {
    const { s: opened, yaw } = atIntercom()
    const s = tap(opened, { pressSlot: 3 }, yaw)
    expect(s.flags).not.toContain('EMERGENCY_OPEN')
    expect(s.flags).toContain('INTERCOM_DENIED')
    expect(s.flags).toContain('INTERCOM_RUDE')
  })

  it('[2] 둘러대기 — 거절당하지만 무례는 아니다', () => {
    const { s: opened, yaw } = atIntercom()
    const s = tap(opened, { pressSlot: 2 }, yaw)
    expect(s.flags).toContain('INTERCOM_DENIED')
    expect(s.flags).not.toContain('INTERCOM_RUDE')
  })

  it('거절당해도 다시 걸어 사과하면 열린다 — 되돌릴 수 없는 실패가 아니다', () => {
    const { s: opened, yaw } = atIntercom()
    const denied = tap(opened, { pressSlot: 3 }, yaw)          // 재촉 → 거절
    const closed = tap(denied, { pressInteract: true }, yaw)   // 반응 대사를 닫는다
    const again = tap(closed, { pressInteract: true }, yaw)    // 다시 건다
    expect(again.act.dialogId).toBe(INTERCOM_ID)
    const s = tap(again, { pressSlot: 1 }, yaw)                // 사과
    expect(s.flags).toContain('EMERGENCY_OPEN')
  })

  it('통화 결과에 따라 다음 인사말이 갈린다', () => {
    const fresh = start(7)
    const rude = start(7, { flags: ['INTERCOM_DENIED', 'INTERCOM_RUDE'] as FlagId[] })
    const lied = start(7, { flags: ['INTERCOM_DENIED'] as FlagId[] })
    const lines = [fresh, rude, lied].map((x) => greetingFor(x, INTERCOM_ID))
    expect(new Set(lines).size, '세 상태가 서로 다른 대사를 쓴다').toBe(3)
    // 순찰 역무원도 같은 이력을 읽는다 — 인터폰 너머의 목소리가 그 사람이다
    expect(greetingFor(rude, PATROL_STAFF_ID)).not.toBe(greetingFor(fresh, PATROL_STAFF_ID))
  })

  it('닫혀 있으면 문이 충돌체다 · 열리면 사라진다', () => {
    expect(emergencyDoor(start(7)).length).toBe(1)
    expect(emergencyDoor(start(7, { flags: ['EMERGENCY_OPEN'] })).length).toBe(0)
  })

  it('열린 문을 잔액 부족으로 지나면 부정승차 플래그가 선다', () => {
    const s0 = start(7, { flags: ['EMERGENCY_OPEN'] as FlagId[], cardBalance: 0 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(true)
    expect(s.flags).toContain('FARE_EVADED')
  })

  it('잔액이 있으면 자동으로 낸다 — 부정승차가 아니다', () => {
    const s0 = start(7, { flags: ['EMERGENCY_OPEN'] as FlagId[], cardBalance: 2200 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(true)
    expect(s.flags).not.toContain('FARE_EVADED')
    expect(s.cardBalance).toBe(2200 - EMERGENCY.fare)
  })

  /**
   * 회귀 — 개찰구에서 요금을 냈지만 통과 시간 안에 못 건넌 사람.
   * 돈은 나갔고 `passed` 는 false 라, 예전엔 잔액만 보고 부정승차로 몰았다(→ E-09).
   */
  it('개찰구에서 이미 냈으면 비상게이트로 나가도 부정승차가 아니다', () => {
    const s0 = start(7, {
      cardBalance: FARE,
      flags: ['EMERGENCY_OPEN'] as FlagId[],
      obstacles: ['OBS-13'],
    })
    const g = GATES.find((x) => x.id === s0.gates.workingIds[0])!
    const tagged = wait(put(s0, (GATE_TRIGGER_X.min + GATE_TRIGGER_X.max) / 2, g.y, FLOOR.B1), 500)
    expect(tagged.gates.farePaid, '태그 성공 = 납부').toBe(true)
    expect(tagged.cardBalance).toBe(0)

    const lapsed = wait(tagged, 2600)                    // 통과 시간을 넘겨 문이 다시 닫힌다
    expect(lapsed.gates.passed).toBe(false)

    const out = holdFor(put(lapsed, EMERGENCY_GATE.x + 1.2, EMERGENCY_GATE.y, FLOOR.B1), {}, 3)
    expect(out.gates.passed).toBe(true)
    expect(out.flags).not.toContain('FARE_EVADED')
  })

  it('이미 낸 사람에게 요금을 또 물지 않는다', () => {
    const s0 = start(7, { cardBalance: FARE * 2, flags: ['EMERGENCY_OPEN'] as FlagId[] })
    const g = GATES.find((x) => x.id === s0.gates.workingIds[0])!
    const tagged = wait(put(s0, (GATE_TRIGGER_X.min + GATE_TRIGGER_X.max) / 2, g.y, FLOOR.B1), 500)
    const out = holdFor(put(wait(tagged, 2600), EMERGENCY_GATE.x + 1.2, EMERGENCY_GATE.y, FLOOR.B1), {}, 3)
    expect(out.cardBalance, '차감은 개찰구 한 번뿐').toBe(FARE)
  })

  it('문이 닫혀 있으면 통과되지 않는다', () => {
    const s0 = start(7, { cardBalance: 0 })
    const s = holdFor(put(s0, EMERGENCY_GATE.x - 1.2, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed).toBe(false)
  })
})

describe('S17-7 순찰 역무원 말 걸기', () => {
  it('OBS-13 이 켜진 판에서만 대상이 된다 — 몸이 없으면 프롬프트도 없다', () => {
    expect(patrolStaffTarget(armed())).not.toBeNull()
    expect(patrolStaffTarget(start(7, { obstacles: [] }))).toBeNull()
  })

  it('자리가 순찰을 따라 움직인다 — 정적 테이블이면 못 하는 일', () => {
    const s = armed()
    const now = patrolStaffTarget(s)!
    const later = patrolStaffTarget({ ...s, elapsedMs: s.elapsedMs + patrolPeriodMs / 4 })!
    // 루프라 x 만 보면 안 된다 — 1/4 주기는 통째로 y 변 위일 수 있다
    expect(Math.hypot(later.x - now.x, later.y - now.y)).toBeGreaterThan(1)
  })

  it('E 로 대화창이 열리고, 고르면 대답이 나온다', () => {
    const s0 = inFront(armed())
    const pose = staffAt(s0.elapsedMs)
    const yaw = yawTo(s0, pose.x, pose.y)
    const opened = tap(s0, { pressInteract: true }, yaw)
    expect(opened.act.dialogId).toBe(PATROL_STAFF_ID)
    const s = tap(opened, { pressSlot: 2 }, yaw)
    expect(s.act.dialogChoice).toBe(2)
    // 길 안내는 상태를 안 바꾼다 — 순찰 구간은 이미 개찰구 안쪽이다
    expect(s.flags).not.toContain('EMERGENCY_OPEN')
  })
})

describe('S17-6 잔액 0원 시드에서도 완주 경로가 있다', () => {
  it('인터폰만으로 개찰을 통과할 수 있다 (자판기 없이)', () => {
    const it = byId(INTERCOM_ID)!
    let s = put(start(3, { cardBalance: 0 }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s, it.x, it.y)
    s = tap(tap(s, { pressInteract: true }, yaw), { pressSlot: 1 }, yaw)
    expect(s.flags).toContain('EMERGENCY_OPEN')
    s = holdFor(put(s, EMERGENCY_GATE.x, EMERGENCY_GATE.y, FLOOR.B1), { moveY: 1 }, 60)
    expect(s.gates.passed, '요금이 없어도 문은 지날 수 있다').toBe(true)
  })
})
