/**
 * O-14 단소 추격 🎋 — GDD §4.1.
 *
 * 절도 루트는 **도박**이다. 10초를 버티면 효자손을 그대로 챙기고, 두 대 맞으면
 * 그 자리에서 런이 끝난다. 예전에는 5대 누적으로 효자손을 회수당하는 "산수로 손해"
 * 구조였는데, 즉사로 바꾸면서 성격이 달라졌다 — 시간 손해가 아니라 판돈이다.
 *
 * 도망은 성립한다: 스프린트 8.3 대 할아버지 5.0, 벤치(x=42)에서 개찰구(x=56)까지 14m,
 * 스태미너 100/초당 22 ≈ 4.5초면 37m 를 달린다.
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
        // 일어서는 순간 이미 플레이어를 본다. 이 값을 안 주면 0(동쪽)이 그대로 남는다
        { t: 'CHASE_START', x: b.x, y: b.y, facing: Math.atan2(p.y - b.y, p.x - b.x) },
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
      { t: 'FX', kind: 'toast', text: '"늙었더니 몸이 내맘 같지 않구먼"', lifeMs: 2600, value: 0 },
    ]
  }

  /**
   * 2대째 — 쓰러진다. **1대는 경고다**(감속 0.2 + "딱!").
   * `swingCooldownMs`(1.5s)가 연타 즉사를 막으므로 한 번 맞고도 도망칠 창이 있다.
   */
  if (c.hitCount >= 2) {
    return [
      { t: 'FX', kind: 'toast', text: '눈앞이 하얘졌다', lifeMs: 2000, value: 0 },
      { t: 'END', endingId: 'E-16' },
    ]
  }

  const facing = Math.atan2(p.y - c.pos.y, p.x - c.pos.x)

  /**
   * ── 발도 0.6s · 스윙 0.32s: **제자리지만 시선은 따라간다.**
   *
   * 예전엔 둘 다 아무 액션도 안 냈다. 그래서 그 구간에는 `facing` 이 **얼어붙었다** —
   * 발도 중에는 시작 시점 값(P2 이전엔 아예 0 = 동쪽)이 남고, 스윙 중에는 플레이어가
   * 옆으로 돌아도 할아버지가 허공을 보고 때렸다. **움직이지 않는 것과 안 보는 것은 다르다.**
   */
  if (c.phase === 'draw') {
    return c.phaseMs >= CHASE.drawMs
      ? [{ t: 'CHASE_PHASE', phase: 'chase' }]
      : [{ t: 'CHASE_MOVE', x: c.pos.x, y: c.pos.y, facing, stuckMs: c.stuckMs }]
  }

  if (c.phase === 'swing') {
    return c.phaseMs >= CHASE.swingMs
      ? [{ t: 'CHASE_PHASE', phase: 'chase' }]
      : [{ t: 'CHASE_MOVE', x: c.pos.x, y: c.pos.y, facing, stuckMs: c.stuckMs }]
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
  if (r.moved >= CHASE.stuckEps) return [{ t: 'CHASE_MOVE', x: r.x, y: r.y, facing, stuckMs: 0 }]

  const stuck = c.stuckMs + ctx.dtMs
  if (stuck < CHASE.stuckMs) return [{ t: 'CHASE_MOVE', x: r.x, y: r.y, facing, stuckMs: stuck }]

  /**
   * ── 끼임 탈출: **옆으로 돈다.** 뒤로 물러나지 않는다.
   *
   * 예전엔 `facing` 반대 방향으로 1.5m 후퇴했다. 텔레포트를 피한 것까진 옳았지만
   * **얼굴은 플레이어를 보면서 몸만 뒤로 가는** 그림이 됐다 — 디렉터가 본 "뒤로 이동"이 이것이다.
   * 기둥에 걸린 사람은 실제로 뒤로 걷지 않는다. 옆으로 비켜 돌아간다.
   *
   * 좌/우 90° 를 둘 다 시도해 **더 멀리 가는 쪽**을 쓴다. 어느 쪽으로 돌지는 기둥이 정한다.
   * 둘 다 막히면 그때만 후퇴하되, 그때는 **가는 쪽을 본다**(뒷걸음질이 아니라 돌아서 간다).
   */
  const side = (sign: number): { x: number; y: number; moved: number } => {
    const a = facing + sign * Math.PI / 2
    return step(s, c.pos.x + Math.cos(a) * CHASE.unstuckBackM,
      c.pos.y + Math.sin(a) * CHASE.unstuckBackM, ctx.dtMs)
  }
  const left = side(1)
  const right = side(-1)
  const best = left.moved >= right.moved ? left : right
  if (best.moved >= CHASE.stuckEps) {
    // 옆으로 도는 동안에도 시선은 플레이어에게 둔다 — 게걸음은 사람이 실제로 하는 동작이다
    return [{ t: 'CHASE_MOVE', x: best.x, y: best.y, facing, stuckMs: 0 }]
  }

  const away = facing + Math.PI
  const back = step(s, c.pos.x + Math.cos(away) * CHASE.unstuckBackM,
    c.pos.y + Math.sin(away) * CHASE.unstuckBackM, ctx.dtMs)
  return [{ t: 'CHASE_MOVE', x: back.x, y: back.y, facing: away, stuckMs: 0 }]
}
