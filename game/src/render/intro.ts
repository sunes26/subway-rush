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
import { SIT_DROP } from './pose'

/** 샷 경계(ms). 합이 6.6초 — 브리프의 6~8초 안이다 */
/**
 * 네 개의 샷. **경계는 컷이다** — 그 사이를 카메라가 떠다니지 않는다.
 *
 * 이전 판은 어깨 오프셋 하나로 주인공을 계속 따라다녔다. 그게 "자유 카메라처럼
 * 움직인다"의 정체였다 — 촬영이 아니라 관찰이었고, 그래서 어느 한 프레임도
 * 구도가 잡히지 않았다. 이제 각 샷은 **자기 자리에 서서** 아주 조금만 민다.
 */
export const SHOT = {
  /** ① 버스 실내 미디엄 — 앉아 있다 */
  interior: 1400,
  /** ② 휴대폰 OTS — 어깨 너머로 화면이 읽힌다 */
  phone: 2800,
  /** ③ 버스 외부 · 문 — 기존 버스에서 내린다 */
  door: 4100,
  /** ④ 질주 팔로우 — 조작권이 넘어가는 곳 */
  dash: 5800,
} as const

export const INTRO_MS = SHOT.dash

/**
 * 카메라가 주인공의 머리에 도달해 1인칭이 되는 시각 = **인트로의 끝**.
 * 마지막 샷이 뒤에서 따라가다 그대로 눈으로 들어간다.
 */
export const SWAP_MS = INTRO_MS

/**
 * 버스가 완전히 멈추는 시각.
 *
 * 하차(SHOT 3)가 시작되는 2800ms 보다 **먼저**여야 한다. 브리프가 못 박은
 * *"움직이는 버스에서 뛰어내리는 것처럼 보이면 안 된다"* 가 이 한 줄이다.
 * 정지 후 300ms 를 비워 두어 "섰다"가 눈에 읽힌 뒤에 문이 열린다.
 */
export const BUS_STOP_MS = 2550

/** 문이 열리기 시작하는 시각 */
export const DOORS_MS = 2960

/**
 * 자리에서 일어서는 시각.
 *
 * ② 샷(1.4~2.8s) **안**이어야 한다. 컷 뒤에 일어나면 관객은 그 동작을 못 보고,
 * ③ 샷에서 밖에 나와 있는 주인공이 **순간이동**처럼 느껴진다. 일어나는 것까지
 * 보여 주고 문까지 걸어가는 사이를 컷으로 건너뛰는 것이 영화적 생략이다.
 */
export const STAND_MS = 2500

/**
 * ■ 서쪽 끝이 이 연출의 진짜 제약이다
 *
 * Z1 의 지면은 x −64 에서 시작한다(`Z1-ROAD`·`Z1-WALK`, 그 밖은 `Z1-END-W` 옹벽).
 * 처음엔 버스를 −86 에서 출발시켰는데 **지도 밖 허공**이었다 — 실측 스크린샷에서
 * 지면이 뚝 끊기고 그 아래로 하늘이 보였다. 세계가 공중에 뜬 섬처럼 보인다.
 *
 * 그래서 접근 거리는 1.2m 뿐이다. 이동만으로는 속도가 안 나온다. 대신 정류장에
 * **붙는 마지막 몇 미터**를 그리는 쪽으로 방향을 바꿨다 — 이야기도 "버스가
 * 지하철역에 거의 도착했을 때"이므로 이게 맞는 그림이다. 모자란 속도감은
 * `busShake`(노면 진동)와 `brakeDip`(제동 쏠림), 그리고 창틀 세로살이 만든다.
 */
const APPROACH_M = 1.2

/**
 * 앉은 자리 — **북측(연석 쪽) 1인석**. 좌석 배열에서 나온 자리다.
 *
 * 열은 `IN.xW + 0.75` 에서 0.80m 간격이므로 −62.08 이 실제 좌석 중심이고,
 * 북측 1인석의 중심 y 는 21.22 다. 카메라에서 고른 자리가 아니라 **좌석이 있는
 * 자리**다 — 브리프의 순서(좌석 → 착석 → 휴대폰 → 카메라)를 그대로 따랐다.
 * 창(북)이 등 뒤에 오고, 문(−60.3)이 1.8m 동쪽이라 일어나 두 걸음이면 닿는다.
 */
const SEAT = { x: -61.28, y: 21.20 } as const
/** 뒷문 안쪽 */
const DOORWAY = { x: DOOR_X, y: 21.05 } as const
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
 * 1.2m 를 2.55초에 지나는 것만으로는 "달리는 버스"가 안 된다. 그런데 실제로 버스
 * 안에서 속도를 느끼는 경로는 시야의 이동보다 **몸의 흔들림**이다. 두 개의 서로
 * 안 맞는 주파수를 겹쳐 규칙적인 진동이 되지 않게 하고, 제동과 **같은 곡선으로**
 * 잦아들게 한다 — 버스가 서면 흔들림도 같이 그친다. 그 동시성이 "이제 섰다"를
 * 자막 없이 말해 준다.
 */
export const busShake = (t: number): number => {
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
  /** 착석 정도 — 1 앉음 · 0 서 있음. `pose.ts` 가 받는다 */
  sit: number
  /** 휴대폰을 들어 본 정도 — 1 봄 · 0 내림 */
  phone: number
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
   * 앉음 → 일어섬 → 문으로 → 내려섬 → 질주.
   * 구간이 겹치지 않아야 "앉은 채로 걸어 나가는" 그림이 안 나온다.
   */
  const sit = 1 - seg(t, STAND_MS, STAND_MS + 300)
  const toDoor = easeInOut(seg(t, STAND_MS + 240, 3280))
  /**
   * 내려서는 구간. ③ 샷(2.8~4.1s) 안에서 **문 열림 → 하차**가 다 보여야 한다.
   * 3.62s 에 시작했더니 문만 열린 빈 버스를 900ms 나 보게 됐다 — 앞당긴다.
   */
  const down = seg(t, 3300, SHOT.door)
  const run = seg(t, SHOT.door, INTRO_MS)

  const inBusX = lerp(SEAT.x, DOORWAY.x, toDoor) + dx
  const inBusY = lerp(SEAT.y, DOORWAY.y, toDoor)
  const offX = lerp(inBusX, CURB.x, easeInOut(down))
  const offY = lerp(inBusY, CURB.y, easeInOut(down))

  return {
    // 내려선 뒤 스폰까지 달린다 — 조작권은 도착하는 순간 넘어간다
    x: lerp(offX, SPAWN.x, easeIn(run) * 0.3 + easeInOut(run) * 0.7),
    y: lerp(offY, SPAWN.y, easeInOut(run)),
    /**
     * 앉은 동안 리그 원점이 `SIT_DROP` 만큼 **내려간다.** 다리를 접는 것만으로는
     * 골반이 안 내려와 좌석 위에 서 있게 된다(`pose.ts` 참고).
     */
    z: lerp(lerp(BUS.floor, 0, easeIn(down)), 0, run) - sit * SIT_DROP,
    /**
     * 앉아서는 진행 방향(동, yaw 0)을 본다 — 좌석이 그쪽을 보고 있으니 당연하다.
     * 일어나면 문(북)으로 돌고, 내린 뒤엔 다시 동쪽(역)으로 튼다.
     */
    facing: lerp(
      lerp(0, DOOR_YAW, seg(t, STAND_MS, STAND_MS + 480)),
      0, easeOutCubic(run / 0.35),
    ),
    // 휴대폰은 ② 샷에서만 든다
    phone: seg(t, SHOT.interior - 180, SHOT.interior + 220)
      * (1 - seg(t, SHOT.phone - 260, SHOT.phone)),
    clip: run > 0 ? 'Run' : toDoor > 0 ? 'Walk' : 'Idle',
    sit,
    visible: t < INTRO_MS,
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
 * ④ 질주 팔로우의 뒤따르는 거리 — 주인공 기준 (동쪽, 북쪽).
 *
 * 동쪽으로 달리므로 e 는 음수(뒤)다. n 도 음수라 **정후방이 아니라 3/4 후방**이 된다 —
 * 정중앙에서 멀리 따라가면 주인공만 크게 보이고 어디로 가는지가 안 읽힌다.
 * 비스듬히 서면 주인공의 움직임과 **역 방향(동쪽)** 이 한 화면에 같이 들어온다.
 */
const FOLLOW = { e: -1.72, n: -0.78 } as const



/**
 * 샷 하나 = **고정된 자리에서 한 점을 본다.** 아주 조금만 민다(dolly).
 * 두 점을 주고 `u` 로 섞는 것이 곧 그 미는 양이다.
 */
const framed = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  at: readonly [number, number, number],
  u: number,
  dx = 0,
): IntroPose => {
  const e = easeInOut(u)
  const x = lerp(from[0], to[0], e) + dx
  const y = lerp(from[1], to[1], e)
  const z = lerp(from[2], to[2], e)
  const ax = at[0] + dx
  const d = Math.hypot(ax - x, at[1] - y)
  return {
    x, y, eye: z,
    yaw: Math.atan2(at[1] - y, ax - x),
    pitch: Math.atan2(at[2] - z, d),
    fov: FPV.fovDeg,
  }
}

export const poseAt = (tMs: number): IntroPose => {
  const t = Math.max(0, Math.min(INTRO_MS, tMs))
  const a = actorAt(t)
  const shake = busShake(t)
  const dx = busDx(t)

  /**
   * ── ① 버스 실내 미디엄. **3/4 정면**이다.
   *
   * ⚠ 처음엔 카메라를 주인공 **뒤쪽**(서쪽)에 뒀다. 주인공이 동쪽을 보고 앉아
   *   있으니 화면 한복판이 뒤통수와 등받이가 됐고, 그 한 장으로는 아무것도
   *   전달이 안 됐다 — "버스를 타고 역으로 가는 사람"이 안 읽힌다.
   *
   * 그래서 **앞쪽(동쪽) 통로**로 옮겨 돌아본다. 그러면
   *   · 얼굴·상체·팔·다리와 좌석이 한 화면에 들어오고
   *   · 창(북)이 인물 뒤에 놓여 지나가는 도심이 배경이 되며
   *   · 앞좌석 등받이와 봉이 전경으로 깔린다
   * 스토리보드 첫 컷의 구도가 정확히 이것이다.
   */
  if (t < SHOT.interior) {
    const p = framed(
      [SEAT.x + 1.66, SEAT.y - 1.08, 1.46],
      [SEAT.x + 1.50, SEAT.y - 1.01, 1.42],
      [SEAT.x + 0.02, SEAT.y + 0.02, 1.12],
      seg(t, 0, SHOT.interior), dx,
    )
    return { ...p, eye: p.eye + shake * 0.02, pitch: p.pitch + shake * 0.005 - brakeDip(t) }
  }

  /**
   * ── ② 휴대폰 OTS. 오른쪽 어깨 너머다.
   *
   * 주인공이 동쪽을 보고 앉아 있으므로 **뒤 = 서쪽 · 오른쪽 = 남쪽**이다.
   * 클로즈업으로 화면만 꽉 채우지 않는다 — 인물이 남아 있어야 같은 버스 안이라는
   * 것이 유지된다(브리프 §17).
   */
  if (t < SHOT.phone) {
    const p = framed(
      [SEAT.x - 0.58, SEAT.y - 0.50, 1.62],
      [SEAT.x - 0.46, SEAT.y - 0.42, 1.56],
      [SEAT.x + 0.34, SEAT.y - 0.24, 1.14],
      seg(t, SHOT.interior, SHOT.phone), dx,
    )
    return { ...p, eye: p.eye + shake * 0.015, pitch: p.pitch + shake * 0.004 - brakeDip(t) }
  }

  /**
   * ── ③ 버스 외부 · 문. **기존 버스 외피를 그대로 보여 주는 샷이다.**
   *
   * 인도 위, 쉘터(x −60~−56 · y 23.4~25.4) **바깥**에 선다. 거기서 서쪽을 보면
   * 버스 옆면과 뒷문(−60.3)이 한 화면에 들어오고, 주인공이 그 문에서 나온다.
   * "아까 그 버스에서 내리는구나"가 이 한 장으로 읽혀야 한다.
   *
   * ⚠ 처음엔 쉘터 **동쪽**에 세웠다. 두 번 다 유리 패널이 화면을 덮어 버스가
   *   회백색 판때기로 보였다 — `__game.pick()` 으로 찍으니 2.5~3m 앞의
   *   `merged:BLD_GLASS`, 쉘터였다. 눈으로만 보면 "실내가 외피를 뚫었나" 로
   *   헛짚는다.
   *
   *   쉘터는 x −60~−56 · y 23.4~25.4 다. 그 **서쪽**(x −63.2)에서 동남동을 보면
   *   시선이 문(−60.3)에 닿을 때까지 쉘터 x 범위에 아예 안 들어간다. 덤으로
   *   버스가 동쪽으로 뻗어 보이는 3/4 구도가 나온다.
   */
  if (t < SHOT.door) {
    return framed(
      [-63.7, 24.15, 2.02],
      [-63.3, 23.75, 1.94],
      [DOOR_X + 0.12, 22.30, 1.18],
      seg(t, SHOT.phone, SHOT.door),
    )
  }

  /**
   * ── ④ 질주 팔로우 → 1인칭.
   *
   * 뒤에서 따라가다 **머리 속으로 들어가** 그대로 조작권이 된다. 거리가 0 이 되는
   * 순간이 곧 시점 전환이라 이음매가 없다. 마지막 값은 `FINAL_POSE` 와 같아야 한다.
   */
  const u = seg(t, SHOT.door, INTRO_MS)
  const close = easeInOut(seg(t, INTRO_MS - 520, INTRO_MS))
  const k = 1 - close
  const camX = a.x + FOLLOW.e * k
  const camY = a.y + FOLLOW.n * k
  // 카메라를 낮춘다 — 눈높이보다 아래에서 올려다보면 달리는 속도가 커 보인다
  const camZ = lerp(FPV.eyeHeight, a.z + 1.12, k)
  const aimZ = a.z + 0.95
  const ddx = a.x - camX
  const ddy = a.y - camY
  const dist = Math.hypot(ddx, ddy)
  const lookYaw = dist > 1e-4 ? Math.atan2(ddy, ddx) : 0
  const lookPitch = dist > 0.05 ? Math.atan2(aimZ - camZ, dist) : 0
  /** 속도감은 거리가 아니라 화각이 만든다. 끝에서 정확히 기본값으로 닫힌다 */
  const punch = Math.sin(clamp01(u * 1.2) * Math.PI)
  return {
    x: camX,
    y: camY,
    eye: camZ + Math.sin(u * Math.PI * 6) * 0.02 * Math.sin(u * Math.PI),
    yaw: lerp(lookYaw, 0, close),
    pitch: lerp(lookPitch, 0, close),
    fov: FPV.fovDeg + punch * 9,
  }
}
