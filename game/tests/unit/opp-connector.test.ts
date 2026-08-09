/**
 * 반대 방면 연결부(디렉터 지시) 통행성 회귀 테스트.
 *
 * 세 번 잘못 세워 봤다 — 벽 없음(9/9 실패) · 짧은 parapet(모서리 두 개) ·
 * wallWithGaps 단독(모서리 하나, `Z4-COR-S-OPP` 서쪽 끝에 걸림). `isWalkable`
 * (바닥 유무)로는 안 잡히고 **실제 `tick()`으로 원형 충돌까지 돌려야** 드러났다.
 * 최종형: `CONN-W`를 통로 걷는 폭(y46)까지 겹치게 늘리고, `Z3-E-OPP`(원본 `Z3-E`와
 * 같은 자리·같은 수법)로 x=72 진입 전에 플레이어 y를 미리 정렬시킨다.
 *
 * ⚠ Z3-N은 개찰구 서쪽(x56~61)에 벽이 서 있다 — 연결부(x61~72)만 열려 있다.
 *   그래서 출발 x는 **x61 동쪽만** 잰다. 서쪽에서 출발해 직선으로 걸으면 벽에
 *   막히는 게 지금은 정상이다(개찰구를 거치지 않고 옆으로 새는 걸 막는 벽이다).
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { tick } from '../../src/systems/tick'

const STEP = 1000 / 60

const seek = (s: GameState, tx: number, ty: number): InputFrame => {
  const dx = tx - s.player.pos.x
  const dy = ty - s.player.pos.y
  const m = Math.hypot(dx, dy) || 1
  return { ...EMPTY_INPUT, moveY: dx / m, moveX: -dy / m }
}

const reached = (s: GameState, tx: number, ty: number, r: number): boolean =>
  Math.hypot(s.player.pos.x - tx, s.player.pos.y - ty) < r

const walk = (s: GameState, x: number, y: number, r: number, maxSec: number) => {
  const limit = Math.round(maxSec * 60)
  let cur = s
  for (let i = 0; i < limit; i++) {
    if (reached(cur, x, y, r)) return { s: cur, ok: true, sec: (i * STEP) / 1000 }
    cur = tick(cur, STEP, { input: seek(cur, x, y), cameraYaw: 0 })
  }
  return { s: cur, ok: reached(cur, x, y, r), sec: maxSec }
}

describe('반대 방면 연결부 통행성', () => {
  it('연결부가 열린 x61~72 구간 어디서 출발해도 반대 방면 통로 안까지 도달한다', () => {
    const base = initialState(1)
    const starts = [61.5, 63, 65, 66, 68, 69, 71]
    const failures: string[] = []
    for (const startX of starts) {
      const s0: GameState = {
        ...base,
        phase: 'playing',
        player: { ...base.player, pos: { x: startX, y: 25, z: -6 } },
      }
      const res = walk(s0, 90, 46, 1.2, 20)
      if (!res.ok) {
        failures.push(`x=${startX} -> stuck at (${res.s.player.pos.x.toFixed(1)},${res.s.player.pos.y.toFixed(1)})`)
      }
    }
    expect(failures).toEqual([])
  })

  it('연결부 → 통로 → 계단 → 반대 방면 승강장까지 끝까지 걸어간다', () => {
    const base = initialState(1)
    let s: GameState = {
      ...base,
      phase: 'playing',
      player: { ...base.player, pos: { x: 65, y: 27, z: -6 } },
    }
    const legs: readonly (readonly [number, number, number, number])[] = [
      [90, 46, 1.2, 15],
      [122, 46, 1.2, 15],
      [140, 51.5, 1.2, 15],
    ]
    for (const [x, y, r, maxSec] of legs) {
      const res = walk(s, x, y, r, maxSec)
      expect(res.ok).toBe(true)
      s = res.s
    }
  })
})
