/**
 * S20~S21 — 관찰 모드 · 착용 대가 · 지면 마찰 (`docs/P2-TECH-PLAN.md` §4 S20·S21)
 *
 * "느낌"은 E2E 가 재기 어렵다(소프트웨어 래스터가 프레임을 삼킨다). **수식만 떼어내**
 * 결정론적으로 잠근다 — P1의 `interp.test.ts` 와 같은 태도다.
 */

import { describe, expect, it } from 'vitest'
import { MOVE, SPEED, STAMINA } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { FlagId, GameState } from '../../src/state/types'
import { WET_ZONE } from '../../src/systems/obstacles'
import { holdFor, put, start } from './_pilot'

/** 3초 동안 한 방향으로 걷고 이동 거리를 잰다 */
const run3s = (s: GameState, over: Record<string, unknown> = {}): number => {
  const a = s.player.pos
  const b = holdFor(s, { moveY: 1, ...over }, 180).player.pos
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** 정지 입력 후 미끄러진 거리 */
const glide = (s: GameState): number => {
  const moving = holdFor(s, { moveY: 1 }, 90)
  const a = moving.player.pos
  const b = holdFor(moving, {}, 45).player.pos
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * 넓게 열린 직선 — Z4 운임구역 통로(x 72~95.8). **21m 를 직진해도 아무것도 안 만난다.**
 * 대합실은 기둥 8본과 상가가 있어 3초 주행 거리가 벽에 잘린다(실측 11m).
 * y=3 은 물청소 구역(y 4.4~9.6) 밖이라 마찰 비교의 기준선이 된다.
 */
const open = (patch: Partial<GameState> = {}): GameState =>
  put(start(7, patch), 74, 3, FLOOR.B1)

describe('S20-4 관찰 모드 Q', () => {
  it('이동이 느려진다 (−40%)', () => {
    const normal = run3s(open())
    const observing = run3s(open(), { observe: true })
    expect(observing).toBeLessThan(normal)
    expect(observing / normal).toBeCloseTo(0.6, 1)
  })

  it('시간은 계속 흐른다 — 정지가 아니다', () => {
    const s = holdFor(open(), { observe: true }, 60)
    expect(s.timeLeftMs).toBeLessThan(180_000)
    expect(s.elapsedMs).toBeGreaterThan(900)
  })
})

describe('P2 착용의 대가', () => {
  it('캐리어를 끌면 −20%', () => {
    const bare = run3s(open())
    const carried = run3s(open({ flags: ['CARRIER_ON'] as FlagId[] }))
    expect(carried / bare).toBeCloseTo(0.8, 1)
  })

  it('커피(카페인)는 스태미너 소모를 줄인다', () => {
    const plain = holdFor(open(), { moveY: 1, sprint: true }, 120)
    const caffeinated = holdFor(open({ flags: ['CAFFEINE'] as FlagId[] }), { moveY: 1, sprint: true }, 120)
    expect(caffeinated.player.stamina).toBeGreaterThan(plain.player.stamina)
  })

  it('마스크는 회복을 늦춘다', () => {
    const drained = (flags: FlagId[]): number => {
      const s = start(7, {
        flags,
        player: { ...start(7).player, stamina: 20, sinceSprintMs: 99_999 },
      })
      return holdFor(put(s, 4, 14, FLOOR.B1), {}, 120).player.stamina
    }
    expect(drained(['MASK_ON'])).toBeLessThan(drained([]))
  })

  it('대가가 쌓여도 이동이 0 이 되지는 않는다', () => {
    const both = run3s(open({ flags: ['CARRIER_ON'] as FlagId[] }), { observe: true })
    expect(both).toBeGreaterThan(SPEED.walk * 3 * 0.4)
  })
})

describe('S21-1 지면별 마찰', () => {
  it('젖은 구역에서 더 멀리 미끄러진다', () => {
    const dry = glide(put(start(7), 74, 3, FLOOR.B1))
    const wet = glide(put(start(7), WET_ZONE[0] - 1.0, (WET_ZONE[1] + WET_ZONE[3]) / 2, FLOOR.B1))
    expect(wet, `마른 바닥 ${dry.toFixed(3)}m · 젖은 바닥 ${wet.toFixed(3)}m`).toBeGreaterThan(dry)
  })

  it('상수가 의도한 방향이다 — 계단은 잘 서고 젖은 곳은 미끄럽다', () => {
    expect(MOVE.gripStairs).toBeLessThan(1)
    expect(MOVE.gripWet).toBeGreaterThan(1)
  })

  it('가속은 안 건드렸다 — 예산표(MAP §1.3)가 그대로여야 한다', () => {
    // 3초 등속 이동 거리가 걷기 속도 × 3초에서 크게 안 벗어난다
    const d = run3s(open())
    expect(d).toBeGreaterThan(SPEED.walk * 3 * 0.9)
    expect(d).toBeLessThan(SPEED.walk * 3 * 1.02)
  })
})

describe('S21 회귀 — 스태미너 상한은 그대로다', () => {
  it('카페인이 있어도 100 을 안 넘는다', () => {
    const s = holdFor(open({ flags: ['CAFFEINE'] as FlagId[] }), {}, 600)
    expect(s.player.stamina).toBeLessThanOrEqual(STAMINA.max)
  })
})
