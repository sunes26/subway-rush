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
}>

/**
 * ★ Z2 · 할아버지 (ACT-02).
 * `ACT-02-BENCH` 는 at(42, 15, 2.4, 0.8) — 벤치 중심이 (42, 15)다.
 * 앉은 사람은 벤치 남쪽 절반에 있으므로 y를 0.1 남쪽으로 둔다.
 */
export const GRANDPA_ID = 'ACT-02-GP'

/** 자판기 3대 — `OBJ-06/07/08-VEND*` 솔리드 중심과 **같은 좌표**다 */
export const VENDING_IDS = ['OBJ-06', 'OBJ-07', 'OBJ-08'] as const
export type VendingId = (typeof VENDING_IDS)[number]

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
    x: 38, y: 5.0, z: FLOOR.B1 + 1.0,
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

  // ───────────── Z4 (B1) ─────────────
  {
    // O-03 캐리어 승객 — 에스컬레이터 `OBJ-24` 진입부. 상세는 systems/crowd.ts
    id: 'ACT-CP',
    kind: 'aside',
    x: 96.6, y: 2.2, z: FLOOR.B1,
    label: '캐리어 든 승객',
    once: true,
  },
]

export const byId = (id: string): Interactable | null =>
  INTERACTABLES.find((i) => i.id === id) ?? null

/** 자판기인가 — QTE 라우팅용 */
export const isVending = (id: string): id is VendingId =>
  (VENDING_IDS as readonly string[]).includes(id)
