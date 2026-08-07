import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { start } from './_pilot'

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
