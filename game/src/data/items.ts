/**
 * 아이템 정의 — P1은 4종.
 *
 * GDD §5.3의 14종 중 P1 범위(`docs/P1-SPEC.md` §3)만 넣는다.
 * ID는 GDD와 **완전히 같다.** 결번(I-02 동전·I-03 삭제·I-04 카드)은 슬롯을 쓰지 않으므로 여기 없다.
 *
 * 왜 4종인가: E-05 TRUE 엔딩 조건이 "아이템 4종 이상 사용"이다(P2).
 * 4종이 P1에 들어오면 P2에서 TRUE 엔딩을 켤 때 아이템 쪽은 이미 준비돼 있다.
 */

import type { ItemId } from '../state/types'

export type ItemDef = Readonly<{
  id: ItemId
  /** HUD·툴팁 표기 */
  name: string
  /** items.glb 안의 노드 이름 — 프롭 렌더가 이 이름으로 찾는다 */
  node: string
  /** 사용 시 소모되는가 (마스크는 착용 지속이라 false) */
  consumable: boolean
  /** 인벤 아이콘 대신 쓰는 1글자 — 3분 게임에 아이콘 에셋을 만들 이유가 없다 */
  glyph: string
  /** `1``2``3` 으로 사용했을 때 근처에 대상이 없으면 나오는 사유 */
  noTargetReason: string
}>

export const ITEMS: Readonly<Record<ItemId, ItemDef | undefined>> = {
  'I-01': {
    id: 'I-01',
    name: '효자손',
    node: 'ITM01_Backscratcher',
    consumable: false,
    glyph: '🪃',
    // 효자손은 "쓰는" 물건이 아니라 자판기 상호작용의 **조건**이다.
    noTargetReason: '자판기 앞에서 써야 한다',
  },
  'I-06': {
    id: 'I-06',
    name: '마스크',
    node: 'ITM06_Mask',
    consumable: false,
    glyph: '😷',
    // 착용은 언제든 가능하다 — 이 사유는 이미 착용한 경우에만 쓰인다
    noTargetReason: '이미 쓰고 있다',
  },
  'I-09': {
    id: 'I-09',
    name: '우산',
    node: 'ITM09_Umbrella',
    consumable: true,
    glyph: '☂',
    noTargetReason: '여기서 쓸 데가 없다',
  },
  'I-12': {
    id: 'I-12',
    name: '붕어빵',
    node: 'ITM01_Backscratcher',   // 전용 메시 없음 — P2에서 교체. 존재는 슬롯 아이콘으로 읽힌다
    consumable: true,
    glyph: '🐟',
    noTargetReason: '드릴 사람이 없다',
  },
  // 아래는 P2 예약 — 선언만 있고 정의는 없다 (Record 완전성 유지)
  'I-02': undefined,   // 동전 — 슬롯 미점유. 습득 즉시 잔액으로 흡수된다 (GDD §5.2)
  'I-05': undefined,
  'I-07': undefined,
  'I-08': undefined,
  'I-10': undefined,
  'I-11': undefined,
  'I-13': undefined,
  'I-14': undefined,
  'I-15': undefined,
  'I-04': undefined,
} as const

/**
 * 정의 조회. **던지지 않는다.**
 *
 * 예전엔 미정의 ID에 throw 했다. 이 함수는 `systems/interact.ts` 의 슬롯 사용 경로와
 * HUD 렌더가 **매 프레임/입력마다** 부르는 자리다. P2에서 `gives: 'I-05'` 같은 항목을
 * 테이블에 먼저 넣고 정의를 나중에 쓰면, 그 순간 `tick()` 안에서 예외가 터진다 —
 * 파이프라인에 try/catch 가 없으므로 게임이 통째로 멈춘다.
 * 정의가 없는 편이 게임이 멈추는 것보다 낫다: **자리표시자를 돌려주고 화면에 드러낸다.**
 */
export const itemDef = (id: ItemId): ItemDef => ITEMS[id] ?? {
  id,
  name: id,                 // 이름 자리에 ID가 보이면 정의 누락이라는 뜻이다
  node: '',
  consumable: false,
  glyph: '?',
  noTargetReason: '아직 쓸 수 없다',
}

/** P1에서 실제로 존재하는 아이템만 */
export const P1_ITEMS: readonly ItemId[] = ['I-01', 'I-06', 'I-09', 'I-12']
