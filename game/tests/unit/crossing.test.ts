/**
 * Z1 횡단보도 — 적신호 차단벽이 **어디서** 멈추는가.
 *
 * "횡단보도 앞에서 간헐적으로 앞으로 못 간다"는 제보가 (−32.5, 27.6, 0) 으로 들어왔다.
 * 실측해 보니 그 좌표에는 정적·동적 어느 충돌체도 없다 — 3.3m 안에 아무것도 없고
 * 인도 슬랩도 빈틈이 없다. 간헐적으로 막는 것은 신호 차단벽 하나뿐이고, 그 벽이
 * 플레이어를 세우는 지점은 x = −31.62 다 (제보 좌표에서 0.88m 동쪽).
 *
 * 그래서 이 파일은 "고쳤다"가 아니라 **"어디까지가 사실인가"**를 못 박는다.
 * 차단벽 위치를 건드리는 사람은 여기 숫자부터 보게 된다.
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { MOVE } from '../../src/data/tuning'
import { CROSSWALK, FLOOR, SOLIDS, TRAFFIC_LIGHT } from '../../src/data/world'
import { rectOverlapsCircle } from '../../src/core/math'
import { initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { isWalkable } from '../../src/systems/collision'
import { tick } from '../../src/systems/tick'

const STEP = 1000 / 60
const EAST: InputFrame = { ...EMPTY_INPUT, moveY: 1 }

/** 제보된 지점 */
const REPORTED = { x: -32.5, y: 27.6 } as const

const walking = (x: number, y: number, lightMs: number): GameState => {
  const s = { ...initialState(42), phase: 'playing' as const, lightMs }
  return { ...s, player: { ...s.player, pos: { x, y, z: FLOOR.L0 }, vel: { x: 0, y: 0 } } }
}

/** 동쪽으로 계속 밀며 sec초 뒤 위치. 신호는 흐르므로 도중에 바뀔 수 있다. */
const pushEast = (s: GameState, sec: number): number => {
  let cur = s
  for (let i = 0; i < Math.round(sec * 60); i++) cur = tick(cur, STEP, { input: EAST, cameraYaw: 0 })
  return cur.player.pos.x
}

describe('Z1 횡단보도 — 제보 좌표 검증', () => {
  it('제보 좌표 반경 3.3m 안에 지상에서 막는 충돌체가 하나도 없다', () => {
    const blocking = SOLIDS.filter((s) =>
      // collision.ts의 blocksAt과 같은 판정 (아래 1.2m 여유 포함)
      FLOOR.L0 > s.z0 - 1.2 && FLOOR.L0 < s.z0 + s.h
      && rectOverlapsCircle(s.rect, REPORTED.x, REPORTED.y, MOVE.radius + 3.0))
    expect(blocking.map((s) => s.id)).toEqual([])
  })

  it('횡단보도 대역의 인도 슬랩에 구멍이 없다', () => {
    // 슬랩이 비면 resolveMove가 이동을 통째로 되돌린다 — 같은 증상으로 보인다
    for (let x = -34; x <= -30.0001; x += 0.25) {
      for (let y = 24.5; y <= 30.5001; y += 0.25) {
        expect(isWalkable(+x.toFixed(2), +y.toFixed(2), FLOOR.L0), `${x},${y}`).toBe(true)
      }
    }
  })

  it('적신호에도 제보 좌표에서는 앞으로 갈 수 있다', () => {
    // 0.5초면 2m 넘게 갈 거리인데, 벽은 0.88m 앞에 있다
    const end = pushEast(walking(REPORTED.x, REPORTED.y, TRAFFIC_LIGHT.greenMs + 1000), 0.5)
    expect(end).toBeGreaterThan(REPORTED.x + 0.5)
  })
})

describe('Z1 횡단보도 — 신호 차단벽', () => {
  it('적신호에는 차도 연석 앞에서 멈춘다', () => {
    const end = pushEast(walking(-36, 27.6, TRAFFIC_LIGHT.greenMs + 1000), 3.0)
    // 차단벽 서쪽 면(CROSSWALK.xMin − 0.3)에 플레이어 반경만큼 못 미친 자리
    expect(end).toBeCloseTo(CROSSWALK.xMin - 0.3 - MOVE.radius, 2)
  })

  it('녹신호에는 횡단보도를 그대로 지나간다', () => {
    const end = pushEast(walking(-36, 27.6, 0), 4.0)
    expect(end).toBeGreaterThan(CROSSWALK.xMax)
  })

  it('차단벽이 인도 폭 전체를 막는다 — 옆으로 돌아갈 틈이 없다', () => {
    // 신호 대역(y 23.9~31.1) 밖은 이면도로 차단벽이 맡는다. 둘 사이가 벌어지면
    // 적신호를 무시하고 북/남으로 우회할 수 있게 된다.
    for (let y = 22.5; y <= 33.5001; y += 0.2) {
      const end = pushEast(walking(-33, +y.toFixed(2), TRAFFIC_LIGHT.greenMs + 1000), 2.0)
      expect(end, `y=${y.toFixed(1)} 로 우회 가능`).toBeLessThan(CROSSWALK.xMin)
    }
  })
})
