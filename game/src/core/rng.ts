/**
 * mulberry32 — 시드 재현 가능한 PRNG.
 *
 * 재현 없는 밸런싱은 밸런싱이 아니다. `?seed=42`로 고정하면
 * 개찰구 배치·잔액·LED 표시가 매번 완전히 동일하게 나온다.
 */
export type Rng = {
  /** [0, 1) */
  next(): number
  /** [lo, hi) 정수 */
  int(lo: number, hi: number): number
  /** 확률 p로 true */
  chance(p: number): boolean
  /** 배열에서 1개 (비어 있으면 throw) */
  pick<T>(arr: readonly T[]): T
  /** 새 배열을 반환하는 Fisher–Yates (원본 불변) */
  shuffle<T>(arr: readonly T[]): T[]
}

export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo)),
    chance: (p) => next() < p,
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('rng.pick: empty array')
      return arr[Math.floor(next() * arr.length)] as T
    },
    shuffle: <T,>(arr: readonly T[]): T[] => {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i] as T
        out[i] = out[j] as T
        out[j] = tmp
      }
      return out
    },
  }
}

/** URL `?seed=` 우선, 없으면 시각 기반. */
export const resolveSeed = (search = ''): number => {
  const m = /[?&]seed=(-?\d+)/.exec(search)
  if (m?.[1]) return Number(m[1]) >>> 0
  return (Math.random() * 0xffffffff) >>> 0
}
