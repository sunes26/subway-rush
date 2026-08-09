/**
 * OBS-07 "도 아세요" 아주머니 + 학생 2인조 — 강제 대화 (디렉터 지시).
 *
 * 예전엔 부딪히면 토스트 한 줄 + −15초 + 2초 정지가 전부였다. 그 자리를 실제
 * 대화창으로 바꾼다 — 아주머니와 학생이 번갈아 말을 걸고, 플레이어도 세 번 끼어들며
 * 총 25.6초짜리 대화가 이어지는 동안 이동이 잠긴다. `zombieTalk`과 같은 수법:
 * 선택지는 없다 — 끝까지 버티는 것 자체가 값이다. 잠금 시간 자체가 유일한 비용이라
 * 별도 TIME_PENALTY는 없다.
 */

import { OBSTACLE } from '../data/tuning'
import type { Action, GameState } from '../state/types'

export type PreachSpeaker = 'auntie' | 'student' | 'player'

export type PreachLine = Readonly<{ speaker: PreachSpeaker; text: string; durationMs: number }>

/**
 * 대사 12줄. 아주머니가 주도(철학·조상 드립), 학생은 "체험담"으로 옆에서 거든다 —
 * README의 아주머니 파트너(포니테일·백팩) 룩을 이 장면에서는 학생으로 쓴다(디렉터 지시).
 * 플레이어가 세 번 끼어들지만 매번 씹힌다 — 그게 이 장면의 개그 포인트다.
 */
export const PREACH_LINES: readonly PreachLine[] = [
  { speaker: 'auntie', text: '저기, 학생! 잠깐 시간 좀 있어요?', durationMs: 2200 },
  { speaker: 'player', text: '죄송한데 제가 열차를 좀 급하게…', durationMs: 2000 },
  { speaker: 'student', text: '저도 처음엔 그랬어요. 딱 5분이면 돼요!', durationMs: 2200 },
  { speaker: 'auntie', text: '관상을 보아하니… 요즘 되는 일이 없죠?', durationMs: 2400 },
  { speaker: 'player', text: '네…? 아뇨, 그냥 지하철을…', durationMs: 1800 },
  { speaker: 'student', text: '저도 여기서 상담받고 인생 완전 바뀌었어요. 진짜예요.', durationMs: 2600 },
  { speaker: 'auntie', text: '지금 이 인연을 놓치면 조상님이 서운해하세요.', durationMs: 2600 },
  { speaker: 'player', text: '저기요, 저 진짜 시간이 없는데요…', durationMs: 2000 },
  { speaker: 'student', text: '여기 도장 하나만 찍고 가세요. 금방이에요!', durationMs: 2400 },
  { speaker: 'auntie', text: '어허, 왜 이렇게 급해요. 다 때가 있는 법인데.', durationMs: 2200 },
  { speaker: 'player', text: '…저 정말 가야 돼요.', durationMs: 1400 },
  { speaker: 'auntie', text: '쯧… 인연이 아닌가 보네.', durationMs: 1800 },
] as const

/** 대사가 다 흐르는 데 걸리는 시간 — 이 잠금 자체가 OBS-07의 유일한 비용이다 */
export const PREACH_TOTAL_MS = PREACH_LINES.reduce((sum, l) => sum + l.durationMs, 0)

/**
 * `phaseMs` 가 몇 번째 줄인지 — `ambushLineAt`·`zombieTalkLineAt` 과 같은 수법.
 * 렌더(`ui/dialog.ts`)가 이 함수 하나만 읽으면 되므로 대사 표가 바뀌어도 안 갈린다.
 */
export const preachLineAt = (phaseMs: number): { index: number; line: PreachLine } => {
  let acc = 0
  for (let i = 0; i < PREACH_LINES.length; i++) {
    const line = PREACH_LINES[i]
    if (!line) break
    if (phaseMs < acc + line.durationMs) return { index: i, line }
    acc += line.durationMs
  }
  const last = PREACH_LINES[PREACH_LINES.length - 1] as PreachLine
  return { index: PREACH_LINES.length - 1, line: last }
}

/**
 * 시작은 `systems/obstacles.ts`(OBS-07 규칙)가 낸다 — 여기는 진행만 본다.
 * `s.preach.active` 동안 완전히 강제다: ESC도 이동도 안 먹힌다
 * (`systems/movement.ts isTalkLocked`, `main.ts escIsFree`).
 */
export const preachSystem = (s: GameState, ctx: { dtMs: number }): Action[] => {
  if (s.phase !== 'playing' || !s.preach.active) return []

  const next = s.preach.phaseMs + ctx.dtMs
  if (next >= PREACH_TOTAL_MS) {
    /**
     * ⚠ 쿨다운(25s)이 대화 길이(25.6s)보다 짧다 — `obstacleSystem`이 트리거 **시작** 시점에
     * 이미 쿨다운을 걸어 뒀으므로, 아무 조치가 없으면 대화가 끝나는 순간 이미 쿨다운이
     * 다 풀려 있다. 플레이어는 잠긴 채 그 자리에 서 있었으니 반경 안이고, 아주머니도
     * 순찰 위상에 따라 여전히 가까울 수 있다 — 그러면 풀려나자마자 바로 다시 붙잡혀
     * **영원히 못 벗어나는 소프트락**이 된다(실측 — traverse/sweep 시뮬 회귀로 잡았다).
     * 여기서 쿨다운을 **다시** 최대치로 되감아, 풀려난 시점부터 25초의 진짜 여유를 준다.
     */
    return [
      { t: 'PREACH_END' },
      { t: 'OBS_FIRE', id: 'OBS-07', cooldownMs: OBSTACLE.talkCooldownMs },
    ]
  }
  return [{ t: 'PREACH_TICK', dtMs: ctx.dtMs }]
}
