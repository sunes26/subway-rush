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
import { FISHCAKE_GREETING, FISHCAKE_ID, GIFT_STALL_ID, GRANDPA_ID, INTERACTABLES, byId,
  coinValue, isCoin, isVending, type InteractKind, type Interactable } from '../data/interactables'
import { GIFT_CORRECT, GIFT_ITEMS, itemDef, MASK_PRICE } from '../data/items'
import { CHASE, EMERGENCY, INTERACT, SLOTS, STAMINA } from '../data/tuning'
import type { Action, Drop, GameState, ItemId } from '../state/types'

export type ActCtx = Readonly<{ dtMs: number; input: InputFrame; cameraYaw: number }>

/** 같은 층인가 — 대합실에서 지상 노점이 켜지는 일을 막는다 */
const SAME_FLOOR_M = 2.5

/**
 * 이동 입력으로 취소되는 종류 — 서서 하는 일들.
 *
 * `story`(말동무 해주기)는 여기 없다 — 디렉터 지시로 **진짜 이동 락**이 걸린다
 * (`systems/movement.ts` 가 이동 입력 자체를 무시한다)이라 "움직이면 취소"가 필요 없고,
 * ESC 도 안 듣는다(아래 `interactSystem` 의 `kind !== 'story'` 가드). `story` 는 이 게임에서
 * 유일하게 중간에 못 빠져나가는 상호작용이다.
 */
const CANCEL_ON_MOVE: ReadonlySet<InteractKind> = new Set(['buy', 'give', 'aside'])

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
    case 'inspect': return 800
  }
}

/**
 * **자동 착용** — 정의에 `autoWear` 가 있으면 손에 들어오는 즉시 켠다(이어폰·마스크).
 *
 * 착용형 전체에 주지 않는 이유: 캐리어는 **대가가 있는 착용**이라 켜는 순간이 곧
 * 판단이다. 이어폰·마스크는 대가가 하나뿐이고 그건 손에 넣는 자리에서 이미
 * 감수한 것이다(디렉터 지시 2026-08-06). `pickup`(공짜 습득)·`buy`(유상 구매)
 * 둘 다 "손에 들어온다"는 사실은 같으므로 같은 헬퍼를 쓴다.
 */
const autoWearActions = (s: GameState, item: ItemId): readonly Action[] => {
  const def = itemDef(item)
  if (!def.autoWear || !def.flag || s.flags.includes(def.flag)) return []
  return [
    { t: 'FLAG', id: def.flag, on: true },
    { t: 'ITEM_USED', item },
    // 디렉터 지시 — "OO 착용" 대신 두루뭉실한 능력 힌트(`cost`)를 보여준다
    { t: 'FX', kind: 'toast', text: def.cost ?? `${def.name} 착용`, lifeMs: 1400, value: 0 },
  ]
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
      return [
        { t: 'PICKUP', item: it.gives, slot: -1, dropId: isDrop ? id : null },
        ...autoWearActions(s, it.gives),
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
        ...autoWearActions(s, it.gives),
      ]
    }

    /**
     * 바닥 양갱 — **읽기만 한다.** `gives` 가 없으므로 인벤토리에 아무것도 안 들어간다.
     * `ACT_CONSUME` 도 내지 않는다 — 몇 번이고 다시 볼 수 있어야 힌트 구실을 한다.
     */
    case 'inspect':
      return [{
        t: 'FX', kind: 'toast',
        text: '누군가가 먹고 바닥에 버려놨다. 포장이 여럿인 걸 보면 누군가의 최애 간식인 모양이다.',
        lifeMs: 4000, value: 0,
      }]

    /**
     * [2] 선물 — **양갱만** 효자손으로 이어진다. 양심 +1.
     *
     * 구매가 1회 한정(`GIFT_BOUGHT`)이라 소지한 선물은 항상 최대 하나다.
     * 어느 것을 드릴지 다시 고를 필요가 없어 인벤토리의 첫 선물이 곧 답이다.
     */
    /**
     * 플레이어가 먼저 제안하고 할아버지가 답하는 두 줄이 `ui/dialog.ts` 의 대화 패널에
     * 이미 뜬다(`GIVE_LINES`) — 여기서 또 토스트를 띄우면 같은 말을 두 번 하는 꼴이라 뺐다.
     */
    case 'give': {
      const held = GIFT_ITEMS.find((i) => slotOf(s, i) >= 0)
      if (held === undefined) return [{ t: 'ACT_DENY', text: '선물이 필요하다' }]
      const slot = slotOf(s, held)
      if (held !== GIFT_CORRECT) {
        return [
          { t: 'ITEM_SPEND', slot },
          { t: 'END', endingId: 'E-15' },
        ]
      }
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item: held },
        { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
        { t: 'CONSCIENCE', delta: 1 },
        { t: 'FLAG', id: 'GRANDPA_HELPED', on: true },
        { t: 'ACT_CONSUME', id: GRANDPA_ID },
      ]
    }

    /**
     * [3] 말동무 해주기 완주 — 30초(3초×10줄, 플레이어 5·할아버지 5)를 들여 **정보를 산다.**
     * `HINT_GRANDPA` 가 안내 LED에 정상 게이트를 띄운다 → Z3에서 다시 확인한다.
     * 10줄 자체가 이미 대화 패널에서 다 보였으므로(`ui/dialog.ts` STORY_LINES) 완료 토스트는
     * 뺐다 — 마지막 줄("이건 답례라네")이 곧 이 `PICKUP I-01` 이다.
     */
    case 'story':
      return [
        { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
        { t: 'CONSCIENCE', delta: 1 },
        { t: 'FLAG', id: 'GRANDPA_HELPED', on: true },
        { t: 'FLAG', id: 'HINT_GRANDPA', on: true },
        { t: 'SECRET', id: 'gp-story' },
        { t: 'ACT_CONSUME', id: GRANDPA_ID },
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
  // 자판기는 소지만으론 부족하다 — 효자손을 손에 쥔 상태여야 QTE 가 열린다
  if (it.kind === 'scratch' && it.needs && s.hand.item !== it.needs) {
    return [{ t: 'ACT_DENY', text: it.needReason ?? '손에 쥐고 있어야 한다' }]
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
  key: 1 | 2 | 3 | 4 | 5 | 6; label: string; enabled: boolean; note: string
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
    label: '선물을 드린다',
    enabled: GIFT_ITEMS.some((i) => hasItem(s, i)),
    note: GIFT_ITEMS.some((i) => hasItem(s, i)) ? '+1.5s' : '선물이 없다',
  },
  { key: 3, label: '말을 건다', enabled: true, note: '+30s' },
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

/**
 * 붕어빵 아저씨 분실물 2지 — note 를 비워 둔다. 정답·오답이 아니라 **양심 시험**이라
 * 어느 쪽이 "이득"인지 미리 보여주면 그 자체가 답을 흘리는 것과 같다.
 */
export const fishcakeBranches = (_s: GameState): readonly Branch[] => [
  { key: 1, label: '내가 가진다', enabled: true, note: '' },
  { key: 2, label: '경찰에 분실물 신고를 하자고 한다', enabled: true, note: '' },
]

/**
 * 편의점 상점 6번째 칸 — 마스크. 5지 선물 퍼즐과 **무관한 별개 구매**다
 * (`GIFT_BOUGHT`를 안 읽고 안 쓴다). 유일하게 실제 잔액을 깎고, 유일하게
 * "이미 샀다"로 잠긴다 — 나머지 5지는 항상 무료라 잔액 부족이 없다.
 */
const maskBranch = (s: GameState): Branch => {
  const owned = hasItem(s, 'I-06')
  return {
    key: 6,
    label: itemDef('I-06').name,
    enabled: !owned && s.cardBalance >= MASK_PRICE,
    note: owned ? '이미 샀다' : s.cardBalance < MASK_PRICE ? '돈이 부족하다' : '',
  }
}

/** 대화 상대 → 분기표. UI 와 시스템이 **같은 함수**를 읽는다 */
export const branchesFor = (s: GameState, dialogId: string): readonly Branch[] =>
  dialogId === GRANDPA_ID ? grandpaBranches(s)
    : dialogId === GIFT_STALL_ID ? [...giftBranches(s), maskBranch(s)]
      : dialogId === FISHCAKE_ID ? fishcakeBranches(s)
        : []

/** 선물 구매 — 1회 한정. 되돌리기가 없으므로 여기서 플래그를 못 박는다 */
const buyGift = (_s: GameState, key: Branch['key']): Action[] => {
  const item = GIFT_ITEMS[key - 1]
  if (!item) return []
  return [
    { t: 'DIALOG', id: null },
    { t: 'PICKUP', item, slot: -1, dropId: null },
    { t: 'FLAG', id: 'GIFT_BOUGHT', on: true },
    { t: 'FX', kind: 'toast', text: `${itemDef(item).name}을(를) 샀다`, lifeMs: 1800, value: 0 },
  ]
}

/** 마스크 구매(상점 6번 칸) — 편의점 상점의 유일한 구매처다 */
const buyMaskFromShop = (s: GameState): Action[] => {
  return [
    { t: 'DIALOG', id: null },
    { t: 'BALANCE', delta: -MASK_PRICE, label: '마스크' },
    { t: 'PICKUP', item: 'I-06', slot: -1, dropId: null },
    ...autoWearActions(s, 'I-06'),
    { t: 'FX', kind: 'toast', text: '마스크를 샀다', lifeMs: 1800, value: 0 },
  ]
}

/**
 * 붕어빵 아저씨 분실물 — 어느 쪽을 골라도 이어폰(I-05)은 받는다. 갈리는 건 **대가**다.
 * ①은 겉으론 아무 일도 안 일어난다 — 값은 개찰구 매복(`systems/ambush.ts`)에서 치른다.
 * ②는 그 자리에서 바로 보상으로 이어진다.
 *
 * `PICKUP` 뒤에 `FLAG EARBUDS_ON`·`ITEM_USED` 를 직접 낸다 — 바닥 습득(`complete()`의
 * `case 'pickup'`)을 안 거치므로 자동 착용(`autoWear`)이 저절로 안 붙는다.
 *
 * `DIALOG`(닫기) 대신 `DIALOG_CHOSEN` 을 낸다 — 대화창을 안 닫고 반응 대사
 * (`FISHCAKE_REACTION`)를 먼저 보여준다. 예전엔 여기서 바로 닫고 반응을 토스트로
 * 띄웠는데, 방금까지 읽던 대화창과 끊겨 보였다(디렉터 지적) — 닫기는 그 대사를
 * 한 번 더 클릭했을 때(`interactSystem`)로 미룬다.
 */
const fishcakeChoice = (_s: GameState, key: Branch['key']): Action[] => {
  const base: Action[] = [
    { t: 'PICKUP', item: 'I-05', slot: -1, dropId: null },
    { t: 'FLAG', id: 'EARBUDS_ON', on: true },
    { t: 'ITEM_USED', item: 'I-05' },
    { t: 'ACT_CONSUME', id: FISHCAKE_ID },
    { t: 'DIALOG_CHOSEN', key: key === 1 ? 1 : 2 },
  ]
  if (key === 1) return [...base, { t: 'FLAG', id: 'EARBUDS_STOLEN', on: true }]
  return base
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

/**
 * `1`~`5` 를 지금 열린 대화창의 **상대**에 따라 갈라 보낸다 — `branchesFor` 가 정한
 * 그 상대의 분기표에서 찾는다. 예전엔 이 함수가 할아버지의 분기만 알고 있어서
 * "대화창이 열려 있다 = 할아버지다"라는 가정이 깔려 있었다. 편의점 매대
 * (`OBJ-19-GIFT`)가 두 번째 'talk' 이 되면서 그 가정이 깨져, 매대 대화에서 `1`을
 * 누르면 거리와 무관하게 `steal()`이 실행되고 할아버지가 소진돼 버렸다(회귀 —
 * `tests/unit/gift.test.ts` 의 "매대 대화에서 1을 눌러도…" 가 그걸 지킨다).
 * 이제는 대화 상대별 분기표를 직접 찾으므로 그 가정이 필요 없다.
 */
const dialogPick = (s: GameState, key: Branch['key']): Action[] => {
  const id = s.act.dialogId
  if (!id) return []
  const b = branchesFor(s, id).find((x) => x.key === key)
  if (!b) return []
  if (!b.enabled) return [{ t: 'ACT_DENY', text: b.note }]
  if (id === GIFT_STALL_ID) return key === 6 ? buyMaskFromShop(s) : buyGift(s, key)
  if (id === FISHCAKE_ID) return fishcakeChoice(s, key)
  if (key === 1) return steal()
  const kind: InteractKind = key === 2 ? 'give' : 'story'
  return [
    { t: 'DIALOG', id: null },
    { t: 'ACT_BEGIN', id: GRANDPA_ID, kind, totalMs: durationOf(kind) },
  ]
}

// ─────────────────────────── 슬롯 사용 ───────────────────────────

/**
 * 손에 든다 / 놓는다 — **대상이 없을 때 슬롯 키가 하는 일** (디렉터 지시 2026-08-07).
 *
 * 같은 칸을 다시 누르면 놓는다. 토글인 이유: 들기 전용 키를 따로 만들면 손을 비우는
 * 방법이 없어지고, 우산을 든 채로는 좌클릭이 우산에 묶이므로(아래 `interactSystem`)
 * **되돌릴 방법이 반드시 손 닿는 곳에 있어야 한다.**
 *
 * 토스트에 `noTargetReason` 을 얹는다 — 예전엔 이 문구가 거부 사유였다. 거부가 사라져도
 * "이건 어디서 쓰는 물건인가"라는 정보는 남겨야 한다. 거부가 아니라 **안내**로 바뀐 것이다.
 */
const equipToggle = (s: GameState, slot: number, item: ItemId): Action[] => {
  const def = itemDef(item)
  const held = s.hand.slot === slot && s.hand.item === item
  if (held) {
    return [
      { t: 'EQUIP', slot: -1, item: null },
      { t: 'FX', kind: 'toast', text: `${def.name}을(를) 넣었다`, lifeMs: 1200, value: 0 },
    ]
  }
  return [
    { t: 'EQUIP', slot, item },
    {
      t: 'FX', kind: 'toast',
      text: `${def.name}을(를) 들었다 — ${def.noTargetReason}`,
      lifeMs: 1600, value: 0,
    },
  ]
}

/**
 * `1`~`0` — 들고 있는 것을 **여기서** 쓴다. 쓸 대상이 없으면 `null` 을 돌려준다.
 *
 * 대상 판정을 조준이 아니라 거리(2.0m)로 하는 이유: 아이템을 쓸 때 플레이어는
 * 이미 대상 앞에 서 있다. 거기서 조준까지 요구하면 "왜 안 되지"가 된다.
 *
 * ★ **`null` 과 빈 배열은 다르다.** `null` 은 "쓸 데가 없다"(→ 손에 든다)이고,
 *   빈 배열은 "썼는데 낼 액션이 없다"이다. 지금 후자는 없지만 구분을 열어 둔다.
 */
const contextUse = (s: GameState, slot: number, item: ItemId): Action[] | null => {
  const def = itemDef(item)

  /**
   * 착용형은 **토글**이다 (P2). P1은 마스크를 켜기만 했다 —
   * 캐리어(−20% 속도)처럼 **대가가 있는 착용**이 들어오면서 끌 수 없다는 것이 곧
   * 되돌릴 수 없는 실수가 됐다.
   *
   * ★ 이어폰·마스크(`toggleable: false`)는 예외다(디렉터 지시) — 대가가 없는
   *   착용이라 끄고 켜는 판단 자체가 없다. 줍는 순간(`auto`, 위 pickup 분기) 켜진
   *   뒤로는 슬롯 키가 토글을 안 낸다 — `contextUse`가 `null`을 돌려주면 아래
   *   `equipToggle`(손에 든다)로 자연히 떨어진다.
   */
  if (def.use === 'wear' && def.flag && def.toggleable !== false) {
    const on = s.flags.includes(def.flag)
    // 디렉터 지시 — "OO 착용/해제" 대신 몸으로 느껴지는 감각을 준다
    const toastText = on
      ? (def.wearOffText ?? `${def.name} 해제`)
      : (def.wearOnText ?? `${def.name} 착용`)
    return [
      { t: 'FLAG', id: def.flag, on: !on },
      ...(on ? [] : [{ t: 'ITEM_USED', item } as Action]),
      { t: 'FX', kind: 'toast', text: toastText, lifeMs: 1400, value: 0 },
    ]
  }

  /**
   * 이어폰(`holdable: false`)은 손에도 안 든다 — 귀에 꽂는 물건이지 드는 물건이 아니다.
   * `[]`(빈 배열)을 돌려줘야 한다 — `null`이면 아래 `equipToggle`(손에 든다)로 떨어진다.
   */
  if (def.use === 'wear' && def.toggleable === false && def.holdable === false) return []

  /**
   * 선물 5종 — 할아버지가 근처면 전달로 직행한다 (선택 UI를 다시 열지 않는다).
   *
   * ★ **다섯 개를 전부 여기서 받는다.** 예전엔 `I-12`(정답) 하나만 이 분기를 타고
   *   나머지 넷은 아래 `switch` 의 `default:` 로 떨어져 `ACT_DENY(def.noTargetReason)`
   *   만 뜨고 끝났다. 그러면 "할아버지 앞에서 슬롯 키를 눌러 봤는데 아무 반응이 없다
   *   = 오답"이라는 **공짜 확인 수단**이 생겨, 잘못 산 선물을 실제로 건네 `E-15` 를
   *   보는 사람이 아무도 없어진다 — 구매의 실패 위험이 사라지면 5지 선택이 의미를
   *   잃는다. 정답/오답 판정은 여기서 하지 않는다: `complete()` 의 `give` 핸들러가
   *   `GIFT_CORRECT` 와 비교해 정답이면 효자손을, 오답이면 `E-15` 를 낸다. 대화창의
   *   [2]번과 이 슬롯 경로가 항상 같은 곳으로 모이게 하는 게 핵심이다.
   */
  if (GIFT_ITEMS.includes(item)) {
    const gp = byId(GRANDPA_ID)
    if (!gp || s.act.consumed.includes(gp.id) || !within(s, gp, 2.2)) return null
    return [
      { t: 'DIALOG', id: null },
      { t: 'ACT_BEGIN', id: GRANDPA_ID, kind: 'give', totalMs: durationOf('give') },
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

    /**
     * 우산 — **여기서는 아무것도 안 한다.** 항상 `null` 이라 슬롯 키는 곧 "든다"다.
     *
     * 예전엔 이 자리에서 가장 가까운 인파 한 명을 밀고 우산을 소모했다. 그 경로를
     * 지운 이유는 `data/tuning.ts UMBRELLA` 헤더에 있다 — 요약하면 우산이 한 자루뿐이라
     * E-11 이 도달 불가능했고, 화면에 아무 일도 안 일어났다.
     * 지금은 들고(여기) → 좌클릭으로 펼치고(`interactSystem`) → 훑는다(`systems/umbrella.ts`).
     * **인파를 미는 경로는 그 하나뿐이다** — 둘로 두면 `PUSH` 계수가 경로마다 갈린다.
     */
    case 'I-09':
      return null

    /**
     * 효자손 — 손에 쥔 채로 자판기가 근처면 QTE.
     *
     * **추격 중이고 할아버지가 손 닿는 거리면 반납이 우선한다** (GDD §4.1 해제 3경로 중 하나).
     * 반납이 자판기보다 앞에 오는 이유: 단소에 맞으면서 자판기를 긁을 상황이라면
     * 플레이어가 원하는 건 긁기가 아니라 살아남기다.
     *
     * 손에 안 쥔 채 눌렀으면 `null`을 돌려 `equipToggle`로 떨어뜨린다 — 한 번 더 누르면
     * (이제 쥔 상태이므로) QTE 로 이어진다. E키 조준 경로([begin])와 조건을 맞춘다.
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
      if (s.hand.item !== 'I-01') return null
      const vend = INTERACTABLES.find(
        (it) => isVending(it.id) && !s.act.consumed.includes(it.id) && within(s, it, 2.2))
      if (!vend) return null
      return [{ t: 'QTE_BEGIN', vendorId: vend.id }]
    }

    default:
      return null
  }
}

/**
 * 슬롯 키 한 번의 전부 — **쓸 데가 있으면 쓰고, 없으면 든다.**
 *
 * 이 순서가 뒤집히면(항상 들고, 쓰려면 한 번 더) 자판기 앞에서 효자손을 두 번 눌러야 하고
 * 할아버지 앞에서 선물을 두 번 눌러야 한다 — P1부터의 조작이 통째로 한 박자 늘어난다.
 * "언제든 장착"은 **아무 데서나 들 수 있다**는 뜻이지 쓰기를 없애라는 뜻이 아니다.
 */
const useSlot = (s: GameState, slot: number): Action[] => {
  const item = s.inventory[slot] ?? null
  if (!item) return []
  return contextUse(s, slot, item) ?? equipToggle(s, slot, item)
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
    const isFishcake = s.act.dialogId === FISHCAKE_ID
    /**
     * 붕어빵 아저씨 반응 대사 — 골랐지만 아직 안 닫힌 상태(`dialogChoice`).
     * 클릭(=E) 한 번이면 그제야 닫힌다. `dialogPick`을 다시 태우지 않는다 —
     * 이미 골랐다(두 번 고르면 `PICKUP`이 두 번 나간다).
     */
    if (isFishcake && s.act.dialogChoice !== 0) {
      if (f.pressCancel || f.pressInteract) return [...out, { t: 'DIALOG', id: null }]
      return out
    }
    /**
     * 붕어빵 아저씨 인사말 — 마지막 줄 전까지는 **클릭(=E)으로만 넘어간다.**
     * 이동으로 안 잠기는 이유: `movement.ts`가 이미 이 대화 동안 실제 이동을 막는다
     * (`isTalkLocked`) — 그래서 여기 `moveAxis` 취소 검사도 이 상대에게는 안 먹인다.
     * 안 먹이지 않으면 가만히 서서 방향키만 눌러도 대화가 닫혀 버린다.
     */
    if (isFishcake && s.act.dialogStep < FISHCAKE_GREETING.length - 1) {
      if (f.pressCancel) return [...out, { t: 'DIALOG', id: null }]
      if (f.pressInteract) return [...out, { t: 'DIALOG_ADVANCE' }]
      return out
    }
    if (f.pressCancel || (!isFishcake && moveAxis(f) > INTERACT.cancelAxis)) {
      return [...out, { t: 'DIALOG', id: null }]
    }
    if (f.pressSlot >= 1 && f.pressSlot <= 6) return [...out, ...dialogPick(s, f.pressSlot as Branch['key'])]
    return out
  }

  // 3) 진행 중 상호작용
  if (s.act.busyId) {
    const kind = s.act.busyKind
    // 말동무 해주기(`story`)는 디렉터 지시로 중간에 못 나간다 — ESC도, 이동도 안 먹는다
    // (이동은 애초에 `movement.ts` 가 입력을 씹어서 여기까지 안 온다)
    const cancellable = kind !== 'story'
    const cancelled = cancellable &&
      (f.pressCancel || (kind !== null && CANCEL_ON_MOVE.has(kind) && moveAxis(f) > INTERACT.cancelAxis))
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
    const it = id ? resolve(s, id) : null
    /**
     * **우산을 들고 있으면 좌클릭(=`E`)이 우산을 편다** (디렉터 지시 2026-08-07).
     *
     * 단, **조준한 대상이 있으면 상호작용이 이긴다.** 조준(`aimed`)은 화면 중앙에
     * 대상을 둔 것이므로 그건 의도다 — 우산을 들었다는 이유로 눈앞의 사람을 못 부르게
     * 되면 "왜 저게 안 되지"가 된다. 근접 폴백(`aimed === false`)은 시선 밖의 대상이라
     * 의도로 안 보고 우산에게 넘긴다.
     *
     * 그래서 인파를 정면으로 보고 서면 우산이 안 펴진다 — **떨어져서 펴고 밀고 들어간다**가
     * 이 동사의 모양이다. 그게 훑는 감각의 전부다.
     */
    if (s.hand.item === 'I-09' && !(it && aim.aimed)) {
      return [...out, { t: 'UMBRELLA', open: !s.hand.open }, {
        t: 'FX', kind: 'toast',
        text: s.hand.open ? '우산을 접었다' : '우산을 펼쳤다',
        lifeMs: 1200, value: 0,
      }]
    }
    if (!it) return out
    return [...out, ...begin(s, it)]
  }

  return out
}
