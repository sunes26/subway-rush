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
  dispose(): void
}>

export const loadNpcRig = async (
  url: string,
  opts?: {
    tint?: Readonly<Record<string, number>>
    scale?: number
    /**
     * 모델 전방축 보정(rad).
     *
     * `place()` 의 공식(`rotation.y = -facing + π/2`)은 **모델 전방 = 로컬 +z** 를 가정한다
     * (`player-rig.ts` 규약). GP·CP 리그는 전방이 **−z** 로 익스포트돼 있어 그대로 쓰면
     * 180° 돌아앉는다 — 벤치 등받이(북쪽)를 마주 보고 앉아 있었다.
     * 에셋을 다시 뽑지 않고 여기서 한 번 돌린다. 앉은 자세뿐 아니라 **추격 방향도** 같이 고쳐진다.
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

  // 접지 그림자 — 실제 그림자가 없는 씬에서 발이 바닥에 붙어 보이게 하는 유일한 단서
  const shadow = new Mesh(
    // 접지 그림자도 같이 커져야 한다 — 안 그러면 발보다 작은 그림자가 남는다
    new CircleGeometry(0.42 * (opts?.scale ?? 1), 20),
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
      root.rotation.y = -facing + Math.PI / 2 + yawOffset
    },
    play,
    current: () => current,
    update(dtSec) { mixer.update(dtSec) },
    setVisible(on) { root.visible = on },
    setProp(namePrefix, on) {
      for (const o of propsFor(namePrefix)) o.visible = on
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
