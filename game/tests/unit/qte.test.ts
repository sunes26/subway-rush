/**
 * 자판기 QTE — **P2 타이밍 바** (`docs/P2-SPEC.md` §3 · 디렉터 지시 2026-08-06).
 *
 * P1의 좌↔우 드래그(누적 이동량 + 리듬)를 걷어내고 **왕복 마커 + 중앙 클릭**으로 바꿨다.
 * 여기서 잠그는 것은 규칙이다: 어디서 눌러야 성공인가 · 언제 빨라지는가 · 어떻게 끝나는가.
 */

import { describe, expect, it } from 'vitest'
import { QTE } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState } from '../../src/state/types'
import { coinFor, inZone } from '../../src/systems/qte'
import { holdFor, playQte, put, start, tap } from './_pilot'

/** 자판기 A 앞에서 효자손을 손에 쥔 채 QTE 를 연 상태 (QTE 는 쥔 상태에서만 열린다) */
const opened = (patch: Partial<GameState> = {}): GameState => {
  const s = put(
    start(7, { inventory: ['I-01', null, null], hand: { item: 'I-01', slot: 0, open: false }, ...patch }),
    13.03, 4.15 - 1.2, FLOOR.B1,
  )
  return tap(s, { pressSlot: 1 })        // 효자손 사용 → 근처 자판기 QTE
}

/** 마커를 원하는 위치에 세워 둔다 — 판정만 보고 싶을 때 */
const at = (s: GameState, pos: number): GameState =>
  ({ ...s, qte: { ...s.qte, pos } })

describe('열림', () => {
  it('효자손을 쓰면 자판기 QTE 가 열리고 마커가 왼쪽 끝에서 출발한다', () => {
    const s = opened()
    expect(s.qte.active).toBe(true)
    expect(s.qte.vendorId).toBe('OBJ-06')
    expect(s.qte.pos, '중앙에서 시작하면 첫 클릭이 공짜다').toBe(0)
    expect(s.qte.dirSign).toBe(1)
    expect(s.qte.speedMul).toBe(1)
  })

  /**
   * `E`(=좌클릭)로 여는 경로의 회귀 방지.
   *
   * `tick` 은 한 스텝에서 `interactSystem` → `qteSystem` 순으로 돈다. **여는 원샷이 그대로**
   * QTE 판정까지 흘러와, 마커가 왼쪽 끝(0)일 때 눌린 것으로 쳐서 **여는 즉시 미스**가 났다.
   * 아이템 키(`pressSlot`)로 여는 경로는 이 누수가 없어 기존 테스트가 전부 통과했다 —
   * 그래서 여기서는 반드시 **`pressInteract` 로** 연다.
   */
  it('E 로 열면 그 입력이 첫 판정으로 새지 않는다', () => {
    const near = put(
      start(7, { inventory: ['I-01', null, null], hand: { item: 'I-01', slot: 0, open: false } }),
      13.03, 4.15 - 1.2, FLOOR.B1,
    )
    const s = tap(near, { pressInteract: true })
    expect(s.qte.active, 'E 로도 열려야 한다').toBe(true)
    expect(s.qte.misses, '여는 입력이 미스로 세어지면 안 된다').toBe(0)
    expect(s.qte.strokes).toBe(0)
  })
})

describe('성공 구간 판정', () => {
  it('중앙은 성공, 양 끝은 실패', () => {
    expect(inZone(0.5)).toBe(true)
    expect(inZone(0)).toBe(false)
    expect(inZone(1)).toBe(false)
  })

  it('구간 경계가 튜닝값과 일치한다 (전체 폭의 14%)', () => {
    expect(inZone(0.5 + QTE.zoneHalf - 0.001)).toBe(true)
    expect(inZone(0.5 + QTE.zoneHalf + 0.001)).toBe(false)
    expect(inZone(0.5 - QTE.zoneHalf + 0.001)).toBe(true)
    expect(inZone(0.5 - QTE.zoneHalf - 0.001)).toBe(false)
  })

  it('중앙에서 누르면 성공 1', () => {
    const s = tap(at(opened(), 0.5), { pressInteract: true })
    expect(s.qte.strokes).toBe(1)
    expect(s.qte.misses).toBe(0)
  })

  it('구간 밖에서 누르면 미스 1', () => {
    const s = tap(at(opened(), 0.05), { pressInteract: true })
    expect(s.qte.strokes).toBe(0)
    expect(s.qte.misses).toBe(1)
  })

  it('안 누르면 아무 일도 없다 — 마커만 움직인다', () => {
    const a = opened()
    const b = holdFor(a, {}, 10)
    expect(b.qte.strokes).toBe(0)
    expect(b.qte.misses).toBe(0)
    expect(b.qte.pos).toBeGreaterThan(a.qte.pos)
  })

  /**
   * 회귀 테스트 — **판정은 클릭 그 순간 화면에 보이던 위치를 봐야 한다.**
   *
   * 예전엔 `tick`이 이번 프레임의 `ADVANCE`로 마커를 먼저 옮긴 **뒤에** 판정해서,
   * 플레이어가 실제로 본 위치(성공 구간 안)가 아니라 한 틱 더 진행된 위치(구간 밖)로
   * 미스 처리되는 일이 있었다 — 특히 진행 방향 쪽 경계에서 "분명 초록인데 미스"가 났다.
   * 지금은 `ctx.prevPos`(직전 프레임 위치)로 판정하므로, 구간 경계 바로 안쪽에서
   * 눌러도 이번 틱에 마커가 얼마나 더 갔는지와 무관하게 성공해야 한다.
   */
  it('구간을 막 벗어나려는 순간(진행 방향 경계)에 눌러도, 누른 그 위치가 안이면 성공한다', () => {
    const exitEdge = 0.5 + QTE.zoneHalf - 0.001
    const s = tap(at(opened(), exitEdge), { pressInteract: true })
    expect(s.qte.strokes, `pos=${exitEdge}는 성공 구간 안이었다`).toBe(1)
    expect(s.qte.misses).toBe(0)
  })

  it('반대로, 구간 막 진입 직전(경계 바로 밖)에 누르면 여전히 미스다', () => {
    const justOutside = 0.5 + QTE.zoneHalf + 0.001
    const s = tap(at(opened(), justOutside), { pressInteract: true })
    expect(s.qte.strokes).toBe(0)
    expect(s.qte.misses).toBe(1)
  })
})

describe('마커 왕복', () => {
  it('끝에 닿으면 되돌아온다 — 트랙을 벗어나지 않는다', () => {
    let s = opened()
    for (let i = 0; i < 400; i++) {
      s = holdFor(s, {}, 1)
      expect(s.qte.pos).toBeGreaterThanOrEqual(0)
      expect(s.qte.pos).toBeLessThanOrEqual(1)
      if (!s.qte.active) break
    }
  })

  it('한 주기에 트랙을 두 번 지난다 (왼→오→왼)', () => {
    // 반주기면 반대쪽 끝 근처에 있어야 한다
    const half = holdFor(opened(), {}, Math.round(QTE.cycleMs / 2 / (1000 / 60)))
    expect(half.qte.pos).toBeGreaterThan(0.9)
  })

  it('성공하면 빨라진다 — 구간은 그대로다', () => {
    const s = tap(at(opened(), 0.5), { pressInteract: true })
    expect(s.qte.speedMul).toBeCloseTo(QTE.speedUpPerHit, 5)
    // 같은 시간에 더 멀리 간다
    const fast = holdFor(s, {}, 6).qte.pos - s.qte.pos
    const base = holdFor(opened(), {}, 6).qte.pos - opened().qte.pos
    expect(Math.abs(fast)).toBeGreaterThan(Math.abs(base))
  })
})

describe('종료', () => {
  it('3회 성공하면 동전이 잔액으로 들어오고 자판기가 소진된다', () => {
    let s = opened()
    const before = s.cardBalance
    for (let i = 0; i < 3; i++) s = tap(at(s, 0.5), { pressInteract: true })
    expect(s.qte.active).toBe(false)
    expect(s.act.consumed).toContain('OBJ-06')
    expect(s.cardBalance - before).toBe(coinFor(s.seed, 'OBJ-06'))
  })

  it('미스 3회면 실패하고 −5s', () => {
    let s = opened()
    const t0 = s.timeLeftMs
    for (let i = 0; i < 3; i++) s = tap(at(s, 0.02), { pressInteract: true })
    expect(s.qte.active).toBe(false)
    expect(s.act.consumed, '실패하면 자판기는 남는다').not.toContain('OBJ-06')
    expect(t0 - s.timeLeftMs).toBeGreaterThan(QTE.failPenaltyMs)
  })

  it('ESC 로 빠져나오면 페널티가 없다', () => {
    const s = tap(opened(), { pressCancel: true })
    expect(s.qte.active).toBe(false)
    expect(s.timeLeftMs).toBeGreaterThan(180_000 - 500)
  })

  it('제한시간을 넘기면 실패한다', () => {
    const s = holdFor(opened(), {}, Math.ceil(QTE.timeoutMs / (1000 / 60)) + 4)
    expect(s.qte.active).toBe(false)
    expect(s.timeLeftMs).toBeLessThan(180_000 - QTE.failPenaltyMs)
  })
})

describe('자동조종이 통과할 수 있다', () => {
  /** 이게 깨지면 시드 200 스윕의 효자손 루트가 통째로 죽는다 */
  it('playQte 가 자판기 하나를 성공시킨다', () => {
    const s = playQte(opened())
    expect(s.qte.active).toBe(false)
    expect(s.act.consumed).toContain('OBJ-06')
  })

  it('마커 속도가 올라도 통과한다 (3회 연속)', () => {
    const s = playQte(opened())
    expect(s.qte.strokes === 0 || s.act.consumed.includes('OBJ-06')).toBe(true)
  })
})
