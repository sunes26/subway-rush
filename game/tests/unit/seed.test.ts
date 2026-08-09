/**
 * S14 — 시드 파생 스트림 · 방해요소 셔플 · 대기줄 (`docs/P2-TECH-PLAN.md` §4 S14)
 */

import { describe, expect, it } from 'vitest'
import { SALT, makeRng, resolveSeed, streamFor } from '../../src/core/rng'
import {
  ACTIVE_OBSTACLES, PLAYER_TRIGGERED, QUEUE_MAX, QUEUE_MIN, QUEUE_TOTAL, rollQueues,
} from '../../src/data/obstacles'
import { initialState, rollSeed } from '../../src/state/reducer'

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761) >>> 0)

describe('S14-1 시드 해석', () => {
  it('?seed= 가 있으면 그대로 재현된다', () => {
    expect(resolveSeed('?seed=42')).toBe(42)
    expect(resolveSeed('?foo=1&seed=12345')).toBe(12345)
  })

  it('?seed= 가 없으면 매번 다른 값이 나온다', () => {
    const got = new Set(Array.from({ length: 40 }, () => resolveSeed('')))
    // 무작위라 이론상 충돌 가능. 40개 중 35개 이상 유일하면 무작위로 인정한다
    expect(got.size).toBeGreaterThanOrEqual(35)
  })

  it('같은 시드는 같은 초기 상태를 만든다', () => {
    const a = initialState(777)
    const b = initialState(777)
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.queues).toEqual(b.queues)
    expect(a.cardBalance).toBe(b.cardBalance)
    expect(a.gates.workingIds).toEqual(b.gates.workingIds)
  })
})

describe('S14-2 파생 스트림 독립', () => {
  it('소금이 다르면 수열이 다르다', () => {
    const o = streamFor(1234, 'obstacles')
    const q = streamFor(1234, 'queue')
    const a = Array.from({ length: 8 }, () => o.next())
    const b = Array.from({ length: 8 }, () => q.next())
    expect(a).not.toEqual(b)
  })

  it('한 스트림을 더 소비해도 다른 스트림은 안 변한다', () => {
    const before = rollQueues(99)
    const o = streamFor(99, 'obstacles')
    for (let i = 0; i < 100; i++) o.next()      // 방해요소 쪽을 실컷 소비
    expect(rollQueues(99)).toEqual(before)
  })

  it('게이트 소금은 0 — 기존 rollSeed 동작을 보존한다', () => {
    expect(SALT.gates).toBe(0)
    const rng = makeRng(4321)
    // rollSeed 는 소금 없이 seed 를 그대로 쓴다 (P1 회귀 보호)
    expect(rollSeed(4321).workingIds.length).toBeGreaterThan(0)
    expect(typeof rng.next()).toBe('number')
  })
})

describe('S14-3 방해요소 — 셔플 없이 항상 전부 켜진다', () => {
  it('시드와 무관하게 11종이 매번 똑같이 활성화된다', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      expect(initialState(seed).obstacles).toEqual(ACTIVE_OBSTACLES)
    }
  })

  it('중복 없이 11종이다', () => {
    expect(new Set(ACTIVE_OBSTACLES).size).toBe(ACTIVE_OBSTACLES.length)
    expect(ACTIVE_OBSTACLES.length).toBe(11)
  })

  it('OBS-14 단소는 상시 목록에 없다 — 플레이어 선택으로만 발동한다', () => {
    expect(ACTIVE_OBSTACLES).not.toContain('OBS-14')
    expect(PLAYER_TRIGGERED).toContain('OBS-14')
  })
})

describe('S14-4 대기줄 셔플 (R3)', () => {
  it('합계 고정 · 각 줄 범위 준수', () => {
    for (const seed of SEEDS) {
      const q = rollQueues(seed)
      expect(q.length).toBe(3)
      expect(q.reduce((a, b) => a + b, 0)).toBe(QUEUE_TOTAL)
      for (const n of q) {
        expect(n).toBeGreaterThanOrEqual(QUEUE_MIN)
        expect(n).toBeLessThanOrEqual(QUEUE_MAX)
      }
    }
  })

  it('시드마다 분포가 달라진다 — 200개에서 10가지 이상', () => {
    const sets = new Set(SEEDS.map((s) => rollQueues(s).join(',')))
    expect(sets.size).toBeGreaterThanOrEqual(10)
  })

  it('가장 짧은 줄이 항상 같은 자리가 아니다 — 노선도만으로는 정답이 안 나온다', () => {
    const argmin = new Set(SEEDS.map((s) => {
      const q = rollQueues(s)
      return q.indexOf(Math.min(...q))
    }))
    expect(argmin.size).toBe(3)
  })
})
