/**
 * 포즈 — **클립 없이 본을 직접 접는다.**
 *
 * ■ 왜 이게 가능한가
 *
 * `mc_character_rigged.glb` 에는 앉은 애니메이션이 없다(Board·Hit·Idle·Jump·
 * JumpAir·JumpLand·Run·Slide·Sprint·Stumble·Walk 열한 종뿐). 처음엔 그것만 보고
 * "Blender 를 거쳐야 한다"고 판단했는데, **본을 열어 보니 그럴 필요가 없었다.**
 *
 *   Root · Hips · Spine · Chest · Head · Shoulder{L,R} · UpperArm{L,R} ·
 *   LowerArm{L,R} · UpperLeg{L,R} · LowerLeg{L,R} · Foot{L,R}
 *
 * 17개뿐이고 이름이 붙어 있다. 앉는다는 것은 넓적다리를 앞으로, 종아리를 아래로
 * 접는 것이고, 휴대폰을 보는 것은 위팔을 앞으로 들고 아래팔을 굽히는 것이다.
 *
 * ■ ★ 회전축을 **추측하면 안 된다**
 *
 * 한동안 팔을 로컬 X 축으로 돌렸다. 그런데 그 축은 팔을 **몸 뒤로** 보내는
 * 방향이었다 — 실측 스크린샷에서 팔꿈치가 등 뒤로 빠져 어깨가 꺾인 것처럼 보였다.
 *
 * 각도를 이리저리 바꿔 보는 대신 축을 **쟀다.** 본이 월드에서 어느 쪽으로 뻗어
 * 있는지(로컬 Y 의 월드 방향)를 읽고, 그것을 정면(동쪽)으로 밀어내는 회전축을
 * 외적으로 구했다.
 *
 *   축 = (본이 뻗은 방향) × (정면)
 *
 * 그 값을 다시 본의 로컬 좌표로 옮긴 것이 아래 `axis` 다. 이 축으로 **양수**만큼
 * 돌리면 팔은 반드시 앞으로 간다 — 부호를 헷갈릴 여지가 없다.
 *
 * ■ 적용 순서가 중요하다
 *
 * `AnimationMixer` 는 매 프레임 본의 회전을 덮어쓴다. 그러므로 이 함수는 반드시
 * `mixer.update()`(= `player.sync()`) **뒤에** 불러야 한다.
 */

import { Quaternion, Vector3, type Object3D } from 'three'

export type PoseInput = Readonly<{
  /** 0 서 있음 · 1 앉음 */
  sit: number
  /** 0 팔 내림 · 1 휴대폰을 들어 본다 */
  phone: number
  /**
   * 0 곧게 섬 · 1 무릎에 손을 짚고 숨을 몰아쉼 (엔딩 — JUST IN TIME).
   *
   * 클립에 없는 자세다. `Stumble` 은 **휘청이는 한 순간**이라 끝나면 원래대로
   * 돌아오고, 우리가 보여줘야 하는 것은 그 뒤의 **머무는 자세**다.
   */
  brace?: number
  /**
   * 0 곧게 섬 · 1 머리를 감싸 쥠 (엔딩 — WRONG WAY).
   * `Hit` 로 충격 한 순간을 치고, 그 뒤에 이 자세가 남는다.
   */
  slump?: number
}>

export type PoseRig = Readonly<{
  /** `mixer.update()` **뒤에** 부른다 */
  apply(p: PoseInput): void
  /** 본을 못 찾았으면 false — 리그가 바뀐 것이다 */
  ok: boolean
}>

/**
 * ⚠ **glTF 의 점은 씬에서 사라진다.** `GLTFLoader` 가 노드 이름을
 * `PropertyBinding.sanitizeNodeName` 으로 씻으면서 점을 지운다 — 파일에는
 * `UpperLeg.L` 이지만 씬에서는 `UpperLegL` 이다.
 */
const NAMES = [
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'Spine',
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'Head',
] as const
type BoneName = (typeof NAMES)[number]

type Turn = Readonly<{ axis: readonly [number, number, number]; angle: number }>

/**
 * **실측한 축.** `introProbe` 로 본의 월드 축을 읽어 계산했다(위 헤더 참고).
 * 팔은 양수 = 앞으로. 다리는 원래 쓰던 로컬 X 그대로다(무릎이 앞으로 나온다).
 */
const ARM_FWD_R = [-0.880, 0, 0.469] as const
const ARM_FWD_L = [-0.880, 0, -0.469] as const
const FOREARM_FWD_R = [-0.992, 0, 0.102] as const
const FOREARM_FWD_L = [-0.992, 0, -0.102] as const
const LEG_FWD = [-1, 0, 0] as const
/**
 * **몸 쪽으로 모으는 축**(adduction) — 앞으로 드는 축과 본이 뻗은 방향(로컬 +Y)에
 * 모두 수직인 방향이다(`FOREARM_FWD_R × (0,1,0)` 정규화).
 *
 * 이 축이 없어서 팔이 바깥으로 벌어진 채 앞으로만 나갔다. 실측: 어깨 북 21.16 →
 * 팔꿈치 20.96 → 폰 21.00. 몸통 중심선이 21.20 이므로 폰이 **20cm 오른쪽**에 있었고,
 * 그게 "몸 옆에 어색하게 붙었다"의 정체였다.
 */
const FOREARM_IN_R = [0.102, 0, 0.992] as const

/** 앉은 자세 — 다리를 접고, 팔은 허벅지 위에 편하게 내린다 */
const SIT: Readonly<Partial<Record<BoneName, Turn | readonly Turn[]>>> = {
  UpperLegL: { axis: LEG_FWD, angle: 1.42 },
  UpperLegR: { axis: LEG_FWD, angle: 1.42 },
  /** 종아리 — 1.30 에서는 발이 바닥에서 15cm 떠 있었다 */
  LowerLegL: { axis: LEG_FWD, angle: -1.62 },
  LowerLegR: { axis: LEG_FWD, angle: -1.62 },
  /**
   * 등을 **기댄다.** 0.07 은 사실상 똑바로 선 자세라 마네킹처럼 보였다.
   * 버스에 앉은 사람은 등받이에 기대고 어깨가 내려간다 — 0.18 이 그 각이다.
   * 고개도 조금 숙여(0.10) 시선이 앞이 아니라 아래를 향하게 한다.
   */
  Spine: { axis: [1, 0, 0], angle: 0.18 },
  Head: { axis: [1, 0, 0], angle: 0.10 },
  /**
   * 팔은 **가만히 두지 않는다.** `Idle` 은 서 있는 자세라 팔이 몸 옆으로 곧게
   * 떨어지는데, 앉은 사람의 팔은 허벅지 위로 조금 앞에 온다. 이것만 없어도
   * 마네킹처럼 보인다.
   */
  UpperArmL: { axis: ARM_FWD_L, angle: 0.16 },
  UpperArmR: { axis: ARM_FWD_R, angle: 0.16 },
  LowerArmL: { axis: FOREARM_FWD_L, angle: 0.52 },
  LowerArmR: { axis: FOREARM_FWD_R, angle: 0.52 },
}

/**
 * 휴대폰을 들어 보는 자세 — **오른팔만** 앞으로 든다.
 *
 * ⚠ 위팔을 0.42 나 들었더니 **팔 전체가 앞으로 뻗은** 자세가 됐다. 사람은
 *   버스에서 그렇게 폰을 안 본다 — 팔꿈치는 옆구리에 붙이고 아래팔만 올린다.
 *
 * 손 본이 없어서 아래팔 끝이 곧 손이다. 휴대폰은 그 자리에 붙는다(`phone.ts`).
 */
const PHONE: Readonly<Partial<Record<BoneName, Turn | readonly Turn[]>>> = {
  /**
   * 위팔은 거의 안 든다. **팔꿈치는 옆구리 근처에 남는다.**
   * 앉은 자세가 이미 0.16 을 얹었으므로 합이 0.26rad(15°) — 팔을 앞으로 뻗는 게
   * 아니라 팔꿈치만 몸에 붙인 채 아래팔을 올리는 자세다.
   */
  UpperArmR: { axis: ARM_FWD_R, angle: 0.10 },
  /**
   * 전완을 앞으로 들면서 **몸 쪽으로 모은다.** 두 번째 항이 그것이다 —
   * 값은 실측으로 잡았다(아래 `LowerArmR` 주석).
   */
  /**
   * 팔꿈치 굽힘 — 앉은 자세 0.52 와 합쳐 1.77rad(101°).
   *
   * 84° 였을 때 폰이 z 1.02 에 왔는데, 카메라가 내려다보는 각과 겹쳐 **무릎 위
   * 물체**처럼 읽혔다. 더 접으면 아래팔이 위를 향해 손이 올라온다 —
   * 팔꿈치는 그대로 옆구리에 있으므로 "팔을 뻗은" 자세가 되지는 않는다.
   */
  LowerArmR: [
    { axis: FOREARM_FWD_R, angle: 1.60 },
    { axis: FOREARM_IN_R, angle: -0.70 },
  ],
  // 화면을 내려다본다. 크게 숙이면 얼굴이 안 보인다
  Head: { axis: [1, 0, 0], angle: 0.26 },
}

/**
 * 무릎 짚기 — **숨을 몰아쉬는 자세다.** (엔딩 · JUST IN TIME)
 *
 * 상체를 접고 팔을 앞아래로 뻗어 손이 무릎 근처에 오게 한다. 다리는 조금만 굽힌다 —
 * 많이 굽히면 앉은 자세(`SIT`)로 읽히고, 그러면 "지쳐서 멈춰 섰다"가 아니라
 * "자리에 앉았다"가 된다. 서 있는 채로 몸을 접는 것이 이 자세의 전부다.
 */
const BRACE: Readonly<Partial<Record<BoneName, Turn>>> = {
  Spine: { axis: [1, 0, 0], angle: 0.92 },
  // 고개는 숙이되 등만큼은 아니다. 시선이 바닥을 향하면 얼굴이 통째로 사라진다
  Head: { axis: [1, 0, 0], angle: -0.34 },
  UpperArmL: { axis: ARM_FWD_L, angle: 0.62 },
  UpperArmR: { axis: ARM_FWD_R, angle: 0.62 },
  LowerArmL: { axis: FOREARM_FWD_L, angle: 0.34 },
  LowerArmR: { axis: FOREARM_FWD_R, angle: 0.34 },
  UpperLegL: { axis: LEG_FWD, angle: 0.30 },
  UpperLegR: { axis: LEG_FWD, angle: 0.30 },
  LowerLegL: { axis: LEG_FWD, angle: -0.38 },
  LowerLegR: { axis: LEG_FWD, angle: -0.38 },
}

/**
 * 머리 감싸 쥐기 — **아차 싶은 자세다.** (엔딩 · WRONG WAY)
 *
 * 위팔을 크게 들고 아래팔을 접어 손이 머리 옆으로 온다. 손 본이 없어 아래팔 끝이
 * 곧 손이므로(`PHONE` 주석과 같은 사정), 각도는 **아래팔 끝이 관자놀이 높이에
 * 오는지**를 기준으로 잡았다. 등을 조금 숙이고 무릎을 살짝 꺾어 몸에서 힘이
 * 빠지게 한다 — 그 미세한 꺾임이 없으면 만세를 부르는 그림이 된다.
 */
const SLUMP: Readonly<Partial<Record<BoneName, Turn>>> = {
  Spine: { axis: [1, 0, 0], angle: 0.34 },
  Head: { axis: [1, 0, 0], angle: 0.30 },
  UpperArmL: { axis: ARM_FWD_L, angle: 1.42 },
  UpperArmR: { axis: ARM_FWD_R, angle: 1.42 },
  LowerArmL: { axis: FOREARM_FWD_L, angle: 1.70 },
  LowerArmR: { axis: FOREARM_FWD_R, angle: 1.70 },
  UpperLegL: { axis: LEG_FWD, angle: 0.22 },
  UpperLegR: { axis: LEG_FWD, angle: 0.22 },
  LowerLegL: { axis: LEG_FWD, angle: -0.30 },
  LowerLegR: { axis: LEG_FWD, angle: -0.30 },
}

export const makePoseRig = (root: Object3D): PoseRig => {
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

  const q = new Quaternion()
  const acc = new Quaternion()
  const v = new Vector3()

  /**
   * 회전 하나 또는 **여럿**을 겹친다.
   *
   * 한동안 본마다 회전 하나만 받았다. 그런데 "폰을 든다"는 팔을 앞으로 드는 것만이
   * 아니라 **몸 쪽으로 모으는** 동작이 같이 필요하다 — 하나로는 팔이 바깥으로
   * 벌어진 채 앞으로만 나가서 폰이 몸 중심선에서 20cm 오른쪽에 떠 있었다.
   */
  const turn = (t: Turn | readonly Turn[] | undefined, w: number): void => {
    if (!t || w <= 0) return
    for (const one of (Array.isArray(t) ? t : [t]) as readonly Turn[]) {
      v.set(one.axis[0], one.axis[1], one.axis[2]).normalize()
      acc.multiply(q.setFromAxisAngle(v, one.angle * w))
    }
  }

  return {
    ok: bones.size === NAMES.length,
    apply({ sit, phone, brace = 0, slump = 0 }) {
      const s01 = Math.max(0, Math.min(1, sit))
      const p01 = Math.max(0, Math.min(1, phone))
      const b01 = Math.max(0, Math.min(1, brace))
      const l01 = Math.max(0, Math.min(1, slump))
      // 넷 다 0 이면 클립이 낸 자세를 그대로 둔다 — 인트로 이전 동작과 완전히 같다
      if (s01 <= 0 && p01 <= 0 && b01 <= 0 && l01 <= 0) return
      for (const [name, bone] of bones) {
        acc.identity()
        turn(SIT[name], s01)
        turn(PHONE[name], p01)
        turn(BRACE[name], b01)
        turn(SLUMP[name], l01)
        /**
         * ★ **항상 안정 자세(rest)에서 다시 만든다.** 클립이 낸 회전에 곱하지 않는다.
         *
         * 처음엔 `bone.quaternion.multiply(...)` 로 덧붙였다. 그런데 `Idle` 클립에는
         * 다리·팔 트랙이 없어서 믹서가 그 본을 매 프레임 되돌려 주지 않는다.
         * 그러니 곱셈이 프레임마다 쌓여 1초 만에 수십 라디안까지 돌아갔고,
         * 메시가 뭉개져 **캐릭터가 통째로 안 보였다** — 접지 그림자만 남았다.
         */
        bone.quaternion.copy(rest.get(name)!).multiply(acc)
      }
    },
  }
}

/**
 * 앉을 때 리그 원점이 **내려가는** 양(m).
 *
 * 다리를 접는 것만으로는 앉은 자세가 안 된다 — 회전은 자식(다리)을 움직일 뿐
 * 부모(골반)를 못 내린다. 그래서 리그를 통째로 내려 골반을 좌면 높이에 얹는다.
 *
 * 값의 근거: 이 리그는 골반이 발에서 0.68m 위에 있다(실측). 앉으면 넓적다리가
 * 수평, 종아리가 수직이 되므로 골반은 발에서 정강이 길이(0.275m)만큼만 위에 온다.
 * 이 값이 없으면 좌석 위에 **서 있게** 된다.
 *
 * 0.31 로 잡으면 골반이 z 0.82 — 방석 윗면(0.78)보다 6cm 위다. 골반 관절은 몸
 * 안쪽에 있으므로 엉덩이 표면이 방석에 얹힌다. 0.26 이었을 때는 골반이 0.87 로
 * **방석(0.925)보다 5.5cm 아래**였다 — 파묻혀 있었다.
 */
export const SIT_DROP = 0.31
