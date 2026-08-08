/**
 * 플레이어 리그 — `mc_character_rigged.glb` (애니 9종).
 *
 * P0은 5종만 쓴다: Idle / Walk / Sprint / Stumble / Board.
 * Run·Jump·Slide·Hit은 P1(단소 추격·스크린도어 돌파)에서 쓴다.
 */

import {
  AnimationMixer, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial,
  CircleGeometry, Vector3, type AnimationAction, type AnimationClip, type Object3D,
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

  /**
   * 접지 그림자 — 실제 그림자가 없는 씬에서 발이 바닥에 붙어 보이게 하는 단서.
   *
   * ■ ★ 계수는 **실측 보폭에서 나왔다** — 0.42 는 배율이 없던 시절의 값이다
   *
   *   한동안 `0.42 * scale` 이었다. `CHAR_SCALE` 1.6 이 나중에 곱해지면서
   *   반지름 0.67 · **지름 1.34m** 가 됐다. 실측하면 그게 얼마나 큰지 나온다:
   *
   *     두 발 간격  걸을 때 0.316m · 뛸 때(최대 보폭) 0.815m
   *     그림자      지름 1.30m        ← 걸을 때 발자국의 **4.1배**
   *
   *   그래서 인물 밑에 검은 웅덩이가 깔렸다. 사람이 아니라 물체가 떠 있는 것처럼
   *   보인다. 원래 0.42 는 P0 쿼터뷰에서 **높이를 읽는 단서**로 크게 잡은 값인데,
   *   지금은 1인칭이 기본이고 3인칭은 인트로에서만 쓴다 — 전제가 바뀌었다.
   *
   *   최대 보폭 0.815m 를 덮는 반지름은 0.41 이다. 배율을 따라가되 그 값이
   *   나오도록 계수를 0.26 으로 잡는다(0.26 × 1.6 = 0.416).
   */
  const shadow = new Mesh(
    new CircleGeometry(0.26 * scale, 20),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  root.add(shadow)

  /**
   * ★ 스킨드 메시의 **프러스텀 컬링을 끈다.**
   *
   * three 는 스킨드 메시도 `geometry.boundingSphere` 로 컬링하는데, 그 구는
   * **본이 하나도 안 움직인 바인드 포즈** 기준이다. 이 에셋은 바인드 포즈가 원점에서
   * 한참 떨어져 있어서(실측: 리그를 (−62.08, 21.22) 에 놓았는데 바운딩 박스 중심이
   * (−57.82, 21.21) — 4.3m 차이) 카메라가 **실제로 보이는 자리**를 가까이서 잡으면
   * 그 구가 시야 밖으로 판정돼 캐릭터가 통째로 사라진다.
   *
   * 실제로 그랬다 — 버스 안 1m 거리에서 접지 그림자만 남고 몸이 안 그려졌다
   * (그림자는 일반 Mesh 라 컬링이 맞게 됐다). 1인칭이 기본이라 그동안 안 드러났다.
   *
   * 객체 하나라 컬링을 꺼도 비용이 없다. 근본 해결은 바인드 포즈를 원점에 맞춰
   * 다시 익스포트하는 것이지만, 그건 에셋 작업이고 여기서 막을 수 있다.
   */
  model.traverse((o) => { o.frustumCulled = false })

  /**
   * ★ 모델이 리그 원점에서 **1.92m 떨어져** 그려지던 것을 되돌린다.
   *
   * 실측(`introProbe`): 리그를 월드 (−62.08, 21.22) 에 놓았는데 `Hips` 본이
   * (−62.08, 19.30) 에 있었다 — 로컬 x 로 −1.92m. 에셋의 아마추어가 파일 원점에서
   * 1.2 유닛 밀려 있고, 거기에 `CHAR_SCALE` 1.6 이 곱해진 값이다.
   *
   * 1인칭이 기본이라 그동안 아무도 못 봤다. 그런데 `V` 3인칭에서는 **캐릭터가 자기
   * 위치에서 2m 옆에 서 있었고**, 인트로에서 좌석에 앉히자 옆 열에 앉았다.
   *
   * 숫자를 박지 않고 `Hips` 의 바인드 포즈 위치에서 **역산**한다 — 에셋을 다시
   * 뽑아 오프셋이 달라져도 따라간다. 높이(y)는 건드리지 않는다: 엉덩이가 발보다
   * 위에 있는 것은 오프셋이 아니라 사람의 생김새다.
   */
  const hips = model.getObjectByName('Hips')
  if (hips) {
    const w = new Vector3()
    model.updateWorldMatrix(true, true)
    hips.getWorldPosition(w)
    model.position.x -= w.x - root.position.x
    model.position.z -= w.z - root.position.z
  }

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
