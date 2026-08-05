import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { resolveEnding } from '../../src/data/endings'
import { FARE, GATE, SPEED, STAMINA, TOTAL_TIME_MS, TRAIN } from '../../src/data/tuning'
import { DOOR_XS, FLOOR, GATES, PAID_AREA_X } from '../../src/data/world'
import { initialState, rollSeed } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { hold, tick } from '../../src/systems/tick'
import { doorsPassable, trainAt } from '../../src/systems/train'

const STEP = 1000 / 60

const start = (seed = 1): GameState => ({ ...initialState(seed), phase: 'playing' })

const put = (s: GameState, x: number, y: number, z: number): GameState =>
  ({ ...s, player: { ...s.player, pos: { x, y, z }, vel: { x: 0, y: 0 } } })

const run = (s: GameState, script: readonly InputFrame[], yaw = 0): GameState =>
  script.reduce((acc, input) => tick(acc, STEP, { input, cameraYaw: yaw }), s)

/** cameraYaw = π/2 → 전방(W)이 월드 +y. 승강장에서 열차 쪽으로 걷는 방향. */
const NORTH = Math.PI / 2

// ────────────────────────── S2 이동 ──────────────────────────

describe('S2-1 이동 속도', () => {
  /** 마찰 없는 직선 구간(Z5 승강장)에서 x축 거리를 잰다. yaw=0 → forward = +x */
  const dash = (sprint: boolean, seconds: number): number => {
    let s = put(start(), 90, 6, FLOOR.B2)
    const x0 = s.player.pos.x
    s = run(s, hold({ moveY: 1, sprint }, Math.round(seconds * 60)))
    return s.player.pos.x - x0
  }

  it('걷기 정상 속도 5.0 m/s에 수렴한다', () => {
    // 가속 구간(0.12s)을 감안해 3초 주행에서 평균 속도를 본다
    const d = dash(false, 3)
    expect(d / 3).toBeGreaterThan(4.75)
    expect(d / 3).toBeLessThanOrEqual(SPEED.walk + 0.01)
  })

  it('스프린트가 걷기보다 명확히 빠르다', () => {
    expect(dash(true, 2)).toBeGreaterThan(dash(false, 2) * 1.4)
  })

  it('입력이 없으면 0.3초 안에 멈춘다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    s = run(s, hold({ moveY: 1 }, 60))
    s = run(s, hold({}, 18))
    expect(Math.hypot(s.player.vel.x, s.player.vel.y)).toBeLessThan(0.1)
  })
})

describe('S2-2 프레임레이트 독립', () => {
  it('60fps와 30fps에서 이동 거리가 같다 (±1%)', () => {
    const at = (dt: number, steps: number): number => {
      let s = put(start(), 90, 6, FLOOR.B2)
      for (let i = 0; i < steps; i++) s = tick(s, dt, { input: { ...EMPTY_INPUT, moveY: 1 }, cameraYaw: 0 })
      return s.player.pos.x - 90
    }
    const a = at(1000 / 60, 120)   // 2.0s
    const b = at(1000 / 30, 60)    // 2.0s
    expect(Math.abs(a - b) / a).toBeLessThan(0.01)
  })
})

describe('S2-4 스태미너', () => {
  it('스프린트로 0에 도달하면 잠기고, 30 회복 후 풀린다', () => {
    let s = put(start(), 90, 6, FLOOR.B2)
    s = run(s, hold({ moveY: 1, sprint: true }, Math.ceil((100 / STAMINA.drainPerSec) * 60) + 20))
    expect(s.player.stamina).toBe(0)
    expect(s.player.sprintLocked).toBe(true)

    // 잠긴 동안엔 스프린트해도 걷기 속도다
    const before = s.player.pos.x
    s = run(s, hold({ moveY: 1, sprint: true }, 60))
    expect(s.player.pos.x - before).toBeLessThan(SPEED.walk * 1.05)

    // 가만히 있으면 회복되어 잠금이 풀린다
    s = run(s, hold({}, Math.ceil((STAMINA.unlockAt / STAMINA.regenPerSec + 1.2) * 60)))
    expect(s.player.sprintLocked).toBe(false)
    expect(s.player.stamina).toBeGreaterThanOrEqual(STAMINA.unlockAt)
  })
})

// ────────────────────────── S3 타이머 ──────────────────────────

describe('S3-1 타이머', () => {
  it('60초 시뮬 후 오차가 ±0.1s 이내다', () => {
    let s = start()
    for (let i = 0; i < 3600; i++) s = tick(s, STEP, { input: EMPTY_INPUT, cameraYaw: 0 })
    expect(Math.abs(s.timeLeftMs - (TOTAL_TIME_MS - 60_000))).toBeLessThan(100)
  })

  it('타이틀 화면에서는 시간이 흐르지 않는다', () => {
    let s = initialState(1)
    for (let i = 0; i < 600; i++) s = tick(s, STEP, { input: EMPTY_INPUT, cameraYaw: 0 })
    expect(s.timeLeftMs).toBe(TOTAL_TIME_MS)
  })
})

// ────────────────────────── S4 개찰구 ──────────────────────────

/** 게이트 앞에 세우고 태그가 끝날 때까지 동쪽으로 민다. */
/**
 * 게이트 단독 검증용 — **잔액을 요금 이상으로 강제한다.**
 *
 * P0에서는 `BALANCE_POOL` 이 `[1600, 2200]` 이라 강제가 필요 없었다. P1에서 GDD §8.3
 * 원본으로 원복하면서 **60% 시드가 요금 미달**이 됐다(그게 효자손 체인의 존재 이유다).
 * 이 테스트가 재려는 것은 개찰구 상태 기계지 잔액 경제가 아니므로 여기서만 고정한다.
 * 잔액 부족 경로는 바로 아래 `S4-6 잔액 부족` 케이스가 따로 덮는다.
 */
const tryGate = (seed: number, gateId: number, steps = 200, balance = 2200): GameState => {
  const g = GATES.find((x) => x.id === gateId)
  if (!g) throw new Error('bad gate')
  let s = put({ ...start(seed), cardBalance: balance }, 58.6, g.y, FLOOR.B1)
  s = run(s, hold({ moveY: 1 }, steps))   // yaw=0 → +x
  return s
}

describe('S4 개찰구', () => {
  it('S4-1 정상 게이트는 시드 50개에서 100% 통과한다', () => {
    let pass = 0
    for (let seed = 1; seed <= 50; seed++) {
      const roll = rollSeed(seed)
      const ok = roll.workingIds[0] as number
      const s = tryGate(seed, ok, 260)
      if (s.gates.passed && s.player.pos.x >= PAID_AREA_X) pass++
    }
    expect(pass).toBe(50)
  })

  it('S4-2 고장 게이트는 시드 50개에서 0% 통과한다', () => {
    let leak = 0
    for (let seed = 1; seed <= 50; seed++) {
      const roll = rollSeed(seed)
      const bad = GATES.map((g) => g.id).find((id) => !roll.workingIds.includes(id)) as number
      const s = tryGate(seed, bad, 260)
      if (s.gates.passed || s.player.pos.x >= PAID_AREA_X) leak++
    }
    expect(leak).toBe(0)
  })

  it('S4-3 램프 색은 시드 결과의 직접 투영이다 (별도 상태 없음)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const roll = rollSeed(seed)
      expect(roll.workingIds.length).toBeGreaterThanOrEqual(1)
      expect(roll.workingIds.length).toBeLessThanOrEqual(2)
      for (const id of roll.workingIds) expect(GATES.some((g) => g.id === id)).toBe(true)
    }
  })

  it('S4-4 오답 1회당 정확히 8.0s 차감', () => {
    const seed = 3
    const roll = rollSeed(seed)
    const bad = GATES.map((g) => g.id).find((id) => !roll.workingIds.includes(id)) as number
    const g = GATES.find((x) => x.id === bad)!
    let s = put(start(seed), 58.6, g.y, FLOOR.B1)
    const t0 = s.timeLeftMs
    const steps = 90
    s = run(s, hold({ moveY: 1 }, steps))
    expect(s.gates.lastReject).toBe('broken')
    // 경과 시간(steps × 16.67ms) 외에 정확히 8초가 더 빠졌다
    const extra = t0 - s.timeLeftMs - steps * STEP
    expect(Math.abs(extra - GATE.brokenPenaltyMs)).toBeLessThan(1)
  })

  it('S4-4 거부 시 1.6m 후퇴한다', () => {
    const seed = 3
    const roll = rollSeed(seed)
    const bad = GATES.map((g) => g.id).find((id) => !roll.workingIds.includes(id)) as number
    const g = GATES.find((x) => x.id === bad)!
    let s = put(start(seed), 58.6, g.y, FLOOR.B1)
    let prevX = s.player.pos.x
    let jumped = 0
    for (let i = 0; i < 90; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, moveY: 1 }, cameraYaw: 0 })
      if (prevX - s.player.pos.x > 1.0) jumped = prevX - s.player.pos.x
      prevX = s.player.pos.x
    }
    expect(jumped).toBeGreaterThan(1.0)
  })

  it('S4-5 쿨다운 3.0s 동안 재시도할 수 없다', () => {
    const seed = 3
    const roll = rollSeed(seed)
    const bad = GATES.map((g) => g.id).find((id) => !roll.workingIds.includes(id)) as number
    const g = GATES.find((x) => x.id === bad)!
    let s = put(start(seed), 58.6, g.y, FLOOR.B1)
    s = run(s, hold({ moveY: 1 }, 40))
    expect(s.gates.attempts).toBe(1)
    expect(s.gates.cooldownMs).toBeGreaterThan(0)
    // 쿨다운 안에서 다시 밀어붙여도 시도 횟수가 늘지 않는다
    s = run(s, hold({ moveY: 1 }, 100))
    expect(s.gates.attempts).toBe(1)
  })

  it('S4-6 통과 시 정확히 요금만큼 차감된다', () => {
    const seed = 11
    const roll = rollSeed(seed)
    const ok = roll.workingIds[0] as number
    const s = tryGate(seed, ok, 260, 2200)
    expect(s.gates.passed).toBe(true)
    expect(s.cardBalance).toBe(2200 - FARE)
  })

  it('S4-6 잔액 부족이면 정상 게이트도 통과하지 못한다', () => {
    const seed = 11
    const roll = rollSeed(seed)
    const ok = roll.workingIds[0] as number
    const g = GATES.find((x) => x.id === ok)!
    let s = put({ ...start(seed), cardBalance: 900 }, 58.6, g.y, FLOOR.B1)
    s = run(s, hold({ moveY: 1 }, 200))
    expect(s.gates.passed).toBe(false)
    expect(s.gates.lastReject).toBe('low')
  })

  it('S4-7 모든 시드에 정상 게이트가 최소 1개 존재한다 (소프트락 불가)', () => {
    for (let seed = 0; seed < 2000; seed++) {
      expect(rollSeed(seed).workingIds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('S4-9 안내 LED는 약 60% 시드에서 표시된다', () => {
    let n = 0
    for (let seed = 0; seed < 2000; seed++) if (rollSeed(seed).ledHint) n++
    const rate = n / 2000
    expect(rate).toBeGreaterThan(0.55)
    expect(rate).toBeLessThan(0.65)
  })

  /**
   * S9-10 — P0의 "잔액은 항상 요금 이상" 테스트를 **대체한다.**
   *
   * P0은 충전 수단이 없어 풀을 `[1600, 2200]` 으로 좁혀 뒀다. P1에서 자판기 3대가
   * 들어왔으므로 GDD §8.3 원본으로 원복했다. 여기서 재는 것은 **"60% 시드에서
   * 효자손 체인이 강제된다"** 는 설계 의도 그 자체다 — 이 수치가 무너지면
   * 프로젝트의 얼굴인 체인이 60%가 아니라 0%의 플레이어에게만 보인다.
   */
  it('S9-10 초기 잔액이 요금 미달인 시드가 60%다 (효자손 체인 강제 비율)', () => {
    let short = 0
    for (let seed = 0; seed < 2000; seed++) {
      if (rollSeed(seed).cardBalance < FARE) short++
    }
    const rate = short / 2000
    expect(rate, `미달 비율 ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.55)
    expect(rate, `미달 비율 ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.65)
  })

  it('S9-10 잔액 풀이 GDD §8.3 원본 5종이다', () => {
    const seen = new Set<number>()
    for (let seed = 0; seed < 2000; seed++) seen.add(rollSeed(seed).cardBalance)
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 900, 1250, 1600, 2200])
  })
})

// ────────────────────────── S5 열차 ──────────────────────────

describe('S5-4 열차 스케줄', () => {
  const cases: readonly [number, string][] = [
    [0, 'incoming'],
    [167_900, 'incoming'],
    [168_100, 'arriving'],
    [171_900, 'arriving'],
    [172_100, 'open'],
    [179_900, 'open'],
    [180_100, 'closing'],
    [181_100, 'closing'],
    [181_300, 'closed'],
    [181_900, 'closed'],
    [182_100, 'departed'],
  ]
  for (const [t, want] of cases) {
    it(`t=${(t / 1000).toFixed(1)}s → ${want}`, () => expect(trainAt(t).state).toBe(want))
  }

  it('문은 타이머 0 이후에도 1.2초 더 통과 가능하다 (E-01의 자비)', () => {
    expect(doorsPassable(trainAt(TRAIN.closeStartMs + 100))).toBe(true)
    expect(doorsPassable(trainAt(TRAIN.closeDoneMs + 1))).toBe(false)
  })

  it('열차는 시간의 순수 함수다 (같은 t → 같은 상태)', () => {
    for (const t of [0, 50_000, 170_000, 180_500, 190_000]) {
      expect(trainAt(t)).toEqual(trainAt(t))
    }
  })
})

describe('S5-5~8 탑승 판정', () => {
  /** 문이 열린 시점으로 점프시킨 뒤 문 앞에 세운다 */
  const atDoor = (doorX: number, y: number, elapsed = 174_000): GameState => {
    const s = start(5)
    return put({ ...s, elapsedMs: elapsed, timeLeftMs: TOTAL_TIME_MS - elapsed, train: trainAt(elapsed) },
      doorX, y, FLOOR.B2)
  }

  it('S5-5 32개 문 전부에서 탑승할 수 있다', () => {
    for (const x of DOOR_XS) {
      const s = run(atDoor(x, 11.0), hold({ moveY: 1 }, 60), NORTH)
      expect(s.boarded, `door x=${x}`).toBe(true)
    }
  })

  it('S5-6 문이 닫힌 뒤에는 탑승할 수 없다', () => {
    const s = run(atDoor(DOOR_XS[0] as number, 11.0, 181_500), hold({ moveY: 1 }, 60), NORTH)
    expect(s.boarded).toBe(false)
  })

  it('S5-7 문이 아닌 곳(차체 측면)으로는 진입할 수 없다', () => {
    const between = (DOOR_XS[0] as number) + 2   // 문 사이 벽면
    const s = run(atDoor(between, 11.0), hold({ moveY: 1 }, 90), NORTH)
    expect(s.boarded).toBe(false)
    expect(s.player.pos.y).toBeLessThan(12.0)
  })

  it('S5-8 +y 입력 없이 문 앞에 서 있어도 탑승하지 않는다', () => {
    const s = run(atDoor(DOOR_XS[4] as number, 11.9), hold({}, 120), NORTH)
    expect(s.boarded).toBe(false)
  })

  it('S5-1 에스컬레이터는 입력 없이도 B2로 내려간다', () => {
    /**
     * P1에서 O-03 캐리어 승객(`CROWD-CP`)이 이 진입부를 막는다 — 그게 설계다.
     * 이 테스트가 재는 것은 **이송 속도**이므로 이미 비켜선 상태에서 잰다.
     * 막힘 자체는 `crowd.test.ts` (S11-1)가 따로 증명한다.
     */
    const cleared = start()
    let s = put({ ...cleared, act: { ...cleared.act, consumed: ['ACT-CP'] } }, 95.9, 2.2, FLOOR.B1)
    s = run(s, hold({}, 60 * 25))
    expect(s.player.pos.z).toBeCloseTo(FLOOR.B2, 1)
    expect(s.player.pos.x).toBeGreaterThan(119)
  })

  it('S5-2 계단은 직접 이동으로 B2에 도달한다', () => {
    let s = put(start(), 95.9, 6.7, FLOOR.B1)
    s = run(s, hold({ moveY: 1 }, 60 * 12))
    expect(s.player.pos.z).toBeCloseTo(FLOOR.B2, 1)
  })

  it('S5-3 경사면에서 z가 떨리지 않는다 (프레임간 Δz < 0.15m)', () => {
    let s = put(start(), 95.9, 6.7, FLOOR.B1)
    let prevZ = s.player.pos.z
    let maxJump = 0
    for (let i = 0; i < 60 * 10; i++) {
      s = tick(s, STEP, { input: { ...EMPTY_INPUT, moveY: 1 }, cameraYaw: 0 })
      maxJump = Math.max(maxJump, Math.abs(s.player.pos.z - prevZ))
      prevZ = s.player.pos.z
    }
    expect(maxJump).toBeLessThan(0.15)
  })
})

// ────────────────────────── S6 엔딩 ──────────────────────────

describe('S6-1 엔딩 판정', () => {
  /**
   * P1에서 엔딩이 2종 → 6종이 됐다. "탑승"만으로는 더 이상 E-01이 아니다 —
   * 잔여 30s 이상이면 E-02(여유로운 출근)가 우선순위에서 이긴다.
   * E-01은 **그 사이 구간**의 엔딩이다. 6종 전체 표는 `ending6.test.ts` 가 덮는다.
   */
  it('탑승 + 잔여 1~30초 → E-01', () => {
    const s = { ...start(), boarded: true, timeLeftMs: 12_000 }
    expect(resolveEnding(s).id).toBe('E-01')
  })
  it('미탑승 → E-06', () => {
    expect(resolveEnding(start()).id).toBe('E-06')
  })
  it('시간 초과 후 열차가 떠나면 게임이 끝난다', () => {
    let s = { ...start(), elapsedMs: 181_800, timeLeftMs: -1_800 }
    s = run(s, hold({}, 40))
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-06')
  })
  it('탑승 후 열차가 떠나면 탑승 계열 엔딩으로 끝난다', () => {
    const elapsed = 174_000
    let s = put({ ...start(5), elapsedMs: elapsed, timeLeftMs: TOTAL_TIME_MS - elapsed, train: trainAt(elapsed) },
      DOOR_XS[3] as number, 11.0, FLOOR.B2)
    s = run(s, hold({ moveY: 1 }, 60), NORTH)
    expect(s.boarded).toBe(true)
    s = run(s, hold({}, 60 * 10))
    expect(s.phase).toBe('ended')
    // t=174s 탑승이면 잔여 6초 → E-01. 경계값이 바뀌면 E-04까지 허용된다
    expect(['E-01', 'E-04']).toContain(s.endingId)
  })
})

// ────────────────────────── A-5 퍼즈 ──────────────────────────

describe('A-5 랜덤 입력 퍼즈 — 소프트락·맵 이탈 없음', () => {
  it('시드 5개 × 30초 랜덤 입력에서 맵을 벗어나지 않는다', () => {
    for (let seed = 1; seed <= 5; seed++) {
      let s = start(seed)
      let r = seed * 7919
      const rand = (): number => { r = (r * 1664525 + 1013904223) >>> 0; return r / 0xffffffff }
      for (let i = 0; i < 1800; i++) {
        const input: InputFrame = {
          ...EMPTY_INPUT,
          moveX: Math.round(rand() * 2) - 1,
          moveY: Math.round(rand() * 2) - 1,
          sprint: rand() > 0.6,
        }
        s = tick(s, STEP, { input, cameraYaw: rand() * Math.PI * 2 })
        const { x, y, z } = s.player.pos
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
        expect(x).toBeGreaterThan(-70)
        expect(x).toBeLessThan(210)
        expect(y).toBeGreaterThan(-2)
        expect(y).toBeLessThan(36)
        expect(z).toBeLessThanOrEqual(0.01)
        expect(z).toBeGreaterThanOrEqual(FLOOR.B2 - 0.01)
      }
    }
  })
})
