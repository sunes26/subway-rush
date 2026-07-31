/**
 * 점자 유도블록 위를 흐르는 화살표.
 *
 * 유도블록은 "여기가 길이다"는 말하지만 **어느 쪽인지**는 말하지 않는다.
 * 3분짜리 게임에서 길을 되짚는 데 쓰는 시간이 가장 아깝다 — 방향을 움직임으로 준다.
 *
 * 텍스처 스크롤이 아니라 지오메트리를 실제로 이동시킨다. 이 게임은 텍스처를 아예
 * 쓰지 않고(툰 플랫 컬러), UV도 로더에서 버리기 때문이다.
 * 화살표 전체를 InstancedMesh 하나로 묶어 드로우 콜은 1이다.
 */

import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { GUIDE_PATHS, type GuidePath } from '../data/world'
import type { Vec3 } from '../core/math'

/** 화살표 간격(m) */
const SPACING = 2.6
/** 흐르는 속도(m/s) — 걷는 속도(5)보다 느려야 "안내"로 읽힌다. 빠르면 쫓기는 느낌이 든다 */
const SPEED = 1.5
/** 이 거리 밖 화살표는 그리지 않는다. 전 구간을 다 켜면 지하가 크리스마스가 된다 */
const VISIBLE = 26
/** 바닥 위 높이 — 유도블록(0.006~0.026) 위에 얹는다 */
const LIFT = 0.030

/**
 * 셰브런 하나. +X를 향하고 XZ 평면에 눕는다 (three 좌표계 기준).
 * 폭은 유도블록(0.35m) 안에 들어가게 잡는다 — 넘치면 블록 밖 바닥에 떠 보인다.
 */
const chevron = (): BufferGeometry => {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([
    0.16, 0, 0, -0.10, 0, 0.15, 0.00, 0, 0,
    0.16, 0, 0, 0.00, 0, 0, -0.10, 0, -0.15,
  ], 3))
  g.setAttribute('normal', new Float32BufferAttribute(
    Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3))
  return g
}

type Seg = Readonly<{ x0: number; y0: number; dx: number; dy: number; len: number; yaw: number }>
type Lane = Readonly<{ z: number; segs: readonly Seg[]; total: number }>

const buildLane = (p: GuidePath): Lane => {
  const segs: Seg[] = []
  let total = 0
  for (let i = 0; i + 1 < p.points.length; i++) {
    const [x0, y0] = p.points[i] as readonly [number, number]
    const [x1, y1] = p.points[i + 1] as readonly [number, number]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    segs.push({ x0, y0, dx: dx / len, dy: dy / len, len, yaw: Math.atan2(dy, dx) })
    total += len
  }
  return { z: p.z, segs, total }
}

export type GuideArrows = Readonly<{
  mesh: InstancedMesh
  /** @param playerPos 월드 좌표. 가까운 화살표만 켠다 */
  update(elapsedSec: number, playerPos: Vec3): void
}>

export const createGuideArrows = (): GuideArrows => {
  const lanes = GUIDE_PATHS.map(buildLane).filter((l) => l.segs.length > 0)
  const counts = lanes.map((l) => Math.max(1, Math.floor(l.total / SPACING)))
  const total = counts.reduce((a, b) => a + b, 0)

  // 바탕이 이미 밝은 황색이라 **더 밝게 하면 안 읽힌다.** 실제 노면 표시처럼
  // 짙은 색으로 찍어야 형태가 산다 — 색이 아니라 대비가 정보를 만든다.
  const mat = new MeshBasicMaterial({
    color: new Color(0x2b2a24), toneMapped: false, side: DoubleSide,
    // 유도블록 바로 위라 깊이가 붙는다 — 데칼처럼 앞으로 당겨 z-파이팅을 막는다
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    transparent: true, opacity: 0.9,
  })
  const mesh = new InstancedMesh(chevron(), mat, total)
  mesh.name = 'guide-arrows'
  // 여러 존에 걸쳐 있어 바운딩 구가 무의미하다 — 컬링을 끄고 스케일 0으로 숨긴다
  mesh.frustumCulled = false
  mesh.renderOrder = 3

  const m = new Matrix4()
  const pos = new Vector3()
  const rot = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const ONE = new Vector3(1, 1, 1)
  const HIDE = new Vector3(0, 0, 0)

  return {
    mesh,
    update(elapsedSec, playerPos) {
      const flow = (elapsedSec * SPEED) % SPACING
      let i = 0
      let anyVisible = false
      lanes.forEach((lane, li) => {
        const n = counts[li] as number
        for (let k = 0; k < n; k++) {
          let d = k * SPACING + flow
          if (d > lane.total) d -= lane.total
          // 호 길이 → 좌표
          let rest = d
          let seg = lane.segs[0] as Seg
          for (const s of lane.segs) {
            if (rest <= s.len) { seg = s; break }
            rest -= s.len
          }
          const wx = seg.x0 + seg.dx * rest
          const wy = seg.y0 + seg.dy * rest
          const near = Math.hypot(wx - playerPos.x, wy - playerPos.y) < VISIBLE
            && Math.abs(lane.z - playerPos.z) < 4
          if (near) anyVisible = true
          rot.setFromAxisAngle(up, seg.yaw)
          pos.set(wx, lane.z + LIFT, -wy)
          m.compose(pos, rot, near ? ONE : HIDE)
          mesh.setMatrixAt(i++, m)
        }
      })
      mesh.instanceMatrix.needsUpdate = true
      // 전부 스케일 0이어도 메시 자체는 드로우 콜을 먹는다. 아예 끈다.
      mesh.visible = anyVisible
    },
  }
}
