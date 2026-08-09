/**
 * 아이템 프롭 + 골드 상호작용 아웃라인 — `items.glb`.
 *
 * ── 왜 station 로더를 안 타는가
 * `station.ts` 의 `collect()`/`bakeGeo()` 는 `geo.deleteAttribute('uv')` 를 한다.
 * ITM 계열은 이 리포에서 **유일하게 텍스처(`itm13_routemap`)가 붙은 익스포트**라
 * UV 를 지우면 노선도 글자가 사라진다. 그래서 별도 모듈이고, `gltf.scene` 의 머티리얼을
 * **그대로 쓴다** — 우산 그립/샤프트/천, 마스크 천/안감/끈처럼 **아이템 판독이
 * 머티리얼에 실려 있다.** `toonMat` 하나로 덮으면 전부 흰 덩어리가 된다.
 *
 * ── 아웃라인
 * 색은 종류·조건·결과와 무관하게 **골드 단일**이다 (GDD §5.1). 분기 코드를 넣지 않는다.
 * 후처리(EffectComposer/OutlinePass)는 안 쓴다 — 이유는 `glow.ts` 헤더에 실측으로 적혀
 * 있다(톤매핑 경로가 바뀌면 사인 색이 변한다 · 깊이 공유 불가). `toon.ts` 의
 * `outlineMat` = BackSide 역폴리곤 셸을 재사용한다.
 */

import { Box3, BoxGeometry, Color, Group, Material, Mesh, MeshStandardMaterial,
  type BufferGeometry, type Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { itemsSource } from './items-gltf'
import { INTERACTABLES } from '../data/interactables'
import { DECOR } from '../data/decor'
import { itemDef } from '../data/items'
import { PALETTE } from '../data/tuning'
import type { GameState, ItemId } from '../state/types'
import { outlineMat } from './toon'

/** 아이템 실물은 5~30 cm 다. 1.6 m 눈높이에서 "저기 뭐가 있다"로 읽히려면 키워야 한다. */
const SCALE = 1.6
/**
 * 프롭 가시 거리(m) — 이보다 멀면 그리지 않는다. 아래 `sync` 의 거리 컬링 주석 참고.
 * 상호작용 사거리(3m)의 8배 이상으로 둔다: **보이는 것과 잡히는 것이 갈라지면 안 된다.**
 */
const VISIBLE_M = 26
/**
 * 작은 것은 더 일찍 지운다. 동전은 실지름 7.4cm(SCALE 적용 후) 라 12m 밖에서
 * **1~2 픽셀**이다 — 그리는 값(드로우 콜 1)이 보이는 값보다 크다.
 */
const VISIBLE_M_SMALL = 12
const SMALL_ITEMS: ReadonlySet<ItemId> = new Set<ItemId>(['I-02'])
/** 정면·측면 둘 다 실루엣이 남는 각. 우산은 정면에서 보면 막대 하나로만 읽힌다. */
const YAW = -Math.PI / 5

/** 두께 — P1-TECH-PLAN §3.1. 머티리얼을 바꾸지 않고 유니폼만 쓴다. */
const TH_NEAR = 0.045
const TH_AIMED = 0.068
const TH_DENY = 0.10
/** "은은한 펄스"(GDD §5.1) — 조준 전에만. 1.6 s 주기 ±15 %. 이보다 크면 깜빡임이 된다. */
const PULSE_SEC = 1.6
const PULSE_AMP = 0.15

/**
 * P2 신규 5종은 **전용 메시가 없다** — `docs/P2-SPEC.md` §10 이 P3로 미룬 항목이다.
 * 없는 노드를 조용히 넘기면 화면에 아무것도 안 서고, `console.error` 로 알리면
 * E2E 의 "콘솔 에러 0건" 어서션이 깨진다. **의도된 부재는 자리표시자로 그린다.**
 *
 * 여기 없는 id 가 노드를 못 찾으면 그건 여전히 에러다(에셋 갱신 사고 감지선).
 * I-02(동전)는 `items_build.py ITM02_Coin` 으로, I-05(이어폰)는 `ITM05_Earbuds` 로
 * 실제 메시가 생겨 여기서 빠졌다.
 */
export const PLACEHOLDER_ITEMS: ReadonlySet<ItemId> =
  new Set<ItemId>(['I-07', 'I-08', 'I-11'])

/** 아이템별 자리표시자 색 — 실루엣만으로 구분되게. 전부 회색이면 뭘 주웠는지 모른다 */
const PLACEHOLDER_LOOK: Readonly<Partial<Record<ItemId, { c: number; w: number; h: number; d: number }>>> = {
  'I-07': { c: 0x6b4a34, w: 0.09, h: 0.20, d: 0.09 },   // 텀블러
  'I-08': { c: 0xe8e4d8, w: 0.26, h: 0.04, d: 0.19 },   // 접힌 신문
  'I-11': { c: 0x8a3b2f, w: 0.12, h: 0.09, d: 0.03 },   // 지갑
}

const placeholderCache = new Map<ItemId, Object3D>()

/** 메시가 없는 아이템의 자리표시자. 손에 든 물건(`held.ts`)도 같은 것을 쓴다 */
export const placeholderFor = (item: ItemId): Object3D => {
  const hit = placeholderCache.get(item)
  if (hit) return hit
  const look = PLACEHOLDER_LOOK[item] ?? { c: 0x9aa0a6, w: 0.14, h: 0.14, d: 0.14 }
  const mesh = new Mesh(
    new BoxGeometry(look.w, look.h, look.d),
    new MeshStandardMaterial({ color: look.c, roughness: 0.7, metalness: 0.05 }),
  )
  mesh.name = `placeholder:${item}`
  // 밑면을 y=0 으로 — makeProp 이 박스 min.y 로 접지시키므로 원점 규약을 맞춰 둔다
  mesh.position.y = look.h / 2
  placeholderCache.set(item, mesh)
  return mesh
}

type Prop = Readonly<{
  holder: Group
  /** 이 프롭의 가시 거리(m) — 크기에 따라 다르다 */
  visibleM: number
  /** 병합된 역폴리곤 셸. 지오메트리 머지가 실패하면 null (프롭은 그대로 보인다) */
  shell: Mesh | null
  /** `state.drops` 에서 온 프롭인가 — 가시성 규칙이 갈린다 */
  drop: boolean
}>

/**
 * 프롭 하나를 세우는 방법 — 위치를 뺀 나머지. 위치는 항상 표에서 오고,
 * 이쪽은 **표마다 있을 수도 없을 수도 있는** 값이라 선택 필드로 묶었다.
 */
type PropOpts = Readonly<{
  /** 세우는 방향(rad). 없으면 기본 각 `YAW` */
  yaw?: number | undefined
  /** 눕히거나 뒤집는 각(rad, 모델 로컬 X축). 없으면 0 */
  pitch?: number | undefined
  /** 배율(기본 1) */
  scale?: number | undefined
  /** 자체 발광 — 벽 게시물 전용 */
  backlit?: boolean | undefined
}>

export type Props = Readonly<{
  root: Group
  /** 매 프레임. state.act.targetId / aimed 를 읽어 아웃라인을 갱신한다 */
  sync(s: GameState, dtSec: number, nowSec: number): void
  dispose(): void
}>

/**
 * 셸 지오메트리 — 프롭 하나를 **한 덩어리로 병합**한다.
 *
 * ITM 노드는 프리미티브가 여럿이다(우산 7 · 마스크 3). 메시마다 셸을 달면 타겟 하나에
 * 드로우 콜이 7개 붙는데, 이 맵은 Z2 지점에서 이미 215콜(예산 230)이라 여유가 없다.
 * 병합하면 **타겟당 +1** 로 끝난다.
 *
 * ⚠ `mergeGeometries` 는 애트리뷰트 집합이 어긋나면 **null 을 반환한다**
 * (`contact-shadows.ts:18` 에 같은 사고가 기록돼 있다). ITM01 만 uv 가 있으므로
 * 셸 셰이더가 쓰는 position·normal 만 남기고 지운다 — 원본 지오메트리는 clone 이라 무사하다.
 */
const shellGeometry = (node: Object3D): BufferGeometry | null => {
  const parts: BufferGeometry[] = []
  node.updateWorldMatrix(false, true)
  node.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const g = m.geometry.clone()
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    }
    // 노드 로컬 공간으로 굽는다 — 셸 메시는 pivot 아래 무변환으로 들어간다
    g.applyMatrix4(m.matrixWorld)
    parts.push(g)
  })
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0] ?? null
  return mergeGeometries(parts, false)
}

export const loadProps = async (baseUrl: string): Promise<Props> => {
  const root = new Group()
  root.name = 'props'

  // 셸 머티리얼은 **하나를 공유한다.** 동시에 켜지는 셸이 1개뿐이므로(아래 sync 참고)
  // 유니폼 한 번 쓰면 그게 곧 현재 타겟의 두께다.
  const ink = outlineMat(TH_NEAR, PALETTE.gold)

  let source: Object3D
  try {
    // 원본은 `render/items-gltf.ts` 가 캐시한다 — 손에 든 물건(`held.ts`)과 공유한다
    source = await itemsSource(baseUrl)
  } catch (e) {
    // 프롭이 없어도 게임은 돈다 — 습득 판정은 `data/interactables.ts` 테이블이 하고
    // 렌더는 그 결과를 그릴 뿐이다 (`main.ts:220` 의 station 폴백과 같은 태도).
    console.error('[props] items.glb 로드 실패 — 프롭 없이 진행합니다', e)
    return { root, sync() {}, dispose() { ink.dispose() } }
  }

  const props = new Map<string, Prop>()
  /** 만들다 실패한 id — 매 프레임 재시도해서 콘솔을 채우지 않게 기억한다 */
  const skipped = new Set<string>()

  /**
   * 프롭 하나. 월드(x 동 · y 북 · z 상) → three `(x, z, -y)` 변환은
   * `player-rig.ts:117` 규약 그대로다.
   *
   * 높이는 **재지 않고 계산한다.** GLB 원점이 아이템마다 다르다 —
   * `ITM09_Umbrella` 는 샤프트 중간(y −0.051~0.287)이고 `ITM06_Mask` 는 중심,
   * `ITM01_Backscratcher` 는 밑면이 y=0 이다. 품목별 상수를 박으면 에셋이 갱신될 때 어긋난다.
   */
  const makeProp = (
    item: ItemId, x: number, y: number, z: number, drop: boolean, o: PropOpts = {},
  ): Prop | null => {
    const { yaw = YAW, pitch = 0, scale = 1, backlit = false } = o
    let nodeName: string
    try {
      nodeName = itemDef(item).node
    } catch (e) {
      console.error(`[props] 아이템 정의 없음: ${item}`, e)
      return null
    }
    const found = source.getObjectByName(nodeName)
    if (!found && !PLACEHOLDER_ITEMS.has(item)) {
      // 정말로 없는 것 — 진단을 남긴다. 아래 자리표시자와 구분되어야 한다
      console.error(`[props] items.glb 에 ${nodeName} 노드가 없다`)
      return null
    }
    const tpl = found ?? placeholderFor(item)

    const node = tpl.clone(true)
    /**
     * 눕히기·뒤집기는 **셸을 굽기 전에** 준다. 셸 지오메트리는 이 시점의 노드 월드
     * 행렬을 그대로 굽기 때문에(`shellGeometry`), 뒤에 회전하면 아웃라인만 제자리에 남는다.
     */
    node.rotation.x = pitch
    /**
     * 백라이트 게시물 — 인쇄면을 **자기 텍스처로** 밝힌다.
     *
     * ⚠ `Object3D.clone()` 은 머티리얼을 **공유**한다. 여기서 원본을 만지면 인벤토리
     *   글리프부터 낙하물까지 같은 아이템 전부가 빛난다 → 반드시 복제하고 만진다.
     */
    if (backlit) {
      node.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh || Array.isArray(m.material)) return
        const mat = m.material as MeshStandardMaterial
        if (!mat.map) return
        const lit = mat.clone()
        lit.emissive = new Color(0xffffff)
        lit.emissiveMap = lit.map
        lit.emissiveIntensity = 1
        m.material = lit
      })
    }
    // 셸은 pivot 변환이 걸리기 **전에** 굽는다 — 뒤에 구우면 스케일이 두 번 먹는다
    const geo = shellGeometry(node)

    const pivot = new Group()
    pivot.add(node)

    let shell: Mesh | null = null
    if (geo) {
      shell = new Mesh(geo, ink)
      shell.name = `outline:${item}`
      // 아웃라인 셸은 법선 방향으로 부푼 복제본이다. 카메라 차폐 레이캐스트와
      // E2E `pick()` 훅이 이걸 먼저 맞으면 실물보다 앞에서 걸린다 (`world-builder.ts:94`).
      shell.raycast = () => {}
      shell.renderOrder = -1
      shell.visible = false
      pivot.add(shell)
    } else {
      console.error(`[props] ${nodeName} 셸 지오메트리 병합 실패 — 아웃라인 없이 그린다`)
    }

    pivot.scale.setScalar(SCALE * scale)
    pivot.rotation.y = yaw
    // pivot 은 아직 부모가 없다 → matrixWorld = 자기 로컬. 박스가 holder 좌표계로 나온다.
    pivot.updateMatrixWorld(true)
    const box = new Box3().setFromObject(node)
    pivot.position.y = -box.min.y

    const holder = new Group()
    holder.name = `prop:${item}`
    holder.position.set(x, z, -y)
    holder.add(pivot)
    // 프러스텀 컬링은 기본값 그대로 둔다 — 작고 몇 개뿐이라 계산이 아깝지 않다
    return { holder, shell, drop, visibleM: SMALL_ITEMS.has(item) ? VISIBLE_M_SMALL : VISIBLE_M }
  }

  const ensure = (
    id: string, item: ItemId, x: number, y: number, z: number, drop: boolean, o: PropOpts = {},
  ): void => {
    if (props.has(id) || skipped.has(id)) return
    const p = makeProp(item, x, y, z, drop, o)
    if (!p) { skipped.add(id); return }
    props.set(id, p)
    root.add(p.holder)
  }

  // 고정 습득물 — `gives` 가 있는 `pickup` 항목만. 좌표를 여기서 새로 만들지 않는다.
  for (const e of INTERACTABLES) {
    if (e.kind !== 'pickup' || !e.gives) continue
    ensure(e.id, e.gives, e.x, e.y, e.z, false, {
      yaw: e.faceYaw, pitch: e.propPitch, scale: e.propScale, backlit: e.backlit,
    })
  }

  /**
   * 장식 소품 — 우산꽂이에 꽂힌 우산들 (`data/decor.ts`).
   *
   * ★ **머티리얼별로 한 덩어리로 병합한다.** 프롭 하나씩 세웠더니 Z2 핫스팟 드로우 콜이
   *   240 → 268 로 뛰었다(감지선 245). 우산 한 자루가 프리미티브 7개라 4자루면 +28 이다.
   *   병합하면 자루 수와 무관하게 **머티리얼 수(7)** 로 고정된다.
   *
   * 아웃라인 셸도, `consumed` 판정도 없다 — 주울 수 없는 물건이라 둘 다 의미가 없다.
   */
  const decorRoot = new Group()
  decorRoot.name = 'decor'
  const decorBuckets = new Map<Material, BufferGeometry[]>()
  for (const d of DECOR) {
    let tpl: Object3D | undefined
    try {
      tpl = source.getObjectByName(itemDef(d.item).node)
    } catch { tpl = undefined }
    if (!tpl) { console.error(`[props] 장식 ${d.id} 의 메시가 없다`); continue }

    const node = tpl.clone(true)
    node.rotation.x = d.pitch ?? 0
    const pivot = new Group()
    pivot.add(node)
    pivot.scale.setScalar(SCALE)
    pivot.rotation.y = d.yaw
    pivot.updateMatrixWorld(true)
    // 밑면을 `d.z` 에 맞춘다 — 습득 프롭과 같은 접지 규약(품목별 상수를 안 박는다)
    const box = new Box3().setFromObject(node)
    pivot.position.set(d.x, d.z - box.min.y, -d.y)
    pivot.updateMatrixWorld(true)

    node.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh || Array.isArray(m.material)) return
      const geo = m.geometry.clone()
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
      }
      geo.applyMatrix4(m.matrixWorld)
      const list = decorBuckets.get(m.material) ?? []
      list.push(geo)
      decorBuckets.set(m.material, list)
    })
  }
  for (const [mat, geos] of decorBuckets) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
    // 병합 실패(애트리뷰트 불일치)는 장식 하나를 잃을 뿐이다 — 게임은 그대로 돈다
    if (!merged) { console.error('[props] 장식 병합 실패 — 해당 재질을 건너뛴다'); continue }
    decorRoot.add(new Mesh(merged, mat))
  }
  if (decorRoot.children.length > 0) root.add(decorRoot)

  /**
   * 장식 컬링 거리 — 습득물(26 m)보다 **짧다.**
   *
   * 병합으로 4자루가 7콜이 됐지만 그래도 7콜이다. Z2 핫스팟 실측이 240 → 247 (감지선 245)
   * 이라 그 자리에서는 꺼야 한다. 우산꽂이는 15.6 m 밖이고 거기서 우산은 픽셀 몇 개다.
   * 습득 판정(3 m)과는 무관하다 — **보이는 것과 잡히는 것이 갈라지지 않는다**(12 ≫ 3).
   */
  const DECOR_VISIBLE_M = 12

  /** 장식 무리의 중심 — 통째로 켜고 끄는 거리 판정 기준 */
  const decorCenter = DECOR.length > 0
    ? {
        x: DECOR.reduce((a, d) => a + d.x, 0) / DECOR.length,
        y: DECOR.reduce((a, d) => a + d.y, 0) / DECOR.length,
      }
    : { x: 0, y: 0 }

  /** 지금 켜져 있는 셸. 켜지는 건 항상 최대 1개다 (드로우 콜 +1 상한) */
  let active: Mesh | null = null
  const liveDrops = new Set<string>()

  return {
    root,

    sync(s, dtSec, nowSec) {
      // 두께는 상태의 순수 함수다 — 시간 적분이 없으므로 dt 를 쓰지 않는다
      void dtSec

      // 낙하 아이템은 런타임에 생긴다(슬롯 교체). 상태가 진실이고 프롭은 따라간다.
      liveDrops.clear()
      for (const d of s.drops) {
        ensure(d.id, d.item, d.x, d.y, d.z, true)
        liveDrops.add(d.id)
      }

      const px = s.player.pos.x
      const py = s.player.pos.y
      // 장식도 같은 거리 컬링을 받는다 — 예산을 먹는 건 똑같다
      decorRoot.visible = Math.hypot(decorCenter.x - px, decorCenter.y - py) < DECOR_VISIBLE_M
      for (const [id, p] of props) {
        // 습득·성공한 대상은 사라진다. 낙하물은 배열에서 빠지는 것이 곧 소멸이다.
        const alive = p.drop ? liveDrops.has(id) : !s.act.consumed.includes(id)
        /**
         * **거리 컬링** (P2). 아이템이 4종에서 20개(습득물 14 + 동전 6)로 늘면서
         * Z2 핫스팟 드로우 콜이 예산(235)을 넘었다 — 실측 240.
         *
         * 프러스텀 컬링만으로는 안 줄어든다. 이것들은 실제로 **화면 안에 있고**,
         * 5~30cm 짜리라 26m 밖에서는 픽셀 몇 개다. 즉 그리고 있어도 안 보인다.
         * 판정(`systems/interact.ts`)은 3m 사거리라 이 값과 무관하다 —
         * **보이는 것과 잡히는 것이 갈라지지 않는다**(컬링 거리 ≫ 사거리).
         */
        const near = Math.hypot(p.holder.position.x - px, -p.holder.position.z - py) < p.visibleM
        p.holder.visible = alive && near
      }

      const act = s.act
      const target = act.targetId ? props.get(act.targetId) ?? null : null
      const next = target && target.holder.visible ? target.shell : null
      if (next !== active) {
        if (active) active.visible = false
        if (next) next.visible = true
        active = next
      }
      if (!next) return

      const u = ink.uniforms.uThickness
      if (!u) return
      if (act.denyMs > 0) u.value = TH_DENY
      else if (act.aimed) u.value = TH_AIMED
      else u.value = TH_NEAR * (1 + PULSE_AMP * Math.sin((nowSec / PULSE_SEC) * Math.PI * 2))
    },

    dispose() {
      // items.glb 는 이 모듈만 쓴다 — 원본 지오메트리까지 놓아도 남의 것을 건드리지 않는다
      root.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) m.geometry.dispose()
      })
      root.clear()
      props.clear()
      skipped.clear()
      active = null
      ink.dispose()
    },
  }
}
