/**
 * NPC 리그 — `player-rig.ts` 를 일반화한 것이다.
 *
 * 플레이어 리그와 갈라져 있는 이유는 두 가지다.
 *  · 클립 이름이 GLB 마다 다르다 (`GP_*` / `CP_*` / `AJ_*`). 유니온 타입으로 묶으면
 *    캐릭터가 하나 늘 때마다 타입을 고쳐야 해서, 여기서는 그냥 문자열로 받고
 *    없는 클립이면 조용히 무시한다 — 에셋이 먼저 가고 코드가 따라오는 순서를 지킨다.
 *  · 애니 선택 규칙이 캐릭터마다 다르다. 그래서 이 파일은 **규칙을 담지 않는다**.
 *    "무엇을 재생할지"는 `actors.ts` 가 게임 상태를 보고 정한다.
 *
 * 재질은 **툰으로 갈아끼우되 색은 GLB 것을 그대로 옮긴다.** 플레이어처럼 한 색으로
 * 덮으면(1인칭이라 애초에 안 보인다) NPC 의 캐릭터 독해가 사라진다 — 그 독해는 이름 있는
 * 재질(`GP_Hat` · `GP_Lens` · `GP_Beard` · `PR_Bamboo` · `CP_Pillow` …)에 실려 있다.
 * 반대로 GLB 재질을 그대로 두면 지하에서 검게 나온다(아래 `toonFor` 주석 참고).
 */

import {
  AnimationMixer, CircleGeometry, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial,
  type AnimationAction, type AnimationClip, type Color, type Material, type MeshToonMaterial,
  type Object3D,
} from 'three'
import { PALETTE } from '../data/tuning'
import { toonMat } from './toon'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

/** 플레이어 리그와 같은 값 — 같은 사람이 같은 씬에서 섞이면 페이드 길이가 같아야 한다 */
const CROSSFADE = 0.18

export type NpcRig = Readonly<{
  root: Group
  /** 월드 좌표 (x 동, y 북, z 상) + 바라보는 방향(rad, +x 기준 CCW) */
  place(x: number, y: number, z: number, facing: number): void
  /** 클립 재생. oneShot 이면 LoopOnce + clampWhenFinished */
  play(clip: string, oneShot?: boolean): void
  /** 지금 재생 중인 클립 이름 */
  current(): string | null
  update(dtSec: number): void
  setVisible(on: boolean): void
  /** 프롭 서브메시 show/hide — 이름 접두어로 찾는다 (예: 'PR_Danso') */
  setProp(namePrefix: string, on: boolean): void
  /**
   * 프롭을 **다른 본 밑으로 옮겨 붙인다** — 붙인 자리의 로컬 TRS까지 지정한다.
   *
   * 에셋이 프롭을 잘못된 본에 물고 있고 애니가 그 본을 안 움직일 때의 탈출구다
   * (GP 단소: `Prop.Chest` 에 붙어 있는데 `GP_Draw`·`GP_Swing` 어느 클립도 그 본에
   * 키가 없다 — 실측 2프레임 상수). 리그를 다시 익스포트하는 대신 런타임에 옮긴다.
   *
   * 멱등이다 — 이미 그 부모면 붙이는 일은 건너뛰고 TRS만 다시 쓴다.
   */
  attachProp(namePrefix: string, parentName: string, local: PropPose): void
  dispose(): void
}>

/** 본에 붙일 때 쓰는 로컬 TRS. `scale` 은 생략하면 건드리지 않는다 */
export type PropPose = Readonly<{
  pos: readonly [number, number, number]
  /** 쿼터니언 (x, y, z, w) */
  quat: readonly [number, number, number, number]
  scale?: number
}>

export const loadNpcRig = async (
  url: string,
  opts?: {
    tint?: Readonly<Record<string, number>>
    scale?: number
    /**
     * 모델 전방축 보정(rad).
     *
     * `place()` 의 공식(`rotation.y = facing + π/2`)은 **모델 전방 = 로컬 +z** 를 가정한다.
     * 리그가 그렇지 않게 익스포트됐으면 여기서 한 번 돌린다.
     *
     * ⚠ 예전에 GP 에 π 를 준 것은 **공식의 반사 버그를 가리던 보정**이었다.
     * 공식을 고친 뒤 실측하니 이 리포의 리그는 **전부 +z 전방**이라 보정이 0 이다.
     */
    yawOffset?: number
  },
): Promise<NpcRig> => {
  const gltf = await new GLTFLoader().loadAsync(url)
  // 스켈레톤까지 같이 복제한다. 같은 GLB 로 두 명을 세울 여지를 남기려는 것이다
  // (AJ 아주머니 2인조가 그 경우다) — 얕은 복제는 본을 공유해 둘이 같이 움직인다.
  const model = cloneSkinned(gltf.scene as Object3D) as Object3D

  const root = new Group()
  root.name = `npc:${url.split('/').pop() ?? url}`
  root.add(model)

  /**
   * 캐릭터 스케일 — **에셋이 실척 맵보다 작게 만들어져 있다.**
   *
   * GLB 실측(바인드 포즈 바운딩): MC·CP 0.92m · GP 0.84m. 맵은 실척이다(문 1.9m ·
   * 벽 3.2m · 벤치 0.9m). 그대로 올리면 사람이 **인형**으로 읽힌다 — 실제로 그렇게
   * 보였다(벤치 등받이보다 머리가 낮았다).
   * 배율은 `actors.ts` 가 한 상수로 준다 — 캐릭터마다 다르게 주면 작가가 의도한
   * 상대 신장(할아버지가 MC보다 9% 작다)이 깨진다.
   */
  if (opts?.scale !== undefined) model.scale.setScalar(opts.scale)
  const yawOffset = opts?.yawOffset ?? 0

  /**
   * 재질을 **툰으로 갈아끼운다 — 단, 색은 GLB 가 들고 온 것을 쓴다.**
   *
   * ⚠ 처음엔 GLB 재질을 그대로 뒀다. 지하에서 할아버지가 **거의 검은 실루엣**으로 나왔다
   *   (스크린샷 확대로 확인). 원인은 재질이 아니라 조명 예산이다: 역사 GLB 에 라이트맵이
   *   있으면 `main.ts` 가 `setIndirect(0.06)` 으로 런타임 간접광을 6% 로 깎는다
   *   (이중 계산 방지 · P0 §11). 라이트맵이 없는 NPC 만 그 감산을 고스란히 맞는다.
   *
   *   그래서 게임의 나머지가 쓰는 것과 **같은 툰 램프**로 바꾼다 — 램프는 방향광
   *   (`sun`·`fluor`)을 읽고, 그 둘은 간접광 감산에서 살아남는다.
   *   색을 추측하지 않고 원본 재질의 `color` 를 그대로 옮기므로 `GP_Hat`·`GP_Beard`·
   *   `PR_Bamboo` 같은 이름 있는 재질의 **캐릭터 판독은 유지된다.**
   */
  const toonCache = new Map<number, MeshToonMaterial>()
  const toonFor = (src: Material): MeshToonMaterial => {
    const hex = 'color' in src ? (src.color as Color).getHex() : PALETTE.fluor
    const hit = toonCache.get(hex)
    if (hit) return hit
    const made = toonMat(hex)
    toonCache.set(hex, made)
    return made
  }

  model.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    // 스킨드 메시의 바운딩 박스는 T-포즈 기준이라 컬링이 오작동한다
    m.frustumCulled = false
    const tint = opts?.tint
    const apply = (src: Material): Material => {
      // 호출자가 이름으로 색을 덮어쓰고 싶으면 그 값이 이긴다 (P2 확장 지점)
      const forced = tint?.[src.name]
      return forced === undefined ? toonFor(src) : toonMat(forced)
    }
    m.material = Array.isArray(m.material) ? m.material.map(apply) : apply(m.material)
  })

  /**
   * 접지 그림자 — 실제 그림자가 없는 씬에서 발이 바닥에 붙어 보이게 하는 단서.
   *
   * ⚠ 계수는 `player-rig.ts` 와 **같은 값이어야 한다.** 거기서 실측 보폭
   *   (걸을 때 0.316m · 뛸 때 0.815m)에 맞춰 0.42 → 0.26 으로 내렸다.
   *   한쪽만 고치면 주인공과 NPC 의 그림자 크기가 달라져 그게 더 눈에 띈다.
   */
  const shadow = new Mesh(
    new CircleGeometry(0.26 * (opts?.scale ?? 1), 20),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  root.add(shadow)

  const mixer = new AnimationMixer(model)
  const clips = new Map<string, AnimationClip>()
  for (const c of gltf.animations) clips.set(c.name, c)

  const actions = new Map<string, AnimationAction>()
  const actionFor = (name: string): AnimationAction | null => {
    const cached = actions.get(name)
    if (cached) return cached
    const clip = clips.get(name)
    if (!clip) return null
    const a = mixer.clipAction(clip)
    actions.set(name, a)
    return a
  }

  /**
   * 프롭 노드 캐시. `traverse` 를 매 토글마다 돌리면 안 되는 이유는 비용이 아니라
   * 순서다 — 프롭은 본에 붙어 있어서 트리 깊이가 깊고, 토글은 상태가 바뀌는
   * 프레임에만 일어나는 일이라 캐시 미스가 곧 "한 프레임 늦게 나타남"이 된다.
   */
  const propCache = new Map<string, readonly Object3D[]>()
  const propsFor = (prefix: string): readonly Object3D[] => {
    const hit = propCache.get(prefix)
    if (hit) return hit
    const found: Object3D[] = []
    model.traverse((o) => { if (o.name.startsWith(prefix)) found.push(o) })
    propCache.set(prefix, found)
    return found
  }

  let current: string | null = null

  const play = (clip: string, oneShot = false): void => {
    if (current === clip) return
    const next = actionFor(clip)
    if (!next) return          // 아직 GLB 에 없는 클립 — 조용히 현 상태를 유지한다
    const prev = current ? actionFor(current) : null
    next.reset()
    next.enabled = true
    next.setEffectiveWeight(1)
    if (oneShot) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(LoopRepeat, Infinity)
    }
    if (prev && prev !== next) next.crossFadeFrom(prev, CROSSFADE, true)
    next.play()
    current = clip
  }

  return {
    root,
    place(x, y, z, facing) {
      // 월드(z 상) → three(y 상). 플레이어 리그와 **같은 변환**을 쓴다
      root.position.set(x, z, -y)
      // 월드 facing(+x 기준, 반시계) → three 요. `yawOffset` 은 모델 전방축 보정이다
      /**
       * ★ **회전이지 거울이 아니다.**
       *
       * 예전 공식은 `-facing + π/2` 였다. 그건 로컬 +Z 를 월드
       * `(sin θ, −cos θ)` 로 보내는 three 규약과 합쳐지면 **북축 대칭 반사**가 된다:
       * 남·북(±π/2)은 반사의 고정점이라 멀쩡해 보이고, **동·서만 180° 뒤집힌다.**
       * 그래서 "할아버지가 뒤로 걷는다"가 동서로 달릴 때만 나왔고, x 축을 걷는
       * 좀비폰족·역무원은 멀쩡했다. 남북으로만 검증하면 절대 안 잡힌다.
       *
       * 필요한 것은 `θ = facing + π/2` 다 — 그래야 로컬 +Z 가 정확히 `(cos f, sin f)` 로 간다.
       */
      root.rotation.y = facing + Math.PI / 2 + yawOffset
    },
    play,
    current: () => current,
    update(dtSec) { mixer.update(dtSec) },
    setVisible(on) { root.visible = on },
    setProp(namePrefix, on) {
      for (const o of propsFor(namePrefix)) o.visible = on
    },
    attachProp(namePrefix, parentName, local) {
      /**
       * ⚠ **본 이름은 GLB 의 것과 다르다.** GLTFLoader 가 애니 바인딩에 쓸 수 없는 문자
       * (`. : / [ ]`)를 이름에서 **지운다** — GLB 의 `Prop.R` 은 씬에서 `PropR` 이다
       * (실측: 단소의 부모가 `Prop.Chest` 가 아니라 `PropChest` 로 나왔다).
       * 호출부가 GLB 실측 이름을 그대로 쓸 수 있도록 여기서 두 이름을 다 본다.
       */
      const parent = model.getObjectByName(parentName)
        ?? model.getObjectByName(parentName.replace(/[.:/[\]]/g, ''))
      if (!parent) return        // 리그에 없는 본 — 조용히 둔다 (`play()` 와 같은 규약)
      for (const o of propsFor(namePrefix)) {
        // `add()` 가 기존 부모에서 떼어 낸다. 캐시는 여전히 유효하다 — 트리 안에 남는다
        if (o.parent !== parent) parent.add(o)
        o.position.set(local.pos[0], local.pos[1], local.pos[2])
        o.quaternion.set(local.quat[0], local.quat[1], local.quat[2], local.quat[3])
        if (local.scale !== undefined) o.scale.setScalar(local.scale)
      }
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      shadow.geometry.dispose()
      ;(shadow.material as MeshBasicMaterial).dispose()
      // 재질·지오메트리는 GLB 소유다(`gltf.scene` 과 공유) — 여기서 dispose 하지 않는다.
    },
  }
}
