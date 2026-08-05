/**
 * S10 — O-14 단소 추격 🎋
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S10-1~S10-10
 * (S10-11 톤 가드레일은 코드 리뷰 항목)
 *
 * 여기서 재는 것은 "쫓아온다"가 아니라 **"8초 아끼려다 20초를 잃는가"** 다.
 */

import { describe, expect, it } from 'vitest'
import { GRANDPA_ID } from '../../src/data/interactables'
import { CHASE, JUMP, SPEED } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState } from '../../src/state/types'
import { benchPos, chaseSolids, standPos } from '../../src/systems/chase'
import { frame, holdFor, put, start, tap, wait, yawTo } from './_pilot'

const GP = benchPos()

/** 훔친 직후 상태 — 대화 UI를 거쳐 실제 경로로 만든다 */
const afterSteal = (seed = 7): GameState => {
  const s0 = put(start(seed), GP.x, GP.y - 1.2, FLOOR.B1)
  const yaw = yawTo(s0, GP.x, GP.y)
  const opened = tap(s0, { pressInteract: true }, yaw)
  return tap(opened, { pressSlot: 1 }, yaw)
}

/** 서쪽(−x)으로 도망친다. yaw=0 기준 moveY=−1 이 −x 다 */
const flee = (s: GameState, ms: number, sprint = false): GameState =>
  holdFor(s, { moveY: -1, sprint }, Math.round(ms / (1000 / 60)))

describe('S10-1 발동 타이밍', () => {
  it('훔치면 추격이 시작되고 0.6초 발도 구간엔 때리지 않는다', () => {
    let s = afterSteal()
    expect(s.flags.includes('GRANDPA_ANGRY')).toBe(true)
    s = wait(s, 30)
    expect(s.chase.active, '추격 시작').toBe(true)
    expect(s.chase.phase).toBe('draw')

    // 발도 중에는 코앞(사거리 안)에 서 있어도 안 맞는다
    s = { ...s, chase: { ...s.chase, pos: { x: s.player.pos.x - 1.0, y: s.player.pos.y } } }
    s = wait(s, CHASE.drawMs - 100)
    expect(s.chase.hitCount, '발도 중 피격 0').toBe(0)
    expect(s.chase.phase).toBe('draw')
    // 발도가 끝나는 순간 사거리 안이므로 곧바로 스윙으로 넘어간다 — 그게 정상이다
    s = wait(s, 200)
    expect(s.chase.phase, '발도 종료 → 추격/스윙').not.toBe('draw')
    expect(s.chase.hitCount, '발도가 끝났으니 이제 때린다').toBe(1)
  })

  it('훔치지 않으면 추격이 없다', () => {
    const s = wait(start(7), 2000)
    expect(s.chase.active).toBe(false)
    expect(s.chase.phase).toBe('idle')
  })

  it('한 번 끝난 추격은 재발동하지 않는다', () => {
    let s = afterSteal()
    s = wait(s, 100)
    s = { ...s, player: { ...s.player, pos: { x: CHASE.safeX + 1, y: 14, z: FLOOR.B1 } } }
    s = wait(s, 60)
    expect(s.chase.active, 'Z3 진입으로 해제').toBe(false)
    expect(s.flags.includes('CHASE_DONE')).toBe(true)
    // 벤치 쪽으로 되돌려도 다시 안 켜진다
    s = wait({ ...s, chase: { ...s.chase, phase: 'idle' } }, 500)
    expect(s.chase.active).toBe(false)
  })
})

describe('S10-2 걷기로는 못 벗어나고 스프린트로는 벗어난다', () => {
  /** 3초 도망친 뒤의 거리 */
  const gapAfter = (sprint: boolean): number => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    s = flee(s, 3000, sprint)
    return Math.hypot(s.chase.pos.x - s.player.pos.x, s.chase.pos.y - s.player.pos.y)
  }

  it('할아버지 속도가 걷기와 같다', () => {
    expect(CHASE.speed).toBe(SPEED.walk)
  })

  it('걸어서 도망치면 거리가 벌어지지 않는다', () => {
    expect(gapAfter(false), '걷기로는 절대 못 벗어난다').toBeLessThan(CHASE.hitRangeM + 0.6)
  })

  it('스프린트로 도망치면 거리가 벌어진다', () => {
    const sprintGap = gapAfter(true)
    expect(sprintGap, `스프린트 3초 후 ${sprintGap.toFixed(1)}m`).toBeGreaterThan(gapAfter(false) + 2)
  })
})

describe('S10-3~S10-6 피격', () => {
  /** 코앞에 붙여 놓고 n초 버틴다 */
  const stand = (ms: number): GameState => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    // 추격 페이즈에서 바로 옆에 세운다
    s = { ...s, chase: { ...s.chase, pos: { x: s.player.pos.x - 0.5, y: s.player.pos.y } } }
    return wait(s, ms)
  }

  it('S10-3 피격당 감속 0.2 · 상한 1.0 · 음수 속도 0건', () => {
    const s = stand(80)
    expect(s.chase.hitCount).toBe(1)
    expect(s.player.speedPenalty).toBeGreaterThan(0.15)
    expect(s.player.speedPenalty).toBeLessThanOrEqual(1)

    // 강제로 과다 누적시켜도 1을 넘지 않는다
    let over = s
    for (let i = 0; i < 12; i++) {
      over = { ...over, chase: { ...over.chase, swingCooldownMs: 0, phase: 'chase',
        pos: { x: over.player.pos.x - 0.5, y: over.player.pos.y } } }
      over = wait(over, 40)
    }
    expect(over.player.speedPenalty, '상한').toBeLessThanOrEqual(1)
    expect(over.player.speedPenalty).toBeGreaterThanOrEqual(0)
  })

  it('S10-4 비피격 시 초당 0.05 회복한다', () => {
    // 0.2 에서 재면 5초(0.25) 만에 0 에 닿아 클램프가 측정을 먹는다.
    // 회복률 자체를 재려면 바닥에서 떨어진 값에서 시작해야 한다.
    const hit0 = stand(80)
    const hit = { ...hit0, player: { ...hit0.player, speedPenalty: 0.8 } }
    const p0 = hit.player.speedPenalty
    /**
     * 추격을 끝낸 뒤 5초 가만히 있는다.
     * ⚠ `CHASE_DONE` 을 같이 세워야 한다 — 이 플래그가 재발동을 막는 유일한 장치이고,
     *   리듀서를 우회해 상태를 손으로 만들면 귀환 → idle → **재발동**이 돌아 계속 맞는다.
     *   (실측: 5초 뒤 감속이 0.8 → 0.94 로 늘어 있었다)
     */
    const away: GameState = {
      ...hit,
      flags: [...hit.flags, 'CHASE_DONE'],
      chase: { ...hit.chase, active: false, phase: 'idle' as const },
    }
    const after = wait(away, 5000)
    const recovered = p0 - after.player.speedPenalty
    expect(recovered, `5초에 ${recovered.toFixed(3)} 회복`).toBeGreaterThan(0.24)
    expect(recovered).toBeLessThan(0.26)
  })

  it('S10-5 쿨다운 1.5초 안에 두 번 맞지 않는다', () => {
    const s = stand(1400)
    expect(s.chase.hitCount, '1.4초 동안 1대').toBe(1)
    const later = wait(s, 300)
    expect(later.chase.hitCount, '1.5초를 넘기면 2대').toBe(2)
  })

  it('S10-6 피격당 양심 −1', () => {
    const s = stand(80)
    expect(s.scores.conscience, '절도 −3 + 피격 −1').toBe(-4)
  })

  it('S10-6 5대 맞으면 효자손을 회수당하고 양심 하한에 걸린다', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    for (let i = 0; i < 5; i++) {
      s = { ...s, chase: { ...s.chase, swingCooldownMs: 0, phase: 'chase',
        pos: { x: s.player.pos.x - 0.5, y: s.player.pos.y } } }
      s = wait(s, 40)
    }
    expect(s.chase.hitCount).toBe(CHASE.seizeHits)

    s = wait(s, 60)
    expect(s.chase.phase, '회수 연출').toBe('seize')
    expect(s.player.speedPenalty, '완전 정지').toBe(1)

    s = wait(s, CHASE.seizeMs + 100)
    expect(s.inventory.includes('I-01'), '효자손 회수당했다').toBe(false)
    expect(s.scores.conscience, '하한 −5에서 묶인다').toBe(-5)
    expect(s.chase.active, '추격 종료').toBe(false)
    expect(s.phase, '게임은 계속된다 — 즉사가 아니다').toBe('playing')
  })
})

describe('S10-7~S10-8 해제 3경로', () => {
  it('Z3 진입(x ≥ 56)이면 즉시 해제된다', () => {
    let s = afterSteal()
    s = wait(s, 100)
    s = { ...s, player: { ...s.player, pos: { x: CHASE.safeX + 0.5, y: 14, z: FLOOR.B1 } } }
    s = wait(s, 40)
    expect(s.chase.active).toBe(false)
    expect(s.inventory.includes('I-01'), '효자손은 지킨다').toBe(true)
  })

  it('30초가 지나면 해제된다', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    // 잔여를 직접 0으로 만들어 30초 시뮬을 생략한다 (타이머 감산은 ADVANCE 단일 경로)
    s = { ...s, chase: { ...s.chase, remainingMs: 1 } }
    s = wait(s, 60)
    expect(s.chase.active).toBe(false)
    expect(s.inventory.includes('I-01')).toBe(true)
  })

  it('S10-8 효자손을 반납하면 해제 + 양심 +1 + 효자손 상실', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    s = { ...s, chase: { ...s.chase, pos: { x: s.player.pos.x - 1.5, y: s.player.pos.y } } }
    const c0 = s.scores.conscience
    s = tap(s, { pressSlot: 1 })          // 1번 슬롯 = 효자손
    expect(s.chase.active, '추격 해제').toBe(false)
    expect(s.inventory.includes('I-01'), '효자손을 잃는다').toBe(false)
    expect(s.scores.conscience, '양심 +1').toBe(c0 + 1)
  })

  it('추격이 아닐 때 효자손 슬롯은 자판기용으로 남는다', () => {
    const s = tap(put(start(7, { inventory: ['I-01', null, null] }), 30, 15, FLOOR.B1), { pressSlot: 1 })
    expect(s.act.denyText, '근처에 자판기가 없다').toBe('자판기 앞에서 써야 한다')
  })
})

describe('S10-9~S10-10 몸통과 끼임', () => {
  it('S10-10 몸통 높이가 점프 정점보다 훨씬 높다 (뛰어넘기 불가)', () => {
    const apex = (JUMP.speed * JUMP.speed) / (2 * JUMP.gravity)
    expect(apex, `점프 정점 ${apex.toFixed(2)}m`).toBeLessThan(0.6)
    expect(CHASE.bodyH).toBeGreaterThan(apex * 2.5)
  })

  it('추격 중에만 몸통 솔리드가 존재한다', () => {
    expect(chaseSolids(start(7)).length, '평시엔 없다').toBe(0)
    let s = afterSteal()
    s = wait(s, 60)
    const solids = chaseSolids(s)
    expect(solids.length).toBe(1)
    expect(solids[0]?.h).toBe(CHASE.bodyH)
    expect(solids[0]?.id).toBe('CHASE-GP')
  })

  it('S10-9 기둥 사이 20초 추격에서 끼여 멈추지 않는다', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    let stuckPeak = 0
    let moved = 0
    let prev = { ...s.chase.pos }
    // Z2 기둥(x 12/24/36/48 × y 10/20) 사이를 지그재그로 돈다
    const legs: readonly [number, number][] = [[24, 10], [36, 20], [12, 20], [48, 10], [24, 20]]
    for (const [tx, ty] of legs) {
      for (let i = 0; i < 240; i++) {
        const dx = tx - s.player.pos.x
        const dy = ty - s.player.pos.y
        const m = Math.hypot(dx, dy) || 1
        s = holdFor(s, { moveY: dx / m, moveX: -dy / m }, 1)
        stuckPeak = Math.max(stuckPeak, s.chase.stuckMs)
        moved += Math.hypot(s.chase.pos.x - prev.x, s.chase.pos.y - prev.y)
        prev = { ...s.chase.pos }
        if (!s.chase.active) break
      }
      if (!s.chase.active) break
    }
    expect(stuckPeak, `끼임 누적 최대 ${stuckPeak.toFixed(0)}ms — 탈출 임계 미만`)
      .toBeLessThan(CHASE.stuckMs)
    // 사거리(1.2m) 안에서는 제자리에 서므로 이동 거리는 경로 길이보다 짧게 나온다
    expect(moved, `할아버지가 ${moved.toFixed(1)}m 이동했다`).toBeGreaterThan(12)
  })

  it('할아버지는 플레이어를 밀지 않는다 (몸통은 막을 뿐)', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    const p0 = { ...s.player.pos }
    // 사거리 경계(1.0m)에 세운다. 몸통(0.34)+플레이어(0.32)=0.66m 이므로 겹치지 않는다 —
    // 겹치게 놓으면 `depenetrate` 가 밀어내는 게 당연하고, 그건 이 테스트의 관심사가 아니다.
    s = { ...s, chase: { ...s.chase, pos: { x: p0.x - 1.0, y: p0.y } } }
    s = holdFor(s, {}, 60)
    const pushed = Math.hypot(s.player.pos.x - p0.x, s.player.pos.y - p0.y)
    expect(pushed, `밀린 거리 ${pushed.toFixed(3)}m`).toBeLessThan(0.05)
  })
})

describe('S10 실질 비용 — 절도가 공짜가 아니다', () => {
  it('맞으면서 도망친 30초가 그냥 걸은 30초보다 짧은 거리를 낸다', () => {
    // 같은 조건에서 추격만 다르게 준다
    const distance = (chased: boolean): number => {
      let s = chased ? afterSteal() : put(start(7), GP.x, GP.y - 1.2, FLOOR.B1)
      s = wait(s, CHASE.drawMs + 60)
      const x0 = s.player.pos.x
      for (let i = 0; i < 6; i++) {
        if (chased) {
          // 추격자가 계속 따라붙는 상황을 재현한다
          s = { ...s, chase: { ...s.chase, swingCooldownMs: 0, phase: 'chase',
            pos: { x: s.player.pos.x - 0.6, y: s.player.pos.y } } }
        }
        s = flee(s, 800)
      }
      return Math.abs(s.player.pos.x - x0)
    }
    const free = distance(false)
    const chased = distance(true)
    expect(chased, `추격 ${chased.toFixed(1)}m vs 자유 ${free.toFixed(1)}m`).toBeLessThan(free * 0.8)
  })

  it('무입력 프레임(frame())이 추격을 진행시킨다 — 시뮬 결정성 확인', () => {
    let a = afterSteal()
    let b = afterSteal()
    for (let i = 0; i < 120; i++) {
      a = holdFor(a, {}, 1)
      b = holdFor(b, {}, 1)
    }
    expect(a.chase.pos).toEqual(b.chase.pos)
    expect(a.chase.hitCount).toBe(b.chase.hitCount)
    expect(frame().moveX, 'EMPTY 입력은 중립이다').toBe(0)
  })

  it('할아버지는 벤치 앞에 일어서서 출발한다 (벤치 솔리드 안이 아니다)', () => {
    const s = wait(afterSteal(), 30)
    const st = standPos()
    expect(s.chase.pos.x).toBeCloseTo(st.x, 3)
    expect(s.chase.pos.y).toBeCloseTo(st.y, 3)
    // 벤치 rect[40.8, 14.6, 43.2, 15.4] 밖이어야 한 발이라도 움직인다
    expect(s.chase.pos.y).toBeLessThan(14.6)
    expect(GRANDPA_ID).toBe('ACT-02-GP')
  })
})
