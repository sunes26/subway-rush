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

describe('엔딩 카피 톤', () => {
  it('위로·칭찬·교훈 문장이 없다', () => {
    for (const e of ENDINGS) {
      for (const line of e.lines) {
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
      for (const line of e.lines) {
        for (const h of HINT) {
          expect(line, `${e.id} "${line}" — 공략 어휘 "${h}"`).not.toContain(h)
        }
      }
    }
  })

  it('한마디는 짧다 — 전광판에서는 끊는 편이 강하다', () => {
    for (const e of ENDINGS) {
      for (const line of e.lines) {
        expect(line.length, `${e.id} "${line}" 가 길다`).toBeLessThanOrEqual(24)
      }
    }
  })
})
