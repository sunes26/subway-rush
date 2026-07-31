/**
 * A-2 · S6-4 — P0 게이트 검증.
 *
 * "처음부터 끝까지 플레이 가능해야 함"(GDD §10)을 자동으로 증명한다.
 * 헤드리스 시뮬이라 3분 플레이가 수십 ms에 끝난다 — 시드 여러 개를 한 번에 돌린다.
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, type InputFrame } from '../../src/core/input'
import { resolveEnding } from '../../src/data/endings'
import { TOTAL_TIME_MS } from '../../src/data/tuning'
import { DOOR_XS, FLOOR, GATES } from '../../src/data/world'
import { initialState } from '../../src/state/reducer'
import type { GameState } from '../../src/state/types'
import { tick } from '../../src/systems/tick'

const STEP = 1000 / 60

/**
 * 목표 지점을 향하는 입력을 만든다.
 * cameraYaw = 0 기준: movement의 변환이 dirX = moveY, dirY = −moveX 이므로
 * 원하는 월드 방향 (wx, wy) → moveY = wx, moveX = −wy.
 */
const seek = (s: GameState, tx: number, ty: number, sprint = false): InputFrame => {
  const dx = tx - s.player.pos.x
  const dy = ty - s.player.pos.y
  const m = Math.hypot(dx, dy) || 1
  return { ...EMPTY_INPUT, moveY: dx / m, moveX: -dy / m, sprint }
}

const reached = (s: GameState, tx: number, ty: number, r: number): boolean =>
  Math.hypot(s.player.pos.x - tx, s.player.pos.y - ty) < r

type Leg = Readonly<{ name: string; x: number; y: number; r?: number; maxSec?: number; sprint?: boolean }>

const walk = (s: GameState, leg: Leg): { s: GameState; ok: boolean; sec: number } => {
  const r = leg.r ?? 1.4
  const limit = Math.round((leg.maxSec ?? 22) * 60)
  let cur = s
  for (let i = 0; i < limit; i++) {
    if (reached(cur, leg.x, leg.y, r)) return { s: cur, ok: true, sec: (i * STEP) / 1000 }
    cur = tick(cur, STEP, { input: seek(cur, leg.x, leg.y, leg.sprint ?? false), cameraYaw: 0 })
  }
  return { s: cur, ok: reached(cur, leg.x, leg.y, r), sec: (limit * STEP) / 1000 }
}

/** 스폰 → 승강장 전체 경로. 게이트 y는 시드마다 다르므로 실행 중에 결정한다. */
const traverse = (seed: number): { state: GameState; log: string[]; failed: string | null } => {
  let s: GameState = { ...initialState(seed), phase: 'playing' }
  const log: string[] = []
  const workingY = GATES.find((g) => g.id === s.gates.workingIds[0])?.y ?? 14

  const legs: Leg[] = [
    { name: 'Z1 횡단보도 앞', x: -34, y: 27.5 },
    // 적신호면 최대 18초 대기해야 한다 (MAP §3.3)
    { name: 'Z1 횡단보도 통과', x: -20, y: 27.5, maxSec: 30 },
    { name: 'Z1 4번 출구', x: 0.5, y: 28 },
    { name: 'B1 계단 하단', x: 15.5, y: 28, r: 1.6 },
    { name: 'Z2 대합실 중앙', x: 34, y: 20, maxSec: 25 },
    { name: 'Z3 진입선', x: 55, y: 14 },
    { name: '정상 게이트 정렬', x: 58.6, y: workingY, r: 0.8 },
    { name: '개찰구 통과', x: 64, y: workingY, r: 1.6, maxSec: 12 },
    { name: 'Z4 통로', x: 94, y: 6.5, maxSec: 25 },
    { name: 'Z4 계단 하강', x: 119.5, y: 6.7, r: 1.6, maxSec: 25 },
    { name: 'Z5 승강장 진입', x: 130, y: 6, maxSec: 15 },
  ]

  for (const leg of legs) {
    const r = walk(s, leg)
    s = r.s
    log.push(`${r.ok ? '✓' : '✗'} ${leg.name} (${r.sec.toFixed(1)}s) @ ${s.player.pos.x.toFixed(1)},${s.player.pos.y.toFixed(1)},${s.player.pos.z.toFixed(1)}`)
    if (!r.ok) return { state: s, log, failed: leg.name }
  }

  log.push(`도달 시각: ${((TOTAL_TIME_MS - s.timeLeftMs) / 1000).toFixed(1)}s · 잔액 ${s.cardBalance}`)
  return { state: s, log, failed: null }
}

describe('A-2 · S6-4 — 처음부터 끝까지 플레이 가능', () => {
  it('시드 8개에서 스폰 → 승강장까지 전부 도보로 도달한다', () => {
    const failures: string[] = []
    for (const seed of [1, 7, 42, 99, 256, 1024, 31337, 65535]) {
      const r = traverse(seed)
      if (r.failed) failures.push(`seed ${seed}: "${r.failed}"\n  ${r.log.join('\n  ')}`)
      else {
        expect(r.state.gates.passed, `seed ${seed} 개찰구`).toBe(true)
        expect(r.state.zone, `seed ${seed} 최종 존`).toBe('Z5')
        expect(r.state.player.pos.z).toBeCloseTo(FLOOR.B2, 1)
      }
    }
    expect(failures.join('\n\n')).toBe('')
  })

  it('승강장 도달까지 소요 시간이 예산(180s) 안에 든다', () => {
    for (const seed of [1, 42, 1024]) {
      const r = traverse(seed)
      expect(r.failed).toBeNull()
      const used = (TOTAL_TIME_MS - r.state.timeLeftMs) / 1000
      // P0은 아이템·NPC가 없어 여유가 크다. 열차 도착(168s)보다 훨씬 일찍 도착해야 한다
      expect(used, `seed ${seed} 소요 ${used.toFixed(1)}s`).toBeLessThan(120)
    }
  })

  it('E-01 완주 — 승강장 도착 후 문이 열리면 탑승하고 엔딩이 뜬다', () => {
    const r = traverse(42)
    expect(r.failed).toBeNull()
    let s = r.state

    // 문이 열릴 때까지 문 앞에서 대기 (실제 플레이와 동일: 열차를 기다린다)
    const doorX = DOOR_XS.reduce((a, b) =>
      Math.abs(b - s.player.pos.x) < Math.abs(a - s.player.pos.x) ? b : a)
    const wait = walk(s, { name: 'door', x: doorX, y: 10.2, r: 0.5, maxSec: 20 })
    s = wait.s

    for (let i = 0; i < 60 * 200 && !s.boarded; i++) {
      const open = s.train.state === 'open' || s.train.state === 'closing'
      const target = open ? { x: doorX, y: 12.2 } : { x: doorX, y: 10.2 }
      s = tick(s, STEP, { input: seek(s, target.x, target.y), cameraYaw: 0 })
    }
    expect(s.boarded, '탑승 실패').toBe(true)
    expect(resolveEnding(s).id).toBe('E-01')

    // 열차가 떠나면 엔딩 화면으로 넘어간다
    for (let i = 0; i < 60 * 20 && s.phase !== 'ended'; i++) {
      s = tick(s, STEP, { input: EMPTY_INPUT, cameraYaw: 0 })
    }
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-01')
  })

  it('E-06 완주 — 아무것도 안 하면 온화한 실패로 끝난다', () => {
    let s: GameState = { ...initialState(7), phase: 'playing' }
    for (let i = 0; i < 60 * 190 && s.phase !== 'ended'; i++) {
      s = tick(s, STEP, { input: EMPTY_INPUT, cameraYaw: 0 })
    }
    expect(s.phase).toBe('ended')
    expect(s.endingId).toBe('E-06')
    const e = resolveEnding(s)
    expect(e.tone).toBe('fail')
    // GDD §11 — 실패는 온화해야 한다. 조롱 어휘 금지
    expect(e.line).not.toMatch(/실패|바보|멍청|한심/)
  })
})
