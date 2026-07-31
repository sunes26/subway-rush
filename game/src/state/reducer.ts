/**
 * 순수 리듀서. 부작용 0.
 *
 * 시스템은 상태를 직접 바꾸지 않고 액션만 반환한다 → 모든 변경이 여기 한 곳을 통과한다.
 * 그래서 리플레이·시드 재현·헤드리스 시뮬이 공짜로 성립한다.
 */

import { clamp, formatClock } from '../core/math'
import { makeRng } from '../core/rng'
import { FARE, GATE, P0_BALANCE_POOL, TOTAL_TIME_MS } from '../data/tuning'
import { GATES, SPAWN, TRAFFIC_LIGHT, zoneAt } from '../data/world'
import type { Action, GameState, Fx } from './types'

const MAX_FX = 12

/** 시드에서 이번 판의 개찰구·잔액·LED를 결정한다. 램프 색은 이 결과의 직접 투영이다. */
export const rollSeed = (seed: number) => {
  const rng = makeRng(seed)
  const ids = GATES.map((g) => g.id)
  const count = rng.chance(GATE.twoWorkingChance) ? 2 : 1
  const workingIds = rng.shuffle(ids).slice(0, count).sort((a, b) => a - b)
  const cardBalance = rng.pick(P0_BALANCE_POOL)
  const ledHint = rng.chance(GATE.ledHintChance)
  const broken = ids.filter((id) => !workingIds.includes(id))
  const ledBrokenId = ledHint && broken.length > 0 ? rng.pick(broken) : null
  return { workingIds, cardBalance, ledHint, ledBrokenId }
}

export const initialState = (seed: number): GameState => {
  const roll = rollSeed(seed)
  return {
    phase: 'title',
    seed,
    timeLeftMs: TOTAL_TIME_MS,
    elapsedMs: 0,
    zone: 'Z1',
    player: {
      pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
      vel: { x: 0, y: 0 },
      facing: 0,
      stamina: 100,
      sprintLocked: false,
      sinceSprintMs: 99_999,
      speedPenalty: 0,
      rampId: null,
      moving: false,
      sprinting: false,
    },
    cardBalance: roll.cardBalance,
    gates: {
      workingIds: roll.workingIds,
      ledHint: roll.ledHint,
      ledBrokenId: roll.ledBrokenId,
      state: 'idle',
      activeId: null,
      timerMs: 0,
      cooldownMs: 0,
      passed: false,
      lastReject: null,
      attempts: 0,
    },
    train: { state: 'incoming', x: 330, doorProgress: 0 },
    lightMs: 0,
    boarded: false,
    boardedDoorX: null,
    endingId: null,
    fx: [],
    nextFxId: 1,
    inventory: [null, null, null],
    scores: { conscience: 0, style: 0, knowledge: 0 },
    chase: { active: false, remainingMs: 0, hitCount: 0, swingCooldownMs: 0 },
    flags: [],
  }
}

const pushFx = (s: GameState, fx: Omit<Fx, 'id'>): GameState => {
  const next = [...s.fx, { ...fx, id: s.nextFxId }]
  return {
    ...s,
    fx: next.length > MAX_FX ? next.slice(next.length - MAX_FX) : next,
    nextFxId: s.nextFxId + 1,
  }
}

const decayFx = (fx: readonly Fx[], dtMs: number): readonly Fx[] => {
  if (fx.length === 0) return fx
  const out: Fx[] = []
  for (const f of fx) {
    const life = f.lifeMs - dtMs
    if (life > 0) out.push({ ...f, lifeMs: life })
  }
  return out.length === fx.length && out.every((f, i) => f.lifeMs === (fx[i] as Fx).lifeMs) ? fx : out
}

export const reducer = (s: GameState, a: Action): GameState => {
  switch (a.t) {
    case 'ADVANCE': {
      if (s.phase !== 'playing' && s.phase !== 'boarding') {
        return { ...s, fx: decayFx(s.fx, a.dtMs) }
      }
      const gates = s.gates
      return {
        ...s,
        timeLeftMs: s.timeLeftMs - a.dtMs,
        elapsedMs: s.elapsedMs + a.dtMs,
        lightMs: (s.lightMs + a.dtMs) % TRAFFIC_LIGHT.cycleMs,
        gates: {
          ...gates,
          timerMs: Math.max(0, gates.timerMs - a.dtMs),
          cooldownMs: Math.max(0, gates.cooldownMs - a.dtMs),
        },
        fx: decayFx(s.fx, a.dtMs),
      }
    }

    case 'MOVE':
      return {
        ...s,
        player: {
          ...s.player,
          pos: a.pos,
          vel: a.vel,
          facing: a.facing,
          rampId: a.rampId,
          moving: a.moving,
          sprinting: a.sprinting,
        },
      }

    case 'STAMINA':
      return {
        ...s,
        player: {
          ...s.player,
          stamina: clamp(a.value, 0, 100),
          sprintLocked: a.locked,
          sinceSprintMs: a.sinceSprintMs,
        },
      }

    case 'ZONE':
      return s.zone === a.zone ? s : { ...s, zone: a.zone }

    case 'GATE_BEGIN_TAG':
      return {
        ...s,
        gates: { ...s.gates, state: 'tagging', activeId: a.gateId, timerMs: GATE.tagMs, lastReject: null },
      }

    case 'GATE_ACCEPT':
      return {
        ...s,
        cardBalance: s.cardBalance - FARE,
        gates: {
          ...s.gates,
          state: 'open',
          activeId: a.gateId,
          timerMs: GATE.passMs,
          lastReject: null,
          attempts: s.gates.attempts + 1,
        },
      }

    case 'GATE_REJECT':
      return {
        ...s,
        gates: {
          ...s.gates,
          state: 'reject',
          activeId: a.gateId,
          timerMs: 600,
          cooldownMs: GATE.rejectCooldownMs,
          lastReject: a.reason,
          attempts: s.gates.attempts + 1,
        },
      }

    case 'GATE_SET':
      return { ...s, gates: { ...s.gates, state: a.state, timerMs: a.timerMs } }

    case 'GATE_PASSED':
      return s.gates.passed ? s : { ...s, gates: { ...s.gates, passed: true, state: 'idle', activeId: null } }

    case 'TIME_PENALTY':
      return pushFx(
        { ...s, timeLeftMs: s.timeLeftMs - a.ms },
        { kind: 'timePenalty', text: `${a.label} −${(a.ms / 1000).toFixed(0)}s`, lifeMs: 1400, value: a.ms },
      )

    case 'BOARD':
      return s.boarded
        ? s
        : { ...s, boarded: true, boardedDoorX: a.doorX, phase: 'boarding' }

    case 'PHASE':
      return s.phase === a.phase ? s : { ...s, phase: a.phase }

    case 'END':
      return s.endingId
        ? s
        : { ...s, phase: 'ended', endingId: a.endingId, timeLeftMs: Math.max(0, s.timeLeftMs) }

    case 'FX':
      return pushFx(s, { kind: a.kind, text: a.text, lifeMs: a.lifeMs, value: a.value })
  }
}

export const applyAll = (s: GameState, actions: readonly Action[]): GameState =>
  actions.reduce(reducer, s)

/** 디버그 표시용 */
export const describe = (s: GameState): string =>
  `${s.phase} ${s.zone} t=${formatClock(s.timeLeftMs)} zone=${zoneAt(s.player.pos.x, s.player.pos.z)}`
