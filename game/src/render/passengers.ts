/**
 * 인트로 버스 승객 — **기존 NPC 를 그대로 태운다.**
 *
 * ■ 새 캐릭터를 안 만든다
 *
 * `public/models/npc/` 에 이미 여섯 종이 있고, 전부 플레이어와 **같은 골격 이름**을
 * 쓴다(Root·Hips·Spine·Chest·Head·Shoulder/UpperArm/LowerArm{L,R}·
 * UpperLeg/LowerLeg/Foot{L,R}). 그래서 `makePoseRig` 가 그대로 먹는다 —
 * 앉은 클립이 없어도 **코드로 앉힐 수 있다.**
 *
 * ■ 왜 승객이 필요한가
 *
 * 빈 버스는 출근길이 아니라 촬영용 세트로 보인다. 그렇다고 만원 버스를 만들 이유는
 * 없다 — 셋이면 "사람이 있는 버스"가 된다.
 *
 * ■ 카메라를 안 가린다
 *
 * ① 샷은 주인공 **동쪽**(앞)에서 서쪽을 돌아본다. 그래서 승객은 전부 주인공보다
 * **서쪽(뒤)** 이나 **통로 건너편**에 앉힌다 — 카메라와 주인공 사이에는 아무도 없다.
 * ② OTS 는 주인공 어깨 위라 더 안전하다.
 */

import { Group, type Object3D } from 'three'
import { CHAR_SCALE } from './actors'
import { BUS } from './bus-interior'
import { loadNpcRig, type NpcRig } from './npc-rig'
import { makePoseRig, SIT_DROP } from './pose'

/**
 * 자리 — 좌석 열(`IN.xW + 0.75` 에서 0.80m 간격)과 좌석 y 에 맞춘 값이다.
 * 주인공은 (−61.33, 21.20) 에 앉는다.
 */
type Seat = Readonly<{
  file: string
  clip: string
  x: number
  y: number
  facing: number
  /** 앉은 승객인가 — 서 있으면 봉을 잡는다 */
  sit: boolean
  /** 복제처럼 안 보이게 아주 조금 흔든다 */
  scale: number
}>

const SEATS: readonly Seat[] = [
  /**
   * ★ 남쪽(통로 건너편) 열은 **카메라에서 3m 밖**에만 앉힌다.
   *
   * ① 샷 카메라는 주인공 앞(x −59.7)에서 서쪽을 돌아본다. 통로 건너편은 화면
   *   왼쪽에 오는데, 2m 안쪽에 앉히면 뒤통수(zp 는 후드를 썼다)가 회색 덩어리로
   *   화면 왼쪽 위를 채운다. 실제로 −61.25 → −62.05 로 옮겨도 그대로였다.
   *   승객은 배경이지 전경이 아니다(브리프 §9·§10).
   */
  { file: 'zp', clip: 'ZP_Idle1H', x: -63.65, y: 19.72, facing: 0, sit: true, scale: 1.0 },
  // 두 열 뒤 창가 — 주인공 등 뒤. 파마머리 실루엣이 살짝 보인다
  { file: 'aj', clip: 'AJ_Idle', x: -62.85, y: 21.20, facing: 0, sit: true, scale: 0.97 },
  // 더 뒤 통로 건너편
  { file: 'cl', clip: 'CL_Idle', x: -64.45, y: 19.72, facing: 0, sit: true, scale: 1.03 },
  // 봉을 잡고 서 있는 사람 — 통로에 하나는 서 있어야 출근길로 읽힌다
  { file: 'zp', clip: 'ZP_Idle', x: -63.9, y: 20.72, facing: 0.5, sit: false, scale: 0.99 },
]

export type Passengers = Readonly<{
  root: Group
  /** 버스가 달리는 동안 같이 움직인다 */
  setBusDx(dx: number): void
  update(dtSec: number): void
  setVisible(on: boolean): void
  dispose(): void
}>

export const loadPassengers = async (base: string): Promise<Passengers> => {
  const root = new Group()
  root.name = 'intro-passengers'

  const made = await Promise.all(SEATS.map(async (s) => {
    const rig = await loadNpcRig(`${base}models/npc/${s.file}_character_rigged.glb`,
      { scale: CHAR_SCALE * s.scale })
    /**
     * 앉힌다. 리그 원점이 `SIT_DROP` 만큼 내려가야 엉덩이가 좌면에 얹힌다 —
     * 다리를 접는 것만으로는 골반이 안 내려온다(`pose.ts` 참고).
     */
    rig.place(s.x, s.y, s.sit ? BUS.floor - SIT_DROP : BUS.floor, s.facing)
    rig.play(s.clip)
    root.add(rig.root)
    return { rig, pose: makePoseRig(rig.root), sit: s.sit }
  }))

  return {
    root,
    setBusDx(dx) { root.position.x = dx },
    update(dtSec) {
      for (const m of made) {
        m.rig.update(dtSec)
        /**
         * ★ `update()`(= mixer) **뒤에** 접는다. 앞에서 부르면 클립이 덮어쓴다.
         * 서 있는 승객은 팔만 조금 앞으로 — 봉을 잡은 모양이 된다.
         */
        m.pose.apply({ sit: m.sit ? 1 : 0, phone: m.sit ? 0 : 0.55 })
      }
    },
    setVisible(on) { root.visible = on },
    dispose() {
      for (const m of made) m.rig.dispose()
      root.clear()
    },
  }
}

export type { Object3D as PassengerNode, NpcRig }
