/**
 * SYS-12 SaveStore — 엔딩 도감 영속 (`docs/P2-SPEC.md` §2.3).
 *
 * ★ **시뮬은 이 모듈을 임포트하지 않는다.** `main.ts` 와 `ui/collection.ts` 만 쓴다.
 *   `tick()` 이 브라우저 API 를 만지는 순간 헤드리스 스윕이 죽는다.
 *
 * ★ **던지지 않는다.** 저장소 격하 규칙은 `core/store.ts` 에 있다 — 설정과 공유한다.
 */

import { degradeStore, resolveStore, __setStore } from './store'
import type { EndingId } from '../state/types'

// 테스트가 예전부터 `save.ts` 에서 가져다 쓴다 — 구현이 옮겨갔을 뿐이라 이름을 유지한다
export { __setStore }

export const SAVE_KEY = 'subway-rush.save.v1'
export const SAVE_VERSION = 1

export type EndingRecord = Readonly<{
  /** 본 횟수 */
  seen: number
  /** 최고 잔여시간(ms) — 성공 계열만 의미 있다. 미탑승 엔딩은 0 */
  bestMs: number
}>

export type SaveData = Readonly<{
  v: number
  endings: Readonly<Partial<Record<EndingId, EndingRecord>>>
  plays: number
}>

export const EMPTY_SAVE: SaveData = { v: SAVE_VERSION, endings: {}, plays: 0 }


const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 파싱은 **전부 의심한다.** 남이 쓴 값일 수도 있고(같은 오리진의 다른 버전),
 * 사용자가 손으로 고칠 수도 있다. 형태가 안 맞으면 조용히 빈 세이브다.
 */
const parse = (raw: string | null): SaveData => {
  if (!raw) return EMPTY_SAVE
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data['v'] !== SAVE_VERSION) return EMPTY_SAVE
    const src = isRecord(data['endings']) ? data['endings'] : {}
    const endings: Record<string, EndingRecord> = {}
    for (const [k, v] of Object.entries(src)) {
      if (!isRecord(v)) continue
      const seen = typeof v['seen'] === 'number' && v['seen'] > 0 ? Math.floor(v['seen']) : 0
      const bestMs = typeof v['bestMs'] === 'number' && v['bestMs'] > 0 ? Math.floor(v['bestMs']) : 0
      if (seen > 0) endings[k] = { seen, bestMs }
    }
    const plays = typeof data['plays'] === 'number' && data['plays'] > 0 ? Math.floor(data['plays']) : 0
    return { v: SAVE_VERSION, endings: endings as SaveData['endings'], plays }
  } catch {
    return EMPTY_SAVE
  }
}

export const loadSave = (): SaveData => {
  try {
    return parse(resolveStore().get(SAVE_KEY))
  } catch {
    return EMPTY_SAVE
  }
}

const write = (data: SaveData): SaveData => {
  try {
    resolveStore().set(SAVE_KEY, JSON.stringify(data))
  } catch {
    // 저장 실패 — 다음 호출부터 메모리로 격하한다. 게임은 그대로 돈다
    try { degradeStore().set(SAVE_KEY, JSON.stringify(data)) } catch { /* 여기까지 실패하면 포기 */ }
  }
  return data
}

/** 엔딩 1건 기록. 반환값은 **기록 후의 세이브** — UI가 다시 읽을 필요가 없다 */
export const recordEnding = (id: EndingId, timeLeftMs: number): SaveData => {
  const prev = loadSave()
  const cur = prev.endings[id] ?? { seen: 0, bestMs: 0 }
  const next: SaveData = {
    v: SAVE_VERSION,
    endings: { ...prev.endings, [id]: { seen: cur.seen + 1, bestMs: Math.max(cur.bestMs, Math.max(0, Math.floor(timeLeftMs))) } },
    plays: prev.plays + 1,
  }
  return write(next)
}

export const clearSave = (): SaveData => write(EMPTY_SAVE)

export const seenCount = (data: SaveData): number => Object.keys(data.endings).length
