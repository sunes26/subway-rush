/**
 * S16 — 방해요소 (`docs/P2-TECH-PLAN.md` §4 S16)
 *
 * OBS-13(역무원)은 액터라 `staff.test.ts` 가 맡는다.
 */

import { describe, expect, it } from 'vitest'
import { ACTIVE_OBSTACLES, OBSTACLES, type ObsId } from '../../src/data/obstacles'
import { negatorsOf } from '../../src/data/items'
import { FLOOR } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import {
  CONSTRUCTION_POCKET, RULE_IDS, WET_ZONE, auntieAt, studentAt, zombieAt,
} from '../../src/systems/obstacles'
import { holdFor, put, start } from './_pilot'

/** 아주머니·학생은 이제 순찰한다 — 테스트는 t=0 위치를 고정 좌표로 쓴다 */
const AUNTIE_AT = auntieAt(0)
const STUDENT_AT = studentAt(0)

/** 이제 `start()` 자체가 항상 전부 켠 상태다(S14) — 이름만 남긴다 */
const armed = (patch: Partial<GameState> = {}): GameState =>
  start(7, patch)

const mid = (r: readonly [number, number, number, number]) =>
  ({ x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 })

/** 특정 자리에 서서 n프레임 버틴다 */
const stand = (s: GameState, x: number, y: number, z: number, steps = 4): GameState =>
  holdFor(put(s, x, y, z), {}, steps)

describe('S16-1 각 방해요소가 발동한다', () => {
  it('OBS-07 아주머니 — 반경 안이면 강제 대화가 시작된다', () => {
    const s = stand(armed(), AUNTIE_AT.x, AUNTIE_AT.y - 2.0, FLOOR.L0)
    expect(s.preach.active).toBe(true)
  })

  it('OBS-07 학생 — 아주머니와 독립된 반경이라도 같은 대화가 시작된다', () => {
    const s = stand(armed(), STUDENT_AT.x, STUDENT_AT.y - 2.0, FLOOR.L0)
    expect(s.preach.active).toBe(true)
  })

  it('OBS-10 공사 — 막다른 주머니에 들어가면 −20s', () => {
    const p = mid(CONSTRUCTION_POCKET)
    const s = stand(armed(), p.x, p.y, FLOOR.B1)
    expect(s.timeLeftMs).toBeLessThan(180_000 - 20_000)
  })

  it('OBS-08 좀비폰족 — 진행 경로 위에 서 있으면 부딪혀 대화가 뜬다', () => {
    let s = armed()
    // 위치가 시간의 순수 함수이므로 **좀비를 플레이어에게 오게** 한다
    let hit = false
    for (let i = 0; i < 900 && !hit; i++) {
      const z = zombieAt(s.elapsedMs)
      s = holdFor(put(s, z.x, z.y, FLOOR.B1), {}, 1)
      hit = s.zombieTalk.active
    }
    expect(hit, '좀비 위치에 서면 반드시 부딪힌다').toBe(true)
  })

  it('OBS-05 물청소 — **뛸 때만** 미끄러진다', () => {
    const p = mid(WET_ZONE)
    const sprint = holdFor(put(armed(), p.x - 1, p.y, FLOOR.B1), { moveY: 1, sprint: true }, 20)
    expect(sprint.player.stallMs, '뛰면 미끄러진다').toBeGreaterThan(0)

    const walk = holdFor(put(armed(), p.x - 1, p.y, FLOOR.B1), { moveY: 1 }, 20)
    expect(walk.player.stallMs, '걸으면 안전하다 — 아이템 없이도 지날 길이 있어야 한다').toBe(0)
  })

  it('물청소에 미끄러지면 슬롯 하나를 떨어뜨린다', () => {
    const p = mid(WET_ZONE)
    const s = holdFor(
      put(armed({ inventory: ['I-01', 'I-06', null] }), p.x - 1, p.y, FLOOR.B1),
      { moveY: 1, sprint: true }, 20)
    expect(s.drops.length).toBe(1)
    expect(s.inventory.filter(Boolean).length).toBe(1)
  })
})

describe('S16-2 짝 아이템이 무효화한다', () => {
  const wearing = (flag: GameState['flags'][number], inv: readonly (ItemId | null)[] = []) =>
    ({ flags: [flag], inventory: [...inv, null, null, null].slice(0, 3) })

  it('이어폰 착용 — 아주머니도 무효', () => {
    const s = stand(armed(wearing('EARBUDS_ON', ['I-05'])), AUNTIE_AT.x, AUNTIE_AT.y - 2, FLOOR.L0)
    expect(s.timeLeftMs).toBeGreaterThan(180_000 - 1000)
    expect(s.preach.active).toBe(false)
  })

  it('이어폰 착용 — 학생도 무효', () => {
    const s = stand(armed(wearing('EARBUDS_ON', ['I-05'])), STUDENT_AT.x, STUDENT_AT.y - 2, FLOOR.L0)
    expect(s.preach.active).toBe(false)
  })

  it('이어폰을 **들고만** 있으면 안 막힌다 — 착용해야 한다', () => {
    const s = stand(armed({ inventory: ['I-05', null, null] }), AUNTIE_AT.x, AUNTIE_AT.y - 2, FLOOR.L0)
    expect(s.preach.active).toBe(true)
  })

  it('노선도 소지 — 공사 구간에서 시간이 안 깎인다', () => {
    const p = mid(CONSTRUCTION_POCKET)
    const s = stand(armed({ inventory: ['I-13', null, null] }), p.x, p.y, FLOOR.B1)
    expect(s.timeLeftMs).toBeGreaterThan(180_000 - 1000)
  })

  it('신문지 — 물청소를 막고 **소모된다**', () => {
    const p = mid(WET_ZONE)
    const s = holdFor(
      put(armed({ inventory: ['I-08', null, null] }), p.x - 1, p.y, FLOOR.B1),
      { moveY: 1, sprint: true }, 20)
    expect(s.player.stallMs).toBe(0)
    expect(s.inventory[0], '자동 소모형은 값을 치른다').toBeNull()
    expect(s.tally.itemsUsed).toContain('I-08')
  })

  // EMP(I-14)는 디렉터 지시로 아이템 체계째 지웠다 — OBS-08은 이제 무효화 불가
})

describe('S16-3 표 정합성 — 양방향', () => {
  it('방해요소의 counteredBy 와 아이템의 negates 가 일치한다', () => {
    for (const id of Object.keys(OBSTACLES) as ObsId[]) {
      const fromObs = [...OBSTACLES[id].counteredBy].sort()
      const fromItems = [...negatorsOf(id)].sort()
      expect(fromItems, `${id}: 아이템 쪽 negates 가 방해요소 표와 다르다`).toEqual(fromObs)
    }
  })

  it('활성 방해요소는 전부 판정이 있다 (규칙표 or 역무원 or 구조적 상시 메커닉)', () => {
    // OBS-01·02·11·12는 s.obstacles 를 안 본다 — 고장 개찰구·잔액부족·대기줄·스크린도어는
    // 그 자체가 항상 존재하는 게임 구조라 별도 온/오프 판정이 필요 없다(RULES 에도 없다)
    const covered = new Set<ObsId>([
      ...RULE_IDS, 'OBS-03', 'OBS-04', 'OBS-13', 'OBS-01', 'OBS-02', 'OBS-11', 'OBS-12',
    ])
    for (const id of ACTIVE_OBSTACLES) expect(covered.has(id), `${id} 판정 없음`).toBe(true)
  })
})

describe('S16-4 stall 중첩', () => {
  it('짧은 stall 이 긴 stall 을 못 덮는다', () => {
    const s = start(7)
    const long = { ...s, player: { ...s.player, stallMs: 3000 } }
    const after = holdFor(long, {}, 1)
    expect(after.player.stallMs).toBeLessThanOrEqual(3000)
    expect(after.player.stallMs).toBeGreaterThan(2900)
  })

  it('봉쇄 중에는 이동 입력이 무시된다', () => {
    const s = put(start(7), 20, 14, FLOOR.B1)
    const frozen = { ...s, player: { ...s.player, stallMs: 1500 } }
    const after = holdFor(frozen, { moveY: 1, sprint: true }, 30)
    expect(Math.hypot(after.player.pos.x - 20, after.player.pos.y - 14),
      '봉쇄 중에는 제자리다').toBeLessThan(0.35)
  })
})

describe('S16-5 쿨다운', () => {
  it('연속 발동하지 않는다 — 한 번 붙잡히면 한동안 조용하다', () => {
    const s = stand(armed(), AUNTIE_AT.x, AUNTIE_AT.y - 2, FLOOR.L0, 4)
    const t1 = s.timeLeftMs
    const s2 = holdFor(s, {}, 120)                       // 2초 더 서 있는다
    const spent = t1 - s2.timeLeftMs
    expect(spent, '흐른 시간만 줄어야 한다 (추가 페널티 없음)').toBeLessThan(2200)
    expect(s2.obsCooldown['OBS-07']).toBeGreaterThan(0)
  })
})

describe('S16-6 비활성 방해는 침묵한다', () => {
  it('활성 목록에서 빠지면 조건을 만족해도 아무 일이 없다', () => {
    const s = stand(start(7, { obstacles: ['OBS-01'] }), AUNTIE_AT.x, AUNTIE_AT.y - 2, FLOOR.L0)
    expect(s.timeLeftMs).toBeGreaterThan(180_000 - 1000)
    expect(s.preach.active).toBe(false)
  })

  it('학생 쪽도 마찬가지', () => {
    const s = stand(start(7, { obstacles: [] }), STUDENT_AT.x, STUDENT_AT.y - 2, FLOOR.L0)
    expect(s.preach.active).toBe(false)
  })
})
