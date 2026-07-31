/**
 * 실제 3D 역사 로더 — `assets/station_map.blend`에서 뽑은 존별 GLB를 씬에 올린다.
 *
 * 절차 생성 그레이박스를 **보이는 것만** 교체한다. 충돌(`data/world.ts`의 SOLIDS)과
 * 게임 로직은 그대로다 — 보이는 것과 막는 것을 분리해 두면 아트가 바뀌어도 밸런스가 안 흔들린다.
 *
 * 두 가지 규칙으로 굴러간다.
 * 1. **정적 지오메트리는 머티리얼별로 병합**한다. 1,446개 메시를 그대로 올리면 드로우 콜 1,446이다.
 * 2. **동적 부품은 머티리얼 이름으로 찾는다** (`LED_RED`, `TL_GRN`, `PSD_*`…).
 *    오브젝트 이름은 리네임되면 끊기지만, 머티리얼은 룩을 정의하므로 훨씬 안정적이다.
 */

import {
  Box3, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, Vector3,
  type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, TRAIN } from '../data/tuning'
import { DOOR_XS, GATES, SLABS } from '../data/world'
import type { GameState } from '../state/types'
import { toonMat } from './toon'

export const ZONE_FILES = [
  'Z1_GROUND', 'Z2_CONCOURSE', 'Z3_GATES', 'Z4_DESCENT', 'Z5_PLATFORM', 'Z5_TRAIN',
] as const

/**
 * 머리 위 구조물은 전부 숨긴다 — 쿼터뷰 카메라는 그 위에 서므로 그리면 화면이 막힌다.
 * 천장뿐 아니라 **플레이어가 그 밑에 설 수 있는 지붕**도 같은 부류다.
 * 정류장 쉘터 지붕(`Z1_BS_roof`)은 부록 A상 스폰 지점(−58,24)을 정확히 덮고 있어
 * 이걸 그리면 게임 시작 순간 캐릭터가 안 보인다.
 * 단, `*_top`은 게이트 상단함·자판기 상단이라 일괄로 잡으면 안 된다.
 */
const HIDDEN_MATERIALS = new Set(['ST_CEIL'])
const HIDDEN_NAME = /ceil/i
const HIDDEN_EXACT = /^(Z1_BS_roof|Z4_corridor_top|Z5_hang_)/

/** 존 그룹을 그릴 최대 거리(m). 안개 far(≈90m)와 맞춰 둔다. */
const VISIBLE_RANGE = 95

/** 병합하지 않고 개별로 남길 부품 (상태에 따라 움직이거나 색이 바뀐다) */
const DYNAMIC_NAME =
  /^(Z3_GATE_G\d_[NS]_flap|Z3_sign_G\d_face|Z3_GATE_G\d_floorlamp|Z5_psd_door_\d+|TR_door_|TR_dwin_|Z1_OBJ02_signal)/
const DYNAMIC_MATERIAL = new Set([
  'LED_RED', 'LED_GREEN', 'SIGN_RED', 'SIGN_GREEN', 'SIGN_DARK',
  'TL_RED', 'TL_GRN', 'TL_COUNT',
])

const isDynamic = (o: Mesh): boolean => {
  if (DYNAMIC_NAME.test(o.name)) return true
  const m = o.material as Material | Material[]
  const names = Array.isArray(m) ? m.map((x) => x.name) : [m.name]
  return names.some((n) => DYNAMIC_MATERIAL.has(n))
}

/**
 * 텍스처를 벗겨낸 머티리얼 색 보정.
 *
 * 임포트 에셋은 색을 텍스처로 갖고 있어서 베이스 컬러가 무채색 0.8이다.
 * 텍스처를 뺀 채 그대로 쓰면 흰 판자로 보인다 — 여기서 노선/차종 색을 직접 준다.
 */
const MATERIAL_TINT: Record<string, number> = {
  Material: 0x2f6fbf,        // Z1 버스 — 서울 간선버스 파랑
  MAT_BUS: 0x2f6fbf,
  'Material.001': 0x8f959b,  // Z5 잡부재
}

const baseColor = (m: Material | Material[]): number => {
  const one = (Array.isArray(m) ? m[0] : m) as MeshStandardMaterial | undefined
  const tint = one?.name ? MATERIAL_TINT[one.name] : undefined
  if (tint !== undefined) return tint
  return one?.color ? one.color.getHex() : 0xcccccc
}

// ─────────────────────────── 병합 ───────────────────────────

type Bucket = { geos: BufferGeometry[]; color: number }

/** 씬 하나를 훑어 정적 메시는 머티리얼별로 모으고, 동적 메시는 그대로 넘긴다. */
const collect = (
  scene: Object3D,
): { buckets: Map<string, Bucket>; dynamics: Mesh[] } => {
  const buckets = new Map<string, Bucket>()
  const dynamics: Mesh[] = []
  scene.updateWorldMatrix(true, true)

  scene.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || !m.geometry) return
    const matName = Array.isArray(m.material) ? m.material[0]?.name ?? '' : m.material.name

    if (HIDDEN_MATERIALS.has(matName) || HIDDEN_NAME.test(m.name) || HIDDEN_EXACT.test(m.name)) return

    if (isDynamic(m)) { dynamics.push(m); return }

    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    // 병합하려면 애트리뷰트 구성이 같아야 한다. UV는 안 쓰므로 버린다.
    geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    geo.deleteAttribute('tangent')
    const key = matName || 'default'
    const b = buckets.get(key)
    if (b) b.geos.push(geo)
    else buckets.set(key, { geos: [geo], color: baseColor(m.material) })
  })
  return { buckets, dynamics }
}

const mergeBuckets = (buckets: Map<string, Bucket>, into: Group): void => {
  for (const [name, b] of buckets) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)
    if (!merged) continue
    const mesh = new Mesh(merged, toonMat(b.color))
    mesh.name = `merged:${name}`
    into.add(mesh)
    if (b.geos.length > 1) for (const g of b.geos) g.dispose()
  }
}

// ─────────────────────────── 동적 부품 ───────────────────────────

type Flap = { gate: number; node: Object3D; home: number; dir: number }
type SignFace = { gate: number; mat: MeshStandardMaterial }
/** 같은 진행률로 함께 움직이는 문 묶음 — 좌/우 각각 한 덩어리로 병합한다 */
type DoorBank = { left: Mesh | null; right: Mesh | null }

const matOf = (o: Object3D): MeshStandardMaterial => {
  const m = (o as Mesh).material
  const one = (Array.isArray(m) ? m[0] : m) as MeshStandardMaterial
  // 게이트마다 다른 색을 넣어야 하므로 공유 머티리얼을 복제한다
  const cloned = one.clone()
  ;(o as Mesh).material = cloned
  return cloned
}

const worldX = (o: Object3D): number => {
  o.updateWorldMatrix(true, false)
  return new Vector3().setFromMatrixPosition(o.matrixWorld).x
}

const worldZ = (o: Object3D): number => {
  o.updateWorldMatrix(true, false)
  return new Vector3().setFromMatrixPosition(o.matrixWorld).z
}

/** 가장 가까운 가동문 중심 x. 패널이 어느 쪽으로 열려야 하는지 정한다. */
const nearestDoor = (x: number): number =>
  DOOR_XS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), DOOR_XS[0] as number)

/**
 * Blender 씬에 없는 바닥을 메운다.
 *
 * Z1은 차도(`Z1_road`)·연석·점자블록·횡단보도만 모델링돼 있고 **보도 슬랩이 없다**
 * (`SW_PAVER`는 연석 하나에만 걸려 있다). 렌더 이미지에서는 배경색이 보도처럼 보였을 뿐이라
 * 게임에 넣으니 플레이어가 하늘 위를 걷는다.
 * 지하 존은 전부 자체 바닥(`ST_FLOOR`/`PF_FLOOR`)이 있으므로 여기만 채운다.
 */
const buildFloorPatches = (): Group => {
  const g = new Group()
  g.name = 'floor-patch'
  const plane = new PlaneGeometry(1, 1)
  const PATCH = new Set(['Z1-WALK', 'Z1-LANDING'])
  for (const s of SLABS) {
    if (!PATCH.has(s.id)) continue
    const m = new Mesh(plane, toonMat(0xc9c6bd))
    m.name = `patch:${s.id}`
    m.rotation.x = -Math.PI / 2
    m.scale.set(s.rect[2] - s.rect[0], s.rect[3] - s.rect[1], 1)
    // 점자블록·횡단보도 데칼(z=0)보다 살짝 아래로 — 안 그러면 z-파이팅이 난다
    m.position.set((s.rect[0] + s.rect[2]) / 2, s.z - 0.012, -(s.rect[1] + s.rect[3]) / 2)
    g.add(m)
  }
  return g
}

export type Station = Readonly<{
  root: Group
  sync(s: GameState, dtSec: number, greenLight: boolean, lightRemainSec: number): void
  stats: Readonly<{ merged: number; dynamic: number }>
}>

export const loadStation = async (
  baseUrl: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Station> => {
  const loader = new GLTFLoader()
  let done = 0
  const scenes = await Promise.all(
    ZONE_FILES.map(async (z) => {
      const g = await loader.loadAsync(`${baseUrl}models/map/${z}.glb`)
      onProgress?.(++done, ZONE_FILES.length)
      return [z, g.scene] as const
    }),
  )

  const root = new Group()
  root.name = 'station'
  root.add(buildFloorPatches())

  /**
   * 존별 그룹. 병합 메시는 존 전체를 덮는 바운딩 박스를 갖기 때문에
   * 프러스텀 컬링이 전혀 걸리지 않는다 — 어느 존에 서 있든 맵 전체가 그려진다.
   * 그래서 **존 단위로 직접 껐다 켠다.** 안개 far(약 90m) 밖은 어차피 안 보인다.
   */
  const zoneGroups: { group: Group; box: Box3 }[] = []
  const trainGroup = new Group()
  trainGroup.name = 'station:train'

  const flaps: Flap[] = []
  const signs: SignFace[] = []
  const lamps: SignFace[] = []
  let tlRed: MeshStandardMaterial | null = null
  let tlGreen: MeshStandardMaterial | null = null
  const tlCount: Object3D[] = []
  const signAnchors = new Map<number, Vector3>()
  const psdGeo: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }
  const trainGeo: { left: BufferGeometry[]; right: BufferGeometry[] } = { left: [], right: [] }

  let mergedCount = 0
  let dynamicCount = 0

  const bakeGeo = (m: Mesh): BufferGeometry => {
    m.updateWorldMatrix(true, false)
    const geo = m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    geo.deleteAttribute('uv')
    geo.deleteAttribute('uv1')
    geo.deleteAttribute('tangent')
    return geo
  }

  for (const [zone, scene] of scenes) {
    const isTrain = zone === 'Z5_TRAIN'
    const group = isTrain ? trainGroup : new Group()
    group.name = `station:${zone}`
    const { buckets, dynamics } = collect(scene)
    const before = group.children.length
    mergeBuckets(buckets, group)
    mergedCount += group.children.length - before

    for (const m of dynamics) {
      const matName = Array.isArray(m.material) ? m.material[0]?.name ?? '' : m.material.name

      // ── 안전문 · 차문: 전부 같은 doorProgress로 움직이므로 좌/우 두 덩어리로 합친다.
      //    개별로 두면 이 둘만으로 드로우 콜 96개다.
      if (/^Z5_psd_door_/.test(m.name) || /^TR_door_|^TR_dwin_/.test(m.name)) {
        const x = worldX(m)
        const side = x >= nearestDoor(x) ? 'right' : 'left'
        ;(/^Z5_psd_door_/.test(m.name) ? psdGeo : trainGeo)[side].push(bakeGeo(m))
        dynamicCount++
        continue
      }

      const node = new Mesh(bakeGeo(m), m.material as Material)
      node.name = m.name
      group.add(node)
      dynamicCount++

      const flapM = /^Z3_GATE_G(\d)_([NS])_flap$/.exec(m.name)
      if (flapM) {
        node.material = toonMat(0xd7dce1)
        flaps.push({ gate: Number(flapM[1]), node, home: node.position.z, dir: flapM[2] === 'N' ? -1 : 1 })
        continue
      }
      const signM = /^Z3_sign_G(\d)_face$/.exec(m.name)
      if (signM) {
        signs.push({ gate: Number(signM[1]), mat: matOf(node) })
        signAnchors.set(Number(signM[1]), new Box3().setFromObject(node).getCenter(new Vector3()))
        continue
      }
      if (/^Z3_GATE_G(\d)_floorlamp$/.test(m.name) || matName === 'LED_RED' || matName === 'LED_GREEN') {
        const g = /G(\d)/.exec(m.name)
        if (g) lamps.push({ gate: Number(g[1]), mat: matOf(node) })
        continue
      }
      if (matName === 'TL_RED') tlRed = matOf(node)
      else if (matName === 'TL_GRN') tlGreen = matOf(node)
      else if (matName === 'TL_COUNT') tlCount.push(node)
    }

    if (!isTrain) {
      root.add(group)
      zoneGroups.push({ group, box: new Box3().setFromObject(group) })
    }
  }

  const bank = (geos: { left: BufferGeometry[]; right: BufferGeometry[] }, color: number, parent: Group): DoorBank => {
    const one = (list: BufferGeometry[]): Mesh | null => {
      if (list.length === 0) return null
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (!g) return null
      const mesh = new Mesh(g, toonMat(color))
      mesh.frustumCulled = false
      parent.add(mesh)
      return mesh
    }
    return { left: one(geos.left), right: one(geos.right) }
  }

  // 안전문은 승강장에 고정, 차문은 열차와 함께 움직인다
  const z5 = zoneGroups.find((z) => z.group.name === 'station:Z5_PLATFORM')?.group ?? root
  const psdBank = bank(psdGeo, 0xc6ced4, z5)
  const trainBank = bank(trainGeo, 0x6f8797, trainGroup)
  root.add(trainGroup)
  mergedCount += 4

  // ── 색각 보조 기호 — GLB 사인 면 앞에 ▲ / ✕ 를 얹는다.
  //    색만으로 구분하면 이 게임의 유일한 판단 근거가 색각 이상 플레이어에게서 사라진다.
  //    막대 30장을 개별 메시로 두면 Z3에서만 드로우 콜 30개다 → 인스턴싱 2개로 묶는다.
  const ARROW_BARS = [[-0.17, 0.5], [0, 0.33], [0.15, 0.14]] as const
  const CROSS_BARS = [Math.PI / 4, -Math.PI / 4] as const
  const flatMat = (c: number): MeshBasicMaterial =>
    new MeshBasicMaterial({ color: new Color(c), toneMapped: false, side: DoubleSide })

  const gateOrder = GATES.filter((g) => signAnchors.has(g.id))
  const arrows = new InstancedMesh(new PlaneGeometry(1, 0.1), flatMat(PALETTE.line2),
    Math.max(1, gateOrder.length * ARROW_BARS.length))
  const crosses = new InstancedMesh(new PlaneGeometry(0.58, 0.1), flatMat(PALETTE.danger),
    Math.max(1, gateOrder.length * CROSS_BARS.length))
  arrows.frustumCulled = false
  crosses.frustumCulled = false
  const z3Group = zoneGroups.find((z) => z.group.name === 'station:Z3_GATES')?.group ?? root
  z3Group.add(arrows, crosses)
  mergedCount += 2

  const symMat = new Matrix4()
  const faceWest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const HIDE = new Vector3(0, 0, 0)

  const syncSymbols = (workingIds: readonly number[]): void => {
    gateOrder.forEach((g, i) => {
      const a = signAnchors.get(g.id) as Vector3
      const ok = workingIds.includes(g.id)
      ARROW_BARS.forEach(([dy, w], k) => {
        symMat.compose(
          new Vector3(a.x - 0.09, a.y + dy, a.z), faceWest,
          ok ? new Vector3(w, 1, 1) : HIDE,
        )
        arrows.setMatrixAt(i * ARROW_BARS.length + k, symMat)
      })
      CROSS_BARS.forEach((rot, k) => {
        const q = faceWest.clone().multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rot))
        symMat.compose(new Vector3(a.x - 0.09, a.y, a.z), q, ok ? HIDE : new Vector3(1, 1, 1))
        crosses.setMatrixAt(i * CROSS_BARS.length + k, symMat)
      })
    })
    arrows.instanceMatrix.needsUpdate = true
    crosses.instanceMatrix.needsUpdate = true
  }
  let lastWorking = ''

  const green = new Color(PALETTE.line2)
  const red = new Color(PALETTE.danger)
  const dark = new Color(0x1a1d22)

  return {
    root,
    stats: { merged: mergedCount, dynamic: dynamicCount },
    sync(s, dtSec, greenLight, lightRemainSec) {
      // ── 존 가시성: 안개 far 밖의 존은 그리지 않는다
      const p = new Vector3(s.player.pos.x, s.player.pos.z, -s.player.pos.y)
      for (const z of zoneGroups) z.group.visible = z.box.distanceToPoint(p) < VISIBLE_RANGE

      // ── 게이트 사인 · 램프 · 기호
      for (const sg of signs) sg.mat.color.copy(s.gates.workingIds.includes(sg.gate) ? green : red)
      for (const lp of lamps) lp.mat.color.copy(s.gates.workingIds.includes(lp.gate) ? green : red)
      const key = s.gates.workingIds.join(',')
      if (key !== lastWorking) { lastWorking = key; syncSymbols(s.gates.workingIds) }

      // ── 게이트 플랩
      for (const f of flaps) {
        const open = s.gates.passed || (s.gates.state === 'open' && s.gates.activeId === f.gate)
        const target = f.home + (open ? f.dir * 0.5 : 0)
        f.node.position.z += (target - f.node.position.z) * (1 - Math.exp(-dtSec / 0.09))
      }

      // ── 안전문 · 열차
      const slide = s.train.doorProgress * 0.78
      if (psdBank.left) psdBank.left.position.x = -slide
      if (psdBank.right) psdBank.right.position.x = slide

      const t = s.train
      trainGroup.visible = t.state !== 'incoming' && t.x < 300
      trainGroup.position.x = t.x - TRAIN.firstCarX
      if (trainBank.left) trainBank.left.position.x = -slide
      if (trainBank.right) trainBank.right.position.x = slide

      // ── 신호등
      if (tlRed) tlRed.color.copy(greenLight ? dark : red)
      if (tlGreen) tlGreen.color.copy(greenLight ? green : dark)
      const k = Math.max(0.05, Math.min(1, lightRemainSec / (greenLight ? 12 : 18)))
      for (const c of tlCount) c.scale.y = k
    },
  }
}

export const stationZoneCount = ZONE_FILES.length
export { worldZ }
