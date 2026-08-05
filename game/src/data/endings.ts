/**
 * 엔딩 데이터 — 우선순위 내림차순 조건식 배열 (GDD §9.4).
 * 위에서부터 첫 매치를 채택한다. **P1은 6종**, P2에서 14종까지 항목만 추가한다.
 *
 * 조건식은 전부 **단일 비교식**으로 유지한다. 복합 조건(E-05 TRUE)은 P2까지 미룬다 —
 * 4축 채점이 막 들어온 단계에서 복합식을 섞으면 어느 축이 엔딩을 결정했는지 못 읽는다.
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

/** 실패 계열 공용 힌트 풀 — 매번 다른 한 줄이 나온다. 전부 "다음에 뭘 보면 되는지"만 말한다. */
export const FAIL_HINTS: readonly string[] = [
  '게이트 위 램프가 초록이면 살아있는 거다.',
  '대합실 안내 LED가 고장난 게이트 번호를 알려줄 때가 있다.',
  '계단이 에스컬레이터보다 두 배 빠르다.',
  '문은 타이머가 0이 되고 나서도 1.2초 더 열려 있다.',
  '고장난 게이트에 태그하면 8초가 날아간다. 램프를 먼저 봐라.',
  // ── P1 추가 3줄 ──
  '할아버지에게 말을 걸면 고장난 게이트를 알려준다.',
  '자판기는 세 대 있다. 하나만 긁고 갈 이유가 없다.',
  '훔치면 빠르다. 빠른 만큼 뒤에서 따라온다.',
]

/**
 * ★ 우선순위는 GDD §9.4 그대로다. **E-10이 E-04·E-02보다 위인 것이 핵심이다** —
 *   훔치고 제때 탔어도 양심이 −3이면 양심 파산이 뜬다. 탑승을 취소하지는 않는다
 *   (즉사는 E-09·E-11 둘뿐이고 둘 다 P2다).
 */
export const ENDINGS: readonly EndingDef[] = [
  {
    id: 'E-14',
    priority: 90,
    title: '동전 부자',
    line: '오늘은 커피도 한 잔 사자.',
    tone: 'hidden',
    // GDD §9.4 발췌의 `coinsEarned>=3000` 그대로. 자판기 3대를 다 긁어야 도달한다
    when: (s) => s.boarded && s.tally.coinsEarned >= 3000,
  },
  {
    id: 'E-10',
    priority: 80,
    title: '양심 파산',
    line: '다들 왜 이렇게 쳐다보지.',
    hint: '훔치면 빠르다. 빠른 만큼 뒤에서 따라온다.',
    tone: 'fail',
    // 효자손 절도(−3) 단독으로도 도달한다 (GDD §6.2)
    when: (s) => s.scores.conscience <= -3,
  },
  {
    id: 'E-04',
    priority: 40,
    title: '문틈 낑김',
    line: '가방이… 가방이 안 빠진다.',
    tone: 'success',
    when: (s) => s.boarded && s.timeLeftMs <= 1000,
  },
  {
    id: 'E-02',
    priority: 30,
    title: '여유로운 출근',
    line: '오늘은 좀 이르다.',
    tone: 'success',
    when: (s) => s.boarded && s.timeLeftMs >= 30_000,
  },
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

/**
 * 우선순위 정렬은 **모듈 로드 시 한 번**만 한다.
 *
 * 예전엔 `resolveEnding` 이 매 호출마다 `.sort()` 를 했다. 6종이면 비용은 무해하지만
 * **엔딩 화면이 매 프레임 이 함수를 부른다**(`ui/screens.ts`). 14종이 되면 그게 그대로 쌓인다.
 */
const BY_PRIORITY: readonly EndingDef[] = [...ENDINGS].sort((a, b) => b.priority - a.priority)

export const resolveEnding = (s: GameState): EndingDef => {
  for (const e of BY_PRIORITY) {
    if (e.when(s)) return e
  }
  // ENDINGS 마지막 항목이 fallback이므로 도달 불가. 타입 안전을 위해서만 존재.
  throw new Error('no ending matched — fallback missing')
}

export const pickHint = (seed: number): string =>
  FAIL_HINTS[Math.abs(seed) % FAIL_HINTS.length] as string
