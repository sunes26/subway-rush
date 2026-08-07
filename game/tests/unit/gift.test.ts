import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { start } from './_pilot'
import { giftBranches } from '../../src/systems/interact'
import { GIFT_STALL_ID, INTERACTABLES } from '../../src/data/interactables'

describe('선물 퍼즐 엔딩', () => {
  it('E-15 · E-16 이 등록돼 있다', () => {
    const ids = ENDINGS.map((e) => e.id)
    expect(ids).toContain('E-15')
    expect(ids).toContain('E-16')
    expect(ENDINGS.length).toBe(16)
  })

  /**
   * 강제 엔딩은 `resolveEnding` 을 타지 않는다. `when` 이 참이 될 수 있으면
   * 열차 출발 경로에서 엉뚱하게 뽑힌다 — 그래서 항상 거짓이어야 한다.
   */
  it('강제 엔딩의 when 은 어떤 상태에서도 거짓이다', () => {
    const forced = ENDINGS.filter((e) => e.id === 'E-15' || e.id === 'E-16')
    const s = start(1)
    for (const e of forced) {
      expect(e.when(s)).toBe(false)
      expect(e.when({ ...s, boarded: true, timeLeftMs: 0 })).toBe(false)
    }
  })
})

describe('편의점 매대', () => {
  it('5지 선택이고 순서가 GIFT_ITEMS 와 같다', () => {
    const b = giftBranches(start(1))
    expect(b.map((x) => x.key)).toEqual([1, 2, 3, 4, 5])
    expect(b.map((x) => x.label)).toEqual([
      '양갱', '바나나우유', '초콜릿', '탄산음료', '새우깡',
    ])
  })

  /** note 가 서로 다르면 그 자체가 정답 힌트가 된다 — 전부 비어 있어야 한다 */
  it('구매 전에는 전부 고를 수 있고 note 가 비어 있다', () => {
    const b = giftBranches(start(1))
    expect(b.every((x) => x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '')).toBe(true)
  })

  it('한 번 사면 전부 잠긴다', () => {
    const s = start(1)
    const bought = { ...s, flags: [...s.flags, 'GIFT_BOUGHT' as const] }
    const b = giftBranches(bought)
    expect(b.every((x) => !x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '이미 골랐다')).toBe(true)
  })

  it('매대가 편의점 슬랩 위에 있다', () => {
    const it0 = INTERACTABLES.find((i) => i.id === GIFT_STALL_ID)
    expect(it0).toBeDefined()
    expect(it0?.kind).toBe('talk')
    // 슬랩(Z2-NE)은 y=25.4 에서 시작하고 파사드는 y=25.7 이다
    expect(it0!.y).toBeGreaterThan(25.4)
    expect(it0!.y).toBeLessThan(25.7)
  })
})
