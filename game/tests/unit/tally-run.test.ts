/**
 * 판 집계 두 값 — 혼잡도(`crowdMs`) · 체력(`staminaMin`).
 *
 * 엔딩 화면의 "이번 판" 블록이 읽는 값이다. **채점축이 아니다** — 성적은
 * `scores` 4축이고 이 둘은 판의 성격만 말한다(`state/types.ts TallyState` 주석).
 *
 * 여기서 지키는 것은 셋뿐이고, 셋 다 한 번씩 실제로 틀렸던 방향이다.
 *  · 초기값 — `staminaMin` 을 0 으로 두면 첫 프레임부터 탈진으로 보인다
 *  · phase 게이트 — 타이틀·엔딩에서 시계가 안 도는데 집계만 늘면 안 된다
 *  · 단조성 — 스태미너는 회복되므로, 최저치가 따라 올라가면 의미가 없어진다
 */

import { describe, expect, it } from 'vitest'
import { STAMINA } from '../../src/data/tuning'
import { applyAll, initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { holdFor, start } from './_pilot'

const stam = (s: GameState, value: number): GameState =>
  applyAll(s, [{ t: 'STAMINA', value, locked: false, sinceSprintMs: 0 }])

describe('tally · 이번 판 집계', () => {
  it('초기값 — 혼잡도 0 · 체력 최저치는 최댓값에서 시작한다', () => {
    const t = initialState(7).tally
    expect(t.crowdMs).toBe(0)
    expect(t.staminaMin).toBe(STAMINA.max)
  })

  it('체력 최저치는 내려가기만 한다 — 회복해도 안 따라 올라간다', () => {
    let s = start(7)
    s = stam(s, 62)
    expect(s.tally.staminaMin).toBe(62)
    s = stam(s, 18)
    expect(s.tally.staminaMin).toBe(18)
    s = stam(s, 95)                       // 회복
    expect(s.tally.staminaMin, '최저치는 기억이지 현재값이 아니다').toBe(18)
    expect(s.player.stamina, '현재값은 정상 갱신').toBe(95)
  })

  it('체력 최저치는 clamp 된 값을 본다 — 음수가 새어 들어오지 않는다', () => {
    const s = stam(start(7), -40)
    expect(s.player.stamina).toBe(0)
    expect(s.tally.staminaMin).toBe(0)
  })

  it('혼잡도는 playing 이 아니면 안 는다', () => {
    // 스폰 자리는 지상이라 인파가 없다. phase 게이트를 보려면 발행 자체를 봐야 하므로
    // **타이틀에서 시간을 흘려도** 집계가 0 인 것으로 확인한다.
    const title: GameState = { ...initialState(7), phase: 'title' }
    const after = holdFor(title, {}, 120)
    expect(after.tally.crowdMs).toBe(0)
    expect(after.elapsedMs, '타이틀에서는 시계도 안 돈다').toBe(0)
  })

  it('CROWD_NEAR 는 누적이다 — 같은 판에서 여러 번 겪으면 더해진다', () => {
    let s = start(7)
    s = applyAll(s, [{ t: 'CROWD_NEAR', dtMs: 250 }])
    s = applyAll(s, [{ t: 'CROWD_NEAR', dtMs: 400 }])
    expect(s.tally.crowdMs).toBe(650)
  })
})
