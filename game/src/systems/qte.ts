/**
 * 자판기 하단 긁기 QTE — **P2 타이밍 바.**
 *
 * 좌우로 왕복하는 마커가 **중앙 성공 구간**에 있을 때 클릭하면 성공. 3회 성공하면 동전을 얻는다.
 *
 * P1은 GDD §5.4 그대로 "마우스 좌↔우 드래그 3회 + 리듬 판정"이었다. 바꾼 이유 둘:
 *  · 누적 이동량(px)으로 판정하니 **마우스 감도·DPI 가 난이도를 바꿨다**
 *  · 판정 이유가 화면에 없었다 — 왜 미스인지 안 보인다
 * 타이밍 바는 규칙이 게이지에 전부 그려지고, 입력이 **클릭 한 번**이라 장비를 안 탄다.
 * "마우스가 두 번째 동사"라는 GDD 의 의도는 그대로다 — 손목 왕복 대신 **순간 선택**이다.
 *
 * ★ 마커 위치는 상태(`qte.pos`)에 있고 **`ADVANCE` 에서만 움직인다.** 여기서 또 밀면
 *   프레임당 두 번 움직여 판정이 프레임레이트를 탄다.
 * ★ 포인터 락을 **풀지 않는다.** 락을 풀면 QTE가 끝나고 다시 클릭해야 시선이 돌아온다 —
 *   3분 게임에서 그건 최악의 UX다. 대신 `qte.active` 동안 카메라가 시선 적용만 건너뛴다.
 *
 * ★ **판정은 `ctx.prevPos` 를 본다, `s.qte.pos` 가 아니다.** 한 틱 안에서 `ADVANCE` 가
 *   먼저 돌아 마커를 이미 이번 프레임만큼 옮긴 **뒤에** 이 시스템이 클릭을 판정한다.
 *   `s.qte.pos` 를 그대로 쓰면 화면에 마지막으로 그려진 위치(플레이어가 보고 누른 바로 그
 *   위치)가 아니라 한 틱 더 진행된 위치로 판정된다 — 진행 방향 쪽 구간 경계에서
 *   "분명 초록인데 미스"가 난다(실측: speedMul 1 기준 한 틱 이동량이 zoneHalf 의 30%,
 *   2연속 성공 뒤엔 38%). `ctx.prevPos` 는 `tick.ts` 가 이번 틱의 `ADVANCE` 보다
 *   먼저 떠 두는, 직전 프레임에 실제로 그려졌던 값이다.
 */

import type { InputFrame } from '../core/input'
import { makeRng } from '../core/rng'
import { VENDING_IDS } from '../data/interactables'
import { FARE, QTE } from '../data/tuning'
import type { Action, GameState } from '../state/types'

export type QteCtx = Readonly<{ dtMs: number; input: InputFrame; prevPos: number }>

/** 자판기 id → 안정 해시. 시드와 섞어 자판기별 독립 금액을 만든다 */
const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 이 판의 자판기 3대 동전 배분. **시드 고정 + 합계 보장.**
 *
 * ★ 합계를 요금(1,400원) 이상으로 **보장하는 이유**: 스윕에서 실제 소프트락이 나왔다.
 *   시작 잔액 0원 시드(15%)에서 자판기가 0·500·500 을 뽑으면 세 대를 다 긁어도 1,000원이라
 *   개찰구를 절대 못 넘는다. GDD §11은 충전 루트를 4개(자판기 3 · 충전기 · 역무실) 두라고
 *   했지만 P1에는 자판기만 있으므로, **자판기만으로 최소 요금이 성립해야 한다.**
 *   (P2에서 충전기·역무실이 들어오면 이 보장을 풀 수 있다 — 그때는 선택지가 남으므로)
 *
 * 부족분은 **가장 많이 나온 자판기 한 대에 몰아준다.** 셋에 흩뿌리면 "세 대를 다 긁어야
 * 겨우 요금"이 되는 판이 늘어 강제 노동이 된다. 한 대가 크면 그 한 대를 찾는 게임이 된다.
 *
 * 재도전할 때마다 다시 굴리지 않는 것도 규칙이다 — 그러면 실패 후 재시도가 도박이 되고
 * QTE 실력이 무의미해진다. **금액은 운, 획득 여부는 실력.**
 */
export const coinPlan = (seed: number): readonly number[] => {
  const raw = VENDING_IDS.map((id) => makeRng((seed ^ hash(id)) >>> 0).pick(QTE.coinPool))
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum >= FARE) return raw
  const need = Math.ceil((FARE - sum) / 500) * 500
  const top = raw.indexOf(Math.max(...raw))
  return raw.map((v, i) => (i === top ? v + need : v))
}

/** 해당 자판기의 금액. 테이블 밖 id면 0 */
export const coinFor = (seed: number, vendorId: string): number => {
  const i = VENDING_IDS.indexOf(vendorId as (typeof VENDING_IDS)[number])
  return i < 0 ? 0 : (coinPlan(seed)[i] ?? 0)
}

/**
 * 지금 마커가 성공 구간(중앙) 안인가.
 *
 * 순수 함수라 헤드리스가 **클릭 타이밍을 계산해서** 누를 수 있다 —
 * 자동조종이 QTE 를 통과할 수 있어야 시드 200 스윕이 성립한다.
 */
export const inZone = (pos: number): boolean => Math.abs(pos - 0.5) <= QTE.zoneHalf

const succeed = (s: GameState, vendorId: string): Action[] => {
  const coin = coinFor(s.seed, vendorId)
  const acts: Action[] = [
    { t: 'QTE_END', success: true },
    { t: 'ACT_CONSUME', id: vendorId },
    { t: 'SECRET', id: `vend-${vendorId}` },
  ]
  if (coin > 0) {
    // 동전은 잔액으로 **직접** 흡수된다 — 획득과 사용 사이 절차가 0 (GDD §5.4 ⑤)
    acts.push({
      t: 'BALANCE', delta: coin, label: '동전',
      text: `자판기 아래에서 ${coin.toLocaleString('ko-KR')}원을 주웠다`,
    })
  } else {
    acts.push({ t: 'FX', kind: 'toast', text: '먼지만 나왔다', lifeMs: 1800, value: 0 })
  }
  return acts
}

const fail = (): Action[] => [
  { t: 'QTE_END', success: false },
  { t: 'TIME_PENALTY', ms: QTE.failPenaltyMs, label: '효자손이 걸렸다' },
  { t: 'FX', kind: 'shake', text: '', lifeMs: 320, value: 1 },
]

export const qteSystem = (s: GameState, ctx: QteCtx): Action[] => {
  if (!s.qte.active) return []
  const vendorId = s.qte.vendorId
  if (!vendorId) return [{ t: 'QTE_END', success: false }]
  // 게임이 끝났으면 조용히 닫는다 (페널티 없음 — 이미 열차가 갔다)
  if (s.phase !== 'playing') return [{ t: 'QTE_END', success: false }]

  const f = ctx.input
  if (f.pressCancel) return [{ t: 'QTE_END', success: false }]
  if (s.qte.elapsedMs >= QTE.timeoutMs) return fail()

  /**
   * ⚠ **연 그 입력은 안 센다.**
   *
   * `tick.ts` 는 같은 스텝에서 `interactSystem` → `qteSystem` 순으로 돈다. 자판기를 `E`(또는
   * 락 중 좌클릭)로 열면 그 스텝에서 QTE 가 이미 `active` 가 되고, **같은 원샷 입력**이
   * 여기까지 흘러와 마커가 아직 왼쪽 끝(pos 0)일 때 판정돼 **여는 즉시 미스 1개**를 먹었다.
   * 3회 성공에 3회 실패로 끝나는 판정이라 시작부터 한 칸을 잃는 셈이었다.
   *
   * `elapsedMs === 0` 은 **연 그 스텝에서만** 참이다 — 다음 틱의 `ADVANCE` 가 즉시 올린다.
   * (아이템 키 `1` 로 여는 경로는 `pressSlot` 이라 이 누수가 없었다. 그래서 E2E 가 못 잡았다.)
   */
  if (s.qte.elapsedMs === 0) return []

  /**
   * 입력은 **원샷 하나**다. `pressInteract` 는 `E` 와 **락 중 좌클릭**을 둘 다 받는다
   * (`core/input.ts`) — 손이 이미 어디에 있든 누를 수 있다.
   */
  if (!f.pressInteract) return []

  const hit = inZone(ctx.prevPos)
  const strokes = s.qte.strokes + (hit ? 1 : 0)
  const misses = s.qte.misses + (hit ? 0 : 1)

  const acts: Action[] = [{ t: 'QTE_HIT', hit }]
  if (!hit) acts.push({ t: 'FX', kind: 'shake', text: '', lifeMs: 180, value: 0.5 })

  if (strokes >= QTE.need) return [...acts, ...succeed(s, vendorId)]
  if (misses >= QTE.maxMisses) return [...acts, ...fail()]
  return acts
}
