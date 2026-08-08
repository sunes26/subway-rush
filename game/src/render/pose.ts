/**
 * 포즈 — **클립 없이 본을 직접 접는다.**
 *
 * ■ 왜 이게 가능한가
 *
 * `mc_character_rigged.glb` 에는 앉은 애니메이션이 없다(Board·Hit·Idle·Jump·
 * JumpAir·JumpLand·Run·Slide·Sprint·Stumble·Walk 열한 종뿐). 처음엔 그것만 보고
 * "Blender 를 거쳐야 한다"고 판단했는데, **본을 열어 보니 그럴 필요가 없었다.**
 *
 *   Hips · Spine · Head · UpperArm.L/R · LowerArm.L/R · UpperLeg.L/R · LowerLeg.L/R
 *
 * 17개뿐이고 이름이 붙어 있다. 앉는다는 것은 결국 **넓적다리를 앞으로 90°,
 * 종아리를 아래로 90°** 접는 것이라 본 네 개면 끝난다. 클립이 없다는 사실과
 * 포즈를 만들 수 없다는 것은 다른 이야기였다.
 *
 * ■ 적용 순서가 중요하다
 *
 * `AnimationMixer` 는 매 프레임 본의 회전을 **덮어쓴다.** 그러므로 이 함수는
 * 반드시 `mixer.update()`(= `player.sync()`) **뒤에** 불러야 한다. 앞에서 부르면
 * 아무 일도 안 일어난 것처럼 보인다.
 *
 * ■ 섞는다
 *
 * `k` 로 서 있는 자세와 앉은 자세를 섞는다. 일어서는 동작이 이 값으로 만들어지고,
 * 그래서 별도의 "일어나기" 클립도 필요 없다.
 */

import { Euler, Quaternion, type Object3D } from 'three'

/** 어느 축으로 접히는지는 리그마다 다르다 — 실측으로 정한다 */
export type SitAxis = 'x' | 'z'

export type PoseInput = Readonly<{
  /** 0 서 있음 · 1 앉음 */
  sit: number
  /** 0 팔 내림 · 1 휴대폰을 들어 본다 */
  phone: number
}>

export type PoseRig = Readonly<{
  /** `mixer.update()` **뒤에** 부른다 */
  apply(p: PoseInput): void
  /** 본을 못 찾았으면 false — 리그가 바뀐 것이다 */
  ok: boolean
}>

/**
 * 앉을 때 리그 원점이 **내려가는** 양(m).
 *
 * 다리를 접는 것만으로는 앉은 자세가 안 된다 — 회전은 자식(다리)을 움직일 뿐
 * 부모(골반)를 못 내린다. 그래서 리그를 통째로 내려 골반을 좌면 높이에 얹는다.
 *
 * 값의 근거: 이 리그는 골반이 발에서 0.68m 위에 있다(실측). 앉으면 넓적다리가
 * 수평, 종아리가 수직이 되므로 골반은 발에서 종아리 길이(≈0.42m)만큼만 위에 온다.
 * 차이 0.26m 가 그대로 내려갈 거리다. 이 값이 없으면 좌석 위에 **서 있게** 된다.
 */
export const SIT_DROP = 0.26

/**
 * ⚠ **glTF 의 점은 씬에서 사라진다.**
 *
 * three 의 `GLTFLoader` 가 노드 이름을 `PropertyBinding.sanitizeNodeName` 으로 씻는데,
 * 점은 애니메이션 바인딩 경로의 구분자라 **지워진다**(언더스코어로 바뀌는 게 아니다).
 * 파일에는 `UpperLeg.L` 로 들어 있지만 씬에서는 `UpperLegL` 이다.
 *
 * 실측한 전체 골격(17):
 *   Root · Hips · Spine · Chest · Head · Shoulder{L,R} · UpperArm{L,R} ·
 *   LowerArm{L,R} · UpperLeg{L,R} · LowerLeg{L,R} · Foot{L,R}
 *
 * 처음엔 파일 이름 그대로 찾다가 점 없는 `Spine` 하나만 잡혔다. 그런데도 조용히
 * 넘어가서 "다리가 안 접힌다"는 증상만 남았다 — 아래 `ok` 를 반드시 확인해야 한다.
 */
const NAMES = [
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'Spine',
  'UpperArmR', 'LowerArmR', 'Head',
] as const
type BoneName = (typeof NAMES)[number]

/**
 * 앉은 자세의 목표 각(rad).
 *
 * 넓적다리는 몸통 기준 앞으로, 종아리는 넓적다리 기준 아래로. 사람이 의자에
 * 앉으면 둘 다 대략 직각이 되는데, 그대로 90° 를 주면 무릎이 딱 붙어 굳어 보인다.
 * 실제로는 넓적다리가 조금 덜 접히고 종아리가 살짝 뒤로 빠진다.
 */
const SIT: Readonly<Partial<Record<BoneName, number>>> = {
  UpperLegL: -1.42,
  UpperLegR: -1.42,
  LowerLegL: 1.30,
  LowerLegR: 1.30,
  // 등을 아주 살짝 세운다 — 앉으면 골반이 뒤로 눕고 등이 그만큼 선다
  Spine: 0.07,
}

/** 팔이 접히는 방향 — 리그마다 다르다. `?armsign=-1` 로 뒤집어 실측한다 */
const ARM_SIGN = typeof location !== 'undefined' && /[?&]armsign=-1/.test(location.search) ? -1 : 1

/**
 * 휴대폰을 들어 보는 자세 — 오른팔을 접고 고개를 살짝 숙인다.
 *
 * 손 본이 없어서(골격이 `...LowerArmR` 에서 끝난다) 팔뚝 끝이 곧 손이다.
 * 휴대폰은 그 자리에 붙는다(`render/phone.ts`).
 */
const PHONE: Readonly<Partial<Record<BoneName, number>>> = {
  UpperArmR: ARM_SIGN * 0.95,
  LowerArmR: ARM_SIGN * 1.15,
  // 화면을 내려다본다. 크게 숙이면 얼굴이 안 보인다
  Head: 0.28,
}

export const makePoseRig = (root: Object3D, axis: SitAxis = 'x'): PoseRig => {
  const bones = new Map<BoneName, Object3D>()
  const rest = new Map<BoneName, Quaternion>()
  /** 표기 흔들림(점·언더스코어·대소문자)을 지우고 맞춘다 */
  const norm = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = new Map(NAMES.map((n) => [norm(n), n]))
  root.traverse((o) => {
    const key = wanted.get(norm(o.name))
    if (key && !bones.has(key)) {
      bones.set(key, o)
      rest.set(key, o.quaternion.clone())
    }
  })

  const e = new Euler()
  const q = new Quaternion()

  return {
    ok: bones.size === NAMES.length,
    apply({ sit, phone }) {
      if (sit <= 0 && phone <= 0) return
      const s01 = Math.max(0, Math.min(1, sit))
      const p01 = Math.max(0, Math.min(1, phone))
      for (const [name, bone] of bones) {
        const a = (SIT[name] ?? 0) * s01 + (PHONE[name] ?? 0) * p01
        e.set(axis === 'x' ? a : 0, 0, axis === 'z' ? a : 0)
        q.setFromEuler(e)
        /**
         * ★ **항상 안정 자세(rest)에서 다시 만든다.** 클립이 낸 회전에 곱하지 않는다.
         *
         * 처음엔 `bone.quaternion.multiply(q)` 로 덧붙였다. 그런데 `Idle` 클립에는
         * 다리 본 트랙이 **없어서** 믹서가 그 본을 매 프레임 되돌려 주지 않는다.
         * 그러니 곱셈이 프레임마다 쌓여 1초 만에 수십 라디안까지 돌아갔고,
         * 메시가 뭉개져 **캐릭터가 통째로 안 보였다** — 접지 그림자만 남았다.
         *
         * 매 프레임 같은 입력에 같은 출력이 나와야 한다. 그게 이 리포가 카메라를
         * 순수 함수로 짠 이유와 같다.
         */
        bone.quaternion.copy(rest.get(name)!).multiply(q)
      }
    },
  }
}
