/**
 * 손에 든 물건 — **1인칭 뷰모델** (디렉터 지시 2026-08-07).
 *
 * ── 팔은 없다
 * 팔 뷰모델을 한 번 만들었다가 디렉터가 물렸다("이거 팔 맞아? 뭔가 기괴해"). 3등신 SD
 * 리그의 팔을 눈앞 30 cm 에 갖다 놓으면 비율이 무너져 **손이 아니라 뿔처럼 읽힌다.**
 * 그래서 여기서는 **물건만** 띄운다. 이 게임의 1인칭은 손이 아니라 도구를 보여 준다.
 *
 * ── 카메라의 자식이다
 * `camera.add(root)` 로 붙는다. 그래야 시선을 돌려도 물건이 화면에 붙어 있다.
 * ⚠ three 는 **씬 그래프에 없는 카메라의 자식을 렌더하지 않는다.** `main.ts` 가
 *   `scene.add(camera)` 를 해 줘야 한다 — 이걸 빼먹으면 아무 에러 없이 안 보인다.
 *
 * ── 왜 자체 발광을 얹는가
 * 역사 GLB 에 라이트맵이 있으면 런타임 간접광이 6% 로 깎인다(`main.ts setIndirect`).
 * 바닥 프롭은 거리가 있어 안개·바닥 반사에 묻히지만, 눈앞 40 cm 짜리는 그 감산을
 * 고스란히 맞아 **검은 실루엣**이 된다(`npc-rig.ts` 헤더의 할아버지와 같은 사고).
 * 재질 색을 그대로 emissive 로 얹어 존과 무관하게 읽히게 한다 — 색은 안 바꾼다.
 */

import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three'
import { itemDef } from '../data/items'
import { UMBRELLA } from '../data/tuning'
import type { GameState, ItemId } from '../state/types'
import { itemsSource } from './items-gltf'
import { PLACEHOLDER_ITEMS, placeholderFor } from './props'

/** 펼친 우산의 노드 이름 — 접힘/펼침이 **다른 메시**다 (`items.glb`) */
const UMBRELLA_OPEN_NODE = 'ITM09_UmbrellaOpen'

/**
 * 화면에서 차지할 크기(m) — 모델의 최대 변을 여기에 맞춘다.
 *
 * 배율을 상수로 박지 않고 **실측 후 역산**하는 이유: `items.glb` 의 아이템 원점·크기가
 * 품목마다 다르다(우산 0.34 m · 효자손 0.25 m · 양갱 0.10 m). 배율 하나를 공유하면
 * 양갱은 안 보이고 우산은 화면을 덮는다. 보이는 크기를 고정하는 쪽이 에셋 갱신에도 강하다.
 */
const FIT_M = 0.40
/** 펼친 우산만 별도 — 캔버스 지름이 이 값이 된다. 화면 위쪽을 덮되 정면은 남긴다 */
const FIT_OPEN_M = 0.86

/**
 * 카메라 로컬 배치. three 카메라는 **−z 가 정면**이다.
 * `near` 가 1인칭에서 0.08 이므로(`main.ts applyView`) z 는 그보다 확실히 멀어야 한다.
 */
type Pose = Readonly<{ pos: readonly [number, number, number]; rot: readonly [number, number, number] }>

/**
 * 접은 물건 — 오른손 자리.
 *
 * `rot.x`(피치)가 0이다 — **손잡이가 나(카메라)와 수직**이어야 한다는 디렉터 지시.
 * 피치를 주면 샤프트가 시선 방향(카메라 −z)으로 기울어 **깊이로 짧아져 보인다**
 * (원근 단축 · foreshortening) — 눈에는 그게 "아무렇게나 꽂힌 막대"로 읽힌다.
 * 피치를 0으로 두면 샤프트 전체가 화면 평면 위에 눕는다 = 시선과 정확히 수직 =
 * 전체 길이가 그대로 보인다. 화면 안에서의 기울기(대각선으로 보이는 것)는
 * 아래 `rot.z`(롤)만으로 만든다 — 이건 화면 평면 **안에서의** 회전이라 원근을 안 건드린다.
 */
const POSE_CLOSED: Pose = { pos: [0.36, -0.22, -0.55], rot: [0, 0.30, 0.28] }
/**
 * 펼친 우산 — **팔을 뻗어 정면으로 민다** (디렉터 스케치 2026-08-07: 캐릭터·팔·우산이
 * 일직선으로 대상을 향한다 — 비를 막는 자세가 아니라 방패/창처럼 찌르는 자세).
 *
 * 이전 두 자세(공중부양 → 손잡이 수직)는 **접힌 채 들고 있을 때**의 이야기였고
 * `POSE_CLOSED` 가 그 규칙을 그대로 쓴다. 펼친 우산은 용도가 다르다 — 인파를 훑는
 * 순간의 자세다(`systems/umbrella.ts`). 들고 다닐 때와 내지를 때가 같은 각도일 이유가 없다.
 *
 * ★ **축이 정반대로 뒤집힌다.** 손잡이~캔버스를 잇는 로컬 +Y 축을 이번엔 화면 평면이
 *   아니라 **카메라 정면(−Z)** 으로 보낸다 — `rot.x = −π/2` 가 정확히 그 회전이다
 *   (Y′ = (0, cosθ, sinθ), θ=−90° → (0,0,−1)). 완전히 −90° 를 주면 캔버스가 카메라를
 *   똑바로 보는 원반이 되어 돔의 굴곡이 사라지므로, **−1.28 rad(≈−73°)** 로 살짝만
 *   눕혀 갈빗살이 옆에서 보이는 돔 실루엣을 남긴다.
 *
 * `spinner.rotation.y`(회전 애니메이션, 아래 `sync`)의 축은 **노드 로컬 +Y 그대로**다 —
 * 이 자세에서 로컬 Y가 카메라 −Z 쪽을 향해도 "우산이 자기 살대 축으로 돈다"는 사실은
 * 안 바뀐다. 축을 다시 계산할 필요가 없다.
 *
 * 위치의 중심점(`pos`)은 물체의 **바운딩 중심**이다(빌드 시 `node.position.sub(center)`) —
 * 회전은 이 점을 축으로 돌 뿐 이 점 자체를 옮기지 않는다. 그래서 `pos` 는 회전과
 * 무관하게 "캔버스와 손잡이의 중간 지점을 화면 어디에 앉힐까"로 그대로 읽으면 된다.
 * 팔이 뻗어 나가는 만큼 중심을 이전보다 **화면 안쪽(x 작게) · 아래(y 더 낮게) · 가깝게
 * (z 더 큼)** 두어, 손잡이는 화면 아래에서 나오고 캔버스는 크로스헤어보다 조금 위에서
 * 앞을 겨눈다.
 */
const POSE_OPEN: Pose = { pos: [0.30, -0.18, -0.98], rot: [-1.28, -0.16, 0.22] }

export type Held = Readonly<{
  root: Group
  /** 매 프레임. `fp` 가 거짓이면(3인칭) 통째로 끈다 */
  sync(s: GameState, dtSec: number, fp: boolean): void
  dispose(): void
}>

/** 이 아이템의 지금 모습에 해당하는 노드 이름 — 우산만 상태에 따라 갈린다 */
const nodeNameFor = (item: ItemId, open: boolean): string =>
  item === 'I-09' && open ? UMBRELLA_OPEN_NODE : itemDef(item).node

type Entry = Readonly<{ holder: Group; spinner: Group }>

export const loadHeld = async (baseUrl: string): Promise<Held> => {
  const root = new Group()
  root.name = 'held'
  root.visible = false

  let source: Object3D
  try {
    source = await itemsSource(baseUrl)
  } catch (e) {
    // 손이 비어도 게임은 돈다 — 판정은 전부 `systems/` 에 있고 이건 그림이다
    console.error('[held] items.glb 로드 실패 — 손에 아무것도 안 보입니다', e)
    return { root, sync() {}, dispose() {} }
  }

  /** 노드 이름 → 만들어 둔 뷰모델. 같은 물건을 다시 들면 재사용한다 */
  const built = new Map<string, Entry>()
  const failed = new Set<string>()

  const build = (item: ItemId, nodeName: string, open: boolean): Entry | null => {
    const found = source.getObjectByName(nodeName)
    if (!found && !PLACEHOLDER_ITEMS.has(item)) {
      console.error(`[held] items.glb 에 ${nodeName} 노드가 없다`)
      return null
    }
    const node = (found ?? placeholderFor(item)).clone(true)

    /**
     * ⚠ `clone()` 은 **머티리얼을 공유한다.** 여기서 emissive 를 얹으면 바닥에 놓인
     * 같은 아이템까지 빛난다 → 반드시 복제하고 만진다 (`props.ts` backlit 과 같은 사고).
     */
    node.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh || Array.isArray(m.material)) return
      const src = m.material as MeshStandardMaterial
      const lit = src.clone()
      lit.emissive = new Color(src.color?.getHex() ?? 0xffffff)
      lit.emissiveIntensity = 0.42
      m.material = lit
      // 눈앞 40 cm 짜리는 T-포즈 바운딩이 없어도 컬링이 어긋나기 쉽다 — 그냥 끈다
      m.frustumCulled = false
    })

    // 원점을 **바운딩 중심**으로 옮긴다. 아이템마다 원점 규약이 달라(우산은 샤프트 중간,
    // 효자손은 밑면) 그대로 두면 같은 자리에 놓아도 화면에서 제각각 어긋난다.
    const box = new Box3().setFromObject(node)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const longest = Math.max(size.x, size.y, size.z) || 1
    const k = (open ? FIT_OPEN_M : FIT_M) / longest
    node.position.sub(center)

    const spinner = new Group()
    spinner.name = `held-spin:${nodeName}`
    spinner.add(node)
    spinner.scale.setScalar(k)

    const pose = open ? POSE_OPEN : POSE_CLOSED
    const holder = new Group()
    holder.name = `held:${nodeName}`
    holder.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
    holder.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2])
    holder.add(spinner)
    holder.visible = false
    root.add(holder)
    return { holder, spinner }
  }

  const entryFor = (item: ItemId, open: boolean): Entry | null => {
    const nodeName = nodeNameFor(item, open)
    if (failed.has(nodeName)) return null
    const hit = built.get(nodeName)
    if (hit) return hit
    const made = build(item, nodeName, open)
    if (!made) { failed.add(nodeName); return null }
    built.set(nodeName, made)
    return made
  }

  /** 지금 켜져 있는 것. 하나뿐이다 — 드로우 콜은 손에 든 물건 하나 몫만 낸다 */
  let active: Entry | null = null
  let spin = 0

  return {
    root,

    sync(s, dtSec, fp) {
      const item = s.hand.item
      const show = fp && item !== null && s.phase !== 'title'
      root.visible = show
      if (!show || item === null) {
        if (active) { active.holder.visible = false; active = null }
        return
      }

      const open = item === 'I-09' && s.hand.open
      const next = entryFor(item, open)
      if (next !== active) {
        if (active) active.holder.visible = false
        if (next) next.holder.visible = true
        active = next
        // 물건이 바뀌면 회전을 0으로 되돌린다 — 접었다 펴면 처음부터 돈다
        spin = 0
      }
      if (!active) return

      /**
       * 회전은 **펼친 우산일 때만.** 접힌 우산이 돌면 손에서 미끄러지는 것처럼 보인다.
       * 축은 노드 로컬 +Y(샤프트) 다 — `items.glb` 의 우산이 그 방향으로 서 있다.
       */
      if (open) {
        spin = (spin + UMBRELLA.spinRate * dtSec) % (Math.PI * 2)
        active.spinner.rotation.y = spin
      } else if (active.spinner.rotation.y !== 0) {
        active.spinner.rotation.y = 0
      }
    },

    dispose() {
      root.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh) return
        // 지오메트리는 GLB 원본과 공유한다(clone 은 얕다) — 여기서 놓으면 프롭이 사라진다.
        // 머티리얼만 이 모듈이 복제해 만든 것이라 이쪽만 놓는다.
        if (!Array.isArray(m.material)) m.material.dispose()
      })
      root.clear()
      built.clear()
      active = null
    },
  }
}
