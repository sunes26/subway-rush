/**
 * OBS-08 좀비폰족 부딪힘 — 짧은 자동 대화 (디렉터 지시 2026-08-09).
 *
 * 예전엔 부딪히면 토스트 한 줄("폰만 보던 사람과 부딪혔다") + 4초 정지가 전부였다.
 * 그 자리를 실제 대화창으로 바꾼다 — 플레이어와 행인이 몇 마디 주고받는 동안
 * 이동이 잠긴다. 선택지는 없다: 이 사람은 끝까지 폰에서 눈을 안 뗀다는 것 자체가
 * 웃음 포인트라, 고를 게 있으면 그 개그가 죽는다.
 */

import type { Action, GameState } from '../state/types'

export type ZombieTalkSpeaker = 'player' | 'phone'

export type ZombieTalkLine = Readonly<{ speaker: ZombieTalkSpeaker; text: string; durationMs: number }>

/**
 * 대사 세트 3종. **한 판에서 여러 번 부딪힐 수 있어**(쿨다운만 지나면 재발동) 하나만
 * 있으면 반복이 금방 티가 난다 — `variant` 로 매번 다른 세트를 튼다(`obstacles.ts`).
 * 셋 다 합이 8,000ms로 같다 — 정지 시간이 대사 세트를 갈아 끼워도 안 흔들리게.
 */
export const ZOMBIE_TALK_LINES: readonly (readonly ZombieTalkLine[])[] = [
  [
    { speaker: 'player', text: '어, 죄송합니다—', durationMs: 1200 },
    { speaker: 'phone', text: '아 진짜, 좀…', durationMs: 1200 },
    { speaker: 'player', text: '아니 저기, 앞 좀 보고 다니시—', durationMs: 1600 },
    { speaker: 'phone', text: '네네.', durationMs: 1000 },
    { speaker: 'player', text: '…듣고 계신 거 맞죠?', durationMs: 1500 },
    { speaker: 'phone', text: '그럼요.', durationMs: 1500 },
  ],
  [
    { speaker: 'player', text: '아이코, 죄송해요.', durationMs: 1300 },
    { speaker: 'phone', text: '…', durationMs: 900 },
    { speaker: 'player', text: '저기요?', durationMs: 1000 },
    { speaker: 'phone', text: '네? 아, 예예.', durationMs: 1400 },
    { speaker: 'player', text: '괜찮으세요?', durationMs: 1200 },
    { speaker: 'phone', text: '네 괜찮아요, 괜찮아.', durationMs: 2200 },
  ],
  [
    { speaker: 'player', text: '아 죄송— 괜찮으세요?', durationMs: 1600 },
    { speaker: 'phone', text: '네? 아 예.', durationMs: 1000 },
    { speaker: 'player', text: '많이 부딪힌 것 같은데.', durationMs: 1600 },
    { speaker: 'phone', text: '괜찮아요, 이거 하나만 보고—', durationMs: 2200 },
    { speaker: 'player', text: '……', durationMs: 1600 },
  ],
] as const

const variantOf = (variant: number): readonly ZombieTalkLine[] =>
  ZOMBIE_TALK_LINES[Math.abs(variant) % ZOMBIE_TALK_LINES.length] ?? ZOMBIE_TALK_LINES[0]!

/** 대사 세트 하나의 총 길이(ms) — 정지 시간의 단일 원천이다 */
export const zombieTalkTotalMs = (variant: number): number =>
  variantOf(variant).reduce((sum, l) => sum + l.durationMs, 0)

/**
 * `phaseMs` 가 몇 번째 줄인지 — `ambushLineAt` 과 같은 수법.
 * 렌더(`ui/dialog.ts`)가 이 함수 하나만 읽으면 되므로 대사 표가 바뀌어도 안 갈린다.
 */
export const zombieTalkLineAt = (
  phaseMs: number, variant: number,
): { index: number; line: ZombieTalkLine } => {
  const lines = variantOf(variant)
  let acc = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) break
    if (phaseMs < acc + line.durationMs) return { index: i, line }
    acc += line.durationMs
  }
  const last = lines[lines.length - 1] as ZombieTalkLine
  return { index: lines.length - 1, line: last }
}

export const zombieTalkSystem = (s: GameState, ctx: { dtMs: number }): Action[] => {
  if (s.phase !== 'playing' || !s.zombieTalk.active) return []

  const next = s.zombieTalk.phaseMs + ctx.dtMs
  if (next >= zombieTalkTotalMs(s.zombieTalk.variant)) return [{ t: 'ZOMBIE_TALK_END' }]
  return [{ t: 'ZOMBIE_TALK_TICK', dtMs: ctx.dtMs }]
}
