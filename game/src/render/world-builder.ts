/**
 * data/world.ts → Three.js 씬 그래프.
 *
 * 좌표는 부록 A 그대로 쓴다. Three는 Y-up이므로 (x, y, z)월드 → (x, z, −y)three 로만 사상한다.
 * 이 사상은 여기 한 곳에만 존재한다 — 게임 로직은 끝까지 월드 좌표로 산다.
 */

import {
  BoxGeometry, BufferGeometry, Color, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3,
} from 'three'
import { PALETTE } from '../data/tuning'
import {
  DOOR_XS, FLOOR, GATES, GATE_BODY, GATE_LAMP_Z, PLATFORM, PSD_Y,
  QUEUE_MARKERS, RAMPS, SLABS, SOLIDS, type SlabKind, type SolidLook,
} from '../data/world'
import { emissiveMat, outlineMat, toonMat } from './toon'

/** 월드(x,y,z, Z-up) → three(x,y,z, Y-up) */
export const toThree = (x: number, y: number, z: number): Vector3 => new Vector3(x, z, -y)

const LOOK_COLOR: Record<SolidLook, number> = {
  wall: PALETTE.concreteDark,
  glass: 0x9fc7d6,
  column: PALETTE.concrete,
  prop: 0x8d8a82,
  machine: 0x3f6f8f,
  bench: 0x9a6b3f,
  gate: 0xc9ccd1,
  psd: 0xa8b4bd,
  stairs: PALETTE.concrete,
  kiosk: 0xd8703f,
  shelter: 0x6f7d86,
  bus: 0x1f6fbf,
  sign: 0x4a4a48,
}

const SLAB_COLOR: Record<SlabKind, number> = {
  road: PALETTE.asphalt,
  sidewalk: PALETTE.sidewalk,
  // 비운임(대합실)은 따뜻한 베이지, 운임구역부터는 차가운 회청. 층이 바뀐 걸 발로 안다
  concourse: 0xe4dfd2,
  paid: 0xdcdcd8,
  platform: 0xd4d7d9,
  landing: PALETTE.sidewalk,
}

const UNIT_BOX = new BoxGeometry(1, 1, 1)

/** look별로 InstancedMesh 1개 — 드로우 콜을 look 종류 수로 묶는다. */
const buildSolids = (outline: boolean): Group => {
  const g = new Group()
  g.name = 'solids'
  const byLook = new Map<SolidLook, typeof SOLIDS[number][]>()
  for (const s of SOLIDS) {
    const list = byLook.get(s.look)
    if (list) list.push(s)
    else byLook.set(s.look, [s])
  }

  const m4 = new Matrix4()
  const q = new Quaternion()
  const scale = new Vector3()
  const pos = new Vector3()

  for (const [look, list] of byLook) {
    const mat = toonMat(LOOK_COLOR[look], look === 'glass' ? { transparent: true, opacity: 0.42 } : {})
    const mesh = new InstancedMesh(UNIT_BOX, mat, list.length)
    mesh.name = `solid:${look}`
    const shell = outline && look !== 'glass'
      ? new InstancedMesh(UNIT_BOX, outlineMat(0.05), list.length)
      : null

    list.forEach((s, i) => {
      const w = s.rect[2] - s.rect[0]
      const d = s.rect[3] - s.rect[1]
      const cx = (s.rect[0] + s.rect[2]) / 2
      const cy = (s.rect[1] + s.rect[3]) / 2
      // 충돌 높이(h)가 아니라 렌더 높이를 쓴다 — 외벽은 낮게 그려 시야를 비운다
      const rh = s.renderH ?? s.h
      pos.set(cx, s.z0 + rh / 2, -cy)
      scale.set(Math.max(w, 0.02), rh, Math.max(d, 0.02))
      m4.compose(pos, q, scale)
      mesh.setMatrixAt(i, m4)
      shell?.setMatrixAt(i, m4)
    })
    mesh.instanceMatrix.needsUpdate = true
    g.add(mesh)
    if (shell) {
      shell.instanceMatrix.needsUpdate = true
      shell.renderOrder = -1
      // 아웃라인 셸은 법선 방향으로 부푼 복제본이다. 카메라 차폐 레이캐스트가
      // 이걸 맞으면 실제 벽보다 앞에서 걸려 카메라가 지오메트리 속으로 빨려 들어간다.
      shell.raycast = () => {}
      g.add(shell)
    }
  }
  return g
}

const buildSlabs = (): Group => {
  const g = new Group()
  g.name = 'slabs'
  const plane = new PlaneGeometry(1, 1)
  for (const s of SLABS) {
    const w = s.rect[2] - s.rect[0]
    const d = s.rect[3] - s.rect[1]
    const mesh = new Mesh(plane, toonMat(SLAB_COLOR[s.kind]))
    mesh.name = `slab:${s.id}`
    mesh.rotation.x = -Math.PI / 2
    mesh.scale.set(w, d, 1)
    mesh.position.set((s.rect[0] + s.rect[2]) / 2, s.z + 0.01, -(s.rect[1] + s.rect[3]) / 2)
    mesh.receiveShadow = false
    g.add(mesh)
  }
  return g
}

/** 경사면 — 박스를 기울여 얹는다. 계단은 스텝 노즈를 얇게 얹어 결을 만든다. */
const buildRamps = (): Group => {
  const g = new Group()
  g.name = 'ramps'
  for (const r of RAMPS) {
    const w = r.rect[2] - r.rect[0]
    const d = r.rect[3] - r.rect[1]
    const run = r.axis === 'x' ? w : d
    const drop = r.zAtMax - r.zAtMin
    const slope = Math.hypot(run, drop)
    const geo = new BoxGeometry(r.axis === 'x' ? slope : w, 0.34, r.axis === 'x' ? d : slope)
    const mesh = new Mesh(geo, toonMat(r.kind === 'escalator' ? PALETTE.metal : PALETTE.concrete))
    mesh.name = `ramp:${r.id}`
    mesh.position.set((r.rect[0] + r.rect[2]) / 2, (r.zAtMin + r.zAtMax) / 2 - 0.16, -(r.rect[1] + r.rect[3]) / 2)
    const angle = Math.atan2(drop, run)
    if (r.axis === 'x') mesh.rotation.z = angle
    else mesh.rotation.x = -angle
    g.add(mesh)

    if (r.kind === 'stairs') {
      const steps = Math.max(6, Math.round(Math.abs(drop) / 0.162))
      const nose = new InstancedMesh(UNIT_BOX, toonMat(PALETTE.concreteDark), steps)
      const m4 = new Matrix4()
      const q = new Quaternion()
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps
        const ax = r.axis === 'x' ? r.rect[0] + run * t : (r.rect[0] + r.rect[2]) / 2
        const ay = r.axis === 'x' ? (r.rect[1] + r.rect[3]) / 2 : r.rect[1] + run * t
        const z = r.zAtMin + drop * t
        m4.compose(
          new Vector3(ax, z + 0.06, -ay), q,
          new Vector3(r.axis === 'x' ? 0.1 : w, 0.06, r.axis === 'x' ? d : 0.1),
        )
        nose.setMatrixAt(i, m4)
      }
      nose.instanceMatrix.needsUpdate = true
      g.add(nose)
    }
  }
  return g
}

/** 게이트 표시등 — 색은 매 프레임 시드 상태에서 갱신된다 (gate-rig) */
export type LampHandles = Readonly<{ group: Group; lamps: readonly Mesh[] }>

const buildGateLamps = (): LampHandles => {
  const group = new Group()
  group.name = 'gate-lamps'
  const geo = new BoxGeometry(0.9, 0.22, 0.16)

  // 표지판 기둥 6개 — 인스턴싱 (드로우 콜 6 → 1)
  const posts = new InstancedMesh(new BoxGeometry(0.2, 2.05, 0.2), toonMat(0xb8bcc2), GATES.length)
  const pm = new Matrix4()
  const pq = new Quaternion()
  const pone = new Vector3(1, 1, 1)
  GATES.forEach((gate, i) => {
    pm.compose(new Vector3((GATE_BODY.xMin + GATE_BODY.xMax) / 2, FLOOR.B1 + 1.02, -gate.y), pq, pone)
    posts.setMatrixAt(i, pm)
  })
  posts.instanceMatrix.needsUpdate = true
  group.add(posts)

  const lamps = GATES.map((gate) => {
    const m = new Mesh(geo, emissiveMat(0x00a84d))
    m.name = `lamp:${gate.label}`
    // 표지판(x=61.0)보다 서쪽 앞에 둔다 — 카메라가 서쪽에 서므로 겹치면 램프가 안 보인다
    m.position.set(GATE_BODY.xMin - 0.4, GATE_LAMP_Z, -gate.y)
    group.add(m)
    return m
  })

  return { group, lamps }
}

/** 승강장 바닥 마킹 — 안전선 · 점자블록 · 대기줄. 정보이자 시각적 리듬. */
const buildPlatformMarks = (): Group => {
  const g = new Group()
  g.name = 'platform-marks'
  const plane = new PlaneGeometry(1, 1)
  const strip = (yMin: number, yMax: number, color: number): void => {
    const m = new Mesh(plane, new MeshBasicMaterial({ color: new Color(color) }))
    m.rotation.x = -Math.PI / 2
    m.scale.set(PLATFORM.xMax - PLATFORM.xMin, yMax - yMin, 1)
    m.position.set((PLATFORM.xMin + PLATFORM.xMax) / 2, FLOOR.B2 + 0.02, -(yMin + yMax) / 2)
    g.add(m)
  }
  strip(10.55, 11.15, 0xf2b705)   // 점자블록
  strip(11.35, 11.75, 0xe5484d)   // 안전선

  for (const q of QUEUE_MARKERS) {
    const m = new Mesh(plane, new MeshBasicMaterial({ color: new Color(PALETTE.line2) }))
    m.rotation.x = -Math.PI / 2
    m.scale.set(1.6, 2.4, 1)
    m.position.set(q.x, FLOOR.B2 + 0.03, -(q.y - 1.2))
    g.add(m)
  }
  // 가동문 개구 표시
  const doorMark = new InstancedMesh(
    new PlaneGeometry(1.6, 0.5), new MeshBasicMaterial({ color: new Color(0xffffff) }), DOOR_XS.length,
  )
  const m4 = new Matrix4()
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
  DOOR_XS.forEach((x, i) => {
    m4.compose(new Vector3(x, FLOOR.B2 + 0.025, -(PSD_Y - 1.1)), q, new Vector3(1, 1, 1))
    doorMark.setMatrixAt(i, m4)
  })
  doorMark.instanceMatrix.needsUpdate = true
  g.add(doorMark)
  return g
}

export type WorldHandles = Readonly<{
  root: Group
  lamps: readonly Mesh[]
  /** 카메라 차폐 검사 대상 — 실제 벽만. 바닥·마킹·아웃라인은 제외한다 */
  occluders: Group
}>

export const buildWorld = (outline: boolean): WorldHandles => {
  const root = new Group()
  root.name = 'world'
  const lampSet = buildGateLamps()
  const solids = buildSolids(outline)
  root.add(buildSlabs(), buildRamps(), solids, lampSet.group, buildPlatformMarks())
  return { root, lamps: lampSet.lamps, occluders: solids }
}

export const disposeGeometry = (g: BufferGeometry): void => g.dispose()
