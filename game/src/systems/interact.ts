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
import { CP_IDS, GRANDPA_ID, INTERACTABLES, byId, coinValue, isCoin, isVending,
  type InteractKind, type Interactable } from '../data/interactables'
import { GIFT_ITEMS, itemDef } from '../data/items'
import { CHASE, EMERGENCY, INTERACT, SLOTS, STAMINA } from '../data/tuning'
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
    // ── P2 ──
    case 'return': return EMERGENCY.walletReturnMs
    case 'call': return 500      // 버튼을 누르는 시간. 기다리는 −15s 는 완료 시 청구된다
    case 'enter': return 1200
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
  let bestAimD = Infinity
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
      /**
       * 각도가 **비슷하면 가까운 쪽**이 이긴다 (P2).
       *
       * 순수 각도 최소는 일렬로 선 대상에서 뒤집힌다. 인파벽 3인(x 96.6/97.8/99.0)을
       * 정면에서 볼 때 플레이어가 12 cm 만 옆으로 어긋나면 **먼 사람의 각도가 더 작아진다**
       * (5.7° 대 2.9°) — 눈앞의 사람을 보고 `E` 를 눌렀는데 세 번째 사람이 비켜섰다.
       * 8° 안에서는 거리로 가른다. 각도 우선이라는 원칙(P1-TECH §3.1)은 그대로다.
       */
      if (ang <= INTERACT.aimRad) {
        const better = ang < bestAng - INTERACT.aimTieRad ||
          (ang < bestAng + INTERACT.aimTieRad && d < bestAimD)
        if (better) { bestAng = Math.min(ang, bestAng); bestAimD = d; bestAimId = it.id }
      }
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
      /**
       * 동전은 **슬롯을 거치지 않는다** (GDD §5.2). 잔액으로 직행하므로
       * 교체 창도 안 뜨고, 3슬롯이 꽉 차 있어도 주울 수 있다.
       * 이게 동전이 "아이템이 아니라 자원"이라는 뜻이다.
       */
      if (isCoin(id)) {
        return [
          { t: 'BALANCE', delta: coinValue(s.seed, id), label: '동전' },
          { t: 'ACT_CONSUME', id },
        ]
      }
      /**
       * **자동 착용** — 정의에 `autoWear` 가 있으면 줍는 즉시 켠다(이어폰).
       *
       * 착용형 전체에 주지 않는 이유: 마스크·캐리어는 **대가가 있는 착용**이라
       * 켜는 순간이 곧 판단이다. 이어폰만 대가가 "안내 LED 를 못 듣는다" 하나뿐이고
       * 그건 줍는 자리에서 이미 감수한 것이다(디렉터 지시 2026-08-06).
       */
      const def = itemDef(it.gives)
      const auto = def.autoWear && def.flag && !s.flags.includes(def.flag)
      return [
        { t: 'PICKUP', item: it.gives, slot: -1, dropId: isDrop ? id : null },
        ...(auto && def.flag
          ? [{ t: 'FLAG', id: def.flag, on: true } as Action,
             { t: 'ITEM_USED', item: it.gives } as Action,
             { t: 'FX', kind: 'toast', text: `${def.name} 착용`, lifeMs: 1400, value: 0 } as Action]
          : []),
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

    /**
     * [P2] 유실물 지갑 반납 — GDD 부록 A 시크릿 3.
     * **가장 비싼 선행이자 가장 확실한 보험이다.** 2초를 쓰고 개찰구를 하나 더 얻는다.
     */
    case 'return': {
      const slot = slotOf(s, 'I-11')
      if (slot < 0) return [{ t: 'ACT_DENY', text: '맡길 유실물이 없다' }]
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item: 'I-11' },
        { t: 'FLAG', id: 'WALLET_RETURNED', on: true },
        { t: 'FLAG', id: 'EMERGENCY_OPEN', on: true },
        { t: 'CONSCIENCE', delta: 2 },
        { t: 'SECRET', id: 'wallet-returned' },
        { t: 'ACT_CONSUME', id },
        { t: 'FX', kind: 'toast', text: '"아이고 감사합니다 — 저쪽 비상문으로 나가세요."', lifeMs: 3000, value: 0 },
      ]
    }

    /** [P2] 인터폰 호출 — 시크릿 8. 값은 시간으로 낸다 */
    case 'call':
      return [
        { t: 'TIME_PENALTY', ms: EMERGENCY.intercomWaitMs, label: '역무원 대기' },
        { t: 'FLAG', id: 'EMERGENCY_OPEN', on: true },
        { t: 'SECRET', id: 'intercom' },
        { t: 'ACT_CONSUME', id },
        { t: 'FX', kind: 'toast', text: '"…네, 지금 나갑니다." 비상문이 열렸다', lifeMs: 2800, value: 0 },
      ]

    /** [P2] 문을 열고 들어간다 — 화장실(E-13) · 반대편 승강장(E-08) */
    case 'enter': {
      const toilet = id === 'OBJ-14-WC'
      return [
        { t: 'FLAG', id: toilet ? 'TOILET_USED' : 'OPPOSITE_SIDE', on: true },
        { t: 'SECRET', id: toilet ? 'toilet' : 'opposite-platform' },
        { t: 'ACT_CONSUME', id },
        {
          t: 'FX', kind: 'toast',
          text: toilet ? '…살았다' : '반대편 승강장으로 넘어왔다', lifeMs: 2200, value: 0,
        },
      ]
    }

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

export type Branch = Readonly<{
  key: 1 | 2 | 3 | 4 | 5; label: string; enabled: boolean; note: string
}>

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

/**
 * 편의점 선물 5지 — **note 를 전부 비운다.**
 *
 * 다른 분기는 note 로 비용·이득을 알려주지만(`'+1.5s'`) 여기서는 그것이 곧
 * 정답 힌트가 된다. 값이 서로 다르면 "비싼 게 정답" 같은 추론이 생긴다.
 * 힌트는 바닥 양갱(`OBJ-19-HINT*`)이 진다.
 */
export const giftBranches = (s: GameState): readonly Branch[] => {
  const bought = s.flags.includes('GIFT_BOUGHT')
  return GIFT_ITEMS.map((id, i) => ({
    key: (i + 1) as Branch['key'],
    label: itemDef(id).name,
    enabled: !bought,
    note: bought ? '이미 골랐다' : '',
  }))
}

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

  /**
   * 착용형은 **토글**이다 (P2). P1은 마스크를 켜기만 했다 —
   * 캐리어(−20% 속도)·이어폰(힌트 차단)처럼 **대가가 있는 착용**이 들어오면서
   * 끌 수 없다는 것이 곧 되돌릴 수 없는 실수가 됐다.
   */
  if (def.use === 'wear' && def.flag) {
    const on = s.flags.includes(def.flag)
    return [
      { t: 'FLAG', id: def.flag, on: !on },
      ...(on ? [] : [{ t: 'ITEM_USED', item } as Action]),
      { t: 'FX', kind: 'toast', text: `${def.name} ${on ? '해제' : '착용'}`, lifeMs: 1400, value: 0 },
    ]
  }

  switch (item) {
    /** 커피 — 스태미너를 되돌리고 카페인을 남긴다. 소모 */
    case 'I-07':
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item },
        { t: 'STAMINA', value: STAMINA.max, locked: false, sinceSprintMs: 99_999 },
        { t: 'FLAG', id: 'CAFFEINE', on: true },
        { t: 'FX', kind: 'toast', text: '뜨겁다. 그리고 잘 뛰어진다', lifeMs: 1800, value: 0 },
      ]

    /** 노선도 — 소지만으로 미니맵이 켜진다. 사용키는 **확대**를 토글한다 */
    case 'I-13': {
      const open = s.flags.includes('MAP_OPEN')
      return [
        { t: 'FLAG', id: 'MAP_OPEN', on: !open },
        ...(open ? [] : [{ t: 'ITEM_USED', item } as Action]),
        { t: 'FX', kind: 'toast', text: open ? '노선도를 접었다' : '노선도를 펼쳤다', lifeMs: 1200, value: 0 },
      ]
    }

    /** 우산 — O-03 인파벽 즉시 개방 */
    case 'I-09': {
      // 3인 중 **가장 가까운 남은 사람**을 민다 (P2 — 인파벽 3인 복원)
      const cp = CP_IDS
        .map((id) => byId(id))
        .filter((it): it is Interactable => !!it && !s.act.consumed.includes(it.id) && within(s, it, 2.2))
        .sort((a, b) =>
          Math.hypot(a.x - s.player.pos.x, a.y - s.player.pos.y) -
          Math.hypot(b.x - s.player.pos.x, b.y - s.player.pos.y))[0]
      if (!cp) {
        return [{ t: 'ACT_DENY', text: def.noTargetReason }]
      }
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item },
        { t: 'ACT_CONSUME', id: cp.id },
        { t: 'PUSH' },
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
    /**
     * 완료 뒤 `ACT_CANCEL` 을 꼬리에 붙인다 — **진행 상태를 확실히 비우기 위해서다.**
     *
     * P1에는 이걸 `PICKUP` 이 대신하고 있었다(`act: clearBusy`). 그래서 PICKUP 을
     * 내지 않는 분기(`aside`, 그리고 P2의 동전)는 `busyId` 가 남아 **다음 프레임에
     * 또 완료되고, 또 완료된다.** 동전이 프레임마다 잔액을 올려 17,650원이 됐다.
     * (P1의 `aside` 는 토스트만 반복해서 증상이 안 보였을 뿐 같은 버그다.)
     */
    if (s.act.busyLeftMs <= 0) return [...out, ...complete(s), { t: 'ACT_CANCEL' }]
    return out                       // 진행 중 — 새 입력은 전부 무시된다
  }

  // 4) QTE 중이면 상호작용 시작을 막는다 (qteSystem 이 처리)
  if (s.qte.active) return out

  /**
   * 4.5) 교체 창 (UI-14) — 슬롯 키를 **가로챈다.**
   *
   * 이 분기가 슬롯 사용보다 앞에 있어야 한다. 뒤에 두면 방금 주운 아이템을
   * 옮기려고 누른 `2` 가 2번 칸 아이템을 *사용*해 버린다. 0.9초라 겹칠 일이 잦다.
   */
  if (s.swap.active) {
    if (f.pressCancel) return [...out, { t: 'SWAP_CANCEL' }]
    if (f.pressSlot >= 1 && f.pressSlot <= SLOTS) return [...out, { t: 'SWAP_TO', slot: f.pressSlot - 1 }]
  }

  // 5) 슬롯 사용
  if (f.pressSlot >= 1 && f.pressSlot <= SLOTS) return [...out, ...useSlot(s, f.pressSlot - 1)]

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
