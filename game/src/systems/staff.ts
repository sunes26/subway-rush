/**
 * ACT-08 역무원 순찰 · 시야콘 (OBS-13) — `docs/P2-SPEC.md` §4.3.
 *
 * 구조는 `chase.ts` 를 그대로 베낀다: 위치가 있고, `facing` 이 있고, 판정은
 * **각도 + 거리**다(레이캐스트 금지 규칙 유지 — 시뮬이 씬을 알면 헤드리스가 죽는다).
 *
 * 다른 점이 둘 있다.
 *  · **위치가 상태에 없다.** 순찰은 정해진 루프 순회라 `elapsedMs` 의 순수 함수로 충분하다
 *    (열차·좀비폰족과 같은 규약). 상태에 남는 것은 **경보 누적**뿐이다.
 *  · **먼저 공격하지 않는다.** `FARE_EVADED` 가 켜져 있을 때만 반응한다.
 *    그냥 서 있는 것으로는 아무 일도 안 일어난다 — 보이지 않는 즉사는 함정이다.
 *
 * 유예(`STAFF.alertMs`)는 지금 **0 — 즉발**이다(디렉터 지시 2026-08-10).
 * 누적·경고 토스트 코드는 그대로 둔다: 유예를 되살리고 싶으면 표의 숫자 하나만 올리면 된다.
 * 0 이면 `next < alertMs` 가 항상 거짓이라 첫 프레임에 곧장 E-09 로 간다.
 */

import { STAFF } from '../data/tuning'
import { FLOOR } from '../data/world'
import type { Action, GameState } from '../state/types'
import { facesPoint } from './vision'

export type StaffPose = Readonly<{ x: number; y: number; facing: number }>

/**
 * 순찰 구간 — `STAFF.path` 를 닫아 만든 변 목록. 모듈 로드 때 한 번만 잰다.
 * 마지막 점 → 첫 점을 잇는 변이 루프를 닫는다.
 */
type Segment = Readonly<{ x: number; y: number; dx: number; dy: number; len: number }>

const SEGMENTS: readonly Segment[] = STAFF.path.map((p, i, all) => {
  const q = all[(i + 1) % all.length] ?? p          // 마지막 → 첫 점
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  return { x: p[0], y: p[1], dx, dy, len: Math.hypot(dx, dy) }
})

/** 둘레(m) */
const PERIMETER = SEGMENTS.reduce((a, seg) => a + seg.len, 0)

/**
 * 1바퀴에 걸리는 시간(ms) — **표에 적지 않고 유도한다.**
 * 좌표만 고치고 주기를 못 고치면 속도가 조용히 바뀐다.
 */
export const patrolPeriodMs = (PERIMETER / STAFF.speedMps) * 1000

/**
 * 순찰 — 개찰구 안쪽 사각 루프를 일정 속도로 돈다.
 * 꼭짓점에서 즉시 꺾는다. 감속 연출은 렌더가 보간으로 흉내 낸다.
 */
export const staffAt = (elapsedMs: number): StaffPose => {
  // 이동 거리로 환산한 뒤 둘레로 접는다. 음수 elapsed 도 앞쪽으로 접어 넣는다
  let d = (((elapsedMs / 1000) * STAFF.speedMps) % PERIMETER + PERIMETER) % PERIMETER
  let cur: Segment | null = null
  for (const seg of SEGMENTS) {
    cur = seg
    if (d <= seg.len) break     // 못 만나고 끝나면 마지막 변이 남는다(부동소수 잔량)
    d -= seg.len
  }
  if (cur === null) return { x: STAFF.path[0][0], y: STAFF.path[0][1], facing: 0 }

  const k = cur.len > 0 ? Math.min(1, d / cur.len) : 0
  return {
    x: cur.x + cur.dx * k,
    y: cur.y + cur.dy * k,
    // 전방축은 이동 방향이다 — 변마다 90° 꺾인다
    facing: Math.atan2(cur.dy, cur.dx),
  }
}

/**
 * 적발 판정 — 조건 두 개를 **동시에** 만족해야 한다(디렉터 지시 2026-08-10).
 *  1. 역무원이 플레이어를 바라보고 있을 것 (`halfAngleRad` 안)
 *  2. 둘 사이 거리가 1m 이내일 것 (`visionM`)
 * 눈높이는 안 본다(2D 판정).
 */
export const inVision = (s: GameState, pose: StaffPose = staffAt(s.elapsedMs)): boolean => {
  if (Math.abs(s.player.pos.z - FLOOR.B1) > 2.5) return false
  return facesPoint(pose, s.player.pos.x, s.player.pos.y, STAFF.visionM, STAFF.halfAngleRad)
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
