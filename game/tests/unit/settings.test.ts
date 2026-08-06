/**
 * S22-1 — SettingsStore (`src/core/settings.ts`)
 *
 * 세이브와 같은 규칙이다: **실패해도 안 던지고**, 깨진 값은 항목 단위로만 잃는다.
 * 통째로 버리면 볼륨 하나 깨졌다고 감도까지 초기화된다.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, SENS_MAX, SENS_MIN, SETTINGS_KEY, loadSettings, normalize, saveSettings,
} from '../../src/core/settings'
import { __setStore, type Store } from '../../src/core/store'

const fake = (): Store & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) } }
}

/** 읽기·쓰기가 모두 던지는 저장소 — 사파리 프라이빗 모드 재현 */
const hostile = (): Store => ({
  get: () => { throw new Error('SecurityError') },
  set: () => { throw new Error('QuotaExceededError') },
})

beforeEach(() => { __setStore(fake()) })

describe('왕복', () => {
  it('빈 저장소는 기본값', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('저장 → 복원', () => {
    saveSettings({ ...DEFAULT_SETTINGS, master: 0.4, sens: 1.8, invertY: true, res: 'mid' })
    const s = loadSettings()
    expect(s.master).toBeCloseTo(0.4)
    expect(s.sens).toBeCloseTo(1.8)
    expect(s.invertY).toBe(true)
    expect(s.res).toBe('mid')
  })

  it('기본값은 소리·시선을 바꾸지 않는 항등값이다', () => {
    // 1 배·1 배·1 배. 설정을 안 만진 사람의 게임은 예전과 완전히 같아야 한다
    expect(DEFAULT_SETTINGS.master).toBe(1)
    expect(DEFAULT_SETTINGS.bgm).toBe(1)
    expect(DEFAULT_SETTINGS.sfx).toBe(1)
    expect(DEFAULT_SETTINGS.sens).toBe(1)
    expect(DEFAULT_SETTINGS.invertY).toBe(false)
    expect(DEFAULT_SETTINGS.res).toBe('high')
  })
})

describe('정규화 — 남이 쓴 값을 의심한다', () => {
  it('범위를 벗어난 수는 자른다', () => {
    const s = normalize({ master: 9, bgm: -3, sfx: 0.5, sens: 99 })
    expect(s.master).toBe(1)
    expect(s.bgm).toBe(0)
    expect(s.sfx).toBe(0.5)
    expect(s.sens).toBe(SENS_MAX)
  })

  it('NaN·문자열·null 은 그 항목만 기본값으로 돌린다', () => {
    const s = normalize({ master: Number.NaN, bgm: '0.5', sfx: null, sens: 2 })
    expect(s.master).toBe(DEFAULT_SETTINGS.master)
    expect(s.bgm).toBe(DEFAULT_SETTINGS.bgm)
    expect(s.sfx).toBe(DEFAULT_SETTINGS.sfx)
    expect(s.sens).toBe(2)          // ← 옆 항목이 깨져도 살아남는다
  })

  it('모르는 열거값은 기본값', () => {
    expect(normalize({ res: 'ultra', screen: 'vr' })).toMatchObject({ res: 'high', screen: 'windowed' })
  })

  it('객체가 아니면 통째로 기본값', () => {
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalize([1, 2])).toEqual(DEFAULT_SETTINGS)
  })

  it('감도 하한도 지킨다 — 0 이면 화면이 안 돈다', () => {
    expect(normalize({ sens: 0 }).sens).toBe(SENS_MIN)
  })
})

describe('망가진 저장소', () => {
  it('버전이 다르면 기본값', () => {
    const st = fake()
    __setStore(st)
    st.map.set(SETTINGS_KEY, JSON.stringify({ v: 999, s: { master: 0.1 } }))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('JSON 이 아니어도 안 던진다', () => {
    const st = fake()
    __setStore(st)
    st.map.set(SETTINGS_KEY, '{{{')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('읽기·쓰기가 던져도 안 던진다', () => {
    __setStore(hostile())
    expect(() => loadSettings()).not.toThrow()
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    // 쓰기 실패 → 메모리로 격하. 반환값은 정규화된 설정이라 화면이 곧바로 반영할 수 있다
    expect(() => saveSettings({ ...DEFAULT_SETTINGS, sfx: 0.2 })).not.toThrow()
    expect(saveSettings({ ...DEFAULT_SETTINGS, sfx: 0.2 }).sfx).toBeCloseTo(0.2)
  })
})
