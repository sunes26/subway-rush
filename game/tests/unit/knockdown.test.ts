/**
 * E-18 차에 치임 — 붕 떴다가 떨어져 쓰러지는 연출.
 *
 * 잠그는 것은 모양이 아니라 **곡선의 성질**이다: 올라갔다 내려온다 · 정점이 한가운데가
 * 아니라 앞쪽이다 · 착지하면 굳는다. 화면으로만 보면 "그럴듯하다"에서 멈추고,
 * 나중에 튜닝값 하나가 바뀌어도 아무도 모른다.
 */

import { describe, expect, it } from 'vitest'
import { KNOCKDOWN_CAM } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import { applyAll } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { KNOCKDOWN_TOTAL_MS, knockdownCamera, knockdownSystem, knockdownT }
  from '../../src/systems/knockdown'
import { holdFor, put, start, STEP } from './_pilot'

/** 차도(지상)에 세운 뒤 치인 직후 상태 */
const hit = (): GameState =>
  applyAll(put(start(7), -45, 17.5, FLOOR.L0), [{ t: 'KNOCKDOWN_START' }])

describe('차에 치임 — 카메라 궤적', () => {
  it('붕 뜬다 — 체공 초반은 눈높이보다 위다', () => {
    expect(knockdownCamera(0).liftM).toBeCloseTo(0, 5)
    expect(knockdownCamera(200).liftM).toBeGreaterThan(0.5)
  })

  it('정점이 한가운데보다 앞에 있다 — 떨어지는 시간이 더 길어야 맞은 것처럼 보인다', () => {
    let peakMs = 0
    let peak = -Infinity
    for (let t = 0; t <= KNOCKDOWN_CAM.airMs; t += 10) {
      const h = knockdownCamera(t).liftM
      if (h > peak) { peak = h; peakMs = t }
    }
    expect(peak).toBeCloseTo(KNOCKDOWN_CAM.peakM, 2)
    expect(peakMs, '정점은 체공 전반부에 온다').toBeLessThan(KNOCKDOWN_CAM.airMs * 0.5)
  })

  /**
   * 눈높이(0)를 다시 지나는 시점은 `u = 2/r ≈ 0.865` 다 — 체공의 86% 지점이라
   * "착지 직전"을 200ms 로 잡으면 아직 위에 있다(실제로 그렇게 짰다가 틀렸다).
   * 마지막 5% 구간으로 잡아야 사실과 맞는다.
   */
  it('체공 곡선이 위로 볼록하다 — 올라갔다 내려온다(단조가 아니다)', () => {
    const up = knockdownCamera(200).liftM
    const top = knockdownCamera(KNOCKDOWN_CAM.airMs / 2.311).liftM
    const down = knockdownCamera(KNOCKDOWN_CAM.airMs * 0.95).liftM
    expect(top).toBeGreaterThan(up)
    expect(top).toBeGreaterThan(down)
    expect(down, '체공 끝자락엔 이미 눈높이 아래로 내려온다').toBeLessThan(0)
  })

  it('착지하면 정확히 바닥 높이다', () => {
    expect(knockdownCamera(KNOCKDOWN_CAM.airMs).liftM).toBeCloseTo(-KNOCKDOWN_CAM.dropM, 5)
  })

  it('회전은 체공 내내 단조 증가하고 착지에서 최종 각이 된다', () => {
    let prev = -1
    for (let t = 0; t <= KNOCKDOWN_CAM.airMs; t += 25) {
      const roll = knockdownCamera(t).rollRad
      expect(roll, `t=${t}`).toBeGreaterThanOrEqual(prev)
      prev = roll
    }
    expect(knockdownCamera(KNOCKDOWN_CAM.airMs).rollRad).toBeCloseTo(KNOCKDOWN_CAM.rollRad, 5)
  })

  it('착지 뒤엔 회전이 굳는다 — 누운 채 계속 구르지 않는다', () => {
    const a = knockdownCamera(KNOCKDOWN_CAM.airMs + 100).rollRad
    const b = knockdownCamera(KNOCKDOWN_TOTAL_MS - 1).rollRad
    expect(a).toBeCloseTo(KNOCKDOWN_CAM.rollRad, 5)
    expect(b).toBeCloseTo(KNOCKDOWN_CAM.rollRad, 5)
  })

  it('정점에서 하늘을 보고, 누운 뒤에도 위를 본다', () => {
    const peakMs = KNOCKDOWN_CAM.airMs / 2.311
    expect(knockdownCamera(peakMs).pitchRad).toBeCloseTo(KNOCKDOWN_CAM.pitchUpRad, 2)
    expect(knockdownCamera(KNOCKDOWN_CAM.airMs).pitchRad)
      .toBeCloseTo(KNOCKDOWN_CAM.pitchRestRad, 5)
  })

  it('착지 여운은 잦아든다 — 끝에서 잔여 진폭이 초기의 15% 미만', () => {
    const residual = Math.abs(
      knockdownCamera(KNOCKDOWN_TOTAL_MS - 1).liftM + KNOCKDOWN_CAM.dropM)
    expect(residual).toBeLessThan(KNOCKDOWN_CAM.settleAmpM * 0.15)
  })

  it('진행도는 0..1 로 묶인다', () => {
    expect(knockdownT(-100)).toBe(0)
    expect(knockdownT(0)).toBe(0)
    expect(knockdownT(KNOCKDOWN_TOTAL_MS)).toBe(1)
    expect(knockdownT(KNOCKDOWN_TOTAL_MS * 3)).toBe(1)
  })
})

describe('차에 치임 — 시스템', () => {
  it('안 치였으면 아무 일도 안 한다', () => {
    expect(knockdownSystem(start(7), { dtMs: STEP })).toEqual([])
  })

  it('치이면 이동이 잠긴다 — 날아가는 동안 걸어 다닐 수 없다', () => {
    const s = hit()
    const x0 = s.player.pos.x
    const moved = holdFor(s, { moveY: 1, sprint: true }, 20)
    expect(moved.player.pos.x).toBeCloseTo(x0, 5)
  })

  it('연출이 끝나면 E-18 로 끝난다', () => {
    const steps = Math.ceil(KNOCKDOWN_TOTAL_MS / STEP) + 4
    const s = holdFor(hit(), {}, steps)
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-18')
  })

  it('연출 도중에는 안 끝난다 — 맞자마자 엔딩이 뜨면 붕 뜨는 걸 못 본다', () => {
    const s = holdFor(hit(), {}, Math.floor(KNOCKDOWN_TOTAL_MS / STEP / 2))
    expect(s.phase).toBe('playing')
    expect(s.knockdown.active).toBe(true)
  })

  it('START 는 멱등이다 — 쓰러지는 중에 또 치여도 처음부터 다시 시작하지 않는다', () => {
    const s = holdFor(hit(), {}, 20)
    const again = applyAll(s, [{ t: 'KNOCKDOWN_START' }])
    expect(again.knockdown.phaseMs).toBe(s.knockdown.phaseMs)
  })

  it('치이는 순간 관성이 지워진다 — 시체가 도로 위를 미끄러지지 않는다', () => {
    const moving = { ...put(start(7), -45, 17.5, FLOOR.L0) }
    const s = applyAll(
      { ...moving, player: { ...moving.player, vel: { x: 4, y: 2 }, moving: true } },
      [{ t: 'KNOCKDOWN_START' }],
    )
    expect(s.player.vel).toEqual({ x: 0, y: 0 })
    expect(s.player.moving).toBe(false)
  })
})
