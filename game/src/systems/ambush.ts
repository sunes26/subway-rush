/**
 * 개찰구 매복 (E-17) — 붕어빵 아저씨 분실물을 "내가 가진다"로 골랐을 때만 존재하는 함정.
 *
 * `CHASE.safeX`(56)를 넘으면 할아버지 추격은 풀린다 — 플레이어가 "이제 안전하다"고
 * 여기는 바로 그 지점 1m 뒤(57)에 이 함정을 둔 이유가 그것이다(디렉터 지시).
 * `EARBUDS_STOLEN` 플래그가 없으면 이 시스템은 아무 일도 하지 않는다.
 */

import { AMBUSH_CAM } from '../data/tuning'
import type { Action, GameState } from '../state/types'

/** 안전지대(56)를 막 넘은 지점 — "숨 돌리자마자 뒤통수" */
export const AMBUSH_TRIGGER_X = 57

export type AmbushSpeaker = '??' | '붕어빵 아저씨' | '역무원'

export type AmbushLine = Readonly<{ speaker: AmbushSpeaker; text: string; durationMs: number }>

/**
 * 대사 5줄. 화자가 곧 정체 공개 시점이다 — "저놈이여!"까지는 `??`로 남고,
 * 그다음 줄에서 붕어빵 아저씨로 밝혀진다(디렉터 지시).
 * 마지막 줄이 곧 테이저 발사 신호다 — `render/actors.ts`가 이 배열의 마지막 인덱스를
 * 그대로 재사용해 `SS_TaserFire`를 튼다. 여기서 순서를 바꾸면 그쪽도 같이 바뀐다.
 */
export const AMBUSH_LINES: readonly AmbushLine[] = [
  { speaker: '??', text: '저 사람이에요! 저 사람이 제 신형 무선 이어폰을 가져갔어요!', durationMs: 2400 },
  { speaker: '??', text: '저놈이여!', durationMs: 1200 },
  { speaker: '붕어빵 아저씨', text: '아까 그 이어폰 슬쩍한 놈이 딱 저놈이라니까!', durationMs: 2200 },
  { speaker: '역무원', text: '…뭐라고요? 손님, 잠깐 거기 서보시죠.', durationMs: 2000 },
  { speaker: '역무원', text: '…이런 도둑놈 같으니. 죽어랏!!', durationMs: 1800 },
]

export const AMBUSH_TASER_LINE_INDEX = AMBUSH_LINES.length - 1

/** 대사가 다 흐르는 데 걸리는 시간 — 여기까지가 "말", 그 뒤가 "쓰러짐"이다 */
export const AMBUSH_DIALOGUE_MS = AMBUSH_LINES.reduce((sum, l) => sum + l.durationMs, 0)

/**
 * 쓰러지는 구간(ms) — 대사가 끝난 **뒤**다.
 *
 * 경련(`joltMs`) → 낙하(`fallMs`) → 착지 여운. 여운을 따로 튜닝값으로 두지 않고
 * 남는 시간으로 흡수한다: 감쇠 진동은 `settleTauMs` 로 알아서 잦아들고, 그 위에
 * 여유를 조금 남겨야 "쓰러진 채로 화면이 잠깐 머문다"가 성립한다.
 */
export const AMBUSH_COLLAPSE_MS = AMBUSH_CAM.joltMs + AMBUSH_CAM.fallMs + 700

export const AMBUSH_TOTAL_MS = AMBUSH_DIALOGUE_MS + AMBUSH_COLLAPSE_MS

/**
 * 쓰러짐 진행도 0..1 — 대사 구간에서는 **0**이다(아직 서 있다).
 *
 * 렌더(`main.ts` 카메라 후처리)와 UI(`ui/dialog.ts` 대사창 숨김)가 같은 함수를 읽는다.
 * 시뮬은 이 값을 안 쓴다 — 쓰러짐은 판정이 아니라 연출이고, `phaseMs` 하나에서 파생된다.
 */
export const ambushCollapseT = (phaseMs: number): number => {
  if (phaseMs <= AMBUSH_DIALOGUE_MS) return 0
  return Math.min(1, (phaseMs - AMBUSH_DIALOGUE_MS) / AMBUSH_COLLAPSE_MS)
}

/**
 * 쓰러짐 카메라 오프셋 — **순수 함수**라 헤드리스 테스트가 궤적을 직접 검증한다.
 *
 * 반환값은 `main.ts` 가 `cameraRig.update()` 결과 **위에 더한다**. 카메라 리그 자체를
 * 건드리지 않는 이유: 리그는 1인칭·3인칭·QTE 시선 잠금까지 이미 세 갈래인데
 * 여기에 네 번째 상태를 넣으면 그 분기 전부에 쓰러짐을 고려해야 한다.
 * 후처리로 두면 "리그가 만든 정상 시점 + 무너짐"으로 합성이 단순해진다.
 */
export const ambushCamera = (
  phaseMs: number,
): { dropM: number; rollRad: number; pitchRad: number; joltM: number } => {
  const t = ambushCollapseT(phaseMs)
  if (t <= 0) return { dropM: 0, rollRad: 0, pitchRad: 0, joltM: 0 }

  const ms = phaseMs - AMBUSH_DIALOGUE_MS
  const c = AMBUSH_CAM

  // 1) 경련 — 맞은 순간부터 지수 감쇠. 낙하와 겹쳐도 무해하다(진폭이 이미 작다)
  const joltM = c.joltAmpM * Math.exp(-ms / c.joltTauMs)

  // 2) 낙하 — `joltMs` 를 버틴 **뒤** 시작한다. easeIn(u²) 이라 갈수록 빨라진다
  const u = Math.min(1, Math.max(0, (ms - c.joltMs) / c.fallMs))
  const fall = u * u

  // 3) 착지 여운 — 다 무너진 뒤(u === 1)에만. 감쇠 진동 한 번이 "쿵" 을 만든다
  const landedMs = ms - (c.joltMs + c.fallMs)
  const settle = landedMs > 0
    ? Math.sin((landedMs / 1000) * c.settleHz * Math.PI * 2) *
      c.settleAmpM * Math.exp(-landedMs / c.settleTauMs)
    : 0

  return {
    dropM: fall * c.dropM - settle,
    rollRad: fall * c.rollRad,
    pitchRad: fall * c.pitchRad,
    joltM,
  }
}

/**
 * `phaseMs` 가 몇 번째 줄인지 — 렌더(`ui/dialog.ts`)와 테이저 트리거(`render/actors.ts`)가
 * 같은 함수를 읽는다. 대사 표가 바뀌어도 둘이 갈릴 일이 없다.
 */
export const ambushLineAt = (phaseMs: number): { index: number; line: AmbushLine; startMs: number } => {
  let acc = 0
  for (let i = 0; i < AMBUSH_LINES.length; i++) {
    const line = AMBUSH_LINES[i]
    if (!line) break
    if (phaseMs < acc + line.durationMs) return { index: i, line, startMs: acc }
    acc += line.durationMs
  }
  const last = AMBUSH_LINES[AMBUSH_LINES.length - 1] as AmbushLine
  return { index: AMBUSH_LINES.length - 1, line: last, startMs: AMBUSH_TOTAL_MS - last.durationMs }
}

export const ambushSystem = (s: GameState, ctx: { dtMs: number }): Action[] => {
  if (s.phase !== 'playing') return []

  if (!s.ambush.active) {
    if (s.flags.includes('EARBUDS_STOLEN') && s.player.pos.x >= AMBUSH_TRIGGER_X) {
      return [{ t: 'AMBUSH_START' }]
    }
    return []
  }

  const next = s.ambush.phaseMs + ctx.dtMs
  /**
   * 끝나는 순간엔 **아무 연출도 안 낸다.** 이 시점은 이미 암전이 다 깔린 뒤라
   * (`ui/dialog.ts` 의 `#blackout`) 화면 흔들림을 넣어도 한 픽셀도 안 보인다.
   * 충격은 아래 "명중" 프레임이 이미 냈다.
   */
  if (next >= AMBUSH_TOTAL_MS) return [{ t: 'END', endingId: 'E-17' }]

  /**
   * 테이저 명중 — 대사 구간을 **막 벗어나는 그 한 프레임**에만 낸다.
   * 쓰러짐(`ambushCamera`)은 카메라를 부드럽게 밀 뿐이라 "맞았다"는 순간이 없다.
   * 그 순간을 만드는 것이 이 흔들림이고, 뒤이어 경련 → 무너짐이 이어진다.
   */
  const hitNow = s.ambush.phaseMs < AMBUSH_DIALOGUE_MS && next >= AMBUSH_DIALOGUE_MS
  const tick: Action = { t: 'AMBUSH_TICK', dtMs: ctx.dtMs }
  return hitNow
    ? [{ t: 'FX', kind: 'shake', text: '', lifeMs: 520, value: 1 }, tick]
    : [tick]
}
