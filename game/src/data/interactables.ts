/**
 * 상호작용 대상 테이블 — 단일 진실 원천.
 *
 * ★ 좌표는 전부 `data/world.ts`의 솔리드에서 나온다. **좌표를 여기서 새로 만들지 않는다** —
 *   P0에서 "그림과 충돌이 갈라진다"로 열한 번 데었다(`hq_fixups.VEND_TARGET` 주석 참고).
 *   솔리드 중심을 쓰고, 플레이어는 그 앞 1~1.5m에 서서 상호작용한다.
 *
 * 아웃라인은 **종류·조건·결과와 무관하게 골드 단일**이다 (GDD §5.1).
 * 그래서 이 테이블에 색 필드가 없다. 없는 게 설계다.
 */

import { FLOOR } from './world'
import { COIN } from './tuning'
import { makeRng } from '../core/rng'
import type { ItemId } from '../state/types'

/** 상호작용 종류 — 소요 시간과 취소 규칙이 여기서 갈린다 (P1-SPEC §2.4) */
export type InteractKind =
  | 'pickup'    // 아이템 습득 0.8s · 이동 가능 · 취소 불가
  | 'buy'       // 구매 1.5s · 이동 시 취소 · 잔액 미차감
  | 'talk'      // 선택 UI를 연다 — 그 자체는 0s (소요는 고른 분기가 낸다)
  | 'scratch'   // 자판기 긁기 — QTE를 연다
  | 'aside'     // "저기요" 3.0s
  | 'give'      // 붕어빵 전달 1.5s
  | 'story'     // 할아버지 인생 이야기 완청 15.0s
  // ── P2 ──
  | 'return'    // 유실물 반납 2.0s — 비상게이트가 열린다
  | 'call'      // 인터폰 호출 0.5s — 역무원을 기다리는 −15s 가 뒤따른다
  | 'enter'     // 문을 열고 들어간다 1.2s (화장실 · 반대편 승강장)

export type Interactable = Readonly<{
  id: string
  kind: InteractKind
  /** 대상 중심 (월드 좌표) */
  x: number
  y: number
  z: number
  /** 근접·조준 판정용 표기 라벨 */
  label: string
  /** 습득형이면 어떤 아이템이 나오는가 */
  gives?: ItemId
  /** 필요 아이템 (없으면 사유 표시) */
  needs?: ItemId
  /** 필요 잔액 (원) */
  cost?: number
  /** needs 미충족 시 사유 1줄 — GDD §5.1의 `"효자손이 필요하다"` 형식 */
  needReason?: string
  /** 1회성인가 — 성공하면 `act.consumed`에 들어간다 */
  once: boolean
  /**
   * 프롭을 세울 방향(rad, 월드 yaw). 없으면 `render/props.ts` 의 기본 각.
   *
   * 기본 각은 "바닥에 놓인 물건이 정면·측면 실루엣을 둘 다 남기는" 값이라
   * **벽에 붙이는 것에는 안 맞는다** — 종이 노선도가 벽에서 45° 떠 보인다.
   */
  faceYaw?: number
  /**
   * 프롭 배율(기본 1). **벽에 거는 게시물**만 쓴다.
   *
   * 노선도 메시는 손바닥 크기(0.082×0.054 m)의 종이다 — 그게 주머니에 들어가는 물건의
   * 실제 치수다. 그대로 벽에 붙이면 3m 앞에서 검은 얼룩으로만 읽힌다.
   * 역 벽의 노선도판은 **같은 인쇄물의 확대판**이므로 메시를 키워 그린다.
   */
  propScale?: number
  /**
   * 자체 발광으로 그리는가 — **벽에 걸린 게시물 전용.**
   *
   * 프롭은 씬 조명을 받는데 이 역의 조명은 라이트맵이 대신하고 있어 실광원이 0.03~0.31 이다
   * (`render/scene.ts`). 손에 드는 물건은 실루엣과 골드 아웃라인으로 읽히니 상관없지만,
   * **읽어야 하는 인쇄물**은 그 밝기에서 새까맣게 나온다(실측).
   * 실제 역 노선도판도 백라이트 박스다 — 그림을 밝히는 게 거짓이 아니다.
   */
  backlit?: boolean
}>

/**
 * ★ Z2 · 할아버지 (ACT-02).
 * `ACT-02-BENCH` 는 at(42, 15, 2.4, 0.8) — 벤치 중심이 (42, 15)다.
 * 앉은 사람은 벤치 남쪽 절반에 있으므로 y를 0.1 남쪽으로 둔다.
 */
export const GRANDPA_ID = 'ACT-02-GP'

/** 편의점 선물 매대 — 5지 선택 대화(`giftBranches`)를 여는 `talk` 대상 */
export const GIFT_STALL_ID = 'OBJ-19-GIFT'

/** 자판기 3대 — `OBJ-06/07/08-VEND*` 솔리드 중심과 **같은 좌표**다 */
export const VENDING_IDS = ['OBJ-06', 'OBJ-07', 'OBJ-08'] as const
export type VendingId = (typeof VENDING_IDS)[number]

/** O-03 인파벽 3인 — 순서가 곧 x 순서다(앞사람부터 비켜야 한다) */
export const CP_IDS = ['ACT-CP', 'ACT-CP2', 'ACT-CP3'] as const

export const INTERACTABLES: readonly Interactable[] = [
  // ───────────── Z1 (L0) ─────────────
  {
    // 붕어빵 노점 — `OBJ-03-CART` at(−50, 32, 2.4, 1.6). 남쪽 면이 y=31.2 이므로
    // 플레이어는 y≈30.5에 서서 산다. 스폰(−58, 24)에서 9m — 왕복 4초.
    id: 'OBJ-03',
    kind: 'buy',
    x: -50, y: 31.1, z: FLOOR.L0,
    label: '붕어빵 (500원)',
    gives: 'I-12',
    cost: 500,
    needReason: '돈이 부족하다',
    once: false,          // 여러 개 살 수 있다 — 슬롯이 알아서 막는다
  },

  // ───────────── Z2 (B1) ─────────────
  {
    id: GRANDPA_ID,
    kind: 'talk',
    x: 42, y: 14.9, z: FLOOR.B1,
    label: '할아버지',
    once: true,           // 효자손을 한 번 넘기면 끝이다
  },
  {
    id: 'OBJ-06',
    kind: 'scratch',
    x: 13.03, y: 4.15, z: FLOOR.B1,
    label: '자판기 A',
    needs: 'I-01',
    needReason: '효자손이 필요하다',
    once: true,
  },
  {
    id: 'OBJ-07',
    kind: 'scratch',
    x: 21.63, y: 4.15, z: FLOOR.B1,
    label: '자판기 B',
    needs: 'I-01',
    needReason: '효자손이 필요하다',
    once: true,
  },
  {
    id: 'OBJ-08',
    kind: 'scratch',
    x: 25.93, y: 4.15, z: FLOOR.B1,
    label: '자판기 C',
    needs: 'I-01',
    needReason: '효자손이 필요하다',
    once: true,
  },
  {
    /**
     * 우산꽂이 `OBJ-16-UMBRELLA` at(38, 5, 1.0, 0.6) · 높이 1.0m.
     *
     * ⚠ 처음엔 꽂이 **북쪽**(y 5.35) 바닥에 뒀다. 스크린샷에서 우산이 아예 안 보였다 —
     *   남쪽에서 접근하는 플레이어 시점에서 꽂이 본체에 완전히 가려진다.
     *   게다가 우산은 0.29m(×1.6 = 0.46m)라 바닥에 누우면 2.6m 앞에서 픽셀 몇 개다.
     *   **꽂이 안에 꽂는다** — 고도 +1.0m. 그게 우산꽂이의 용도이기도 하다.
     */
    id: 'OBJ-16',
    kind: 'pickup',
    // P2 — 꽂이에 **진짜 우산들이 꽂히면서**(`data/decor.ts`) 이것만 공중에 뜨면
    // 어색하다. 통 안(밑면 0.55m)으로 내린다. 장식보다 0.15m 높아 눈에 먼저 든다
    x: 38, y: 5.0, z: FLOOR.B1 + 0.55,
    label: '우산',
    gives: 'I-09',
    once: true,
  },
  {
    // 편의점 `OBJ-19-CVS` 파사드가 y=25.7. 그 앞 0.2m 띠(Z2-NE 슬랩 시작 25.4)에 둔다.
    // 25.4보다 북쪽이어야 슬랩 위이고, 25.7보다 남쪽이어야 유리벽 속이 아니다.
    id: 'OBJ-19-MASK',
    kind: 'pickup',
    x: 24.0, y: 25.55, z: FLOOR.B1,
    label: '마스크',
    gives: 'I-06',
    once: true,
  },
  {
    /**
     * 편의점 선물 매대 — 마스크와 같은 파사드 규칙(y 는 슬랩 25.4 와 유리벽 25.7 사이).
     * 마스크(x=24.0)에서 동쪽으로 2m 떨어뜨린다. 상호작용 반경(1.5m)끼리는 겹치지만
     * 대상 판정이 근접이 아니라 조준(각도) 기준이라 헷갈리지 않는다 — 둘을 구분해
     * 보고 고를 수 있을 만큼만 떨어뜨리면 된다.
     */
    id: GIFT_STALL_ID,
    kind: 'talk',
    x: 26.0, y: 25.55, z: FLOOR.B1,
    label: '편의점 매대',
    once: false,
  },

  // ───────────── Z4 (B1) ─────────────
  /**
   * O-03 에스컬레이터 인파벽 — **3인 1열** (P2에서 복원).
   *
   * P1은 1인으로 축약했다(`docs/P1-TECH-PLAN.md` §4 의 빚 목록). 1인이면 우산 한 번으로
   * 끝나서 E-11("우산으로 밀기 3회")이 **도달 불가**였고, 15초 정체라는 GDD 의 실패 비용도
   * 나오지 않았다. 진입부를 따라 x 로 늘어세운다 — 통로가 좁아 옆으로 못 지난다.
   */
  ...([96.6, 97.8, 99.0] as const).map((x, i): Interactable => ({
    id: CP_IDS[i] as string,
    kind: 'aside',
    x, y: 2.2, z: FLOOR.B1,
    label: i === 0 ? '캐리어 든 승객' : i === 1 ? '이어폰 낀 승객' : '장바구니 든 승객',
    once: true,
  })),

  // ═══════════════ P2 신규 ═══════════════
  // 좌표는 전부 `data/world.ts` 의 솔리드에서 나온다. 접근 면을 명시한다 —
  // "어느 면에서 보이는가"로 P0에서 열한 번 데었다(면 방향 규약).

  // ───────────── Z1 (L0) ─────────────
  {
    // 버스정류장 쉘터 안쪽 벤치. 기둥 4본이 x −60~−56 · y 23.4~25.4 를 두른다.
    // 스폰(−58, 24)에서 1.5m — **첫 아이템은 출발선에서 보여야 한다**(P3 튜토리얼의 전제)
    id: 'Z1-ITM05',
    kind: 'pickup',
    x: -56.9, y: 24.4, z: FLOOR.L0 + 0.5,
    label: '무선이어폰',
    gives: 'I-05',
    once: true,
  },

  // ───────────── Z2 (B1) ─────────────
  {
    // 카페 `OBJ-18-CAFE` 파사드 x 27~32 · y 25.7. 마스크(편의점)와 같은 규칙으로
    // 파사드 앞 0.15m 띠에 둔다 — 유리 안쪽이면 반사판 너머라 안 읽힌다
    id: 'OBJ-18-COFFEE',
    kind: 'buy',
    x: 29.5, y: 25.55, z: FLOOR.B1 + 0.9,
    label: '텀블러 커피 (700원)',
    gives: 'I-07',
    cost: 700,
    needReason: '돈이 부족하다',
    once: true,
  },
  {
    // 신문 가판대 `OBJ-17-NEWSSTAND` at(32, 4.6, 2.6, 1.4) → 남쪽 면 y 3.9.
    // 카운터 높이(1.0m)에 올린다. 바닥에 누이면 2.6m 앞에서 픽셀 몇 개다(우산에서 배웠다)
    id: 'OBJ-17-PAPER',
    kind: 'pickup',
    x: 32, y: 3.85, z: FLOOR.B1 + 1.0,
    label: '신문지',
    gives: 'I-08',
    once: true,
  },
  {
    // 유실물센터 `OBJ-13-LOST` at(50, 23.6, 3.0, 1.2) → 남쪽 면 y 23.0. 그 앞에 놓인 캐리어.
    // 창구(아래 OBJ-13-RETURN)와 **1.8m 떨어뜨린다** — 붙여 두면 조준이 둘 사이에서 흔들린다
    id: 'OBJ-13-BAG',
    kind: 'pickup',
    x: 48.4, y: 22.6, z: FLOOR.B1,
    label: '주인 없는 캐리어',
    gives: 'I-10',
    once: true,
  },
  {
    // 유실물센터 창구 — 지갑을 맡기면 비상게이트가 열린다 (GDD 부록 A 시크릿 3)
    id: 'OBJ-13-RETURN',
    kind: 'return',
    x: 51.2, y: 22.9, z: FLOOR.B1 + 1.0,
    label: '유실물센터 창구',
    needs: 'I-11',
    needReason: '맡길 유실물이 없다',
    once: true,
  },
  {
    // 인터폰 `OBJ-22-INTERCOM` at(58.2, 30, 0.5, 0.5) → 남쪽 면 y 29.75 (GDD 시크릿 8)
    id: 'OBJ-22',
    kind: 'call',
    x: 58.2, y: 29.4, z: FLOOR.B1 + 0.9,
    label: '역무원 호출 인터폰',
    once: true,
  },
  {
    // 화장실 (OBJ-14) — 계단통(x 14.6)과 편의점(x 21.5) 사이 북쪽 벽면. E-13 트리거
    id: 'OBJ-14-WC',
    kind: 'enter',
    x: 18.5, y: 25.55, z: FLOOR.B1 + 0.9,
    label: '화장실',
    once: true,
  },
  {
    // 벤치 `OBJ-11-BENCH` at(44.6, 24.73) **밑**. GDD 부록 A 시크릿 2번의 자리다 —
    // 앉는 면(0.9m) 아래라 서서 보면 안 보이고, 가까이 가야 아웃라인이 뜬다
    id: 'OBJ-11-WALLET',
    kind: 'pickup',
    x: 44.6, y: 24.2, z: FLOOR.B1 + 0.15,
    label: '유실물 지갑',
    gives: 'I-11',
    once: true,
  },
  {
    /**
     * 노선도 `OBJ-15-MAP` — **Z2 남쪽 벽**(y=0) 에 붙인다 (디렉터 지시 2026-08-06).
     *
     * 예전 자리는 안내판 `OBJ-15-BOARD` 남쪽 면(26, 15.4)이었다. 안내판 표면과 종이가
     * 같은 톤이라 **벽 무늬로 읽혔다**. 우산꽂이(38, 5) 쪽 동선으로 옮긴다.
     *
     * 좌표 근거: 디렉터가 준 지점은 (42.5, 5.1, −6.0) — 사람이 서 있던 자리다.
     * 거기서 가장 가까운 벽면은 남쪽 `ST_WALL`(레이캐스트 실측 y=0, 5.1m 앞)이라
     * **x 만 그대로 두고 그 벽에 붙였다.** 벽에서 6cm 띄운다(z-fighting 회피).
     * 높이는 눈높이 1.5m — 서서 읽는 게시물의 높이다.
     */
    id: 'OBJ-15-MAP',
    kind: 'pickup',
    x: 42.5, y: 0.06, z: FLOOR.B1 + 1.5,
    label: '노선도',
    gives: 'I-13',
    once: true,
    // 인쇄면이 **북쪽**(대합실 쪽)을 본다. 기본 각이면 벽에서 45° 떠 보인다
    faceYaw: Math.PI,
    // 0.082 m × 7 = 0.57 m — 역에 붙은 노선도판의 실제 폭 대역이다
    propScale: 7,
    backlit: true,
  },

  // ───────────── Z4 (B1→B2) ─────────────
  {
    // 계단 `OBJ-25` rect[95.8, 4.2, 120, 9.2] 의 중간참. x=108 에서 z 는 선형 보간으로 −13.06
    id: 'OBJ-25-EMP',
    kind: 'pickup',
    x: 108, y: 6.7, z: -12.9,
    label: 'EMP 폭탄',
    gives: 'I-14',
    once: true,
  },

  // ───────────── Z5 (B2) ─────────────
  {
    // 환승계단 `OBJ-34-XFER` [138, 0.4, 142.6, 6.0] 남쪽 입구. E-08 트리거
    id: 'OBJ-32-XPASS',
    kind: 'enter',
    x: 140.3, y: 1.0, z: FLOOR.B2,
    label: '반대편 승강장 통로',
    once: true,
  },

  // ───────────── 바닥 동전 6개 (I-02) ─────────────
  // 슬롯을 안 먹으므로 **줍는 데 판단이 없다.** 대신 경로에서 살짝 비껴 둔다 —
  // 기둥(x 12/24/36/48 × y 10/20)과 유도선(y 14 축)을 피한 자리들이다.
  ...([[6, 12], [18, 12], [30, 20], [34, 8], [46, 12], [52, 20]] as const).map(
    ([x, y], i): Interactable => ({
      id: `ITM-02-${i + 1}`,
      kind: 'pickup',
      x, y, z: FLOOR.B1 + 0.05,
      label: '동전',
      gives: 'I-02',
      once: true,
    }),
  ),
]

/** 바닥 동전인가 — 습득 시 슬롯이 아니라 잔액으로 간다 */
export const isCoin = (id: string): boolean => id.startsWith('ITM-02-')

/** 문자열 → 32bit — 대상별 독립 시드를 만든다 (`systems/qte.ts` 와 같은 수법) */
const hash = (str: string): number => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * 동전 1개의 가치. 시드 × 대상 id 로 결정된다 —
 * **6개 합계는 보장하지 않는다.** 잔액 하한 보장은 자판기(`coinPlan`)의 몫이고,
 * 동전까지 보장에 넣으면 "동전을 다 주우면 반드시 통과"가 되어 자판기가 무의미해진다.
 */
export const coinValue = (seed: number, id: string): number => {
  const rng = makeRng((seed ^ hash(id)) >>> 0)
  const steps = Math.floor((COIN.max - COIN.min) / COIN.step) + 1
  return COIN.min + rng.int(0, steps) * COIN.step
}

export const byId = (id: string): Interactable | null =>
  INTERACTABLES.find((i) => i.id === id) ?? null

/** 자판기인가 — QTE 라우팅용 */
export const isVending = (id: string): id is VendingId =>
  (VENDING_IDS as readonly string[]).includes(id)
