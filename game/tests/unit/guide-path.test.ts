/**
 * 유도선이 실제로 갈 수 있는 길인가.
 *
 * 화살표는 "이쪽으로 가라"고 말한다. 그 말이 거짓이면 플레이어는 벽 앞에서 시간을 버린다 —
 * 3분짜리 게임에서 가장 비싼 실수다.
 *
 * 눈으로 스크린샷을 보고 "여기 막혔다"를 찾는 건 느리고 놓친다.
 * 경로를 0.25m 간격으로 훑어 **막히는 지점의 좌표를 직접 출력**한다.
 */

import { describe, expect, it } from 'vitest'
import { GUIDE_PATHS, SOLIDS, type Solid } from '../../src/data/world'
import { isWalkable } from '../../src/systems/collision'
import { rectOverlapsCircle } from '../../src/core/math'
import { MOVE } from '../../src/data/tuning'

const STEP = 0.25

/** 해당 고도에서 이 충돌체가 막는가 — collision.ts의 blocksAt과 같은 판정 */
const blocksAt = (s: Solid, z: number): boolean => z > s.z0 - 1.2 && z < s.z0 + s.h

type Block = { x: number; y: number; z: number; by: string }

const scan = (): Block[] => {
  const bad: Block[] = []
  for (const path of GUIDE_PATHS) {
    for (let i = 0; i + 1 < path.points.length; i++) {
      const [x0, y0] = path.points[i] as readonly [number, number]
      const [x1, y1] = path.points[i + 1] as readonly [number, number]
      const len = Math.hypot(x1 - x0, y1 - y0)
      const n = Math.ceil(len / STEP)
      for (let k = 0; k <= n; k++) {
        const t = k / n
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        if (!isWalkable(x, y, path.z)) {
          bad.push({ x, y, z: path.z, by: '(바닥 없음)' })
          continue
        }
        for (const s of SOLIDS) {
          if (!blocksAt(s, path.z)) continue
          if (rectOverlapsCircle(s.rect, x, y, MOVE.radius)) {
            bad.push({ x, y, z: path.z, by: s.id })
            break
          }
        }
      }
    }
  }
  return bad
}

describe('점자 유도선', () => {
  it('전 구간이 실제로 통행 가능하다', () => {
    const bad = scan()
    // 좌표를 한 줄씩 쏟으면 진짜 원인이 안 보인다 — 막는 주체별로 묶어 구간을 보여준다
    const byBlocker = new Map<string, Block[]>()
    for (const b of bad) {
      const list = byBlocker.get(b.by)
      if (list) list.push(b)
      else byBlocker.set(b.by, [b])
    }
    const report = [...byBlocker.entries()]
      .map(([id, pts]) => {
        const f = pts[0] as Block
        const l = pts[pts.length - 1] as Block
        return `  ${id}: ${pts.length}점 — (${f.x.toFixed(1)}, ${f.y.toFixed(1)})`
          + ` ~ (${l.x.toFixed(1)}, ${l.y.toFixed(1)}) z${f.z}`
      })
      .join('\n')
    expect(bad.length, `유도선이 막히는 지점 ${bad.length}곳 / 원인 ${byBlocker.size}종:\n${report}`).toBe(0)
  })

  it('화살표가 목적지 쪽으로 흐른다 — 반대로 흐르면 플레이어를 되돌려 보낸다', () => {
    // 레벨은 통째로 서→동(+x)으로 뻗는다. 배열 순서가 곧 흐름 방향이므로
    // 점을 거꾸로 적으면 화살표가 출입구 쪽으로 흐른다 — 조용히 망하는 종류의 실수다.
    GUIDE_PATHS.forEach((p, i) => {
      const [sx, sy] = p.points[0] as readonly [number, number]
      const [ex, ey] = p.points[p.points.length - 1] as readonly [number, number]
      const span = Math.hypot(ex - sx, ey - sy)
      expect(ex, `${i}번 경로가 서쪽으로 되돌아간다 (${sx},${sy} → ${ex},${ey})`)
        .toBeGreaterThanOrEqual(sx)
      // 3m 넘는 본선은 반드시 동쪽으로 진행해야 한다 (짧은 지선은 남북 방향일 수 있다)
      if (span > 3) {
        expect(ex, `${i}번 본선이 동쪽으로 나아가지 않는다`).toBeGreaterThan(sx)
      }
    })
  })
})
