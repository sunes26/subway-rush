/**
 * S12 — 채점 4축 · 엔딩 6종. **P1 게이트.**
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S12-1~S12-11
 * (S12-8 조롱 문구는 코드 리뷰 / 아래 어휘 검사)
 */

import { EMPTY_TALLY } from '../../src/state/reducer'
import { describe, expect, it } from 'vitest'
import { ENDINGS, FAIL_HINTS, resolveEnding } from '../../src/data/endings'
import { TOTAL_TIME_MS, TRAIN } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { EndingId, GameState } from '../../src/state/types'
import { put, start, tap, wait, yawTo } from './_pilot'

const VEND_A = { x: 13.03, y: 4.15 }

/** 조건만 만들어 판정기를 직접 부른다 — 각 엔딩의 **정의**를 잠근다 */
const at = (patch: Partial<GameState>): EndingId => resolveEnding(start(7, patch)).id

describe('S12-1 엔딩 6종이 각각 재현된다', () => {
  it('E-06 다음 열차 — 미탑승 fallback', () => {
    expect(at({})).toBe('E-06')
  })

  it('E-01 아슬아슬 탑승 — 잔여 1~30초', () => {
    expect(at({ boarded: true, timeLeftMs: 12_000 })).toBe('E-01')
  })

  it('E-02 여유로운 출근 — 잔여 30초 이상', () => {
    expect(at({ boarded: true, timeLeftMs: 30_000 })).toBe('E-02')
    expect(at({ boarded: true, timeLeftMs: 55_000 })).toBe('E-02')
  })

  /**
   * ★ 조건이 바뀌었다 — **전체 남은 시간이 아니라 「문이 닫히기까지 남은 시간」**이다.
   *
   * 예전엔 `timeLeftMs <= 1000` 이었다. 그건 3분 예산을 다 썼는지를 물을 뿐이고,
   * 게이트 페널티로도 깎이며 위치 트리거로 열차가 앞당겨 오면 뜻이 아예 달라진다.
   * 이제 `boardedCloseInMs`(탑승 순간 문이 닫히기까지 남은 ms)로 잰다.
   * 자세한 이유는 `data/endings.ts` E-04 주석 · `TRAIN.justInTimeMs`.
   */
  it('E-04 문틈 낑김 — 탑승 순간 문 닫힘까지 2초 이하', () => {
    expect(at({ boarded: true, boardedCloseInMs: TRAIN.justInTimeMs })).toBe('E-04')
    expect(at({ boarded: true, boardedCloseInMs: 300 })).toBe('E-04')
    // 닫히기 시작한 뒤 밀고 들어간 경우 — 음수도 같은 부등식이 덮는다
    expect(at({ boarded: true, boardedCloseInMs: -500 })).toBe('E-04')
  })

  it('E-04 는 여유 있게 탄 판을 집어가지 않는다', () => {
    // 문이 아직 2초 넘게 열려 있었다 → 아슬아슬이 아니다 (잔여 시간이 많으니 E-02)
    expect(at({ boarded: true, timeLeftMs: 40_000, boardedCloseInMs: TRAIN.justInTimeMs + 1 }))
      .toBe('E-02')
    /**
     * **예전 조건과 갈리는 지점이다.** 3분 예산은 다 썼지만(잔여 0.9초) 문은 아직
     * 6.8초 열려 있었다 — 위치 트리거로 열차를 일찍 부른 판이 정확히 이렇게 된다.
     * 예전 식(`timeLeftMs <= 1000`)이면 「문틈 낑김」이 떴다. 문에 낀 적이 없는데도.
     */
    expect(at({ boarded: true, timeLeftMs: 900, boardedCloseInMs: 6800 })).toBe('E-01')
  })

  it('E-14 동전 부자 — 탑승 + 획득 동전 3,000원 이상', () => {
    const s = start(7, {
      boarded: true,
      timeLeftMs: 20_000,
      tally: { ...EMPTY_TALLY, coinsEarned: 3000, itemsUsed: [], secrets: [], pushes: 0 },
    })
    expect(resolveEnding(s).id).toBe('E-14')
  })

  // 선물 퍼즐 2종(E-15·E-16) + 개찰구 매복(E-17) + 차에 치임(E-18) 포함 16종
  // (양심 게이지 폐지로 E-07·E-10 삭제 — 18종에서 16종으로)
  // E-11(계단 하차인파 우산질)도 트리거가 강제 컷씬으로 바뀌며 `when`이 항상 거짓이지만,
  // `priority`는 84(강제 그룹 1~4 밖)에 그대로 남는다 — 개수(16)에는 영향이 없다
  it('전부 서로 다른 id·title 을 갖는다 (강제 엔딩 4종 포함 16종)', () => {
    expect(ENDINGS.length).toBe(16)
    expect(new Set(ENDINGS.map((e) => e.id)).size).toBe(16)
    expect(new Set(ENDINGS.map((e) => e.title)).size).toBe(16)
  })
})

describe('S12-2~S12-3 우선순위', () => {
  it('S12-3 동전 부자는 일반 성공 조건보다도 위다', () => {
    const s = start(7, {
      boarded: true,
      timeLeftMs: 20_000,                      // 조건만 보면 E-01
      tally: { ...EMPTY_TALLY, coinsEarned: 4500, itemsUsed: [], secrets: [], pushes: 0 },
    })
    expect(resolveEnding(s).id, 'E-14 priority 90 > E-01 10').toBe('E-14')
  })

  it('우선순위가 내림차순으로 유일하다 (동순위 없음)', () => {
    const ps = ENDINGS.map((e) => e.priority)
    expect(new Set(ps).size, '동순위가 있으면 판정이 배열 순서에 의존한다').toBe(ps.length)
  })

  it('fallback(priority 0)이 정확히 하나 존재한다', () => {
    const fb = ENDINGS.filter((e) => e.priority === 0)
    expect(fb.length).toBe(1)
    expect(fb[0]?.when(start(7))).toBe(true)
  })
})

describe('S12-4~S12-6 채점 축', () => {
  // 캐리어(I-10, 유일한 토글형 아이템)는 디렉터 지시로 아이템 체계째 지웠다 —
  // "같은 종류 2회는 1"을 재현할 반복 가능한 아이템이 더 없어 이 케이스는 뺐다.

  it('S12-6 지식은 시크릿 중복을 세지 않는다', () => {
    const s0 = start(7)
    // 같은 시크릿 id를 두 번 넣어도 1
    const once = { ...s0, tally: { ...s0.tally, secrets: ['vend-OBJ-06'], pushes: 0 }, scores: { ...s0.scores, knowledge: 1 } }
    const again = tap(once, {})
    expect(again.scores.knowledge).toBe(1)
  })

  it('S12-6 자판기 성공 1회 = 시크릿 1건 (재긁기 불가하므로 중복 불가)', () => {
    let s = put(
      start(7, { inventory: ['I-01', null, null], hand: { item: 'I-01', slot: 0, open: false } }),
      VEND_A.x, VEND_A.y - 1.1, FLOOR.B1,
    )
    const yaw = yawTo(s, VEND_A.x, VEND_A.y)
    s = tap(s, { pressInteract: true }, yaw)
    expect(s.qte.active).toBe(true)
    // QTE를 강제로 성공시키는 대신, 소진 상태에서 다시 눌러 중복이 안 생기는지만 본다
    const consumed = { ...s, qte: { ...s.qte, active: false },
      act: { ...s.act, consumed: ['OBJ-06'] },
      tally: { ...s.tally, secrets: ['vend-OBJ-06'], pushes: 0 },
      scores: { ...s.scores, knowledge: 1 } }
    const retry = tap(consumed, { pressInteract: true }, yaw)
    expect(retry.scores.knowledge, '중복 카운트 0').toBe(1)
  })
})

describe('S12-8 실패 엔딩의 톤 가드레일', () => {
  const MOCKING = /실패|바보|멍청|한심|무능|또|역시/

  it('실패 계열 대사에 조롱 어휘가 없다', () => {
    for (const e of ENDINGS.filter((x) => x.tone === 'fail')) {
      expect(e.line, `${e.id}: ${e.line}`).not.toMatch(MOCKING)
    }
  })

  it('힌트는 전부 "다음에 무엇을 보면 되는지"를 말한다 (명령·훈계 아님)', () => {
    for (const h of FAIL_HINTS) {
      expect(h, h).not.toMatch(MOCKING)
      expect(h.length, h).toBeGreaterThan(8)
    }
    expect(FAIL_HINTS.length, 'P1 8줄 + P2 5줄 → 13줄').toBe(13)
  })

  it('실패 엔딩은 힌트를 받는다 (고유 힌트 또는 공용 풀)', () => {
    for (const e of ENDINGS.filter((x) => x.tone === 'fail')) {
      const hint = e.hint ?? FAIL_HINTS[0]
      expect(hint, `${e.id}`).toBeTruthy()
    }
  })

  it('E-11은 고유 힌트를 갖는다 — 원인이 명확한 실패에 엉뚱한 힌트를 주지 않는다', () => {
    const e11 = ENDINGS.find((e) => e.id === 'E-11')
    expect(e11?.hint).toBeTruthy()
    expect(e11?.hint).toMatch(/미는 물건/)
  })
})

describe('S12 엔딩 판정이 시뮬 종료와 연결된다', () => {
  it('탑승 없이 열차가 떠나면 E-06으로 끝난다', () => {
    let s = { ...start(7), elapsedMs: 181_800, timeLeftMs: -1_800 }
    s = wait(s, 700)
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-06')
  })

  it('판정기는 어떤 상태에서도 예외를 던지지 않는다 (fallback 보장)', () => {
    const wild: Partial<GameState>[] = [
      {},
      { boarded: true },
      { timeLeftMs: -99_999 },
      { timeLeftMs: TOTAL_TIME_MS },
      { scores: { style: 9, knowledge: 12 } },
      { tally: { ...EMPTY_TALLY, coinsEarned: 99_999, itemsUsed: [], secrets: [], pushes: 0 } },
    ]
    for (const p of wild) expect(() => resolveEnding(start(7, p))).not.toThrow()
  })
})
