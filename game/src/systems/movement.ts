/**
 * F-01 이동 · 스태미너 · 경사.
 *
 * 이동은 XY 평면에서만 계산하고 z는 지면 샘플링으로 결정한다.
 * → 경사면에서 속도가 저절로 느려지지 않는다. 느리게 하고 싶으면 명시적으로 한다.
 */

import { lerpExp, rotateToward, type Vec2 } from '../core/math'
import type { InputFrame } from '../core/input'
import { FISHCAKE_ID } from '../data/interactables'
import { GATE, JUMP, MOVE, SPEED, STAMINA } from '../data/tuning'
import { FLOOR, GATES, GATE_FUNNEL_X } from '../data/world'
import type { Action, GameState } from '../state/types'
import { resolveMove, sampleGround, depenetrate } from './collision'
import { WET_ZONE } from './obstacles'

/**
 * 말동무 해주기(`story`) 중엔 **진짜로 못 움직인다** (디렉터 지시 2026-08-08).
 *
 * 이 게임의 다른 모든 상호작용은 "움직이면 취소"(`CANCEL_ON_MOVE`)일 뿐 입력 자체를
 * 막지는 않는다. `story` 만 예외인 이유는 30초짜리 자동 진행 대화라 — 취소가 아니라
 * 이동 자체가 봉쇄돼야 어색하게 걸어 나가면서 할아버지가 계속 혼잣말하는 그림이 안 나온다.
 * `story` 는 오직 할아버지(`ACT-02-GP`)만 쓰는 종류라 상대를 따로 확인할 필요가 없다.
 *
 * 개찰구 매복(`systems/ambush.ts`)도 같은 이유로 잠근다 — 도망칠 수 있으면
 * "숨 돌리자마자 뒤통수"가 성립하지 않는다.
 *
 * 붕어빵 아저씨(`FISHCAKE_ID`)와의 대화도 여는 동안 전부 잠근다(디렉터 지시) —
 * 클릭으로 인사말을 넘기는 동안 걸어서 자리를 벗어나면 대사와 위치가 어긋난다.
 */
const isTalkLocked = (s: GameState): boolean =>
  s.act.busyKind === 'story' || s.ambush.active || s.act.dialogId === FISHCAKE_ID

export type MoveCtx = Readonly<{ dtMs: number; input: InputFrame; cameraYaw: number }>

/** 램프 종류에 따른 기본 속도 (MAP §1.3) */
/**
 * 감속 시정수 배수 — 클수록 미끄럽다.
 * 계단은 발을 딛으므로 잘 서고, 젖은 구역은 미끄러지고, 나머지는 기준값이다.
 */
const surfaceFactor = (
  rampKind: 'stairs' | 'escalator' | null, pos: { x: number; y: number; z: number },
): number => {
  if (rampKind === 'stairs') return MOVE.gripStairs
  const wet = Math.abs(pos.z - FLOOR.B1) < 2.5 &&
    pos.x >= WET_ZONE[0] && pos.x <= WET_ZONE[2] && pos.y >= WET_ZONE[1] && pos.y <= WET_ZONE[3]
  return wet ? MOVE.gripWet : 1
}

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
  const talkLocked = isTalkLocked(s)

  // ── 입력 → 카메라 기준 월드 방향
  const ix = talkLocked ? 0 : input.moveX
  const iy = talkLocked ? 0 : input.moveY
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

  /**
   * P2 착용·소모의 대가가 여기서 청구된다.
   *  · 커피(CAFFEINE) — 소모 −25%. "스프린트 +5s"(GDD §5.3)를 지속시간이 아니라 **연비**로 준다.
   *    지속시간으로 주면 또 하나의 타이머가 늘고, 그건 3분 게임에 이미 너무 많다.
   *  · 마스크(MASK_ON) — 회복 −20%. 인파 저항의 대가다(숨이 차다).
   */
  const drain = STAMINA.drainPerSec * (s.flags.includes('CAFFEINE') ? 0.75 : 1)
  const regen = STAMINA.regenPerSec * (s.flags.includes('MASK_ON') ? 0.8 : 1)

  if (canSprint) {
    stamina -= drain * dt
    sinceSprintMs = 0
    if (stamina <= 0) { stamina = 0; locked = true }
  } else {
    sinceSprintMs += ctx.dtMs
    if (sinceSprintMs >= STAMINA.regenDelaySec * 1000) {
      stamina = Math.min(STAMINA.max, stamina + regen * dt)
    }
    if (locked && stamina >= STAMINA.unlockAt) locked = false
  }

  // ── 목표 속도
  const ground0 = sampleGround(p.pos.x, p.pos.y, p.pos.z)
  const rampKind = ground0.ramp?.kind ?? null
  /**
   * 이동 배수 — 곱해서 쌓는다.
   *  · 캐리어(CARRIER_ON) −20% (GDD §5.3 I-10)
   *  · 관찰 모드 `Q` −40% — 멈추지 않는 이유는 `docs/P2-SPEC.md` §8.2 에 있다
   *    (3분 게임에서 정지는 곧 무한 시간이다)
   */
  const carry = s.flags.includes('CARRIER_ON') ? 0.8 : 1
  const observe = input.observe ? 0.6 : 1
  const speed = baseSpeed(rampKind, canSprint) * (1 - p.speedPenalty) * carry * observe
  const targetX = dirX * speed
  const targetY = dirY * speed

  /**
   * P2 — **지면별 마찰 차등** (S21 · 120점 패스).
   *
   * P1은 어디서나 같은 감속 시정수(0.09s)였다. 젖은 바닥·계단·보도가 발밑에서
   * 똑같이 느껴지면 "역을 다니는 감각"이 안 생긴다. 감속 쪽만 손댄다 —
   * 가속까지 건드리면 예산표(MAP §1.3)의 이동 시간이 통째로 바뀐다.
   *
   * 미끄러짐은 **OBS-05 물청소와 다른 층이다.** 저건 넘어져서 못 움직이는 것이고
   * 이건 멈추는 데 걸리는 거리다. 신문지가 있어도 바닥은 여전히 미끄럽다.
   */
  const surface = surfaceFactor(rampKind, p.pos)
  const tau = hasInput ? MOVE.accelTau : MOVE.decelTau * surface
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
  let jumpBufferMs = ctx.input.jump && !talkLocked ? JUMP.bufferMs : Math.max(0, p.jumpBufferMs - ctx.dtMs)
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
