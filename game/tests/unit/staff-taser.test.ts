/**
 * 계단 하차인파 우산질 강제엔딩 (E-11) — 우산 밀기 누적 10회에서 역무원이 나타나
 * 대사 5줄 뒤 테이저를 쏘는 강제 컷씬. `ambush.test.ts`(E-17)와 같은 뼈대로 잠근다.
 */

import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { EMPTY_TALLY } from '../../src/state/reducer'
import type { GameState, TallyState } from '../../src/state/types'
import { AMBUSH_CAM } from '../../src/data/tuning'
import { ambushCamera, AMBUSH_DIALOGUE_MS } from '../../src/systems/ambush'
import {
  STAFF_TASER_COLLAPSE_MS, STAFF_TASER_DIALOGUE_MS, STAFF_TASER_LINES,
  STAFF_TASER_PUSH_THRESHOLD, STAFF_TASER_TOTAL_MS,
  staffTaserCamera, staffTaserCollapseT, staffTaserLineAt,
} from '../../src/systems/staffTaser'
import { holdFor, start, STEP } from './_pilot'

const tally = (over: Partial<TallyState> = {}): TallyState => ({ ...EMPTY_TALLY, ...over })

const atThreshold = (pushes = STAFF_TASER_PUSH_THRESHOLD): GameState =>
  start(7, { tally: tally({ pushes }) })

describe('계단 하차인파 우산질 강제엔딩 (E-11)', () => {
  it('밀기 9회까지는 아무 일도 없다', () => {
    const s = holdFor(atThreshold(9), {}, 5)
    expect(s.staffTaser.active).toBe(false)
  })

  it('밀기 10회에 도달하면 발동한다', () => {
    const s = holdFor(atThreshold(10), {}, 2)
    expect(s.staffTaser.active).toBe(true)
  })

  it('발동 중엔 이동 입력이 안 먹는다 — 도망칠 수 없다', () => {
    const started = holdFor(atThreshold(), {}, 2)
    expect(started.staffTaser.active).toBe(true)
    const x0 = started.player.pos.x
    const moved = holdFor(started, { moveY: 1 }, 30)
    expect(moved.staffTaser.active, '30틱(0.5s) 뒤에도 아직 진행 중이어야 한다').toBe(true)
    expect(moved.player.pos.x).toBeCloseTo(x0, 5)
  })

  it('대사가 다 끝나면 E-11 로 즉시 끝난다', () => {
    const steps = Math.ceil(STAFF_TASER_TOTAL_MS / STEP) + 5
    const s = holdFor(atThreshold(), {}, steps)
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-11')
  })

  it('시간이 다 되기 전엔 안 끝난다', () => {
    const steps = Math.floor(STAFF_TASER_TOTAL_MS / STEP / 2)
    const s = holdFor(atThreshold(), {}, steps)
    expect(s.phase).toBe('playing')
  })

  /**
   * 한 번 발동하면 계속 밀어도(이론상, 실제로는 이동이 잠겨 불가능하다) 다시 트리거되지
   * 않는다 — `STAFF_TASER_START` 리듀서 케이스가 `active` 를 already-true 로 보고 무시한다.
   */
  it('이미 발동한 뒤엔 phaseMs 가 시작점으로 되돌아가지 않는다', () => {
    const started = holdFor(atThreshold(), {}, 2)
    const later = holdFor(started, {}, 10)
    expect(later.staffTaser.phaseMs).toBeGreaterThan(started.staffTaser.phaseMs)
  })

  it('E-11 정의가 등록돼 있고 강제(when 항상 거짓)다 — resolveEnding 을 안 탄다', () => {
    const e11 = ENDINGS.find((e) => e.id === 'E-11')
    expect(e11).toBeDefined()
    expect(e11?.priority).toBe(84)
    expect(e11?.when(start(7))).toBe(false)
    expect(e11?.when({ ...start(7), tally: tally({ pushes: 999 }) })).toBe(false)
    expect(e11?.when({ ...start(7), boarded: true, timeLeftMs: 0 })).toBe(false)
  })

  it('staffTaserLineAt — 화자가 "??"→역무원 순서로 밝혀진다', () => {
    expect(staffTaserLineAt(0).line.speaker).toBe('??')
    const speakers = new Set<string>()
    for (let t = 0; t < STAFF_TASER_DIALOGUE_MS; t += 50) speakers.add(staffTaserLineAt(t).line.speaker)
    expect(speakers).toEqual(new Set(['??', '역무원']))
  })

  it('대사는 5줄이고 마지막 줄에서 테이저가 발사된다(render/actors.ts 가 이 인덱스를 읽는다)', () => {
    expect(STAFF_TASER_LINES.length).toBe(5)
    expect(STAFF_TASER_LINES[STAFF_TASER_LINES.length - 1]?.speaker).toBe('역무원')
  })
})

/**
 * 쓰러지는 카메라 — `ambushCamera`를 그대로 재사용한다(디렉터 지시, 새 카메라 상수 금지).
 * 여기서 잠그는 것은 "재사용이 실제로 같은 궤적을 낸다"는 것 — 대사 길이가 달라도
 * 명중 시점 기준으로는 `ambushCamera` 와 똑같이 움직여야 한다.
 */
describe('쓰러지는 카메라 (E-11) — ambushCamera 재사용', () => {
  it('대사 구간에서는 카메라가 전혀 안 움직인다', () => {
    for (let t = 0; t <= STAFF_TASER_DIALOGUE_MS; t += 400) {
      const c = staffTaserCamera(t)
      expect(staffTaserCollapseT(t), `t=${t}`).toBe(0)
      expect(c.dropM, `t=${t}`).toBe(0)
      expect(c.rollRad, `t=${t}`).toBe(0)
      expect(c.pitchRad, `t=${t}`).toBe(0)
    }
  })

  it('명중 직후부터는 ambushCamera 와 같은 상대시간에서 정확히 같은 값을 낸다', () => {
    for (let delta = 0; delta <= STAFF_TASER_COLLAPSE_MS; delta += 100) {
      const taser = staffTaserCamera(STAFF_TASER_DIALOGUE_MS + delta)
      const ambush = ambushCamera(AMBUSH_DIALOGUE_MS + delta)
      expect(taser.dropM, `delta=${delta}`).toBeCloseTo(ambush.dropM, 9)
      expect(taser.rollRad, `delta=${delta}`).toBeCloseTo(ambush.rollRad, 9)
      expect(taser.pitchRad, `delta=${delta}`).toBeCloseTo(ambush.pitchRad, 9)
      expect(taser.joltM, `delta=${delta}`).toBeCloseTo(ambush.joltM, 9)
    }
  })

  it('경련 구간에서는 아직 안 무너진다 — 맞은 순간이 따로 읽혀야 한다', () => {
    const mid = STAFF_TASER_DIALOGUE_MS + AMBUSH_CAM.joltMs * 0.5
    const c = staffTaserCamera(mid)
    expect(c.dropM, '아직 서 있다').toBe(0)
    expect(c.rollRad).toBe(0)
    expect(c.joltM, '대신 떨고 있다').toBeGreaterThan(0)
  })

  it('다 무너지면 튜닝값 그대로 눕는다', () => {
    const landed = STAFF_TASER_DIALOGUE_MS + AMBUSH_CAM.joltMs + AMBUSH_CAM.fallMs
    const c = staffTaserCamera(landed)
    expect(c.rollRad).toBeCloseTo(AMBUSH_CAM.rollRad, 5)
    expect(c.pitchRad).toBeCloseTo(AMBUSH_CAM.pitchRad, 5)
    expect(c.dropM).toBeCloseTo(AMBUSH_CAM.dropM, 5)
  })

  it('쓰러짐은 대사가 끝난 뒤에만 있다 — 총 길이가 둘의 합이다', () => {
    expect(STAFF_TASER_TOTAL_MS).toBe(STAFF_TASER_DIALOGUE_MS + STAFF_TASER_COLLAPSE_MS)
    expect(staffTaserCollapseT(STAFF_TASER_DIALOGUE_MS)).toBe(0)
    expect(staffTaserCollapseT(STAFF_TASER_TOTAL_MS)).toBe(1)
  })

  it('붕괴 구간 길이는 ambush.ts 의 AMBUSH_COLLAPSE_MS 와 정확히 같다(새 상수를 안 만들었다)', () => {
    expect(STAFF_TASER_COLLAPSE_MS).toBe(AMBUSH_CAM.joltMs + AMBUSH_CAM.fallMs + 700)
  })
})
