/**
 * 밸런스 스윕 — 루트별 실질 비용을 **실측**한다.
 *
 * GDD §8.1.1은 *"가장 정직한 루트가 가장 빠르다"* 를 설계 의도로 선언했다.
 * 그건 표에 적힌 주장이고, 이 파일이 그 주장을 검증한다.
 *
 * 헤드리스라서 3분 플레이가 수십 ms에 끝난다 — 이 장치가 없으면 밸런싱이
 * "해 보니 그런 것 같다"로 끝난다. `tools/sweep.ts` 와 `sweep.test.ts` 가 같이 쓴다.
 */

import { FARE, QTE } from '../../src/data/tuning'
import { FLOOR, GATES } from '../../src/data/world'
import type { EndingId, GameState } from '../../src/state/types'
import { resolveEnding } from '../../src/data/endings'
import { goto, holdFor, playQte, start, tap, wait, yawTo } from './_pilot'

/** 루트 이름 — GDD §8.1.1의 [A]/[B]/[C] 와 무자원 대조군 */
export type Route = 'A-steal' | 'C-talk' | 'N-skip'

export type SweepRow = Readonly<{
  seed: number
  route: Route
  startBalance: number
  /** 개찰구를 통과했는가 */
  passed: boolean
  /** 승강장(Z5)에 도달했는가 */
  reached: boolean
  /** 도달까지 소요(초). 실패면 마지막 시각 */
  sec: number
  /** 최종 잔액 */
  balance: number
  coinsEarned: number
  /** 도달 시점에 판정한 엔딩 (탑승 전이므로 참고값) */
  ending: EndingId
  /** 진행 불가로 멈춘 지점 (없으면 null) */
  stuckAt: string | null
  /**
   * 소프트락이 아니라 **정당하게 죽었는가** (`phase === 'ended'`).
   * 좀비폰족 스턴(4s)이 할아버지 몽둥이 쿨다운(1.5s)보다 길어지면서,
   * 절도 직후 도주 중 좀비에 붙잡히면 그 자리에서 두 대를 맞고 즉사(E-16)할 수 있다 —
   * 디렉터 확인 결과 **의도된 리스크**로 유지한다. `stuckAt` 이 있어도 `died` 면
   * 진행이 막힌 게 아니라 라운드가 끝난 것이므로 소프트락 집계에서 뺀다.
   */
  died: boolean
}>

const GP = { x: 42, y: 14.9 }
const VENDS = [
  { id: 'OBJ-06', x: 13.03, y: 4.15 },
  { id: 'OBJ-07', x: 21.63, y: 4.15 },
  { id: 'OBJ-08', x: 25.93, y: 4.15 },
] as const

/** 대합실 진입까지 (Z1 → 계단 → B1). 실패하면 지점 이름을 돌려준다 */
const toConcourse = (s0: GameState): { s: GameState; stuckAt: string | null } => {
  let s = s0
  for (const [name, x, y, r, maxSec] of [
    ['Z1 횡단보도 앞', -34, 27.5, 1.4, 20],
    ['Z1 횡단보도 통과', -20, 27.5, 1.4, 30],
    ['Z1 4번 출구', 0.5, 28, 1.4, 20],
    ['B1 계단 하단', 15.5, 28, 1.6, 20],
  ] as const) {
    const r2 = goto(s, x, y, { r, maxSec })
    s = r2.s
    if (!r2.ok) return { s, stuckAt: name }
  }
  return { s, stuckAt: null }
}

/** 할아버지에게 정직하게 효자손을 얻는다 — 대화(15s). 회수당한 뒤의 복구 경로다 */
const getHyoHonestly = (s0: GameState): GameState => {
  const g = goto(s0, GP.x, GP.y - 1.2, { r: 0.7, maxSec: 25 })
  if (!g.ok) return g.s
  const yaw = yawTo(g.s, GP.x, GP.y)
  let s = tap(g.s, { pressInteract: true }, yaw)
  s = tap(s, { pressSlot: 3 }, yaw)
  return wait(s, 15_200, yaw)
}

/** 효자손을 들고 자판기를 요금이 될 때까지 긁는다 */
const scratchUntilAffordable = (s0: GameState): GameState => {
  let s = s0
  // QTE 는 손에 쥔 상태에서만 열린다 — 아직 안 쥐었으면 먼저 손에 쥔다
  if (s.inventory.includes('I-01') && s.hand.item !== 'I-01') {
    s = tap(s, { pressSlot: s.inventory.indexOf('I-01') + 1 })
  }
  for (const v of VENDS) {
    if (s.cardBalance >= FARE) break
    if (!s.inventory.includes('I-01')) break
    const r = goto(s, v.x, v.y - 1.1, { r: 0.7, maxSec: 20 })
    if (!r.ok) continue
    s = r.s
    const yaw = yawTo(s, v.x, v.y)
    /**
     * 한 대당 **2회까지** 시도한다.
     *
     * 리듬을 한 번 놓치면 그 자판기를 포기하고 넘어가게 짰더니, 잔액 0원 시드에서
     * 세 대의 합계가 정확히 요금인 판(보장 하한)에서 개찰구를 못 넘었다.
     * 실제 플레이어도 −5초를 물고 다시 긁는다 — 자동조종이 사람보다 쉽게 포기하면
     * 스윕이 밸런스가 아니라 자동조종의 인내심을 재게 된다.
     */
    for (let attempt = 0; attempt < 2; attempt++) {
      if (s.act.consumed.includes(v.id)) break
      s = playQte(tap(s, { pressInteract: true }, yaw))
      if (s.qte.active) s = wait(s, QTE.timeoutMs + 400, yaw)   // 실패 정리
    }
  }
  return s
}

/** 개찰구 → Z4 → Z5 */
const toPlatform = (s0: GameState): { s: GameState; stuckAt: string | null } => {
  let s = s0
  const gy = GATES.find((g) => g.id === s.gates.workingIds[0])?.y ?? 14
  const legs: readonly (readonly [string, number, number, number, number])[] = [
    // 기둥(x 36 · y 20)을 피하는 중간 경유점. P0 traverse 가 (34,20)을 둔 것과 같은 이유다
    ['Z2 대합실 통로', 34, 16, 1.6, 25],
    ['Z3 진입선', 55, 14, 1.4, 25],
    ['정상 게이트 정렬', 58.6, gy, 0.8, 20],
    ['개찰구 통과', 64, gy, 1.6, 14],
    ['Z4 통로', 94, 6.5, 1.4, 25],
    ['Z4 계단 하강', 119.5, 6.7, 1.6, 25],
    ['Z5 승강장 진입', 130, 6, 1.4, 15],
  ]
  for (const [name, x, y, r, maxSec] of legs) {
    const res = goto(s, x, y, { r, maxSec })
    s = res.s
    if (!res.ok) return { s, stuckAt: name }
  }
  return { s, stuckAt: null }
}

const row = (
  seed: number, route: Route, s0: GameState, s: GameState, stuckAt: string | null,
): SweepRow => ({
  seed,
  route,
  startBalance: s0.cardBalance,
  passed: s.gates.passed,
  reached: s.zone === 'Z5',
  sec: (s0.timeLeftMs - s.timeLeftMs) / 1000,
  balance: s.cardBalance,
  coinsEarned: s.tally.coinsEarned,
  ending: resolveEnding(s).id,
  stuckAt,
  died: s.phase === 'ended',
})

/** 한 시드 · 한 루트를 완주 시도한다 */
export const runRoute = (seed: number, route: Route): SweepRow => {
  const s0 = start(seed)
  let s = s0

  const c = toConcourse(s)
  s = c.s
  if (c.stuckAt) return row(seed, route, s0, s, c.stuckAt)

  if (route !== 'N-skip') {
    const g = goto(s, GP.x, GP.y - 1.2, { r: 0.7, maxSec: 25 })
    s = g.s
    if (!g.ok) return row(seed, route, s0, s, '할아버지 접근')
    const yaw = yawTo(s, GP.x, GP.y)
    s = tap(s, { pressInteract: true }, yaw)
    // [1] 훔치기 = 즉시 · [3] 말 걸기 = 15초
    s = tap(s, { pressSlot: route === 'A-steal' ? 1 : 3 }, yaw)
    if (route === 'C-talk') s = wait(s, 15_200, yaw)

    /**
     * 훔친 직후에는 **먼저 도망친다.**
     *
     * 자판기 QTE는 6초를 제자리에 서 있게 만든다. 추격 중이면 1.5초마다 맞아
     * 7.5초에 효자손을 회수당한다 — 스윕이 그걸 그대로 보여줬다(잔액 0원 시드 2건).
     * GDD §8.1.1이 [A]의 실질 비용을 47~65s로 잡은 이유가 바로 이 대기다.
     * 서쪽으로 스프린트해 거리를 벌리고, 추격이 풀릴 때까지 기다린 다음 긁는다.
     */
    if (route === 'A-steal') {
      // 추격은 다음 틱에 시작된다(chaseSystem 이 플래그를 보고 켠다) — 한 박자 기다린다
      s = wait(s, 100, yaw)
      for (let i = 0; i < 40 && s.chase.active; i++) {
        s = holdFor(s, { moveY: -1, sprint: true }, 30)
      }
    }
    s = scratchUntilAffordable(s)

    /**
     * 복구 — 효자손을 회수당했고 아직 요금이 안 되면 **정직한 루트로 다시 얻는다.**
     *
     * 이건 자동조종의 편의가 아니라 **게임이 안 막혔다는 증명**이다. 회수 시
     * 리듀서가 할아버지를 `consumed` 에서 빼기 때문에(GDD §6.2 "문은 닫지 않는다")
     * 15초를 더 내고 다시 얻어 남은 자판기를 긁을 수 있다.
     */
    for (let round = 0; round < 2 && s.cardBalance < FARE; round++) {
      if (!s.inventory.includes('I-01')) s = getHyoHonestly(s)
      if (!s.inventory.includes('I-01')) break
      s = scratchUntilAffordable(s)
    }
  }

  const p = toPlatform(s)
  s = p.s
  return row(seed, route, s0, s, p.stuckAt)
}

export type RouteStat = Readonly<{
  route: Route
  n: number
  reached: number
  passed: number
  avgSec: number
  softlocks: readonly SweepRow[]
}>

export const summarize = (rows: readonly SweepRow[], route: Route): RouteStat => {
  const mine = rows.filter((r) => r.route === route)
  const ok = mine.filter((r) => r.reached)
  return {
    route,
    n: mine.length,
    reached: ok.length,
    passed: mine.filter((r) => r.passed).length,
    avgSec: ok.length ? ok.reduce((a, r) => a + r.sec, 0) / ok.length : Infinity,
    // 소프트락 = 요금을 만들 길이 있었는데 개찰구를 못 넘은 경우
    softlocks: mine.filter((r) => !r.passed),
  }
}

/** 시드 목록 스윕 — 루트 3종 전부 */
export const sweep = (seeds: readonly number[]): SweepRow[] => {
  const out: SweepRow[] = []
  for (const seed of seeds) {
    const startBal = start(seed).cardBalance
    out.push(runRoute(seed, 'A-steal'))
    out.push(runRoute(seed, 'C-talk'))
    // 무자원 루트는 시작 잔액이 요금 이상일 때만 성립한다
    if (startBal >= FARE) out.push(runRoute(seed, 'N-skip'))
  }
  return out
}

/** 층 판정 확인용 — 스윕 결과를 사람이 읽는 표로 */
export const asMarkdown = (rows: readonly SweepRow[]): string => {
  const stats = (['A-steal', 'C-talk', 'N-skip'] as const).map((r) => summarize(rows, r))
  const head = '| 루트 | n | 승강장 도달 | 개찰구 통과 | 평균 소요 |\n|---|---:|---:|---:|---:|'
  const body = stats.map((st) =>
    `| ${st.route} | ${st.n} | ${st.reached} | ${st.passed} | ` +
    `${Number.isFinite(st.avgSec) ? st.avgSec.toFixed(1) + 's' : '—'} |`).join('\n')
  const locks = rows.filter((r) => !r.passed)
  const lockText = locks.length === 0
    ? '소프트락 **0건**.'
    : `소프트락 ${locks.length}건:\n` +
      locks.slice(0, 20).map((r) => `- seed ${r.seed} · ${r.route} · 시작잔액 ${r.startBalance} · 멈춤 "${r.stuckAt}"`).join('\n')
  return `${head}\n${body}\n\n${lockText}\n`
}

/** Z5 도달 여부를 층으로 재확인 — zoneAt 의 x·z 조합 규약과 어긋나면 잡는다 */
export const onPlatform = (s: GameState): boolean =>
  s.zone === 'Z5' && Math.abs(s.player.pos.z - FLOOR.B2) < 1.5
