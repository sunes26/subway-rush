import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { CHASE, INTERACT, SLOTS } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import { put, start, tap, wait, yawTo } from './_pilot'
import { branchesFor, giftBranches, grandpaBranches } from '../../src/systems/interact'
import { chaseSystem } from '../../src/systems/chase'
import { GIFT_STALL_ID, GRANDPA_ID, INTERACTABLES } from '../../src/data/interactables'
import { DECOR } from '../../src/data/decor'
import { GIFT_ITEMS } from '../../src/data/items'
import { CLERK_POS } from '../../src/render/actors'

describe('선물 퍼즐 엔딩', () => {
  it('E-15 · E-16 · E-17 · E-18 이 등록돼 있다', () => {
    const ids = ENDINGS.map((e) => e.id)
    expect(ids).toContain('E-15')
    expect(ids).toContain('E-16')
    // 개찰구 매복(디렉터 지시) — 정원이 16에서 17로 늘었다. 이 값을 다시 16으로
    // "고치지" 말 것 — 그건 예전의 실수(14 vs 16)와는 다른, 승인된 변경이다.
    expect(ids).toContain('E-17')
    // 차에 치이면 즉사(디렉터 지시) — 정원이 17에서 18로 늘었다. 같은 이유로 되돌리지 말 것.
    expect(ids).toContain('E-18')
    expect(ENDINGS.length).toBe(18)
  })

  /**
   * 강제 엔딩은 `resolveEnding` 을 타지 않는다. `when` 이 참이 될 수 있으면
   * 열차 출발 경로에서 엉뚱하게 뽑힌다 — 그래서 항상 거짓이어야 한다.
   */
  it('강제 엔딩의 when 은 어떤 상태에서도 거짓이다', () => {
    const forced = ENDINGS.filter((e) =>
      e.id === 'E-15' || e.id === 'E-16' || e.id === 'E-17' || e.id === 'E-18')
    expect(forced).toHaveLength(4)
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
    // 5지(선물) + 마스크(6번 칸, 별개 구매) — 디렉터 지시로 매대 상품 목록에 편입
    expect(branchesFor(s, GIFT_STALL_ID).length).toBe(6)
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

/**
 * 회귀 — 슬롯 키(`useSlot`)의 `case 'I-12'` 가 정답 하나만 알고 있었다. 오답 4종은
 * `default:` 로 떨어져 `ACT_DENY('드릴 사람이 없다')` 만 뜨고 아무 일도 일어나지 않았다.
 * 할아버지 앞에서 슬롯 키를 눌러 "반응이 없으면 오답"이라는 **공짜 확인 수단**이 생겨,
 * `E-15` 가 완전히 회피 가능해지고 구매의 실패 위험이 사라졌다 — 대화창의 [2]번(`give`)
 * 경로와 슬롯 키 경로가 갈라져 있던 게 원인이다. 다섯 개 모두 같은 `complete()` 의
 * `give` 핸들러로 들어가야 정답/오답이 대화창과 동일하게 갈린다.
 */
describe('슬롯 키로 선물 전달 — 매대 5종 전부 give 로 라우팅된다', () => {
  const giveViaSlot = (item: ItemId): GameState => {
    const s0 = withGift(item)
    const pressed = tap(s0, { pressSlot: 1 })
    return wait(pressed, INTERACT.buyMs + 200)
  }

  it('양갱을 슬롯 키로 줘도 대화창 경로와 똑같이 효자손을 얻고 게임이 계속된다', () => {
    const s = giveViaSlot('I-12')
    expect(s.inventory).toContain('I-01')
    expect(s.phase).toBe('playing')
    expect(s.endingId).toBe(null)
  })

  it('오답 4종을 슬롯 키로 줘도 아무 반응 없이 넘어가지 않고 전부 E-15 로 끝난다', () => {
    for (const id of ['I-15', 'I-16', 'I-17', 'I-18'] as const) {
      const s = giveViaSlot(id)
      expect(s.phase, `${id}: 아무 일도 안 일어나면 안 된다`).toBe('ended')
      expect(s.endingId).toBe('E-15')
      expect(s.inventory).not.toContain('I-01')
    }
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

  /**
   * 회귀 — `kind: 'inspect'` 상호작용은 정의돼도 `render/props.ts` 가
   * `kind === 'pickup' && gives` 만 그려서 화면엔 아무것도 안 섰다. 힌트가
   * 안 보이면 정답(`I-12`)을 알 방법이 조준뿐이라 사실상 1/5 확률 도박이 된다.
   * `data/decor.ts` 의 `DECOR` 가 같은 좌표에 `I-12` 메시를 얹어 채운다.
   */
  it('힌트마다 I-12 메시를 빌린 장식이 같은 좌표에 있다', () => {
    for (const h of hints()) {
      const d = DECOR.find((x) => x.x === h.x && x.y === h.y)
      expect(d, `${h.id} 자리에 장식이 없다`).toBeDefined()
      expect(d!.item).toBe('I-12')
    }
  })

  it('세 장식의 yaw 가 서로 다르다 — 같은 각이면 복제한 티가 난다', () => {
    const yaws = hints().map((h) => DECOR.find((d) => d.x === h.x && d.y === h.y)!.yaw)
    expect(new Set(yaws).size).toBe(yaws.length)
  })

  /**
   * `render/props.ts` 는 `DECOR` 전체를 **하나의 무리**로 묶어 그 중심에서
   * `DECOR_VISIBLE_M`(12m, 리터럴 — export 되지 않아 여기 그대로 박는다) 안일 때만
   * 켠다. 우산꽂이 무리(38, 5)에 벤치 무리(~42, 14)가 새로 섞이면서 중심이
   * (39.9, 8.8) 근처로 옮겨졌다 — 두 무리 다 여전히 반경 안임을 고정한다.
   * 이 테스트가 없으면 세 번째 무리가 추가될 때 기존 무리 하나가 조용히
   * 반경 밖으로 밀려나 사라져도 아무도 모른다.
   */
  it('장식 컬링 반경 — 모든 DECOR 항목이 전체 중심에서 12m 이내다', () => {
    const DECOR_VISIBLE_M = 12 // render/props.ts 의 동명 상수와 같은 값(export 안 됨)
    const cx = DECOR.reduce((a, d) => a + d.x, 0) / DECOR.length
    const cy = DECOR.reduce((a, d) => a + d.y, 0) / DECOR.length
    for (const d of DECOR) {
      expect(Math.hypot(d.x - cx, d.y - cy)).toBeLessThan(DECOR_VISIBLE_M)
    }
  })
})

describe('퍼즐 우회로 차단', () => {
  /**
   * 선물은 **편의점에서만** 얻는다. 다른 곳에서 선물 5종 중 하나라도 살 수 있으면
   * 5지 선택이 의미를 잃는다 — 정답만 골라 사면 그만이기 때문이다.
   */
  it('편의점 매대 말고는 선물을 주는 상호작용이 없다', () => {
    const givers = INTERACTABLES.filter(
      (i) => i.gives !== undefined && GIFT_ITEMS.includes(i.gives),
    )
    expect(givers.map((i) => i.id)).toEqual([])
  })
})

describe('ACT-12 편의점 점원', () => {
  /**
   * `OBJ-19-CVS` = rect[21.5, 25.7, 26.5, 30.0] 는 충돌 솔리드일 뿐, 점포 **내부**는
   * 가구(카운터·곤돌라·냉장고)로 채워져 있어 이 사각형 전체가 걸어다닐 수 있는
   * 바닥은 아니다. 이전 가드는 이 충돌 bbox 만 봐서 점원이 카운터 몸통 안(y=26.4)에
   * 박혀 있어도 통과했다 — 구조적으로 못 잡는 회귀였다.
   *
   * `Z2_CONCOURSE.glb` 를 정점 단위로 확인한 실측(카운터 CVS 파트만 x<27 로 격리):
   *   · 카운터(`Z2_SHOP_ST_COUNTER`) — x[24.55, 26.15] · y[26.05, 26.75], 바닥부터 0.95m 솔리드
   *   · 곤돌라(x≈24.65) — x[24.23, 25.07] 까지만, 점원의 x=25.8 열에는 안 걸린다
   *   · 냉장고 정면(VM_TRIM/VM_CAN) — y≈29.2 부터 시작
   * 그 사이 y(26.75~29.2)가 유리 너머로 보이는 실제 통로다. 점원은 그 안에 서야 한다.
   */
  it('점원이 카운터 뒤 통로에 선다 — 충돌 bbox 안이 아니라 걸어다닐 수 있는 통로 안', () => {
    expect(CLERK_POS.x).toBeGreaterThan(21.5)
    expect(CLERK_POS.x).toBeLessThan(26.5)
    expect(CLERK_POS.y, '카운터 뒷면(26.75)보다 안쪽').toBeGreaterThan(26.75)
    expect(CLERK_POS.y, '냉장고 정면(≈29.2)보다 앞쪽').toBeLessThan(29.2)
  })

  /** 매대(x=26.0) 정면이어야 말을 거는 그림이 된다 — x 로 1.5m 안 */
  it('매대 정면에 선다', () => {
    expect(Math.abs(CLERK_POS.x - 26.0)).toBeLessThan(1.5)
  })
})

describe('마스크 — 선물 퍼즐과 무관한 별개 구매', () => {
  /**
   * 물리 진열대(`OBJ-19-MASK`)는 없앴다(디렉터 지시) — 편의점 상점
   * (`GIFT_STALL_ID`) 대화의 6번 칸이 마스크의 유일한 구매처다.
   */
  const stall = INTERACTABLES.find((i) => i.id === GIFT_STALL_ID)!
  const openStall = (patch: Partial<GameState> = {}): GameState => {
    const s0 = put(start(7, { cardBalance: 1500, ...patch }), stall.x, stall.y - 1.1, stall.z)
    return tap(s0, { pressInteract: true }, yawTo(s0, stall.x, stall.y))
  }
  const buyMask = (patch: Partial<GameState> = {}): GameState => {
    const opened = openStall(patch)
    return tap(opened, { pressSlot: 6 }, yawTo(opened, stall.x, stall.y))
  }

  it('물리 진열대는 더 이상 없다', () => {
    expect(INTERACTABLES.some((i) => i.id === 'OBJ-19-MASK')).toBe(false)
  })

  it('편의점 상점 6번 칸에서 살 수 있다', () => {
    const s = buyMask()
    expect(s.inventory).toContain('I-06')
    expect(s.flags).toContain('MASK_ON')
    expect(s.cardBalance).toBe(0)
  })

  it('선물(GIFT_BOUGHT)을 이미 골랐어도 마스크는 따로 살 수 있다', () => {
    const s = buyMask({ flags: ['GIFT_BOUGHT'] })
    expect(s.inventory).toContain('I-06')
    expect(s.flags).toContain('MASK_ON')
  })

  it('마스크를 사도 GIFT_BOUGHT 는 안 켜진다 — 선물 5지는 그대로 열려 있다', () => {
    const s = buyMask()
    expect(s.flags).not.toContain('GIFT_BOUGHT')
    expect(giftBranches(s).every((x) => x.enabled)).toBe(true)
  })

  it('잔액이 모자라면 못 산다', () => {
    const s = buyMask({ cardBalance: 0 })
    expect(s.inventory).not.toContain('I-06')
  })

  it('6번 칸의 note 가 상태를 반영한다', () => {
    const before = branchesFor(start(7, { cardBalance: 1500 }), GIFT_STALL_ID).find((b) => b.key === 6)!
    expect(before.enabled).toBe(true)
    expect(before.note).toBe('')

    const after = branchesFor(buyMask(), GIFT_STALL_ID).find((b) => b.key === 6)!
    expect(after.enabled).toBe(false)
    expect(after.note).toBe('이미 샀다')
  })

  it('한 번 사면 다시 눌러도 재차감되지 않는다', () => {
    const owned = buyMask()
    const opened = openStall({ ...owned, cardBalance: 1500 })
    const balanceBefore = opened.cardBalance
    const s = tap(opened, { pressSlot: 6 }, yawTo(opened, stall.x, stall.y))
    expect(s.cardBalance).toBe(balanceBefore)
    expect(s.inventory.filter((i) => i === 'I-06').length).toBe(1)
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
