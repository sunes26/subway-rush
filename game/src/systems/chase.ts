/**
 * O-14 단소 추격 🎋 — GDD §4.1.
 *
 * 절도 루트는 원래 "시간을 아끼는 대신 양심을 잃는" 거래였다. 그런데 양심 페널티는
 * **엔딩 화면에서야 청구서가 온다.** 너무 늦다. 이 시스템은 그 청구서를 3초 뒤에 보낸다.
 * 8초 아끼려고 훔쳤는데 감속 때문에 20초를 잃는다 → 도덕이 아니라 **산수로 손해**.
 *
 * 톤 가드레일: 폭력이 아니라 슬랩스틱이다. 피 없음 · 데미지 수치 없음 · 3등신 SD ·
 * 타격음은 "딱!" 목탁 계열 · 대사는 훈계가 아니라 잔소리.
 */

import { GRANDPA_ID, byId } from '../data/interactables'
import { CHASE } from '../data/tuning'
import { FLOOR, type Solid } from '../data/world'
import type { Action, GameState } from '../state/types'
import { crowdSolids } from './crowd'
import { gateFlaps } from './gates'
import { resolveMove, sampleGround, setDynamicSolids } from './collision'
import { psdDoors } from './train'

export type ChaseCtx = Readonly<{ dtMs: number }>

/** 벤치 좌표 — `data/interactables.ts` 의 할아버지 항목이 단일 진실 원천이다 */
export const benchPos = (): { x: number; y: number } => {
  const gp = byId(GRANDPA_ID)
  return gp ? { x: gp.x, y: gp.y } : { x: 42, y: 14.9 }
}

/**
 * 일어선 자리 — 벤치에서 남쪽으로 1.1m.
 *
 * ⚠ **벤치 좌표를 그대로 쓰면 한 발도 못 움직인다.** `ACT-02-BENCH` 는
 *   at(42, 15, 2.4, 0.8) = rect[40.8, 14.6, 43.2, 15.4] 이고 할아버지 좌표(42, 14.9)는
 *   그 **안**이다. 앉아 있으니 당연한데, `resolveMove` 는 목적지가 솔리드와 겹치면
 *   이동을 거부하므로 제자리에서 떨기만 했다(실측: 20초 추격에서 이동 0.0m).
 *   일어서면 벤치 앞으로 한 발 나오는 것이 물리적으로도 맞다.
 */
export const standPos = (): { x: number; y: number } => {
  const b = benchPos()
  return { x: b.x, y: b.y - 1.1 }
}

/**
 * 추격 중 할아버지의 몸통.
 *
 * 높이 1.7m는 점프 상한(0.55m)의 세 배다 — **뛰어넘을 수 없다.**
 * `rebuildDynamics` 가 이걸 게이트 플랩·PSD 와 함께 올린다.
 */
export const chaseSolids = (s: GameState): Solid[] => {
  if (!s.chase.active) return []
  const { x, y } = s.chase.pos
  const r = CHASE.bodyR
  const z0 = sampleGround(x, y, FLOOR.B1).z
  return [{ id: 'CHASE-GP', rect: [x - r, y - r, x + r, y + r], z0, h: CHASE.bodyH, look: 'prop' }]
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by)

/**
 * 목표를 향해 걷는다. 플레이어와 **같은** `resolveMove` 를 쓰므로 기둥 슬라이딩이 공짜로 붙는다.
 * Z2는 기둥 8개뿐인 열린 홀이라 A*가 필요 없다.
 *
 * ⚠ 이동 직전 동적 솔리드에서 **자기 몸통만** 뺀다. 안 빼면 지난 틱의 자기 몸에 부딪혀
 *   제자리에서 떤다 — 실제로 그렇게 짜서 stuckMs 가 즉시 쌓이는 것을 봤다.
 *
 * ⚠⚠ 예전에는 `[gateFlaps, psdDoors]` 만 다시 깔아 **인파벽(`crowdSolids`)까지 떨어뜨렸다.**
 *   이 틱의 남은 시스템 중 지금은 아무도 `resolveMove` 를 안 부르므로 증상이 없었지만,
 *   나중에 충돌을 보는 시스템이 추격 뒤에 하나 붙는 순간 그 시스템만 **한 틱 동안 벽이 없는
 *   세계**를 본다. 원인 추적이 거의 불가능한 종류의 버그다. 자기 몸통을 뺀 나머지를 전부 깐다.
 */
const step = (
  s: GameState, tx: number, ty: number, dtMs: number,
): { x: number; y: number; moved: number } => {
  setDynamicSolids([...gateFlaps(s), ...psdDoors(s), ...crowdSolids(s)])
  const from = s.chase.pos
  const d = dist(from.x, from.y, tx, ty)
  if (d < 1e-4) return { x: from.x, y: from.y, moved: 0 }
  const stride = Math.min(d, CHASE.speed * dtMs / 1000)
  const nx = from.x + (tx - from.x) / d * stride
  const ny = from.y + (ty - from.y) / d * stride
  const z = sampleGround(from.x, from.y, FLOOR.B1).z
  const r = resolveMove(from.x, from.y, nx, ny, z, CHASE.bodyR)
  return { x: r.x, y: r.y, moved: dist(from.x, from.y, r.x, r.y) }
}

export const chaseSystem = (s: GameState, ctx: ChaseCtx): Action[] => {
  if (s.phase !== 'playing') return []
  const c = s.chase
  const p = s.player.pos

  // ── 발동: 절도 직후 한 번만. `CHASE_DONE` 이 재발동을 막는다
  if (!c.active && c.phase === 'idle') {
    if (s.flags.includes('GRANDPA_ANGRY') && !s.flags.includes('CHASE_DONE')) {
      const b = standPos()
      return [
        { t: 'CHASE_START', x: b.x, y: b.y },
        { t: 'FX', kind: 'toast', text: '할아버지가 단소를 꺼냈다', lifeMs: 2000, value: 0 },
      ]
    }
    return []
  }

  // ── 귀환: 벤치로 걸어 돌아간다. 도착하면 idle. 게임은 계속된다
  if (c.phase === 'return') {
    const b = standPos()
    if (dist(c.pos.x, c.pos.y, b.x, b.y) < 0.4) return [{ t: 'CHASE_PHASE', phase: 'idle' }]
    const r = step(s, b.x, b.y, ctx.dtMs)
    return [{
      t: 'CHASE_MOVE', x: r.x, y: r.y,
      facing: Math.atan2(b.y - c.pos.y, b.x - c.pos.x), stuckMs: 0,
    }]
  }

  // ── 회수 연출: 2초 완전 정지 뒤 효자손을 잃는다
  if (c.phase === 'seize') {
    if (c.phaseMs >= CHASE.seizeMs) {
      return [
        { t: 'CHASE_END', reason: 'seize' },
        { t: 'FX', kind: 'toast', text: '"내 효자손!" — 회수당했다', lifeMs: 2600, value: 0 },
      ]
    }
    return []
  }

  if (!c.active) return []

  // ── 해제 조건 (우선순위 순)
  //    Z3 진입이 첫째다 — 개찰구가 명확한 안전지대라는 것이 이 설계의 탈출구다
  if (p.x >= CHASE.safeX) {
    return [
      { t: 'CHASE_END', reason: 'gate' },
      { t: 'FX', kind: 'toast', text: '개찰구를 넘었다 — 할아버지가 멈춰 섰다', lifeMs: 2200, value: 0 },
    ]
  }
  if (c.remainingMs <= 0) {
    return [
      { t: 'CHASE_END', reason: 'timeout' },
      { t: 'FX', kind: 'toast', text: '할아버지가 숨이 찼다', lifeMs: 2000, value: 0 },
    ]
  }
  if (c.hitCount >= CHASE.seizeHits) return [{ t: 'CHASE_PHASE', phase: 'seize' }]

  const facing = Math.atan2(p.y - c.pos.y, p.x - c.pos.x)

  // ── 발도 0.6s: 자세만 잡는다. 이 동안 때리지 않는다
  if (c.phase === 'draw') {
    return c.phaseMs >= CHASE.drawMs ? [{ t: 'CHASE_PHASE', phase: 'chase' }] : []
  }

  // ── 스윙 0.32s: 제자리
  if (c.phase === 'swing') {
    return c.phaseMs >= CHASE.swingMs ? [{ t: 'CHASE_PHASE', phase: 'chase' }] : []
  }

  // ── 추격
  const d = dist(c.pos.x, c.pos.y, p.x, p.y)

  /**
   * 타격 거리에 들어오면 **더 다가가지 않는다.**
   *
   * 계속 접근하면 몸통(0.34) + 플레이어(0.32) = 0.66m 에서 겹치고, 그러면
   * `depenetrate` 가 플레이어를 밀어낸다 — 실측 3.6m. 단소는 원거리 무기가 아니지만
   * 밀어내기는 O-04 역류 전용이고 여기서는 **막기만** 한다(P1-TECH §6 리스크 표).
   * 1.2m 에서 서면 겹칠 일이 없다.
   */
  if (d <= CHASE.hitRangeM && c.swingCooldownMs <= 0) {
    return [
      { t: 'CHASE_HIT' },
      { t: 'FX', kind: 'shake', text: '', lifeMs: 380, value: 1 },
      { t: 'FX', kind: 'toast', text: '딱!  "이놈아!"', lifeMs: 1200, value: 0 },
    ]
  }

  // 사거리 안이지만 쿨다운이 남았으면 제자리에서 노려본다
  if (d <= CHASE.hitRangeM) return [{ t: 'CHASE_MOVE', x: c.pos.x, y: c.pos.y, facing, stuckMs: 0 }]

  const r = step(s, p.x, p.y, ctx.dtMs)
  // 끼임 탈출 — 텔레포트 대신 1.5m 후퇴 후 재접근. 화면에서 순간이동하는 노인은 공포다
  if (r.moved < CHASE.stuckEps) {
    const stuck = c.stuckMs + ctx.dtMs
    if (stuck >= CHASE.stuckMs) {
      const back = step(s, c.pos.x - Math.cos(facing) * CHASE.unstuckBackM,
        c.pos.y - Math.sin(facing) * CHASE.unstuckBackM, ctx.dtMs)
      return [{ t: 'CHASE_MOVE', x: back.x, y: back.y, facing, stuckMs: 0 }]
    }
    return [{ t: 'CHASE_MOVE', x: r.x, y: r.y, facing, stuckMs: stuck }]
  }
  return [{ t: 'CHASE_MOVE', x: r.x, y: r.y, facing, stuckMs: 0 }]
}
