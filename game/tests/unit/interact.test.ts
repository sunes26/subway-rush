/**
 * S8 — 상호작용 코어 · 인벤토리 3슬롯.
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S8-1~S8-7
 * (S8-8~S8-10은 렌더/E2E 항목이라 `tests/e2e/p1.spec.ts` 가 덮는다)
 */

import { describe, expect, it } from 'vitest'
import { INTERACT } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import { aimAt } from '../../src/systems/interact'
import { holdFor, put, start, tap, wait, yawTo } from './_pilot'

/** 자판기 A/B/C — `data/interactables.ts` 와 같은 좌표 */
const VEND_A = { x: 13.03, y: 4.15 }
const VEND_B = { x: 21.63, y: 4.15 }
const VEND_C = { x: 25.93, y: 4.15 }
/** 우산꽂이 */
const UMB = { x: 38, y: 5.35 }

const atZ2 = (x: number, y: number, patch: Partial<GameState> = {}): GameState =>
  put(start(7, patch), x, y, FLOOR.B1)

describe('S8-1 조준 판정', () => {
  it('2.8m 앞 대상을 바라보면 조준 대상이 된다', () => {
    const s = atZ2(VEND_A.x, VEND_A.y - 2.8)
    const aim = aimAt(s, yawTo(s, VEND_A.x, VEND_A.y))
    expect(aim.id).toBe('OBJ-06')
    expect(aim.aimed, '조준이면 아웃라인이 굵어진다').toBe(true)
  })

  it('같은 거리에서 90° 돌리면 대상이 해제된다', () => {
    const s = atZ2(VEND_A.x, VEND_A.y - 2.8)
    const away = yawTo(s, VEND_A.x, VEND_A.y) + Math.PI / 2
    expect(aimAt(s, away).id, '근접 반경 1.5m 밖이므로 폴백도 없다').toBeNull()
  })

  it('사거리 3.0m를 넘으면 바라봐도 잡히지 않는다', () => {
    const s = atZ2(VEND_A.x, VEND_A.y - (INTERACT.reachM + 0.5))
    expect(aimAt(s, yawTo(s, VEND_A.x, VEND_A.y)).id).toBeNull()
  })
})

describe('S8-2 근접 폴백', () => {
  it('1.5m 안이면 등을 돌려도 대상이 된다 (aimed=false)', () => {
    const s = atZ2(VEND_A.x, VEND_A.y - 1.2)
    const back = yawTo(s, VEND_A.x, VEND_A.y) + Math.PI
    const aim = aimAt(s, back)
    expect(aim.id, 'GDD §11 — E만으로도 최근접 대상 습득 허용').toBe('OBJ-06')
    expect(aim.aimed).toBe(false)
  })
})

describe('S8-3 조준이 근접보다 우선한다', () => {
  /** B(2.87m)와 C(1.43m) 사이에 선다 — C가 더 가깝다 */
  const between = (): GameState => atZ2(24.5, 4.15)

  it('가까운 쪽을 보면 그쪽이 잡힌다', () => {
    const s = between()
    expect(aimAt(s, yawTo(s, VEND_C.x, VEND_C.y)).id).toBe('OBJ-08')
  })

  it('먼 쪽을 조준하면 **더 가까운 대상을 제치고** 먼 쪽이 이긴다', () => {
    const s = between()
    const aim = aimAt(s, yawTo(s, VEND_B.x, VEND_B.y))
    expect(aim.id, '플레이어가 화면 중앙에 둔 것이 의도다').toBe('OBJ-07')
    expect(aim.aimed).toBe(true)
  })
})

describe('S8-4 E는 원샷이다', () => {
  it('레거시 홀드 필드(interact)만으로는 아무 일도 일어나지 않는다', () => {
    let s = atZ2(UMB.x, UMB.y - 1.0)
    const yaw = yawTo(s, UMB.x, UMB.y)
    s = holdFor(s, { interact: true }, 120, yaw)
    expect(s.inventory.every((v) => v === null), '홀드는 상호작용이 아니다').toBe(true)
  })

  it('한 번 눌러 한 번 습득한다 — 진행 중 재입력은 무시된다', () => {
    let s = atZ2(UMB.x, UMB.y - 1.0)
    const yaw = yawTo(s, UMB.x, UMB.y)
    s = tap(s, { pressInteract: true }, yaw)
    expect(s.act.busyKind).toBe('pickup')
    // 진행 중 5회 더 누른다
    for (let i = 0; i < 5; i++) s = tap(s, { pressInteract: true }, yaw)
    s = wait(s, 900, yaw)
    const umbrellas = s.inventory.filter((v) => v === 'I-09').length
    expect(umbrellas, '우산은 하나만 들어온다').toBe(1)
    expect(s.drops.length, '교체가 없었으므로 바닥 잔존도 없다').toBe(0)
  })
})

describe('S8-5 습득은 0.8초 걸린다', () => {
  it('0.78초에는 아직 없고 0.82초에는 있다', () => {
    let s = atZ2(UMB.x, UMB.y - 1.0)
    const yaw = yawTo(s, UMB.x, UMB.y)
    s = tap(s, { pressInteract: true }, yaw)
    expect(s.act.busyTotalMs).toBe(INTERACT.pickupMs)

    const early = wait(s, 760, yaw)
    expect(early.inventory.includes('I-09'), '0.78s — 아직').toBe(false)

    const done = wait(s, 840, yaw)
    expect(done.inventory.includes('I-09'), '0.82s — 완료').toBe(true)
    expect(done.act.busyId, '완료되면 진행 상태가 비워진다').toBeNull()
  })
})

describe('S8-6 3슬롯 초과 습득', () => {
  const FULL: readonly (ItemId | null)[] = ['I-12', 'I-06', 'I-12']

  it('0번 슬롯이 교체되고 교체품이 그 자리 바닥에 남는다', () => {
    let s = atZ2(UMB.x, UMB.y - 1.0, { inventory: FULL })
    const yaw = yawTo(s, UMB.x, UMB.y)
    s = tap(s, { pressInteract: true }, yaw)
    s = wait(s, 900, yaw)

    expect(s.inventory[0], '새 아이템은 0번으로').toBe('I-09')
    expect(s.inventory[1]).toBe('I-06')
    expect(s.inventory[2]).toBe('I-12')
    expect(s.drops.length, '밀려난 붕어빵이 바닥에 남는다').toBe(1)
    expect(s.drops[0]?.item).toBe('I-12')
  })

  it('바닥에 남은 것을 되돌아가 다시 주울 수 있다', () => {
    let s = atZ2(UMB.x, UMB.y - 1.0, { inventory: FULL })
    const yaw = yawTo(s, UMB.x, UMB.y)
    s = wait(tap(s, { pressInteract: true }, yaw), 900, yaw)
    const drop = s.drops[0]
    expect(drop).toBeDefined()

    // 드랍은 플레이어 발밑에 생긴다 → 근접 폴백으로 바로 잡힌다
    const aim = aimAt(s, yaw)
    expect(aim.id, '드랍이 상호작용 대상으로 승격된다').toBe(drop?.id)

    s = wait(tap(s, { pressInteract: true }, yaw), 900, yaw)
    expect(s.inventory[0], '되주웠다').toBe('I-12')
    expect(s.drops.map((d) => d.item), '이번엔 우산이 밀려난다 — 자리 바꿔치기').toEqual(['I-09'])
    expect(s.drops[0]?.id, '이전 드랍 id는 소비됐다').not.toBe(drop?.id)
  })
})

describe('S8-7 조건 미충족은 사유만 낸다', () => {
  it('효자손 없이 자판기에 E — 사유 1줄, 상태 변화 0', () => {
    let s = atZ2(VEND_A.x, VEND_A.y - 1.0)
    const before = { bal: s.cardBalance, t: s.timeLeftMs, c: s.scores.conscience }
    const yaw = yawTo(s, VEND_A.x, VEND_A.y)
    s = tap(s, { pressInteract: true }, yaw)

    expect(s.act.denyText, '디렉터 지시로 두루뭉실한 힌트').toBe('효자손을 쥐고 있어야 가능할 것 같다')
    expect(s.act.denyMs).toBeGreaterThan(0)
    expect(s.qte.active, 'QTE는 열리지 않는다').toBe(false)
    expect(s.cardBalance).toBe(before.bal)
    expect(s.scores.conscience).toBe(before.c)
    // 시간은 프레임 1회분(16.7ms)만 흐른다 — 페널티가 없다는 뜻이다
    expect(before.t - s.timeLeftMs).toBeLessThan(20)
  })

  it('사유는 1.4초 뒤 사라진다', () => {
    let s = atZ2(VEND_A.x, VEND_A.y - 1.0)
    const yaw = yawTo(s, VEND_A.x, VEND_A.y)
    s = tap(s, { pressInteract: true }, yaw)
    expect(wait(s, 1200, yaw).act.denyMs).toBeGreaterThan(0)
    expect(wait(s, 1500, yaw).act.denyMs).toBe(0)
  })

  /**
   * 원래 대상은 Z1 붕어빵 노점(`OBJ-03`)이었다. `I-12` 가 양갱으로 재정의되며
   * 노점에서 정답을 직접 사는 우회로가 생겨 상호작용을 걷어냈다(Task 10,
   * `tests/unit/gift.test.ts` "퍼즐 우회로 차단"). `buy` 종류의 잔액 부족 거부는
   * 여전히 지켜야 하는 계약이므로 남은 `buy` 대상인 텀블러 커피로 옮긴다.
   */
  it('잔액 부족이면 못 산다 (buy 종류 — 편의점 텀블러 커피)', () => {
    const COFFEE = { x: 29.5, y: 25.55 }
    let s = put(start(7, { cardBalance: 300 }), COFFEE.x, COFFEE.y - 1.0, FLOOR.B1)
    const yaw = yawTo(s, COFFEE.x, COFFEE.y)
    s = tap(s, { pressInteract: true }, yaw)
    expect(s.act.denyText).toBe('돈이 부족하다')
    expect(s.cardBalance, '차감 0').toBe(300)
  })
})
