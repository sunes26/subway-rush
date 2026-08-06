/**
 * ACT-08 역무원 순찰 · 시야콘 (OBS-13) — `docs/P2-SPEC.md` §4.3.
 *
 * 구조는 `chase.ts` 를 그대로 베낀다: 위치가 있고, `facing` 이 있고, 판정은
 * **각도 + 거리**다(레이캐스트 금지 규칙 유지 — 시뮬이 씬을 알면 헤드리스가 죽는다).
 *
 * 다른 점이 둘 있다.
 *  · **위치가 상태에 없다.** 순찰은 정해진 구간 왕복이라 `elapsedMs` 의 순수 함수로 충분하다
 *    (열차·좀비폰족과 같은 규약). 상태에 남는 것은 **경보 누적**뿐이다.
 *  · **먼저 공격하지 않는다.** `FARE_EVADED` 가 켜져 있을 때만 반응한다.
 *    그냥 서 있는 것으로는 아무 일도 안 일어난다 — 보이지 않는 즉사는 함정이다.
 *
 * 0.8초 유예가 있는 이유: 즉발이면 화면에 아무것도 안 보이고 끝난다.
 * 그 사이에 호루라기가 울리고 화면 가장자리가 붉어진다 → **보이는 즉사**가 된다.
 */

import { STAFF } from '../data/tuning'
import { FLOOR } from '../data/world'
import type { Action, GameState } from '../state/types'

export type StaffPose = Readonly<{ x: number; y: number; facing: number }>

/**
 * 순찰 — 비상게이트(61, 30) 앞 통로를 x 방향으로 왕복한다.
 * 삼각파라 끝에서 즉시 반전한다. 감속 연출은 렌더가 보간으로 흉내 낸다.
 */
export const staffAt = (elapsedMs: number): StaffPose => {
  const t = ((elapsedMs % STAFF.periodMs) / STAFF.periodMs) * 2      // 0..2
  const forward = t <= 1
  const k = forward ? t : 2 - t
  return {
    x: STAFF.xMin + k * (STAFF.xMax - STAFF.xMin),
    y: STAFF.y,
    // 전방축은 이동 방향이다. 정지 구간이 없으므로 항상 ±x
    facing: forward ? 0 : Math.PI,
  }
}

/** 시야콘 안인가 — 거리 + 각도. 눈높이는 안 본다(2D 판정) */
export const inVision = (s: GameState, pose: StaffPose = staffAt(s.elapsedMs)): boolean => {
  if (Math.abs(s.player.pos.z - FLOOR.B1) > 2.5) return false
  const dx = s.player.pos.x - pose.x
  const dy = s.player.pos.y - pose.y
  const d = Math.hypot(dx, dy)
  if (d > STAFF.visionM) return false
  if (d < 1e-4) return true
  const cos = (dx * Math.cos(pose.facing) + dy * Math.sin(pose.facing)) / d
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= STAFF.halfAngleRad
}

export const staffSystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing') return []
  if (!s.obstacles.includes('OBS-13')) return []          // 이번 판에 안 켜진 방해
  if (!s.flags.includes('FARE_EVADED')) {
    // 요금을 냈으면 경보가 식는다. **적발은 상태가 아니라 사건이다**
    return s.staffAlertMs > 0 ? [{ t: 'STAFF_ALERT', ms: 0 }] : []
  }

  if (!inVision(s)) {
    return s.staffAlertMs > 0 ? [{ t: 'STAFF_ALERT', ms: 0 }] : []
  }

  const next = s.staffAlertMs + STAFF.alertStepMs
  if (next < STAFF.alertMs) {
    return [
      { t: 'STAFF_ALERT', ms: next },
      // 유예 동안 경고를 준다 — 아직 도망칠 수 있다
      ...(s.staffAlertMs === 0
        ? [{ t: 'FX', kind: 'toast', text: '"저기, 잠깐만요!"', lifeMs: 1400, value: 0 } as Action]
        : []),
    ]
  }

  return [
    { t: 'STAFF_ALERT', ms: STAFF.alertMs },
    { t: 'FLAG', id: 'BUSTED', on: true },
    { t: 'END', endingId: 'E-09' },
  ]
}
