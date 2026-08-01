import { describe, expect, it } from 'vitest'
import {
  DOOR_XS, ENTRANCE_RAMP_A, ENTRANCE_RAMP_B, ESCALATOR, FLOOR, GATES, GATE_BODY,
  PLATFORM, SLABS, SOLIDS, SPAWN, STAIRS, zoneAt,
} from '../../src/data/world'
import { rampZ, sampleGround, resolveMove, setDynamicSolids } from '../../src/systems/collision'

describe('S1-1 부록 A 좌표 대조', () => {
  it('게이트 9기가 피치 2.0m로 놓인다', () => {
    expect(GATES.map((g) => g.y)).toEqual([8, 10, 12, 14, 16, 18, 20, 22, 24])
  })
  it('G9만 우대용 0.9m', () => {
    expect(GATES.filter((g) => g.wide).map((g) => g.label)).toEqual(['G9'])
    expect(GATES[8]?.width).toBe(0.9)
  })
  // 렌더가 이름을 `Z3_GATE_G(\d)_…` 한 자리 정규식으로 잡는다 (render/station.ts).
  // 10기 이상으로 늘리면 그 정규식부터 고쳐야 한다.
  it('게이트 id는 한 자리 · label과 어긋나지 않는다', () => {
    for (const g of GATES) {
      expect(g.id).toBeLessThan(10)
      expect(g.label).toBe(`G${g.id}`)
    }
  })
  // 인접 게이트 본체가 겹치면 유리 칸막이 구간이 음수 길이가 된다
  it('인접 게이트 본체가 겹치지 않는다', () => {
    const outer = (g: (typeof GATES)[number]): number => g.width / 2 + 0.275
    for (let i = 0; i < GATES.length - 1; i++) {
      const a = GATES[i]!, b = GATES[i + 1]!
      expect(b.y - outer(b) - (a.y + outer(a)), `${a.label}~${b.label} 간격`).toBeGreaterThan(0.3)
    }
  })
  it('게이트 본체 x = 60.3~61.7', () => {
    expect(GATE_BODY.xMin).toBe(60.3)
    expect(GATE_BODY.xMax).toBe(61.7)
  })
  it('가동문 32개소가 x = 78 + 16k + {2,6,10,14} 공식과 일치한다', () => {
    expect(DOOR_XS).toHaveLength(32)
    const expected: number[] = []
    for (let k = 0; k < 8; k++) for (const o of [2, 6, 10, 14]) expected.push(78 + 16 * k + o)
    expect([...DOOR_XS].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b))
    expect(Math.min(...DOOR_XS)).toBe(80)
    expect(Math.max(...DOOR_XS)).toBe(204)
  })
  it('승강장 x 78~206 · 층 고도 L0/B1/B2', () => {
    expect([PLATFORM.xMin, PLATFORM.xMax]).toEqual([78, 206])
    expect([FLOOR.L0, FLOOR.B1, FLOOR.B2]).toEqual([0, -6, -20])
  })
  it('스폰 (−58, 24)', () => {
    expect([SPAWN.x, SPAWN.y]).toEqual([-58, 24])
  })
  it('하강부는 x 95.8 → 120.0, −6 → −20', () => {
    for (const r of [ESCALATOR, STAIRS]) {
      expect(r.rect[0]).toBe(95.8)
      expect(r.rect[2]).toBe(120.0)
      expect(r.zAtMin).toBe(FLOOR.B1)
      expect(r.zAtMax).toBe(FLOOR.B2)
    }
    expect(ESCALATOR.rect[1]).toBe(1.35)
    expect(ESCALATOR.rect[3]).toBe(3.05)
    expect(STAIRS.rect[1]).toBe(4.2)
    expect(STAIRS.rect[3]).toBe(9.2)
  })
  it('충돌체·바닥에 퇴화(폭 0) 사각형이 없다', () => {
    for (const s of [...SOLIDS, ...SLABS]) {
      expect(s.rect[2] - s.rect[0]).toBeGreaterThan(0)
      expect(s.rect[3] - s.rect[1]).toBeGreaterThan(0)
    }
  })
})

describe('S1-3 램프', () => {
  it('출구계단은 x가 커질수록 내려간다', () => {
    expect(rampZ(ENTRANCE_RAMP_A, 2.0, 28)).toBeCloseTo(0, 5)
    expect(rampZ(ENTRANCE_RAMP_A, 7.85, 28)).toBeCloseTo(-18 * (6 / 35), 5)
    expect(rampZ(ENTRANCE_RAMP_B, 14.6, 28)).toBeCloseTo(-6, 5)
    // 계단참 구간은 램프가 아니라 Slab이다 — 두 램프 어느 쪽도 여기를 덮지 않는다
    expect(rampZ(ENTRANCE_RAMP_A, 8.4, 28)).toBeNull()
    expect(rampZ(ENTRANCE_RAMP_B, 8.4, 28)).toBeNull()
  })
  it('에스컬레이터·계단은 −6 → −20 선형이다', () => {
    expect(rampZ(ESCALATOR, 95.8, 2.2)).toBeCloseTo(-6, 5)
    expect(rampZ(ESCALATOR, 120.0, 2.2)).toBeCloseTo(-20, 5)
    expect(rampZ(STAIRS, 107.9, 6.7)).toBeCloseTo(-13, 1)
  })
  it('램프 밖이면 null', () => {
    expect(rampZ(ESCALATOR, 90, 2.2)).toBeNull()
    expect(rampZ(ESCALATOR, 100, 8)).toBeNull()
  })
})

describe('S1-5 존 판정', () => {
  const cases: readonly [number, number, string][] = [
    [-58, 0, 'Z1'], [-1, 0, 'Z1'], [8, -3, 'Z1'],
    [4, -6, 'Z2'], [30, -6, 'Z2'], [55.9, -6, 'Z2'],
    [56.1, -6, 'Z3'], [65, -6, 'Z3'], [71.9, -6, 'Z3'],
    [72.1, -6, 'Z4'], [95, -6, 'Z4'], [110, -13, 'Z4'],
    [118.9, -20, 'Z4'], [119.1, -20, 'Z5'], [180, -20, 'Z5'],
  ]
  for (const [x, z, want] of cases) {
    it(`(${x}, z=${z}) → ${want}`, () => expect(zoneAt(x, z)).toBe(want))
  }
})

describe('S1-2 · S1-4 충돌', () => {
  it('벽에 45°로 밀어도 끼이지 않고 미끄러진다', () => {
    setDynamicSolids([])
    // Z2 남측 외벽(y=0)에 대각으로 밀어붙인다
    const from = { x: 30, y: 0.5 }
    let cur = { x: from.x, y: from.y }
    let moved = 0
    for (let i = 0; i < 60; i++) {
      const step = 5.0 / 60
      const r = resolveMove(cur.x, cur.y, cur.x + step, cur.y - step, -6)
      moved += Math.hypot(r.x - cur.x, r.y - cur.y)
      cur = { x: r.x, y: r.y }
    }
    // 벽을 뚫지 않았고(y ≥ 0), 그럼에도 +x로 미끄러졌다
    expect(cur.y).toBeGreaterThanOrEqual(0)
    expect(cur.x).toBeGreaterThan(from.x + 2)
    expect(moved).toBeGreaterThan(2)
  })

  it('걸을 면이 없는 곳으로 나가지 않는다', () => {
    setDynamicSolids([])
    // 승강장 북쪽(선로) 방향으로 계속 밀어본다
    let cur = { x: 150, y: 6 }
    for (let i = 0; i < 200; i++) {
      const r = resolveMove(cur.x, cur.y, cur.x, cur.y + 0.2, -20)
      cur = { x: r.x, y: r.y }
    }
    expect(cur.y).toBeLessThanOrEqual(12.35)
  })

  it('겹친 층에서 현재 고도의 바닥을 고른다', () => {
    // x=90,y=6 은 Z4 통로(B1)와 Z5 승강장(B2)이 수직으로 겹치는 지점
    expect(sampleGround(90, 6, -6).z).toBe(FLOOR.B1)
    expect(sampleGround(90, 6, -20).z).toBe(FLOOR.B2)
  })

  it('Z1 인도와 Z2 대합실이 서로를 오염시키지 않는다', () => {
    expect(sampleGround(-30, 28, 0).z).toBe(FLOOR.L0)
    expect(sampleGround(30, 20, -6).z).toBe(FLOOR.B1)
  })
})
