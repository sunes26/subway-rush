/**
 * 마우스 스킵 회귀 테스트.
 *
 * 저더 때와 같은 함정을 피한다 — "필터를 켜면 통과한다"가 아니라
 * **필터를 끄면 실패하는가**를 먼저 확인한다. 그래서 각 테스트는
 * 필터 없는 경로(raw)와 필터 경로(filtered)를 같은 입력으로 나란히 돌린다.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOOK, SETTLE_MS, SPIKE_ABS,
  isSpike, pushLook, readLook, setLocked,
  type LookState,
} from '../../src/core/look'

/** 이벤트 목록을 프레임 단위로 나눠 흘려 넣고, 프레임별 출력 dx를 모은다. */
const run = (frames: readonly (readonly number[])[], startMs = 1000): number[] => {
  let s = setLocked(EMPTY_LOOK, true, 0)
  const out: number[] = []
  let t = startMs
  for (const evs of frames) {
    for (const dx of evs) { s = pushLook(s, dx, 0, t); t += 1 }
    const r = readLook(s)
    s = r.state
    out.push(r.delta.dx)
  }
  return out
}

/** 변동계수 — 평균 대비 표준편차. 시선 속도가 얼마나 고르지 않은지. */
const cv = (xs: readonly number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  if (mean === 0) return 0
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
  return Math.sqrt(varr) / Math.abs(mean)
}

describe('원인 1 — 락 직후 워프 델타', () => {
  it('락 성립 직후 SETTLE_MS 안의 이벤트는 버린다', () => {
    let s = setLocked(EMPTY_LOOK, true, 5000)
    s = pushLook(s, 640, 300, 5000 + SETTLE_MS - 1)   // 커서 워프분
    expect(s.pendingX, '워프 델타가 누적되면 화면이 홱 돈다').toBe(0)
  })

  it('SETTLE_MS가 지나면 정상 누적한다', () => {
    let s = setLocked(EMPTY_LOOK, true, 5000)
    s = pushLook(s, 12, 4, 5000 + SETTLE_MS + 1)
    expect(s.pendingX).toBe(12)
  })

  it('락이 풀렸다 다시 걸리면 잔여 델타가 새 세션으로 새지 않는다', () => {
    let s = setLocked(EMPTY_LOOK, true, 0)
    s = pushLook(s, 50, 0, 1000)
    expect(s.pendingX).toBe(50)
    s = setLocked(s, false, 1100)
    s = setLocked(s, true, 1200)
    expect(s.pendingX).toBe(0)
  })

  it('잠기지 않은 상태의 이벤트는 무시한다', () => {
    const s = pushLook(EMPTY_LOOK, 40, 40, 1000)
    expect(s.pendingX).toBe(0)
  })
})

describe('원인 2 — 단발 스파이크', () => {
  it('절대 임계를 넘는 단일 이벤트는 버린다', () => {
    expect(isSpike(SPIKE_ABS + 1, 0, 40)).toBe(true)
  })

  it('빠른 플릭(연속 증가)은 통과시킨다', () => {
    // 손목 스냅: 8 → 24 → 60 → 110 px. 각 단계가 직전의 6배 미만이다.
    let s = setLocked(EMPTY_LOOK, true, 0)
    let t = 1000
    for (const d of [8, 24, 60, 110]) { s = pushLook(s, d, 0, t); t += 2 }
    expect(s.pendingX, '진짜 플릭이 잘리면 조준이 안 된다').toBe(8 + 24 + 60 + 110)
  })

  it('정지 상태에서 갑자기 튀는 값 하나만 버린다', () => {
    let s = setLocked(EMPTY_LOOK, true, 0)
    s = pushLook(s, 6, 0, 1000)      // 평온
    s = pushLook(s, 200, 0, 1002)    // 스파이크 (6px의 33배)
    s = pushLook(s, 7, 0, 1004)      // 다시 평온
    expect(s.pendingX).toBe(13)
  })

  it('스파이크를 버려도 lastMag는 갱신한다 — 연속 대이동이 전부 잘리면 안 된다', () => {
    let s = setLocked(EMPTY_LOOK, true, 0)
    s = pushLook(s, 4, 0, 1000)
    s = pushLook(s, 190, 0, 1002)   // 버려짐. 하지만 기준은 190이 된다
    s = pushLook(s, 180, 0, 1004)   // 190 대비 정상 → 통과
    expect(s.pendingX).toBe(4 + 180)
  })
})

describe('원인 3 — 프레임 히치 몰아치기', () => {
  /**
   * 등속 12px/frame으로 돌리다가 한 프레임이 길게 멈춰 300px이 한꺼번에 도착.
   * 히치 프레임은 **작은 이벤트 20개**다 — 실제 1000Hz 마우스가 100ms 동안 쌓는 모습이고,
   * 큰 이벤트 몇 개로 쓰면 스파이크 필터(원인 2)가 먼저 먹어 버려 이 테스트가
   * 무엇을 재는지 흐려진다.
   */
  const BURST = Array.from({ length: 20 }, () => 15)
  const HITCH = [[12], [12], [12], [12], BURST, [12], [12], [12], [12], [12], [12]] as const

  it('필터 없이는 한 프레임에 300px이 그대로 들어간다', () => {
    const raw = HITCH.map((evs) => evs.reduce((a, b) => a + b, 0))
    expect(raw[4]).toBe(300)
    expect(cv(raw), '이 한 방이 화면에서 스킵으로 보인다').toBeGreaterThan(1.5)
  })

  it('필터를 거치면 이상치가 여러 프레임에 나뉘어 들어간다', () => {
    const out = run([...HITCH])
    expect(out[4], '등속 12의 3배까지만 한 번에 나간다').toBeCloseTo(36, 4)
    expect(Math.max(...out), '어느 프레임도 원래 한 방(300)의 절반에 못 미친다').toBeLessThan(150)
    expect(cv(out)).toBeLessThan(cv(HITCH.map((e) => e.reduce((a, b) => a + b, 0))))
  })

  it('총 이동량은 보존된다 — 감도가 줄면 안 된다', () => {
    // 이월분이 다 빠지도록 조용한 프레임을 넉넉히 붙인다
    const frames = [...HITCH, ...Array.from({ length: 12 }, () => [] as const)]
    const sum = run(frames).reduce((a, b) => a + b, 0)
    const total = HITCH.reduce((a, evs) => a + evs.reduce((x, y) => x + y, 0), 0)
    expect(sum).toBeCloseTo(total, 3)
  })

  it('정지 상태에서의 첫 이동은 지연되지 않는다', () => {
    const out = run([[], [], [150], []])
    expect(out[2], '멈춰 있다가 확 돌릴 때 늦으면 조준감이 죽는다').toBe(150)
  })

  it('일정한 입력은 손대지 않는다 — 필터가 정상 이동을 건드리면 안 된다', () => {
    const out = run(Array.from({ length: 10 }, () => [12] as const))
    expect(out).toEqual(Array.from({ length: 10 }, () => 12))
  })

  it('평범한 가감속(직전의 2배 이내)은 통과시킨다', () => {
    const out = run([[10], [18], [30], [46]])
    expect(out).toEqual([10, 18, 30, 46])
  })
})

describe('불변성', () => {
  it('pushLook·readLook은 입력 상태를 변형하지 않는다', () => {
    const s0: LookState = setLocked(EMPTY_LOOK, true, 0)
    const snapshot = { ...s0 }
    const s1 = pushLook(s0, 30, 10, 1000)
    readLook(s1)
    expect(s0).toEqual(snapshot)
  })
})
