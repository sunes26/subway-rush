/**
 * 플레이어 리그 — `mc_character_rigged.glb` (애니 9종).
 *
 * P0은 5종만 쓴다: Idle / Walk / Sprint / Stumble / Board.
 * Run·Jump·Slide·Hit은 P1(단소 추격·스크린도어 돌파)에서 쓴다.
 */

import {
  AnimationMixer, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial,
  CircleGeometry, type AnimationAction, type AnimationClip, type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Vec3 } from '../core/math'
import { PALETTE } from '../data/tuning'
import type { GameState } from '../state/types'
import { toonMat } from './toon'

export type ClipName =
  | 'Idle' | 'Walk' | 'Run' | 'Sprint' | 'Jump' | 'JumpAir' | 'JumpLand'
  | 'Slide' | 'Stumble' | 'Hit' | 'Board'

const CROSSFADE = 0.18
/** 원샷 클립 — 끝나면 자동으로 이전 상태로 돌아간다 */
const ONESHOT: ReadonlySet<ClipName> = new Set(['Stumble', 'Hit', 'Jump', 'JumpAir', 'JumpLand'])

export type PlayerRig = Readonly<{
  root: Group
  sync(state: GameState, dtSec: number, renderPos?: Vec3): void
  play(name: ClipName): void
  /** 1인칭에서는 자기 몸이 카메라를 가린다 — 통째로 끈다 (전용 팔 메시는 P1) */
  setVisible(on: boolean): void
  dispose(): void
}>

export const loadPlayerRig = async (url: string, outline: boolean, scale = 1): Promise<PlayerRig> => {
  const gltf = await new GLTFLoader().loadAsync(url)
  const source = gltf.scene as Object3D
  const model = cloneSkinned(source) as Object3D

  // glTF는 Y-up 규격이라 Blender 익스포터가 이미 축을 변환해 놓았다. 추가 보정 없음.
  const root = new Group()
  root.name = 'player'
  root.add(model)
  /**
   * 에셋이 0.92m 라 실척 맵에서는 인형으로 보인다 — NPC 와 **같은 배율**을 받는다.
   * 1인칭에서는 안 보이지만 `V` 3인칭에서는 보이고, 배율이 다르면 할아버지가
   * 플레이어보다 커 보이는 역전이 생긴다.
   */
  if (scale !== 1) model.scale.setScalar(scale)

  model.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    m.material = toonMat(PALETTE.fluor)
    // 스킨드 메시의 바운딩 박스는 T-포즈 기준이라 컬링이 오작동한다
    m.frustumCulled = false
  })
  // 캐릭터 아웃라인은 S7 폴리시 항목이다. 스킨드 메시에 셸을 붙이려면
  // 스켈레톤을 공유해야 하는데, 그 복잡도를 P0 게이트 전에 지불할 이유가 없다.
  void outline

  // 접지 그림자 — 쿼터뷰에서 높이를 읽게 해주는 유일한 단서
  const shadow = new Mesh(
    new CircleGeometry(0.42 * scale, 20),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  root.add(shadow)

  const mixer = new AnimationMixer(model)
  const clips = new Map<string, AnimationClip>()
  for (const c of gltf.animations) clips.set(c.name, c)

  const actions = new Map<string, AnimationAction>()
  const actionFor = (name: ClipName): AnimationAction | null => {
    const cached = actions.get(name)
    if (cached) return cached
    const clip = clips.get(name)
    if (!clip) return null
    const a = mixer.clipAction(clip)
    actions.set(name, a)
    return a
  }

  let current: ClipName | null = null
  let oneshotUntil = 0
  let clock = 0
  /** 직전 프레임에 공중이었는가 — 착지 클립 트리거 */
  let wasAirborne = false

  const play = (name: ClipName, force = false): void => {
    if (current === name && !force) return
    const next = actionFor(name)
    if (!next) return
    const prev = current ? actionFor(current) : null
    next.reset()
    next.enabled = true
    next.setEffectiveWeight(1)
    if (ONESHOT.has(name)) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
      oneshotUntil = clock + next.getClip().duration
    } else {
      next.setLoop(LoopRepeat, Infinity)
    }
    if (prev && prev !== next) next.crossFadeFrom(prev, CROSSFADE, true)
    next.play()
    current = name
  }

  play('Idle')

  return {
    root,
    setVisible(on) { root.visible = on },
    play: (n) => play(n),
    sync(state, dtSec, renderPos) {
      clock += dtSec
      const p = state.player
      const pos = renderPos ?? p.pos
      root.position.set(pos.x, pos.z, -pos.y)
      // 월드 facing(+x 기준, 반시계) → three 요
      // `npc-rig.ts place()` 와 **같은 공식**이어야 한다. `-facing` 은 반사였다(동서 뒤집힘)
      root.rotation.y = p.facing + Math.PI / 2

      // 공중은 원샷 클립보다 우선한다 — 뛰는 도중 다른 상태로 덮이면 안 된다
      if (state.phase === 'boarding') play('Board')
      else if (!p.grounded) play('JumpAir')
      else if (wasAirborne) { wasAirborne = false; play('JumpLand', true) }
      else if (clock >= oneshotUntil) {
        if (state.gates.state === 'reject') play('Stumble')
        else if (p.sprinting) play('Sprint')
        else if (p.moving) play('Walk')
        else play('Idle')
      }
      if (!p.grounded) wasAirborne = true
      mixer.update(dtSec)
    },
    dispose() {
      mixer.stopAllAction()
    },
  }
}
