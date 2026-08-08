/**
 * 엔딩 데이터 — 우선순위 내림차순 조건식 배열 (GDD §9.4).
 * 위에서부터 첫 매치를 채택한다. **P1은 6종**, P2에서 16종까지 항목만 추가한다.
 *
 * 조건식은 전부 **단일 비교식**으로 유지한다. 복합 조건(E-05 TRUE)은 P2까지 미룬다 —
 * 4축 채점이 막 들어온 단계에서 복합식을 섞으면 어느 축이 엔딩을 결정했는지 못 읽는다.
 */

import { QUEUE_MARKERS } from './world'
import type { EndingId, GameState } from '../state/types'

export type EndingDef = Readonly<{
  id: EndingId
  priority: number
  title: string
  /**
   * 엔딩별 마지막 대사 **풀**. 시드로 하나를 고른다(`pickLine`).
   *
   * 예전엔 한 줄 고정이었다. 그런데 fallback 인 E-06 은 한 사람이 열 번도 보는
   * 엔딩이라, 열 번 다 같은 문장이 뜨면 "또 이거"가 되어 여운이 안 남는다.
   *
   * ★ **첫 항목은 GDD 부록 B 의 정본이다.** 도감(`ui/collection.ts`)은 이 칸만
   *   쓴다 — 대표 문구가 판마다 바뀌면 도감이 목록 구실을 못 한다.
   *
   * 톤은 **짧고 건조한 관찰**로 통일한다. 감상을 말하지 않고 본 것만 적으면
   * 오글거리지 않고, GDD §11 의 "조롱 금지"도 저절로 지켜진다.
   */
  lines: readonly string[]
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
    lines: [
      '이 역은 다 외웠다.',
      '눈 감고도 간다.',
      '환승 통로 길이까지 안다.',
    ],
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
    lines: [
      '커피값은 건졌다.',
      '주머니가 무겁다.',
      '자판기 위치는 다 안다.',
    ],
    tone: 'hidden',
    // GDD §9.4 발췌의 `coinsEarned>=3000` 그대로. 자판기 3대를 다 긁어야 도달한다
    when: (s) => s.boarded && s.tally.coinsEarned >= 3000,
  },
  {
    /**
     * 🕊️ 히든 굿엔딩 — **열차를 놓친 사람에게 주는 유일한 보상이다.**
     * `!boarded` 가 조건에 들어가는 것이 핵심이다. GDD §9.4: *"실패했지만 역무원이 급행 안내."*
     */
    id: 'E-12',
    priority: 85,
    title: '평화로운 역',
    lines: [
      '나 빼고.',
      '승강장에 나만 남았다.',
      '다음 거나 기다린다.',
    ],
    tone: 'hidden',
    when: (s) =>
      !s.boarded &&
      s.flags.includes('WALLET_RETURNED') &&
      s.flags.includes('GRANDPA_HELPED') &&
      s.flags.includes('SEAT_YIELDED'),
  },
  {
    id: 'E-11',
    priority: 84,
    title: '에스컬레이터 참사',
    lines: [
      '뒤는 안 봤다.',
      '아래쪽이 조용해졌다.',
    ],
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
    lines: [
      '서른 배라고 한다.',
      '역무실 의자가 딱딱하다.',
      '이름부터 적으라고 한다.',
    ],
    hint: '비상문은 열려 있어도 요금은 따로다. 잔액이 있으면 자동으로 낸다.',
    tone: 'fail',
    when: (s) => s.flags.includes('BUSTED'),
  },
  {
    id: 'E-10',
    priority: 80,
    title: '양심 파산',
    lines: [
      '다들 쳐다본다.',
      '아무도 옆에 안 선다.',
      '손잡이가 유난히 멀다.',
    ],
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
    lines: [
      '열차보다 급했다.',
      '이건 어쩔 수 없었다.',
    ],
    tone: 'hidden',
    // 열차는 갔지만 인간은 자유로워졌다 — 탑승했으면 이 엔딩이 아니다
    when: (s) => !s.boarded && s.flags.includes('TOILET_USED'),
  },
  {
    id: 'E-08',
    priority: 60,
    title: '반대로 간다',
    lines: [
      '잘 탔다. 반대로.',
      '역명이 낯설다.',
      '세 정거장 뒤에 알았다.',
    ],
    hint: '환승 통로는 건너가면 반대 방향이다. 3정거장 뒤에 깨닫는다.',
    tone: 'fail',
    when: (s) => s.boarded && s.flags.includes('OPPOSITE_SIDE'),
  },
  {
    id: 'E-03',
    priority: 50,
    title: '앉아서 간다',
    lines: [
      '자리까지 있다.',
      '두 정거장은 눈 감아도 된다.',
      '창밖이 잘 보인다.',
    ],
    tone: 'success',
    // "승차줄 1번" — 가장 앞 대기줄(3-1)에서 탔는가. 문 위치로 판정한다
    when: (s) => s.boarded && s.timeLeftMs >= 45_000 && boardedAtFirstQueue(s),
    reason: (s) => `잔여 ${Math.round(s.timeLeftMs / 1000)}s · 3-1 승차위치`,
  },
  {
    id: 'E-04',
    priority: 40,
    title: '문 닫히기 1초 전',
    lines: [
      '가방은 아직 밖이다.',
      '반은 탔다.',
      '탔다. 됐다.',
    ],
    tone: 'success',
    when: (s) => s.boarded && s.timeLeftMs <= 1000,
  },
  {
    id: 'E-02',
    priority: 30,
    title: '여유로운 출근',
    lines: [
      '한 대 일찍 왔다.',
      '앉지는 못했다.',
      '오늘은 안 뛰었다.',
      '숨 고를 시간은 있었다.',
    ],
    tone: 'success',
    when: (s) => s.boarded && s.timeLeftMs >= 30_000,
  },
  {
    id: 'E-01',
    priority: 10,
    title: '아슬아슬 탑승',
    lines: [
      '탔다. 됐다.',
      '숨이 안 쉬어진다.',
      '문이 등을 밀었다.',
    ],
    tone: 'success',
    when: (s) => s.boarded,
  },
  {
    id: 'E-07',
    priority: 5,
    title: '지각 확정',
    lines: [
      '망했다.',
      '이제 뛰어도 똑같다.',
      '변명은 가면서 생각하자.',
      '시계는 안 봐도 안다.',
    ],
    hint: '급할수록 정직한 쪽이 빠르다. 실측으로 19초 차이가 난다.',
    tone: 'fail',
    // E-06(온화한 실패)과 갈리는 지점은 **양심 하나**다. GDD §9.4
    when: (s) => !s.boarded && s.scores.conscience < 0,
  },
  /**
   * 강제 엔딩 2종 — `when` 이 **항상 거짓**이다.
   *
   * `resolveEnding` 은 열차 출발 경로에서만 쓰인다(`systems/tick.ts:124-128`).
   * 이 둘은 시스템이 `{ t: 'END', endingId }` 로 직접 발행하므로 조건식이 필요 없다.
   * 참이 될 수 있으면 열차 출발 시 오검출되므로 거짓으로 고정하고, `priority` 는
   * 선택에 관여하지 않으니 그 값의 유일한 역할은 정렬·유일성 불변식을 지키는 것이다 —
   * 그래서 실제 엔딩과 절대 경합하지 않는 자리, fallback(E-06) 바로 위 최하단에 둔다.
   */
  {
    id: 'E-15',
    priority: 4,
    title: '이걸 누가 먹어',
    lines: [
      '봉지째 돌아왔다.',
      '표정이 그게 아니었다.',
      '한참을 들고 계셨다.',
    ],
    hint: '벤치 근처 바닥을 살펴보면 뭘 드셨는지 알 수 있다.',
    tone: 'fail',
    when: () => false,
  },
  {
    id: 'E-16',
    priority: 3,
    title: '단소는 악기다',
    lines: [
      '원래는 부는 거다.',
      '소리가 좀 컸다.',
      '효자손은 손에서 떨어졌다.',
    ],
    // "두 대까지"는 "두 대를 맞아도 괜찮다"로 잘못 읽힌다 — 실제로는 두 번째가 즉사다.
    // 살아남는 수는 "안 맞는다"뿐이라는 걸 분명히 한다.
    hint: '단소는 두 번째로 맞으면 그걸로 끝이다. 개찰구를 넘으면 멈추신다.',
    tone: 'fail',
    when: () => false,
  },
  {
    id: 'E-06',
    priority: 0,
    title: '다음 열차',
    lines: [
      '봤는데 못 탔다.',
      '딱 내 앞에서.',
      '4분이나.',
      '문 닫히는 것만 봤다.',
    ],
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

/**
 * 이번 판의 대사. **시드로 고른다** — `pickHint` 와 같은 규칙이다.
 *
 * 시드 기반이라 같은 판을 다시 돌리면 같은 대사가 나온다(리플레이·e2e 가 안 깨진다).
 * 재시작은 시드를 굴리므로(`main.ts restart()`) 다음 판에는 다른 줄이 뜬다.
 *
 * 힌트와 **다른 상수로 흩는다**(`^ 0x2f1d`). 같은 시드를 그대로 쓰면 대사와 힌트가
 * 항상 같은 색인으로 묶여, 풀을 아무리 늘려도 조합이 늘지 않는다.
 */
export const pickLine = (e: EndingDef, seed: number): string =>
  e.lines[Math.abs((seed ^ 0x2f1d) >>> 0) % e.lines.length] as string
