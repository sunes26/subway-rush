/**
 * 엔딩 카피 톤 가드.
 *
 * SUBWAY RUSH 는 공익광고가 아니다. 결과 화면은 플레이어를 위로하거나, 행동을
 * 칭찬하거나, 좋은 일에 의미를 붙이거나, 교훈으로 마무리하지 않는다.
 *
 * 한 번 실제로 그랬다 — E-12 가 `늦었는데 기분은 괜찮다` · `손해 본 사람은 없다` 로
 * 끝나고 설명이 `오늘은 남을 도왔습니다` 였다. 문법도 맞고 따뜻하지만, 그건
 * **작가가 플레이어에게 건네는 말**이지 방금 열차를 놓친 사람의 혼잣말이 아니다.
 *
 * 사람 눈으로 훑으면 잘 안 걸리는 종류라 문자열로 막는다.
 */

import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'

/** 위로 · 칭찬 · 교훈 · 도덕적 평가 */
const WARM = [
  '괜찮다', '기분은', '좋은 일', '남을 도', '보람', '행복', '착한',
  '더 잘', '잘할 수', '힘내', '좋은 경험', '의미 있', '뿌듯',
]
/** 공략 · 조건 · 임계값 */
const HINT = [
  '했어야', '할걸', '살펴보', '넘으면', '알 수 있다', '먼저 확인',
  '이 정답', '가장 빠른', '개 모으면',
]

/**
 * ⚠ upstream 문구 중 하나가 이 규칙에 걸린다 — E-12 「가끔은, 늦어도 괜찮다.」
 *
 * 엔딩 문구는 upstream 것을 쓰기로 정해졌으므로 문구를 고치는 대신 여기에 적어 둔다.
 * **규칙을 없애지 않는다** — 앞으로 쓰는 문구는 계속 이 가드를 지나야 하고,
 * 저 한 줄을 고치기로 하면 이 예외만 지우면 된다.
 */
const KNOWN_UPSTREAM: readonly string[] = ['E-12']

describe('엔딩 카피 톤', () => {
  it('위로·칭찬·교훈 문장이 없다', () => {
    for (const e of ENDINGS) {
      if (KNOWN_UPSTREAM.includes(e.id)) continue
      for (const line of [e.line]) {
        for (const w of WARM) {
          expect(line, `${e.id} "${line}" — 위로/교훈 어휘 "${w}"`).not.toContain(w)
        }
      }
      for (const w of WARM) {
        expect(e.title, `${e.id} 제목 "${e.title}" — "${w}"`).not.toContain(w)
      }
    }
  })

  it('마지막 한마디에 공략이 없다', () => {
    for (const e of ENDINGS) {
      for (const line of [e.line]) {
        for (const h of HINT) {
          expect(line, `${e.id} "${line}" — 공략 어휘 "${h}"`).not.toContain(h)
        }
      }
    }
  })

  it('제목이 단독으로 상황을 말한다 — 한마디가 제목을 설명하지 않는다', () => {
    /**
     * 제목이 추상적이면 한마디가 그걸 풀어 주는 구조가 된다. 그러면 제목은
     * 혼자서는 아무 뜻이 없는 라벨이 되고, 도감에 늘어놨을 때 무엇이 무엇인지
     * 안 읽힌다(실제로 `해방` · `양심 파산` · `단소는 악기다` 가 그랬다).
     *
     * 완벽히 잡을 수는 없으니 **겹침**만 막는다 — 제목과 한마디가 같은 말을
     * 하고 있으면 둘 중 하나가 제 몫을 못 하고 있다는 뜻이다.
     */
    const stem = (t: string): string => t.replace(/[.\s]/g, '').replace(/(다|요|지)$/, '')
    for (const e of ENDINGS) {
      for (const line of [e.line]) {
        const a = stem(e.title)
        const b = stem(line)
        expect(a.length >= 4 && b.includes(a), `${e.id} "${e.title}" ↔ "${line}" 가 겹친다`)
          .toBe(false)
      }
    }
  })

  it('한마디는 짧다 — 전광판에서는 끊는 편이 강하다', () => {
    for (const e of ENDINGS) {
      for (const line of [e.line]) {
        expect(line.length, `${e.id} "${line}" 가 길다`).toBeLessThanOrEqual(24)
      }
    }
  })
})
