import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { put, start, tap, yawTo } from './_pilot'
import { branchesFor, giftBranches } from '../../src/systems/interact'
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
