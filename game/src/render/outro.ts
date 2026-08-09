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
 * 반복 플레이 게임이라 길이를 5.2초로 묶었다. 그 안에 담을 수 있는 것은 셋뿐이다:
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

/** 컷 경계(ms). ③ 이 가장 길다 — 바깥을 보는 시간이 이 연출의 목적이다 */
export const SHOT = {
  /** ① 몸 — 출발과 함께 힘이 풀리거나, 무너진다 */
  body: 1600,
  /** ② 시선 — 카메라가 창으로 */
  turn: 3100,
  /** ③ 바깥 — 일출 / 안내판 */
  outside: 5200,
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
 */
export const STAND_Y = 14.45

export type OutroActor = Readonly<{
  /** 컷 동안 서 있을 y (월드). x 는 판이 끝난 자리를 그대로 쓴다 */
  y: number
  /** 재생할 클립 — 없으면 그대로 둔다 */
  clip: 'Idle' | 'Stumble' | 'Hit' | null
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
 * 창의 y. 무대(`ending-stage.ts`)의 창밖 판과 **같은 식으로 구한다** —
 * 여기서 숫자를 따로 적으면 둘이 소리 없이 어긋난다.
 */
const GLASS_Y = TRAIN.bodyYMax + 0.06

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
 * @param kind 확정된 결과 — 여기서 다시 판정하지 않는다
 * @param tMs  컷 시작부터의 경과
 * @param px   주인공이 선 x. 카메라·창·안내판이 전부 이 값을 기준으로 놓인다
 * @param yOff 반대 방면이면 `Y_OFFSET_OPP`. 두 승강장은 y 만 다르므로 전부 여기에 더한다
 */
export const outroAt = (kind: OutroKind, tMs: number, px: number, yOff = 0): OutroFrame => {
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

  // ── ① 몸: 살짝 옆에서. 인물 뒤가 창이라 실루엣이 산다
  const bodyA: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: px + 0.46, y: 12.52 + yOff, eye: z + EYE,
    lx: px + 0.40, ly: STAND_Y + yOff, lz: z + 0.92, fov: 51,
  }
  // 컷 안에서 아주 조금 다가간다 — 선 카메라가 숨을 쉬는 정도
  const bodyB: OutroCam = { ...bodyA, x: px + 0.40, y: 12.68 + yOff, lx: px + 0.36, lz: z + 0.96 }

  // ── ② 시선: 창으로 올라간다. 주인공은 화면 왼쪽 아래에 남는다
  const turnTo: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: px + 0.34, y: 12.80 + yOff, eye: z + EYE,
    lx: px + 0.30, ly: GLASS_Y + yOff, lz: z + 1.50, fov: 52,
  }

  // ── ③ 바깥: 창이 화면을 채운다
  const outsideTo: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: px + 0.26, y: 12.76 + yOff, eye: z + EYE + 0.04,
    lx: px + 0.24, ly: GLASS_Y + yOff, lz: z + 1.52, fov: 55,
  }
  /** WRONG WAY 는 ③ 에서 사람에게 돌아온다 — 바깥이 준 답을 받는 얼굴이 필요하다 */
  const backToBody: OutroCam = {
    shakeX: 0, shakeZ: 0,
    x: px + 0.52, y: 12.50 + yOff, eye: z + EYE - 0.06,
    lx: px + 0.34, ly: STAND_Y + yOff, lz: z + 0.94, fov: 50,
  }

  const base =
    t < SHOT.body ? mix(bodyA, bodyB, easeInOut(seg(t, 0, SHOT.body)))
    : t < SHOT.turn ? mix(bodyB, turnTo, easeInOut(seg(t, SHOT.body, SHOT.turn)))
    : mix(turnTo, kind === 'wrongway' ? backToBody : outsideTo,
        easeInOut(seg(t, SHOT.turn, SHOT.outside)))
  const sh = kind === 'wrongway' ? shakeAt(t) : { x: 0, z: 0 }
  const cam: OutroCam = { ...base, shakeX: sh.x, shakeZ: sh.z }

  const a = actorAt(kind, t)
  return { cam, actor: { ...a, y: a.y + yOff }, stage: stageAt(kind, t) }
}

/**
 * 몸.
 *
 * ★ **신규 애니메이션을 만들지 않는다.** 리그의 클립 11종(`render/player-rig.ts`) 중
 *   `Stumble`(휘청) 과 `Hit`(충격) 이 우리가 필요한 두 순간을 이미 갖고 있다.
 *   클립은 **한 순간**을 치고 지나가므로, 그 뒤에 남아야 하는 **머무는 자세**만
 *   본 회전으로 얹는다(`pose.ts` BRACE·SLUMP).
 */
const actorAt = (kind: OutroKind, t: number): OutroActor => {
  /**
   * 몸의 방향은 **컷을 따라 돈다.**
   *
   * 카메라는 남동쪽에 서 있다. 처음부터 창(북, 1.35rad)을 보게 하면 5초 내내 등만
   * 보이고, 그러면 안도든 탈진이든 **얼굴이 없는 연기**가 된다. ① 에서는 카메라
   * 쪽으로 조금 튼 3/4(0.30rad)로 서 있다가, 카메라가 창으로 옮겨 갈 때 같이 돈다 —
   * 인물이 먼저 밖을 보고 카메라가 따라가는 순서라야 시선의 이유가 화면 안에 있다.
   */
  const facing = lerp(0.30, 1.35, easeInOut(seg(t, SHOT.body - 300, SHOT.turn - 200)))

  if (kind === 'jit') {
    /**
     * 탈진 — 휘청 → 무릎 짚기 → 서서히 편다.
     * 다 펴지 않는다(0.22 가 남는다). 5초 만에 숨이 돌아오지는 않는다.
     */
    const brace = t < 420
      ? seg(t, 120, 420)                                  // 휘청이며 접힌다
      : lerp(1, 0.22, easeInOut(seg(t, 2600, OUTRO_MS)))  // 창을 보며 조금 편다
    return { y: STAND_Y, clip: t < 420 ? 'Stumble' : 'Idle', brace, slump: 0, facing }
  }

  if (kind === 'wrongway') {
    /**
     * 안도 → (안내판) → 굳음 → 무너짐.
     * **`SHOT.turn` 까지는 성공한 사람과 똑같이 서 있어야 한다** — 그래야 뒤집히는
     * 순간이 농담이 된다. 무너지는 것은 안내판을 읽은 뒤다.
     */
    const hit = t >= SHOT.turn && t < SHOT.turn + 260
    const slump = seg(t, SHOT.turn + 120, SHOT.turn + 900)
    return { y: STAND_Y, clip: hit ? 'Hit' : 'Idle', brace: 0, slump, facing }
  }

  /**
   * 안도 — 어깨가 내려간다. 큰 동작이 없다.
   * `BRACE` 를 **아주 얕게**(0.18) 써서 한 번 숨을 내쉬고 돌아오게 한다. 이 정도가
   * "긴장이 풀렸다"이고, 더 주면 지쳐 쓰러지는 사람이 된다.
   */
  const breathe = Math.sin(seg(t, 200, 1900) * Math.PI) * 0.18
  return { y: STAND_Y, clip: 'Idle', brace: breathe, slump: 0, facing }
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
    const reveal = easeInOut(seg(t, SHOT.turn + 150, SHOT.turn + 1200))
    return {
      tunnel: 1 - reveal,
      scroll,
      led: seg(t, SHOT.turn - 700, SHOT.turn - 200),
      glow: reveal,
      /**
       * 번개 두 번. 지옥이 드러난 **뒤에** 친다 — 드러나기 전에 치면 터널에서
       * 번개가 번쩍이는 꼴이 된다. 짧고(90ms) 세게(2.6배), 그리고 안 반복한다.
       */
      flash: [SHOT.turn + 700, SHOT.turn + 1500]
        .reduce((m, at) => Math.max(m, t >= at && t < at + 90 ? 2.6 : 1), 1),
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
    tunnel: 1 - easeInOut(seg(t, SHOT.turn - 500, SHOT.outside - 600)),
    scroll,
    led: seg(t, 900, 1600) * 0.85,
    // 빛은 조금 늦게 들어와 조금 더 오래 남는다 — 해가 뜨는 속도가 그렇다
    glow: easeInOut(seg(t, SHOT.turn - 200, SHOT.outside - 200)),
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
