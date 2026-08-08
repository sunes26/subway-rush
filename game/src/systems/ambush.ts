/**
 * 개찰구 매복 (E-17) — 붕어빵 아저씨 분실물을 "내가 가진다"로 골랐을 때만 존재하는 함정.
 *
 * `CHASE.safeX`(56)를 넘으면 할아버지 추격은 풀린다 — 플레이어가 "이제 안전하다"고
 * 여기는 바로 그 지점 1m 뒤(57)에 이 함정을 둔 이유가 그것이다(디렉터 지시).
 * `EARBUDS_STOLEN` 플래그가 없으면 이 시스템은 아무 일도 하지 않는다.
 */

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

export const AMBUSH_TOTAL_MS = AMBUSH_LINES.reduce((sum, l) => sum + l.durationMs, 0)

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
  if (next >= AMBUSH_TOTAL_MS) {
    // 3인칭 전환 없이(디렉터 지시), 화면 흔들림만으로 "번쩍였다"를 전달한다.
    // 나머지는 엔딩 화면의 타이틀·대사가 잇는다.
    return [
      { t: 'FX', kind: 'shake', text: '', lifeMs: 700, value: 1 },
      { t: 'END', endingId: 'E-17' },
    ]
  }
  return [{ t: 'AMBUSH_TICK', dtMs: ctx.dtMs }]
}
