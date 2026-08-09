/**
 * 순수 리듀서. 부작용 0.
 *
 * 시스템은 상태를 직접 바꾸지 않고 액션만 반환한다 → 모든 변경이 여기 한 곳을 통과한다.
 * 그래서 리플레이·시드 재현·헤드리스 시뮬이 공짜로 성립한다.
 */

import { clamp, formatClock } from '../core/math'
import { makeRng } from '../core/rng'
import { itemDef } from '../data/items'
import { BALANCE_POOL, CHASE, FARE, GATE, INTERACT, QTE, SLOTS, SURGE, SWAP_WINDOW_MS,
  TOTAL_TIME_MS } from '../data/tuning'
import { GRANDPA_ID } from '../data/interactables'
import { rollObstacles, rollQueues, type ObsId } from '../data/obstacles'
import { GATES, SPAWN, TRAFFIC_LIGHT, zoneAt } from '../data/world'
import type { Action, ActState, AmbushState, ChaseState, Drop, GameState, Fx, HandState, ItemId,
  KnockdownState, PreachState, QteState, SurgeState, SwapState, TallyState,
  ZombieTalkState } from './types'

const MAX_FX = 12

const EMPTY_ACT: ActState = {
  targetId: null,
  aimed: false,
  busyId: null,
  busyKind: null,
  busyTotalMs: 0,
  busyLeftMs: 0,
  denyText: '',
  denyMs: 0,
  consumed: [],
  dialogId: null,
  dialogStep: 0,
  dialogChoice: 0,
}

const EMPTY_QTE: QteState = {
  active: false,
  vendorId: null,
  strokes: 0,
  pos: 0.5,
  dirSign: 1,
  speedMul: 1,
  misses: 0,
  elapsedMs: 0,
}

const EMPTY_CHASE: ChaseState = {
  active: false,
  phase: 'idle',
  phaseMs: 0,
  remainingMs: 0,
  hitCount: 0,
  swingCooldownMs: 0,
  pos: { x: 0, y: 0 },
  facing: 0,
  stuckMs: 0,
}

const EMPTY_AMBUSH: AmbushState = { active: false, phaseMs: 0 }

const EMPTY_KNOCKDOWN: KnockdownState = { active: false, phaseMs: 0 }

const EMPTY_PREACH: PreachState = { active: false, phaseMs: 0 }

const EMPTY_ZOMBIE_TALK: ZombieTalkState = { active: false, phaseMs: 0, variant: 0 }

const EMPTY_SURGE: SurgeState = { fell: false, stallMs: 0 }

/**
 * 판 집계의 초기값.
 *
 * `staminaMin` 은 최댓값에서 시작해 내려가기만 한다 — 0 으로 두면 첫 프레임부터 탈진이다.
 *
 * **export 인 이유**: 테스트가 `TallyState` 리터럴을 통째로 적으면 필드를 하나 더할
 * 때마다 관계없는 테스트가 전부 컴파일 에러로 깨진다(실제로 `crowdMs` 를 넣자
 * 네 곳이 깨졌다). 스프레드로 쓰게 두면 그 파급이 사라진다.
 */
export const EMPTY_TALLY: TallyState =
  { coinsEarned: 0, itemsUsed: [], secrets: [], pushes: 0, crowdMs: 0, staminaMin: 100 }

const EMPTY_SWAP: SwapState = { active: false, newSlot: 0, dropId: null, leftMs: 0 }

const EMPTY_HAND: HandState = { item: null, slot: -1, open: false }

/**
 * 손과 인벤토리를 맞춘다 — **모든 액션 뒤에 한 번씩** 돈다(`applyAll`).
 *
 * 손을 놓게 만드는 경로가 여섯이다: 소모(`ITEM_SPEND`) · 낙하(`FUMBLE`) · 습득으로 밀려남
 * (`PICKUP`) · 교체 창의 두 갈래(`SWAP_TO`/`SWAP_CANCEL`) · 추격 반납(`CHASE_END`).
 * 각 케이스에서 따로 비우면 **하나를 잊는 순간 없는 물건을 든 채로 남는다** — 우산이라면
 * 인벤에 없는데 화면에서 계속 돌아간다. 여섯 군데 대신 여기 한 군데서 잠근다.
 */
const syncHand = (s: GameState): GameState => {
  const h = s.hand
  if (h.item === null) return h.open ? { ...s, hand: EMPTY_HAND } : s
  if (s.inventory[h.slot] === h.item) return s
  return { ...s, hand: EMPTY_HAND }
}

/** 진행 중 상호작용만 비운다 — `consumed`·`dialogId` 는 건드리지 않는다 */
const clearBusy = (a: ActState): ActState =>
  ({ ...a, busyId: null, busyKind: null, busyTotalMs: 0, busyLeftMs: 0 })

/**
 * 슬롯 결정. 빈 칸이 있으면 그 칸, 없으면 0번.
 * 0번을 쓰는 이유: "가장 오래 들고 있던 것"이 아니라 **항상 같은 칸**이어야
 * 플레이어가 무엇이 밀려나는지 예측할 수 있다. 3슬롯에서 LRU는 과잉이다.
 */
const chooseSlot = (inv: readonly (ItemId | null)[], want: number): number => {
  if (want >= 0 && want < SLOTS) return want
  const empty = inv.findIndex((v) => v === null)
  return empty >= 0 ? empty : 0
}

/** 시드에서 이번 판의 개찰구·잔액·LED를 결정한다. 램프 색은 이 결과의 직접 투영이다. */
export const rollSeed = (seed: number) => {
  const rng = makeRng(seed)
  const ids = GATES.map((g) => g.id)
  const count = rng.chance(GATE.twoWorkingChance) ? 2 : 1
  const workingIds = rng.shuffle(ids).slice(0, count).sort((a, b) => a - b)
  const cardBalance = rng.pick(BALANCE_POOL)
  const ledHint = rng.chance(GATE.ledHintChance)
  const broken = ids.filter((id) => !workingIds.includes(id))
  const ledBrokenId = ledHint && broken.length > 0 ? rng.pick(broken) : null
  return { workingIds, cardBalance, ledHint, ledBrokenId }
}

export const initialState = (seed: number, freeplay = false, allObstacles = false): GameState => {
  const roll = rollSeed(seed)
  return {
    phase: 'title',
    seed,
    timeLeftMs: TOTAL_TIME_MS,
    freeplay,
    elapsedMs: 0,
    trainTriggerMs: null,
    trainTriggerMs2: null,
    zone: 'Z1',
    player: {
      pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
      vel: { x: 0, y: 0 },
      facing: 0,
      stamina: 100,
      sprintLocked: false,
      sinceSprintMs: 99_999,
      speedPenalty: 0,
      vz: 0,
      grounded: true,
      airborneMs: 0,
      jumpBufferMs: 0,
      rampId: null,
      moving: false,
      sprinting: false,
      stallMs: 0,
    },
    // 디렉터 지시 — 실제 시작 잔액은 항상 0원. `roll.cardBalance`(BALANCE_POOL)는
    // 시드 롤 자체의 성질(분포 등)을 보는 쪽에 남겨 두고 여기서만 무시한다.
    cardBalance: 0,
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
    train2: { state: 'incoming', x: 330, doorProgress: 0 },
    lightMs: 0,
    boarded: false,
    boardedDoorX: null,
    boardedAtMs: null,
    boardedTrain2: false,
    endingId: null,
    fx: [],
    nextFxId: 1,
    inventory: Array.from({ length: SLOTS }, () => null),
    scores: { style: 0, knowledge: 0 },
    chase: EMPTY_CHASE,
    ambush: EMPTY_AMBUSH,
    knockdown: EMPTY_KNOCKDOWN,
    preach: EMPTY_PREACH,
    zombieTalk: EMPTY_ZOMBIE_TALK,
    flags: [],
    act: EMPTY_ACT,
    drops: [],
    nextDropId: 1,
    qte: EMPTY_QTE,
    surge: EMPTY_SURGE,
    tally: EMPTY_TALLY,
    hand: EMPTY_HAND,
    knocks: [],
    swap: EMPTY_SWAP,
    obstacles: rollObstacles(seed, allObstacles),
    obsCooldown: {},
    staffAlertMs: 0,
    queues: rollQueues(seed),
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

/**
 * 플레이어 타이머 감산 — 감속 회복과 이동 봉쇄를 한 자리에서 줄인다.
 *
 * 감속 회복은 GDD §4.1 "+5%/s (비피격 시)" 다. **도망치면 풀린다.**
 */
const decayPlayerTimers = (s: GameState, dtMs: number): GameState['player'] => {
  const recover = s.player.speedPenalty > 0
  const stall = s.player.stallMs > 0
  if (!recover && !stall) return s.player
  return {
    ...s.player,
    speedPenalty: recover
      ? Math.max(0, s.player.speedPenalty - CHASE.recoverPerSec * dtMs / 1000)
      : s.player.speedPenalty,
    stallMs: stall ? Math.max(0, s.player.stallMs - dtMs) : s.player.stallMs,
  }
}

/**
 * QTE 마커 왕복 — **여기서만 움직인다**(타이머 단일 감산 규칙).
 *
 * 끝에 닿으면 반사한다. 한 프레임에 여러 번 튕길 만큼 빨라질 일은 없지만
 * (최고 속도에서도 프레임당 0.03), 남은 이동량을 되접어 **프레임레이트 불변**으로 만든다.
 */
const advanceQte = (q: QteState, dtMs: number): QteState => {
  // 한 주기(cycleMs)에 트랙을 2번 지난다 — 왼쪽 끝 → 오른쪽 끝 → 왼쪽 끝
  let pos = q.pos + q.dirSign * (2 / QTE.cycleMs) * q.speedMul * dtMs
  let dir = q.dirSign
  for (let i = 0; i < 4 && (pos < 0 || pos > 1); i++) {
    pos = pos < 0 ? -pos : 2 - pos
    dir = dir === 1 ? -1 : 1
  }
  return {
    ...q,
    pos: Math.max(0, Math.min(1, pos)),
    dirSign: dir,
    elapsedMs: q.elapsedMs + dtMs,
  }
}

/** 방해요소 쿨다운 — 전부 0이면 **같은 객체를 돌려준다**(렌더의 얕은 비교를 살린다) */
const decayCooldowns = (
  cd: GameState['obsCooldown'], dtMs: number,
): GameState['obsCooldown'] => {
  const keys = Object.keys(cd) as ObsId[]
  if (keys.length === 0) return cd
  let changed = false
  const out: Partial<Record<ObsId, number>> = {}
  for (const k of keys) {
    const v = Math.max(0, (cd[k] ?? 0) - dtMs)
    if (v !== cd[k]) changed = true
    if (v > 0) out[k] = v
  }
  return changed ? out : cd
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
        timeLeftMs: s.freeplay ? s.timeLeftMs : s.timeLeftMs - a.dtMs,
        elapsedMs: s.elapsedMs + a.dtMs,
        lightMs: (s.lightMs + a.dtMs) % TRAFFIC_LIGHT.cycleMs,
        gates: {
          ...gates,
          timerMs: Math.max(0, gates.timerMs - a.dtMs),
          cooldownMs: Math.max(0, gates.cooldownMs - a.dtMs),
        },
        // 상호작용·QTE 시계도 여기 하나에서만 흐른다. 시스템이 따로 감산하면
        // 프레임당 두 번 줄어드는 사고가 나고, 그게 P0에서 가장 잡기 어려운 종류의 버그였다.
        act: {
          ...s.act,
          busyLeftMs: Math.max(0, s.act.busyLeftMs - a.dtMs),
          denyMs: Math.max(0, s.act.denyMs - a.dtMs),
        },
        qte: s.qte.active ? advanceQte(s.qte, a.dtMs) : s.qte,
        chase: {
          ...s.chase,
          phaseMs: s.chase.phaseMs + a.dtMs,
          remainingMs: s.chase.active ? Math.max(0, s.chase.remainingMs - a.dtMs) : s.chase.remainingMs,
          swingCooldownMs: Math.max(0, s.chase.swingCooldownMs - a.dtMs),
        },
        /** 감속 회복 — GDD §4.1 "+5%/s (비피격 시)". **도망치면 풀린다.** */
        player: decayPlayerTimers(s, a.dtMs),
        surge: s.surge.stallMs > 0
          ? { ...s.surge, stallMs: Math.max(0, s.surge.stallMs - a.dtMs) }
          : s.surge,
        obsCooldown: decayCooldowns(s.obsCooldown, a.dtMs),
        // 교체 창도 여기서만 줄어든다 (타이머 단일 감산 규칙)
        swap: s.swap.active
          ? (s.swap.leftMs - a.dtMs > 0
              ? { ...s.swap, leftMs: s.swap.leftMs - a.dtMs }
              : EMPTY_SWAP)
          : s.swap,
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
          vz: a.vz,
          grounded: a.grounded,
          airborneMs: a.airborneMs,
          jumpBufferMs: a.jumpBufferMs,
        },
      }

    case 'STAMINA': {
      const stamina = clamp(a.value, 0, 100)
      return {
        ...s,
        player: {
          ...s.player,
          stamina,
          sprintLocked: a.locked,
          sinceSprintMs: a.sinceSprintMs,
        },
        // 최저치는 여기서만 갱신한다 — 스태미너를 clamp 하는 유일한 자리라
        // 값이 지나가는 경로가 하나로 유지된다. 회복해도 안 올라간다.
        tally: stamina < s.tally.staminaMin
          ? { ...s.tally, staminaMin: stamina }
          : s.tally,
      }
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
        { ...s, timeLeftMs: s.freeplay ? s.timeLeftMs : s.timeLeftMs - a.ms },
        { kind: 'timePenalty', text: `${a.label} −${(a.ms / 1000).toFixed(0)}s`, lifeMs: 1400, value: a.ms },
      )

    case 'BOARD':
      return s.boarded
        ? s
        : {
            ...s,
            boarded: true, boardedDoorX: a.doorX, boardedAtMs: s.elapsedMs,
            boardedTrain2: !!a.opp, phase: 'boarding',
          }

    case 'TRAIN_TRIGGER':
      return s.trainTriggerMs !== null ? s : { ...s, trainTriggerMs: s.elapsedMs }

    case 'TRAIN_TRIGGER2':
      return s.trainTriggerMs2 !== null ? s : { ...s, trainTriggerMs2: s.elapsedMs }

    case 'PHASE':
      return s.phase === a.phase ? s : { ...s, phase: a.phase }

    case 'END':
      return s.endingId
        ? s
        : { ...s, phase: 'ended', endingId: a.endingId, timeLeftMs: Math.max(0, s.timeLeftMs) }

    case 'FX':
      return pushFx(s, { kind: a.kind, text: a.text, lifeMs: a.lifeMs, value: a.value })

    /**
     * 차에 치였다 — 스폰으로 되돌린다.
     *
     * 시간은 깎지 않는다. 스폰(−58, 24)에서 횡단보도까지 26 m 를 다시 걷는 것 자체가
     * 대가라 페널티를 겹치면 두 번 벌주는 꼴이다.
     * 속도·점프 상태까지 같이 비운다 — 위치만 옮기면 관성이 남아 되돌아온 자리에서
     * 그대로 미끄러진다.
     */
    // ─────────────────── P1 상호작용 ───────────────────

    case 'ACT_TARGET':
      return s.act.targetId === a.id && s.act.aimed === a.aimed
        ? s
        : { ...s, act: { ...s.act, targetId: a.id, aimed: a.aimed } }

    case 'ACT_BEGIN':
      return {
        ...s,
        act: {
          ...s.act,
          busyId: a.id,
          busyKind: a.kind,
          busyTotalMs: a.totalMs,
          busyLeftMs: a.totalMs,
          denyMs: 0,
          denyText: '',
        },
      }

    case 'ACT_CANCEL':
      return s.act.busyId === null ? s : { ...s, act: clearBusy(s.act) }

    /**
     * 사유 표시. **상태를 아무것도 바꾸지 않는다** — 아이템·시간 전부 불변이다.
     * GDD §5.1: "아웃라인 1회 깜빡임 + 사유 텍스트". 거부는 벌이 아니라 안내다.
     */
    case 'ACT_DENY':
      return { ...s, act: { ...clearBusy(s.act), denyText: a.text, denyMs: INTERACT.denyMs } }

    case 'ACT_CONSUME':
      return s.act.consumed.includes(a.id)
        ? s
        : { ...s, act: { ...s.act, consumed: [...s.act.consumed, a.id] } }

    case 'DIALOG':
      return s.act.dialogId === a.id
        ? s
        : { ...s, act: { ...s.act, dialogId: a.id, dialogStep: 0, dialogChoice: 0 } }

    case 'DIALOG_ADVANCE':
      return { ...s, act: { ...s.act, dialogStep: s.act.dialogStep + 1 } }

    case 'DIALOG_CHOSEN':
      return { ...s, act: { ...s.act, dialogChoice: a.key } }

    /**
     * 습득. 슬롯이 가득하면 0번을 **그 자리 바닥에 떨군다** — 사라지면 억울하다(P1-SPEC §3).
     * `dropId` 가 있으면 바닥에서 주운 것이므로 그 드랍을 지운다.
     */
    case 'PICKUP': {
      const slot = chooseSlot(s.inventory, a.slot)
      const replaced = s.inventory[slot] ?? null
      const inventory = s.inventory.map((v, i) => (i === slot ? a.item : v))
      const p = s.player.pos
      const kept = a.dropId ? s.drops.filter((d) => d.id !== a.dropId) : s.drops
      const dropId = `drop-${s.nextDropId}`
      const drops = replaced
        ? [...kept, { id: dropId, item: replaced, x: p.x, y: p.y, z: p.z }]
        : kept
      return pushFx(
        {
          ...s,
          inventory,
          drops,
          nextDropId: replaced ? s.nextDropId + 1 : s.nextDropId,
          act: clearBusy(s.act),
          // 밀려난 것이 있을 때만 교체 창이 열린다. 빈 칸에 들어갔으면 고를 것이 없다
          swap: replaced ? { active: true, newSlot: slot, dropId, leftMs: SWAP_WINDOW_MS } : s.swap,
        },
        { kind: 'toast', text: `${itemDef(a.item).name} 획득`, lifeMs: 1400, value: 0 },
      )
    }

    /**
     * 교체 창 — 새 아이템을 다른 칸으로 옮긴다.
     * 세 값이 자리를 도는 것뿐이다: 새것 · 밀려난 것(바닥) · 목표 칸에 있던 것.
     */
    case 'SWAP_TO': {
      const { newSlot, dropId } = s.swap
      if (!s.swap.active || dropId === null) return s
      if (a.slot === newSlot || a.slot < 0 || a.slot >= SLOTS) return { ...s, swap: EMPTY_SWAP }
      const drop = s.drops.find((d) => d.id === dropId)
      if (!drop) return { ...s, swap: EMPTY_SWAP }
      const fresh = s.inventory[newSlot] ?? null
      const target = s.inventory[a.slot] ?? null
      if (!fresh) return { ...s, swap: EMPTY_SWAP }
      const inventory = s.inventory.map((v, i) =>
        i === newSlot ? drop.item : i === a.slot ? fresh : v)
      const drops: readonly Drop[] = target === null
        ? s.drops.filter((d) => d.id !== dropId)          // 목표 칸이 비어 있었다 — 바닥에 남길 것이 없다
        : s.drops.map((d) => (d.id === dropId ? { ...d, item: target } : d))
      return pushFx(
        { ...s, inventory, drops, swap: EMPTY_SWAP },
        { kind: 'toast', text: `${itemDef(target ?? fresh).name} ↔ ${itemDef(fresh).name}`, lifeMs: 1200, value: 0 },
      )
    }

    /** 교체 창에서 취소 — 습득 자체를 되돌린다. 새 아이템이 바닥에 남는다 */
    case 'SWAP_CANCEL': {
      const { newSlot, dropId } = s.swap
      if (!s.swap.active || dropId === null) return s
      const drop = s.drops.find((d) => d.id === dropId)
      const fresh = s.inventory[newSlot] ?? null
      if (!drop || !fresh) return { ...s, swap: EMPTY_SWAP }
      return pushFx(
        {
          ...s,
          inventory: s.inventory.map((v, i) => (i === newSlot ? drop.item : v)),
          drops: s.drops.map((d) => (d.id === dropId ? { ...d, item: fresh } : d)),
          swap: EMPTY_SWAP,
        },
        { kind: 'toast', text: `${itemDef(drop.item).name} 유지`, lifeMs: 1200, value: 0 },
      )
    }

    /** 이동 봉쇄 — **누적이 아니라 최대다.** 짧은 쪽이 끝났다고 풀리면 한쪽이 공짜가 된다 */
    case 'STALL':
      return a.ms <= s.player.stallMs
        ? s
        : { ...s, player: { ...s.player, stallMs: a.ms } }

    /** 우산으로 인파를 밀었다 — E-11 "에스컬레이터 참사"의 유일한 계수기 */
    case 'PUSH':
      return { ...s, tally: { ...s.tally, pushes: s.tally.pushes + 1 } }

    /**
     * 손에 든다 / 놓는다.
     *
     * 손을 바꾸면 우산은 **무조건 접힌다.** 펼침은 우산 고유의 상태라 다른 물건으로
     * 넘어갈 때 들고 갈 것이 아니고, 같은 우산을 다시 들었을 때 펼쳐진 채로 나오면
     * "언제 폈지"가 된다.
     */
    case 'EQUIP': {
      const item = a.item
      if (item === null) return s.hand.item === null ? s : { ...s, hand: EMPTY_HAND }
      // 없는 칸·빈 칸·엉뚱한 아이템은 조용히 무시한다 — 손이 인벤토리를 앞지르면 안 된다
      if (a.slot < 0 || a.slot >= SLOTS || s.inventory[a.slot] !== item) return s
      return { ...s, hand: { item, slot: a.slot, open: false } }
    }

    /** 우산 펼치기/접기. 우산을 안 들었으면 아무 일도 없다 */
    case 'UMBRELLA':
      return s.hand.item !== 'I-09' || s.hand.open === a.open
        ? s
        : { ...s, hand: { ...s.hand, open: a.open } }

    /** 날아갔다 — 같은 사람을 두 번 날리지 않는다 */
    case 'KNOCK':
      return s.knocks.some((k) => k.id === a.id)
        ? s
        : { ...s, knocks: [...s.knocks, { id: a.id, dx: a.dx, dy: a.dy }] }

    case 'STAFF_ALERT':
      return s.staffAlertMs === a.ms ? s : { ...s, staffAlertMs: a.ms }

    case 'OBS_FIRE':
      return { ...s, obsCooldown: { ...s.obsCooldown, [a.id]: a.cooldownMs } }

    /** 미끄러져 떨어뜨린다 — 교체와 달리 **새 아이템이 없으므로** 교체 창도 안 연다 */
    case 'FUMBLE': {
      const item = s.inventory[a.slot] ?? null
      if (!item) return s
      const p = s.player.pos
      return pushFx(
        {
          ...s,
          inventory: s.inventory.map((v, i) => (i === a.slot ? null : v)),
          drops: [...s.drops, { id: `drop-${s.nextDropId}`, item, x: p.x, y: p.y, z: p.z }],
          nextDropId: s.nextDropId + 1,
        },
        { kind: 'toast', text: `${itemDef(item).name}을(를) 떨어뜨렸다`, lifeMs: 1800, value: 0 },
      )
    }

    /** 소모품 사용 — 슬롯을 비운다. 지속형(마스크)은 이 액션을 안 쓴다 */
    case 'ITEM_SPEND':
      return {
        ...s,
        inventory: s.inventory.map((v, i) => (i === a.slot ? null : v)),
      }

    /** 스타일 축 — **종류** 수다. 같은 아이템을 두 번 써도 1로 센다 */
    case 'ITEM_USED':
      return s.tally.itemsUsed.includes(a.item)
        ? s
        : {
            ...s,
            tally: { ...s.tally, itemsUsed: [...s.tally.itemsUsed, a.item] },
            scores: { ...s.scores, style: s.scores.style + 1 },
          }

    /**
     * 잔액 가감. 동전은 여기로 직접 흡수된다 (GDD §9.3 `pickUpCoin`).
     * 획득분만 `coinsEarned` 에 누적한다 — E-14 조건이 "번 돈"이라 지출은 안 뺀다.
     */
    case 'BALANCE': {
      const gained = a.delta > 0 ? a.delta : 0
      return pushFx(
        {
          ...s,
          cardBalance: Math.max(0, s.cardBalance + a.delta),
          tally: { ...s.tally, coinsEarned: s.tally.coinsEarned + gained },
        },
        {
          kind: 'balance',
          text: a.text ?? `${a.delta > 0 ? '+' : ''}${a.delta.toLocaleString('ko-KR')}원 ${a.label}`,
          lifeMs: 1600,
          value: a.delta,
        },
      )
    }

    /** 지식 축 — 같은 시크릿을 다시 찾아도 안 오른다 */
    case 'SECRET':
      return s.tally.secrets.includes(a.id)
        ? s
        : {
            ...s,
            tally: { ...s.tally, secrets: [...s.tally.secrets, a.id] },
            scores: { ...s.scores, knowledge: s.scores.knowledge + 1 },
          }

    case 'FLAG': {
      const has = s.flags.includes(a.id)
      if (has === a.on) return s
      return { ...s, flags: a.on ? [...s.flags, a.id] : s.flags.filter((f) => f !== a.id) }
    }

    // ─────────────────── QTE (P2 타이밍 바) ───────────────────

    case 'QTE_BEGIN':
      return {
        ...s,
        act: clearBusy(s.act),
        // 마커는 **왼쪽 끝에서 출발**한다. 중앙에서 시작하면 첫 클릭이 공짜다
        qte: { ...EMPTY_QTE, active: true, vendorId: a.vendorId, pos: 0, dirSign: 1 },
      }

    /**
     * 클릭 1회 판정. 성공이면 **마커가 빨라진다** — 구간은 안 좁힌다.
     * 좁히면 "아까 됐던 클릭이 안 되는" 억울함이 생기고, 빨라지는 건 눈에 보인다.
     */
    case 'QTE_HIT':
      return {
        ...s,
        qte: {
          ...s.qte,
          strokes: a.hit ? s.qte.strokes + 1 : s.qte.strokes,
          misses: a.hit ? s.qte.misses : s.qte.misses + 1,
          speedMul: a.hit ? s.qte.speedMul * QTE.speedUpPerHit : s.qte.speedMul,
        },
      }

    case 'QTE_END':
      return { ...s, qte: EMPTY_QTE }

    // ─────────────────── P1 단소 추격 (O-14) ───────────────────

    case 'CHASE_START':
      return {
        ...s,
        chase: {
          active: true,
          phase: 'draw',
          phaseMs: 0,
          remainingMs: CHASE.durationMs,
          hitCount: 0,
          swingCooldownMs: 0,
          pos: { x: a.x, y: a.y },
          facing: a.facing,
          stuckMs: 0,
        },
      }

    case 'CHASE_MOVE':
      return {
        ...s,
        chase: { ...s.chase, pos: { x: a.x, y: a.y }, facing: a.facing, stuckMs: a.stuckMs },
      }

    case 'CHASE_PHASE':
      return s.chase.phase === a.phase
        ? s
        : { ...s, chase: { ...s.chase, phase: a.phase, phaseMs: 0 } }

    /**
     * 피격 — GDD §4.1 그대로. 감속 누적 · 쿨다운.
     * ⚠ `speedPenalty` 상한을 여기서 묶는다. 1.0을 넘으면 `movement.ts` 의
     *   `speed * (1 - speedPenalty)` 가 **음수**가 되어 조작이 반대로 된다.
     */
    case 'CHASE_HIT':
      return {
        ...s,
        player: {
          ...s.player,
          speedPenalty: clamp(s.player.speedPenalty + CHASE.hitPenalty, 0, 1),
        },
        chase: {
          ...s.chase,
          hitCount: s.chase.hitCount + 1,
          swingCooldownMs: CHASE.swingCooldownMs,
          phase: 'swing',
          phaseMs: 0,
        },
      }

    /**
     * 해제 — `gate`/`timeout`/`returned` 셋뿐이다. 2대째 즉사(E-16)는 이 액션을 거치지
     * 않고 `chaseSystem` 이 `END` 를 바로 낸다 — `seize` 로 끝나는 경로는 이제 없다.
     */
    case 'CHASE_END': {
      const returned = a.reason === 'returned'
      const hyo = s.inventory.findIndex((v) => v === 'I-01')
      return {
        ...s,
        // 반납이면 효자손이 사라진다. 잔액 충전 수단을 잃는 것이 실질 페널티다
        inventory: returned && hyo >= 0
          ? s.inventory.map((v, i) => (i === hyo ? null : v))
          : s.inventory,
        /**
         * ★ 효자손을 반납했으면 할아버지를 **다시 만날 수 있다.**
         *
         * GDD §6.2: *"벌은 주되 문은 닫지 않는다."* 잔액 0원 시드(15%)에서 효자손을
         * 반납하면 P1에는 다른 충전 수단이 없어 **진짜로 막힌다** — 스윕에서 2건 나왔다.
         * 그래서 `consumed` 에서 할아버지를 빼 정직한 루트(붕어빵·대화)로 재도전하게 둔다.
         * 훔치기 분기는 `CHASE_DONE` 이 막는다(`grandpaBranches`) — 그는 이제 경계한다.
         */
        act: returned
          ? { ...s.act, consumed: s.act.consumed.filter((id) => id !== GRANDPA_ID) }
          : s.act,
        chase: { ...s.chase, active: false, phase: 'return', phaseMs: 0, swingCooldownMs: 0 },
        flags: s.flags.includes('CHASE_DONE') ? s.flags : [...s.flags, 'CHASE_DONE'],
      }
    }

    /**
     * 인파에 영향받은 시간 누적 — 엔딩 "이번 판 · 혼잡도".
     * 발행처(`crowdSystem`)가 `phase !== 'playing'` 이면 아무것도 안 내므로
     * 여기서 다시 막지 않는다 — 게이트가 두 곳이면 어느 쪽이 진짜인지 못 읽는다.
     */
    case 'CROWD_NEAR':
      return { ...s, tally: { ...s.tally, crowdMs: s.tally.crowdMs + a.dtMs } }

    /** 역류에 넘어졌다 — 1.2초 정지. 아이템 드랍은 O-05(P2)의 몫이고 여기서는 시간만 잃는다 */
    case 'SURGE_FALL':
      return s.surge.fell
        ? s
        : {
            ...s,
            surge: { fell: true, stallMs: SURGE.stallMs },
          }

    case 'RESPAWN':
      return {
        ...s,
        zone: 'Z1',
        player: {
          ...s.player,
          pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
          vel: { x: 0, y: 0 },
          vz: 0,
          grounded: true,
          airborneMs: 0,
          jumpBufferMs: 0,
          rampId: null,
          moving: false,
          sprinting: false,
        },
      }

    // ─────────────────── 개찰구 매복 (신규) ───────────────────

    case 'AMBUSH_START':
      return s.ambush.active ? s : { ...s, ambush: { active: true, phaseMs: 0 } }

    case 'AMBUSH_TICK':
      return { ...s, ambush: { ...s.ambush, phaseMs: s.ambush.phaseMs + a.dtMs } }

    // ─────────────────── 차에 치임 (E-18) ───────────────────

    /**
     * 속도를 **같이 0으로 만든다.** 위치는 그대로 두고(몸이 날아가는 것은 카메라 연출이다)
     * 관성만 지운다 — 안 지우면 쓰러진 뒤에도 시체가 도로 위를 미끄러진다.
     */
    case 'KNOCKDOWN_START':
      return s.knockdown.active
        ? s
        : {
            ...s,
            knockdown: { active: true, phaseMs: 0 },
            player: { ...s.player, vel: { x: 0, y: 0 }, moving: false, sprinting: false },
          }

    case 'KNOCKDOWN_TICK':
      return { ...s, knockdown: { ...s.knockdown, phaseMs: s.knockdown.phaseMs + a.dtMs } }

    // ─────────────────── OBS-07 아주머니+학생 강제 대화 (신규) ───────────────────

    case 'PREACH_START':
      return s.preach.active ? s : { ...s, preach: { active: true, phaseMs: 0 } }

    case 'PREACH_TICK':
      return { ...s, preach: { ...s.preach, phaseMs: s.preach.phaseMs + a.dtMs } }

    // 게임을 안 끝낸다 — `ambush`와 달리 그냥 풀려나고 이동이 돌아온다
    case 'PREACH_END':
      return s.preach.active ? { ...s, preach: EMPTY_PREACH } : s

    // ─────────────────── OBS-08 좀비폰족 부딪힘 ───────────────────

    case 'ZOMBIE_TALK_START':
      return s.zombieTalk.active
        ? s
        : { ...s, zombieTalk: { active: true, phaseMs: 0, variant: a.variant } }

    case 'ZOMBIE_TALK_TICK':
      return { ...s, zombieTalk: { ...s.zombieTalk, phaseMs: s.zombieTalk.phaseMs + a.dtMs } }

    case 'ZOMBIE_TALK_END':
      return s.zombieTalk.active ? { ...s, zombieTalk: EMPTY_ZOMBIE_TALK } : s
  }
}

/**
 * 액션 하나마다 손을 인벤토리에 맞춘다 (`syncHand` 주석 참고).
 * `reducer` 자체를 감싸지 않고 여기서 도는 이유는 **재귀를 피하려는 것**이다 —
 * 리듀서 안에서 자기 결과를 다시 정규화하면 케이스마다 두 번 도는 경로가 생긴다.
 */
export const applyAll = (s: GameState, actions: readonly Action[]): GameState =>
  actions.reduce((acc, a) => syncHand(reducer(acc, a)), s)

/** 디버그 표시용 */
export const describe = (s: GameState): string =>
  `${s.phase} ${s.zone} t=${formatClock(s.timeLeftMs)} zone=${zoneAt(s.player.pos.x, s.player.pos.z)}`
