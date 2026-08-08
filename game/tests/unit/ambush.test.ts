/**
 * 개찰구 매복 (E-17) — 붕어빵 아저씨 분실물을 "내가 가진다"로 골랐을 때만 존재하는 함정.
 * `docs/` 갱신 전 디렉터 확정 사양: x≥57 트리거 · 이동 잠금 · 대사 완주 후 즉사.
 */

import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import type { FlagId, GameState } from '../../src/state/types'
import { FLOOR } from '../../src/data/world'
import { AMBUSH_TOTAL_MS, AMBUSH_TRIGGER_X, ambushLineAt } from '../../src/systems/ambush'
import { holdFor, put, start, STEP } from './_pilot'

const atTrigger = (flags: readonly FlagId[] = []): GameState =>
  put(start(7, { flags }), AMBUSH_TRIGGER_X, 14, FLOOR.B1)

describe('개찰구 매복 (E-17)', () => {
  it('EARBUDS_STOLEN 없이 x≥57 을 지나도 아무 일도 없다', () => {
    const s = holdFor(atTrigger(), {}, 5)
    expect(s.ambush.active).toBe(false)
  })

  it('EARBUDS_STOLEN 상태로 x≥57 을 넘으면 매복이 발동한다', () => {
    const s = holdFor(atTrigger(['EARBUDS_STOLEN']), {}, 2)
    expect(s.ambush.active).toBe(true)
  })

  it('매복 중엔 이동 입력이 안 먹는다 — 도망칠 수 없다', () => {
    const started = holdFor(atTrigger(['EARBUDS_STOLEN']), {}, 2)
    expect(started.ambush.active).toBe(true)
    const x0 = started.player.pos.x
    const moved = holdFor(started, { moveY: 1 }, 30)
    expect(moved.ambush.active, '30틱(0.5s) 뒤에도 아직 진행 중이어야 한다').toBe(true)
    expect(moved.player.pos.x).toBeCloseTo(x0, 5)
  })

  it('대사가 다 끝나면 E-17 로 즉시 끝난다', () => {
    const steps = Math.ceil(AMBUSH_TOTAL_MS / STEP) + 5
    const s = holdFor(atTrigger(['EARBUDS_STOLEN']), {}, steps)
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-17')
  })

  it('시간이 다 되기 전엔 안 끝난다', () => {
    const steps = Math.floor(AMBUSH_TOTAL_MS / STEP / 2)
    const s = holdFor(atTrigger(['EARBUDS_STOLEN']), {}, steps)
    expect(s.phase).toBe('playing')
  })

  it('E-17 정의가 등록돼 있고 강제(when 항상 거짓)다 — resolveEnding 을 안 탄다', () => {
    const e17 = ENDINGS.find((e) => e.id === 'E-17')
    expect(e17).toBeDefined()
    expect(e17?.when(start(7))).toBe(false)
    expect(e17?.when({ ...start(7), boarded: true, timeLeftMs: 0 })).toBe(false)
  })

  it('ambushLineAt — 화자가 "??"→붕어빵 아저씨→역무원 순서로 밝혀진다', () => {
    expect(ambushLineAt(0).line.speaker).toBe('??')
    const speakers = new Set<string>()
    for (let t = 0; t < AMBUSH_TOTAL_MS; t += 50) speakers.add(ambushLineAt(t).line.speaker)
    expect(speakers).toEqual(new Set(['??', '붕어빵 아저씨', '역무원']))
  })
})
