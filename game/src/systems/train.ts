/**
 * F-07 열차 · 탑승 판정.
 *
 * 열차는 플레이어와 무관하게 **시간만 보고** 움직인다 — 상태는 elapsedMs의 순수 함수다.
 * 덕분에 테스트에서 t=179s로 점프해 탑승 판정만 반복할 수 있다 (3분 → 3ms).
 */

import { clamp01, easeInOut, easeOutCubic, lerp } from '../core/math'
import { TRAIN } from '../data/tuning'
import { DOOR_XS, FLOOR, PLATFORM, PSD_Y, type Solid } from '../data/world'
import type { Action, GameState, TrainStatus } from '../state/types'

/** 1량 앞단이 멈추는 x. 8량 × 16m = 128m가 승강장 78~206에 정확히 들어간다. */
const STOP_X = PLATFORM.xMin

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
