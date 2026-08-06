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
import { start } from './_pilot'

const at = (patch: Partial<GameState>): EndingId => resolveEnding(start(7, patch)).id

const tally = (over: Partial<TallyState> = {}): TallyState =>
  ({ coinsEarned: 0, itemsUsed: [], secrets: [], pushes: 0, ...over })

const FOUR_ITEMS: readonly ItemId[] = ['I-01', 'I-06', 'I-09', 'I-13']

/** E-05 TRUE 를 만족하는 최소 상태 */
const trueRun = (over: Partial<GameState> = {}): Partial<GameState> => ({
  boarded: true,
  timeLeftMs: 62_000,
  scores: { conscience: 3, style: 4, knowledge: 2 },
  tally: tally({ itemsUsed: FOUR_ITEMS }),
  ...over,
})

describe('S18-1 신규 8종이 각각 도달 가능하다', () => {
  it('E-05 지하철 마스터 (TRUE)', () => {
    expect(at(trueRun())).toBe('E-05')
  })

  it('E-12 오늘도 평화로운 역 — 미탑승 + 선행 3종', () => {
    const flags: FlagId[] = ['WALLET_RETURNED', 'GRANDPA_HELPED', 'SEAT_YIELDED']
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

  it('E-07 지각 확정 — 미탑승 + 양심 음수', () => {
    expect(at({ boarded: false, scores: { conscience: -1, style: 0, knowledge: 0 } })).toBe('E-07')
  })

  it('14종 전부 한 번씩은 나온다', () => {
    const seen = new Set<EndingId>([
      at(trueRun()),
      at({ boarded: true, tally: tally({ coinsEarned: 3000 }) }),
      at({ boarded: false, flags: ['WALLET_RETURNED', 'GRANDPA_HELPED', 'SEAT_YIELDED'] }),
      at({ scores: { conscience: -3, style: 0, knowledge: 0 } }),
      at({ tally: tally({ pushes: 3 }) }),
      at({ flags: ['BUSTED'] }),
      at({ boarded: false, flags: ['TOILET_USED'] }),
      at({ boarded: true, timeLeftMs: 40_000, flags: ['OPPOSITE_SIDE'] }),
      at({ boarded: true, timeLeftMs: 48_000, boardedDoorX: QUEUE_MARKERS[0].x }),
      at({ boarded: true, timeLeftMs: 900 }),
      at({ boarded: true, timeLeftMs: 35_000 }),
      at({ boarded: true, timeLeftMs: 12_000 }),
      at({ boarded: false, scores: { conscience: -1, style: 0, knowledge: 0 } }),
      at({}),
    ])
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
    const flags: FlagId[] = ['WALLET_RETURNED', 'GRANDPA_HELPED', 'SEAT_YIELDED']
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
