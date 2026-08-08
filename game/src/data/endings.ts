/**
 * 엔딩 데이터 — 우선순위 내림차순 조건식 배열 (GDD §9.4).
 * 위에서부터 첫 매치를 채택한다. **P1은 6종**, P2에서 16종까지 항목만 추가한다.
 *
 * 조건식은 전부 **단일 비교식**으로 유지한다. 복합 조건(E-05 TRUE)은 P2까지 미룬다 —
 * 4축 채점이 막 들어온 단계에서 복합식을 섞으면 어느 축이 엔딩을 결정했는지 못 읽는다.
 */

import { TRAIN } from './tuning'
import { QUEUE_MARKERS } from './world'
import type { EndingId, GameState } from '../state/types'

export type EndingDef = Readonly<{
  id: EndingId
  priority: number
  title: string
  /** GDD 부록 B — 엔딩별 마지막 대사 */
  line: string
  /** 실패 계열은 힌트를 1줄 준다. 조롱 금지 (GDD §11) */
  hint?: string
  tone: 'success' | 'fail' | 'hidden'
  when: (s: GameState) => boolean
  /**
   * 왜 이 엔딩이 나왔는가 — 엔딩 카드 1줄 (P2).
   * 복합 조건(E-05)이 들어오면서 필요해졌다. 조건식을 노출하는 대신 **충족한 값**을 보여 준다.
   */
  reason?: (s: GameState) => string
}>

/**
 * 가장 앞 대기줄(3-1)에서 탔는가 — E-03 "앉아서 간다".
 *
 * 승차위치는 `QUEUE_MARKERS[0]` 이고 탑승 문은 `boardedDoorX` 다.
 * 3m 는 문 간격(16m)의 1/5 이라 옆 문과 헷갈릴 여지가 없다.
 */
const boardedAtFirstQueue = (s: GameState): boolean =>
  s.boardedDoorX !== null && Math.abs(s.boardedDoorX - QUEUE_MARKERS[0].x) <= 3

/** 실패 계열 공용 힌트 풀 — 매번 다른 한 줄이 나온다. 전부 "다음에 뭘 보면 되는지"만 말한다. */
export const FAIL_HINTS: readonly string[] = [
  '게이트 위 램프가 초록이면 살아있는 거다.',
  '대합실 안내 LED가 고장난 게이트 번호를 알려줄 때가 있다.',
  '계단이 에스컬레이터보다 두 배 빠르다.',
  '문은 타이머가 0이 되고 나서도 1.2초 더 열려 있다.',
  '고장난 게이트에 태그하면 8초가 날아간다. 램프를 먼저 봐라.',
  // ── P1 추가 3줄 ──
  '할아버지에게 말을 걸면 고장난 게이트를 알려준다.',
  '자판기는 세 대 있다. 하나만 긁고 갈 이유가 없다.',
  '훔치면 빠르다. 빠른 만큼 뒤에서 따라온다.',
  // ── P2 추가 5줄 ──
  '벤치 밑에 누가 지갑을 흘리고 갔다.',
  '이어폰을 끼면 말 거는 사람이 안 보인다. 대신 안내방송도 안 들린다.',
  '젖은 바닥은 걸어서 지나면 안 미끄러진다.',
  '개찰구 북쪽 끝에 문이 하나 더 있다.',
  '슬롯은 세 칸인데 주울 것은 열한 가지다.',
]

/**
 * ★ 우선순위는 GDD §9.4 그대로다. **E-10이 E-04·E-02보다 위인 것이 핵심이다** —
 *   훔치고 제때 탔어도 양심이 −3이면 양심 파산이 뜬다. 탑승을 취소하지는 않는다
 *   (즉사는 E-09·E-11 둘뿐이고 둘 다 P2다).
 */
export const ENDINGS: readonly EndingDef[] = [
  {
    /**
     * ⭐ TRUE 엔딩 — 이 게임에서 **유일한 복합 조건**이다.
     *
     * P1이 미룬 이유(*"어느 축이 엔딩을 결정했는지 못 읽는다"*)는 4축 채점이 막 들어온
     * 시점의 이야기였다. 지금은 4축이 전부 실측으로 움직이는 것을 확인했으므로 켠다.
     * 대신 **결정 요인을 엔딩 카드에 1줄로 적는다**(`reason`) — 못 읽는 문제를 조건을
     * 숨기는 대신 드러내는 쪽으로 푼다.
     */
    id: 'E-05',
    priority: 100,
    title: '지하철 마스터',
    line: '이 역은, 내가 제일 잘 안다.',
    tone: 'hidden',
    when: (s) =>
      s.boarded &&
      s.timeLeftMs >= 60_000 &&
      s.scores.conscience >= 3 &&
      s.tally.itemsUsed.length >= 4 &&
      s.chase.hitCount === 0,
    reason: (s) =>
      `잔여 ${Math.round(s.timeLeftMs / 1000)}s · 양심 +${s.scores.conscience}` +
      ` · 아이템 ${s.tally.itemsUsed.length}종 · 무피격`,
  },
  {
    id: 'E-14',
    priority: 90,
    title: '동전 부자',
    line: '오늘은 커피도 한 잔 사자.',
    tone: 'hidden',
    // GDD §9.4 발췌의 `coinsEarned>=3000` 그대로. 자판기 3대를 다 긁어야 도달한다
    when: (s) => s.boarded && s.tally.coinsEarned >= 3000,
  },
  {
    /**
     * 🕊️ 히든 굿엔딩 — **열차를 놓친 사람에게 주는 유일한 보상이다.**
     * `!boarded` 가 조건에 들어가는 것이 핵심이다. GDD §9.4: *"실패했지만 역무원이 급행 안내."*
     *
     * ■ ★ 세 번째 항 `SEAT_YIELDED` 를 뺐다 — **그 플래그를 켜는 코드가 없다.**
     *
     * 리포 전체에서 그 문자열은 `state/types.ts` 의 선언과 여기 조건, **두 곳뿐**이다.
     * 임산부 배려석 상호작용 자체가 게임에 없다 — `InteractKind` 12종 어디에도 없고
     * NPC·좌표·대화 어느 것도 붙어 있지 않다. 나머지 다섯 플래그는 전부 발행처가
     * 있는데(`interact.ts`·`staff.ts`·`train.ts`) 이것 하나만 0곳이다.
     *
     * 그래서 이 엔딩은 **실제 플레이로 도달할 수 없었다.** 유닛 테스트가 통과한 건
     * 플래그를 배열에 직접 넣기 때문이다 — 판정기는 맞았지만 그 상태에 이르는
     * 길이 없었다. 없는 조건을 지운다. 배려석 상호작용은 NPC·좌표·대화가 붙는
     * 별건이고, 그 전까지 엔딩 하나를 죽여 둘 이유가 없다.
     *
     * 배려석이 생기면 항을 여기 되돌리면 된다. 선언은 `types.ts` 에 남겨 뒀다.
     */
    id: 'E-12',
    priority: 85,
    title: '오늘도 평화로운 역',
    line: '가끔은, 늦어도 괜찮다.',
    tone: 'hidden',
    when: (s) =>
      !s.boarded &&
      s.flags.includes('WALLET_RETURNED') &&
      s.flags.includes('GRANDPA_HELPED'),
  },
  {
    id: 'E-11',
    priority: 84,
    title: '에스컬레이터 참사',
    line: '…뒤를 돌아보지 말자.',
    hint: '우산은 길을 여는 물건이지 미는 물건이 아니다.',
    tone: 'fail',
    // GDD §9.4 "우산으로 인파 밀기 3회 이상". 즉사 2종 중 하나 — 명백한 고의 행동이다
    when: (s) => s.tally.pushes >= 3,
  },
  {
    /**
     * 부정승차 적발 — **역무원이 직접 낸다**(`systems/staff.ts`).
     * 여기 조건이 플래그 하나인 이유: 적발은 상태가 아니라 **사건**이다.
     * `FARE_EVADED` 만 보면 도망친 사람까지 잡히고, 그건 유예 0.8초를 무의미하게 만든다.
     */
    id: 'E-09',
    priority: 83,
    title: '부정승차 적발',
    line: '…과태료가 서른 배랍니다.',
    hint: '비상문은 열려 있어도 요금은 따로다. 잔액이 있으면 자동으로 낸다.',
    tone: 'fail',
    when: (s) => s.flags.includes('BUSTED'),
  },
  {
    id: 'E-10',
    priority: 80,
    title: '양심 파산',
    line: '다들 왜 이렇게 쳐다보지.',
    hint: '훔치면 빠르다. 빠른 만큼 뒤에서 따라온다.',
    tone: 'fail',
    // 효자손 절도(−3) 단독으로도 도달한다 (GDD §6.2).
    // **즉사 2종(E-09·E-11)보다 아래다** — 그 자리에서 끝난 판을 나중 집계가 덮으면 안 된다
    when: (s) => s.scores.conscience <= -3,
  },
  {
    id: 'E-13',
    priority: 70,
    title: '해방',
    line: '이건 이거대로 승리다.',
    tone: 'hidden',
    // 열차는 갔지만 인간은 자유로워졌다 — 탑승했으면 이 엔딩이 아니다
    when: (s) => !s.boarded && s.flags.includes('TOILET_USED'),
  },
  {
    id: 'E-08',
    priority: 60,
    title: '반대편 탑승',
    line: '…어? 여기 어디지?',
    hint: '환승 통로는 건너가면 반대 방향이다. 3정거장 뒤에 깨닫는다.',
    tone: 'fail',
    when: (s) => s.boarded && s.flags.includes('OPPOSITE_SIDE'),
  },
  {
    id: 'E-03',
    priority: 50,
    title: '앉아서 간다',
    line: '오늘 하루는 잘 풀릴 것 같다.',
    tone: 'success',
    // "승차줄 1번" — 가장 앞 대기줄(3-1)에서 탔는가. 문 위치로 판정한다
    when: (s) => s.boarded && s.timeLeftMs >= 45_000 && boardedAtFirstQueue(s),
    reason: (s) => `잔여 ${Math.round(s.timeLeftMs / 1000)}s · 3-1 승차위치`,
  },
  {
    /**
     * ⏱ JUST IN TIME — **닫히는 문에 몸을 밀어 넣었는가.**
     *
     * 조건이 `timeLeftMs <= 1000` 이었다. 그건 "3분 예산을 다 썼는가"이지
     * "아슬아슬하게 탔는가"가 아니다. 둘은 같은 값이 아니다:
     *
     *  · 게이트 페널티(`TIME_PENALTY`)로 `timeLeftMs` 만 따로 깎인다 — 문은 그대로인데
     *    화면상으로는 다 쓴 판이 된다
     *  · 위치 트리거를 밟으면 열차가 70초에도 온다(`trainClock`). 여유롭게 걸어 들어가도
     *    `timeLeftMs` 는 110초나 남아 있고, 반대로 트리거를 안 밟으면 172초까지 문이
     *    아예 안 열린다 — 어느 쪽도 "아슬아슬"과 무관하다
     *
     * 그래서 **탑승 순간 문이 닫히기까지 남아 있던 시간**(`boardedCloseInMs`)으로 잰다.
     * 그 값은 `systems/train.ts` 가 탄 프레임에 적어 둔다 — 엔딩이 판정되는 시점
     * (열차가 떠난 뒤)에는 이미 되살릴 수 없는 사실이기 때문이다.
     *
     * `<= 0` 은 닫히기 시작한 뒤 0.775초 안에 밀고 들어간 경우다. 같은 부등식이 덮는다.
     */
    id: 'E-04',
    priority: 40,
    title: '문틈 낑김',
    line: '가방이… 가방이 안 빠진다.',
    tone: 'success',
    when: (s) => s.boardedCloseInMs !== null && s.boardedCloseInMs <= TRAIN.justInTimeMs,
  },
  {
    id: 'E-02',
    priority: 30,
    title: '여유로운 출근',
    line: '오늘은 좀 이르다.',
    tone: 'success',
    when: (s) => s.boarded && s.timeLeftMs >= 30_000,
  },
  {
    id: 'E-01',
    priority: 10,
    title: '아슬아슬 탑승',
    line: '…겨우 탔다.',
    tone: 'success',
    when: (s) => s.boarded,
  },
  {
    id: 'E-07',
    priority: 5,
    title: '지각 확정',
    line: '오늘은 아무래도 글렀다.',
    hint: '급할수록 정직한 쪽이 빠르다. 실측으로 19초 차이가 난다.',
    tone: 'fail',
    // E-06(온화한 실패)과 갈리는 지점은 **양심 하나**다. GDD §9.4
    when: (s) => !s.boarded && s.scores.conscience < 0,
  },
  /**
   * 강제 엔딩 4종(E-15·E-16·E-17·E-18) — `when` 이 **항상 거짓**이다.
   *
   * `resolveEnding` 은 열차 출발 경로에서만 쓰인다(`systems/tick.ts:124-128`).
   * 넷 다 시스템이 `{ t: 'END', endingId }` 로 직접 발행하므로 조건식이 필요 없다.
   * 참이 될 수 있으면 열차 출발 시 오검출되므로 거짓으로 고정하고, `priority` 는
   * 선택에 관여하지 않으니 그 값의 유일한 역할은 정렬·유일성 불변식을 지키는 것이다 —
   * 그래서 실제 엔딩과 절대 경합하지 않는 자리, fallback(E-06) 바로 위 최하단에 둔다.
   */
  {
    id: 'E-15',
    priority: 4,
    title: '이걸 누가 먹어',
    line: '"이놈아, 내가 이런 걸 먹게 생겼냐?"',
    hint: '벤치 근처 바닥을 살펴보면 뭘 드셨는지 알 수 있다.',
    tone: 'fail',
    when: () => false,
  },
  {
    id: 'E-16',
    priority: 3,
    title: '딱!',
    line: '눈앞이 하얘졌다.',
    // "두 대까지"는 "두 대를 맞아도 괜찮다"로 잘못 읽힌다 — 실제로는 두 번째가 즉사다.
    // 살아남는 수는 "안 맞는다"뿐이라는 걸 분명히 한다.
    hint: '단소는 두 번째로 맞으면 그걸로 끝이다. 개찰구를 넘으면 멈추신다.',
    tone: 'fail',
    when: () => false,
  },
  /**
   * 강제 엔딩 3번째 — 개찰구 매복(`systems/ambush.ts`). 위 두 개(E-15·E-16)와 같은 이유로
   * `when` 이 항상 거짓이다: `EARBUDS_STOLEN` 플래그 + x≥57 트리거는 `resolveEnding` 이 아니라
   * `ambushSystem` 이 직접 `{ t: 'END', endingId: 'E-17' }` 로 낸다.
   */
  {
    id: 'E-17',
    priority: 2,
    title: '지지직!',
    line: '눈앞이 번쩍였다.',
    hint: '주인 없는 물건은 원래 주인이 나타난다. 신고가 더 안전하다.',
    tone: 'fail',
    when: () => false,
  },
  /**
   * 강제 엔딩 4번째 — 차에 치였다(`main.ts` 의 `roadHazard` 판정).
   * 적신호 차단벽을 걷어낸 뒤로 차선이 진짜 위험이 됐다는 것을 결과로 보여준다
   * (`data/world.ts` "막는 대신 결과로 막는다"). 위 셋과 같은 이유로 `when` 이 항상 거짓이다:
   * `main.ts` 가 `carHits` 판정에서 직접 `{ t: 'END', endingId: 'E-18' }` 을 낸다.
   */
  {
    id: 'E-18',
    priority: 1,
    title: '쾅!',
    line: '몸이 붕 떴다가, 그대로 아스팔트에 멈췄다.',
    hint: '차선 위에 서 있지 마라. 신호는 몸을 지켜주지 않는다.',
    tone: 'fail',
    when: () => false,
  },
  {
    id: 'E-06',
    priority: 0,
    title: '다음 열차',
    line: '5분 늦는다고 세상 안 무너져.',
    tone: 'fail',
    when: () => true,          // fallback — 항상 매치
  },
]

/**
 * 우선순위 정렬은 **모듈 로드 시 한 번**만 한다.
 *
 * 예전엔 `resolveEnding` 이 매 호출마다 `.sort()` 를 했다. 6종이면 비용은 무해하지만
 * **엔딩 화면이 매 프레임 이 함수를 부른다**(`ui/screens.ts`). 16종이 되면 그게 그대로 쌓인다.
 */
const BY_PRIORITY: readonly EndingDef[] = [...ENDINGS].sort((a, b) => b.priority - a.priority)

export const resolveEnding = (s: GameState): EndingDef => {
  for (const e of BY_PRIORITY) {
    if (e.when(s)) return e
  }
  // ENDINGS 마지막 항목이 fallback이므로 도달 불가. 타입 안전을 위해서만 존재.
  throw new Error('no ending matched — fallback missing')
}

export const pickHint = (seed: number): string =>
  FAIL_HINTS[Math.abs(seed) % FAIL_HINTS.length] as string
