/**
 * 지상 교통 — 신호를 지키는 차량.
 *
 * 모델은 Kenney Car Kit (CC0). 여덟 차종이 **텍스처 하나(colormap)를 공유**하므로
 * 재질은 한 벌로 끝나고, 차종마다 `InstancedMesh` 를 하나씩 쓴다 → 드로우 콜 8.
 * 차 한 대는 body + 바퀴 4개인데 전부 같은 재질이라 지오메트리를 병합해 하나로 만든다.
 * 병합을 안 하면 16대 × 5메시 = 80콜이다.
 *
 * ── 교차로 규약
 * 이면도로(x −31~−23, 남북)를 횡단보도가 가로지르고, 주 차도(y 16~22, 동서)가
 * 그 이면도로와 교차한다. 그래서 두 방향은 **반대 위상**으로 움직인다.
 *
 *     보행 녹색 → 이면도로 차 정지 · 주 차도 차 주행
 *     보행 적색 → 이면도로 차 주행 · 주 차도 차 정지
 *
 * 이렇게 두면 신호 하나로 교차로가 성립하고, 플레이어가 건너는 동안 차가 서 있다.
 *
 * ── 좌표
 * 월드(x 동 · y 북 · z 상) ↔ three(x, z, −y). 차선은 월드로 적고 배치할 때만 바꾼다.
 * Kenney 차체는 **길이축이 three z** 라, 월드 y 로 달리는 차는 회전이 필요 없다.
 */

import {
  Box3, BufferGeometry, Group, InstancedMesh, Matrix4, MeshToonMaterial, Object3D,
  Quaternion, SRGBColorSpace, type Texture, Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CarBox } from '../systems/roadHazard'
import { makeToonRamp } from './toon'

const KINDS = [
  'sedan', 'sedan-sports', 'suv', 'suv-luxury', 'taxi', 'van', 'hatchback-sports', 'delivery',
] as const

/**
 * 모델 보정. Kenney 차는 실물보다 짧고 넓다(1.50 × 2.55 × 1.30).
 * 우리 씬은 실측 스케일이라 그대로 두면 장난감처럼 보인다.
 * 축마다 다르게 늘여 세단 실치수(1.88 × 4.46 × 1.50)에 맞춘다.
 */
const FIT = new Vector3(1.25, 1.15, 1.75)   // three 축: x 폭 · y 높이 · z 길이

/** 차선 — 월드 좌표. `stopS` 는 시작점에서 정지선까지의 거리(m). */
type Lane = Readonly<{
  from: readonly [number, number]
  to: readonly [number, number]
  stopS: number
  /** 보행 신호가 **녹색일 때** 멈추는 차선인가 (= 횡단보도를 지나는 이면도로) */
  stopOnWalk: boolean
  count: number
}>

const CROSS_X = [-31.0, -23.0] as const
const LANES: readonly Lane[] = [
  // 이면도로 — 남북. 횡단보도(y 23.9~31.1)를 지난다
  { from: [-28.8, 44], to: [-28.8, -10], stopS: 44 - 32.0, stopOnWalk: true, count: 3 },
  { from: [-25.2, -10], to: [-25.2, 44], stopS: 23.0 + 10, stopOnWalk: true, count: 3 },
  // 주 차도 — 동서. 이면도로와 교차하므로 위상이 반대다
  { from: [-72, 17.5], to: [18, 17.5], stopS: CROSS_X[0] - 0.6 + 72, stopOnWalk: false, count: 5 },
  { from: [18, 20.5], to: [-72, 20.5], stopS: 18 - (CROSS_X[1] + 0.6), stopOnWalk: false, count: 5 },
]

const V_MAX = 9.0            // m/s (≈32 km/h — 도심 이면도로)
const ACC = 4.5
const BRAKE = 8.0
const CAR_LEN = 4.6
const GAP_MIN = 2.2          // 앞차 뒤 최소 간격
/**
 * 황색 구간(초). 신호가 순간 전환이라 이것이 없으면 **정지선을 1~2 m 넘어서 선다**
 * (실측: 주 차도 차가 x −31.6 정지선에서 −30.4 에 멈췄다).
 * 위상이 바뀌기 전에 미리 감속시켜 교차로 안에 걸치지 않게 한다.
 * 9 m/s 에서 제동거리가 v²/2a ≈ 5 m 이므로 0.9 초면 충분하지만 여유를 둔다.
 */
const AMBER_SEC = 2.2
/**
 * 정지선 앞 여유(m)와 크리핑 하한(m/s).
 *
 * 이것이 없으면 차가 **정지선을 야금야금 넘는다.** 제동 곡선 `v = √(2·a·d)` 는
 * 남은 거리가 0.3 m 여도 2.2 m/s 를 허용하므로, 멈춘 차(v=0)에서 `vLimit > v` 가
 * 되어 가속 → 한 프레임에 정지선을 넘음 → 급정거 → 다시 가속을 반복한다.
 * 디렉터가 본 "잠깐 멈췄다가 다시 전진"이 이 떨림이다.
 *
 * 그리고 한 번 넘으면 `toStop < 0` 이라 **신호를 통째로 무시**하고 횡단보도를
 * 그대로 지나간다 — 초록불인데 차가 직진하던 진짜 원인이 이것이었다.
 *
 * 목표속도가 이 하한 아래로 내려가면 0 으로 스냅해 확실히 세운다.
 */
const STOP_MARGIN = 0.6
const CREEP_MIN = 1.2

type Car = { lane: Lane; len: number; dir: readonly [number, number]; s: number; v: number; kind: number }

export type Traffic = Readonly<{
  group: Group
  /** `lightIsGreen`(보행 녹색) · 남은 초와 dt 를 받아 한 프레임 굴린다. */
  update(dtSec: number, walkGreen: boolean, remainSec: number): void
  /**
   * 현재 차체들의 월드 축정렬 상자. 매 프레임 **같은 배열을 갱신해** 돌려준다 —
   * 프레임마다 새로 만들면 GC 가 60 Hz 로 돈다.
   */
  bodies(): readonly CarBox[]
  dispose(): void
}>

/**
 * 판정 치수(반폭 · 반길이, m). 모델 실치수(1.88 × 4.46)보다 조금 작게 잡는다 —
 * 스치기만 해도 처음으로 돌아가면 억울하다.
 */
const HIT_W = 0.85
const HIT_L = 2.10

const laneLen = (l: Lane): number =>
  Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1])

/** 차선 진행 방향의 단위 벡터(월드) */
const laneDir = (l: Lane): [number, number] => {
  const n = laneLen(l)
  return [(l.to[0] - l.from[0]) / n, (l.to[1] - l.from[1]) / n]
}

/**
 * 차 한 대의 지오메트리 — body 와 바퀴를 **월드 변환을 구워** 하나로 합친다.
 * 원점은 차 바닥 중앙에 둔다(바닥에 놓기 쉽게).
 */
const bakeCar = (root: Object3D): BufferGeometry | null => {
  const geos: BufferGeometry[] = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as { isMesh?: boolean; geometry?: BufferGeometry; matrixWorld?: Matrix4 }
    if (!m.isMesh || !m.geometry) return
    const g = m.geometry.clone()
    g.applyMatrix4(m.matrixWorld!)
    // 병합은 속성 집합이 같아야 한다 — 쓰지 않는 것은 떨어낸다
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    }
    geos.push(g)
  })
  if (!geos.length) return null
  const merged = mergeGeometries(geos, false)
  if (!merged) return null
  merged.scale(FIT.x, FIT.y, FIT.z)
  const box = new Box3().setFromBufferAttribute(merged.getAttribute('position') as never)
  merged.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
  merged.computeVertexNormals()
  return merged
}

export const buildTraffic = async (basePath = 'models/cars/'): Promise<Traffic> => {
  const loader = new GLTFLoader()
  const group = new Group()
  group.name = 'traffic'

  const loaded = await Promise.all(KINDS.map(async (k) => {
    const gltf = await loader.loadAsync(`${basePath}${k}.glb`)
    return bakeCar(gltf.scene)
  }))

  // 텍스처는 여덟 차종이 공유한다 — 첫 모델에서 한 장만 꺼내 쓴다.
  const first = await loader.loadAsync(`${basePath}${KINDS[0]}.glb`)
  let map: Texture | null = null
  first.scene.traverse((o) => {
    const m = (o as { material?: { map?: Texture | null } }).material
    if (m?.map && map === null) map = m.map
  })
  if (map !== null) (map as Texture).colorSpace = SRGBColorSpace

  const material = new MeshToonMaterial({ gradientMap: makeToonRamp(), map })

  // 차를 차선에 뿌린다. 같은 차선 안에서는 일정 간격으로 시작해 서로 안 겹치게 한다.
  const cars: Car[] = []
  LANES.forEach((lane, li) => {
    const len = laneLen(lane)
    const dir = laneDir(lane)
    for (let i = 0; i < lane.count; i++) {
      cars.push({
        lane, len, dir,
        s: (len / lane.count) * i,
        v: V_MAX,
        kind: (li * 3 + i) % KINDS.length,
      })
    }
  })

  // 차종별 인스턴스 — 같은 차종끼리 묶어야 드로우 콜이 차종 수로 끝난다
  const groups = KINDS.map((name, k) => {
    const members = cars.filter((c) => c.kind === k)
    const geo = loaded[k]
    if (!geo || !members.length) return null
    const im = new InstancedMesh(geo, material, members.length)
    im.name = `car:${name}`
    // 인스턴스가 90 m 차선에 흩어져 있어 자동 바운딩이 매 프레임 어긋난다.
    // 컬링은 그룹 단위(`visible`)로 하고 여기서는 끈다 — `main.ts` 가 지상에서만 켠다.
    im.frustumCulled = false
    group.add(im)
    return { im, members }
  })

  /** 판정 상자 — 대수가 고정이라 한 번 만들고 값만 갈아 끼운다. */
  const boxes = cars.map(() => ({ x: 0, y: 0, hx: 0, hy: 0 }))

  const mat4 = new Matrix4()
  const quat = new Quaternion()
  const pos = new Vector3()
  const scl = new Vector3(1, 1, 1)
  const up = new Vector3(0, 1, 0)

  const update = (dtSec: number, walkGreen: boolean, remainSec: number): void => {
    const dt = Math.min(0.05, dtSec)
    // 곧 위상이 바뀌면 **지금 달리는 쪽**이 미리 선다 — 실물 황색과 같은 구실이다.
    const amber = remainSec <= AMBER_SEC

    for (const c of cars) {
      const lane = c.lane
      const len = c.len
      const nowStop = lane.stopOnWalk ? walkGreen : !walkGreen
      const stopped = nowStop || amber

      // 앞차까지 남은 거리 — 같은 차선에서 자기보다 앞선 차 중 가장 가까운 것
      let ahead = Infinity
      for (const o of cars) {
        if (o === c || o.lane !== lane) continue
        let d = o.s - c.s
        if (d < 0) d += len                       // 순환 차선
        if (d < ahead) ahead = d
      }
      const carGap = ahead - CAR_LEN - GAP_MIN

      // 정지선까지 — 이미 지났으면 신호를 더 보지 않는다(교차로 안에서 멈추면 안 된다)
      const toStop = lane.stopS - c.s
      const signalGap = stopped && toStop > 0 ? toStop : Infinity

      // 정지선 앞에 여유를 두고 제동 곡선을 계산한다. 여유가 없으면 곡선이
      // 정지선 **위**에서 0 이 되므로 오차 한 번에 넘어간다.
      const eff = Math.min(carGap, signalGap) - STOP_MARGIN
      const vCurve = eff <= 0 ? 0 : Math.min(V_MAX, Math.sqrt(2 * BRAKE * eff))
      // 기어가는 속도는 허용하지 않는다 — 그게 떨림의 원인이다
      const vLimit = vCurve < CREEP_MIN ? 0 : vCurve

      c.v += (vLimit > c.v ? ACC : -BRAKE) * dt
      c.v = Math.max(0, Math.min(V_MAX, c.v))
      if (vLimit <= 0) c.v = Math.max(0, c.v - BRAKE * dt)

      c.s += c.v * dt
      if (c.s > len) c.s -= len
    }

    // 판정 상자 갱신 — 차선 방향에 따라 길이축이 x 인지 y 인지가 갈린다
    cars.forEach((c, i) => {
      const [dx, dy] = c.dir
      const alongY = Math.abs(dy) > Math.abs(dx)
      const b = boxes[i]!
      b.x = c.lane.from[0] + dx * c.s
      b.y = c.lane.from[1] + dy * c.s
      b.hx = alongY ? HIT_W : HIT_L
      b.hy = alongY ? HIT_L : HIT_W
    })

    // 인스턴스 매트릭스 갱신
    for (const g of groups) {
      if (!g) continue
      g.members.forEach((c, slot) => {
        const [dx, dy] = c.dir
        const wx = c.lane.from[0] + dx * c.s
        const wy = c.lane.from[1] + dy * c.s
        // 월드 → three. 차체 길이축은 three z 라 진행 방향(three −z 가 월드 +y)에 맞춘다.
        pos.set(wx, 0, -wy)
        quat.setFromAxisAngle(up, Math.atan2(dx, -dy))
        mat4.compose(pos, quat, scl)
        g.im.setMatrixAt(slot, mat4)
      })
      g.im.instanceMatrix.needsUpdate = true
    }
  }

  update(0, false, 99)

  return {
    group,
    update,
    bodies: () => boxes,
    dispose: () => {
      for (const g of groups) g?.im.geometry.dispose()
      material.dispose()
    },
  }
}
