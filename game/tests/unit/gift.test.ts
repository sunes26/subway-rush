import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { CHASE, INTERACT, SLOTS } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import { put, start, tap, wait, yawTo } from './_pilot'
import { branchesFor, giftBranches, grandpaBranches } from '../../src/systems/interact'
import { chaseSystem } from '../../src/systems/chase'
import { GIFT_STALL_ID, GRANDPA_ID, INTERACTABLES } from '../../src/data/interactables'

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

describe('편의점 매대', () => {
  it('5지 선택이고 순서가 GIFT_ITEMS 와 같다', () => {
    const b = giftBranches(start(1))
    expect(b.map((x) => x.key)).toEqual([1, 2, 3, 4, 5])
    expect(b.map((x) => x.label)).toEqual([
      '양갱', '바나나우유', '초콜릿', '탄산음료', '새우깡',
    ])
  })

  /** note 가 서로 다르면 그 자체가 정답 힌트가 된다 — 전부 비어 있어야 한다 */
  it('구매 전에는 전부 고를 수 있고 note 가 비어 있다', () => {
    const b = giftBranches(start(1))
    expect(b.every((x) => x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '')).toBe(true)
  })

  it('한 번 사면 전부 잠긴다', () => {
    const s = start(1)
    const bought = { ...s, flags: [...s.flags, 'GIFT_BOUGHT' as const] }
    const b = giftBranches(bought)
    expect(b.every((x) => !x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '이미 골랐다')).toBe(true)
  })

  it('매대가 편의점 슬랩 위에 있다', () => {
    const it0 = INTERACTABLES.find((i) => i.id === GIFT_STALL_ID)
    expect(it0).toBeDefined()
    expect(it0?.kind).toBe('talk')
    // 슬랩(Z2-NE)은 y=25.4 에서 시작하고 파사드는 y=25.7 이다
    expect(it0!.y).toBeGreaterThan(25.4)
    expect(it0!.y).toBeLessThan(25.7)
  })

  /**
   * 회귀 — 매대에서 연 대화창에서 `1` 을 누르면 할아버지의 [1]훔치기(steal)가
   * 실행되던 버그. `dialogPick` 이 **어느 상호작용물이 대화를 열었는지 확인하지
   * 않고** `grandpaBranches` 를 무조건 평가했기 때문에, 'talk' 종류가 할아버지
   * 하나뿐이던 시절의 가정이 매대 추가로 깨졌다.
   *
   * 매대(x=26)는 할아버지(x=42)와 지도 반대편만큼 멀리 떨어져 있다.
   * 매대 대화에서 [1]을 눌러도 아무 일도 일어나지 않아야 한다: I-01 습득 없음,
   * GRANDPA_ANGRY 없음, 할아버지 소진 없음.
   */
  it('매대 대화에서 1을 눌러도 할아버지의 훔치기가 실행되지 않는다', () => {
    const gift = INTERACTABLES.find((i) => i.id === GIFT_STALL_ID)!
    const s0 = put(start(1), gift.x, gift.y - 1.2, gift.z)
    const yaw = yawTo(s0, gift.x, gift.y)
    let s = tap(s0, { pressInteract: true }, yaw)
    expect(s.act.dialogId).toBe(GIFT_STALL_ID)

    s = tap(s, { pressSlot: 1 }, yaw)

    expect(s.inventory).not.toContain('I-01')
    expect(s.flags).not.toContain('GRANDPA_ANGRY')
    expect(s.act.consumed).not.toContain(GRANDPA_ID)
  })
})

describe('대화창 라우팅', () => {
  it('대화 상대에 따라 분기가 갈린다', () => {
    const s = start(1)
    expect(branchesFor(s, GIFT_STALL_ID).length).toBe(5)
    expect(branchesFor(s, GRANDPA_ID).length).toBe(3)
  })

  it('모르는 상대면 빈 배열 — 화면에 아무것도 안 뜬다', () => {
    expect(branchesFor(start(1), 'OBJ-NOPE')).toEqual([])
  })
})

/** 선물 하나를 들고 할아버지 앞 1.1m 에 선다 */
const withGift = (item: ItemId): GameState => {
  const inv: (ItemId | null)[] = Array.from({ length: SLOTS }, () => null)
  inv[0] = item
  const s = start(7, { phase: 'playing', inventory: inv })
  return put(s, 42, 14.9 - 1.1, FLOOR.B1)
}

/** 대화를 열고 [2] 선물을 드린다 → 완료까지 기다린다 */
const giveIt = (item: ItemId): GameState => {
  const s0 = withGift(item)
  const yaw = yawTo(s0, 42, 14.9)
  const opened = tap(s0, { pressInteract: true }, yaw)
  const picked = tap(opened, { pressSlot: 2 }, yaw)
  return wait(picked, INTERACT.buyMs + 200, yaw)
}

describe('선물 증정', () => {
  it('양갱이면 효자손을 얻고 게임이 계속된다', () => {
    const s = giveIt('I-12')
    expect(s.inventory).toContain('I-01')
    expect(s.phase).toBe('playing')
    expect(s.endingId).toBe(null)
    // 양심 +1 은 E-12 히든 엔딩 조건이다 — 개편에서 빠뜨리기 쉬운 자리
    expect(s.scores.conscience).toBeGreaterThan(0)
  })

  it('오답 4종은 전부 E-15 로 끝난다', () => {
    for (const id of ['I-15', 'I-16', 'I-17', 'I-18'] as const) {
      const s = giveIt(id)
      expect(s.phase).toBe('ended')
      expect(s.endingId).toBe('E-15')
      expect(s.inventory).not.toContain('I-01')
    }
  })

  it('선물이 없으면 증정 분기가 잠긴다', () => {
    const b = grandpaBranches(start(7)).find((x) => x.key === 2)!
    expect(b.enabled).toBe(false)
    expect(b.note).toBe('선물이 없다')
  })

  it('선물이 있으면 열린다', () => {
    const b = grandpaBranches(withGift('I-17')).find((x) => x.key === 2)!
    expect(b.enabled).toBe(true)
  })
})

describe('바닥 양갱 힌트', () => {
  const hints = () => INTERACTABLES.filter((i) => i.kind === 'inspect')

  /** "포장이 여럿"이라는 문구가 화면과 맞아야 한다 — 하나면 우연으로 읽힌다 */
  it('벤치 근처에 3개가 있다', () => {
    expect(hints().length).toBe(3)
    for (const h of hints()) {
      expect(Math.hypot(h.x - 42, h.y - 14.9)).toBeLessThan(4)
    }
  })

  it('벤치 솔리드와 겹치지 않는다', () => {
    // ACT-02-BENCH = rect[40.8, 14.6, 43.2, 15.4]
    for (const h of hints()) {
      const inside = h.x >= 40.8 && h.x <= 43.2 && h.y >= 14.6 && h.y <= 15.4
      expect(inside).toBe(false)
    }
  })

  it('획득되지 않고 몇 번이고 볼 수 있다', () => {
    for (const h of hints()) {
      expect(h.gives).toBeUndefined()
      expect(h.once).toBe(false)
    }
  })
})

describe('추격 개편', () => {
  it('10초로 줄었고 회수 개념이 사라졌다', () => {
    expect(CHASE.durationMs).toBe(10_000)
    expect('seizeHits' in CHASE).toBe(false)
  })

  it('2대째에 E-16 으로 끝난다', () => {
    const s = start(1)
    const hit1 = {
      ...s, phase: 'playing' as const,
      chase: { ...s.chase, active: true, phase: 'chase' as const, hitCount: 1, remainingMs: 5000 },
    }
    const hit2 = { ...hit1, chase: { ...hit1.chase, hitCount: 2 } }
    expect(chaseSystem(hit1, { dtMs: 16 }).some((a) => a.t === 'END')).toBe(false)
    expect(chaseSystem(hit2, { dtMs: 16 })
      .some((a) => a.t === 'END' && a.endingId === 'E-16')).toBe(true)
  })
})
