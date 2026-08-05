/**
 * 인파 2종 — O-03 에스컬레이터 인파벽 · O-04 하차 역류.
 *
 * 둘의 구현 방식이 **의도적으로 다르다.**
 *  · O-03은 **솔리드**다. 서 있는 사람이 통로를 막는 것이므로 물리로 존재해야 한다.
 *  · O-04는 **시간의 순수 함수**다(`trainAt` 과 같은 방식). 랜덤 반복 웨이브로 만들면
 *    "운이 나빴다"가 되고, GDD §11의 *"단서 없는 방해요소는 랜덤 처형"* 에 걸린다.
 *
 * 실패 비용을 타이머로 청구하지 않는 것도 규칙이다. O-03의 15초는 **계단으로 되돌아가는
 * 실제 이동 시간**이고, O-04의 10초는 **밀려난 거리를 되걸어오는 시간**이다.
 * Z1에서 "적신호 벽을 결과로 바꿨다"와 같은 원칙이다.
 */

import { makeRng } from '../core/rng'
import { AISLE, SURGE } from '../data/tuning'
import { FLOOR, PLATFORM, type Solid } from '../data/world'
import type { Action, GameState } from '../state/types'

/**
 * `prev` = **이동 전** 상태.
 *
 * 넘어져 정지한 동안 위치를 고정하려면 이동 전 좌표가 필요하다. `s.player.pos` 는 이미
 * `movementSystem` 이 갱신한 값이라, 그걸로 "고정"하면 매 프레임 새 위치로 고정돼
 * 결과적으로 계속 미끄러진다(실측: 0.5초에 0.54m). `gateKnockback` 이 `prevState` 를
 * 받는 것과 같은 이유다.
 */
export type CrowdCtx = Readonly<{ dtMs: number; prev: GameState }>

/** O-03 — 비켜서기 전까지 에스컬레이터 진입부를 막는다 */
export const crowdSolids = (s: GameState): Solid[] =>
  s.act.consumed.includes('ACT-CP')
    ? []
    : [{
        id: 'CROWD-CP',
        rect: [AISLE.xMin, AISLE.yMin, AISLE.xMax, AISLE.yMax],
        z0: FLOOR.B1,
        h: AISLE.h,
        look: 'prop',
      }]

export type SurgePhase = 'idle' | 'warn' | 'active' | 'done'

/** 이번 판의 역류 시각(ms) — 시드 결정. `Math.random` 은 쓰지 않는다 */
export const surgeAtMs = (seed: number): number =>
  SURGE.baseMs + (makeRng((seed ^ 0x5be7) >>> 0).next() * 2 - 1) * SURGE.jitterMs

/**
 * 경과 시각 → 역류 위상. `trainAt` 과 같은 모양의 순수 함수다.
 * 같은 시드에서 몇 번 돌려도 같은 결과가 나오는 것이 테스트의 전제다.
 */
export const surgeAt = (elapsedMs: number, seed: number): SurgePhase => {
  const at = surgeAtMs(seed)
  if (elapsedMs < at - SURGE.warnMs) return 'idle'
  if (elapsedMs < at) return 'warn'
  if (elapsedMs < at + SURGE.durMs) return 'active'
  return 'done'
}

/** 승강장에서 역류에 노출되는 위치인가 — 남측 벽(y ≤ 1.5)에 붙으면 안전하다 */
const exposed = (s: GameState): boolean =>
  Math.abs(s.player.pos.z - FLOOR.B2) < 1.5 &&
  s.player.pos.x >= PLATFORM.xMin && s.player.pos.x <= PLATFORM.xMax &&
  s.player.pos.y > SURGE.shelterY

export const crowdSystem = (s: GameState, ctx: CrowdCtx): Action[] => {
  if (s.phase !== 'playing') return []

  const phase = surgeAt(s.elapsedMs, s.seed)
  // 위상 전환을 **파생으로** 잡는다 — 이전 위상을 상태에 들고 있을 이유가 없다
  const prev = surgeAt(s.elapsedMs - ctx.dtMs, s.seed)

  const out: Action[] = []
  if (phase !== prev && phase === 'warn') {
    out.push({
      t: 'FX', kind: 'toast',
      text: '반대편 열차 도착 — 하차 인파가 밀려옵니다', lifeMs: 2800, value: 0,
    })
  }

  // 넘어져 있는 동안은 이동을 봉쇄한다. movement가 낸 MOVE를 **덮어쓴다**
  // (gateKnockback 이 쓰는 것과 같은 수법 — 그래서 이 시스템이 이동 뒤에 온다)
  if (s.surge.stallMs > 0) {
    return [...out, {
      t: 'MOVE',
      pos: ctx.prev.player.pos,
      vel: { x: 0, y: 0 },
      facing: s.player.facing,
      rampId: s.player.rampId,
      moving: false,
      sprinting: false,
      vz: 0,
      grounded: true,
      airborneMs: 0,
      jumpBufferMs: 0,
    }]
  }

  if (phase !== 'active' || !exposed(s)) return out

  // 마스크는 저항 +50% — 밀림 속도가 절반이 된다 (GDD §5.3 I-06)
  const factor = s.flags.includes('MASK_ON') ? SURGE.maskFactor : 1
  const push = SURGE.pushSpeed * factor * ctx.dtMs / 1000
  const y = Math.max(SURGE.shelterY, s.player.pos.y - push)

  if (!s.surge.fell && makeRng((s.seed ^ 0x11f0) >>> 0).chance(SURGE.fallChance)) {
    out.push(
      { t: 'SURGE_FALL' },
      { t: 'FX', kind: 'toast', text: '인파에 밀려 넘어졌다', lifeMs: 1800, value: 0 },
      { t: 'FX', kind: 'shake', text: '', lifeMs: 420, value: 1 },
    )
  }

  out.push({
    t: 'MOVE',
    pos: { x: s.player.pos.x, y, z: s.player.pos.z },
    vel: { x: s.player.vel.x, y: -SURGE.pushSpeed * factor },
    facing: s.player.facing,
    rampId: s.player.rampId,
    moving: true,
    sprinting: false,
    vz: s.player.vz,
    grounded: s.player.grounded,
    airborneMs: s.player.airborneMs,
    jumpBufferMs: s.player.jumpBufferMs,
  })
  return out
}
