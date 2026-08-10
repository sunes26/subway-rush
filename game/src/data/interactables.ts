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

import { ESCALATOR, FLOOR, rampZAt } from './world'
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
  | 'enter'     // 문을 열고 들어간다 1.2s (화장실 · 반대편 승강장)
  | 'inspect'   // 살펴본다 0.8s · 이동 가능 · 획득 없음

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
  /** needs 미충족 시 사유 1줄 — 디렉터 지시로 정확한 아이템명 대신 두루뭉실한 힌트를 준다 */
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
   * 프롭을 눕히거나 뒤집는 각(rad, 모델 로컬 X축). 없으면 0 — 세워 둔다.
   *
   * `faceYaw` 만으로는 **위아래를 못 고친다.** 아이템 메시의 원점과 방향은
   * "손에 들었을 때" 기준으로 저작돼 있어서(`tools/items_build.py` ITM-09 주석:
   * *원점을 손잡이 쥐는 자리에 둔다*), 바닥·꽂이에 놓는 순간 방향이 뒤집히는 것이 있다.
   * 우산이 그랬다 — 손잡이가 통 속에 박히고 뾰족한 끝(페룰)이 하늘을 봤다.
   */
  propPitch?: number
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

/**
 * 붕어빵 아저씨 — 무선이어폰(I-05)의 **유일한** 획득처(디렉터 지시, 완전 대체).
 * `OBJ-03-CART` 솔리드(카트) 바로 뒤에 세운다 — 좌표는 `render/actors.ts`가
 * `byId`로 그대로 읽는다(면 방향 규약: 좌표를 여기서 새로 만들지 않는다).
 */
export const FISHCAKE_ID = 'OBJ-03-FISHMAN'

/**
 * 붕어빵 아저씨 인사말 — **클릭으로 한 줄씩** 넘어간다(디렉터 지시).
 * 마지막 줄에서만 선택지가 뜬다 — `systems/interact.ts`·`ui/dialog.ts`가 이 배열
 * 하나를 같이 읽는다(길이가 곧 "몇 번 클릭해야 선택지가 뜨는가"다).
 */
export const FISHCAKE_GREETING: readonly string[] = [
  '"어이, 거기 학생. 길 잃었나?"',
  '"…홍대입구역 말인가? 저짝으로 쭉 가면 나올 거네."',
  '"그나저나… 아까 누가 놓고 갔는지, 여기 신형 무선이어폰이 하나 떨어져 있더라고. ' +
    '이거 참, 어찌해야 되나 모르겠네."',
]

/**
 * 선택 후 반응 — 골라도 대화창은 안 닫힌다. 이 대사를 한 번 더 보여준 뒤
 * 클릭해야 닫힌다(`state.act.dialogChoice`) — 토스트로 따로 뜨면 방금 읽던
 * 대화창과 끊겨 보인다(디렉터 지적).
 */
export const FISHCAKE_REACTION: Readonly<Record<1 | 2, string>> = {
  1: '"…음, 그런가. 그럼 자네가 가지고 가게."',
  2: '"허허, 역시 그렇지. 사실 이건 내 거라네. 자네 양심이 어떤가 한번 떠본 걸세. ' +
    '자네는 내 시험을 통과했어. 이건 그 보상이네."',
}

// ═══════════════ 역무원 — 인터폰(OBJ-22) · 순찰(ACT-08) ═══════════════
//
// 둘은 **같은 사람**이다. 인터폰 너머의 목소리가 개찰구 안쪽을 도는 그 역무원이고,
// 그래서 인터폰에서 어떻게 굴었는지가 나중에 마주쳤을 때 인사말로 돌아온다
// (디렉터 지시 2026-08-10: "대화 결과에 따라 다음 상호작용 반응이 달라야 한다").
//
// 상태는 플래그 두 장으로만 센다.
//   · `INTERCOM_DENIED` — 한 번 거절당했다 (거짓말했거나 재촉했거나)
//   · `INTERCOM_RUDE`   — 그중 **재촉·반말** 쪽이었다. 거절 사유가 다르면 대사도 달라야 한다
// 열어 줬는지는 `EMERGENCY_OPEN` 이 이미 안다 — 플래그를 하나 더 만들면 두 진실이 갈린다.

export const INTERCOM_ID = 'OBJ-22'

/**
 * 순찰 역무원(ACT-08) — **테이블에 좌표가 없다.**
 *
 * 위치가 `systems/staff.ts staffAt(elapsedMs)` 의 함수라 정적 표에 못 적는다.
 * `systems/interact.ts` 가 매 프레임 후보를 만들어 넣는다(`patrolStaffTarget`).
 * 여기서는 **id 와 라벨만** 원천으로 둔다 — `ui/dialog.ts` 가 이름을 여기서 읽는다.
 */
export const PATROL_STAFF_ID = 'ACT-STAFF'
export const PATROL_STAFF_LABEL = '역무원'

/** 인터폰 상태 — 대사·분기가 모두 이 넷 중 하나로 갈린다 */
export type IntercomMood = 'fresh' | 'opened' | 'denied' | 'rude'

export const intercomMood = (flags: readonly string[]): IntercomMood =>
  flags.includes('EMERGENCY_OPEN') ? 'opened'
    : flags.includes('INTERCOM_RUDE') ? 'rude'
      : flags.includes('INTERCOM_DENIED') ? 'denied'
        : 'fresh'

export const INTERCOM_GREETING: Readonly<Record<IntercomMood, string>> = {
  fresh: '"…네, 홍대입구역 통제실입니다. 무슨 일이시죠?"',
  opened: '"아까 그 승객분이시죠. 비상문은 열어 뒀습니다 — 얼른 가세요."',
  denied: '"…아까 그분이시네요. 단말기는 정상으로 확인됐습니다만."',
  rude: '"………(잠시 침묵) …또 무슨 일이십니까."',
}

/**
 * 선택 후 반응. 붕어빵 아저씨와 같은 규약이다 — 고른 뒤 대화창을 바로 닫지 않고
 * 이 대사를 한 번 더 보여준다. 상대가 뭐라고 답했는지가 이 상호작용의 결과 자체다.
 *
 * `fresh` 3지 중 **1번만 문을 연다.** 나머지 둘은 이유가 서로 달라서(둘러댐 / 재촉)
 * 다음 인사말이 갈린다.
 */
export const INTERCOM_REACTION: Readonly<Record<IntercomMood, Readonly<Record<1 | 2 | 3, string>>>> = {
  fresh: {
    1: '"…네. 지금 열어 드리겠습니다. 다음부터는 역무실로 오세요."',
    2: '"단말기요? …잠시만요, 확인 좀 해 보고요. (뚝)"',
    3: '"승객분, 저희도 절차라는 게 있습니다. 그렇게는 못 열어 드립니다."',
  },
  denied: {
    1: '"…알겠습니다. 열어 드릴 테니 계단에서는 뛰지 마세요."',
    2: '(수화기를 내려놓았다)',
    3: '',
  },
  rude: {
    1: '"…한 번만입니다. 다음엔 안 됩니다."',
    2: '(수화기를 내려놓았다)',
    3: '',
  },
  opened: {
    1: '(수화기를 내려놓았다)',
    2: '',
    3: '',
  },
}

/**
 * 순찰 역무원 인사말 — 인터폰에서 어떻게 굴었는지를 **여기서 되돌려받는다.**
 * 순찰 구간(x 63.5~70.5)은 개찰구 안쪽이라 여기까지 왔다면 이미 문은 지난 뒤다.
 * 그래서 이 대화에는 문을 여는 선택지가 없다 — 길과 시간만 준다.
 */
export const STAFF_GREETING: Readonly<Record<IntercomMood, string>> = {
  fresh: '"네, 무슨 일이신가요?"',
  opened: '"아, 아까 인터폰 주셨던 분. 비상문 잘 지나오셨네요."',
  denied: '"…아까 단말기 고장이라고 하셨던 분 맞으시죠. 확인해 보니 멀쩡하던데요."',
  rude: '"…아까 인터폰에 대고 소리치시던 분이군요. 무슨 일이십니까."',
}

/** `2` 번 길 안내는 반대 방면 승강장의 존재를 알려 준다 — 실제로 쓸모가 있는 정보다 */
export const STAFF_REACTION: Readonly<Record<1 | 2 | 3, string>> = {
  1: '',    // 남은 시간을 읽어 주는 대사라 상태가 필요하다 — `staffTimeLine()` 이 만든다
  2: '"직진하시면 신도림 방면, 게이트 지나 북쪽으로 꺾으면 신촌 방면입니다."',
  3: '"예, 조심히 가세요."',
}

/** 자판기 3대 — `OBJ-06/07/08-VEND*` 솔리드 중심과 **같은 좌표**다 */
export const VENDING_IDS = ['OBJ-06', 'OBJ-07', 'OBJ-08'] as const
export type VendingId = (typeof VENDING_IDS)[number]

/** O-03 인파벽 3인 — 순서가 곧 x 순서다(앞사람부터 비켜야 한다) */
export const CP_IDS = ['ACT-CP', 'ACT-CP2', 'ACT-CP3'] as const

export const INTERACTABLES: readonly Interactable[] = [
  // ───────────── Z1 (L0) ─────────────
  /**
   * 붕어빵 노점(`OBJ-03-CART`) 자체는 여전히 배경 소품이다(v0.3 그대로) — P1 때
   * `I-12`를 팔던 매대 기능은 되살리지 않는다. 대신 카트 뒤에 아저씨를 세운다:
   * 무선이어폰(I-05)의 유일한 획득처(`branchesFor`의 `fishcakeBranches` 참고).
   * 카트 솔리드(`at(-50, 32, 2.4, 1.6)`) 뒤쪽(북쪽, 벽 방향)에 서서 남쪽(열린 인도)을 본다 —
   * 편의점 점원(`CLERK_POS`)과 같은 "카운터 뒤에 서서 손님을 본다" 배치다.
   */
  {
    id: FISHCAKE_ID,
    kind: 'talk',
    x: -50, y: 33.0, z: FLOOR.L0,
    label: '붕어빵 아저씨',
    once: true,
  },

  // ───────────── Z2 (B1) ─────────────
  {
    id: GRANDPA_ID,
    kind: 'talk',
    x: 42, y: 14.9, z: FLOOR.B1,
    label: '할아버지',
    once: true,           // 효자손을 한 번 넘기면 끝이다
  },
  /**
   * 바닥 양갱 3개 — **정답 힌트다.**
   *
   * 벤치(42, 14.9) 남쪽 통행 구역에 흩는다. 벤치 솔리드
   * `ACT-02-BENCH` = rect[40.8, 14.6, 43.2, 15.4] 밖이어야 하므로 y 를 14.6 아래로 둔다.
   * 서로 0.6m 이상 떨어뜨려 상호작용이 서로를 가리지 않게 한다.
   *
   * 하나가 아니라 셋인 이유는 문구가 "포장이 여럿"이기 때문이다 —
   * 하나만 두면 화면과 말이 어긋나고 우연으로 읽힌다.
   */
  {
    id: 'OBJ-19-HINT1', kind: 'inspect',
    x: 41.4, y: 13.9, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
  {
    id: 'OBJ-19-HINT2', kind: 'inspect',
    x: 42.6, y: 13.6, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
  {
    id: 'OBJ-19-HINT3', kind: 'inspect',
    x: 43.3, y: 14.2, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
  {
    id: 'OBJ-06',
    kind: 'scratch',
    x: 13.03, y: 4.15, z: FLOOR.B1,
    label: '자판기 A',
    needs: 'I-01',
    needReason: '효자손을 쥐고 있어야 가능할 것 같다',
    once: true,
  },
  {
    id: 'OBJ-07',
    kind: 'scratch',
    x: 21.63, y: 4.15, z: FLOOR.B1,
    label: '자판기 B',
    needs: 'I-01',
    needReason: '효자손을 쥐고 있어야 가능할 것 같다',
    once: true,
  },
  {
    id: 'OBJ-08',
    kind: 'scratch',
    x: 25.93, y: 4.15, z: FLOOR.B1,
    label: '자판기 C',
    needs: 'I-01',
    needReason: '효자손을 쥐고 있어야 가능할 것 같다',
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
    // 뒤집어 꽂는다 — 페룰(뾰족한 끝)이 통 속으로, J갈고리가 위로. 실제 우산꽂이가 그렇다.
    // 메시는 손에 든 상태 기준으로 저작돼 있어(갈고리 아래·끝 위) 그대로 세우면 거꾸로다.
    propPitch: Math.PI,
    once: true,
  },
  {
    /**
     * 편의점 선물 매대 — 파사드 y 는 슬랩 25.4 와 유리벽 25.7 사이.
     *
     * 마스크는 여기 없다(디렉터 지시) — 물리 진열대(`OBJ-19-MASK`)로 따로 살 수 있던
     * 걸 없앴다. 편의점 상점 대화(`branchesFor` 의 6번 칸, `maskBranch`)가 유일한
     * 구매처다 — 두 곳에서 같은 걸 팔면 헷갈린다는 지적으로 하나로 합쳤다.
     */
    id: GIFT_STALL_ID,
    kind: 'talk',
    x: 26.0, y: 25.55, z: FLOOR.B1,
    label: '편의점 상품 구매',
    once: false,
  },

  // ───────────── Z4 (B1) ─────────────
  /**
   * O-03 에스컬레이터 인파벽 — **3인 1열** (P2에서 복원).
   *
   * P1은 1인으로 축약했다(`docs/P1-TECH-PLAN.md` §4 의 빚 목록). 1인이면 우산 한 번으로
   * 끝나서 E-11("우산으로 밀기 3회")이 **도달 불가**였고, 15초 정체라는 GDD 의 실패 비용도
   * 나오지 않았다. 진입부를 따라 x 로 늘어세운다 — 통로가 좁아 옆으로 못 지난다.
   *
   * ⚠ z 는 **에스컬레이터 경사면에서 잰다.** `FLOOR.B1` 로 적어 뒀더니 셋이 공중에 떴다 —
   *   램프는 x 95.8 에서 이미 내려가기 시작하므로 이 셋(96.6·97.8·99.0)의 발밑은
   *   −6.46 · −7.16 · −7.85 다. 값 차이가 x 를 따라 커져서 **뒤에 선 사람일수록 더 높이**
   *   떠 보였다(디렉터 지적 2026-08-10). 이 z 는 렌더(`render/actors.ts anchorOf`) ·
   *   우산 훑기(`systems/umbrella.ts` 의 층 검사) · 미니맵이 전부 같이 읽는다.
   */
  ...([96.6, 97.8, 99.0] as const).map((x, i): Interactable => ({
    id: CP_IDS[i] as string,
    kind: 'aside',
    x, y: 2.2, z: rampZAt(ESCALATOR, x, 2.2) ?? FLOOR.B1,
    label: i === 0 ? '캐리어 든 승객' : i === 1 ? '이어폰 낀 승객' : '장바구니 든 승객',
    once: true,
  })),

  // ═══════════════ P2 신규 ═══════════════
  // 좌표는 전부 `data/world.ts` 의 솔리드에서 나온다. 접근 면을 명시한다 —
  // "어느 면에서 보이는가"로 P0에서 열한 번 데었다(면 방향 규약).

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
    // 유실물센터 `OBJ-13-LOST` at(51.84, 27.5, 1.68, 2.6). 뒷면을 다목적 화장실
    // 옆 `WC-E` 벽(x51.0)에 붙이며 남향 → 동향으로 90도 돌았다(디렉터 지시) —
    // 창구는 정면(동쪽, x52.7 바깥)에 세운다. 아이템(캐리어, `OBJ-13-BAG`)은
    // 디렉터 지시로 아이템 체계째 지웠다 — 창구만 남는다.
    // 유실물센터 창구 — 지갑을 맡기면 비상게이트가 열린다 (GDD 부록 A 시크릿 3)
    id: 'OBJ-13-RETURN',
    kind: 'return',
    x: 53.0, y: 28.4, z: FLOOR.B1 + 1.0,
    label: '유실물센터 창구',
    needs: 'I-11',
    needReason: '맡길 유실물이 없다',
    once: true,
  },
  {
    /**
     * 인터폰 `OBJ-22-INTERCOM` at(58.2, 30, 0.5, 0.5) → 남쪽 면 y 29.75 (GDD 시크릿 8)
     *
     * 예전엔 `kind: 'call'` — 버튼을 0.5초 누르면 **−15초**를 물고 문이 열리는, 선택이
     * 없는 거래였다. 디렉터 지시(2026-08-10)로 시간 페널티를 걷어내고 **선택지 있는
     * 대화**로 바꿨다: 어떻게 부탁하느냐가 문이 열리는지를 가른다.
     *
     * `once: false` 인 이유가 그것이다 — 거절당했으면 **다시 걸 수 있어야** 한다.
     * 한 번만 되면 "안 열림"이 곧 되돌릴 수 없는 실패가 되고, 그건 이 게임이 방해요소에
     * 대해 지켜 온 규칙(§6.2 "벌은 주되 문은 닫지 않는다")과 정면으로 어긋난다.
     */
    id: INTERCOM_ID,
    kind: 'talk',
    x: 58.2, y: 29.4, z: FLOOR.B1 + 0.9,
    label: '역무원 호출 인터폰',
    once: false,
  },
  {
    /**
     * 화장실 (OBJ-14) — E-13 트리거.
     *
     * 예전엔 계단통(x14.6)·편의점(x21.5) 사이 북쪽 벽면에 있었다. 화장실이
     * `world.ts` "화장실 확장"으로 x36~51 구역으로 옮겨간 뒤로 이 좌표가 안 따라와서
     * **실제 문 앞에 프롬프트가 없었다.** 첫 수정은 다목적실 문(x49.9) 앞으로
     * 옮겼는데, 실측(디렉터 지시)으로는 실제 입구가 x41.0~47.4·y24.4~24.5·z−6.0 —
     * 그 중심에 다시 놓는다.
     */
    id: 'OBJ-14-WC',
    kind: 'enter',
    x: 44.2, y: 24.45, z: FLOOR.B1,
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
  // EMP 폭탄(`OBJ-25-EMP`, I-14)은 디렉터 지시로 아이템 체계째 지웠다.

  // ───────────── Z5 (B2) ─────────────
  {
    // 환승계단 `OBJ-34-XFER` [138, 0.4, 142.6, 6.0] 남쪽 입구. E-08 트리거
    id: 'OBJ-32-XPASS',
    kind: 'enter',
    x: 140.3, y: 1.0, z: FLOOR.B2,
    label: '반대편 승강장 통로',
    once: true,
  },

  // ───────────── 바닥 동전 3개 (I-02) ─────────────
  // 슬롯을 안 먹으므로 **줍는 데 판단이 없다.** 대신 경로에서 살짝 비껴 둔다 —
  // 기둥(x 12/24/36/48 × y 10/20)과 유도선(y 14 축)을 피한 자리들이다.
  // 원래 6개였다가 디렉터 지시로 절반으로 줄었다 — 지도 전역에 퍼지도록 하나씩 걸렀다.
  ...([[6, 12], [30, 20], [46, 12]] as const).map(
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
 * **3개 합계는 보장하지 않는다.** 잔액 하한 보장은 자판기(`coinPlan`)의 몫이고,
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
