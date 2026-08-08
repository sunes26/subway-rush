/**
 * F-07 열차 · 탑승 판정.
 *
 * 열차는 플레이어와 무관하게 **시간만 보고** 움직인다 — 상태는 elapsedMs의 순수 함수다.
 * 덕분에 테스트에서 t=179s로 점프해 탑승 판정만 반복할 수 있다 (3분 → 3ms).
 */

import { clamp01, easeInOut, easeOutCubic, lerp, rectContains } from '../core/math'
import { TRAIN } from '../data/tuning'
import {
  DOOR_XS, DOOR_XS_OPP, FLOOR, PLATFORM, PSD_Y, PSD_Y_OPP,
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
 * `Math.min(arriving, stopMs)` 로 트리거 시계가 stopMs 를 넘어가지 못하게 막고,
 * 바깥 `Math.max(elapsedMs, …)` 가 그 값과 실제 경과 중 **더 진행된 쪽**을 택한다 —
 * 그래서 문이 열린 뒤(실제 elapsedMs가 stopMs를 넘어서는 순간부터)는 자동으로
 * elapsedMs 가 이어받는다.
 */
export const trainClock = (s: GameState): number => {
  if (s.trainTriggerMs === null) return s.elapsedMs
  const sinceTrigger = s.elapsedMs - s.trainTriggerMs
  const arriving = TRAIN.approachStartMs - TRAIN.triggerLeadMs + sinceTrigger
  return Math.max(s.elapsedMs, Math.min(arriving, TRAIN.stopMs))
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
    { t: 'FX', kind: 'toast', text: '안내방송 — "잠시 후 열차가 도착합니다"', lifeMs: 2400, value: 0 },
  ]
}

// ═══════════════ 반대 방면 열차(디렉터 지시) ═══════════════
// train/trainClock/trainTriggerSystem 과 완전히 같은 셈이다 — trainTriggerMs2 만 쓴다.
// STOP_X·DOOR_XS·nearestDoorX는 두 플랫폼이 x는 같고 y만 갈리므로 그대로 재사용한다.

export const trainClock2 = (s: GameState): number => {
  if (s.trainTriggerMs2 === null) return s.elapsedMs
  const sinceTrigger = s.elapsedMs - s.trainTriggerMs2
  const arriving = TRAIN.approachStartMs - TRAIN.triggerLeadMs + sinceTrigger
  return Math.max(s.elapsedMs, Math.min(arriving, TRAIN.stopMs))
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
    { t: 'FX', kind: 'toast', text: '안내방송 — "반대 방면 열차가 곧 도착합니다"', lifeMs: 2400, value: 0 },
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

/** 탑승 의사 판정 최소 속도 (m/s). 문 앞에 그냥 서 있다가 빨려 들어가지 않게 한다. */
const BOARD_INTENT_VY = 0.4

export const trainSystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.boarded) return []
  const t = s.train
  if (!doorsPassable(t)) return []

  const p = s.player.pos
  if (p.z > FLOOR.B2 + 1) return []
  if (p.y < TRAIN.boardYMin || p.y > TRAIN.boardYMax) return []

  const doorX = nearestDoorX(p.x)
  if (Math.abs(p.x - doorX) > TRAIN.doorHalfWidth) return []

  // 조건 ③ — 열차 쪽(+y)으로 실제 이동 중일 것.
  // 입력 축(input.moveY)이 아니라 **월드 속도**를 본다 — 존마다 카메라 요가 달라서
  // "W를 누른다"와 "열차 쪽으로 간다"가 같은 뜻이 아니기 때문이다.
  if (s.player.vel.y < BOARD_INTENT_VY) return []

  return [{ t: 'BOARD', doorX }]
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
  if (p.y < TRAIN.boardYMin + Y_OFFSET_OPP || p.y > TRAIN.boardYMax + Y_OFFSET_OPP) return []

  const doorX = nearestDoorX(p.x)
  if (Math.abs(p.x - doorX) > TRAIN.doorHalfWidth) return []
  if (s.player.vel.y < BOARD_INTENT_VY) return []

  return [
    { t: 'BOARD', doorX, opp: true },
    { t: 'FLAG', id: 'OPPOSITE_SIDE', on: true },
  ]
}
