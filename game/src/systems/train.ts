/**
 * F-07 열차 · 탑승 판정.
 *
 * 열차는 플레이어와 무관하게 **시간만 보고** 움직인다 — 상태는 elapsedMs의 순수 함수다.
 * 덕분에 테스트에서 t=179s로 점프해 탑승 판정만 반복할 수 있다 (3분 → 3ms).
 */

import { clamp01, easeInOut, easeOutCubic, lerp, rectContains } from '../core/math'
import { TRAIN } from '../data/tuning'
import {
  CABIN_Y1, DOOR_XS, DOOR_XS_OPP, FLOOR, PLATFORM, PSD_Y, PSD_Y_OPP,
  TRAIN_TRIGGER_ZONE, TRAIN_TRIGGER_ZONE_OPP, Y_OFFSET_OPP, type Solid,
} from '../data/world'
import type { Action, GameState, TrainStatus } from '../state/types'

/** 1량 앞단이 멈추는 x. 8량 × 16m = 128m가 승강장 78~206에 정확히 들어간다. 두 플랫폼이 같다. */
const STOP_X = PLATFORM.xMin

/**
 * 열차의 유효 시각 — 위치 트리거를 반영한 `elapsedMs`.
 *
 * 트리거 전(`trainTriggerMs === null`)엔 원래 스케줄 그대로 `elapsedMs` 를 돌려준다 —
 * 시간만 조작해 `trainAt`을 검증하는 기존 테스트들이 이 경로로 그대로 통과한다.
 *
 * 트리거 후엔 **"언제 오는가"만** 앞당기고 **"언제 떠나는가"는 안 건드린다**(디렉터 지시).
 * 문이 열릴 때까지는 트리거 기준 시계(`arriving`)를 쓰다가, 열린 뒤로는 원래 3분 예산
 * (`elapsedMs`)이 그대로 이어받는다 — `TRAIN.closeStartMs`(180_000)가 원래부터
 * `TOTAL_TIME_MS` 와 같은 값이었다는 게 핵심이다: "우리 3분이 끝나는 순간"과 "문이
 * 닫히기 시작하는 순간"은 애초에 같은 지점을 가리키도록 설계돼 있었다. 트리거는 그
 * 지점 앞의 대기만 없애는 것이지, 그 지점 자체를 옮기지 않는다.
 *
 * 상한은 `Math.min(arriving, …)` 이 막고, 바깥 `Math.max(elapsedMs, …)` 가 그 값과 실제
 * 경과 중 **더 진행된 쪽**을 택한다 — 그래서 문이 다 열린 뒤로는 자동으로 elapsedMs 가
 * 이어받고, 닫힘·출발은 원래 시각 그대로다.
 *
 * ⚠ 상한이 `stopMs` 였다 — **그러면 문이 영영 안 열린다.** `stopMs` 는 `trainAt` 에서
 * 문이 열리기 **시작**하는 지점이라 `doorProgress` 가 정확히 0 이다. 트리거를 밟으면
 * 시계가 거기 그대로 고정돼, 열차는 승강장에 서 있고 상태도 'open' 인데 문만 0 에 박혀
 * 실제 `elapsedMs` 가 172 초를 넘길 때까지(트리거 시점에 따라 100 초 넘게) 안 열렸다.
 * 상한은 문이 **다 열리는** 시각(`stopMs + doorAnimMs`)이어야 한다. 그래야 트리거 이후
 * 개문 애니메이션이 끝까지 돌고, 그 뒤에 원래 3분 예산이 이어받는다.
 */
/**
 * 탑승 뒤의 시계 — **탔으면 곧 떠난다.**
 *
 * 트리거로 열차가 앞당겨 오면 탑승도 앞당겨진다(70초쯤). 출발 시각(`departMs`)은
 * 원래 3분 예산 그대로라, 그냥 두면 객실 안에서 110초를 기다리다 엔딩이 뜬다.
 * 그래서 **탄 순간부터** 닫힘 구간(`closeStartMs`)을 향해 시계를 민다 —
 * 문이 잠깐 더 열려 있다가(`boardDwellMs`) 닫히고, 출발하면 `tick` 이 엔딩을 낸다.
 *
 * `Math.max(natural, …)` 로 감싸는 게 핵심이다. 3분을 다 쓰고 아슬아슬하게 탄
 * 경우(E-01)에는 자연 시계가 이미 더 앞서 있으므로 **아무것도 안 바뀐다** —
 * 시계가 뒤로 가면 닫히던 문이 도로 열리는 그림이 나온다.
 *
 * @param natural 탑승을 고려하지 않은 시계
 * @param mine 이 편성에 탔는가 (본편/반대 방면을 가른다)
 */
const withBoarding = (s: GameState, natural: number, mine: boolean): number => {
  if (!mine || s.boardedAtMs === null) return natural
  const sinceBoard = s.elapsedMs - s.boardedAtMs
  return Math.max(natural, TRAIN.closeStartMs - TRAIN.boardDwellMs + sinceBoard)
}

export const trainClock = (s: GameState): number => {
  const base = s.trainTriggerMs === null
    ? s.elapsedMs
    : Math.max(
        s.elapsedMs,
        Math.min(
          TRAIN.approachStartMs - TRAIN.triggerLeadMs + (s.elapsedMs - s.trainTriggerMs),
          TRAIN.stopMs + TRAIN.doorAnimMs,
        ),
      )
  return withBoarding(s, base, s.boarded && !s.boardedTrain2)
}

/**
 * 문이 실제로 열린 **실제 경과(ms)**.
 *
 * `trainClock` 의 트리거 접근 구간과 같은 셈이지만, 문이 열린 뒤 `trainClock` 은
 * `elapsedMs` 를 그대로 돌려주므로 사실 이 함수는 `trainClock` 과 크게 다르지 않다 —
 * 다만 **트리거 직후, 문이 아직 안 열렸을 때도** "열릴 예정 시각"을 미리 계산해 둘 곳이
 * 필요해서 따로 뺐다. `systems/disembark.ts` 가 이 값을 기준으로 승객들의 실시간
 * 보행 시계를 잰다 — 열차 자체(`trainAt`)와 달리 인파는 절대 멈추면 안 된다.
 */
export const doorOpenElapsedMs = (s: GameState): number =>
  s.trainTriggerMs === null
    ? TRAIN.stopMs
    : s.trainTriggerMs + (TRAIN.stopMs - TRAIN.approachStartMs + TRAIN.triggerLeadMs)

/** 계단/엘리베이터 앞에 처음 도착했는가 — 열차 위치 트리거 조건 */
export const trainTriggerSystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.trainTriggerMs !== null) return []
  if (Math.abs(s.player.pos.z - FLOOR.B1) > 2.5) return []
  if (!rectContains(TRAIN_TRIGGER_ZONE, s.player.pos.x, s.player.pos.y)) return []
  return [
    { t: 'TRAIN_TRIGGER' },
    /**
     * **방면을 말한다.** "잠시 후 열차가 도착합니다"는 어느 쪽 열차인지를 안 알려 준다 —
     * 승강장이 둘인 역에서 그 안내는 정보가 아니다. 실제 안내방송도 행선을 먼저 말한다.
     * 반대편(`trainTriggerSystem2`)이 「신촌 방면」이라고 말하는 것과 짝이 맞아야,
     * 플레이어가 방송만 듣고도 자기가 어느 승강장에 서 있는지 알 수 있다.
     */
    { t: 'FX', kind: 'toast', text: '안내방송 — "잠시 후 신도림 방면 열차가 도착합니다"', lifeMs: 2400, value: 0 },
  ]
}

// ═══════════════ 반대 방면 열차(디렉터 지시) ═══════════════
// train/trainClock/trainTriggerSystem 과 완전히 같은 셈이다 — trainTriggerMs2 만 쓴다.
// STOP_X·DOOR_XS·nearestDoorX는 두 플랫폼이 x는 같고 y만 갈리므로 그대로 재사용한다.

export const trainClock2 = (s: GameState): number => {
  const base = s.trainTriggerMs2 === null
    ? s.elapsedMs
    : Math.max(
        s.elapsedMs,
        Math.min(
          TRAIN.approachStartMs - TRAIN.triggerLeadMs + (s.elapsedMs - s.trainTriggerMs2),
          TRAIN.stopMs + TRAIN.doorAnimMs,
        ),
      )
  return withBoarding(s, base, s.boarded && s.boardedTrain2)
}

export const doorOpenElapsedMs2 = (s: GameState): number =>
  s.trainTriggerMs2 === null
    ? TRAIN.stopMs
    : s.trainTriggerMs2 + (TRAIN.stopMs - TRAIN.approachStartMs + TRAIN.triggerLeadMs)

export const trainTriggerSystem2 = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.trainTriggerMs2 !== null) return []
  if (Math.abs(s.player.pos.z - FLOOR.B1) > 2.5) return []
  if (!rectContains(TRAIN_TRIGGER_ZONE_OPP, s.player.pos.x, s.player.pos.y)) return []
  return [
    { t: 'TRAIN_TRIGGER2' },
    /**
     * 「반대 방면」이 아니라 **「신촌 방면」**이다. 역 안내방송은 행선을 말하지
     * "당신 기준으로 반대쪽"이라고 말하지 않는다 — 그건 게임이 플레이어에게 하는 말이지
     * 세계가 하는 말이 아니다. 사인(`z3fork-b` 「신촌 방면」)과 같은 이름을 써야
     * **방송을 듣고 잘못 탄 것을 스스로 알아챌 수 있다.** 그게 E-08 의 재료다.
     */
    { t: 'FX', kind: 'toast', text: '안내방송 — "잠시 후 신촌 방면 열차가 도착합니다"', lifeMs: 2400, value: 0 },
  ]
}

export const trainAt = (t: number): TrainStatus => {
  if (t < TRAIN.approachStartMs) {
    return { state: 'incoming', x: TRAIN.spawnX, doorProgress: 0 }
  }
  if (t < TRAIN.stopMs) {
    const k = easeOutCubic(clamp01((t - TRAIN.approachStartMs) / (TRAIN.stopMs - TRAIN.approachStartMs)))
    return { state: 'arriving', x: lerp(TRAIN.spawnX, STOP_X, k), doorProgress: 0 }
  }
  if (t < TRAIN.closeStartMs) {
    const d = clamp01((t - TRAIN.stopMs) / TRAIN.doorAnimMs)
    return { state: 'open', x: STOP_X, doorProgress: easeInOut(d) }
  }
  if (t < TRAIN.closeDoneMs) {
    const d = clamp01((t - TRAIN.closeStartMs) / TRAIN.doorAnimMs)
    return { state: 'closing', x: STOP_X, doorProgress: easeInOut(1 - d) }
  }
  if (t < TRAIN.departMs) {
    return { state: 'closed', x: STOP_X, doorProgress: 0 }
  }
  const k = easeInOut(clamp01((t - TRAIN.departMs) / 4000))
  return { state: 'departed', x: lerp(STOP_X, STOP_X - 320, k), doorProgress: 0 }
}

/** 열차 문이 사람을 통과시키는 상태인가 */
export const doorsPassable = (s: TrainStatus): boolean =>
  (s.state === 'open' || s.state === 'closing') && s.doorProgress > 0.25

/**
 * 안전문(PSD) 가동문 — 동적 충돌체.
 * 열려 있지 않으면 물리적 벽이다. 열차 측면(문 아닌 곳)으로는 애초에 못 간다.
 */
export const psdDoors = (s: GameState): Solid[] => {
  if (doorsPassable(s.train)) return []
  return DOOR_XS.map((x) => ({
    id: `PSDDOOR-${x}`,
    rect: [x - 0.8, PSD_Y - 0.12, x + 0.8, PSD_Y + 0.12] as const,
    z0: FLOOR.B2,
    h: 2.0,
    look: 'psd' as const,
  }))
}

/** 플레이어에게 가장 가까운 문의 x. 32개 선형 탐색은 무시할 비용이다. */
export const nearestDoorX = (px: number): number => {
  let best = DOOR_XS[0] as number
  let bestD = Math.abs(px - best)
  for (const x of DOOR_XS) {
    const d = Math.abs(px - x)
    if (d < bestD) { bestD = d; best = x }
  }
  return best
}

/**
 * 탑승 — **객실 안에 들어섰는가.**
 *
 * 예전 판정은 조건 세 개였다: 문 앞 y 범위(11.5~13.2) · 문 중심에서 ±0.8 · +y 속도 0.4 이상.
 * 셋 다 "문틀 앞에서 탈 의사를 읽는" 장치였고, 그래서 플레이어는 문틀을 넘어 본 적이 없다 —
 * 판정이 먼저 걸려 그 자리에서 얼었다. 이제 바닥·벽이 있으므로 **실제로 걸어 들어가게** 두고,
 * 객실 안에 서 있는 것 자체를 탑승으로 본다.
 *
 * 보조 조건이 전부 필요 없어진다 —
 *  · 문 정렬: 객실로 들어가는 길이 가동문뿐이다(그 외는 `PSD` 벽이 막는다)
 *  · 속도: 문 앞에 서 있기만 해선 `cabinBoardY`(13.0)에 못 닿는다
 *
 * `boardedDoorX` 는 어느 문으로 탔는지의 기록일 뿐이라 가장 가까운 문으로 남긴다.
 */
export const trainSystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.boarded) return []
  if (!doorsPassable(s.train)) return []

  const p = s.player.pos
  if (p.z > FLOOR.B2 + 1) return []
  if (p.y < TRAIN.cabinBoardY || p.y > CABIN_Y1) return []

  return [{ t: 'BOARD', doorX: nearestDoorX(p.x) }]
}

/** 반대 방면 안전문 — PSD_Y_OPP 만 다르다 */
export const psdDoors2 = (s: GameState): Solid[] => {
  if (doorsPassable(s.train2)) return []
  return DOOR_XS_OPP.map((x) => ({
    id: `PSDDOOR2-${x}`,
    rect: [x - 0.8, PSD_Y_OPP - 0.12, x + 0.8, PSD_Y_OPP + 0.12] as const,
    z0: FLOOR.B2,
    h: 2.0,
    look: 'psd' as const,
  }))
}

/**
 * 반대 방면 탑승 — 여기서 타면 **`OPPOSITE_SIDE` 를 같이 세운다**.
 * 새 엔딩을 만들지 않았다 — 기존 E-08("반대편 탑승", `boarded && OPPOSITE_SIDE`)이
 * 그대로 집어간다. `BOARD` 액션에 `opp: true` 를 얹어 `boardedTrain2` 로 남긴다 —
 * 종료 판정(`systems/tick.ts`)이 탄 게 어느 열차인지 알아야 그 열차의 출발을 본다.
 */
export const trainSystem2 = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.boarded) return []
  if (!doorsPassable(s.train2)) return []

  const p = s.player.pos
  if (p.z > FLOOR.B2 + 1) return []
  if (p.y < TRAIN.cabinBoardY + Y_OFFSET_OPP || p.y > CABIN_Y1 + Y_OFFSET_OPP) return []

  return [
    { t: 'BOARD', doorX: nearestDoorX(p.x), opp: true },
    { t: 'FLAG', id: 'OPPOSITE_SIDE', on: true },
  ]
}
