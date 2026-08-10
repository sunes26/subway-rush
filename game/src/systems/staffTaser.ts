/**
 * 계단 하차인파 우산질 강제엔딩 (E-11) — 펼친 우산으로 사람을 10명 밀어내면
 * 역무원이 플레이어 정면에 나타나 대사 후 테이저를 쏜다.
 *
 * `systems/ambush.ts`(E-17 개찰구 매복)와 **같은 뼈대**다: 대사 5줄 → 마지막 줄에서
 * 명중 → 경련 → 낙하 → 착지 → END. 카메라 궤적은 새로 만들지 않는다 — `ambushCamera`가
 * 이미 `data/tuning.ts AMBUSH_CAM`(경련·낙하 튜닝값)을 쓰는 순수 함수이므로 그대로
 * 재사용한다.
 *
 * ⚠ 그 함수는 내부적으로 `AMBUSH_DIALOGUE_MS`(매복 자신의 대사 총 길이, 9.6s)를
 *   "명중 시점"의 기준으로 삼는다. 이 판의 대사(`STAFF_TASER_LINES`)는 길이가
 *   다르다(8.6s) — 그대로 `s.staffTaser.phaseMs`를 넘기면 대사가 끝나고도 1초 동안
 *   카메라가 안 흔들리는 어긋남이 생긴다. `toAmbushClock`이 그 어긋남을 없앤다:
 *   "이 판의 대사가 끝난 뒤 경과 ms"를 "매복의 대사가 끝난 뒤 경과 ms"로 그대로
 *   옮겨 넘긴다. `ambushCamera`/`ambushCollapseT` 내부 수식은 한 글자도 안 바뀐다.
 *
 * 트리거는 `umbrellaSystem`(`tally.pushes` 계수)의 값을 **읽기만** 한다 — 계수기를
 * 내는 곳은 한 곳(`systems/umbrella.ts`)이라는 불변식을 그대로 지킨다.
 */

import type { Action, GameState } from '../state/types'
import { AMBUSH_DIALOGUE_MS, ambushCamera, ambushCollapseT, AMBUSH_COLLAPSE_MS } from './ambush'

/** 이 강제엔딩이 발동하는 밀기 누적 횟수 — GDD 개정 "우산 밀기 10회" */
export const STAFF_TASER_PUSH_THRESHOLD = 10

export type StaffTaserSpeaker = '??' | '역무원'

export type StaffTaserLine = Readonly<{ speaker: StaffTaserSpeaker; text: string; durationMs: number }>

/**
 * 대사 5줄. `??` → 역무원 정체공개 패턴은 `AMBUSH_LINES`와 같은 리듬이다.
 * 마지막 줄이 곧 테이저 발사 신호다 — `render/actors.ts`가 이 배열의 마지막 인덱스를
 * 그대로 재사용해 `SS_TaserFire`를 튼다. 여기서 순서를 바꾸면 그쪽도 같이 바뀐다.
 */
export const STAFF_TASER_LINES: readonly StaffTaserLine[] = [
  { speaker: '??', text: '얘 좀 봐, 사람을 막 밀어버려!', durationMs: 1200 },
  { speaker: '??', text: '저기요! 누가 좀 말려 봐요!', durationMs: 1400 },
  { speaker: '역무원', text: '거기, 우산 내려놓으세요!', durationMs: 2000 },
  { speaker: '역무원', text: '공공장소에서 몇 명째야, 지금… 정지! 정지하세요!', durationMs: 2200 },
  { speaker: '역무원', text: '…말이 안 통하네. 받아랏!!', durationMs: 1800 },
]

export const STAFF_TASER_TASER_LINE_INDEX = STAFF_TASER_LINES.length - 1

/** 대사가 다 흐르는 데 걸리는 시간 — `AMBUSH_DIALOGUE_MS`와 같은 성격, 값만 다르다(8.6s) */
export const STAFF_TASER_DIALOGUE_MS =
  STAFF_TASER_LINES.reduce((sum, l) => sum + l.durationMs, 0)

/**
 * 쓰러지는 구간(ms) — `AMBUSH_COLLAPSE_MS`와 **똑같은 값**이다. `AMBUSH_CAM` 하나에서만
 * 파생되고 자기 대사 길이와는 무관하므로(경련·낙하·여운은 "맞은 뒤"의 궤적일 뿐이다)
 * 새로 계산하지 않고 그대로 가져다 쓴다.
 */
export const STAFF_TASER_COLLAPSE_MS = AMBUSH_COLLAPSE_MS

export const STAFF_TASER_TOTAL_MS = STAFF_TASER_DIALOGUE_MS + STAFF_TASER_COLLAPSE_MS

/**
 * `phaseMs`(이 판의 대사 기준)를 매복 시계(`AMBUSH_DIALOGUE_MS` 기준)로 옮긴다.
 * 대사 구간에서는 두 시계가 같은 비율로 안 흐르지만(전체 길이가 다르므로) 상관없다 —
 * `ambushCamera`/`ambushCollapseT` 는 대사 구간(≤ 그 함수의 대사 길이) 동안 항상 0을
 * 반환하므로, 옮긴 값이 매복 대사 길이 밑에만 있으면 결과는 똑같이 0이다. 명중 순간
 * (`STAFF_TASER_DIALOGUE_MS`)을 넘는 순간부터가 진짜 대응 구간이고, 그 뒤는
 * `phaseMs - STAFF_TASER_DIALOGUE_MS`(명중 후 경과)를 `AMBUSH_DIALOGUE_MS`에 그대로
 * 더해 매복이 "막 명중한" 시점으로 맞춘다.
 */
const toAmbushClock = (phaseMs: number): number =>
  phaseMs <= STAFF_TASER_DIALOGUE_MS
    ? phaseMs
    : AMBUSH_DIALOGUE_MS + (phaseMs - STAFF_TASER_DIALOGUE_MS)

/** 쓰러짐 진행도 0..1 — `ambushCollapseT`를 그대로 재사용한다(위 시계 변환 참고) */
export const staffTaserCollapseT = (phaseMs: number): number =>
  ambushCollapseT(toAmbushClock(phaseMs))

/** 쓰러짐 카메라 오프셋 — `ambushCamera`를 그대로 재사용한다(위 시계 변환 참고) */
export const staffTaserCamera = (
  phaseMs: number,
): { dropM: number; rollRad: number; pitchRad: number; joltM: number } =>
  ambushCamera(toAmbushClock(phaseMs))

/**
 * `phaseMs`가 몇 번째 줄인지 — 렌더(`render/actors.ts`)와 UI(`ui/dialog.ts`)가
 * 같은 함수를 읽는다. `ambushLineAt`과 같은 식, 대사 표만 다르다.
 */
export const staffTaserLineAt = (
  phaseMs: number,
): { index: number; line: StaffTaserLine; startMs: number } => {
  let acc = 0
  for (let i = 0; i < STAFF_TASER_LINES.length; i++) {
    const line = STAFF_TASER_LINES[i]
    if (!line) break
    if (phaseMs < acc + line.durationMs) return { index: i, line, startMs: acc }
    acc += line.durationMs
  }
  const last = STAFF_TASER_LINES[STAFF_TASER_LINES.length - 1] as StaffTaserLine
  return {
    index: STAFF_TASER_LINES.length - 1,
    line: last,
    startMs: STAFF_TASER_DIALOGUE_MS - last.durationMs,
  }
}

export const staffTaserSystem = (s: GameState, ctx: { dtMs: number }): Action[] => {
  if (s.phase !== 'playing') return []

  if (!s.staffTaser.active) {
    if (s.tally.pushes >= STAFF_TASER_PUSH_THRESHOLD) {
      return [{ t: 'STAFF_TASER_START' }]
    }
    return []
  }

  const next = s.staffTaser.phaseMs + ctx.dtMs
  /**
   * 끝나는 순간엔 아무 연출도 안 낸다 — 이 시점은 이미 암전이 다 깔린 뒤라
   * (`ui/dialog.ts`의 `#blackout`) 화면 흔들림을 넣어도 안 보인다(`ambushSystem`과 같은 이유).
   */
  if (next >= STAFF_TASER_TOTAL_MS) return [{ t: 'END', endingId: 'E-11' }]

  /** 테이저 명중 — 대사 구간을 막 벗어나는 그 한 프레임에만 낸다(`ambushSystem`과 같은 식) */
  const hitNow = s.staffTaser.phaseMs < STAFF_TASER_DIALOGUE_MS && next >= STAFF_TASER_DIALOGUE_MS
  const tick: Action = { t: 'STAFF_TASER_TICK', dtMs: ctx.dtMs }
  return hitNow
    ? [{ t: 'FX', kind: 'shake', text: '', lifeMs: 520, value: 1 }, tick]
    : [tick]
}
