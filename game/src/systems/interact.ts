/**
 * 상호작용 — 타겟팅 · 습득 · 구매 · 대화 분기 · 슬롯 사용.
 *
 * ★ **레이캐스트를 쓰지 않는다.** 시뮬이 씬을 알면 헤드리스 테스트가 불가능해지고,
 *   그러면 "효자손 체인 완주"를 20ms에 검증할 수 없다 (P1-TECH §3.1).
 *   조준은 `cameraYaw` 와 대상 방향 사이의 **각도**로 판정한다. 3인칭에서도 같은 코드가 돈다.
 *
 * 렌더는 `state.act.targetId` 를 읽어 아웃라인을 켜기만 한다. 판정은 전부 여기 있다.
 */

import type { InputFrame } from '../core/input'
import { GRANDPA_ID, INTERACTABLES, byId, isVending, type InteractKind, type Interactable }
  from '../data/interactables'
import { itemDef } from '../data/items'
import { CHASE, INTERACT } from '../data/tuning'
import type { Action, Drop, GameState, ItemId } from '../state/types'

export type ActCtx = Readonly<{ dtMs: number; input: InputFrame; cameraYaw: number }>

/** 같은 층인가 — 대합실에서 지상 노점이 켜지는 일을 막는다 */
const SAME_FLOOR_M = 2.5

/** 이동 입력으로 취소되는 종류 — 서서 하는 일들 */
const CANCEL_ON_MOVE: ReadonlySet<InteractKind> = new Set(['buy', 'give', 'story', 'aside'])

/** 종류별 소요(ms) */
const durationOf = (kind: InteractKind): number => {
  switch (kind) {
    case 'pickup': return INTERACT.pickupMs
    case 'buy': return INTERACT.buyMs
    case 'give': return INTERACT.buyMs
    case 'story': return INTERACT.talkMs
    case 'aside': return INTERACT.asideMs
    case 'talk': return 0        // 선택 UI 열기 — 즉시
    case 'scratch': return 0     // QTE 열기 — 즉시
  }
}

/** 드랍을 상호작용 대상으로 승격 */
const dropTarget = (d: Drop): Interactable => ({
  id: d.id,
  kind: 'pickup',
  x: d.x, y: d.y, z: d.z,
  label: itemDef(d.item).name,
  gives: d.item,
  once: true,
})

/** 이번 프레임 후보 — 소진된 것과 다른 층은 뺀다 */
export const candidates = (s: GameState): readonly Interactable[] => {
  const pz = s.player.pos.z
  const out: Interactable[] = []
  for (const it of INTERACTABLES) {
    if (it.once && s.act.consumed.includes(it.id)) continue
    if (Math.abs(it.z - pz) > SAME_FLOOR_M) continue
    out.push(it)
  }
  for (const d of s.drops) {
    if (Math.abs(d.z - pz) > SAME_FLOOR_M) continue
    out.push(dropTarget(d))
  }
  return out
}

export type Aim = Readonly<{ id: string | null; aimed: boolean }>

/**
 * 조준 우선 · 근접 폴백.
 *
 * 조준 후보가 하나라도 있으면 **각도 최소**가 이긴다 — 더 가까운 근접 대상이 있어도.
 * 이유: 플레이어가 화면 중앙에 둔 것이 의도다. 거리가 의도를 이기면 "왜 저게 켜지지"가 된다.
 */
export const aimAt = (s: GameState, cameraYaw: number): Aim => {
  const p = s.player.pos
  const dirX = Math.cos(cameraYaw)
  const dirY = Math.sin(cameraYaw)

  let bestAimId: string | null = null
  let bestAng = Infinity
  let bestNearId: string | null = null
  let bestNearD = Infinity

  for (const it of candidates(s)) {
    const dx = it.x - p.x
    const dy = it.y - p.y
    const d = Math.hypot(dx, dy)
    if (d > INTERACT.reachM) continue
    if (d > 1e-4) {
      const cos = (dx * dirX + dy * dirY) / d
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)))
      if (ang <= INTERACT.aimRad && ang < bestAng) { bestAng = ang; bestAimId = it.id }
    }
    if (d <= INTERACT.nearM && d < bestNearD) { bestNearD = d; bestNearId = it.id }
  }

  if (bestAimId) return { id: bestAimId, aimed: true }
  return { id: bestNearId, aimed: false }
}

/** 아이템이 든 슬롯 번호. 없으면 −1 */
export const slotOf = (s: GameState, item: ItemId): number =>
  s.inventory.findIndex((v) => v === item)

export const hasItem = (s: GameState, item: ItemId): boolean => slotOf(s, item) >= 0

/** 대상을 찾는다 — 정적 테이블 우선, 없으면 드랍 */
const resolve = (s: GameState, id: string): Interactable | null => {
  const st = byId(id)
  if (st) return st
  const d = s.drops.find((x) => x.id === id)
  return d ? dropTarget(d) : null
}

/** 거리 안에 있는가 — 슬롯 사용의 대상 판정용 */
const within = (s: GameState, it: Interactable, m: number): boolean =>
  Math.hypot(it.x - s.player.pos.x, it.y - s.player.pos.y) <= m &&
  Math.abs(it.z - s.player.pos.z) <= SAME_FLOOR_M

const moveAxis = (f: InputFrame): number => Math.abs(f.moveX) + Math.abs(f.moveY)

// ─────────────────────────── 완료 처리 ───────────────────────────

/**
 * 진행 중 상호작용이 끝났다 — 효과를 낸다.
 *
 * **여기가 P1의 인과 사슬이 모이는 곳이다.** 습득/구매/전달/완청이 각각
 * 잔액·양심·플래그·시크릿을 어떻게 건드리는지 한 화면에서 읽혀야 한다.
 */
const complete = (s: GameState): Action[] => {
  const id = s.act.busyId
  const kind = s.act.busyKind
  if (!id || !kind) return []
  const it = resolve(s, id)
  if (!it) return [{ t: 'ACT_CANCEL' }]

  const isDrop = s.drops.some((d) => d.id === id)

  switch (kind) {
    case 'pickup': {
      if (!it.gives) return [{ t: 'ACT_CANCEL' }]
      return [
        { t: 'PICKUP', item: it.gives, slot: -1, dropId: isDrop ? id : null },
        ...(it.once && !isDrop ? [{ t: 'ACT_CONSUME', id } as Action] : []),
      ]
    }

    case 'buy': {
      const cost = it.cost ?? 0
      // 완료 순간에 다시 검사한다 — 시작과 완료 사이에 요금이 빠져나갔을 수 있다
      if (s.cardBalance < cost) return [{ t: 'ACT_DENY', text: it.needReason ?? '돈이 부족하다' }]
      if (!it.gives) return [{ t: 'ACT_CANCEL' }]
      return [
        { t: 'BALANCE', delta: -cost, label: it.label },
        { t: 'PICKUP', item: it.gives, slot: -1, dropId: null },
      ]
    }

    /** [2] 붕어빵 — 효자손을 **정당하게** 얻는다. 양심 +1 */
    case 'give': {
      const slot = slotOf(s, 'I-12')
      if (slot < 0) return [{ t: 'ACT_DENY', text: '붕어빵이 필요하다' }]
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item: 'I-12' },
        { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
        { t: 'CONSCIENCE', delta: 1 },
        { t: 'FLAG', id: 'GRANDPA_HELPED', on: true },
        { t: 'ACT_CONSUME', id: GRANDPA_ID },
        { t: 'FX', kind: 'toast', text: '"고맙네, 젊은이."', lifeMs: 2200, value: 0 },
      ]
    }

    /**
     * [3] 인생 이야기 완청 — 15초를 지불하고 **정보를 산다.**
     * `HINT_GRANDPA` 가 안내 LED에 고장 게이트를 띄운다 → Z3에서 회수한다(GDD §8.1.1).
     */
    case 'story':
      return [
        { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
        { t: 'CONSCIENCE', delta: 1 },
        { t: 'FLAG', id: 'GRANDPA_HELPED', on: true },
        { t: 'FLAG', id: 'HINT_GRANDPA', on: true },
        { t: 'SECRET', id: 'gp-story' },
        { t: 'ACT_CONSUME', id: GRANDPA_ID },
        { t: 'FX', kind: 'toast', text: '"3번 개찰구가 아침부터 먹통이야."', lifeMs: 2600, value: 0 },
      ]

    /** O-03 — "저기요". 3초는 이미 흘렀으므로 추가 페널티가 없다 */
    case 'aside':
      return [
        { t: 'ACT_CONSUME', id },
        { t: 'FX', kind: 'toast', text: '승객이 비켜섰다', lifeMs: 1600, value: 0 },
      ]

    default:
      return [{ t: 'ACT_CANCEL' }]
  }
}

// ─────────────────────────── 시작 처리 ───────────────────────────

const begin = (s: GameState, it: Interactable): Action[] => {
  // 조건 검사 — 사유만 내고 **상태는 아무것도 안 바꾼다** (GDD §5.1)
  if (it.needs && !hasItem(s, it.needs)) {
    return [{ t: 'ACT_DENY', text: it.needReason ?? `${itemDef(it.needs).name}이 필요하다` }]
  }
  if (it.cost !== undefined && s.cardBalance < it.cost) {
    return [{ t: 'ACT_DENY', text: it.needReason ?? '돈이 부족하다' }]
  }
  if (it.kind === 'talk') return [{ t: 'DIALOG', id: it.id }]
  if (it.kind === 'scratch') return [{ t: 'QTE_BEGIN', vendorId: it.id }]
  return [{ t: 'ACT_BEGIN', id: it.id, kind: it.kind, totalMs: durationOf(it.kind) }]
}

// ─────────────────────────── 대화 분기 ───────────────────────────

export type Branch = Readonly<{ key: 1 | 2 | 3; label: string; enabled: boolean; note: string }>

/** 할아버지 3분기 — UI와 시스템이 **같은 함수**를 읽는다. 회색 처리와 실제 차단이 갈라지지 않게 */
export const grandpaBranches = (s: GameState): readonly Branch[] => [
  {
    key: 1,
    label: '효자손을 슬쩍한다',
    // 한 번 당한 뒤에는 품에 끼고 안 놓는다. 같은 수는 두 번 안 통한다
    enabled: !s.flags.includes('CHASE_DONE'),
    note: s.flags.includes('CHASE_DONE') ? '이번엔 꽉 쥐고 있다' : '+0s',
  },
  {
    key: 2,
    label: '붕어빵을 드린다',
    enabled: hasItem(s, 'I-12'),
    note: hasItem(s, 'I-12') ? '+1.5s' : '붕어빵이 필요하다',
  },
  { key: 3, label: '말을 건다', enabled: true, note: '+15s' },
]

/** [1] 훔치기 — 즉시. 0.6초 뒤 단소가 날아온다(O-14). UI는 그걸 미리 말하지 않는다 */
const steal = (): Action[] => [
  { t: 'DIALOG', id: null },
  { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
  { t: 'CONSCIENCE', delta: -3 },
  { t: 'FLAG', id: 'GRANDPA_ANGRY', on: true },
  { t: 'ACT_CONSUME', id: GRANDPA_ID },
  { t: 'FX', kind: 'toast', text: '"이놈이!"', lifeMs: 2000, value: 0 },
]

const dialogPick = (s: GameState, key: 1 | 2 | 3): Action[] => {
  const b = grandpaBranches(s).find((x) => x.key === key)
  if (!b) return []
  if (!b.enabled) return [{ t: 'ACT_DENY', text: b.note }]
  if (key === 1) return steal()
  const kind: InteractKind = key === 2 ? 'give' : 'story'
  return [
    { t: 'DIALOG', id: null },
    { t: 'ACT_BEGIN', id: GRANDPA_ID, kind, totalMs: durationOf(kind) },
  ]
}

// ─────────────────────────── 슬롯 사용 ───────────────────────────

/**
 * `1``2``3` — 들고 있는 것을 **여기서** 쓴다.
 *
 * 대상 판정을 조준이 아니라 거리(2.0m)로 하는 이유: 아이템을 쓸 때 플레이어는
 * 이미 대상 앞에 서 있다. 거기서 조준까지 요구하면 "왜 안 되지"가 된다.
 */
const useSlot = (s: GameState, slot: number): Action[] => {
  const item = s.inventory[slot] ?? null
  if (!item) return []
  const def = itemDef(item)

  switch (item) {
    /** 마스크 — 착용 지속. 슬롯을 비우지 않는다 (GDD §5.3) */
    case 'I-06':
      if (s.flags.includes('MASK_ON')) return [{ t: 'ACT_DENY', text: def.noTargetReason }]
      return [
        { t: 'FLAG', id: 'MASK_ON', on: true },
        { t: 'ITEM_USED', item },
        { t: 'FX', kind: 'toast', text: '마스크 착용', lifeMs: 1400, value: 0 },
      ]

    /** 우산 — O-03 인파벽 즉시 개방 */
    case 'I-09': {
      const cp = byId('ACT-CP')
      if (!cp || s.act.consumed.includes(cp.id) || !within(s, cp, 2.2)) {
        return [{ t: 'ACT_DENY', text: def.noTargetReason }]
      }
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item },
        { t: 'ACT_CONSUME', id: cp.id },
        { t: 'FX', kind: 'toast', text: '우산으로 비켜세웠다', lifeMs: 1600, value: 0 },
      ]
    }

    /** 붕어빵 — 할아버지가 근처면 전달로 직행한다 (선택 UI를 다시 열지 않는다) */
    case 'I-12': {
      const gp = byId(GRANDPA_ID)
      if (!gp || s.act.consumed.includes(gp.id) || !within(s, gp, 2.2)) {
        return [{ t: 'ACT_DENY', text: def.noTargetReason }]
      }
      return [
        { t: 'DIALOG', id: null },
        { t: 'ACT_BEGIN', id: GRANDPA_ID, kind: 'give', totalMs: durationOf('give') },
      ]
    }

    /**
     * 효자손 — 자판기가 근처면 QTE.
     *
     * **추격 중이고 할아버지가 손 닿는 거리면 반납이 우선한다** (GDD §4.1 해제 3경로 중 하나).
     * 반납이 자판기보다 앞에 오는 이유: 단소에 맞으면서 자판기를 긁을 상황이라면
     * 플레이어가 원하는 건 긁기가 아니라 살아남기다.
     */
    case 'I-01': {
      if (s.chase.active &&
          Math.hypot(s.chase.pos.x - s.player.pos.x, s.chase.pos.y - s.player.pos.y)
            <= CHASE.returnRangeM) {
        return [
          { t: 'ITEM_SPEND', slot },
          { t: 'CHASE_END', reason: 'returned' },
          { t: 'FX', kind: 'toast', text: '효자손을 돌려줬다 — "어허, 진작 그럴 것이지."', lifeMs: 2600, value: 0 },
        ]
      }
      const vend = INTERACTABLES.find(
        (it) => isVending(it.id) && !s.act.consumed.includes(it.id) && within(s, it, 2.2))
      if (!vend) return [{ t: 'ACT_DENY', text: def.noTargetReason }]
      return [{ t: 'QTE_BEGIN', vendorId: vend.id }]
    }

    default:
      return [{ t: 'ACT_DENY', text: def.noTargetReason }]
  }
}

// ─────────────────────────── 시스템 본체 ───────────────────────────

export const interactSystem = (s: GameState, ctx: ActCtx): Action[] => {
  if (s.phase !== 'playing') {
    // 끝났으면 대화 UI를 즉시 닫는다 — 엔딩 화면 뒤에 메뉴가 남아 있으면 안 된다
    return s.act.dialogId ? [{ t: 'DIALOG', id: null }] : []
  }

  const f = ctx.input
  const out: Action[] = []

  /**
   * 1) 타겟 갱신 — QTE·대화 중에는 갱신하지 않는다(시선이 잠겨 있으므로 의미가 없다).
   *
   * ★ 아래에서 `s.act.targetId` 가 아니라 **이번 프레임에 계산한 `aim.id`** 를 쓴다.
   *   상태의 targetId는 액션이 리듀서를 통과한 *다음* 프레임에나 채워지므로,
   *   그걸 읽으면 대상 앞에 서서 처음 누른 `E` 가 통째로 씹힌다.
   *   (실제로 그렇게 짰다가 S8-4/5/7이 한꺼번에 빨간불이 됐다)
   */
  const aim: Aim = s.qte.active || s.act.dialogId
    ? { id: s.act.targetId, aimed: s.act.aimed }
    : aimAt(s, ctx.cameraYaw)
  if (aim.id !== s.act.targetId || aim.aimed !== s.act.aimed) {
    out.push({ t: 'ACT_TARGET', id: aim.id, aimed: aim.aimed })
  }

  // 2) 대화 UI가 열려 있으면 그것만 처리한다
  if (s.act.dialogId) {
    if (f.pressCancel || moveAxis(f) > INTERACT.cancelAxis) return [...out, { t: 'DIALOG', id: null }]
    if (f.pressSlot >= 1 && f.pressSlot <= 3) return [...out, ...dialogPick(s, f.pressSlot as 1 | 2 | 3)]
    return out
  }

  // 3) 진행 중 상호작용
  if (s.act.busyId) {
    const kind = s.act.busyKind
    const cancelled =
      f.pressCancel || (kind !== null && CANCEL_ON_MOVE.has(kind) && moveAxis(f) > INTERACT.cancelAxis)
    if (cancelled) return [...out, { t: 'ACT_CANCEL' }]
    if (s.act.busyLeftMs <= 0) return [...out, ...complete(s)]
    return out                       // 진행 중 — 새 입력은 전부 무시된다
  }

  // 4) QTE 중이면 상호작용 시작을 막는다 (qteSystem 이 처리)
  if (s.qte.active) return out

  // 5) 슬롯 사용
  if (f.pressSlot >= 1 && f.pressSlot <= 3) return [...out, ...useSlot(s, f.pressSlot - 1)]

  // 6) 새 상호작용 시작
  if (f.pressInteract) {
    const id = aim.id
    if (!id) return out
    const it = resolve(s, id)
    if (!it) return out
    return [...out, ...begin(s, it)]
  }

  return out
}
