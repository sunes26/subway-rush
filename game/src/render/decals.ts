/**
 * 바닥 마킹 · 사인 · 액센트.
 *
 * 그레이박스와 "게임 화면"을 가르는 건 폴리곤 수가 아니라 **읽히는 정보**다.
 * 여기 있는 건 전부 플레이어가 판단에 쓰는 표시이거나, 공간의 척도를 알려주는 결이다.
 */

import {
  BoxGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3,
} from 'three'
import { PALETTE } from '../data/tuning'
import {
  CROSSWALK, FLOOR, GATES, GATE_BODY, PLATFORM, SLABS,
} from '../data/world'
import { emissiveMat, toonMat } from './toon'

const flat = (color: number, opacity = 1): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color: new Color(color), toneMapped: false,
    ...(opacity < 1 ? { transparent: true, opacity } : {}),
  })

const UNIT_PLANE = new PlaneGeometry(1, 1)

const lay = (
  parent: Group, mat: MeshBasicMaterial,
  cx: number, cy: number, w: number, d: number, z: number,
): void => {
  const m = new Mesh(UNIT_PLANE, mat)
  m.rotation.x = -Math.PI / 2
  m.scale.set(w, d, 1)
  m.position.set(cx, z, -cy)
  parent.add(m)
}

/**
 * 바닥 타일 그리드 — 4m 간격. 공간의 척도와 이동 속도를 눈으로 읽게 해준다.
 * 선 하나하나를 Mesh로 만들면 그것만으로 드로우 콜 80개다 → InstancedMesh 1개로 묶는다.
 */
const tileGrid = (): Group => {
  const g = new Group()
  g.name = 'tile-grid'
  const step = 4
  type Line = { x: number; y: number; z: number; w: number; d: number }
  const lines: Line[] = []
  for (const s of SLABS) {
    if (s.kind === 'road' || s.kind === 'landing') continue
    const [x0, y0, x1, y1] = s.rect
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
      lines.push({ x, y: (y0 + y1) / 2, z: s.z + 0.015, w: 0.06, d: y1 - y0 })
    }
    for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) {
      lines.push({ x: (x0 + x1) / 2, y, z: s.z + 0.015, w: x1 - x0, d: 0.06 })
    }
  }
  const mesh = new InstancedMesh(UNIT_PLANE, flat(0x000000, 0.055), lines.length)
  const m4 = new Matrix4()
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
  lines.forEach((l, i) => {
    m4.compose(new Vector3(l.x, l.z, -l.y), q, new Vector3(l.w, l.d, 1))
    mesh.setMatrixAt(i, m4)
  })
  mesh.instanceMatrix.needsUpdate = true
  g.add(mesh)
  return g
}

/** Z1 지상 — 횡단보도 · 차선 · 정류장 표시 */
const groundMarks = (): Group => {
  const g = new Group()
  g.name = 'ground-marks'
  const white = flat(0xf2f2ee)

  // 횡단보도 — 이면도로를 가로지르는 흰 줄. 신호 판단의 시각적 근거다
  const bandW = 0.55
  const gap = 0.55
  for (let x = CROSSWALK.xMin + 0.4; x < CROSSWALK.xMax - 0.2; x += bandW + gap) {
    lay(g, white, x + bandW / 2, (CROSSWALK.yMin + CROSSWALK.yMax) / 2,
      bandW, CROSSWALK.yMax - CROSSWALK.yMin, 0.02)
  }
  // 정지선
  lay(g, white, CROSSWALK.xMin - 0.9, (CROSSWALK.yMin + CROSSWALK.yMax) / 2,
    0.35, CROSSWALK.yMax - CROSSWALK.yMin, 0.02)

  // 차도 중앙선 (점선)
  const yellow = flat(0xe8c33a)
  for (let x = -64; x < 12; x += 5) lay(g, yellow, x + 1.4, 19, 2.8, 0.16, 0.02)

  // 버스 정류장 노면 표시
  lay(g, flat(PALETTE.line1, 0.55), -58, 22.9, 11, 1.2, 0.02)
  return g
}

/** Z1 신호등 — 잔여시간 표시기 포함. MAP §3.3 */
export type TrafficRig = Readonly<{ group: Group; sync(green: boolean, remainSec: number): void }>

export const createTrafficLight = (): TrafficRig => {
  const group = new Group()
  group.name = 'traffic-light'
  const pole = new Mesh(new BoxGeometry(0.22, 4.2, 0.22), toonMat(0x3e4348))
  pole.position.set(-32.6, 2.1, -22.6)
  group.add(pole)

  const head = new Mesh(new BoxGeometry(0.5, 1.15, 0.42), toonMat(0x24282b))
  head.position.set(-32.6, 3.9, -22.9)
  group.add(head)

  const redLamp = new Mesh(new BoxGeometry(0.3, 0.3, 0.1), emissiveMat(PALETTE.danger))
  redLamp.position.set(-32.6, 4.2, -23.13)
  const greenLamp = new Mesh(new BoxGeometry(0.3, 0.3, 0.1), emissiveMat(PALETTE.line2))
  greenLamp.position.set(-32.6, 3.62, -23.13)
  group.add(redLamp, greenLamp)

  // 잔여시간 표시기 — 남은 초만큼 세로 막대가 줄어든다
  const bar = new Mesh(new BoxGeometry(0.16, 1.0, 0.08), emissiveMat(0xf2f2ee))
  bar.position.set(-32.28, 3.9, -23.13)
  group.add(bar)

  const dim = (m: Mesh, on: boolean, c: number): void => {
    ;(m.material as MeshBasicMaterial).color.set(on ? c : 0x2a2c2e)
  }

  return {
    group,
    sync(green, remainSec) {
      dim(redLamp, !green, PALETTE.danger)
      dim(greenLamp, green, PALETTE.line2)
      const k = Math.max(0.03, Math.min(1, remainSec / (green ? 12 : 18)))
      bar.scale.y = k
      bar.position.y = 3.4 + (k * 1.0) / 2
      ;(bar.material as MeshBasicMaterial).color.set(green ? PALETTE.line2 : PALETTE.danger)
    },
  }
}

/**
 * 게이트 표시등 — 색 + **형태**로 구분한다.
 * 색만 쓰면 색각 이상 플레이어에게 이 게임의 유일한 판단 근거가 사라진다.
 * 정상 = ▲ 화살표 / 고장 = ✕
 */
export type GateSignRig = Readonly<{ group: Group; sync(workingIds: readonly number[]): void }>

export const createGateSigns = (): GateSignRig => {
  const group = new Group()
  group.name = 'gate-signs'
  const cx = (GATE_BODY.xMin + GATE_BODY.xMax) / 2
  const zTop = FLOOR.B1 + 2.55
  // 기호는 **서쪽 면**에 붙인다 — 카메라도 플레이어도 서쪽에서 접근한다.
  const FACE = -0.06
  const n = GATES.length

  const m4 = new Matrix4()
  // 표지판은 x축을 향한다: Y축 +90° 회전
  const faceWest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const flatDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
  const one = new Vector3(1, 1, 1)
  const zero = new Vector3(0, 0, 0)

  const mkInstanced = (
    w: number, h: number, color: number, count: number, opacity = 1,
  ): InstancedMesh => {
    const mat = flat(color, opacity)
    mat.side = DoubleSide
    const im = new InstancedMesh(new PlaneGeometry(w, h), mat, count)
    group.add(im)
    return im
  }

  const panels = mkInstanced(1.5, 1.0, 0x14171c, n)
  const washes = mkInstanced(1.5, 0.14, 0xffffff, n)
  // ▲ = 막대 3개 / ✕ = 막대 2개. 숨길 때는 스케일 0으로 접는다.
  const ARROW_BARS = [[-0.22, 0.74], [0.0, 0.48], [0.2, 0.2]] as const
  const arrows = mkInstanced(1, 0.15, PALETTE.line2, n * ARROW_BARS.length)
  const crosses = mkInstanced(0.86, 0.15, PALETTE.danger, n * 2)
  const totalTicks = GATES.reduce((a, g) => a + g.id, 0)
  const ticks = mkInstanced(1, 1, 0xf0f0ec, totalTicks, 0.8)

  let tickIdx = 0
  GATES.forEach((g, i) => {
    m4.compose(new Vector3(cx, zTop, -g.y), faceWest, one)
    panels.setMatrixAt(i, m4)
    m4.compose(new Vector3(cx + FACE * 0.5, zTop - 0.43, -g.y), faceWest, one)
    washes.setMatrixAt(i, m4)
    for (let k = 0; k < g.id; k++) {
      m4.compose(new Vector3(59.0 + k * 0.24, FLOOR.B1 + 0.02, -g.y), flatDown, new Vector3(0.16, 0.5, 1))
      ticks.setMatrixAt(tickIdx++, m4)
    }
  })
  panels.instanceMatrix.needsUpdate = true
  washes.instanceMatrix.needsUpdate = true
  ticks.instanceMatrix.needsUpdate = true

  const okColor = new Color(PALETTE.line2)
  const badColor = new Color(PALETTE.danger)

  return {
    group,
    sync(workingIds) {
      GATES.forEach((g, i) => {
        const ok = workingIds.includes(g.id)
        washes.setColorAt(i, ok ? okColor : badColor)
        ARROW_BARS.forEach(([dy, w], k) => {
          const idx = i * ARROW_BARS.length + k
          if (ok) m4.compose(new Vector3(cx + FACE, zTop + dy, -g.y), faceWest, new Vector3(w, 1, 1))
          else m4.compose(new Vector3(0, -999, 0), faceWest, zero)
          arrows.setMatrixAt(idx, m4)
        })
        for (let k = 0; k < 2; k++) {
          const idx = i * 2 + k
          if (!ok) {
            const rot = new Quaternion()
              .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
              .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), k === 0 ? Math.PI / 4 : -Math.PI / 4))
            m4.compose(new Vector3(cx + FACE, zTop, -g.y), rot, one)
          } else {
            m4.compose(new Vector3(0, -999, 0), faceWest, zero)
          }
          crosses.setMatrixAt(idx, m4)
        }
      })
      arrows.instanceMatrix.needsUpdate = true
      crosses.instanceMatrix.needsUpdate = true
      if (washes.instanceColor) washes.instanceColor.needsUpdate = true
    },
  }
}

/** 벽면 LED 전광판 · 역명판 — 디에게틱 사인. 공간에 색과 정보를 준다. */
const signage = (): Group => {
  const g = new Group()
  g.name = 'signage'

  // Z5 안전문 상단 역명판 (16m 간격)
  for (let x = PLATFORM.xMin + 6; x < PLATFORM.xMax; x += 16) {
    const board = new Mesh(new PlaneGeometry(3.2, 0.72), flat(0x0f1114))
    board.position.set(x, FLOOR.B2 + 2.5, -12.05)
    board.material.side = DoubleSide
    g.add(board)
    const stripe = new Mesh(new PlaneGeometry(3.0, 0.16), flat(PALETTE.line2))
    stripe.position.set(x, FLOOR.B2 + 2.28, -12.0)
    stripe.material.side = DoubleSide
    g.add(stripe)
  }

  // Z2 벽면 LED (부록 A: OBJ-33 x=20/60/100 벽면 → B1 대합실 남벽에 배치)
  for (const x of [16, 34, 50]) {
    const led = new Mesh(new PlaneGeometry(5.4, 0.9), flat(0x18120a))
    led.position.set(x, FLOOR.B1 + 1.9, -0.15)
    led.material.side = DoubleSide
    g.add(led)
    const glow = new Mesh(new PlaneGeometry(5.0, 0.34), flat(0xffb020, 0.9))
    glow.position.set(x, FLOOR.B1 + 1.9, -0.1)
    glow.material.side = DoubleSide
    g.add(glow)
  }
  return g
}

/** 기둥 노선색 띠 — 2호선 그린. 공간의 정체성을 한 줄로 준다. */
const columnBands = (): Group => {
  const g = new Group()
  g.name = 'column-bands'
  const xs = [12, 24, 36, 48]
  const ys = [10, 20]
  const geo = new BoxGeometry(1.08, 0.26, 1.08)
  const band = new InstancedMesh(geo, emissiveMat(PALETTE.line2), xs.length * ys.length)
  const m4 = new Matrix4()
  const q = new Quaternion()
  const one = new Vector3(1, 1, 1)
  let i = 0
  for (const x of xs) for (const y of ys) {
    m4.compose(new Vector3(x, FLOOR.B1 + 2.5, -y), q, one)
    band.setMatrixAt(i++, m4)
  }
  band.instanceMatrix.needsUpdate = true
  g.add(band)
  return g
}

export type Decals = Readonly<{
  root: Group
  traffic: TrafficRig
  gateSigns: GateSignRig
}>

export const buildDecals = (): Decals => {
  const root = new Group()
  root.name = 'decals'
  const traffic = createTrafficLight()
  const gateSigns = createGateSigns()
  root.add(tileGrid(), groundMarks(), signage(), columnBands(), traffic.group, gateSigns.group)
  return { root, traffic, gateSigns }
}
