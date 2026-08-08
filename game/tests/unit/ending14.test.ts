/**
 * S18 — 엔딩 14종 · 도감. **P2 게이트.**
 *
 * 체크리스트 출처: `docs/P2-TECH-PLAN.md` §4 S18-1~S18-6
 * (P1 6종의 정의는 `ending6.test.ts` 가 이미 잠갔다. 여기는 **신규 8종과 배열 전체**를 본다)
 */

import { describe, expect, it } from 'vitest'
import { ENDINGS, resolveEnding } from '../../src/data/endings'
import { QUEUE_MARKERS } from '../../src/data/world'
import type { EndingId, FlagId, GameState, ItemId, TallyState } from '../../src/state/types'
import { EMPTY_TALLY } from '../../src/state/reducer'
import { start } from './_pilot'

const at = (patch: Partial<GameState>): EndingId => resolveEnding(start(7, patch)).id

const tally = (over: Partial<TallyState> = {}): TallyState =>
  ({ ...EMPTY_TALLY, ...over })

const FOUR_ITEMS: readonly ItemId[] = ['I-01', 'I-06', 'I-09', 'I-13']

/** E-05 TRUE 를 만족하는 최소 상태 */
const trueRun = (over: Partial<GameState> = {}): Partial<GameState> => ({
  boarded: true,
  timeLeftMs: 62_000,
  scores: { conscience: 3, style: 4, knowledge: 2 },
  tally: tally({ itemsUsed: FOUR_ITEMS }),
  ...over,
})

/**
 * S18-0 — **조건에 쓰는 플래그는 켜는 코드가 있어야 한다.**
 *
 * ■ 왜 이 테스트가 생겼나
 *
 * E-12 「오늘도 평화로운 역」이 **실제 플레이로 도달할 수 없었다.** 조건이
 * `SEAT_YIELDED` 를 요구하는데 그 플래그를 켜는 시스템이 리포에 없었다 —
 * 타입 선언과 조건식, 두 곳에만 존재했다. 임산부 배려석 상호작용이 미구현이다.
 *
 * 그런데 **아래 S18-1 은 통과했다.** 플래그를 배열에 직접 넣어 판정기를 부르기
 * 때문이다. 판정기는 맞았지만 그 상태에 이르는 길이 없었다 — 유닛 테스트가
 * 구조적으로 못 잡는 종류다.
 *
 * ■ 그래서 소스를 읽는다
 *
 * 게임에서 플래그가 켜지는 길은 `{ t: 'FLAG', id: ..., on: true }` 하나뿐이다.
 * `src/` 를 훑어 발행되는 플래그 집합을 만들고, 엔딩 조건이 쓰는 플래그가 전부
 * 그 안에 있는지 본다. 삼항(`toilet ? 'TOILET_USED' : 'OPPOSITE_SIDE'`)도 잡히도록
 * `id:` 뒤가 아니라 **`FLAG` 리터럴이 있는 줄의 모든 대문자 리터럴**을 센다.
 *
 * ⚠ 소스를 `node:fs` 로 읽지 않는다 — 이 프로젝트는 브라우저 타깃이라
 *   `tsconfig` 의 `types` 가 `["vite/client"]` 뿐이고 `@types/node` 가 없다.
 *   유닛은 통과해도 `tsc --noEmit` 이 깨진다. Vite 의 `import.meta.glob` 은
 *   그 타입에 들어 있고 번들러가 정적으로 처리하므로 둘 다 지나간다.
 */
describe('S18-0 조건이 쓰는 플래그에 발행처가 있다', () => {
  /** `src/` 전 소스. `?raw` 라 문자열 그대로 온다 */
  const SOURCES = import.meta.glob('../../src/**/*.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Readonly<Record<string, string>>

  /** `{ t: 'FLAG', ... }` 가 있는 줄에서 대문자 문자열 리터럴을 거둔다 */
  const emitted = (): ReadonlySet<string> => {
    const out = new Set<string>()
    for (const [path, text] of Object.entries(SOURCES)) {
      // 선언(types)과 조건(endings)은 발행이 아니다 — 그 둘만 보면 이 검사가 무의미해진다
      if (path.endsWith('data/endings.ts') || path.endsWith('state/types.ts')) continue
      for (const line of text.split('\n')) {
        if (!line.includes(`'FLAG'`)) continue
        for (const m of line.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) {
          if (m[1] !== 'FLAG') out.add(m[1]!)
        }
      }
    }
    return out
  }

  /**
   * 엔딩 조건식이 `flags.includes('X')` 로 요구하는 것들.
   *
   * ⚠ **따옴표를 가리지 않는다.** 여기는 소스가 아니라 `Function.prototype.toString()`
   *   이고, 그 문자열은 **esbuild 가 변환한 뒤의 코드**다. esbuild 는 문자열 리터럴을
   *   큰따옴표로 정규화한다 — 실제로 `includes("WALLET_RETURNED")` 로 나온다.
   *   작은따옴표만 보던 판이 있었고, 그때 이 집합이 **항상 비어서** 아래 검사가
   *   무엇을 넣든 통과했다. 통과한 게 아니라 아무것도 안 보고 있었다.
   */
  const required = (): ReadonlySet<string> => {
    const out = new Set<string>()
    for (const e of ENDINGS) {
      for (const m of e.when.toString().matchAll(/includes\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)) {
        out.add(m[1]!)
      }
    }
    return out
  }

  /**
   * ★ **양쪽 스캐너가 살아 있는지 먼저 본다.**
   *
   * 아래 본 검사는 `required − emitted` 가 비었는지를 본다. 그러므로 **둘 중 어느
   * 쪽이 비어도 통과한다.** 실제로 `required` 가 따옴표 때문에 비었던 적이 있고,
   * 그때 `emitted` 쪽에만 생존 검사를 달아 둬서 못 잡았다. 한쪽만 막는 것은
   * 안 막는 것과 같다.
   */
  it('스캐너 둘 다 살아 있다 — 알려진 플래그를 실제로 찾는다', () => {
    const on = emitted()
    expect(on.size, 'emitted 가 비었다 — 발행처 스캐너가 죽었다').toBeGreaterThan(3)
    expect(on.has('WALLET_RETURNED')).toBe(true)
    expect(on.has('GRANDPA_HELPED')).toBe(true)
    expect(on.has('BUSTED')).toBe(true)
    // 삼항(`toilet ? 'TOILET_USED' : 'OPPOSITE_SIDE'`) 안에 있는 것도 잡히는가
    expect(on.has('TOILET_USED')).toBe(true)
    expect(on.has('OPPOSITE_SIDE')).toBe(true)
    // 미구현 예약 플래그는 당연히 없다
    expect(on.has('SEAT_YIELDED')).toBe(false)

    const need = required()
    expect(need.size, 'required 가 비었다 — 조건식 스캐너가 죽었다').toBeGreaterThan(3)
    // E-12·E-13·E-08·E-09 의 조건에서 실제로 읽혀야 하는 것들
    for (const f of ['WALLET_RETURNED', 'GRANDPA_HELPED', 'TOILET_USED', 'OPPOSITE_SIDE', 'BUSTED']) {
      expect(need.has(f), `required 가 ${f} 를 못 읽었다`).toBe(true)
    }
  })

  it('발행처 없는 플래그를 요구하는 엔딩이 없다', () => {
    const on = emitted()
    const orphans = [...required()].filter((f) => !on.has(f)).sort()
    expect(
      orphans,
      `조건은 요구하는데 켜는 코드가 없다 — 해당 엔딩은 도달 불가다: ${orphans.join(', ')}`,
    ).toEqual([])
  })
})

describe('S18-1 신규 8종이 각각 도달 가능하다', () => {
  it('E-05 지하철 마스터 (TRUE)', () => {
    expect(at(trueRun())).toBe('E-05')
  })

  it('E-12 오늘도 평화로운 역 — 미탑승 + 선행 2종', () => {
    const flags: FlagId[] = ['WALLET_RETURNED', 'GRANDPA_HELPED']
    expect(at({ boarded: false, flags })).toBe('E-12')
  })

  it('E-11 에스컬레이터 참사 — 우산 밀기 3회', () => {
    expect(at({ tally: tally({ pushes: 3 }) })).toBe('E-11')
  })

  it('E-09 부정승차 적발 — 역무원이 낸 플래그', () => {
    expect(at({ flags: ['BUSTED'] })).toBe('E-09')
  })

  it('E-13 해방 — 미탑승 + 화장실', () => {
    expect(at({ boarded: false, flags: ['TOILET_USED'] })).toBe('E-13')
  })

  it('E-08 반대편 탑승 — 탑승 + 반대편 통로', () => {
    expect(at({ boarded: true, timeLeftMs: 40_000, flags: ['OPPOSITE_SIDE'] })).toBe('E-08')
  })

  it('E-03 앉아서 간다 — 잔여 45s + 3-1 승차위치', () => {
    expect(at({
      boarded: true, timeLeftMs: 48_000, boardedDoorX: QUEUE_MARKERS[0].x,
    })).toBe('E-03')
  })

  it('E-07 지각 확정 — 미탑승 + 양심 < 0', () => {
    /**
     * ⚠ 이 브랜치에서 한때 판정 축을 **도달 지점**(개찰 통과 여부)으로 바꿨었다.
     *   "지각은 시간 문제지 도덕이 아니다" 라는 이유였고 지금도 그 지적은 맞다고 본다.
     *
     *   다만 upstream 이 그 뒤로 E-07 위에 매복(E-17)·사고(E-18) 엔딩을 쌓았고,
     *   **엔딩 판정은 upstream 것을 쓰기로** 정해져서 원래 조건으로 되돌렸다.
     *   되돌린 것이지 틀렸다고 판단해서 지운 것이 아니다 — 다시 바꾸려면
     *   `data/endings.ts` 의 `when` 한 줄과 이 테스트만 손대면 된다.
     */
    expect(at({ boarded: false, scores: { conscience: -1, style: 0, knowledge: 0 } }))
      .toBe('E-07')
    expect(at({ boarded: false, scores: { conscience: 0, style: 0, knowledge: 0 } }),
      '양심이 0 이면 온화한 기본 실패다').toBe('E-06')
  })

  /**
   * ⚠ 아래 `toBe(14)` 는 **"엔딩 14종"이라는 제목의 잔재가 아니다.** `E-15`·`E-16` 은
   * 강제 엔딩이라 `resolveEnding` 을 아예 타지 않으므로(파일 상단 `at()` 은
   * `resolveEnding` 을 부른다) 여기 모이는 집합엔 절대 안 섞여야 한다. 14는
   * "resolveEnding 으로 도달 가능한 엔딩 수는 정확히 14개다 — E-15/E-16 은 그중에
   * 없다"는 불변식을 인코딩한 값이다. 총 엔딩 수(16종)에 맞춰 16으로 "고치면"
   * 이 가드가 무력화된다.
   */
  it('14종 전부 한 번씩은 나온다', () => {
    const seen = new Set<EndingId>([
      at(trueRun()),
      at({ boarded: true, tally: tally({ coinsEarned: 3000 }) }),
      at({ boarded: false, flags: ['WALLET_RETURNED', 'GRANDPA_HELPED'] }),
      at({ scores: { conscience: -3, style: 0, knowledge: 0 } }),
      at({ tally: tally({ pushes: 3 }) }),
      at({ flags: ['BUSTED'] }),
      at({ boarded: false, flags: ['TOILET_USED'] }),
      at({ boarded: true, timeLeftMs: 40_000, flags: ['OPPOSITE_SIDE'] }),
      at({ boarded: true, timeLeftMs: 48_000, boardedDoorX: QUEUE_MARKERS[0].x }),
      // E-04 — 전체 잔여가 아니라 **탑승 순간 문이 닫히기까지 남은 시간**으로 잰다
      at({ boarded: true, boardedCloseInMs: 500 }),
      at({ boarded: true, timeLeftMs: 35_000 }),
      at({ boarded: true, timeLeftMs: 12_000 }),
      // E-07 — 미탑승 + 양심 < 0
      at({ boarded: false, scores: { conscience: -1, style: 0, knowledge: 0 } }),
      at({}),
    ])
    /**
     * ★ 이 테스트가 **플래그를 배열에 직접 넣는다**는 점을 기억해 둘 것.
     *
     * 그래서 여기를 통과해도 "실제 플레이로 도달한다"는 뜻은 아니다. 실제로 한 번
     * 그랬다 — E-12 는 조건에 `SEAT_YIELDED` 가 있었고 그 플래그를 켜는 시스템이
     * 리포에 없었는데, 이 테스트는 통과했다. 판정기는 맞았지만 그 상태에 이르는
     * 길이 없었다. 그 항은 지웠다(`data/endings.ts` 참고).
     *
     * 그러므로 **엔딩을 더할 때는 조건에 쓰는 플래그의 발행처를 먼저 확인한다.**
     * 아래 위 `S18-0` 이 그것을 자동으로 막는다.
     */
    expect(seen.size, [...seen].sort().join(',')).toBe(14)
  })
})

describe('S18-2 우선순위', () => {
  it('배열 순서와 priority 내림차순이 일치한다', () => {
    const p = ENDINGS.map((e) => e.priority)
    expect([...p].sort((a, b) => b - a)).toEqual(p)
  })

  it('E-05 가 E-14 를 가린다 — 동전 부자여도 TRUE 가 이긴다', () => {
    expect(at(trueRun({ tally: tally({ itemsUsed: FOUR_ITEMS, coinsEarned: 5000 }) }))).toBe('E-05')
  })

  it('E-10 양심 파산이 E-11 참사보다 아래다 — 밀었으면 참사가 이긴다', () => {
    expect(at({
      scores: { conscience: -5, style: 0, knowledge: 0 }, tally: tally({ pushes: 4 }),
    })).toBe('E-11')
  })

  it('E-09 적발이 E-13 해방을 가린다', () => {
    expect(at({ boarded: false, flags: ['BUSTED', 'TOILET_USED'] })).toBe('E-09')
  })

  it('E-13 은 탑승하면 안 나온다 — 열차를 놓친 사람의 엔딩이다', () => {
    expect(at({ boarded: true, timeLeftMs: 40_000, flags: ['TOILET_USED'] })).toBe('E-02')
  })

  it('E-12 도 탑승하면 안 나온다', () => {
    const flags: FlagId[] = ['WALLET_RETURNED', 'GRANDPA_HELPED']
    expect(at({ boarded: true, timeLeftMs: 40_000, flags })).not.toBe('E-12')
  })
})

describe('S18-3 E-05 복합 조건 — 하나씩 빼면 다른 엔딩', () => {
  it('시간이 모자라면 E-02', () => {
    expect(at(trueRun({ timeLeftMs: 45_000 }))).toBe('E-02')
  })

  it('양심이 모자라면 E-02', () => {
    expect(at(trueRun({ scores: { conscience: 2, style: 4, knowledge: 0 } }))).toBe('E-02')
  })

  it('아이템 종류가 3종이면 E-02', () => {
    expect(at(trueRun({ tally: tally({ itemsUsed: FOUR_ITEMS.slice(0, 3) }) }))).toBe('E-02')
  })

  it('한 대라도 맞았으면 E-02', () => {
    const s = start(7, trueRun())
    const hit = { ...s, chase: { ...s.chase, hitCount: 1 } }
    expect(resolveEnding(hit).id).toBe('E-02')
  })

  it('충족했을 때만 reason 이 값을 보여 준다', () => {
    const def = resolveEnding(start(7, trueRun()))
    expect(def.reason).toBeDefined()
    const text = def.reason!(start(7, trueRun()))
    expect(text).toContain('무피격')
    expect(text).toContain('양심')
  })
})

describe('S18-6 성능 회귀 — 정렬은 모듈 로드 시 한 번', () => {
  it('resolveEnding 을 5,000번 불러도 1초 안에 끝난다', () => {
    const s = start(7, { boarded: true, timeLeftMs: 20_000 })
    const t0 = Date.now()
    for (let i = 0; i < 5000; i++) resolveEnding(s)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

describe('데이터 규약', () => {
  it('실패 계열은 전부 힌트가 있다 (GDD §11 — 조롱 금지, 힌트 1줄)', () => {
    for (const e of ENDINGS) {
      if (e.tone !== 'fail') continue
      if (e.id === 'E-06') continue          // fallback 은 화면에서 시드 힌트를 뽑아 쓴다
      expect(e.hint, `${e.id} 에 힌트가 없다`).toBeTruthy()
    }
  })

  it('fallback 이 배열 마지막이다', () => {
    expect(ENDINGS[ENDINGS.length - 1]?.id).toBe('E-06')
  })
})
