/**
 * OBS-08 좀비폰족 부딪힘 — 선택지 없는 8초 자동 대화 (디렉터 지시 2026-08-09).
 * 예전엔 토스트 한 줄 + 4초 정지였다. 지금은 실제 대화창이 뜨고 그동안 이동이 잠긴다.
 */

import { describe, expect, it } from 'vitest'
import { FLOOR } from '../../src/data/world'
import { zombieAt } from '../../src/systems/obstacles'
import {
  ZOMBIE_TALK_LINES, zombieTalkLineAt, zombieTalkTotalMs,
} from '../../src/systems/zombieTalk'
import { holdFor, put, start, STEP } from './_pilot'

/** 좀비를 플레이어에게 오게 한다 — 위치가 시간의 순수 함수라 자리를 맞춰야 부딪힌다 */
const untilHit = (maxSteps = 900): { s: ReturnType<typeof start>; hit: boolean } => {
  let s = start(7, { obstacles: ['OBS-08'] })
  let hit = false
  for (let i = 0; i < maxSteps && !hit; i++) {
    const z = zombieAt(s.elapsedMs)
    s = holdFor(put(s, z.x, z.y, FLOOR.B1), {}, 1)
    hit = s.zombieTalk.active
  }
  return { s, hit }
}

describe('OBS-08 좀비폰족 부딪힘', () => {
  it('경로 위에 서 있으면 부딪혀 대화가 뜬다', () => {
    const { hit } = untilHit()
    expect(hit).toBe(true)
  })

  it('대화 중엔 이동 입력이 안 먹는다', () => {
    const { s: started, hit } = untilHit()
    expect(hit).toBe(true)
    const x0 = started.player.pos.x
    const y0 = started.player.pos.y
    const moved = holdFor(started, { moveY: 1, moveX: 1, sprint: true }, 30)
    expect(moved.zombieTalk.active, '0.5s 뒤에도 아직 진행 중이어야 한다').toBe(true)
    expect(moved.player.pos.x).toBeCloseTo(x0, 5)
    expect(moved.player.pos.y).toBeCloseTo(y0, 5)
  })

  it('총 길이가 지나면 저절로 끝나고 이동이 풀린다', () => {
    const { s: started, hit } = untilHit()
    expect(hit).toBe(true)
    const total = zombieTalkTotalMs(started.zombieTalk.variant)
    const steps = Math.ceil(total / STEP) + 5
    const ended = holdFor(started, {}, steps)
    expect(ended.zombieTalk.active).toBe(false)
    expect(ended.zombieTalk.phaseMs).toBe(0)
    // 풀렸으니 다시 움직일 수 있다 (cameraYaw=0 기준 moveY는 월드 X축 — `_pilot.ts seek` 참고)
    const moved = holdFor(ended, { moveY: 1 }, 30)
    expect(moved.player.pos.x).toBeGreaterThan(ended.player.pos.x + 0.05)
  })

  it('시간이 다 되기 전엔 안 끝난다', () => {
    const { s: started, hit } = untilHit()
    expect(hit).toBe(true)
    const total = zombieTalkTotalMs(started.zombieTalk.variant)
    const steps = Math.floor(total / STEP / 2)
    const mid = holdFor(started, {}, steps)
    expect(mid.zombieTalk.active).toBe(true)
  })

  it('대화 중에는 같은 충돌이 다시 시작되지 않는다 (쿨다운보다 대화가 길다)', () => {
    const { s: started, hit } = untilHit()
    expect(hit).toBe(true)
    const variant0 = started.zombieTalk.variant
    const phase0 = started.zombieTalk.phaseMs
    // 쿨다운(6s)이 지나도 대화(8s)가 안 끝났을 시점까지 진행
    const s = holdFor(started, {}, 60 * 7)
    expect(s.zombieTalk.active, '아직 대화 중이어야 한다').toBe(true)
    expect(s.zombieTalk.variant, '재시작됐다면 phaseMs 가 리셋되므로 이 값들로 확인').toBe(variant0)
    expect(s.zombieTalk.phaseMs).toBeGreaterThan(phase0)
  })
})

describe('좀비폰족 대사 데이터', () => {
  it('대사 세트 3종 모두 총 길이가 8,000ms로 같다', () => {
    for (let v = 0; v < ZOMBIE_TALK_LINES.length; v++) {
      expect(zombieTalkTotalMs(v), `variant ${v}`).toBe(8000)
    }
  })

  it('각 세트는 플레이어와 행인이 번갈아 말한다', () => {
    for (const lines of ZOMBIE_TALK_LINES) {
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i]?.speaker, `줄 ${i}`).not.toBe(lines[i - 1]?.speaker)
      }
    }
  })

  it('zombieTalkLineAt 이 시간에 따라 올바른 줄을 돌려준다', () => {
    expect(zombieTalkLineAt(0, 0).index).toBe(0)
    expect(zombieTalkLineAt(0, 0).line.speaker).toBe('player')
    expect(zombieTalkLineAt(7999, 0).index).toBe(ZOMBIE_TALK_LINES[0]!.length - 1)
    // 범위를 넘겨도 마지막 줄에 붙들려 있다 (throw 하지 않는다)
    expect(zombieTalkLineAt(999_999, 0).index).toBe(ZOMBIE_TALK_LINES[0]!.length - 1)
  })
})
