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
import { CP_IDS } from '../data/interactables'
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

/**
 * O-03 — 비켜서기 전까지 에스컬레이터 진입부를 막는다. **3인 1열** (P2).
 *
 * 사람마다 자기 칸을 막는다. 앞사람을 비켜세워도 뒷사람이 남아 있으면 못 지난다 —
 * 그래서 15초 정체가 나오고, 우산을 세 번 쓸 이유(E-11)가 생긴다.
 */
export const crowdSolids = (s: GameState): Solid[] =>
  CP_IDS.flatMap((id, i) =>
    s.act.consumed.includes(id)
      ? []
      : [{
          id: `CROWD-${id}`,
          rect: [
            AISLE.xMin + i * AISLE.pitch, AISLE.yMin,
            AISLE.xMax + i * AISLE.pitch, AISLE.yMax,
          ] as const,
          z0: FLOOR.B1,
          h: AISLE.h,
          look: 'prop' as const,
        }])

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

/**
 * 인파를 "겪는" 반경(m). 상호작용 판정 반경(1.5m)보다 조금 넓다 —
 * 부딪혀야 겪는 게 아니라 **옆을 스쳐 지나가는 것**도 붐빈 것이기 때문이다.
 */
const CROWD_NEAR_R = 2.2

/**
 * 지금 인파에 영향받고 있는가 — `tally.crowdMs` 를 늘릴지 정한다.
 *
 * 이 게임의 인파는 두 종류뿐이다: 에스컬레이터 진입부를 막는 3인(`crowdSolids`)과
 * 승강장 역류(`surge`). 둘 다 세지 않으면 대부분의 판에서 혼잡도가 0 이 된다.
 * 사각형까지의 거리로 재므로 안쪽에 서 있으면 0 이고, `z` 는 층이 다르면 걸러 낸다.
 */
const nearCrowd = (s: GameState): boolean => {
  const p = s.player.pos
  return crowdSolids(s).some((c) => {
    if (p.z < c.z0 - 0.5 || p.z > c.z0 + c.h) return false
    const [x0, y0, x1, y1] = c.rect
    const dx = Math.max(x0 - p.x, 0, p.x - x1)
    const dy = Math.max(y0 - p.y, 0, p.y - y1)
    return dx * dx + dy * dy <= CROWD_NEAR_R * CROWD_NEAR_R
  })
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

  /**
   * 혼잡도 누적 — **아래의 이른 반환들보다 먼저** 낸다.
   * 넘어져 있는 동안(`stallMs > 0`)이야말로 가장 붐빈 순간인데, 그 분기가
   * `return` 으로 빠지므로 뒤에 두면 그 시간이 통째로 안 세진다.
   */
  if (nearCrowd(s) || (phase === 'active' && exposed(s))) {
    out.push({ t: 'CROWD_NEAR', dtMs: ctx.dtMs })
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
