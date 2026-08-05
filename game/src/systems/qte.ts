/**
 * 자판기 하단 긁기 QTE — GDD §5.4 "마우스 좌↔우 드래그 3회, 리듬 판정".
 *
 * 순수 함수다. 입력은 `InputFrame.qteDelta`(원본 마우스 x 델타 px) 하나뿐이라
 * 헤드리스 테스트가 손으로 스크립트를 만들 수 있다.
 *
 * ★ 포인터 락을 **풀지 않는다.** 락을 풀면 QTE가 끝나고 다시 클릭해야 시선이 돌아온다 —
 *   3분 게임에서 그건 최악의 UX다. 대신 `qte.active` 동안 카메라가 시선 적용만 건너뛴다.
 */

import type { InputFrame } from '../core/input'
import { makeRng } from '../core/rng'
import { VENDING_IDS } from '../data/interactables'
import { FARE, QTE } from '../data/tuning'
import type { Action, GameState } from '../state/types'

export type QteCtx = Readonly<{ dtMs: number; input: InputFrame }>

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

/** 지금 스트로크가 판정창 안인가 */
export const inWindow = (beatMs: number): boolean => Math.abs(beatMs) <= QTE.windowMs

const succeed = (s: GameState, vendorId: string): Action[] => {
  const coin = coinFor(s.seed, vendorId)
  const acts: Action[] = [
    { t: 'QTE_END', success: true },
    { t: 'ACT_CONSUME', id: vendorId },
    { t: 'SECRET', id: `vend-${vendorId}` },
  ]
  if (coin > 0) {
    // 동전은 잔액으로 **직접** 흡수된다 — 획득과 사용 사이 절차가 0 (GDD §5.4 ⑤)
    acts.push({ t: 'BALANCE', delta: coin, label: '동전' })
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

  const dx = f.qteDelta
  const sign: -1 | 0 | 1 = dx > 0 ? 1 : dx < 0 ? -1 : 0

  let dir = s.qte.dir
  let travel = s.qte.travel

  if (sign !== 0) {
    if (dir === 0) { dir = sign; travel = Math.abs(dx) }
    else if (sign === dir) travel += Math.abs(dx)
    // 방향이 반대면 무시한다 — 스트로크가 끝나면 dir이 뒤집히므로 **왕복이 강제된다**
  }

  if (travel < QTE.strokeTravel) {
    return dir === s.qte.dir && travel === s.qte.travel
      ? []
      : [{ t: 'QTE_INPUT', dir, travel }]
  }

  // 스트로크 성립 — 리듬 판정
  const hit = inWindow(s.qte.beatMs)
  const strokes = s.qte.strokes + (hit ? 1 : 0)
  const misses = s.qte.misses + (hit ? 0 : 1)

  const acts: Action[] = [{ t: 'QTE_STROKE', hit }]
  // 다음 스트로크는 반대 방향이어야 한다
  acts.push({ t: 'QTE_INPUT', dir: (dir === 1 ? -1 : 1) as -1 | 1, travel: 0 })

  if (strokes >= QTE.need) return [...acts, ...succeed(s, vendorId)]
  if (misses >= QTE.maxMisses) return [...acts, ...fail()]
  return acts
}
