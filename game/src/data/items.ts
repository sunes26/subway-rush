/**
 * 아이템 정의 — P2는 15종(슬롯 점유) + 미점유 2종.
 *
 * ID는 GDD §5.3과 **완전히 같다.** 결번은 I-03 삭제뿐이다. I-15는 이제 정의되어 있다.
 * I-02 동전·I-04 교통카드는 **슬롯을 쓰지 않으므로** 정의는 있고 `slot: false` 다.
 *
 * P1은 4종이었다. P2가 11종으로 늘리면서 생긴 진짜 변화는 개수가 아니라
 * **슬롯 3칸을 두고 다투기 시작한 것**이다 (`docs/P2-SPEC.md` §3.2).
 */

import type { ObsId } from './obstacles'
import type { FlagId, ItemId } from '../state/types'

/**
 * 사용 방식.
 *  · `wear`  — 토글. 슬롯을 비우지 않는다. 켜고 끄는 이유가 각자 있다(대가가 있다)
 *  · `use`   — 손으로 쓴다. 소모된다
 *  · `auto`  — 들고만 있으면 방해요소가 알아서 소모한다 (`systems/obstacles.ts`)
 *  · `key`   — 특정 대상 앞에서만 의미가 있다. 슬롯 사용키로는 사유만 나온다
 *  · `passive` — 소지 자체가 효과다 (노선도)
 */
export type ItemUse = 'wear' | 'use' | 'auto' | 'key' | 'passive'

export type ItemDef = Readonly<{
  id: ItemId
  /** HUD·툴팁 표기 */
  name: string
  /** items.glb 안의 노드 이름 — 프롭 렌더가 이 이름으로 찾는다 */
  node: string
  /** 슬롯을 점유하는가. 동전·교통카드만 false */
  slot: boolean
  /** 사용 시 소모되는가 */
  consumable: boolean
  use: ItemUse
  /** 착용형이면 어떤 플래그를 토글하는가 */
  flag?: FlagId
  /**
   * 줍는 즉시 착용하는가 (P2 · 디렉터 지시).
   * **대가가 가벼운 착용형에만** 준다 — 마스크·캐리어는 켜는 순간이 곧 판단이라 손을 안 댄다.
   */
  autoWear?: boolean
  /** 무효화하는 방해요소 — `systems/obstacles.ts` 의 표와 **양방향 일치**해야 한다 */
  negates?: readonly ObsId[]
  /** 인벤 아이콘 대신 쓰는 1글자 — 3분 게임에 아이콘 에셋을 만들 이유가 없다 */
  glyph: string
  /** `1``2``3` 으로 사용했을 때 근처에 대상이 없으면 나오는 사유 */
  noTargetReason: string
  /** 착용형의 대가 — HUD 툴팁 1줄. 대가 없는 착용형은 그냥 상시 켜 두면 되므로 판단이 없다 */
  cost?: string
}>

const DEFS: readonly ItemDef[] = [
  {
    id: 'I-01',
    name: '효자손',
    node: 'ITM01_Backscratcher',
    slot: true,
    consumable: false,
    use: 'key',
    // 효자손 자체가 시간을 벌어 주지는 않는다 — **자판기를 열어 잔액부족(OBS-02)을 푼다**
    negates: ['OBS-02'],
    glyph: '🪃',
    // 효자손은 "쓰는" 물건이 아니라 자판기 상호작용의 **조건**이다.
    noTargetReason: '자판기 앞에서 써야 한다',
  },
  {
    id: 'I-05',
    name: '무선이어폰',
    node: 'ITM05_Earbuds',
    slot: true,
    consumable: false,
    use: 'wear',
    flag: 'EARBUDS_ON',
    autoWear: true,
    negates: ['OBS-06', 'OBS-07'],
    glyph: '🎧',
    noTargetReason: '이미 끼고 있다',
    // 대가 — 안 그러면 상시 착용이 정답이라 판단이 없다
    cost: '착용 중엔 안내 LED 힌트가 안 들린다',
  },
  {
    id: 'I-06',
    name: '마스크',
    node: 'ITM06_Mask',
    slot: true,
    consumable: false,
    use: 'wear',
    flag: 'MASK_ON',
    negates: ['OBS-04'],
    glyph: '😷',
    noTargetReason: '이미 쓰고 있다',
    cost: '스태미너 회복이 20% 느리다',
  },
  {
    id: 'I-07',
    name: '텀블러 커피',
    node: 'ITM07_Coffee',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '☕',
    noTargetReason: '지금은 마실 때가 아니다',
  },
  {
    id: 'I-08',
    name: '신문지',
    node: 'ITM08_Paper',
    slot: true,
    consumable: true,
    use: 'auto',
    negates: ['OBS-05'],
    glyph: '📰',
    noTargetReason: '젖은 바닥에서 알아서 깔린다',
  },
  {
    id: 'I-09',
    name: '우산',
    node: 'ITM09_Umbrella',
    slot: true,
    consumable: true,
    use: 'use',
    negates: ['OBS-03'],
    glyph: '☂',
    noTargetReason: '여기서 쓸 데가 없다',
  },
  {
    id: 'I-10',
    name: '캐리어',
    node: 'ITM10_Luggage',
    slot: true,
    consumable: false,
    use: 'wear',
    flag: 'CARRIER_ON',
    negates: ['OBS-03', 'OBS-04'],
    glyph: '🧳',
    noTargetReason: '이미 끌고 있다',
    cost: '끄는 동안 이동속도 −20%',
  },
  {
    id: 'I-11',
    name: '유실물 지갑',
    node: 'ITM11_Wallet',
    slot: true,
    consumable: true,
    use: 'key',
    negates: ['OBS-01'],
    glyph: '👛',
    noTargetReason: '유실물센터 창구에 맡겨야 한다',
  },
  {
    id: 'I-12',
    name: '양갱',
    node: 'ITM12_Yanggaeng',
    slot: true,
    consumable: true,
    use: 'use',
    negates: ['OBS-14'],
    glyph: '🍡',
    noTargetReason: '드릴 사람이 없다',
  },
  /**
   * 오답 4종 — 편의점 매대의 나머지. **`negates` 를 비워 둔다.**
   * 오답으로도 추격이 막히면 퍼즐이 성립하지 않는다.
   * 바나나우유·초콜릿은 "헷갈리는 오답", 탄산음료·새우깡은 "명확한 오답"이다
   * (`docs/OBJECT-MANIFEST.md:184-187`).
   */
  {
    id: 'I-15',
    name: '바나나우유',
    node: 'ITM12_BananaMilk',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🥛',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-16',
    name: '초콜릿',
    node: 'ITM12_Chocolate',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍫',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-17',
    name: '탄산음료',
    node: 'ITM12_Soda',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🥤',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-18',
    name: '새우깡',
    node: 'ITM12_SnackBag',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍤',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-13',
    name: '노선도',
    node: 'ITM13_RouteMap',
    slot: true,
    consumable: false,
    use: 'passive',
    negates: ['OBS-10', 'OBS-11'],
    glyph: '🗺',
    noTargetReason: '펼쳐 봤다',
  },
  {
    id: 'I-14',
    name: 'EMP 폭탄',
    node: 'ITM14_Emp',
    slot: true,
    consumable: true,
    use: 'auto',
    negates: ['OBS-08'],
    glyph: '💥',
    noTargetReason: '길이 막히면 알아서 터진다',
  },

  // ── 슬롯 미점유 ──
  {
    id: 'I-02',
    name: '동전',
    node: 'ITM02_Coin',
    slot: false,
    consumable: true,
    use: 'passive',
    negates: ['OBS-02'],
    glyph: '🪙',
    noTargetReason: '잔액으로 들어갔다',
  },
  {
    id: 'I-04',
    name: '교통카드',
    node: 'ITM04_Card',
    slot: false,
    consumable: false,
    use: 'passive',
    glyph: '💳',
    noTargetReason: '개찰구에서 쓴다',
  },
]

export const ITEMS: Readonly<Record<ItemId, ItemDef | undefined>> = Object.fromEntries(
  DEFS.map((d) => [d.id, d]),
) as Readonly<Record<ItemId, ItemDef | undefined>>

/**
 * 정의 조회. **던지지 않는다.**
 *
 * 이 함수는 `systems/interact.ts` 의 슬롯 사용 경로와 HUD 렌더가 **매 프레임/입력마다**
 * 부르는 자리다. 테이블에 `gives: 'I-15'` 를 먼저 넣고 정의를 나중에 쓰면 그 순간
 * `tick()` 안에서 예외가 터지고, 파이프라인에 try/catch 가 없으므로 게임이 통째로 멈춘다.
 * **자리표시자를 돌려주고 화면에 드러낸다** — 이름 자리에 ID가 보이면 정의 누락이라는 뜻이다.
 */
export const itemDef = (id: ItemId): ItemDef => ITEMS[id] ?? {
  id,
  name: id,
  node: '',
  slot: true,
  consumable: false,
  use: 'key',
  glyph: '?',
  noTargetReason: '아직 쓸 수 없다',
}

/** 슬롯을 점유하는 아이템만 — 인벤토리에 들어갈 수 있는 것들 */
export const SLOT_ITEMS: readonly ItemId[] = DEFS.filter((d) => d.slot).map((d) => d.id)

/**
 * 편의점 선물 후보 — **첫 항목이 정답이다.**
 * 순서가 매대 선택창의 키 순서(`1`~`5`)와 같아야 한다.
 */
export const GIFT_ITEMS: readonly ItemId[] = ['I-12', 'I-15', 'I-16', 'I-17', 'I-18']

/** 정답 — 할아버지가 받는 유일한 선물 */
export const GIFT_CORRECT: ItemId = 'I-12'

/** 착용형 — HUD가 켜짐/꺼짐을 표시한다 */
export const WEARABLES: readonly ItemDef[] = DEFS.filter((d) => d.use === 'wear')

/** 방해요소를 무효화하는 아이템 목록 (양방향 대조용) */
export const negatorsOf = (obs: ObsId): readonly ItemId[] =>
  DEFS.filter((d) => d.negates?.includes(obs)).map((d) => d.id)

/** P1 호환 — 옛 이름을 남겨 둔다 (테스트·프롭 렌더가 참조) */
export const P1_ITEMS: readonly ItemId[] = ['I-01', 'I-06', 'I-09', 'I-12']
