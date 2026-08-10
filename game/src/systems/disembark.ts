/**
 * 하차 인파 이동·충돌 (디렉터 지시) — 열차 도착 뒤 40명이 계단을 올라 개찰구로 빠진다.
 *
 * 자리 자체는 `data/crowd.ts disembarkAt` 이 정한다(좀비폰족·아주머니와 같은 순수함수
 * 수법). 여기는 그 자리와 플레이어의 접촉만 본다 — **부딪힌 순간에만** 민다.
 *
 * SURGE(O-04, `systems/crowd.ts`)와 같은 수법으로 `MOVE` 를 재발행한다 — 그래서
 * 이동 뒤에 온다. 다만 SURGE는 전량 재발행이고 여기는 갈린다:
 *  · 전진 중(`player.moving`)이면 movementSystem 이 이미 낸 자리 위에 살짝만 얹는다 —
 *    그래야 플레이어가 고른 방향으로 계속 나아가며 인파를 "가로지를" 수 있다.
 *  · 멈춰 있으면 SURGE처럼 속도를 통째로 인파 방향(개찰구 쪽, −x)으로 덮어쓴다.
 * 두 경우 다 개찰구 라인(`PAID_AREA_X`)을 넘어서까지 밀지는 않는다 — 인파에 떠밀려
 * 운임구역에 강제로 끌려 들어가면 안 되기 때문이다.
 */

import { disembarkAt, disembarkAtOpp } from '../data/crowd'
import { DISEMBARK } from '../data/tuning'
import { PAID_AREA_X } from '../data/world'
import type { Action, GameState } from '../state/types'
import { doorOpenElapsedMs, doorOpenElapsedMs2 } from './train'

export type DisembarkCtx = Readonly<{ dtMs: number }>

export type DisembarkSpot = Readonly<{ x: number; y: number; z: number; facing: number }>

/**
 * 문이 열린 뒤 경과(초) — 음수면 아직 아무도 안 내렸다.
 * **`trainClock` 이 아니라 실제 `elapsedMs` 를 쓴다** — 이유는 `train.ts doorOpenElapsedMs` 참고.
 */
export const secondsSinceDoorsOpen = (s: GameState): number =>
  (s.elapsedMs - doorOpenElapsedMs(s)) / 1000

/** 반대 방면 — 같은 식, `train2` 의 문 열림 시각을 잰다 */
export const secondsSinceDoorsOpenOpp = (s: GameState): number =>
  (s.elapsedMs - doorOpenElapsedMs2(s)) / 1000

/** 지금 화면에 있는(스폰~소멸 사이) 하차 승객 40명 중 실제로 걷고 있는 자리들 */
export const activeDisembark = (s: GameState): readonly DisembarkSpot[] => {
  const t = secondsSinceDoorsOpen(s)
  if (t < 0) return []
  const out: DisembarkSpot[] = []
  for (let i = 0; i < DISEMBARK.count; i++) {
    const p = disembarkAt(i, t, s.gates.workingIds)
    if (p) out.push(p)
  }
  return out
}

/** 반대 방면 승객들 — 게이트 선택이 없어 `disembarkAtOpp` 만 순번으로 돈다 */
export const activeDisembarkOpp = (s: GameState): readonly DisembarkSpot[] => {
  const t = secondsSinceDoorsOpenOpp(s)
  if (t < 0) return []
  const out: DisembarkSpot[] = []
  for (let i = 0; i < DISEMBARK.count; i++) {
    const p = disembarkAtOpp(i, t)
    if (p) out.push(p)
  }
  return out
}

/** 순번 있는 자리 하나 — 같은 사람을 우산으로 두 번 세지 않으려면 안정된 id 가 필요하다 */
export type DisembarkSweepSpot = Readonly<{ id: string; x: number; y: number; z: number }>

/**
 * 우산 훑기(`systems/umbrella.ts`) 전용 — `activeDisembark`와 같은 순번·같은 자리를
 * 돌지만 **순번 있는 id 를 같이 낸다.** `activeDisembark`는 배열 index 가 매 프레임
 * 걷고 있는 사람만 남기고 압축돼 있어(길이·순서가 계속 바뀐다) 그 index 를 id 로 쓰면
 * 같은 사람이 프레임마다 다른 id 로 읽혀 `act.consumed` 로 중복 방지를 못 한다.
 * 그래서 `disembarkAt` 을 직접 0..count-1 로 돌며 원래 순번(`DISM-i`)을 id 로 붙인다.
 *
 * `activeDisembark`/`activeDisembarkOpp` 자체는 손대지 않는다 — `disembarkSystem`의
 * 부딪힘 판정(반환 타입에 `facing` 포함)이 이미 그 시그니처를 그대로 쓰고 있다.
 */
export const disembarkSweepSpots = (s: GameState): readonly DisembarkSweepSpot[] => {
  const t = secondsSinceDoorsOpen(s)
  if (t < 0) return []
  const out: DisembarkSweepSpot[] = []
  for (let i = 0; i < DISEMBARK.count; i++) {
    const p = disembarkAt(i, t, s.gates.workingIds)
    if (p) out.push({ id: `DISM-${i}`, x: p.x, y: p.y, z: p.z })
  }
  return out
}

/** 반대 방면 버전 — `disembarkSweepSpots`와 같은 식, 게이트 목록이 필요 없다 */
export const disembarkSweepSpotsOpp = (s: GameState): readonly DisembarkSweepSpot[] => {
  const t = secondsSinceDoorsOpenOpp(s)
  if (t < 0) return []
  const out: DisembarkSweepSpot[] = []
  for (let i = 0; i < DISEMBARK.count; i++) {
    const p = disembarkAtOpp(i, t)
    if (p) out.push({ id: `DISM-OPP-${i}`, x: p.x, y: p.y, z: p.z })
  }
  return out
}

export const disembarkSystem = (s: GameState, ctx: DisembarkCtx): Action[] => {
  if (s.phase !== 'playing') return []

  // 부딪힘 판정은 두 방면 인파를 합쳐서 본다 — 어느 쪽이든 부딪힌 순간에 밀린다
  const crowd = [...activeDisembark(s), ...activeDisembarkOpp(s)]
  if (crowd.length === 0) return []

  /**
   * 부딪힘은 **각 승객의 실제 높이**에 맞춰 잰다 — 승객이 계단(B1↔B2 램프)을 오르는
   * 동안은 z 가 연속으로 바뀐다. 예전엔 대합실(B1) 고정 반경으로만 재서 계단 위에서는
   * 절대 안 부딪혔다(실측 — 인파에 안 밀린다는 지적의 원인).
   */
  const p = s.player.pos
  const bumped = crowd.some((c) =>
    Math.abs(p.z - c.z) < 2.0 && Math.hypot(p.x - c.x, p.y - c.y) < DISEMBARK.bumpRadiusM)
  if (!bumped) return []

  if (s.player.moving) {
    /**
     * 전진 중 — 가로지르는 느낌을 살리려고 **플레이어가 가려는 방향으로만** 아주
     * 살짝 얹는다. 예전엔 이동 방향과 무관하게 항상 서쪽(개찰구 쪽)으로 밀어서,
     * 걷는 방향을 거슬러 인파에 떠밀리는 것처럼 느껴졌다.
     */
    const speed = Math.hypot(s.player.vel.x, s.player.vel.y)
    if (speed < 1e-6) return []   // 방향을 아직 못 잡았으면 이번 프레임은 그대로 둔다
    const nudge = DISEMBARK.pushSpeed * DISEMBARK.forwardFactor * ctx.dtMs / 1000
    const x = Math.max(PAID_AREA_X, p.x + (s.player.vel.x / speed) * nudge)
    const y = p.y + (s.player.vel.y / speed) * nudge
    return [{
      t: 'MOVE',
      pos: { x, y, z: p.z },
      vel: s.player.vel,
      facing: s.player.facing,
      rampId: s.player.rampId,
      moving: true,
      sprinting: s.player.sprinting,
      vz: s.player.vz,
      grounded: s.player.grounded,
      airborneMs: s.player.airborneMs,
      jumpBufferMs: s.player.jumpBufferMs,
    }]
  }

  // 정지 중 — 인파에 실려 개찰구 라인까지 밀린다
  const push = DISEMBARK.pushSpeed * ctx.dtMs / 1000
  const x = Math.max(PAID_AREA_X, p.x - push)
  return [{
    t: 'MOVE',
    pos: { x, y: p.y, z: p.z },
    vel: { x: -DISEMBARK.pushSpeed, y: 0 },
    facing: s.player.facing,
    rampId: s.player.rampId,
    moving: true,
    sprinting: false,
    vz: s.player.vz,
    grounded: s.player.grounded,
    airborneMs: s.player.airborneMs,
    jumpBufferMs: s.player.jumpBufferMs,
  }]
}
