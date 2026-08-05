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

import { Box3, Group, Mesh, type BufferGeometry, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { INTERACTABLES } from '../data/interactables'
import { itemDef } from '../data/items'
import { PALETTE } from '../data/tuning'
import type { GameState, ItemId } from '../state/types'
import { outlineMat } from './toon'

/** 아이템 실물은 5~30 cm 다. 1.6 m 눈높이에서 "저기 뭐가 있다"로 읽히려면 키워야 한다. */
const SCALE = 1.6
/** 정면·측면 둘 다 실루엣이 남는 각. 우산은 정면에서 보면 막대 하나로만 읽힌다. */
const YAW = -Math.PI / 5

/** 두께 — P1-TECH-PLAN §3.1. 머티리얼을 바꾸지 않고 유니폼만 쓴다. */
const TH_NEAR = 0.045
const TH_AIMED = 0.068
const TH_DENY = 0.10
/** "은은한 펄스"(GDD §5.1) — 조준 전에만. 1.6 s 주기 ±15 %. 이보다 크면 깜빡임이 된다. */
const PULSE_SEC = 1.6
const PULSE_AMP = 0.15

type Prop = Readonly<{
  holder: Group
  /** 병합된 역폴리곤 셸. 지오메트리 머지가 실패하면 null (프롭은 그대로 보인다) */
  shell: Mesh | null
  /** `state.drops` 에서 온 프롭인가 — 가시성 규칙이 갈린다 */
  drop: boolean
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
    const gltf = await new GLTFLoader().loadAsync(`${baseUrl}models/items.glb`)
    source = gltf.scene
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
  const makeProp = (item: ItemId, x: number, y: number, z: number, drop: boolean): Prop | null => {
    let nodeName: string
    try {
      nodeName = itemDef(item).node
    } catch (e) {
      console.error(`[props] 아이템 정의 없음: ${item}`, e)
      return null
    }
    const tpl = source.getObjectByName(nodeName)
    if (!tpl) {
      console.error(`[props] items.glb 에 ${nodeName} 노드가 없다`)
      return null
    }

    const node = tpl.clone(true)
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

    pivot.scale.setScalar(SCALE)
    pivot.rotation.y = YAW
    // pivot 은 아직 부모가 없다 → matrixWorld = 자기 로컬. 박스가 holder 좌표계로 나온다.
    pivot.updateMatrixWorld(true)
    const box = new Box3().setFromObject(node)
    pivot.position.y = -box.min.y

    const holder = new Group()
    holder.name = `prop:${item}`
    holder.position.set(x, z, -y)
    holder.add(pivot)
    // 프러스텀 컬링은 기본값 그대로 둔다 — 작고 몇 개뿐이라 계산이 아깝지 않다
    return { holder, shell, drop }
  }

  const ensure = (id: string, item: ItemId, x: number, y: number, z: number, drop: boolean): void => {
    if (props.has(id) || skipped.has(id)) return
    const p = makeProp(item, x, y, z, drop)
    if (!p) { skipped.add(id); return }
    props.set(id, p)
    root.add(p.holder)
  }

  // 고정 습득물 — `gives` 가 있는 `pickup` 항목만. 좌표를 여기서 새로 만들지 않는다.
  for (const e of INTERACTABLES) {
    if (e.kind !== 'pickup' || !e.gives) continue
    ensure(e.id, e.gives, e.x, e.y, e.z, false)
  }

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

      for (const [id, p] of props) {
        // 습득·성공한 대상은 사라진다. 낙하물은 배열에서 빠지는 것이 곧 소멸이다.
        p.holder.visible = p.drop ? liveDrops.has(id) : !s.act.consumed.includes(id)
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
