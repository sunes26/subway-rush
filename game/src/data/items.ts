/**
 * 아이템 정의 — 13종(슬롯 점유) + 미점유 2종.
 *
 * ID는 GDD §5.3에서 시작했으나 결번이 셋이다 — I-03(삭제), I-10(캐리어)·I-14(EMP 폭탄)은
 * 디렉터 지시로 아이템 체계째 지웠다. I-15는 정의되어 있다.
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
   * 이어폰·마스크처럼 **소지 자체가 곧 능력**인 착용형은 전부 켠다.
   * 캐리어만 예외다 — 켜는(끄는) 순간이 곧 이동속도를 깎는 판단이라 손을 안 댄다.
   */
  autoWear?: boolean
  /**
   * 슬롯 키로 끄고 켤 수 있는가 (기본 참).
   * 디렉터 지시 — 이어폰·마스크는 **소지 자체가 능력**이라 따로 껐다 켰다 할 수 없다.
   * 대가가 있는 캐리어만 여전히 토글이다.
   */
  toggleable?: boolean
  /**
   * 슬롯 키로 손에 들 수 있는가 (기본 참).
   * 디렉터 지시 — 이어폰은 귀에 꽂는 물건이지 손에 드는 물건이 아니다.
   * `false`면 `toggleable: false` 착용형이 손 대신 아무 일도 안 한다.
   */
  holdable?: boolean
  /** 무효화하는 방해요소 — `systems/obstacles.ts` 의 표와 **양방향 일치**해야 한다 */
  negates?: readonly ObsId[]
  /** 인벤 아이콘 대신 쓰는 1글자 — 3분 게임에 아이콘 에셋을 만들 이유가 없다 */
  glyph: string
  /** `1``2``3` 으로 사용했을 때 근처에 대상이 없으면 나오는 사유 */
  noTargetReason: string
  /**
   * 착용형 HUD 툴팁 1줄 — 디렉터 지시로 **정확한 수치 대신 두루뭉실한 힌트**를 준다.
   * 무슨 방해요소를 막는지 스스로 짐작하게 하는 것이 목적이다.
   */
  cost?: string
  /**
   * 착용형을 켜고 끌 때 뜨는 토스트 — 디렉터 지시로 `"OO 착용"/"OO 해제"` 대신
   * 몸으로 느껴지는 감각을 준다. 없으면 `${name} 착용/해제`로 대체한다.
   */
  wearOnText?: string
  wearOffText?: string
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
    // 디렉터 지시 — 정확한 사용법 대신 두루뭉실한 힌트
    noTargetReason: '자판기 아래를 훑기 좋아 보인다',
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
    toggleable: false,
    holdable: false,
    negates: ['OBS-07'],
    glyph: '🎧',
    noTargetReason: '이미 끼고 있다',
    cost: '누군가의 말을 무시할 수 있을 것 같다',
  },
  {
    id: 'I-06',
    name: '마스크',
    node: 'ITM06_Mask',
    slot: true,
    consumable: false,
    use: 'wear',
    flag: 'MASK_ON',
    autoWear: true,
    toggleable: false,
    holdable: false,
    negates: ['OBS-04'],
    glyph: '😷',
    noTargetReason: '이미 쓰고 있다',
    cost: '사람들 사이를 좀 더 수월하게 비집고 나갈 수 있을 것 같다',
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
    noTargetReason: '바닥에 깔면 안 미끄러질 것 같다',
  },
  {
    id: 'I-09',
    name: '우산',
    node: 'ITM09_Umbrella',
    slot: true,
    /**
     * **소모되지 않는다** (디렉터 지시 2026-08-07). 예전엔 한 번 쓰면 사라졌는데,
     * 맵에 우산이 한 자루뿐이라 E-11("우산 밀기 3회")이 도달 불가능한 엔딩이었다.
     * 지금은 들고 · 펼치고 · 인파를 훑는다 (`systems/umbrella.ts`).
     */
    consumable: false,
    use: 'use',
    negates: ['OBS-03'],
    glyph: '☂',
    noTargetReason: '펼치면 뭔가 막아줄 것 같다',
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
    noTargetReason: '주인을 찾아줄 수 있을 것 같다',
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
    noTargetReason: '누군가에게 선물하면 좋아할 것 같다',
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
    noTargetReason: '누군가에게 선물하면 좋아할 것 같다',
  },
  {
    id: 'I-16',
    name: '초콜릿',
    node: 'ITM12_Chocolate',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍫',
    noTargetReason: '누군가에게 선물하면 좋아할 것 같다',
  },
  {
    id: 'I-17',
    name: '탄산음료',
    node: 'ITM12_Soda',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🥤',
    noTargetReason: '누군가에게 선물하면 좋아할 것 같다',
  },
  {
    id: 'I-18',
    name: '새우깡',
    node: 'ITM12_SnackBag',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍤',
    noTargetReason: '누군가에게 선물하면 좋아할 것 같다',
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

/**
 * 편의점 선물 5지 가격(원) — **실제로 잔액을 깎는다** (디렉터 지시 2026-08-10).
 *
 * 예전에는 표시만 하는 꾸밈이었다. 값을 매기면 시작 잔액 0원에서 정답(`I-12`)을 못 사는
 * 판이 생길까 봐 미뤄 뒀던 것인데, 실제 경제를 재 보면 막히지 않는다:
 * 바닥 동전 3개(각 100원) + 자판기 3대(합계 ≥ 요금 1,400원 보장, `systems/qte.ts coinPlan`)
 * → **최소 1,700원**이다. 200원짜리를 사도 요금이 남는다.
 *
 * 양갱·새우깡이 같은 값인 이유는 그대로다: 가격 차이 자체가 정답 힌트가 되면 안 된다
 * (`giftBranches` 의 note 를 전부 비우는 규칙과 같은 이유) — 두 후보를 묶어 애매하게 둔다.
 * 그래서 **정답이 최고가도 최저가도 아니다.**
 */
export const SHOP_PRICE: Readonly<Partial<Record<ItemId, number>>> = {
  'I-12': 200,
  'I-15': 100,
  'I-16': 100,
  'I-17': 100,
  'I-18': 200,
}

/**
 * 마스크 실가격(원) — 편의점 상점 6번 칸의 **유일한 구매처**다(디렉터 지시로
 * 물리 진열대를 없앴다). 선물 5지와 달리 이쪽은 처음부터 실제 청구였다.
 *
 * 1,500원에서 내렸다(디렉터 지시 2026-08-10). 선물이 유상이 되면서 한 판에 벌 수 있는
 * 돈(동전 300 + 자판기 ≥1,400 = **≥1,700원**)으로는 마스크·선물·개찰 요금 셋을 못 채워
 * 마스크가 사실상 잠겼다: 1,500 + 200 + 1,400 = 3,100원. 800원이면 2,400원이라
 * 자판기가 잘 나온 판(합계 1,900~4,500)에서는 셋 다 성립한다 — **잠긴 선택지가 아니라
 * 값을 치르는 선택지**가 된다.
 */
export const MASK_PRICE = 800

/**
 * 상점 6칸이 **실제로 청구하는 금액**(원). 표에 없으면 0.
 *
 * 판정(`systems/interact.ts` 의 `giftBranches`·`buyGift`)과 화면(`ui/dialog.ts` 의
 * 가격표·`구매` 버튼)이 반드시 같은 값을 읽어야 한다 — 갈라지면 "1,500원이라고 써
 * 놓고 안 깎는" 상점이 된다(실제로 선물 5지가 그 상태였다).
 */
export const shopPriceOf = (id: ItemId): number =>
  id === 'I-06' ? MASK_PRICE : SHOP_PRICE[id] ?? 0

/** 착용형 — HUD가 켜짐/꺼짐을 표시한다 */
export const WEARABLES: readonly ItemDef[] = DEFS.filter((d) => d.use === 'wear')

/** 방해요소를 무효화하는 아이템 목록 (양방향 대조용) */
export const negatorsOf = (obs: ObsId): readonly ItemId[] =>
  DEFS.filter((d) => d.negates?.includes(obs)).map((d) => d.id)

/** P1 호환 — 옛 이름을 남겨 둔다 (테스트·프롭 렌더가 참조) */
export const P1_ITEMS: readonly ItemId[] = ['I-01', 'I-06', 'I-09', 'I-12']
