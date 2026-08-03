/**
 * F-01 이동 · 스태미너 · 경사.
 *
 * 이동은 XY 평면에서만 계산하고 z는 지면 샘플링으로 결정한다.
 * → 경사면에서 속도가 저절로 느려지지 않는다. 느리게 하고 싶으면 명시적으로 한다.
 */

import { lerpExp, rotateToward, type Vec2 } from '../core/math'
import type { InputFrame } from '../core/input'
import { GATE, JUMP, MOVE, SPEED, STAMINA } from '../data/tuning'
import { FLOOR, GATES, GATE_FUNNEL_X } from '../data/world'
import type { Action, GameState } from '../state/types'
import { resolveMove, sampleGround, depenetrate } from './collision'

export type MoveCtx = Readonly<{ dtMs: number; input: InputFrame; cameraYaw: number }>

/** 램프 종류에 따른 기본 속도 (MAP §1.3) */
const baseSpeed = (rampKind: 'stairs' | 'escalator' | null, sprinting: boolean): number => {
  if (rampKind === 'escalator') return SPEED.escalatorWalk
  if (rampKind === 'stairs') return sprinting ? SPEED.stairsTwoStep : SPEED.stairsDown
  return sprinting ? SPEED.sprint : SPEED.walk
}

/**
 * 퍼널이 붙잡는 y 대역 반폭(m).
 * 게이트 피치(2.0m)의 절반보다 살짝 넓게 잡아야 게이트 사이에 무주공산이 안 생긴다.
 */
const FUNNEL_BAND = 1.1

/**
 * `advance`(m)만큼 전진하는 동안 가장 가까운 게이트 중앙 쪽으로 y를 당긴다.
 * 대역 밖이거나 전진이 없으면 손대지 않는다 — 그래서 게이트 앞 좌우 이동이 자유롭다.
 */
const funnelY = (y: number, advance: number): number => {
  let center: number | null = null
  let bestD = Infinity
  for (const g of GATES) {
    const d = Math.abs(y - g.y)
    if (d < bestD) { bestD = d; center = g.y }
  }
  if (center === null || bestD >= FUNNEL_BAND) return y
  return center + (y - center) * Math.exp(-advance / GATE.funnelLenM)
}

export const movementSystem = (s: GameState, ctx: MoveCtx): Action[] => {
  if (s.phase !== 'playing') return []

  const dt = ctx.dtMs / 1000
  const p = s.player
  const { input } = ctx

  // ── 입력 → 카메라 기준 월드 방향
  const ix = input.moveX
  const iy = input.moveY
  const mag = Math.hypot(ix, iy)
  const hasInput = mag > 0.001
  const cos = Math.cos(ctx.cameraYaw)
  const sin = Math.sin(ctx.cameraYaw)
  // 카메라 요 기준: forward = (cos, sin), right = (sin, −cos)
  let dirX = 0
  let dirY = 0
  if (hasInput) {
    const nx = ix / mag
    const ny = iy / mag
    dirX = ny * cos + nx * sin
    dirY = ny * sin - nx * cos
  }

  // ── 스태미너
  const wantsSprint = input.sprint && hasInput
  const canSprint = wantsSprint && !p.sprintLocked && p.stamina > 0
  let stamina = p.stamina
  let locked = p.sprintLocked
  let sinceSprintMs = p.sinceSprintMs

  if (canSprint) {
    stamina -= STAMINA.drainPerSec * dt
    sinceSprintMs = 0
    if (stamina <= 0) { stamina = 0; locked = true }
  } else {
    sinceSprintMs += ctx.dtMs
    if (sinceSprintMs >= STAMINA.regenDelaySec * 1000) {
      stamina = Math.min(STAMINA.max, stamina + STAMINA.regenPerSec * dt)
    }
    if (locked && stamina >= STAMINA.unlockAt) locked = false
  }

  // ── 목표 속도
  const ground0 = sampleGround(p.pos.x, p.pos.y, p.pos.z)
  const rampKind = ground0.ramp?.kind ?? null
  const speed = baseSpeed(rampKind, canSprint) * (1 - p.speedPenalty)
  const targetX = dirX * speed
  const targetY = dirY * speed

  const tau = hasInput ? MOVE.accelTau : MOVE.decelTau
  let vx = lerpExp(p.vel.x, targetX, dt, tau)
  let vy = lerpExp(p.vel.y, targetY, dt, tau)
  // 잔속 스냅 — 이게 없으면 손을 뗀 뒤에도 0.2 m/s로 계속 흘러간다. 미끄러지는 느낌은 P0에서 금지.
  if (!hasInput && Math.hypot(vx, vy) < 0.25) { vx = 0; vy = 0 }

  // ── 에스컬레이터 이송 — 입력 없이도 내려간다
  if (ground0.ramp?.kind === 'escalator') {
    const r = ground0.ramp
    const carry = r.carrySpeed * r.carryDir
    if (r.axis === 'x') vx += carry
    else vy += carry
  }

  // ── 위치 해결
  const nx = p.pos.x + vx * dt
  let ny = p.pos.y + vy * dt

  // ── 게이트 퍼널
  // 통로가 0.55m라 정면 정렬을 요구하면 조작이 답답해진다. 게이트 앞 구간에서
  // 가장 가까운 게이트 중앙으로 y를 부드럽게 끌어당긴다.
  // 충돌 개구부는 이미 넓혀 뒀으므로(GATE_CLEARANCE) 퍼널은 **시각적 관통을 막는 역할**이다.
  //
  // 당기는 양은 **전진 거리**에 비례한다. 시간에 비례시켰더니 제자리에 서 있어도,
  // 옆으로 걸어도 계속 당겨서 게이트 하나에 갇혔다 — 고장 난 게이트 앞에 서면
  // 옆으로 옮겨 갈 방법이 없었다는 뜻이다. 퍼널은 들어가는 사람을 정렬하는 물건이지
  // 붙잡아 두는 물건이 아니다.
  const advance = nx - p.pos.x
  if (advance > 0 && nx > GATE_FUNNEL_X.min && nx < GATE_FUNNEL_X.max
      && Math.abs(p.pos.z - FLOOR.B1) < 1) {
    ny = funnelY(ny, advance)
  }

  const res = resolveMove(p.pos.x, p.pos.y, nx, ny, p.pos.z)
  const fixed = depenetrate(res.x, res.y, p.pos.z)

  // 벽에 막힌 축의 속도는 죽인다 (벽에 대고 계속 밀 때 속도가 누적되면 이상하다)
  if (res.hitX) vx = 0
  if (res.hitY) vy = 0

  // ── 수직: 접지면 위에 붙어 있거나, 공중이면 중력으로 떨어진다
  const ground = sampleGround(fixed.x, fixed.y, p.pos.z)
  const groundZ = ground.z === Number.NEGATIVE_INFINITY ? p.pos.z : ground.z

  let z = p.pos.z
  let vz = p.vz
  let grounded = p.grounded
  let airborneMs = p.airborneMs
  // 입력 버퍼 — 착지 직전에 누른 점프를 착지 순간에 살려준다
  let jumpBufferMs = ctx.input.jump ? JUMP.bufferMs : Math.max(0, p.jumpBufferMs - ctx.dtMs)
  let jumped = false

  if (grounded) {
    z = groundZ
    vz = 0
    airborneMs = 0
  } else {
    vz -= JUMP.gravity * dt
    z += vz * dt
    airborneMs += ctx.dtMs
    if (vz <= 0 && z <= groundZ) { z = groundZ; vz = 0; grounded = true; airborneMs = 0 }
  }

  // 지면이 아래로 꺼지면(계단·경사 끝) 낙하로 전환
  if (grounded && groundZ < z - 0.06) grounded = false

  // 코요테 타임 — 모서리에서 한 프레임 늦게 눌러도 받아준다
  const canJump = (grounded || airborneMs <= JUMP.coyoteMs) && vz <= 0.01
  if (canJump && jumpBufferMs > 0 && stamina >= JUMP.stamina) {
    vz = JUMP.speed
    z = groundZ + 0.02
    grounded = false
    airborneMs = 0
    jumpBufferMs = 0
    stamina -= JUMP.stamina
    jumped = true
  }
  void jumped

  const moving = Math.hypot(vx, vy) > 0.35
  const facing = moving
    ? rotateToward(p.facing, Math.atan2(vy, vx), dt, MOVE.turnRate)
    : p.facing

  const vel: Vec2 = { x: vx, y: vy }

  return [
    {
      t: 'MOVE',
      pos: { x: fixed.x, y: fixed.y, z },
      vel,
      facing,
      rampId: ground.rampId,
      moving,
      sprinting: canSprint && moving,
      vz,
      grounded,
      airborneMs,
      jumpBufferMs,
    },
    { t: 'STAMINA', value: stamina, locked, sinceSprintMs },
  ]
}
