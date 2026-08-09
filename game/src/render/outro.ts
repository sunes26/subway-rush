/**
 * 엔딩 컷 — **시간의 순수 함수다.** `render/intro.ts` 와 같은 설계다.
 *
 * dt 를 누적해 상태를 굴리면 프레임이 튈 때 연출이 같이 튀고, 무엇보다 마지막
 * 프레임의 그림을 테스트로 못 박을 수 없다. 순수 함수면 `outroAt(kind, OUTRO_MS)` 를
 * 유닛 테스트가 단정할 수 있다.
 *
 *
 * ■ 판정은 여기서 안 한다
 *
 * 이 파일은 **이미 확정된 결과를 받아 그림으로 옮기기만 한다.** 성공/실패도,
 * 열차 방향도, 탑승 여부도 다시 계산하지 않는다 — 전부 `data/endings.ts` 와
 * `systems/train.ts` 가 끝낸 일이고, 여기 오는 것은 `OutroKind` 세 글자뿐이다.
 *
 *
 * ■ 무대 (`render/ending-stage.ts`)
 *
 * 주인공은 이미 객실 안에 서 있다(`Z5-CABIN`, y 12.2~15.45 · 바닥 z −20).
 * 남쪽(y 12.4)이 방금 닫힌 문, 북쪽(y 15.45)이 창이다. 카메라는 그 사이 3m 안에서만
 * 움직인다 — 좁은 것이 맞다. 지하철 객실은 원래 좁고, **좁아야 창이 크게 보인다.**
 *
 *
 * ■ 왜 세 컷인가
 *
 * 반복 플레이 게임이라 길이를 7초로 묶었다. 그 안에 담을 수 있는 것은 셋뿐이다:
 *   ① 몸이 먼저 말한다 — 안도든 탈진이든, 캐릭터를 본다
 *   ② 시선이 밖으로 나간다 — 카메라가 창으로 옮겨 간다
 *   ③ 바깥이 답한다 — 터널이 걷히고 강이 나오거나, 안내판이 신촌을 띄운다
 *
 * WRONG WAY 만 ③ 에서 **카메라가 다시 사람에게 돌아온다.** 바깥이 답을 준 뒤에
 * 그 답을 받아 든 얼굴이 있어야 농담이 성립하기 때문이다.
 */

import { clamp01, easeInOut, lerp } from '../core/math'
import { TRAIN } from '../data/tuning'
import { FLOOR } from '../data/world'

export type OutroKind = 'success' | 'jit' | 'wrongway'

/**
 * 컷 경계(ms). ③ 이 가장 길다 — 바깥을 보는 시간이 이 연출의 목적이다.
 *
 * ★ 5.2 → 7.0 → **8.5 초.** 두 번 늘렸고 이유가 각각 다르다.
 *
 *   5.2 초에서는 ③ 이 2.1 초라 터널이 걷히는 것을 보다가 끝났다 — 드러난 풍경을
 *   **보고 있을 시간**이 없었다. 7.0 으로 늘려 그건 해결됐다.
 *
 *   8.5 는 다른 문제다. **문구가 뜨자마자 화면이 끝났다** — 성공 계열은 여운이
 *   0.9 초뿐이었다. 그리고 앞에 걸어 들어오는 0.7 초(`WALK_MS`)가 붙으면서 ① 이
 *   실질 1.4 초로 줄었다. 늘린 1.5 초를 ① 에 0.2 · ③ 에 1.3 으로 나눴다.
 *
 *   이제 각 구간이 브리프 기준을 넘긴다:
 *     일출/지옥이 **완전히 드러난 채로** 보이는 시간  3.6~4.2 초
 *     문구가 뜬 뒤 남는 여운                          2.6~3.8 초
 *
 * ⚠ 아래 연출 시각은 전부 이 세 값에서 파생시킨다. 밀리초를 박아 두면 길이를 바꿀
 *   때마다 조용히 어긋난다 — `render/intro.ts` 가 같은 이유로 같은 규칙을 쓴다.
 */
export const SHOT = {
  /** ① 몸 — 걸어 들어와 힘이 풀리거나, 무너진다 */
  body: 2300,
  /** ② 시선 — 카메라가 창으로 */
  turn: 4000,
  /** ③ 바깥 — 일출 / 안내판 */
  outside: 8500,
} as const

export const OUTRO_MS = SHOT.outside

/** 카메라 눈높이(바닥 기준 m). 선 사람의 눈보다 조금 낮다 — 올려다보면 객실이 커 보인다 */
const EYE = 1.46

export type OutroCam = Readonly<{
  /** 월드 x · y · 절대 고도 z */
  x: number
  y: number
  eye: number
  /**
   * 카메라 흔들림(m) — x·eye 에 그대로 더한다. WRONG WAY 에서만 0 이 아니다.
   *
   * ★ **지속 흔들림이 아니다.** 안내판을 읽은 직후 0.45초, 진폭 2cm 로 감쇠하고 끝난다.
   *   판이 끝난 뒤 보는 화면이라 계속 흔들면 멀미만 남는다 — 놀란 한 순간이면 된다.
   */
  shakeX: number
  shakeZ: number
  /** 바라보는 지점 (월드) */
  lx: number
  ly: number
  lz: number
  fov: number
}>

/**
 * 컷 동안 주인공이 서는 y — **객실 안쪽으로 들여세운다.**
 *
 * 탑승 판정은 문틀을 갓 넘으면(`TRAIN.cabinBoardY` 13.0) 성립하므로, 판이 끝나는
 * 순간 주인공은 대개 문 바로 안쪽에 서 있다. 거기서는 **카메라를 뒤로 못 뺀다** —
 * 남쪽 1m 안에 안전문과 차문이 있어서 물러나는 순간 그것들이 화면을 막는다(실측:
 * 인물이 머리와 어깨만 잡혔다). 그래서 인트로가 주인공을 직접 몰아주듯
 * (`render/intro.ts actorAt`) 여기서도 서는 자리를 준다. 시뮬은 이미 끝났고
 * 이 값은 렌더에만 쓰이므로 판정에 아무 영향이 없다.
 *
 * x 도 마찬가지로 컷이 정한다 — **창 앞**(`anchorXOf`)이다. 판이 끝난 자리에 그냥
 * 두면 문 앞이라 뒤가 문틀이고, 인물 뒤에 창이 안 온다.
 *
 * ★ 14.90 → 14.35 → **13.95.** 두 번 당겼고, 두 번째 이유가 첫 번째와 다르다.
 *
 *   14.90 은 진짜로 파묻혔다(몸통이 좌석 안에 들어갔다). 14.35 로 당겨 그건 없앴다 —
 *   실측으로 좌석 앞면이 y **15.14**, 몸통 뒤가 14.70 이라 0.44m 가 떴다. 기하학적
 *   으로는 안 겹친다. 그런데 **화면에서는 여전히 껴 보였다.** 컷 카메라는 창을
 *   정면에 가깝게 보므로 0.44m 는 화면에서 몇 픽셀이고, 인물 실루엣과 좌석 등받이·
 *   벽 띠가 같은 가로 띠에 겹쳐 앉는다. 안 닿았다는 것과 떨어져 보인다는 것은 다르다.
 *
 *   그래서 **통로 한가운데**로 옮겼다. 실측한 객실 내부는 y 12.40~15.48(폭 3.08m)
 *   이고 그 중심이 13.94 다. 여기 서면 좌석까지 1.19m — 화면에서 인물 뒤로 실제
 *   공간이 생긴다. 지하철에서 서서 가는 사람이 원래 서는 자리이기도 하다.
 *
 * ⚠ 당긴 만큼 카메라가 가까워진다(1.80 → 1.40m). 그대로 두면 얼굴만 잡히므로
 *   화각을 넓히고 옆으로 조금 더 비켜섰다 — 아래 카메라 주석을 보라.
 */
export const STAND_Y = 13.95

export type OutroActor = Readonly<{
  /** 컷 동안 서 있을 x (월드) — **창 앞**이다. 판이 끝난 자리를 그대로 쓰지 않는다 */
  x: number
  /** 컷 동안 서 있을 y (월드) */
  y: number
  /** 재생할 클립 — 없으면 그대로 둔다. 이름은 `render/player-rig.ts ClipName` 그대로다 */
  clip: 'Idle' | 'Walk' | 'Stumble' | 'Hit' | null
  /** 무릎 짚기 0~1 (`render/pose.ts` BRACE) */
  brace: number
  /** 머리 감싸기 0~1 (`render/pose.ts` SLUMP) */
  slump: number
  /** 몸이 향하는 요(rad). +x 가 0, +y 가 π/2 */
  facing: number
}>

export type OutroStage = Readonly<{
  /** 터널 불투명도 1 → 0. 내려가면 일출이 드러난다 */
  tunnel: number
  /** 창밖이 흐른 누적 거리 — 증가율이 곧 속도다 */
  scroll: number
  /** 차내 안내판 불투명도 */
  led: number
  /**
   * 창밖 빛이 객실로 들어오는 정도 0~1.
   *
   * `tunnel` 의 거울상이 아니다 — 터널이 걷히는 것보다 **조금 늦게, 조금 더 길게**
   * 오른다. 빛이 먼저 들어오면 아직 안 보이는 것이 비추는 꼴이 되고, 정확히 같이
   * 움직이면 두 값이 하나라는 뜻이라 따로 둘 이유가 없다.
   */
  glow: number
  /**
   * 실내 라이트맵 배율 (1 = 평소).
   *
   * 창밖은 톤매핑을 안 거쳐 원본 그대로 나오는데 실내가 환한 낮이면 **노출차가
   * 안 생긴다** — 지옥 컷에서 특히 이상하다(창밖은 용암인데 객실은 대낮이다).
   * 실내를 내리면 창이 상대적으로 타오른다.
   *
   * 성공 계열은 조금만 내린다. 일출은 **밝은 아침**이라 객실까지 어두우면 그건
   * 안도가 아니라 불안이 된다 — 창으로 빛이 들어오는 그림이어야 한다.
   */
  dim: number
  /** 화면 전체에 얹는 붉은 기 0~1 (WRONG WAY 전용) */
  red: number
  /**
   * 번개 — 창밖 빛의 **순간 배율** (1 = 평소). WRONG WAY 전용.
   *
   * 새 광원을 만들지 않는다. 이미 있는 용암 광원의 강도를 짧게 튀길 뿐이라
   * 정리할 것도, 성능에 얹히는 것도 없다.
   */
  flash: number
}>

export type OutroFrame = Readonly<{ cam: OutroCam; actor: OutroActor; stage: OutroStage }>

const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))

/** 두 카메라 자리 사이를 부드럽게 오간다. 컷 안에서는 **아주 조금만** 민다 */
const mix = (a: OutroCam, b: OutroCam, k: number): OutroCam => ({
  x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), eye: lerp(a.eye, b.eye, k),
  lx: lerp(a.lx, b.lx, k), ly: lerp(a.ly, b.ly, k), lz: lerp(a.lz, b.lz, k),
  fov: lerp(a.fov, b.fov, k),
  shakeX: 0, shakeZ: 0,
})

/**
 * 놀란 한 순간의 흔들림. **안내판을 읽은 직후 0.45초**에 몰려 있고 지수로 잦아든다.
 * 두 축의 주파수를 서로 안 맞게 둬(38Hz · 27Hz) 규칙적인 진동으로 안 읽히게 한다 —
 * `render/intro.ts busShake` 가 노면 진동에 쓴 것과 같은 수법이다.
 */
const shakeAt = (t: number): { x: number; z: number } => {
  const u = seg(t, SHOT.turn, SHOT.turn + 450)
  if (u <= 0 || u >= 1) return { x: 0, z: 0 }
  const fall = (1 - u) ** 2
  return {
    x: Math.sin(t / 26) * 0.020 * fall,
    z: Math.sin(t / 37) * 0.014 * fall,
  }
}

/**
 * 창밖 판이 서는 y — **여기가 단일 출처다.** 무대(`ending-stage.ts`)가 이 값을 읽는다.
 *
 * ⚠ 방향이 반대면 안 된다. 무대는 모듈 최상위에서 캔버스를 만드는데(부팅 때 텍스처를
 *   준비하려고), 이 파일이 무대를 import 하면 **유닛 테스트가 무대까지 끌고 온다** —
 *   node 에는 `document` 가 없어 수집 단계에서 터진다(실측). 이 파일은 DOM 을
 *   모르는 순수 함수로 남아야 테스트가 컷을 단정할 수 있다.
 */
export const GLASS_Y = 15.38

/**
 * 열차 속도감 — 출발은 **눌러서 시작한다.** 처음부터 최고 속도로 흐르면 이미 달리던
 * 열차에 올라탄 것처럼 보인다. 2초에 걸쳐 붙고 그 뒤로는 일정하다.
 */
const scrollAt = (t: number): number => {
  const ramp = 2000
  if (t <= ramp) return (t * t) / (2 * ramp) / 1000
  return (ramp / 2 + (t - ramp)) / 1000
}

/**
 * 한 객차 안의 **안전한 창 중심** 오프셋(차량 앞단 기준 m).
 *
 * 문은 객차 16m 안에 +2 · +6 · +10 · +14 네 곳이다(`TRAIN.doorOffsets`). 그 사이
 * 중점이 곧 창 한가운데이므로 **+4 · +8 · +12** 세 곳이 나온다. 마지막 문(+14) 옆
 * 중점은 +16 인데 그것은 **다음 차량의 앞단** — 즉 차량 연결부다. 그래서 목록에서
 * 빠진다. 이 한 줄이 이 함수의 전부이자, 오래 끌던 버그의 답이다(`anchorXOf` 참고).
 */
const WINDOW_OFFSETS: readonly number[] = TRAIN.doorOffsets
  .slice(0, -1)
  .map((o, i) => (o + (TRAIN.doorOffsets[i + 1] as number)) / 2)

/**
 * 컷의 기준점 — **차창 하나의 중심.** 카메라·인물·무대가 전부 이 x 에 걸린다.
 *
 * ★ **플레이어의 x 를 쓰면 안 된다.** 오래 헤맨 자리라 이유를 남긴다:
 *
 *   카메라가 보는 것(창이냐 반대편 문이냐)은 **열차의 것**인데, 카메라를 사람 기준으로
 *   놓으면 그 둘이 따로 논다. 객차는 양쪽에 문이 있고 문 간격 4m · 개구 1.6m 라
 *   창은 문 사이 2.4m 구간에만 있다. 그런데
 *     · 열차는 출발하며 **0.54m 미끄러진 자리**에서 시뮬이 언다(실측 x=77.456)
 *     · 사람도 걸어 들어가며 **0.24m 밀린다**(실측 px=111.76)
 *   그래서 사람 기준 카메라가 문틀 가장자리에서 3.6cm 앞에 서는 일이 생겼고,
 *   어느 컷이 창을 물고 어느 컷이 문틀에 막히는지가 사실상 우연이었다.
 *
 *   `boardedDoorX` 는 **명목 좌표**(`DOOR_XS`)라 열차가 밀린 만큼을 더해야 실제
 *   렌더 위치가 된다 — `render/train-rig.ts` 와 `station.ts` 가 쓰는 그 오프셋이다.
 *
 * ★★ **한때 `doorX + 2.0` 이었다. 문 넷 중 하나에서 사람을 연결부에 세웠다.**
 *
 *   문은 4m 간격이라 "+x 로 2m" 가 대개 창 한가운데로 떨어진다. 그런데 객차 마지막
 *   문(+14)에서는 그 2m 가 **차량 경계(+16)** 에 정확히 앉는다. 32개 문 중 8개가
 *   여기 해당하고, 마지막 문(204)은 앵커가 206 — **열차 꼬리 끝, 객실 밖**이었다.
 *
 *   실측(레이를 통로 한가운데에서 창 쪽으로 쏨):
 *
 *     문 112(+2) · 116(+6) · 120(+10) → 좌석 1.42m · 창 1.51m · 차체 1.53m
 *     문 124(+14)                     → **아무것도 없음.** 16m 밖 역 벽까지 관통
 *                                        (열차 길이 방향으로는 `TR_JOINT@0` — 연결부 안)
 *
 *   E2E 가 이걸 못 잡은 이유도 같이 남긴다: 스펙이 `DOOR_XS[8]`(오프셋 +2) **하나만**
 *   썼다. 깨지는 8개 문은 테스트가 한 번도 밟은 적이 없었다. 그래서 "고쳤는데
 *   그대로다"가 세 번 반복됐다 — 통로 중앙(y)만 보고 x 를 안 본 것이다.
 *
 *   이제 **가장 가까운 안전 창 중심**(`WINDOW_OFFSETS`)을 고른다. +2·+6·+10 문은
 *   결과가 예전과 완전히 같고(각각 +4·+8·+12), +14 문만 −x 쪽 +12 로 간다.
 *   어느 문이든 이동 거리가 2m 로 같아서 걸어가는 시간도 문마다 안 달라진다.
 *
 * @param doorX  탄 문의 명목 x (`state.boardedDoorX`)
 * @param trainX 지금 그 열차의 1량 앞단 x (`state.train.x` 또는 `train2.x`)
 */
export const anchorXOf = (doorX: number, trainX: number): number => {
  const fromFirst = doorX - TRAIN.firstCarX
  const car = Math.floor(fromFirst / TRAIN.carLength)
  const inCar = fromFirst - car * TRAIN.carLength
  let best = WINDOW_OFFSETS[0] as number
  for (const o of WINDOW_OFFSETS) {
    if (Math.abs(o - inCar) < Math.abs(best - inCar)) best = o
  }
  return TRAIN.firstCarX + car * TRAIN.carLength + best + (trainX - TRAIN.firstCarX)
}

/**
 * 탄 자리 → 앵커까지 **걸어가는 시간(ms).**
 *
 * 순간이동을 안 쓴다. 컷이 이미 카메라를 잡고 있어서 사람이 텔레포트하면 그게
 * 그대로 보인다 — 페이드로 가리는 것도 5초짜리 컷의 첫 박자를 통째로 쓰는 짓이다.
 *
 * 어느 문에서 타든 걸어갈 거리는 **정확히 2m 로 같다**(`anchorXOf` 참고). 그래서
 * 시간을 문마다 안 나눠도 되고, 속도가 늘 초속 3m 남짓이라 뛰지도 어슬렁대지도 않는다.
 *
 * JIT 만 짧다. **몸이 급해야 하기 때문**이고, 그래야 뒤따르는 휘청임이 "뛰어들어와
 * 멈추지 못한 것"으로 읽힌다. 같은 배경을 쓰는 두 엔딩을 가르는 것은 템포뿐이다.
 *
 * ⚠ 이동 중에는 **충돌을 안 지난다.** 컷은 `movementSystem`(이미 `phase !== 'playing'`
 *   에서 반환한다)이 아니라 이 함수가 좌표를 직접 쓰므로 `resolveMove`·`depenetrate`
 *   가 개입하지 않는다. 콜라이더를 임시로 끌 필요도, 되돌릴 필요도 없다.
 */
export const WALK_MS: Readonly<Record<OutroKind, number>> = {
  success: 700,
  jit: 520,
  wrongway: 700,
}

/**
 * @param kind 확정된 결과 — 여기서 다시 판정하지 않는다
 * @param tMs  컷 시작부터의 경과
 * @param ax   창 중심 x (`anchorXOf`). 카메라·인물·무대가 전부 이 값에 걸린다
 * @param yOff 반대 방면이면 `Y_OFFSET_OPP`. 두 승강장은 y 만 다르므로 전부 여기에 더한다
 * @param from 판이 끝난 자리(월드). 여기서 앵커까지 걸어온다. 생략하면 이미 앵커에 선다
 */
export const outroAt = (
  kind: OutroKind, tMs: number, ax: number, yOff = 0,
  from?: { x: number; y: number },
): OutroFrame => {
  const t = Math.max(0, Math.min(OUTRO_MS, tMs))
  const z = FLOOR.B2

  /**
   * ★ 카메라는 **언제나 북쪽(창)을 향한다.**
   *
   * 처음엔 객차 길이 방향(−x)으로 잡았다가 실측에서 통째로 틀렸다: 객실은 x 로
   * 128m 짜리 긴 통이라, 길이 방향을 보면 우리가 세운 무대(폭 14m)를 지나 **역이
   * 그대로 보인다** — 열차를 탄 사람이 아직 승강장에 서 있는 그림이 나왔다.
   * 북쪽을 보면 시야가 창 벽 하나로 막히고, 그 벽이 곧 이 컷의 배경이다.
   */

  /**
   * ★ 시선이 **북에서 크게 안 벗어난다.** 처음엔 x 로 1.6m 옆에서 잡았는데, 그러면
   *   32m 짜리 벽을 42° 로 비껴보게 되어 화면이 **객실이 아니라 복도**가 됐다(실측).
   *   실제 객차는 폭이 3m 남짓이고, 우리가 그 안에서 보는 것은 늘 **정면에 가까운
   *   맞은편 벽**이다. 옆으로 0.4~1.0m 만 비켜서면 인물이 3/4 로 서면서도 벽은
   *   거의 정면으로 남는다.
   */

  /**
   * ★ 카메라는 **창 앞 빈 공간**에 선다 — 문 개구가 아니라.
   *
   * 문 개구(±0.8m) 안에 서면 문틀·칸막이가 화면을 양쪽에서 자른다. 반대로 문 중심을
   * 정면으로 보면 **맞은편 문**을 마주 본다(둘 다 실측으로 겪었다). 창 중심에서
   * 0.3~0.6m 만 비켜서면 카메라 뒤는 벽이고 앞은 창이라, 양쪽 다 피한다.
   *
   * ★ y 를 **12.5 대로 되돌렸다.** 한때 13.1 이상이어야 했다 — 12.5 자리에 출입문
   *   칸막이가 서 있어서 카메라가 그 사이에 끼었기 때문이다. 그런데 이제 컷이
   *   문과 차체 셸을 통째로 숨기므로(`main.ts CUT_HIDDEN`) **그 칸막이가 없다.**
   *   덕분에 카메라를 0.55m 뒤로 뺄 수 있고, 인물을 좌석에서 떼어 놓고도
   *   거리(1.6~1.8m)는 그대로 유지된다. 전경을 치운 것이 구도까지 풀어 줬다.
   */

  /**
   * ★ 인물이 통로 한가운데로 가면서 **카메라가 0.4m 가까워졌다**(`STAND_Y` 주석).
   *   객실 남쪽 끝이 y 12.40 이라 뒤로는 더 못 뺀다 — 카메라는 이미 12.4 대에 있다.
   *   그래서 잃은 거리를 두 가지로 메운다:
   *
   *     · **화각을 넓힌다**(51~55 → 54~60). 폭 3m 짜리 통에서는 광각이 오히려
   *       사실적이고, 무엇보다 광각은 **앞뒤 거리를 과장한다** — 인물이 벽에서
   *       떨어져 보이게 만드는 것이 이번 수정의 목적이므로 방향이 맞다.
   *     · **옆으로 조금 더 비켜선다**(0.24~0.58 → 0.38~0.76). 대각선으로 서면
   *       실제 거리가 그만큼 늘고, 인물이 3/4 로 서서 몸이 읽힌다.
   *
   *   ⚠ 옆으로 비키는 각도는 **26° 를 안 넘긴다.** 한때 1.6m(42°)까지 갔다가 화면이
   *     객실이 아니라 복도가 됐다 — 32m 짜리 벽을 비껴보게 되기 때문이다.
   */

  // ── ① 몸: 창 앞에 선 인물을 살짝 옆에서. 뒤가 창이라 실루엣이 산다
  const bodyA: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: ax - 0.68, y: 12.45 + yOff, eye: z + EYE,
    lx: ax - 0.10, ly: STAND_Y + yOff, lz: z + 0.92, fov: 54,
  }
  // 컷 안에서 아주 조금 다가간다 — 선 카메라가 숨을 쉬는 정도
  const bodyB: OutroCam = { ...bodyA, x: ax - 0.62, y: 12.55 + yOff, lx: ax - 0.12, lz: z + 0.96 }

  // ── ② 시선: 창으로 올라간다. 주인공은 화면 오른쪽 아래에 남는다
  const turnTo: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: ax - 0.50, y: 12.62 + yOff, eye: z + EYE,
    lx: ax - 0.16, ly: GLASS_Y + yOff, lz: z + 1.50, fov: 57,
  }

  // ── ③ 바깥: 창이 화면을 채운다
  const outsideTo: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: ax - 0.38, y: 12.58 + yOff, eye: z + EYE + 0.04,
    lx: ax - 0.12, ly: GLASS_Y + yOff, lz: z + 1.52, fov: 60,
  }
  /**
   * WRONG WAY 는 ③ 에서 사람에게 돌아온다 — 바깥이 준 답을 받는 얼굴이 필요하다.
   *
   * ★ **안내판을 프레임 안에 남긴다.** `lz` 를 0.94 로 두고 화각 50 이었을 때
   *   안내판(z B2+2.28)이 위로 잘렸다 — 이 엔딩에서 「신촌」은 마지막까지 화면에
   *   있어야 하는 물건이다. 무너지는 몸을 보여주는 동안 그 원인이 같이 보여야
   *   "왜 무너지는가"가 한 프레임 안에 있다. 시선을 조금 올리고 화각을 넓혔다.
   */
  const backToBody: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: ax - 0.76, y: 12.44 + yOff, eye: z + EYE - 0.06,
    lx: ax - 0.08, ly: STAND_Y + yOff, lz: z + 1.20, fov: 57,
  }

  const base =
    t < SHOT.body ? mix(bodyA, bodyB, easeInOut(seg(t, 0, SHOT.body)))
    : t < SHOT.turn ? mix(bodyB, turnTo, easeInOut(seg(t, SHOT.body, SHOT.turn)))
    : mix(turnTo, kind === 'wrongway' ? backToBody : outsideTo,
        easeInOut(seg(t, SHOT.turn, SHOT.outside)))
  const sh = kind === 'wrongway' ? shakeAt(t) : { x: 0, z: 0 }
  const cam: OutroCam = { ...base, shakeX: sh.x, shakeZ: sh.z }

  /**
   * ★ **걸어 들어간다.** 판이 끝난 자리에서 앵커까지.
   *
   * 카메라는 이미 엔딩 구도에 서 있고 사람이 **프레임 안으로 걸어 들어온다** —
   * 이 순서라야 "탔다"와 "엔딩이 시작됐다"가 한 동작으로 이어진다. 카메라를 같이
   * 움직여 따라가면 그냥 플레이가 이어지는 것으로 보인다.
   *
   * 도착 시각의 값이 곧 앵커라 스냅이 따로 필요 없다 — 보간의 종점이 목표다.
   */
  const w = WALK_MS[kind]
  const a = actorAt(kind, t, w)
  const src = from ?? { x: ax, y: STAND_Y + yOff }
  const k = easeInOut(seg(t, 0, w))
  const x = lerp(src.x, ax, k)
  const y = lerp(src.y, a.y + yOff, k)
  /**
   * 걷는 동안은 **가는 쪽**을 본다. 그 뒤 0.3초에 걸쳐 서 있는 자세의 방향으로 푼다.
   * 앵커가 −x 쪽인 문(객차 마지막 문)에서는 몸이 반대로 돌아 걷고 다시 돌아서는데,
   * 그게 맞다 — 그 사람은 실제로 반대쪽으로 걸어간 것이다.
   */
  const dx = ax - src.x
  const dy = (a.y + yOff) - src.y
  const walkFacing = Math.abs(dx) + Math.abs(dy) < 1e-6 ? a.facing : Math.atan2(dy, dx)
  const facing = t < w ? walkFacing : lerp(walkFacing, a.facing, easeInOut(seg(t, w, w + 300)))

  return { cam, actor: { ...a, x, y, facing }, stage: stageAt(kind, t) }
}

/**
 * 몸.
 *
 * ★ **신규 애니메이션을 만들지 않는다.** 리그의 클립 11종(`render/player-rig.ts`) 중
 *   `Stumble`(휘청) 과 `Hit`(충격) 이 우리가 필요한 두 순간을 이미 갖고 있다.
 *   클립은 **한 순간**을 치고 지나가므로, 그 뒤에 남아야 하는 **머무는 자세**만
 *   본 회전으로 얹는다(`pose.ts` BRACE·SLUMP).
 */
const actorAt = (kind: OutroKind, t: number, walk: number): OutroActor => {
  /**
   * 몸의 방향은 **컷을 따라 돈다.**
   *
   * 카메라는 남동쪽에 서 있다. 처음부터 창(북, 1.35rad)을 보게 하면 5초 내내 등만
   * 보이고, 그러면 안도든 탈진이든 **얼굴이 없는 연기**가 된다. ① 에서는 카메라
   * 쪽으로 조금 튼 3/4(0.30rad)로 서 있다가, 카메라가 창으로 옮겨 갈 때 같이 돈다 —
   * 인물이 먼저 밖을 보고 카메라가 따라가는 순서라야 시선의 이유가 화면 안에 있다.
   */
  const facing = lerp(0.30, 1.35, easeInOut(seg(t, SHOT.body - 300, SHOT.turn - 200)))

  /**
   * ★ 걸어 들어오는 동안은 **걷는 사람이다.** 감정 연기는 도착한 뒤에 시작한다.
   *
   * 클립을 새로 만들지 않는다 — 리그의 `Walk` 를 그대로 쓴다(`player-rig.ts`).
   * 방향과 좌표는 `outroAt` 이 덮어쓰므로 여기서는 클립만 고른다.
   */
  if (t < walk) return { x: 0, y: STAND_Y, clip: 'Walk', brace: 0, slump: 0, facing }

  if (kind === 'jit') {
    /**
     * 탈진 — 휘청 → 무릎 짚기 → 서서히 편다.
     * 다 펴지 않는다(0.22 가 남는다). 몇 초 만에 숨이 돌아오지는 않는다.
     *
     * ★ 휘청임을 **도착 직후**로 붙였다(`walk` 기준). 컷 시작에 못 박아 두면
     *   걸어오는 중에 휘청이게 되어, 뛰어들어와 멈추지 못한 것이 아니라 그냥
     *   비틀거리며 걷는 사람이 된다. 급한 걸음(520ms) 뒤에 와야 인과가 선다.
     */
    const st = t - walk
    const brace = st < 420
      ? seg(st, 120, 420)                                 // 휘청이며 접힌다
      : lerp(1, 0.22, easeInOut(seg(t, 3400, OUTRO_MS)))  // 창을 보며 조금 편다
    return { x: 0, y: STAND_Y, clip: st < 420 ? 'Stumble' : 'Idle', brace, slump: 0, facing }
  }

  if (kind === 'wrongway') {
    /**
     * 안도 → (안내판) → 굳음 → 무너짐.
     * **`SHOT.turn` 까지는 성공한 사람과 똑같이 서 있어야 한다** — 그래야 뒤집히는
     * 순간이 농담이 된다. 무너지는 것은 안내판을 읽은 뒤다.
     */
    const hit = t >= SHOT.turn && t < SHOT.turn + 260
    const slump = seg(t, SHOT.turn + 120, SHOT.turn + 900)
    return { x: 0, y: STAND_Y, clip: hit ? 'Hit' : 'Idle', brace: 0, slump, facing }
  }

  /**
   * 안도 — 어깨가 내려간다. 큰 동작이 없다.
   * `BRACE` 를 **아주 얕게**(0.18) 써서 한 번 숨을 내쉬고 돌아오게 한다. 이 정도가
   * "긴장이 풀렸다"이고, 더 주면 지쳐 쓰러지는 사람이 된다.
   */
  const breathe = Math.sin(seg(t, walk + 200, 2900) * Math.PI) * 0.18
  return { x: 0, y: STAND_Y, clip: 'Idle', brace: breathe, slump: 0, facing }
}

const stageAt = (kind: OutroKind, t: number): OutroStage => {
  const scroll = scrollAt(t)

  if (kind === 'wrongway') {
    /**
     * 바깥이 **지옥으로 바뀐다.**
     *
     * 한때 여기를 터널 그대로 뒀다. "잘못 탄 사람에게 일출은 보상이다"가 이유였고
     * 그 절반은 지금도 맞다 — 일출은 안 준다. 그런데 보상을 안 주는 것과 **아무 일도
     * 안 일어나는 것**은 다르다. 어두운 터널은 정상 주행과 구분이 안 돼서, 절망이
     * 안내판 글자 하나에만 얹혀 있었다.
     *
     * 순서가 중요하다: **안내판을 먼저 읽고**(led) 그 다음에 창밖이 바뀐다(tunnel).
     * 글자가 먼저 와야 "신촌이구나"가 원인이 되고, 창밖은 그 결과로 읽힌다.
     * 반대로 두면 그냥 무서운 배경이 지나간 것이 된다.
     */
    /**
     * ★ 드러나는 데 걸리는 시간을 1050 → **800ms** 로 줄였다. 컷이 8.5초가 되면서
     *   중요해진 것은 "얼마나 천천히 드러나는가"가 아니라 **드러난 뒤 얼마나 오래
     *   보이는가**다. 여기서 아낀 0.25초가 그대로 감상 시간이 된다 — 지옥이 완전히
     *   드러난 채로 남는 시간이 3.6초다.
     */
    const reveal = easeInOut(seg(t, SHOT.turn + 100, SHOT.turn + 900))
    return {
      tunnel: 1 - reveal,
      scroll,
      led: seg(t, SHOT.turn - 700, SHOT.turn - 200),
      glow: reveal,
      // 지옥이 드러나는 만큼 실내가 꺼진다 — 0.28 이면 형체는 남고 빛은 창에서만 온다
      dim: lerp(1, 0.28, reveal),
      /**
       * 번개 두 번. 지옥이 드러난 **뒤에** 친다 — 드러나기 전에 치면 터널에서
       * 번개가 번쩍이는 꼴이 된다. 짧고(90ms) 세게(2.6배), 그리고 안 반복한다.
       */
      /**
       * 2.6 배였을 때 인물이 통째로 하얗게 날아갔다 — 툰 3단 램프는 세게 줄수록
       * 붉어지는 게 아니라 **평평해진다**(`ending-stage.ts` 용암 광원 주석과 같은 이유).
       * 1.9 면 번쩍이는 것이 보이면서 실루엣이 남는다.
       */
      flash: [SHOT.turn + 1000, SHOT.turn + 1900]
        .reduce((m, at) => Math.max(m, t >= at && t < at + 90 ? 1.9 : 1), 1),
      // 붉은 기는 **보조**다. 실제 어둠과 붉음은 무대의 광원이 만든다
      red: seg(t, SHOT.turn + 400, SHOT.turn + 1300) * 0.22,
    }
  }

  /**
   * 터널이 걷힌다 — **② 가 끝날 때쯤 시작해서 ③ 안에서 끝난다.**
   * 카메라가 아직 사람을 보고 있을 때 밖이 밝아지면, 시선을 옮기는 이유가
   * 화면 안에 생긴다. 카메라가 다 돌고 나서 밝아지면 그냥 순서대로 일어난 두 일이다.
   */
  return {
    /**
     * ★ **`SHOT.outside` 에서 떼어 `SHOT.turn` 기준으로 옮겼다.** 예전에는 끝나기
     *   0.6초 전에야 터널이 다 걷혔다 — 컷을 늘릴수록 일출을 **보는** 시간이 아니라
     *   기다리는 시간만 늘어나는 식이었다. 이제 4.3초에 다 걷히고, 그 뒤 4.2초가
     *   온전히 일출이다.
     */
    tunnel: 1 - easeInOut(seg(t, SHOT.turn - 1200, SHOT.turn + 300)),
    scroll,
    led: seg(t, 900, 1600) * 0.85,
    // 빛은 조금 늦게 들어와 조금 더 오래 남는다 — 해가 뜨는 속도가 그렇다
    glow: easeInOut(seg(t, SHOT.turn - 900, SHOT.turn + 700)),
    // 아침이라 조금만 내린다. 0.72 면 창이 도드라지면서도 객실이 어둡지 않다
    dim: lerp(1, 0.72, easeInOut(seg(t, SHOT.turn - 1100, SHOT.turn + 500))),
    red: 0,
    flash: 1,
  }
}

/**
 * 성공 컷을 받는 엔딩 — **`boarded` 만으로 고르면 안 된다.**
 *
 * 탄 채로 끝나는 실패가 여럿 있다: E-09(부정승차 적발) · E-10(양심 파산) ·
 * E-11(에스컬레이터 참사) 은 전부 우선순위가 E-04·E-02 보다 높아서 **열차에 타고도**
 * 그쪽이 뜬다. `boarded` 만 보고 성공 컷을 틀면 양심이 바닥난 판에 한강 일출이 뜬다.
 * 그래서 목록으로 잠근다 — 엔딩이 늘면 여기 한 줄을 의식적으로 더해야 한다.
 *
 * 여기 없는 엔딩은 컷 없이 지금까지처럼 결과판이 바로 뜬다. 그게 맞다:
 * 무너진 판에 연출을 얹으면 그 연출이 위로가 된다.
 */
const SUCCESS_CUT: readonly string[] = ['E-01', 'E-02', 'E-03', 'E-05', 'E-14']

/** 엔딩 id → 어떤 컷을 트나. **여기가 판정과 연출이 만나는 유일한 지점이다** */
export const outroKindOf = (endingId: string | null, boarded: boolean): OutroKind | null => {
  if (!boarded || endingId === null) return null
  if (endingId === 'E-08') return 'wrongway'
  if (endingId === 'E-04') return 'jit'
  /**
   * 등급을 컷으로 또 나누지 않는다 — 무엇을 잘했는지는 결과판이 말하고,
   * 컷이 말하는 것은 **탔다는 사실 하나**다.
   */
  return SUCCESS_CUT.includes(endingId) ? 'success' : null
}
