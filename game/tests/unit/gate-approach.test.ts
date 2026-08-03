/**
 * 개찰구 접근 — 게이트 앞 좌우 이동과 정면 정렬.
 *
 * "게이트 앞 화살표 위에 서면 좌우로 못 간다"가 여기서 나왔다.
 * 범인은 충돌체가 아니라 movement의 **퍼널**이었다. 퍼널이 시간에 비례해 당기면
 * 걸음 속도와 평형을 이루는 지점이 생기고, 그 거리가 게이트 피치의 절반보다
 * 짧으면 옆 게이트로 건너갈 방법이 사라진다 — 고장 난 게이트 앞에 갇힌다.
 *
 * 그래서 이 파일은 두 가지를 동시에 못 박는다.
 *  ① 게이트 라인 앞에서 y로 자유롭게 오갈 수 있다
 *  ② 그럼에도 정면 진입은 여전히 게이트 중앙으로 정렬된다 (통로가 좁다)
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { MOVE } from '../../src/data/tuning'
import {
  FLOOR, GATES, GATE_BODY, GATE_CLEARANCE, GATE_FUNNEL_X, PAID_AREA_X, SOLIDS,
} from '../../src/data/world'
import { initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { tick } from '../../src/systems/tick'

const STEP = 1000 / 60

/** cameraYaw = 0 기준 변환은 dirX = moveY · dirY = −moveX (movement.ts) */
const strafe = (sign: 1 | -1): InputFrame => ({ ...EMPTY_INPUT, moveX: -sign })
const AHEAD: InputFrame = { ...EMPTY_INPUT, moveY: 1 }

const standing = (x: number, y: number, patch: Partial<GameState> = {}): GameState => {
  const s = { ...initialState(42), phase: 'playing' as const, ...patch }
  return { ...s, player: { ...s.player, pos: { x, y, z: FLOOR.B1 }, vel: { x: 0, y: 0 } } }
}

const hold = (s: GameState, input: InputFrame, sec: number): GameState => {
  let cur = s
  for (let i = 0; i < Math.round(sec * 60); i++) cur = tick(cur, STEP, { input, cameraYaw: 0 })
  return cur
}

/** G4 = y 14. 게이트 피치는 2.0m이므로 옆 게이트까지의 거리도 2.0m다. */
const G4 = GATES[3]!

describe('Z3 게이트 앞 좌우 이동', () => {
  it('입력이 없으면 게이트 앞에서 저절로 옆으로 미끄러지지 않는다', () => {
    // 두 게이트 사이(y 15.0)에 가만히 서 있는다. 퍼널이 시간 기준이면 여기서
    // 손을 놓고 있어도 1초 만에 G4 중앙까지 1.0m를 끌려간다.
    const s = hold(standing(59.0, 15.0), EMPTY_INPUT, 1.0)
    expect(s.player.pos.y).toBeCloseTo(15.0, 2)
  })

  it('게이트 앞에서 옆 게이트까지 걸어갈 수 있다', () => {
    // 고장 난 게이트 앞에 섰을 때 옆으로 옮겨 갈 수 없으면 게임이 거기서 끝난다.
    const s = hold(standing(58.6, G4.y), strafe(1), 2.0)
    expect(s.player.pos.y - G4.y).toBeGreaterThan(2.0)
  })

  it('게이트 라인 앞을 남에서 북까지 종주할 수 있다', () => {
    const first = GATES[0]!
    const last = GATES[GATES.length - 1]!
    const s = hold(standing(59.0, first.y), strafe(1), 5.0)
    expect(s.player.pos.y).toBeGreaterThanOrEqual(last.y)
  })

  it('퍼널 구간을 되돌아 나올 수도 있다', () => {
    const s = hold(standing(59.0, GATES[7]!.y), strafe(-1), 3.0)
    expect(s.player.pos.y).toBeLessThanOrEqual(GATES[0]!.y)
  })
})

describe('Z3 게이트 정면 진입', () => {
  it('통로에서 0.8m 벗어나 들어가도 게이트 중앙으로 정렬된다', () => {
    // 충돌 개구 0.4m − 플레이어 반경 0.32m = 중심이 0.08m 안에 들어와야 통과한다.
    // 퍼널이 이 정렬을 해 주지 못하면 정상 게이트조차 몸으로 막힌다.
    const s = hold(standing(GATE_FUNNEL_X.min - 0.4, G4.y + 0.8, { gates: { ...initialState(42).gates, passed: true } }), AHEAD, 1.2)
    expect(s.player.pos.x).toBeGreaterThan(GATE_BODY.xMin)
    expect(Math.abs(s.player.pos.y - G4.y)).toBeLessThanOrEqual(GATE_CLEARANCE(G4) - MOVE.radius)
  })

  it('정면 진입은 운임구역까지 통과한다', () => {
    const s = hold(standing(GATE_FUNNEL_X.min - 0.4, G4.y + 0.8, { gates: { ...initialState(42).gates, passed: true } }), AHEAD, 2.0)
    expect(s.player.pos.x).toBeGreaterThan(PAID_AREA_X)
  })
})

describe('Z3 게이트 뱅크 충돌체', () => {
  // 좌우 이동 차단의 범인으로 처음 의심받은 곳이다 — 빗살이 플레이어 쪽(−x)으로
  // 더 나와 있으면 접근 차선에 서기만 해도 슬롯 안이 된다. 실제로는 아니었고,
  // 그 사실을 여기서 못 박아 둔다.
  it('빗살이 게이트 본체 x 범위를 한 톨도 벗어나지 않는다', () => {
    const teeth = SOLIDS.filter((s) => s.id.startsWith('GATE-BANK'))
    expect(teeth.length).toBeGreaterThan(0)
    for (const t of teeth) {
      expect(t.rect[0], `${t.id} 서쪽 면`).toBe(GATE_BODY.xMin)
      expect(t.rect[2], `${t.id} 동쪽 면`).toBe(GATE_BODY.xMax)
    }
  })

  it('접근 차선(x 56.5~60.0)에는 게이트 충돌체가 없다', () => {
    for (const s of SOLIDS) {
      if (s.rect[0] >= 60.0 || s.rect[2] <= 56.5) continue
      if (s.rect[1] > 24.5 || s.rect[3] < 7.5) continue        // 게이트 y 대역 밖은 볼 것 없다
      expect(s.id, `${s.id} 가 접근 차선을 침범한다`).toMatch(/^(Z2-E|OBJ-12-OFFICE)/)
    }
  })
})
