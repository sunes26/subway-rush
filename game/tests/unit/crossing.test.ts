/**
 * Z1 횡단보도 · 차도 — **막는 것이 없다**는 것을 못 박는다.
 *
 * 이 파일은 원래 반대를 재고 있었다. "횡단보도 앞에서 간헐적으로 앞으로 못 간다"는
 * 제보를 쫓아가 보니 적신호 차단벽(`LIGHT-BLOCK`)이 x −31.62 에서 세우고 있었고,
 * 그 사실을 숫자로 고정해 둔 것이 옛 테스트였다.
 *
 * 디렉터 지시로 규칙이 바뀌었다 — **적신호에도 자유롭게 건넌다.** 차도에도 내려설 수
 * 있다. 막는 대신 차에 치이면 스폰으로 되돌아간다(`systems/roadHazard`).
 * 그래서 여기서 재는 것도 뒤집혔다: 벽이 **없다**는 것, 그리고 갈 수 있는 범위가
 * 어디까지인가.
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
const FWD: InputFrame = { ...EMPTY_INPUT, moveY: 1 }

/** 제보된 지점 */
const REPORTED = { x: -32.5, y: 27.6 } as const
/** 적신호가 확실한 시각 */
const RED = TRAFFIC_LIGHT.greenMs + 1000

const walking = (x: number, y: number, lightMs: number): GameState => {
  const s = { ...initialState(42), phase: 'playing' as const, lightMs }
  return { ...s, player: { ...s.player, pos: { x, y, z: FLOOR.L0 }, vel: { x: 0, y: 0 } } }
}

/** `yaw` 방향으로 sec초 밀고 최종 위치. 신호는 흐르므로 도중에 바뀔 수 있다. */
const push = (s: GameState, sec: number, yaw = 0): { x: number; y: number } => {
  let cur = s
  for (let i = 0; i < Math.round(sec * 60); i++) {
    cur = tick(cur, STEP, { input: FWD, cameraYaw: yaw })
  }
  return { x: cur.player.pos.x, y: cur.player.pos.y }
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
    // 슬랩이 비면 resolveMove가 이동을 통째로 되돌린다 — 막힌 것과 같은 증상이다
    for (let x = -34; x <= -30.0001; x += 0.25) {
      for (let y = 24.5; y <= 30.5001; y += 0.25) {
        expect(isWalkable(+x.toFixed(2), +y.toFixed(2), FLOOR.L0), `${x},${y}`).toBe(true)
      }
    }
  })
})

describe('Z1 횡단보도 — 적신호에도 건넌다', () => {
  it('적신호에 횡단보도를 그대로 지나간다', () => {
    const end = push(walking(-36, 27.6, RED), 4.0)
    expect(end.x).toBeGreaterThan(CROSSWALK.xMax)
  })

  it('녹신호에도 물론 지나간다', () => {
    const end = push(walking(-36, 27.6, 0), 4.0)
    expect(end.x).toBeGreaterThan(CROSSWALK.xMax)
  })

  it('이면도로는 횡단보도 밖(북·남)에서도 건널 수 있다', () => {
    // 예전에는 `Z1-SIDEROAD-S/N` 이 대역 밖을 막아 우회를 봉쇄했다. 지금은 무단횡단이
    // 허용되므로 인도 폭 어디서든 지나갈 수 있어야 한다.
    // y 23.5 부터 재는 이유는 아래 신호등 폴 테스트에 적어 뒀다.
    for (let y = 23.5; y <= 33.5001; y += 0.5) {
      const end = push(walking(-33, +y.toFixed(2), RED), 3.0)
      expect(end.x, `y=${y.toFixed(1)} 에서 막힘`).toBeGreaterThan(CROSSWALK.xMax)
    }
  })

  it('신호등 폴은 그대로 막는다 — 벽을 걷었다고 물건까지 없앤 것은 아니다', () => {
    // `OBJ-02-LIGHT` 는 (−32.6, 22.6) 의 0.4 × 0.4 기둥이다. 위 스윕이 y 23.5 에서
    // 시작하는 것도 이것 때문이다. 여기까지 뚫리면 충돌 자체가 깨진 것이다.
    const end = push(walking(-35, 22.6, RED), 3.0)
    expect(end.x).toBeLessThan(-32.6 - 0.2 + MOVE.radius)
  })
})

describe('Z1 차도 — 내려설 수 있다', () => {
  /** 남쪽(−y)을 향하는 요. 부호가 뒤집히면 이 테스트가 먼저 깨진다. */
  const SOUTH = -Math.PI / 2

  it('인도에서 차도(y 16~22)로 내려선다', () => {
    const end = push(walking(-40, 24.0, RED), 3.0, SOUTH)
    expect(end.y).toBeLessThan(22.0)
  })

  it('차도 남쪽 끝(y 16)에서 멈춘다 — 그 너머는 슬랩이 없다', () => {
    // 건너편 인도(y 12.6~16)는 건물이 시작하는 곳이라 일부러 안 연다.
    const end = push(walking(-40, 24.0, RED), 8.0, SOUTH)
    expect(end.y).toBeGreaterThan(16.0 - 0.01)
    expect(end.y).toBeLessThan(16.0 + MOVE.radius + 0.2)
  })

  it('차도 바닥이 걸을 수 있는 면으로 깔려 있다', () => {
    for (let x = -60; x <= 10.0001; x += 2) {
      for (let y = 16.5; y <= 21.5001; y += 0.5) {
        expect(isWalkable(x, +y.toFixed(2), FLOOR.L0), `${x},${y}`).toBe(true)
      }
    }
  })
})
