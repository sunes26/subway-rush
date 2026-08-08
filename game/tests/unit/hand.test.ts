/**
 * 손 — **언제든 장착** (디렉터 지시 2026-08-07).
 *
 * 여기서 잠그는 것은 세 가지다.
 *  1. 슬롯 키는 **쓸 데가 있으면 쓰고, 없으면 든다** — 사유만 뜨고 끝나는 경로가 없다
 *  2. 손은 인벤토리를 **앞지르지 않는다** (없는 물건을 들 수 없고, 사라지면 저절로 놓는다)
 *  3. 우산을 들면 좌클릭이 우산에게 가되, **조준한 대상이 있으면 상호작용이 이긴다**
 *
 * 우산 자체의 훑기 판정은 `crowd.test.ts` 가 인파벽 앞에서 본다 — 여기는 손 규칙만이다.
 */

import { describe, expect, it } from 'vitest'
import { GRANDPA_ID, byId } from '../../src/data/interactables'
import { UMBRELLA } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import { applyAll } from '../../src/state/reducer'
import type { GameState, ItemId } from '../../src/state/types'
import { put, start, tap } from './_pilot'

/** 아무 대상도 없는 대합실 한복판 */
const nowhere = (inv: readonly (ItemId | null)[]): GameState =>
  put(start(7, { inventory: [...inv, null, null] }), 30, 15, FLOOR.B1)

describe('슬롯 키 — 쓸 데가 없으면 든다', () => {
  /**
   * 예전엔 이 넷이 전부 `ACT_DENY(noTargetReason)` 로 끝났다. 인벤토리에 있는데
   * **화면에 없는** 상태가 게임 내내 유지됐다는 뜻이다.
   */
  const CASES: readonly ItemId[] = ['I-09', 'I-01', 'I-12', 'I-11']
  for (const item of CASES) {
    it(`${item} — 대상이 없어도 손에 들린다`, () => {
      const s = tap(nowhere([item]), { pressSlot: 1 })
      expect(s.hand.item).toBe(item)
      expect(s.hand.slot).toBe(0)
      expect(s.act.denyText, '거부가 아니라 안내다').toBe('')
      expect(s.inventory[0], '드는 것은 쓰는 것이 아니다').toBe(item)
    })
  }

  it('빈 칸을 누르면 아무 일도 없다 — 빈손을 "들지" 않는다', () => {
    const s = tap(nowhere([null]), { pressSlot: 1 })
    expect(s.hand.item).toBeNull()
    expect(s.hand.slot).toBe(-1)
  })

  /** 쓰기가 이긴다 — "언제든 장착"이 조작을 한 박자 늘리면 안 된다 */
  it('쓸 대상이 있으면 든는 게 아니라 쓴다 (할아버지 앞의 양갱)', () => {
    const gp = byId(GRANDPA_ID)!
    const s0 = put(start(7, { inventory: ['I-12', null, null] }), gp.x, gp.y - 1.2, FLOOR.B1)
    const s = tap(s0, { pressSlot: 1 })
    expect(s.act.busyKind, '드리기가 시작된다').toBe('give')
    expect(s.hand.item, '손에 들지 않는다').toBeNull()
  })

  it('토글 가능한 착용형(캐리어)은 그대로 토글이다 — 손이 아니라 몸에 걸친다', () => {
    const on = tap(nowhere(['I-10']), { pressSlot: 1 })
    expect(on.flags).toContain('CARRIER_ON')
    expect(on.hand.item, '캐리어는 손에 드는 물건이 아니다').toBeNull()
    const off = tap(on, { pressSlot: 1 })
    expect(off.flags).not.toContain('CARRIER_ON')
  })

  it('마스크는 이어폰과 같이 손에도 안 든다 — 쓰는 물건이지 드는 물건이 아니다 (디렉터 지시 갱신)', () => {
    const s = tap(nowhere(['I-06']), { pressSlot: 1 })
    expect(s.flags, '슬롯 키로는 안 켜진다').not.toContain('MASK_ON')
    expect(s.hand.item, '손에도 안 든다').toBeNull()
    expect(s.act.denyText, '거부도 아니다 — 조용히 아무 일도 안 한다').toBe('')
  })

  it('이어폰은 손에도 안 든다 — 귀에 꽂는 물건이지 드는 물건이 아니다 (디렉터 지시)', () => {
    const s = tap(nowhere(['I-05']), { pressSlot: 1 })
    expect(s.flags, '슬롯 키로는 안 켜진다').not.toContain('EARBUDS_ON')
    expect(s.hand.item, '손에도 안 든다').toBeNull()
    expect(s.act.denyText, '거부도 아니다 — 조용히 아무 일도 안 한다').toBe('')
  })
})

describe('손은 인벤토리를 앞지르지 않는다', () => {
  it('EQUIP 은 그 칸에 그 아이템이 실제로 있을 때만 먹는다', () => {
    const s = applyAll(nowhere(['I-09']), [{ t: 'EQUIP', slot: 1, item: 'I-01' }])
    expect(s.hand.item, '2번 칸은 비어 있다').toBeNull()
  })

  it('교체로 밀려나면 손이 저절로 빈다', () => {
    const held = tap(nowhere(['I-09']), { pressSlot: 1 })
    expect(held.hand.item).toBe('I-09')
    // 0번 칸을 다른 것으로 덮는다 — 우산은 바닥으로 간다
    const swapped = applyAll(held, [{ t: 'PICKUP', item: 'I-01', slot: 0, dropId: null }])
    expect(swapped.inventory[0]).toBe('I-01')
    expect(swapped.hand.item, '없는 물건을 든 채로 남지 않는다').toBeNull()
  })

  it('우산을 놓으면 펼침도 같이 접힌다', () => {
    const open = applyAll(tap(nowhere(['I-09']), { pressSlot: 1 }), [{ t: 'UMBRELLA', open: true }])
    expect(open.hand.open).toBe(true)
    const put0 = tap(open, { pressSlot: 1 })
    expect(put0.hand.item).toBeNull()
    expect(put0.hand.open, '다시 들었을 때 펼쳐진 채로 나오면 "언제 폈지"가 된다').toBe(false)
  })

  it('우산을 안 들고 있으면 UMBRELLA 액션이 무시된다', () => {
    const s = applyAll(nowhere(['I-01']), [{ t: 'UMBRELLA', open: true }])
    expect(s.hand.open).toBe(false)
  })
})

describe('우산을 들면 좌클릭이 갈린다', () => {
  it('조준 대상이 없으면 우산을 편다 (그리고 다시 누르면 접는다)', () => {
    const held = tap(nowhere(['I-09']), { pressSlot: 1 })
    const open = tap(held, { pressInteract: true })
    expect(open.hand.open).toBe(true)
    const closed = tap(open, { pressInteract: true })
    expect(closed.hand.open).toBe(false)
  })

  /**
   * 조준(`aimed`)은 화면 중앙에 대상을 둔 것이라 의도로 본다. 우산을 들었다는 이유로
   * 눈앞의 상호작용이 막히면 "왜 저게 안 되지"가 된다.
   */
  it('조준한 대상이 있으면 상호작용이 이긴다 — 우산은 안 펴진다', () => {
    const gp = byId(GRANDPA_ID)!
    const s0 = put(start(7, { inventory: ['I-09', null, null] }), gp.x, gp.y - 1.2, FLOOR.B1)
    const held = tap(s0, { pressSlot: 1 })
    const yaw = Math.atan2(gp.y - held.player.pos.y, gp.x - held.player.pos.x)
    const s = tap(held, { pressInteract: true }, yaw)
    expect(s.act.dialogId, '할아버지 선택창이 열린다').toBe(GRANDPA_ID)
    expect(s.hand.open, '우산은 그대로 접혀 있다').toBe(false)
  })
})

describe('훑기 반경 — 인파 간격과의 관계', () => {
  /**
   * `AISLE.pitch` 가 1.2m 다. 반경이 그보다 작으면 한 명 옆을 지날 때 "닿았는데 안
   * 날아갔다"가 나오고, 두 배(2.4)를 넘으면 세 명이 한 프레임에 쓸려 훑는 감각이 사라진다.
   */
  it('반경이 인파 간격보다 크고 두 배보다 작다', () => {
    expect(UMBRELLA.sweepM).toBeGreaterThan(1.2)
    expect(UMBRELLA.sweepM).toBeLessThan(2.4)
  })
})
