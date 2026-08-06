/**
 * SYS-13 SettingsStore — ESC 설정 영속 (Figma `node 15:4`).
 *
 * ★ **시뮬은 이 모듈을 임포트하지 않는다.** `save.ts` 와 같은 규칙이다 —
 *   설정은 화면·입력·소리에만 닿고 판정에는 절대 닿지 않는다. 설정이 판정을 바꾸면
 *   같은 시드가 사람마다 다른 결과를 내고, 스윕이 만든 밸런스 표가 거짓말이 된다.
 *
 * ★ **읽기는 전부 의심한다.** 남이 쓴 값(같은 오리진의 옛 버전)일 수도, 손으로
 *   고친 값일 수도 있다. 형태가 하나라도 안 맞으면 그 항목만 기본값으로 돌린다 —
 *   통째로 버리면 볼륨 하나 깨졌다고 감도까지 초기화된다.
 */

import { degradeStore, resolveStore } from './store'

export const SETTINGS_KEY = 'subway-rush.settings.v1'
export const SETTINGS_VERSION = 1

/** 렌더 배율 — 1.0 이 네이티브. 낮추면 픽셀이 굵어지는 대신 프레임이 산다 */
export const RES_SCALES = { high: 1, mid: 0.75, low: 0.5 } as const
export type ResKey = keyof typeof RES_SCALES
export type ScreenMode = 'windowed' | 'fullscreen'

export type Settings = Readonly<{
  /** 0~1 — 마스터. 이 값이 0 이면 아래 둘이 뭐든 안 들린다 */
  master: number
  /** 0~1 — 배경음(앰비언스) */
  bgm: number
  /** 0~1 — 효과음(사건음·발소리) */
  sfx: number
  /**
   * 마우스 감도 **배율**. 1.0 이 기존 감도(`FPV.sensitivity`)다.
   * 절대값을 저장하지 않는 이유: 튜닝에서 기준 감도를 바꾸면 저장된 절대값이
   * 그 변경을 통째로 무시한다. 배율이면 기준이 움직여도 "두 배 빠르게"가 유지된다.
   */
  sens: number
  /** 상하 반전 — 비행 시뮬 습관인 사람이 실제로 있다 */
  invertY: boolean
  res: ResKey
  screen: ScreenMode
}>

export const DEFAULT_SETTINGS: Settings = {
  master: 1, bgm: 1, sfx: 1, sens: 1, invertY: false, res: 'high', screen: 'windowed',
}

export const SENS_MIN = 0.25
export const SENS_MAX = 3

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 어떤 입력이 와도 유효한 설정 하나를 만든다 — 항목 단위로 살린다 */
export const normalize = (v: unknown): Settings => {
  if (!isRecord(v)) return DEFAULT_SETTINGS
  const res = v['res']
  const screen = v['screen']
  return {
    master: num(v['master'], DEFAULT_SETTINGS.master, 0, 1),
    bgm: num(v['bgm'], DEFAULT_SETTINGS.bgm, 0, 1),
    sfx: num(v['sfx'], DEFAULT_SETTINGS.sfx, 0, 1),
    sens: num(v['sens'], DEFAULT_SETTINGS.sens, SENS_MIN, SENS_MAX),
    invertY: typeof v['invertY'] === 'boolean' ? v['invertY'] : DEFAULT_SETTINGS.invertY,
    res: res === 'high' || res === 'mid' || res === 'low' ? res : DEFAULT_SETTINGS.res,
    screen: screen === 'windowed' || screen === 'fullscreen' ? screen : DEFAULT_SETTINGS.screen,
  }
}

export const loadSettings = (): Settings => {
  try {
    const raw = resolveStore().get(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const data: unknown = JSON.parse(raw)
    // 버전이 다르면 통째로 기본값이다. 마이그레이션은 스키마가 바뀔 때 여기서 한다
    if (!isRecord(data) || data['v'] !== SETTINGS_VERSION) return DEFAULT_SETTINGS
    return normalize(data['s'])
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (s: Settings): Settings => {
  const next = normalize(s)
  const body = JSON.stringify({ v: SETTINGS_VERSION, s: next })
  try {
    resolveStore().set(SETTINGS_KEY, body)
  } catch {
    try { degradeStore().set(SETTINGS_KEY, body) } catch { /* 여기까지 실패하면 포기 */ }
  }
  return next
}
