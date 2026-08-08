/**
 * 개찰구 매복 (E-17) — 붕어빵 아저씨 분실물을 "내가 가진다"로 골랐을 때만 존재하는 함정.
 * `docs/` 갱신 전 디렉터 확정 사양: x≥57 트리거 · 이동 잠금 · 대사 완주 후 즉사.
 */

import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import type { FlagId, GameState } from '../../src/state/types'
import { FLOOR } from '../../src/data/world'
import { AMBUSH_CAM } from '../../src/data/tuning'
import {
  AMBUSH_COLLAPSE_MS, AMBUSH_DIALOGUE_MS, AMBUSH_TOTAL_MS, AMBUSH_TRIGGER_X,
  ambushCamera, ambushCollapseT, ambushLineAt,
} from '../../src/systems/ambush'
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
    for (let t = 0; t < AMBUSH_DIALOGUE_MS; t += 50) speakers.add(ambushLineAt(t).line.speaker)
    expect(speakers).toEqual(new Set(['??', '붕어빵 아저씨', '역무원']))
  })
})

/**
 * 쓰러지는 카메라 — 순수 함수라 **궤적 자체를 잠근다.**
 *
 * 화면으로만 확인하면 "그럴듯해 보인다"에서 멈추고, 나중에 튜닝값 하나가 바뀌었을 때
 * 아무도 모른다. 여기서 잠그는 것은 모양이 아니라 **순서와 단조성**이다:
 * 대사 중엔 안 움직인다 · 경련 뒤에야 무너진다 · 한 번 기울면 되돌아오지 않는다.
 */
describe('쓰러지는 카메라 (E-17)', () => {
  it('대사 구간에서는 카메라가 전혀 안 움직인다', () => {
    for (let t = 0; t <= AMBUSH_DIALOGUE_MS; t += 400) {
      const c = ambushCamera(t)
      expect(ambushCollapseT(t), `t=${t}`).toBe(0)
      expect(c.dropM, `t=${t}`).toBe(0)
      expect(c.rollRad, `t=${t}`).toBe(0)
      expect(c.pitchRad, `t=${t}`).toBe(0)
    }
  })

  it('경련 구간에서는 아직 안 무너진다 — 맞은 순간이 따로 읽혀야 한다', () => {
    const mid = AMBUSH_DIALOGUE_MS + AMBUSH_CAM.joltMs * 0.5
    const c = ambushCamera(mid)
    expect(c.dropM, '아직 서 있다').toBe(0)
    expect(c.rollRad).toBe(0)
    expect(c.joltM, '대신 떨고 있다').toBeGreaterThan(0)
  })

  it('낙하는 단조 증가한다 — 무너지다 되돌아오는 구간이 없다', () => {
    const from = AMBUSH_DIALOGUE_MS + AMBUSH_CAM.joltMs
    const to = from + AMBUSH_CAM.fallMs
    let prev = -1
    for (let t = from; t <= to; t += 50) {
      const roll = ambushCamera(t).rollRad
      expect(roll, `t=${t}`).toBeGreaterThanOrEqual(prev)
      prev = roll
    }
  })

  it('다 무너지면 튜닝값 그대로 눕는다', () => {
    const landed = AMBUSH_DIALOGUE_MS + AMBUSH_CAM.joltMs + AMBUSH_CAM.fallMs
    const c = ambushCamera(landed)
    expect(c.rollRad).toBeCloseTo(AMBUSH_CAM.rollRad, 5)
    expect(c.pitchRad).toBeCloseTo(AMBUSH_CAM.pitchRad, 5)
    expect(c.dropM).toBeCloseTo(AMBUSH_CAM.dropM, 5)
  })

  /**
   * "수렴한다"를 절대 오차가 아니라 **초기 진폭 대비**로 잰다. 절대값으로 잠그면
   * `settleAmpM` 을 키우는 순간 의미 없이 빨간불이 되고, 정작 검증하려는 성질
   * (여운이 잦아드는가)은 그대로인데 테스트만 고치게 된다.
   */
  it('착지 여운은 잦아든다 — 끝에서 잔여 진폭이 초기의 15% 미만', () => {
    const end = AMBUSH_TOTAL_MS - 1
    const residual = Math.abs(ambushCamera(end).dropM - AMBUSH_CAM.dropM)
    expect(residual).toBeLessThan(AMBUSH_CAM.settleAmpM * 0.15)
  })

  it('쓰러짐은 대사가 끝난 뒤에만 있다 — 총 길이가 둘의 합이다', () => {
    expect(AMBUSH_TOTAL_MS).toBe(AMBUSH_DIALOGUE_MS + AMBUSH_COLLAPSE_MS)
    expect(ambushCollapseT(AMBUSH_DIALOGUE_MS)).toBe(0)
    expect(ambushCollapseT(AMBUSH_TOTAL_MS)).toBe(1)
  })
})
