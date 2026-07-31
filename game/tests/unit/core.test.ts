import { describe, expect, it } from 'vitest'
import { formatClock, lerpExp, rotateToward, wrapAngle } from '../../src/core/math'
import { makeRng, resolveSeed } from '../../src/core/rng'
import { MAX_FRAME_MS, MAX_STEPS_PER_FRAME, STEP_MS } from '../../src/data/tuning'

describe('S0-4 고정스텝', () => {
  it('300ms 정지 후 스텝이 5회로 클램프된다', () => {
    // main.ts의 루프 규칙을 그대로 재현: dt > MAX_FRAME_MS → 1스텝으로 잘라낸다
    let acc = 0
    let dt = 300
    if (dt > MAX_FRAME_MS) dt = STEP_MS
    acc += dt
    let steps = 0
    while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) { acc -= STEP_MS; steps++ }
    expect(steps).toBe(1)
  })

  it('누적 200ms는 정확히 5스텝에서 멈춘다', () => {
    let acc = 200
    let steps = 0
    while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) { acc -= STEP_MS; steps++ }
    expect(steps).toBe(MAX_STEPS_PER_FRAME)
  })
})

describe('S0-5 시드 재현', () => {
  it('같은 시드는 같은 난수열을 낸다', () => {
    const a = Array.from({ length: 64 }, () => makeRng(42).next())
    const b = Array.from({ length: 64 }, () => makeRng(42).next())
    expect(a).toEqual(b)
    const seq1 = (() => { const r = makeRng(42); return Array.from({ length: 64 }, () => r.next()) })()
    const seq2 = (() => { const r = makeRng(42); return Array.from({ length: 64 }, () => r.next()) })()
    expect(seq1).toEqual(seq2)
  })

  it('다른 시드는 다른 난수열을 낸다', () => {
    const r1 = makeRng(1); const r2 = makeRng(2)
    expect(Array.from({ length: 8 }, () => r1.next()))
      .not.toEqual(Array.from({ length: 8 }, () => r2.next()))
  })

  it('shuffle은 원본을 변형하지 않는다', () => {
    const src = [1, 2, 3, 4, 5, 6]
    const out = makeRng(7).shuffle(src)
    expect(src).toEqual([1, 2, 3, 4, 5, 6])
    expect(out.slice().sort()).toEqual(src)
  })

  it('?seed= 파라미터를 읽는다', () => {
    expect(resolveSeed('?seed=12345')).toBe(12345)
    expect(resolveSeed('?a=1&seed=7')).toBe(7)
  })

  it('chance(p) 분포가 p에 수렴한다', () => {
    const r = makeRng(99)
    let hit = 0
    for (let i = 0; i < 20_000; i++) if (r.chance(0.6)) hit++
    expect(hit / 20_000).toBeGreaterThan(0.58)
    expect(hit / 20_000).toBeLessThan(0.62)
  })
})

describe('math', () => {
  it('lerpExp는 프레임레이트 독립이다', () => {
    // 60fps로 60스텝 vs 30fps로 30스텝 → 같은 1초 경과, 결과가 같아야 한다
    let a = 0
    for (let i = 0; i < 60; i++) a = lerpExp(a, 10, 1 / 60, 0.2)
    let b = 0
    for (let i = 0; i < 30; i++) b = lerpExp(b, 10, 1 / 30, 0.2)
    expect(Math.abs(a - b)).toBeLessThan(0.01)
  })

  it('wrapAngle은 −π..π 로 감는다', () => {
    expect(wrapAngle(Math.PI * 2 + 1)).toBeCloseTo(1, 5)
    expect(wrapAngle(-Math.PI * 2 - 1)).toBeCloseTo(-1, 5)
    // ±π는 경계라 어느 쪽으로 떨어져도 옳다 — 절댓값만 본다
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 5)
  })

  it('rotateToward는 최단 방향으로 돈다 (경계를 가로질러)', () => {
    // 3.0 → −3.0 은 +방향으로 감는 게 짧다 (Δ ≈ +0.283). 한 스텝이 그보다 작으면 +로 간다
    const out = rotateToward(3.0, -3.0, 0.01, 14)
    expect(out).toBeGreaterThan(3.0)
  })

  it('rotateToward는 한 스텝에 도달 가능하면 목표로 스냅한다', () => {
    expect(rotateToward(3.0, -3.0, 0.1, 14)).toBe(-3.0)
  })

  it('formatClock', () => {
    expect(formatClock(180_000)).toBe('3:00')
    expect(formatClock(61_000)).toBe('1:01')
    expect(formatClock(-500)).toBe('0:00')
  })
})
