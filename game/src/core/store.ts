/**
 * 키·값 영속 저장소 — **절대 던지지 않는다.**
 *
 * 사파리 프라이빗 모드는 `localStorage.setItem` 이 예외를 던지고, 일부 브라우저는
 * `localStorage` 접근 자체가 SecurityError 다. 도감이나 설정 하나 때문에 게임이
 * 검은 화면이 되면 안 된다 → 실패하면 **메모리 저장소로 격하**한다
 * (그 판에는 값이 살아 있고 다음 판에 사라진다).
 *
 * `core/save.ts`(도감)와 `core/settings.ts`(설정)가 같은 구현을 쓴다 —
 * 격하 판정을 두 곳에 따로 두면 한쪽만 고쳐지는 날이 온다.
 */

export type Store = { get(k: string): string | null; set(k: string, v: string): void }

const memoryStore = (): Store => {
  const map = new Map<string, string>()
  return { get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) } }
}

let store: Store | null = null

export const resolveStore = (): Store => {
  if (store) return store
  try {
    const ls = globalThis.localStorage
    // 접근만 되고 쓰기가 막히는 환경이 있다 — 실제로 한 번 써 본다
    const probe = 'subway-rush.probe'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    store = { get: (k) => ls.getItem(k), set: (k, v) => { ls.setItem(k, v) } }
  } catch {
    store = memoryStore()
  }
  return store
}

/** 쓰기 실패 뒤 호출한다 — 다음 접근부터 메모리로 돈다 */
export const degradeStore = (): Store => {
  store = memoryStore()
  return store
}

/** 테스트용 — 저장소를 갈아끼운다. `null` 이면 다음 호출에서 다시 탐색한다 */
export const __setStore = (s: Store | null): void => { store = s }
