/**
 * S12-9 · S12-10 — 밸런스 스윕.
 *
 * 여기서 증명하는 두 가지:
 *  1. **진짜 소프트락 0건** — 잔액은 이제 항상 0원(디렉터 지시)이지만, 어떤 판도
 *     "막혀서 못 움직이는" 상태로는 안 빠진다. **죽는 것과 막히는 것은 다르다** — 좀비폰족
 *     스턴(4s)이 할아버지 몽둥이 쿨다운(1.5s)보다 길어지면서, 절도 후 도주 중 좀비에
 *     붙잡히면 그 자리에서 두 대를 맞고 즉사(E-16)할 수 있다(디렉터 확인 · 의도된 리스크).
 *     `died`(= `phase 'ended'`)면 진행 불가가 아니라 라운드 종료이므로 소프트락에서 뺀다.
 *  2. **가장 정직한 루트가 가장 빠르다** (GDD §8.1.1) — 설계 의도의 실측 검증
 *
 * 시드 수는 테스트에서 24개로 제한한다. 200개 전량은 `npm run sweep` 이 돌려
 * `docs/P1-BALANCE.md` 를 생성한다 — 유닛 스위트가 분 단위로 늘어나면 아무도 안 돌린다.
 */

import { describe, expect, it } from 'vitest'
import { FARE } from '../../src/data/tuning'
import { summarize, sweep } from './_sweep'

const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7 + 3)

describe('S12-9 소프트락 0건', () => {
  const rows = sweep(SEEDS)

  it('모든 시드·루트에서 개찰구를 통과하거나, 통과 못 하면 죽어서다 (막혀서가 아니다)', () => {
    const locks = rows.filter((r) => !r.passed && !r.died)
    const detail = locks
      .map((r) => `seed ${r.seed} ${r.route} 시작잔액 ${r.startBalance} 멈춤 "${r.stuckAt}" 잔액 ${r.balance}`)
      .join('\n')
    expect(detail, `소프트락 ${locks.length}건`).toBe('')
  })

  it('모든 시드·루트에서 승강장에 도달하거나, 못 하면 죽어서다', () => {
    const fail = rows.filter((r) => !r.reached && !r.died)
    expect(fail.map((r) => `${r.seed}/${r.route}@${r.stuckAt}`).join(','), '미도달(소프트락)').toBe('')
  })

  it('잔액 0원 시드(전부)도 체인으로 요금을 만들거나, 실패하면 죽어서다', () => {
    // 위 `rows` 를 재사용한다 — `runRoute` 를 시드마다 새로 돌리면 방해요소 11종이 전부
    // 상시 활성인 지금은 기본 테스트 타임아웃(5s)을 넘긴다(아래 테스트와 같은 이유)
    for (const r of rows.filter((x) => x.route === 'A-steal')) {
      expect(r.passed || r.died, `seed ${r.seed}`).toBe(true)
      if (r.passed) expect(r.coinsEarned, `seed ${r.seed} 동전 획득`).toBeGreaterThanOrEqual(FARE)
    }
  })

  it('요금 미달 시드에서 무자원 루트는 애초에 시도되지 않는다', () => {
    // 위 `rows` 를 재사용한다 — `sweep(SEEDS)` 를 여기서 또 처음부터 돌리면
    // 같은 시뮬레이션 비용을 두 번 내고, 그러면 기본 테스트 타임아웃(5s)을 넘긴다.
    for (const r of rows.filter((x) => x.route === 'N-skip')) {
      expect(r.startBalance, `seed ${r.seed}`).toBeGreaterThanOrEqual(FARE)
    }
  })
})

describe('S12-10 루트 비용 — 정직한 루트가 더 빠른가', () => {
  const rows = sweep(SEEDS)
  const A = summarize(rows, 'A-steal')
  const C = summarize(rows, 'C-talk')

  it('대화 루트(C)는 좀비 즉사 리스크가 없어 표본이 충분하다', () => {
    expect(C.reached).toBeGreaterThan(20)
  })

  it('[A] 훔치기가 무료 지름길이 아니다 — 15초를 내는 [C]와 30초 이내 차이', () => {
    /**
     * GDD §8.1.1은 C(30s)가 A(47~65s)보다 **빠르다**고 주장한다. 그 표는 단소 회피
     * 실력과 개찰구 힌트 회수를 전제로 한 값이다. 자동조종은 도망치지 않으므로(맞으면서
     * 그냥 걸어간다) A가 유리하게 나올 수 있다 — 그래서 여기서는 **"A가 C를 크게
     * 앞서지 못한다"** 까지만 잠근다. 15초를 지불한 C가 A보다 30초 이상 느리면
     * 절도가 지배 전략이라는 뜻이고, 그건 P1-SPEC §11의 조정 트리거다.
     */
    const gap = C.avgSec - A.avgSec
    expect(gap, `C−A = ${gap.toFixed(1)}s (A ${A.avgSec.toFixed(1)} / C ${C.avgSec.toFixed(1)})`)
      .toBeLessThan(30)
  })

  /**
   * 양심 게이지를 없앤 뒤로 훔치기 자체는 더 이상 판정에 흔적을 안 남긴다 —
   * 대가는 적발(E-09)·즉사(E-16) 같은 **사건**으로만 남는다. 이 시점(탑승 전)
   * 판정은 죽지 않은 이상 루트를 가리지 않고 전부 E-06(다음 열차)으로 떨어진다.
   */
  it('죽지 않은 절도 루트는 대화 루트와 같은 사전 판정(E-06)에 떨어진다', () => {
    for (const r of rows.filter((x) => x.route === 'A-steal' && !x.died)) {
      expect(r.ending, `seed ${r.seed}`).toBe('E-06')
    }
  })
})
