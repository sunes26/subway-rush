/**
 * 엔딩 데이터 — 우선순위 내림차순 조건식 배열 (GDD §9.4).
 * 위에서부터 첫 매치를 채택한다. P0은 2종, P1~P2는 여기에 항목만 추가한다.
 */

import type { EndingId, GameState } from '../state/types'

export type EndingDef = Readonly<{
  id: EndingId
  priority: number
  title: string
  /** GDD 부록 B — 엔딩별 마지막 대사 */
  line: string
  /** 실패 계열은 힌트를 1줄 준다. 조롱 금지 (GDD §11) */
  hint?: string
  tone: 'success' | 'fail' | 'hidden'
  when: (s: GameState) => boolean
}>

/** E-06 힌트 풀 — 매번 다른 한 줄이 나온다. 전부 "다음에 뭘 보면 되는지"만 말한다. */
export const FAIL_HINTS: readonly string[] = [
  '게이트 위 램프가 초록이면 살아있는 거다.',
  '대합실 안내 LED가 고장난 게이트 번호를 알려줄 때가 있다.',
  '계단이 에스컬레이터보다 두 배 빠르다.',
  '문은 타이머가 0이 되고 나서도 1.2초 더 열려 있다.',
  '고장난 게이트에 태그하면 8초가 날아간다. 램프를 먼저 봐라.',
]

export const ENDINGS: readonly EndingDef[] = [
  {
    id: 'E-01',
    priority: 10,
    title: '아슬아슬 탑승',
    line: '…겨우 탔다.',
    tone: 'success',
    when: (s) => s.boarded,
  },
  {
    id: 'E-06',
    priority: 0,
    title: '다음 열차',
    line: '5분 늦는다고 세상 안 무너져.',
    tone: 'fail',
    when: () => true,          // fallback — 항상 매치
  },
]

export const resolveEnding = (s: GameState): EndingDef => {
  for (const e of [...ENDINGS].sort((a, b) => b.priority - a.priority)) {
    if (e.when(s)) return e
  }
  // ENDINGS 마지막 항목이 fallback이므로 도달 불가. 타입 안전을 위해서만 존재.
  throw new Error('no ending matched — fallback missing')
}

export const pickHint = (seed: number): string =>
  FAIL_HINTS[Math.abs(seed) % FAIL_HINTS.length] as string
