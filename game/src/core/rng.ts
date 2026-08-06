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

/**
 * 용도별 파생 스트림 (P2).
 *
 * 하나의 Rng를 순서대로 나눠 쓰면 **앞의 소비량이 바뀔 때 뒤가 전부 바뀐다.**
 * P1에서 자판기 동전 분배를 끼워 넣자 게이트 시드가 통째로 이동해 회귀 테스트가
 * 무더기로 빨간불이 됐다(`systems/qte.ts coinPlan` 이 `seed ^ hash(id)` 를 쓰는 이유).
 * P2는 방해요소·대기줄이 더 붙으므로 규약으로 못 박는다: **용도마다 소금이 다르다.**
 */
export const SALT = {
  gates: 0x0000_0000,      // 기존 동작 보존 — rollSeed 는 소금 없이 seed 그대로 쓴다
  obstacles: 0x9e37_79b9,
  queue: 0x85eb_ca6b,
  crowd: 0xc2b2_ae35,
} as const

export type SaltKey = keyof typeof SALT

/** 같은 seed 라도 용도가 다르면 독립적인 수열이 나온다 */
export const streamFor = (seed: number, key: SaltKey): Rng =>
  makeRng(((seed >>> 0) ^ SALT[key]) >>> 0)
