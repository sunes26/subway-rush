/**
 * S10 — O-14 단소 추격 🎋
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S10-1~S10-10
 * (S10-11 톤 가드레일은 코드 리뷰 항목)
 *
 * 여기서 재는 것은 "쫓아온다"가 아니라 **"도망이 실제로 성립하는가, 그리고 2대째가
 * 정말로 그 자리에서 런을 끝내는가"** 다. 회수 단계(5대 누적)는 개편으로 사라졌다.
 */

import { describe, expect, it } from 'vitest'
import { GRANDPA_ID } from '../../src/data/interactables'
import { CHASE, JUMP, SPEED, STEP_MS } from '../../src/data/tuning'
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

/** 도망친다. yaw=0 기준 moveY=−1 이 −x(서쪽·안전지대 반대), +1 이 +x(동쪽·개찰구) */
const flee = (s: GameState, ms: number, sprint = false, dir: -1 | 1 = -1): GameState =>
  holdFor(s, { moveY: dir, sprint }, Math.max(1, Math.round(ms / (1000 / 60))))

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

describe('S10-2 걷기만으로도 서서히 벌어지고, 스프린트로는 더 빨리 벌어진다', () => {
  /** 3초 도망친 뒤의 거리 */
  const gapAfter = (sprint: boolean): number => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    s = flee(s, 3000, sprint)
    return Math.hypot(s.chase.pos.x - s.player.pos.x, s.chase.pos.y - s.player.pos.y)
  }

  it('할아버지 속도는 걷기(5.0)를 넘는다 — 5.5다 (디렉터 지시로 5.98에서 −8%)', () => {
    expect(CHASE.speed).toBeCloseTo(5.5, 5)
    expect(CHASE.speed, '걷기보다 빨라야 스프린트가 강제된다').toBeGreaterThan(SPEED.walk)
  })

  it('개찰구 반대쪽으로 걸어 도망치면 3초 안에 두 대 맞고 끝난다', () => {
    /**
     * 순 속도차 −0.5 m/s(5.0−5.5)라 걷기는 **거리를 잃는다.** 안전지대(Z3)를 등지고
     * 걸으면 도망이 아니라 유예일 뿐이다 — 3초 안에 2대(E-16)가 실측이다.
     *
     * 거리(gap)가 아니라 **피격 수**로 잠그는 이유: 스윙 중 할아버지가 멈추므로 거리는
     * 타격 반경 언저리에서 평형을 이룬다(속도를 올려도 1.2m 근처로 수렴한다). 즉
     * 거리는 속도 변화에 둔감하고, 판돈이 걸린 값은 **몇 대 맞느냐**다.
     */
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    s = flee(s, 3000)
    expect(s.chase.hitCount, '걷기 도주 3초').toBeGreaterThanOrEqual(2)
    expect(s.endingId, '두 대째는 그 자리에서 런이 끝난다').toBe('E-16')
  })

  it('개찰구로 스프린트하면 한 대도 안 맞고 이탈한다 — 절도 루트의 성립 조건', () => {
    /**
     * 이 테스트가 절도 루트의 **하한선**이다. 속도를 더 올려 이게 깨지면 절도는
     * 도박이 아니라 함정이 된다(GDD §4.1 "판돈" 설계가 무너진다).
     * 실측(5.5): 1.8초에 x=56 도달 · 무피격 · 스태미너 60 잔여.
     */
    let s = wait(afterSteal(), 40)
    let ms = 0
    while (ms < 12_000 && s.phase === 'playing' && s.chase.active) {
      s = flee(s, STEP_MS, true, +1)   // 동쪽(+x) = 개찰구
      ms += STEP_MS
    }
    expect(s.player.pos.x, `${(ms / 1000).toFixed(1)}초 만에 x=${s.player.pos.x.toFixed(1)}`)
      .toBeGreaterThanOrEqual(CHASE.safeX)
    expect(s.chase.hitCount, '스프린트 직행은 무피격이어야 한다').toBe(0)
    expect(s.phase, '런이 끝나면 안 된다').toBe('playing')
  })

  it('스프린트로 도망치면 걷기보다 훨씬 빨리 벌어진다', () => {
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

  /**
   * 개편 — **회수 단계가 사라졌다.** 예전엔 5대까지 버티면 효자손만 잃고
   * 게임은 계속됐다. 지금은 2대째가 그대로 런의 끝이다 (E-16). `CHASE_END` 를
   * 거치지 않으므로 `chase.active` 나 `phase: 'return'` 같은 해제 절차도 없다 —
   * `chaseSystem` 이 `END` 를 직접 낸다.
   */
  it('S10-6 2대째에 맞으면 그 자리에서 런이 끝난다 (E-16, 회수 단계 없음)', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    for (let i = 0; i < 2; i++) {
      s = { ...s, chase: { ...s.chase, swingCooldownMs: 0, phase: 'chase',
        pos: { x: s.player.pos.x - 0.5, y: s.player.pos.y } } }
      s = wait(s, 40)
    }
    expect(s.chase.hitCount, '2대').toBe(2)
    expect(s.phase, '즉시 게임 오버 — 회수 연출을 기다리지 않는다').toBe('ended')
    expect(s.endingId).toBe('E-16')
    expect(s.inventory.includes('I-01'), '효자손은 손에 쥔 채로 끝난다 — 회수되지 않는다').toBe(true)
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

  it('S10-8 효자손을 반납하면 해제 + 효자손 상실', () => {
    let s = afterSteal()
    s = wait(s, CHASE.drawMs + 60)
    s = { ...s, chase: { ...s.chase, pos: { x: s.player.pos.x - 1.5, y: s.player.pos.y } } }
    s = tap(s, { pressSlot: 1 })          // 1번 슬롯 = 효자손
    expect(s.chase.active, '추격 해제').toBe(false)
    expect(s.inventory.includes('I-01'), '효자손을 잃는다').toBe(false)
  })

  /**
   * 예전엔 여기서 `ACT_DENY('자판기 앞에서 써야 한다')` 가 났다. "언제든 장착"
   * (디렉터 지시 2026-08-07) 이후로는 **손에 들린다** — 그래도 자판기가 열리지는 않는다.
   * 안내 문구(`noTargetReason`)는 사라지지 않고 드는 토스트에 얹힌다.
   */
  it('추격이 아니고 자판기도 없으면 효자손은 손에 들린다 (QTE는 안 열린다)', () => {
    const s = tap(put(start(7, { inventory: ['I-01', null, null] }), 30, 15, FLOOR.B1), { pressSlot: 1 })
    expect(s.hand.item).toBe('I-01')
    expect(s.qte.active, '근처에 자판기가 없다').toBe(false)
    expect(s.act.denyText).toBe('')
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

  /**
   * 개편 후 2대째는 즉사(E-16)다. `afterSteal()` 은 할아버지 바로 앞(≈0.1m)에서 시작해
   * 발도 0.6초를 빼면 사실상 붙어서 추격이 시작되므로, 걸어서 5개 기둥 구간(20초 상당)을
   * 다 돌기 전에 반드시 두 대를 맞고 런이 끝난다 — 예전엔 5대까지 버텨도 됐지만 지금은
   * 아니다. 이 테스트가 재는 건 "끼임 없이 실제로 움직이는가"이지 "생존"이 아니므로,
   * 기둥밭(y 10~20) 밖에서 스프린트로 출발하는 별도 시나리오로 간격을 확보한다
   * (`start`로 상태를 직접 구성 — P2 `wedged()` 와 같은 방식). 도중에 죽어도 그 전까지
   * 낸 이동량으로 판정한다 — 완주가 목적이 아니다.
   */
  it('S10-9 기둥 사이를 스프린트로 지그재그해도 끼여 멈추지 않는다', () => {
    let s = start(7, {
      flags: ['GRANDPA_ANGRY'],
      chase: {
        ...start(7).chase, active: true, phase: 'chase', phaseMs: 900,
        // `CHASE.durationMs`(10_000)보다 훨씬 길게 잡은 값이다 — 일부러다. 이 테스트는
        // "생존"이 아니라 "기둥 사이에서 끼임 없이 실제로 움직이는가"를 재는 이동 프로브라
        // 도중에 시간 제한이나 즉사로 잘려 지그재그 구간을 다 못 도는 걸 피하려는 것뿐이다.
        remainingMs: 30_000, pos: { x: 30, y: 25 }, facing: 0,
        hitCount: 0, swingCooldownMs: 0, stuckMs: 0,
      },
    })
    s = put(s, 30, 17, FLOOR.B1)
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
        s = holdFor(s, { moveY: dx / m, moveX: -dy / m, sprint: true }, 1)
        stuckPeak = Math.max(stuckPeak, s.chase.stuckMs)
        moved += Math.hypot(s.chase.pos.x - prev.x, s.chase.pos.y - prev.y)
        prev = { ...s.chase.pos }
        if (s.phase !== 'playing') break
      }
      if (s.phase !== 'playing') break
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

/**
 * P2 회귀 — **제자리라고 시선까지 멈추면 안 된다.**
 *
 * 플레이 확인에서 나왔다: *"할아버지가 뒤로 돈 채 쫓아온다."*
 * 원인은 둘이었다. `CHASE_START` 가 `facing` 을 안 실어서 발도 0.6초 동안 초기값 0(동쪽)이
 * 남았고, `draw`·`swing` 구간이 아무 액션도 안 내서 그 사이 `facing` 이 얼어붙었다.
 */
describe('P2 — 발도·스윙 중에도 시선은 플레이어를 따라간다', () => {
  const steal = (px: number, py: number): GameState => {
    const s = put(start(7, { flags: ['GRANDPA_ANGRY'], inventory: ['I-01', null, null] }), px, py, FLOOR.B1)
    return holdFor(s, {}, 2)
  }

  it('일어서는 순간 이미 플레이어를 본다 (0 = 동쪽이 남지 않는다)', () => {
    const s = steal(42, 12.0)                 // 할아버지 남쪽에 서 있다
    expect(s.chase.phase).toBe('draw')
    // 남쪽을 봐야 한다 — −π/2 근처
    expect(Math.abs(s.chase.facing + Math.PI / 2), `facing=${s.chase.facing}`).toBeLessThan(0.4)
  })

  it('서쪽에서 훔치면 서쪽을 본다 — 방향이 실제로 따라간다', () => {
    const s = steal(38, 14.9)
    expect(Math.abs(Math.abs(s.chase.facing) - Math.PI), `facing=${s.chase.facing}`).toBeLessThan(0.4)
  })

  it('발도 중에 플레이어가 옮겨가면 시선도 따라간다', () => {
    const a = steal(42, 12.0)
    expect(a.chase.phase).toBe('draw')
    const moved = put(a, 46, 14.9, FLOOR.B1)  // 동쪽으로 순간이동
    const b = holdFor(moved, {}, 2)
    expect(Math.abs(b.chase.facing), `facing=${b.chase.facing}`).toBeLessThan(0.4)   // 동쪽 ≈ 0
  })
})

/**
 * P2 회귀 — **끼임 탈출이 뒤로 걷지 않는다.**
 *
 * 예전엔 `facing` 반대로 1.5m 후퇴했다. 얼굴은 플레이어를 보면서 몸만 뒤로 가는 그림이라
 * 디렉터가 "할아버지가 뒤로 이동한다"고 지적했다. 사람은 기둥에 걸리면 옆으로 돈다.
 */
describe('P2 — 끼임 탈출은 옆으로 돈다', () => {
  /** Z2 기둥(x 36, y 20) 정동쪽에 붙여 세운다 — 플레이어는 기둥 반대편 */
  const wedged = (): GameState => {
    const s = start(7, {
      flags: ['GRANDPA_ANGRY'],
      chase: {
        ...start(7).chase, active: true, phase: 'chase', phaseMs: 900,
        remainingMs: 25_000, pos: { x: 36.9, y: 20 }, facing: Math.PI,
        hitCount: 0, swingCooldownMs: 0, stuckMs: CHASE.stuckMs,
      },
    })
    return put(s, 34.4, 20, FLOOR.B1)          // 기둥 서쪽 — 직진하면 기둥에 막힌다
  }

  it('막히면 옆으로 이동하고, 시선은 플레이어를 유지한다', () => {
    const a = wedged()
    const b = holdFor(a, {}, 6)
    const moved = Math.hypot(b.chase.pos.x - a.chase.pos.x, b.chase.pos.y - a.chase.pos.y)
    expect(moved, '어떻게든 움직인다').toBeGreaterThan(0.01)
    // 플레이어를 향한 방향과의 오차가 90° 안 — 등을 보이지 않는다
    const want = Math.atan2(b.player.pos.y - b.chase.pos.y, b.player.pos.x - b.chase.pos.x)
    let err = b.chase.facing - want
    while (err > Math.PI) err -= 2 * Math.PI
    while (err < -Math.PI) err += 2 * Math.PI
    expect(Math.abs(err), `facing 오차 ${(err * 180 / Math.PI).toFixed(1)}°`)
      .toBeLessThan(Math.PI / 2)
  })

  it('막히지 않으면 곧장 다가온다 (회귀)', () => {
    const s = start(7, {
      flags: ['GRANDPA_ANGRY'],
      chase: {
        ...start(7).chase, active: true, phase: 'chase', phaseMs: 900, remainingMs: 25_000,
        pos: { x: 42, y: 18 }, facing: -Math.PI / 2, hitCount: 0, swingCooldownMs: 0, stuckMs: 0,
      },
    })
    const a = put(s, 42, 12, FLOOR.B1)
    const b = holdFor(a, {}, 30)
    expect(b.chase.pos.y, '남쪽으로 다가온다').toBeLessThan(18)
  })
})
