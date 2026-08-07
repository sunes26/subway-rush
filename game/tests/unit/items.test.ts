/**
 * S15 — 아이템 11종 + 동전 + 교체 창 (`docs/P2-TECH-PLAN.md` §4 S15)
 */

import { describe, expect, it } from 'vitest'
import { DECOR } from '../../src/data/decor'
import { INTERACTABLES, coinValue, isCoin } from '../../src/data/interactables'
import { GIFT_ITEMS, ITEMS, SLOT_ITEMS, WEARABLES, itemDef } from '../../src/data/items'
import { COIN, SLOTS, SWAP_WINDOW_MS } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import { PLACEHOLDER_ITEMS } from '../../src/render/props'
import type { GameState, ItemId } from '../../src/state/types'
import { put, start, tap, wait, yawTo } from './_pilot'

/** 아이템이 놓인 자리 — `data/interactables.ts` 와 같은 좌표여야 한다 */
const spotOf = (id: string) => {
  const it = INTERACTABLES.find((x) => x.id === id)
  if (!it) throw new Error(`no interactable ${id}`)
  return it
}

/** 대상 앞 1.1m 에 세워 놓고 바로 줍는다 — 이동 경로는 여기서 검증 대상이 아니다 */
const grab = (id: string, patch: Partial<GameState> = {}): GameState => {
  const it = spotOf(id)
  const floor = it.z > -3 ? FLOOR.L0 : it.z < -12 ? it.z : FLOOR.B1
  const s = put(start(7, patch), it.x, it.y - 1.1, floor)
  const yaw = yawTo(s, it.x, it.y)
  // 습득 0.8s + 교체 창 0.9s 를 둘 다 넘긴다 — `grab` 은 "다 끝난 뒤"의 상태를 본다
  return wait(tap(s, { pressInteract: true }, yaw), 2400, yaw)
}

describe('S15-1 신규 7종 습득', () => {
  const CASES: readonly (readonly [string, ItemId])[] = [
    ['Z1-ITM05', 'I-05'],
    ['OBJ-18-COFFEE', 'I-07'],
    ['OBJ-17-PAPER', 'I-08'],
    ['OBJ-13-BAG', 'I-10'],
    ['OBJ-11-WALLET', 'I-11'],
    ['OBJ-15-MAP', 'I-13'],
    ['OBJ-25-EMP', 'I-14'],
  ]

  for (const [objId, item] of CASES) {
    it(`${objId} → ${itemDef(item).name}`, () => {
      const s = grab(objId, { cardBalance: 2000 })
      expect(s.inventory).toContain(item)
    })
  }

  it('커피는 잔액이 모자라면 사유만 나오고 잔액이 안 준다', () => {
    const s = grab('OBJ-18-COFFEE', { cardBalance: 100 })
    expect(s.inventory).not.toContain('I-07')
    expect(s.cardBalance).toBe(100)
    expect(s.act.denyText.length).toBeGreaterThan(0)
  })

  it('11종이 전부 슬롯 점유이고 동전·카드만 미점유다', () => {
    expect(SLOT_ITEMS.length).toBe(15)
    expect(ITEMS['I-02']?.slot).toBe(false)
    expect(ITEMS['I-04']?.slot).toBe(false)
  })
})

describe('S22-4 우산꽂이 장식 · 벽 노선도 (디렉터 지시)', () => {
  it('장식 우산은 꽂이(38, 5) 통 안에 있고 습득물과 안 겹친다', () => {
    expect(DECOR.length).toBeGreaterThanOrEqual(4)
    const umb = spotOf('OBJ-16')
    for (const d of DECOR) {
      // 통 반폭 0.4 × 반깊이 0.21 — 이 밖이면 우산이 허공이나 바닥에 선다
      expect(Math.abs(d.x - 38), d.id).toBeLessThanOrEqual(0.4)
      expect(Math.abs(d.y - 5), d.id).toBeLessThanOrEqual(0.21)
      // 습득 가능한 우산과 겹치면 "왜 이건 안 주워지지"가 된다
      expect(Math.hypot(d.x - umb.x, d.y - umb.y), `${d.id} 가 습득물과 겹친다`)
        .toBeGreaterThan(0.1)
      expect(() => itemDef(d.item)).not.toThrow()
    }
  })

  it('노선도는 남쪽 벽에 붙어 있고 인쇄면이 대합실을 본다', () => {
    const map = spotOf('OBJ-15-MAP')
    expect(map.gives).toBe('I-13')
    expect(map.y, '벽면(y=0)에서 10cm 안쪽이어야 벽에 붙은 것으로 보인다').toBeLessThan(0.1)
    expect(map.z, '눈높이').toBeCloseTo(FLOOR.B1 + 1.5, 2)
    expect(map.faceYaw, '인쇄면이 북쪽을 봐야 읽힌다').toBeCloseTo(Math.PI, 3)
    expect(map.backlit, '이 조명에서 무광 인쇄물은 새까맣게 나온다').toBe(true)
    expect(map.propScale ?? 1).toBeGreaterThan(1)
  })
})

describe('S22-3 소지품 10칸 (디렉터 지시)', () => {
  it('SLOTS 는 10 이고 마지막 칸(키 `0`)도 쓸 수 있다', () => {
    expect(SLOTS).toBe(10)
    const inv: (ItemId | null)[] = Array.from({ length: SLOTS }, () => null)
    inv[SLOTS - 1] = 'I-05'
    const s = tap(start(7, { inventory: inv }), { pressSlot: SLOTS })
    expect(s.flags, '경계 칸이 안 먹으면 마지막 슬롯이 죽은 칸이 된다').toContain('EARBUDS_ON')
  })

  it('슬롯 수를 넘는 입력은 무시한다', () => {
    const inv: (ItemId | null)[] = Array.from({ length: SLOTS }, () => null)
    inv[0] = 'I-05'
    const s = tap(start(7, { inventory: inv }), { pressSlot: SLOTS + 1 })
    expect(s.flags).not.toContain('EARBUDS_ON')
  })
})

describe('S22-2 즉시 착용 (디렉터 지시)', () => {
  it('무선이어폰(I-05)은 줍는 즉시 켜져 있다', () => {
    const s = grab('Z1-ITM05')
    expect(s.inventory).toContain('I-05')
    expect(s.flags, '주웠는데 꺼져 있으면 한 번 더 눌러야 한다 — 그 한 번이 지시의 대상이었다')
      .toContain('EARBUDS_ON')
  })

  it('즉시 착용도 되돌릴 수 있다 — 대가가 있는 착용이므로', () => {
    const s = grab('Z1-ITM05')
    const slot = s.inventory.indexOf('I-05') + 1
    const off = tap(s, { pressSlot: slot })
    expect(off.flags).not.toContain('EARBUDS_ON')
  })

  it('즉시 착용은 대가가 가벼운 착용형에만 준다', () => {
    // 손이 묶이거나 시야가 막히는 착용형까지 자동으로 켜지면 그건 선택이 아니라 사고다
    const auto = ITEMS_AUTO()
    expect(auto).toEqual(['I-05'])
  })
})

const ITEMS_AUTO = (): readonly string[] =>
  Object.values(ITEMS).filter((d) => d?.autoWear).map((d) => (d as { id: string }).id)

describe('S15-2 착용형 토글', () => {
  const wear = (item: ItemId): GameState =>
    tap(start(7, { inventory: [item, null, null] }), { pressSlot: 1 })

  for (const def of WEARABLES) {
    it(`${def.name} — 켜고 끌 수 있다`, () => {
      const on = wear(def.id)
      expect(def.flag).toBeDefined()
      expect(on.flags).toContain(def.flag)
      const off = tap(on, { pressSlot: 1 })
      expect(off.flags, 'P2는 되돌릴 수 있다 — 대가 있는 착용이 들어왔으므로').not.toContain(def.flag)
      expect(off.inventory[0], '착용형은 슬롯을 안 비운다').toBe(def.id)
    })
  }

  it('착용형 3종 전부 대가가 적혀 있다', () => {
    for (const d of WEARABLES) expect(d.cost, `${d.name} 에 대가가 없다`).toBeTruthy()
  })

  it('노선도는 착용이 아니라 펼침 토글이다 (슬롯 유지)', () => {
    const open = tap(start(7, { inventory: ['I-13', null, null] }), { pressSlot: 1 })
    expect(open.flags).toContain('MAP_OPEN')
    expect(open.inventory[0]).toBe('I-13')
  })
})

describe('S15-3 소모형', () => {
  it('커피 — 슬롯이 비고 스태미너가 찬다', () => {
    const before = start(7, {
      inventory: ['I-07', null, null],
      player: { ...start(7).player, stamina: 12 },
    })
    const after = tap(before, { pressSlot: 1 })
    expect(after.inventory[0]).toBeNull()
    expect(after.player.stamina).toBe(100)
    expect(after.flags).toContain('CAFFEINE')
  })

  it('스타일 축은 종류 수다 — 같은 걸 두 번 써도 1', () => {
    const s1 = tap(start(7, { inventory: ['I-06', null, null] }), { pressSlot: 1 })
    const s2 = tap(tap(s1, { pressSlot: 1 }), { pressSlot: 1 })
    expect(s2.tally.itemsUsed.filter((i) => i === 'I-06').length).toBe(1)
  })
})

describe('S15-4 동전 (I-02)', () => {
  const coins = INTERACTABLES.filter((i) => isCoin(i.id))

  it('바닥 동전이 6개다', () => {
    expect(coins.length).toBe(6)
  })

  it('가치가 100~300원 · 50원 단위', () => {
    for (const seed of [1, 7, 99, 4242]) {
      for (const c of coins) {
        const v = coinValue(seed, c.id)
        expect(v).toBeGreaterThanOrEqual(COIN.min)
        expect(v).toBeLessThanOrEqual(COIN.max)
        expect(v % COIN.step).toBe(0)
      }
    }
  })

  it('같은 시드는 같은 값, 다른 동전은 다른 값이 섞인다', () => {
    expect(coinValue(7, coins[0]!.id)).toBe(coinValue(7, coins[0]!.id))
    const vals = new Set(coins.map((c) => coinValue(7, c.id)))
    expect(vals.size).toBeGreaterThan(1)
  })

  it('주우면 잔액이 늘고 슬롯은 안 건드린다 — 가득 차 있어도 주울 수 있다', () => {
    const full: readonly (ItemId | null)[] = ['I-01', 'I-06', 'I-09']
    const c = coins[0]!
    const s0 = put(start(7, { inventory: full, cardBalance: 500 }), c.x, c.y - 1.0, FLOOR.B1)
    const yaw = yawTo(s0, c.x, c.y)
    const s = wait(tap(s0, { pressInteract: true }, yaw), 1400, yaw)
    expect(s.cardBalance).toBe(500 + coinValue(7, c.id))
    expect(s.inventory).toEqual(full)
    expect(s.swap.active, '동전은 교체 창을 안 연다').toBe(false)
    expect(s.tally.coinsEarned).toBe(coinValue(7, c.id))
  })

  it('한 번 주우면 사라진다', () => {
    const c = coins[0]!
    const s0 = put(start(7, { cardBalance: 0 }), c.x, c.y - 1.0, FLOOR.B1)
    const yaw = yawTo(s0, c.x, c.y)
    const once = wait(tap(s0, { pressInteract: true }, yaw), 1400, yaw)
    const twice = wait(tap(once, { pressInteract: true }, yaw), 1400, yaw)
    expect(twice.cardBalance).toBe(once.cardBalance)
  })
})

describe('S15-5 교체 창 (UI-14)', () => {
  const FULL: readonly (ItemId | null)[] = ['I-12', 'I-06', 'I-09']

  /** 우산꽂이에서 우산을 줍는다 — 슬롯이 가득 차 있으므로 0번이 밀려난다 */
  const pickIntoFull = (): GameState =>
    grab('OBJ-15-MAP', { inventory: FULL })

  it('가득 찬 채 습득하면 P1 동작이 먼저 일어나고 교체 창이 열린다', () => {
    const it = spotOf('OBJ-15-MAP')
    const s0 = put(start(7, { inventory: FULL }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    const s = wait(tap(s0, { pressInteract: true }, yaw), 850, yaw)
    expect(s.inventory[0], 'P1 규칙 — 0번이 교체된다').toBe('I-13')
    expect(s.drops[0]?.item, '밀려난 것은 바닥에').toBe('I-12')
    expect(s.swap.active).toBe(true)
    expect(s.swap.leftMs).toBeGreaterThan(0)
    expect(s.swap.leftMs).toBeLessThanOrEqual(SWAP_WINDOW_MS)
  })

  it('창 안에서 2를 누르면 새 아이템이 1번 칸으로 간다', () => {
    const it = spotOf('OBJ-15-MAP')
    const s0 = put(start(7, { inventory: FULL }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    let s = wait(tap(s0, { pressInteract: true }, yaw), 850, yaw)
    s = tap(s, { pressSlot: 2 }, yaw)
    expect(s.inventory[0], '원래 0번이 돌아온다').toBe('I-12')
    expect(s.inventory[1], '새 아이템이 고른 칸으로').toBe('I-13')
    expect(s.drops[0]?.item, '이번엔 마스크가 밀려난다').toBe('I-06')
    expect(s.swap.active).toBe(false)
  })

  it('창 안에서 ESC 는 습득을 되돌린다', () => {
    const it = spotOf('OBJ-15-MAP')
    const s0 = put(start(7, { inventory: FULL }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    let s = wait(tap(s0, { pressInteract: true }, yaw), 850, yaw)
    s = tap(s, { pressCancel: true }, yaw)
    expect(s.inventory).toEqual(FULL)
    expect(s.drops[0]?.item, '새 아이템이 바닥에 남는다').toBe('I-13')
    expect(s.swap.active).toBe(false)
  })

  it('0.9초를 넘기면 창이 닫히고 P1 결과가 그대로 남는다', () => {
    const s = pickIntoFull()
    expect(s.swap.active).toBe(false)
    expect(s.inventory[0]).toBe('I-13')
    expect(s.drops[0]?.item).toBe('I-12')
  })

  it('빈 칸에 들어가면 창이 안 열린다 — 고를 것이 없다', () => {
    const s = grab('OBJ-15-MAP', { inventory: [null, null, null] })
    expect(s.swap.active).toBe(false)
    expect(s.drops.length).toBe(0)
  })

  it('창 안에서 누른 슬롯 키가 그 칸 아이템을 **사용**하지 않는다', () => {
    const it = spotOf('OBJ-15-MAP')
    const s0 = put(start(7, { inventory: FULL }), it.x, it.y - 1.1, FLOOR.B1)
    const yaw = yawTo(s0, it.x, it.y)
    let s = wait(tap(s0, { pressInteract: true }, yaw), 850, yaw)
    s = tap(s, { pressSlot: 2 }, yaw)
    expect(s.flags, '2번 칸 마스크가 착용되지 않았다').not.toContain('MASK_ON')
  })
})

describe('S15-6 P1 회귀 — 떨군 것은 되찾을 수 있다', () => {
  it('교체로 밀려난 아이템이 발밑 드랍으로 남는다', () => {
    const s = grab('OBJ-15-MAP', { inventory: ['I-12', 'I-06', 'I-09'] })
    expect(s.drops.length).toBe(1)
    const d = s.drops[0]!
    expect(Math.hypot(d.x - s.player.pos.x, d.y - s.player.pos.y)).toBeLessThan(0.5)
  })
})

describe('아이템 표 정합성', () => {
  it('정의 없는 ID 는 자리표시자를 돌려주고 던지지 않는다', () => {
    // I-15 는 편의점 선물 태스크에서 실제 정의를 받았다 — 더 이상 미정의 예시가 아니다.
    // 유니온 밖의 값으로 미정의 경로만 따로 검증한다.
    const undefinedId = 'I-99' as ItemId
    expect(() => itemDef(undefinedId)).not.toThrow()
    expect(itemDef(undefinedId).name).toBe('I-99')
  })

  it('배치된 gives 는 전부 정의가 있다', () => {
    for (const it of INTERACTABLES) {
      if (!it.gives) continue
      expect(ITEMS[it.gives], `${it.id} 가 주는 ${it.gives} 정의 없음`).toBeDefined()
    }
  })
})

describe('편의점 선물 5종', () => {
  it('5종이 전부 정의돼 있고 노드 이름이 GLB 와 맞는다', () => {
    expect(GIFT_ITEMS).toEqual(['I-12', 'I-15', 'I-16', 'I-17', 'I-18'])
    expect(GIFT_ITEMS.map((i) => itemDef(i).node)).toEqual([
      'ITM12_Yanggaeng', 'ITM12_BananaMilk', 'ITM12_Chocolate',
      'ITM12_Soda', 'ITM12_SnackBag',
    ])
  })

  it('정답만 OBS-14 를 무효화한다', () => {
    expect(itemDef('I-12').negates).toEqual(['OBS-14'])
    for (const id of ['I-15', 'I-16', 'I-17', 'I-18'] as const) {
      expect(itemDef(id).negates ?? []).toEqual([])
    }
  })

  it('정답은 더 이상 자리표시자가 아니다', () => {
    expect(PLACEHOLDER_ITEMS.has('I-12')).toBe(false)
  })
})
