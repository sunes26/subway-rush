/**
 * S19 — 사운드 타이밍 규칙 (`docs/P2-TECH-PLAN.md` §4 S19)
 *
 * 재생 자체는 E2E 가 본다. 여기는 **언제 울리는가**만 본다 — 순수 함수라 헤드리스로 잠긴다.
 */

import { describe, expect, it } from 'vitest'
import {
  HEART_START_MS, STEP_SPRINT_MS, STEP_WALK_MS, ambienceHzOf, announceOn,
  heartIntensity, heartbeatIntervalMs, heartbeatOn, stepCutoffOf, stepIntervalMs, stepKindOf,
} from '../../src/audio/cues'
import { createFootsteps } from '../../src/audio/footsteps'
import { createSfx } from '../../src/audio/sfx'
import { createAmbience } from '../../src/audio/ambience'
import { FLOOR } from '../../src/data/world'
import type { GameState } from '../../src/state/types'
import { put, start } from './_pilot'

const playing = (patch: Partial<GameState> = {}): GameState =>
  start(7, { phase: 'playing', ...patch })

describe('발소리 — 녹음 샘플 게이팅', () => {
  it('지하가 지상보다 눌린다 · 계단은 그 사이다', () => {
    const ground = stepCutoffOf(put(playing(), 0, 24, FLOOR.L0))
    const under = stepCutoffOf(put(playing(), 20, 14, FLOOR.B1))
    const s = put(playing(), 108, 6.7, -13)
    const stairs = stepCutoffOf({ ...s, player: { ...s.player, rampId: 'OBJ-25' } })
    expect(ground).toBeGreaterThan(stairs)
    expect(stairs).toBeGreaterThan(under)
  })

  it('샘플이 없으면 조용히 폴백한다 — 노드 환경에서 안 던진다', () => {
    const f = createFootsteps()
    expect(f.ready(), '컨텍스트가 없으면 준비 안 된 상태다').toBe(false)
    expect(() => { f.set(true, true, 3000); f.stop() }).not.toThrow()
  })
})

describe('S19-6 폴백 발소리 주기', () => {
  it('걷기 0.52s · 뛰기 0.34s — 프레임레이트와 무관한 상수다', () => {
    expect(stepIntervalMs(false)).toBe(STEP_WALK_MS)
    expect(stepIntervalMs(true)).toBe(STEP_SPRINT_MS)
    expect(STEP_SPRINT_MS).toBeLessThan(STEP_WALK_MS)
  })

  it('재질은 층으로 갈린다', () => {
    expect(stepKindOf(put(playing(), 0, 24, FLOOR.L0))).toBe('pavement')
    expect(stepKindOf(put(playing(), 20, 14, FLOOR.B1))).toBe('tile')
  })

  it('경사로 위면 계단 소리다', () => {
    const s = put(playing(), 108, 6.7, -13)
    expect(stepKindOf({ ...s, player: { ...s.player, rampId: 'OBJ-25' } })).toBe('stairs')
  })
})

describe('S19-3 심박은 잔여 30초 미만에서만', () => {
  it('31초에는 안 울리고 29초에는 울린다', () => {
    expect(heartbeatOn(playing({ timeLeftMs: HEART_START_MS + 1000 }))).toBe(false)
    expect(heartbeatOn(playing({ timeLeftMs: HEART_START_MS - 1000 }))).toBe(true)
  })

  it('시간이 다 되면 멈춘다 (0 이하)', () => {
    expect(heartbeatOn(playing({ timeLeftMs: 0 }))).toBe(false)
    expect(heartbeatOn(playing({ timeLeftMs: -500 }))).toBe(false)
  })

  it('자유 탐색·타이틀에서는 안 울린다', () => {
    expect(heartbeatOn(playing({ timeLeftMs: 5000, freeplay: true }))).toBe(false)
    expect(heartbeatOn(start(7, { phase: 'title', timeLeftMs: 5000 }))).toBe(false)
  })

  it('남을수록 빨라진다 — 60 → 110 BPM', () => {
    const slow = heartbeatIntervalMs(HEART_START_MS - 1)
    const fast = heartbeatIntervalMs(200)
    expect(slow).toBeGreaterThan(fast)
    expect(slow).toBeCloseTo(1000, 0)          // 60 BPM
    expect(fast).toBeGreaterThan(540)          // 110 BPM = 545ms
    expect(fast).toBeLessThan(560)
  })

  it('강도는 0..1 을 벗어나지 않는다', () => {
    for (const t of [-9999, 0, 15_000, 30_000, 999_999]) {
      const v = heartIntensity(t)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('S19-4 안내방송 · 앰비언스', () => {
  it('열차 접근 전이에서 한 번만 운다', () => {
    expect(announceOn('arriving', 'incoming')).toBe(true)
    expect(announceOn('arriving', 'arriving'), '같은 상태가 이어지면 안 운다').toBe(false)
    expect(announceOn('open', 'arriving')).toBe(false)
  })

  it('존마다 대역이 다르다 — 지상이 가장 밝다', () => {
    const ground = ambienceHzOf(put(playing(), 0, 24, FLOOR.L0))
    const concourse = ambienceHzOf(put(playing(), 20, 14, FLOOR.B1))
    const platform = ambienceHzOf(put(playing(), 120, 6, FLOOR.B2))
    expect(ground).toBeGreaterThan(concourse)
    expect(concourse).toBeGreaterThan(platform)
  })
})

describe('S19-5 WebAudio 가 없어도 게임이 돈다', () => {
  it('노드 환경에서 createSfx 가 NOOP 을 돌려주고 아무것도 안 던진다', () => {
    const sfx = createSfx()
    expect(sfx.ready()).toBe(false)
    expect(() => {
      sfx.unlock(); sfx.gate(); sfx.coin(); sfx.danso(); sfx.doorWarn()
      sfx.step('tile'); sfx.announce(); sfx.heartbeat(1); sfx.whistle(); sfx.click()
    }).not.toThrow()
    expect(sfx.plays()).toBe(0)
  })

  it('음소거 토글도 안 던진다', () => {
    const sfx = createSfx()
    expect(() => sfx.toggleMute()).not.toThrow()
  })

  it('앰비언스도 마찬가지 — 컨텍스트가 없으면 조용히 아무것도 안 한다', () => {
    const amb = createAmbience()
    expect(() => { amb.start(null, null); amb.setZone(500); amb.setMuted(true); amb.stop() }).not.toThrow()
    expect(amb.running()).toBe(false)
  })
})
