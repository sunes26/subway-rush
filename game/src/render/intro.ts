/**
 * 인트로 — **시간의 순수 함수**다.
 *
 * `crowd.ts` 의 `surgeAt` · `trainAt` 과 같은 모양으로 짰다. dt 를 누적해 상태를
 * 굴리면 프레임이 튈 때 연출이 같이 튀고, 무엇보다 **마지막 프레임이 스폰 포즈와
 * 정확히 일치한다**는 것을 보증할 수 없다. 그 일치가 이 인트로의 전부다 —
 * 어긋나면 조작권이 넘어오는 순간 화면이 한 번 튀고, 그게 보이면 컷신이 된다.
 * 순수 함수면 `poseAt(INTRO_MS)` 를 유닛 테스트로 못 박을 수 있다.
 *
 *
 * ■ 3인칭으로 시작해 1인칭으로 끝난다
 *
 * 버스 안의 사건은 **몸이 있어야 성립한다** — 놀라는 것, 휴대폰을 드는 것.
 * 1인칭은 리액션을 못 보여 준다. 반대로 마지막 질주는 조작권으로 이어져야 하므로
 * 1인칭이어야 한다. 그래서 시점이 한 번 바뀐다.
 *
 * **그 전환을 컷으로 하지 않는다.** 3인칭 카메라가 하차하는 주인공의 **머리 속으로
 * 밀고 들어가서** 그대로 1인칭이 된다(`SWAP_MS`). 거리가 0 이 되는 순간이 곧
 * 시점 전환이라 이음매가 아예 존재하지 않는다. 컷으로 끊으면 거기서 "연출이
 * 끝났다"가 읽히고, 그 순간 인트로는 게임이 아니라 앞에 붙은 영상이 된다.
 *
 *
 * ■ 무대 (부록 A · `data/world.ts`)
 *
 *   차도 y16~22 · 인도 y22~34 · 상가 y34~43 — 전부 +x(동)로 뻗는다
 *   버스   OBJ-01-BUS  x −65.3~−54.4 · y 19.1~21.7 · h3.2   ← 연석에 붙여 세운다
 *   스폰   (−58, 24)                                        ← 쉘터 지붕 아래
 *   역     OBJ-05 출입구 x −0.9~8.9                          ← 여기서 58m 동쪽
 *
 * **스폰이 곧 버스정류장이다.** 그래서 이 인트로는 "역까지 뛰어가는 영상"이 될 수
 * 없다 — 역까지 뛰어가는 것이 게임 본편이기 때문이다. 인트로가 담당하는 것은
 * 버스에서 내려 **뛰기 시작하는 순간까지**이고, 조작권은 첫 몇 걸음에서 넘어간다.
 *
 *
 * ■ 요(yaw) 규약 — `camera-rig.ts` 의 1인칭과 **같은 정의를 쓴다**
 *
 *   `camera.rotation.set(pitch, yaw − π/2, 0)` · YXZ 에서 시선의 월드 방향은
 *   (cos yaw, sin yaw) 다. 즉 **yaw 0 = 동쪽(역 방향) · yaw +π/2 = 북쪽(인도 쪽)**.
 *   인트로가 자기 규약을 따로 만들면 마지막 프레임에서 반드시 어긋난다.
 */

import { clamp01, easeInOut, easeOutCubic, lerp } from '../core/math'
import { FPV } from '../data/tuning'
import { SPAWN } from '../data/world'
import { BUS, DOOR_X } from './bus-interior'
import { SIT_DROP } from './sit-pose'

/** 샷 경계(ms). 합이 6.6초 — 브리프의 6~8초 안이다 */
export const SHOT = {
  /** 버스 이동 — 아직 급하지 않다 */
  bus: 1600,
  /** 열차 시간 확인 — 여기서 상황이 뒤집힌다 */
  phone: 3200,
  /** 정차 → 문 열림 → 하차. **순서가 보여야 한다** */
  alight: 4700,
  /** 역으로 질주 — 조작권이 넘어가는 곳 */
  dash: 6600,
} as const

export const INTRO_MS = SHOT.dash

/** 카메라가 주인공의 머리에 도달해 1인칭이 되는 시각 */
export const SWAP_MS = SHOT.alight

/**
 * 버스가 완전히 멈추는 시각.
 *
 * 하차(SHOT 3)가 시작되는 3200ms 보다 **먼저**여야 한다. 브리프가 못 박은
 * *"움직이는 버스에서 뛰어내리는 것처럼 보이면 안 된다"* 가 이 한 줄이다.
 * 정지 후 300ms 를 비워 두어 "섰다"가 눈에 읽힌 뒤에 문이 열린다.
 */
export const BUS_STOP_MS = 2900

/** 문이 열리기 시작하는 시각 */
export const DOORS_MS = BUS_STOP_MS + 300

/** 자리에서 일어서는 시각 — 문이 열리고 나서다 */
export const STAND_MS = DOORS_MS + 320

/**
 * ■ 서쪽 끝이 이 연출의 진짜 제약이다
 *
 * Z1 의 지면은 x −64 에서 시작한다(`Z1-ROAD`·`Z1-WALK`, 그 밖은 `Z1-END-W` 옹벽).
 * 처음엔 버스를 −86 에서 출발시켰는데 **지도 밖 허공**이었다 — 실측 스크린샷에서
 * 지면이 뚝 끊기고 그 아래로 하늘이 보였다. 세계가 공중에 뜬 섬처럼 보인다.
 *
 * 그래서 접근 거리는 1.5m 뿐이다. 이동만으로는 속도가 안 나온다. 대신 정류장에
 * **붙는 마지막 몇 미터**를 그리는 쪽으로 방향을 바꿨다 — 이야기도 "버스가
 * 지하철역에 거의 도착했을 때"이므로 이게 맞는 그림이다. 모자란 속도감은
 * `busShake`(노면 진동)와 `brakeDip`(제동 쏠림), 그리고 창틀 세로살이 만든다.
 */
const APPROACH_M = 1.5

/**
 * 앉은 자리 — **북측(연석 쪽) 1인석**. 좌석 배열에서 나온 자리다.
 *
 * 열은 `IN.xW + 0.75` 에서 0.80m 간격이므로 −62.08 이 실제 좌석 중심이고,
 * 북측 1인석의 중심 y 는 21.22 다. 카메라에서 고른 자리가 아니라 **좌석이 있는
 * 자리**다 — 브리프의 순서(좌석 → 착석 → 휴대폰 → 카메라)를 그대로 따랐다.
 * 창(북)이 등 뒤에 오고, 문(−60.3)이 1.8m 동쪽이라 일어나 두 걸음이면 닿는다.
 */
const SEAT = { x: -61.28, y: 21.22 } as const
/** 좌면 높이 — `seatUnit` 의 좌판 윗면과 같은 값이어야 엉덩이가 얹힌다 */
const SEAT_TOP = BUS.floor + 0.42
/** 뒷문 안쪽 */
const DOORWAY = { x: DOOR_X, y: 21.15 } as const
/** 연석을 밟고 내려선 자리 — 문 바로 앞 인도 */
const CURB = { x: DOOR_X + 0.1, y: 22.6 } as const

/**
 * 문을 향해 도는 각(76°). **정북(π/2)까지 안 돈다** — 화면 왼쪽 절반이 서쪽,
 * 즉 지도 밖이 되기 때문이다(위 `APPROACH_M` 주석과 같은 문제. 실측에서 왼쪽이
 * 통째로 하늘이었다). 76° 면 문을 향한 것으로 읽히면서 시야는 동쪽에 남는다.
 */
const DOOR_YAW = 1.32

export type IntroPose = Readonly<{
  /** 월드 x(동) */
  x: number
  /** 월드 y(북) */
  y: number
  /** 지면(z=0) 기준 눈높이 m */
  eye: number
  yaw: number
  pitch: number
  fov: number
}>

/** 0..1 구간 진행도 */
const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))
/** `core/math` 에 없는 하나만 여기서 만든다 — 출발을 눌러 두는 3차 곡선 */
const easeIn = (u: number): number => clamp01(u) ** 3

/**
 * 버스의 위치 오프셋(m) — 정차 자리를 0 으로 두고 **음수에서 0 으로** 붙는다.
 * 실내·주인공·카메라가 전부 이 값을 함께 받는다. 하나라도 빠뜨리면 그것만
 * 버스 안에서 미끄러진다.
 */
export const busDx = (t: number): number =>
  -APPROACH_M * (1 - easeOutCubic(seg(t, 0, BUS_STOP_MS)))

/**
 * 노면 진동 — **이동거리로 못 낸 속도를 여기서 낸다.**
 *
 * 1.5m 를 2.9초에 지나는 것만으로는 "달리는 버스"가 안 된다. 그런데 실제로 버스
 * 안에서 속도를 느끼는 경로는 시야의 이동보다 **몸의 흔들림**이다. 두 개의 서로
 * 안 맞는 주파수를 겹쳐 규칙적인 진동이 되지 않게 하고, 제동과 **같은 곡선으로**
 * 잦아들게 한다 — 버스가 서면 흔들림도 같이 그친다. 그 동시성이 "이제 섰다"를
 * 자막 없이 말해 준다.
 */
const busShake = (t: number): number => {
  const alive = 1 - easeOutCubic(seg(t, 0, BUS_STOP_MS))
  return (Math.sin(t / 61) * 0.55 + Math.sin(t / 23) * 0.45) * alive
}

/**
 * 제동 쏠림 — 완전히 서기 직전에 앞으로 쏠렸다가 돌아온다.
 *
 * 버스가 섰다는 것을 가장 확실하게 말해 주는 신체 감각이고, 이동 거리가 짧아도
 * 이것만은 그대로 느껴진다. `sin` 한 주기라 시작과 끝이 정확히 0 이다 — 잔여값이
 * 남으면 선 버스가 계속 기울어 있게 된다.
 */
const brakeDip = (t: number): number =>
  Math.sin(seg(t, BUS_STOP_MS - 400, BUS_STOP_MS + 260) * Math.PI * 2) * 0.055

// ─────────────────── 주인공 ───────────────────

export type ClipHint = 'Idle' | 'Walk' | 'Run'

export type ActorState = Readonly<{
  x: number
  y: number
  /** 지면(z=0) 기준 발 높이 — 버스 안에서는 바닥(0.9m) 위에 선다 */
  z: number
  /** 몸이 향하는 요 */
  facing: number
  clip: ClipHint
  /** 착석 정도 — 1 앉음 · 0 서 있음. `sit-pose.ts` 가 받는다 */
  sit: number
  /** 3인칭 구간에서만 보인다. 카메라가 머리에 닿으면 사라진다 */
  visible: boolean
}>

/**
 * 주인공의 자리.
 *
 * ★ 앉히지 않는다. `mc_character_rigged.glb` 의 클립은 Board·Hit·Idle·Jump·
 *   JumpAir·JumpLand·Run·Slide·Sprint·Stumble·Walk 열한 종이고 **앉은 자세가
 *   없다.** 없는 포즈를 억지로 만들면 무릎이 좌판을 뚫는다. 손잡이를 잡고 서 있는
 *   것으로 간다 — 출근길 버스에서 서서 가는 것은 오히려 흔한 그림이고,
 *   레퍼런스의 두 번째 컷도 서 있다. (앉은 포즈가 생기면 여기만 갈아 끼우면 된다.)
 */
export const actorAt = (tMs: number): ActorState => {
  const t = Math.max(0, Math.min(INTRO_MS, tMs))
  const dx = busDx(t)

  /**
   * 일어선다 → 문으로 걷는다 → 내려선다.
   *
   * `sit` 이 1 에서 0 으로 가는 동안 엉덩이가 좌면에서 바닥으로 내려온다.
   * 세 구간이 겹치지 않아야 "앉은 채로 걸어 나가는" 그림이 안 나온다.
   */
  const sit = 1 - seg(t, STAND_MS, STAND_MS + 380)
  const toDoor = easeInOut(seg(t, STAND_MS + 320, 4280))
  const down = seg(t, 4280, SWAP_MS)

  const inBusX = lerp(SEAT.x, DOORWAY.x, toDoor) + dx
  const inBusY = lerp(SEAT.y, DOORWAY.y, toDoor)

  return {
    x: lerp(inBusX, CURB.x, easeInOut(down)),
    y: lerp(inBusY, CURB.y, easeInOut(down)),
    /**
     * 앉아 있는 동안 리그 원점이 `SIT_DROP` 만큼 **내려간다.** 다리를 접는 것만으로는
     * 골반이 안 내려와 좌석 위에 서 있게 된다(`sit-pose.ts` 참고).
     */
    z: lerp(BUS.floor, 0, easeIn(down)) - sit * SIT_DROP,
    /**
     * 앉아서는 진행 방향(동, yaw 0)을 본다 — 좌석이 그쪽을 보고 있으니 당연하다.
     * 일어나면 문(북)을 향해 돈다.
     */
    facing: lerp(lerp(0, DOOR_YAW, seg(t, STAND_MS, STAND_MS + 520)), DOOR_YAW, down),
    clip: down >= 1 ? 'Run' : toDoor > 0 ? 'Walk' : 'Idle',
    sit,
    visible: t < SWAP_MS,
  }
}

// ─────────────────── 카메라 ───────────────────

/**
 * 마지막 포즈 = **1인칭이 스폰에서 잡는 포즈와 같은 값**.
 *
 * `camera-rig.ts` 의 1인칭 분기가 눈을 `(pos.x, pos.z + FPV.eyeHeight, −pos.y)` 에
 * 놓고 회전을 `(lookPitch, lookYaw − π/2, 0)` 으로 준다. 입력의 초기 시선은 0 이므로
 * 요·피치 모두 0 이고, 요 0 은 위 규약대로 **동쪽 = 역 방향**이다.
 */
export const FINAL_POSE: IntroPose = {
  x: SPAWN.x, y: SPAWN.y, eye: SPAWN.z + FPV.eyeHeight, yaw: 0, pitch: 0, fov: FPV.fovDeg,
}

/**
 * 3인칭 카메라의 어깨 오프셋 — 주인공 기준 (동쪽, 북쪽, 위). **둘 다 음수다.**
 *
 * 즉 카메라는 주인공의 **남서쪽**에 있고 북동쪽을 본다. 이 부호가 연출의 핵심이다.
 *
 *  · 창(북측)이 주인공 **뒤에** 놓인다 → 레퍼런스 1번 컷의 구도이고,
 *    지나가는 도심이 인물 뒤로 흐른다.
 *  · 시선이 **동쪽을 향한다** → 지도가 끝나는 서쪽(x −64)이 화면에 안 들어온다.
 *    반대로 동쪽에 두고 서쪽을 보게 했더니 요가 161° 가 나왔다 — 그건 그대로
 *    허공을 정면으로 보는 각이다.
 *
 * 거리 1.9m 는 3등신 SD(키 1.2m)를 리액션이 읽히는 크기로 잡는 선이고,
 * 동시에 버스 폭(y 19.1~21.7) 안에 카메라를 남겨 두는 한계이기도 하다.
 */
const SHOULDER = { e: -0.85, n: -0.56, up: -0.10 } as const

/**
 * 겨냥점 높이(m) — 발에서 여기까지.
 *
 * ⚠ 처음엔 0.82 로 잡았다. "3등신 SD 는 키가 1.2m" 라는 `p1-shots.spec.ts` 의 주석을
 *   믿고 가슴 높이를 계산한 값이었는데, **실측하니 1.48m** 였다(`introProbe` 로 잰
 *   바운딩 박스: 발 0.9 · 머리 2.379). 0.82 는 배꼽이라, 머리가 화면 위로 밀리고
 *   아래 절반이 통째로 바닥이 됐다 — 스크린샷에서 접지 그림자가 주인공보다
 *   눈에 띄었던 이유다. 주석의 숫자보다 잰 숫자가 먼저다.
 */
const AIM_H = 1.15
/** 앉아 있을 때의 겨냥점 — 좌면 위 몸통 */
const AIM_H_SIT = 0.72

export const poseAt = (tMs: number): IntroPose => {
  const t = Math.max(0, Math.min(INTRO_MS, tMs))

  // ── SHOT 4 — 1인칭 질주. 여기만 주인공과 무관하게 움직인다
  if (t >= SWAP_MS) {
    const u = seg(t, SWAP_MS, INTRO_MS)
    /**
     * 거리는 2.9m 뿐이다. **속도감은 거리가 아니라 화각과 각속도로 만든다** —
     * 실제로 이 게임의 1인칭도 스프린트에서 화각만 8° 넓혀 속도를 낸다(`FPV.sprintFov`).
     * 여기서는 그보다 크게 열었다가 마지막에 정확히 기본값으로 닫는다. 닫히지 않으면
     * 조작권이 넘어온 순간 화각이 한 번 튄다.
     */
    const punch = Math.sin(clamp01(u * 1.15) * Math.PI)
    return {
      // 첫 0.3초는 몸을 트는 시간이라 거의 안 나간다 → easeIn 으로 출발을 눌러 둔다
      x: lerp(CURB.x, FINAL_POSE.x, easeIn(u) * 0.35 + easeInOut(u) * 0.65),
      y: lerp(CURB.y, FINAL_POSE.y, easeInOut(u)),
      eye: FPV.eyeHeight + Math.sin(u * Math.PI * 5.4) * 0.035 * Math.sin(u * Math.PI),
      // 문 쪽에서 동쪽(역)으로 몸을 튼다. 회전의 대부분을 앞쪽 40% 에서 끝낸다
      yaw: lerp(DOOR_YAW, 0, easeOutCubic(u / 0.4)),
      pitch: 0,
      fov: FPV.fovDeg + punch * 11,
    }
  }

  // ── SHOT 1~3 — 3인칭. 주인공을 따라다니다 **머리로 수렴한다**
  const a = actorAt(t)
  /**
   * 어깨 거리가 1 → 0 으로 줄면서 3인칭이 1인칭이 된다.
   *
   * 마지막 420ms 에 몰아서 붙인다. 처음부터 천천히 붙이면 "따라가는 카메라"가
   * 아니라 "계속 다가오는 카메라"가 되어 버스 안 장면 내내 불안하다.
   */
  const close = easeInOut(seg(t, SWAP_MS - 420, SWAP_MS))
  // 휴대폰 구간에서 한 뼘 들어간다 — 리액션을 크게 본다
  const push = 1 - 0.24 * easeInOut(seg(t, SHOT.bus, SHOT.bus + 500))
  const k = (1 - close) * push

  const shake = busShake(t)
  const camX = a.x + SHOULDER.e * k
  const camY = a.y + SHOULDER.n * k
  const aimZ = a.z + lerp(AIM_H, SEAT_TOP - BUS.floor + AIM_H_SIT, a.sit)
  const camZ = lerp(a.z + FPV.eyeHeight, aimZ + SHOULDER.up, k)

  /**
   * 어깨에서는 주인공을 바라보고, 머리에 닿으면 **주인공이 보는 방향**을 본다.
   * 거리가 0 이면 바라볼 방향이 정의되지 않으므로 두 값을 `close` 로 섞는다.
   */
  const dxw = a.x - camX
  const dyw = a.y - camY
  const dist = Math.hypot(dxw, dyw)
  const lookYaw = dist > 1e-4 ? Math.atan2(dyw, dxw) : DOOR_YAW
  const lookPitch = dist > 0.05 ? Math.atan2(aimZ - camZ, dist) : 0

  return {
    x: camX,
    y: camY,
    eye: camZ + shake * 0.02,
    yaw: lerp(lookYaw, DOOR_YAW, close),
    pitch: lerp(lookPitch, 0, close) + shake * 0.005 - brakeDip(t) * (1 - close),
    fov: FPV.fovDeg,
  }
}
