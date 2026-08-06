/**
 * S14-5 — SaveStore (`src/core/save.ts`)
 *
 * 핵심은 **실패해도 안 던진다**는 것이다. 도감 하나 때문에 게임이 검은 화면이 되면 안 된다.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_SAVE, SAVE_KEY, __setStore, clearSave, loadSave, recordEnding, seenCount,
} from '../../src/core/save'

type Store = { get(k: string): string | null; set(k: string, v: string): void }

const fake = (): Store & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) } }
}

/** 쓰기가 항상 던지는 저장소 — 사파리 프라이빗 모드 재현 */
const hostile = (): Store => ({
  get: () => { throw new Error('SecurityError') },
  set: () => { throw new Error('QuotaExceededError') },
})

beforeEach(() => { __setStore(fake()) })

describe('왕복', () => {
  it('빈 저장소는 빈 세이브', () => {
    expect(loadSave()).toEqual(EMPTY_SAVE)
    expect(seenCount(loadSave())).toBe(0)
  })

  it('기록 → 복원', () => {
    recordEnding('E-01', 12_400)
    const s = loadSave()
    expect(s.endings['E-01']).toEqual({ seen: 1, bestMs: 12_400 })
    expect(s.plays).toBe(1)
  })

  it('같은 엔딩을 다시 보면 횟수가 늘고 최고 기록만 갱신된다', () => {
    recordEnding('E-01', 12_400)
    recordEnding('E-01', 3_000)
    recordEnding('E-01', 40_000)
    const s = loadSave()
    expect(s.endings['E-01']).toEqual({ seen: 3, bestMs: 40_000 })
    expect(s.plays).toBe(3)
  })

  it('여러 엔딩이 독립적으로 쌓인다', () => {
    recordEnding('E-01', 1000)
    recordEnding('E-06', 0)
    recordEnding('E-14', 22_000)
    expect(seenCount(loadSave())).toBe(3)
  })

  it('음수 잔여시간은 0으로 정규화된다 (미탑승 엔딩)', () => {
    recordEnding('E-06', -500)
    expect(loadSave().endings['E-06']?.bestMs).toBe(0)
  })

  it('clearSave 로 비워진다', () => {
    recordEnding('E-01', 1000)
    clearSave()
    expect(seenCount(loadSave())).toBe(0)
  })
})

describe('오염된 값', () => {
  it('JSON 이 아니면 빈 세이브', () => {
    const st = fake()
    st.map.set(SAVE_KEY, '{{{ not json')
    __setStore(st)
    expect(loadSave()).toEqual(EMPTY_SAVE)
  })

  it('버전이 다르면 빈 세이브', () => {
    const st = fake()
    st.map.set(SAVE_KEY, JSON.stringify({ v: 99, endings: { 'E-01': { seen: 5, bestMs: 1 } }, plays: 5 }))
    __setStore(st)
    expect(loadSave()).toEqual(EMPTY_SAVE)
  })

  it('엔딩 항목이 이상하면 그 항목만 버린다', () => {
    const st = fake()
    st.map.set(SAVE_KEY, JSON.stringify({
      v: 1,
      endings: { 'E-01': { seen: 2, bestMs: 10 }, 'E-02': 'nope', 'E-03': { seen: -1, bestMs: 5 } },
      plays: 2,
    }))
    __setStore(st)
    const s = loadSave()
    expect(s.endings['E-01']).toEqual({ seen: 2, bestMs: 10 })
    expect(s.endings['E-02']).toBeUndefined()
    expect(s.endings['E-03']).toBeUndefined()
  })
})

describe('저장소가 적대적이어도 안 던진다', () => {
  it('읽기 실패 → 빈 세이브', () => {
    __setStore(hostile())
    expect(() => loadSave()).not.toThrow()
    expect(loadSave()).toEqual(EMPTY_SAVE)
  })

  it('쓰기 실패 → 메모리로 격하하고 그 판에는 남는다', () => {
    __setStore(hostile())
    expect(() => recordEnding('E-01', 5000)).not.toThrow()
    // 격하된 메모리 저장소에서 다시 읽힌다
    expect(loadSave().endings['E-01']?.seen).toBe(1)
  })
})
