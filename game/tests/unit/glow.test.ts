import { Box3, BufferAttribute, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildGlowMesh, glowQuadsFrom, type GlowQuad } from '../../src/render/glow'

/** 판 i 의 월드 크기를 굽힌 지오메트리에서 되읽는다 — 축 매핑이 정말 맞는지 본다 */
const bakedSize = (quads: readonly GlowQuad[], i: number): [number, number, number] => {
  const mesh = buildGlowMesh(quads, 'test')
  if (!mesh) throw new Error('판이 안 나왔다')
  const p = mesh.geometry.getAttribute('position') as BufferAttribute
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < 4; k++) {
    const v = [p.getX(i * 4 + k), p.getY(i * 4 + k), p.getZ(i * 4 + k)]
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a] as number, v[a] as number)
      hi[a] = Math.max(hi[a] as number, v[a] as number)
    }
  }
  return [
    (hi[0] as number) - (lo[0] as number),
    (hi[1] as number) - (lo[1] as number),
    (hi[2] as number) - (lo[2] as number),
  ]
}

const boxOf = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Box3 =>
  new Box3().setFromCenterAndSize(new Vector3(cx, cy, cz), new Vector3(sx, sy, sz))

describe('발광 글로우 판의 축 매핑', () => {
  /**
   * 회귀: 판을 만드는 쪽은 두 축을 **길이 순**으로 골랐는데 굽는 쪽이 축 번호
   * 오름차순 표로 되유추해, 순서가 반대인 부품에서 `w`·`h` 가 뒤바뀌었다.
   * 증상은 "천장 전등은 세로인데 번짐은 가로"였다.
   */
  it('가로로 긴 천장 조명은 번짐도 가로로 길다', () => {
    // Z2 대합실 라인 조명 실측치: x 로 5.48 m, z 두께 0.28 m, y 는 판판하다
    const quads: GlowQuad[] = []
    glowQuadsFrom([boxOf(3.3, -2.88, -7, 5.48, 0.02, 0.28)], 0xffffff, 1, quads)
    expect(quads).toHaveLength(1)
    const [w, h, d] = bakedSize(quads, 0)
    expect(h).toBeCloseTo(0, 5)          // 법선은 y
    expect(w).toBeGreaterThan(5.4)       // 조명이 뻗은 방향 = x
    expect(d).toBeLessThan(1)            // 두께 방향 = z
    expect(w).toBeGreaterThan(d * 5)
  })

  it('세로로 긴 벽면 띠는 번짐도 세로로 길다', () => {
    // 축 번호 순서가 반대인 경우 — 여기서 뒤집히면 위 케이스와 같은 결함이다
    const quads: GlowQuad[] = []
    glowQuadsFrom([boxOf(10, 1.2, -0.03, 0.22, 2.4, 0.02)], 0xffffff, 1, quads)
    const [w, h, d] = bakedSize(quads, 0)
    expect(d).toBeCloseTo(0, 5)          // 법선은 z
    expect(h).toBeGreaterThan(2.3)       // 띠가 뻗은 방향 = y
    expect(h).toBeGreaterThan(w * 2)
  })

  it('광고판은 실제 가로·세로 비율을 지킨다', () => {
    // 1.75 × 1.35 × 0.05 — 가로가 더 긴 판
    const quads: GlowQuad[] = []
    glowQuadsFrom([boxOf(20, 1.6, -0.05, 1.75, 1.35, 0.05)], 0xffffff, 1, quads)
    const [w, h] = bakedSize(quads, 0)
    expect(w).toBeGreaterThan(h)
  })
})
