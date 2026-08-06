/**
 * S11 — 인파 2종 (O-03 에스컬레이터 인파벽 · O-04 하차 역류).
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S11-1~S11-9
 */

import { describe, expect, it } from 'vitest'
import { AISLE, INTERACT, SURGE } from '../../src/data/tuning'
import { FLOOR, PLATFORM } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import { crowdSolids, surgeAt, surgeAtMs } from '../../src/systems/crowd'
import { goto, holdFor, put, start, tap, wait, yawTo } from './_pilot'

/** ACT-CP 좌표 — `data/interactables.ts` 와 같은 값 */
const CP = { x: 96.6, y: 2.2 }

/** P2 — 인파벽이 3인 1열이 됐다. 셋을 다 비켜야 열린다 */
const cleared = (s: GameState): GameState =>
  ({ ...s, act: { ...s.act, consumed: [...s.act.consumed, 'ACT-CP', 'ACT-CP2', 'ACT-CP3'] } })

describe('S11-1 인파벽은 에스컬레이터를 막는다', () => {
  it('비켜서기 전에는 솔리드가 있고 후에는 없다', () => {
    expect(crowdSolids(start(7)).length, 'P2 — 3인 1열').toBe(3)
    expect(crowdSolids(start(7))[0]?.h).toBe(AISLE.h)
    expect(crowdSolids(cleared(start(7))).length).toBe(0)
    // 앞사람만 비켜도 뒤가 남는다 — 이게 15초 정체의 근거이자 E-11 의 전제다
    const one = { ...start(7), act: { ...start(7).act, consumed: ['ACT-CP'] } }
    expect(crowdSolids(one).length).toBe(2)
  })

  it('남는 통로 폭이 플레이어 지름보다 좁다 — 옆으로 빠져나갈 수 없다', () => {
    // 에스컬레이터 y 1.35~3.05 (1.70m) 중 인파벽이 y 1.35~2.45 (1.10m)를 먹는다
    const gap = 3.05 - AISLE.yMax
    expect(gap, `남은 통로 ${gap.toFixed(2)}m`).toBeLessThan(0.64)
  })

  it('막힌 상태로 25초 밀어붙여도 B2에 도달하지 못한다', () => {
    let s = put(start(7), 95.9, 2.2, FLOOR.B1)
    s = holdFor(s, { moveY: 1 }, 60 * 25)
    expect(s.player.pos.z, 'B1에 남아 있다').toBeGreaterThan(FLOOR.B2 + 10)
  })

  it('북쪽 레인으로 우회해도 못 지난다 (25회 y 스윕)', () => {
    for (let i = 0; i < 25; i++) {
      const y = 1.4 + (i / 24) * 1.6
      let s = put(start(7), 95.9, y, FLOOR.B1)
      s = holdFor(s, { moveY: 1 }, 60 * 8)
      expect(s.player.pos.x, `y=${y.toFixed(2)} 에서 통과했다`).toBeLessThan(103)
    }
  })
})

describe('S11-2~S11-4 O-03 해결 3경로', () => {
  const atCp = (patch: Partial<GameState> = {}): GameState =>
    put(start(7, patch), CP.x - 1.2, CP.y, FLOOR.B1)

  it('S11-2 우산 사용 → 즉시 개방 · 우산 소모 · 스타일 +1', () => {
    const s0 = atCp({ inventory: ['I-09', null, null] })
    const s = tap(s0, { pressSlot: 1 }, yawTo(s0, CP.x, CP.y))
    expect(s.act.consumed, '가장 가까운 사람이 비켜선다').toContain('ACT-CP')
    expect(s.inventory.includes('I-09'), '우산은 소모된다').toBe(false)
    expect(s.scores.style, '사용 아이템 종류 +1').toBe(1)
    expect(s.tally.pushes, 'E-11 계수기가 는다').toBe(1)
    expect(crowdSolids(s).length, '한 사람만 열렸다 — 둘이 남는다').toBe(2)
  })

  it('S11-3 "저기요" → 3.0초 뒤 개방', () => {
    const s0 = atCp()
    const yaw = yawTo(s0, CP.x, CP.y)
    let s = tap(s0, { pressInteract: true }, yaw)
    expect(s.act.busyKind).toBe('aside')
    expect(s.act.busyTotalMs).toBe(INTERACT.asideMs)

    const early = wait(s, INTERACT.asideMs - 400, yaw)
    expect(early.act.consumed, '아직 안 비켰다').not.toContain('ACT-CP')

    s = wait(s, INTERACT.asideMs + 200, yaw)
    expect(s.act.consumed).toContain('ACT-CP')
  })

  it('S11-4 계단으로 우회하면 막힘 없이 B2에 도달한다', () => {
    // 계단 `OBJ-25` 는 y 4.2~9.2 — 인파벽(y ≤ 2.45)과 겹치지 않는다
    let s = put(start(7), 95.9, 6.7, FLOOR.B1)
    s = holdFor(s, { moveY: 1 }, 60 * 12)
    expect(s.player.pos.z, '계단은 열려 있다').toBeCloseTo(FLOOR.B2, 1)
  })

  it('우산은 캐리어 승객이 없으면 못 쓴다 (아무 데서나 소모되지 않는다)', () => {
    const s0 = put(start(7, { inventory: ['I-09', null, null] }), 30, 15, FLOOR.B1)
    const s = tap(s0, { pressSlot: 1 })
    expect(s.inventory.includes('I-09'), '소모 안 됨').toBe(true)
    expect(s.act.denyText).toBe('여기서 쓸 데가 없다')
  })
})

describe('S11-5~S11-6 O-04 역류는 시간의 순수 함수다', () => {
  it('S11-5 같은 시드는 같은 시각을 낸다 (Math.random 미사용)', () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(surgeAtMs(seed)).toBe(surgeAtMs(seed))
    }
  })

  it('S11-5 시각이 기준 ±8초 안에 들고, 시드마다 흩어진다', () => {
    const seen = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const at = surgeAtMs(seed)
      expect(at).toBeGreaterThanOrEqual(SURGE.baseMs - SURGE.jitterMs)
      expect(at).toBeLessThanOrEqual(SURGE.baseMs + SURGE.jitterMs)
      seen.add(Math.round(at))
    }
    expect(seen.size, '시드마다 다른 시각').toBeGreaterThan(150)
  })

  it('S11-6 위상 순서가 idle → warn → active → done 이고 warn이 3초 선행한다', () => {
    const at = surgeAtMs(7)
    expect(surgeAt(at - SURGE.warnMs - 100, 7)).toBe('idle')
    expect(surgeAt(at - SURGE.warnMs + 100, 7)).toBe('warn')
    expect(surgeAt(at - 100, 7)).toBe('warn')
    expect(surgeAt(at + 100, 7)).toBe('active')
    expect(surgeAt(at + SURGE.durMs - 100, 7)).toBe('active')
    expect(surgeAt(at + SURGE.durMs + 100, 7)).toBe('done')
  })
})

describe('S11-7~S11-8 역류 대응', () => {
  /** 역류 한복판의 승강장 상태를 만든다 */
  const inSurge = (y: number, inv: readonly (ItemId | null)[] = [null, null, null],
                   flags: GameState['flags'] = []): GameState => {
    const s = start(7, { inventory: inv, flags })
    const at = surgeAtMs(7)
    return put({ ...s, elapsedMs: at + 200 }, 150, y, FLOOR.B2)
  }

  it('S11-7 무대응이면 남쪽으로 밀린다', () => {
    const s0 = inSurge(9)
    const s = holdFor(s0, {}, 90)          // 1.5초 무입력
    const pushed = s0.player.pos.y - s.player.pos.y
    expect(pushed, `${pushed.toFixed(2)}m 밀렸다`).toBeGreaterThan(2)
  })

  it('S11-7 남쪽 벽(y ≤ 1.5)에 붙어 있으면 밀리지 않는다', () => {
    const s0 = inSurge(SURGE.shelterY - 0.2)
    const s = holdFor(s0, {}, 90)
    expect(Math.abs(s.player.pos.y - s0.player.pos.y), '밀림 0').toBeLessThan(0.05)
  })

  it('S11-8 마스크 착용 시 밀림 속도가 정확히 절반이다', () => {
    const bare = holdFor(inSurge(11), {}, 30)
    const masked = holdFor(inSurge(11, ['I-06', null, null], ['MASK_ON']), {}, 30)
    const d1 = 11 - bare.player.pos.y
    const d2 = 11 - masked.player.pos.y
    expect(d2 / d1, `배율 ${(d2 / d1).toFixed(2)}`).toBeGreaterThan(SURGE.maskFactor - 0.03)
    expect(d2 / d1).toBeLessThan(SURGE.maskFactor + 0.03)
  })

  it('넘어지면 1.2초 동안 못 움직이고, 두 번은 안 넘어진다', () => {
    let s = inSurge(9)
    // 넘어지는 시드를 찾는다 — 확률 30%라 몇 개는 넘어진다
    let fellSeed = -1
    for (let seed = 0; seed < 40; seed++) {
      const base = start(seed)
      const t = surgeAtMs(seed)
      const probe = holdFor(put({ ...base, elapsedMs: t + 200 }, 150, 9, FLOOR.B2), {}, 3)
      if (probe.surge.fell) { fellSeed = seed; break }
    }
    expect(fellSeed, '넘어지는 시드가 존재한다').toBeGreaterThanOrEqual(0)

    const base = start(fellSeed)
    const t = surgeAtMs(fellSeed)
    s = holdFor(put({ ...base, elapsedMs: t + 200 }, 150, 9, FLOOR.B2), {}, 3)
    expect(s.surge.stallMs).toBeGreaterThan(0)

    // 정지 중에는 입력이 통하지 않는다
    const frozen = holdFor(s, { moveY: 1, sprint: true }, 30)
    const moved = Math.hypot(frozen.player.pos.x - s.player.pos.x, frozen.player.pos.y - s.player.pos.y)
    expect(moved, `정지 중 이동 ${moved.toFixed(3)}m`).toBeLessThan(0.05)

    // 1.2초 뒤에는 다시 움직인다
    const freed = holdFor(frozen, { moveY: 1 }, 90)
    expect(Math.abs(freed.player.pos.x - frozen.player.pos.x), '다시 움직인다')
      .toBeGreaterThan(0.5)
    expect(freed.surge.fell, '재넘어짐 없음 (fell 플래그 유지)').toBe(true)
  })
})

describe('S11-9 역류가 열차·탑승을 깨뜨리지 않는다', () => {
  it('역류 구간을 지나도 열차 스케줄이 정상이다', () => {
    const at = surgeAtMs(7)
    let s = put({ ...start(7), elapsedMs: at - 1000 }, 150, 6, FLOOR.B2)
    s = holdFor(s, {}, Math.round((SURGE.durMs + 2000) / (1000 / 60)))
    expect(s.train.state, '아직 열차는 안 왔다').toBe('incoming')
    expect(s.phase).toBe('playing')
  })

  it('역류가 끝난 뒤 문 앞으로 걸어가 탑승할 수 있다', () => {
    // 역류를 지나 열차 도착 시각으로 점프한다
    let s = put({ ...start(7), elapsedMs: 173_000 }, 176, 6, FLOOR.B2)
    expect(surgeAt(s.elapsedMs, s.seed), '역류는 이미 끝났다').toBe('done')
    const r = goto(s, 176, 12.2, { r: 0.5, maxSec: 6 })
    s = holdFor(r.s, { moveY: 1 }, 40, Math.PI / 2)
    expect(s.boarded, '탑승').toBe(true)
    expect(s.player.pos.x, '승강장 x 범위 안').toBeGreaterThan(PLATFORM.xMin)
  })
})
