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
import { PALETTE } from '../data/tuning'
import type { GameState } from '../state/types'
import { toonMat } from './toon'

export type ClipName = 'Idle' | 'Walk' | 'Run' | 'Sprint' | 'Jump' | 'Slide' | 'Stumble' | 'Hit' | 'Board'

const CROSSFADE = 0.18
/** 원샷 클립 — 끝나면 자동으로 이전 상태로 돌아간다 */
const ONESHOT: ReadonlySet<ClipName> = new Set(['Stumble', 'Hit', 'Jump'])

export type PlayerRig = Readonly<{
  root: Group
  sync(state: GameState, dtSec: number): void
  play(name: ClipName): void
  dispose(): void
}>

export const loadPlayerRig = async (url: string, outline: boolean): Promise<PlayerRig> => {
  const gltf = await new GLTFLoader().loadAsync(url)
  const source = gltf.scene as Object3D
  const model = cloneSkinned(source) as Object3D

  // glTF는 Y-up 규격이라 Blender 익스포터가 이미 축을 변환해 놓았다. 추가 보정 없음.
  const root = new Group()
  root.name = 'player'
  root.add(model)

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
    new CircleGeometry(0.42, 20),
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
    play: (n) => play(n),
    sync(state, dtSec) {
      clock += dtSec
      const p = state.player
      root.position.set(p.pos.x, p.pos.z, -p.pos.y)
      // 월드 facing(+x 기준, 반시계) → three 요
      root.rotation.y = -p.facing + Math.PI / 2

      if (state.phase === 'boarding') play('Board')
      else if (clock >= oneshotUntil) {
        if (state.gates.state === 'reject') play('Stumble')
        else if (p.sprinting) play('Sprint')
        else if (p.moving) play('Walk')
        else play('Idle')
      }
      mixer.update(dtSec)
    },
    dispose() {
      mixer.stopAllAction()
    },
  }
}
