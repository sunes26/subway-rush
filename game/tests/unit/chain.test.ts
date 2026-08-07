/**
 * S9 — 효자손 체인. **프로젝트의 얼굴**(GDD §5.4).
 *
 * 체크리스트 출처: `docs/P1-TECH-PLAN.md` §4 S9-1~S9-11
 * (S9-12 QTE 포인터 락 유지는 E2E 항목)
 */

import { describe, expect, it } from 'vitest'
import { coinFor } from '../../src/systems/qte'
import { GRANDPA_ID } from '../../src/data/interactables'
import { FARE, INTERACT, QTE } from '../../src/data/tuning'
import { FLOOR, GATES } from '../../src/data/world'
import { rollSeed } from '../../src/state/reducer'
import type { GameState, ItemId } from '../../src/state/types'
import { grandpaBranches } from '../../src/systems/interact'
import { ledText } from '../../src/systems/gates'
import { goto, holdFor, playQte, put, start, tap, wait, yawTo } from './_pilot'

const GP = { x: 42, y: 14.9 }
const VEND_A = { x: 13.03, y: 4.15 }
const CART = { x: -50, y: 31.1 }

/** 할아버지 앞에 서서 선택 UI를 연다 */
const openDialog = (s0: GameState): GameState => {
  const s = put(s0, GP.x, GP.y - 1.2, FLOOR.B1)
  return tap(s, { pressInteract: true }, yawTo(s, GP.x, GP.y))
}

/** 분기 선택 후 완료까지 대기. 소요 시간(초)을 같이 돌려준다 */
const pick = (s0: GameState, key: 1 | 2 | 3): { s: GameState; sec: number } => {
  const opened = openDialog(s0)
  const t0 = opened.timeLeftMs
  const yaw = yawTo(opened, GP.x, GP.y)
  let s = tap(opened, { pressSlot: key }, yaw)
  // [1] 훔치기는 진행 시간이 0이다 — 여기서 기다리면 측정값이 대기 시간으로 오염된다
  const settle = key === 1 ? 0 : key === 3 ? INTERACT.talkMs + 200 : INTERACT.buyMs + 200
  if (settle > 0) s = wait(s, settle, yaw)
  return { s, sec: (t0 - s.timeLeftMs) / 1000 }
}

describe('S9-1 할아버지 3분기 — 전부 효자손을 얻는다', () => {
  it('[1] 훔치기 — 즉시, 양심 −3, 추격 플래그', () => {
    const { s, sec } = pick(start(7), 1)
    expect(s.inventory.includes('I-01'), '효자손 획득').toBe(true)
    expect(s.scores.conscience).toBe(-3)
    expect(s.flags.includes('GRANDPA_ANGRY'), 'O-14 발동원').toBe(true)
    expect(sec, `소요 ${sec.toFixed(2)}s — 즉시여야 한다`).toBeLessThan(0.2)
  })

  it('[2] 붕어빵 — 1.5s, 양심 +1, 붕어빵 소모', () => {
    const { s, sec } = pick(start(7, { inventory: ['I-12', null, null] }), 2)
    expect(s.inventory.includes('I-01')).toBe(true)
    expect(s.inventory.includes('I-12'), '붕어빵은 소모된다').toBe(false)
    expect(s.scores.conscience).toBe(1)
    expect(s.flags.includes('GRANDPA_HELPED')).toBe(true)
    expect(s.flags.includes('GRANDPA_ANGRY'), '추격 없음').toBe(false)
    expect(sec).toBeGreaterThan(1.4)
    expect(sec).toBeLessThan(1.75)
  })

  it('[3] 말 걸기 — 15.0s, 양심 +1, 힌트 + 지식', () => {
    const { s, sec } = pick(start(7), 3)
    expect(s.inventory.includes('I-01')).toBe(true)
    expect(s.scores.conscience).toBe(1)
    expect(s.flags.includes('HINT_GRANDPA'), '개찰구 힌트 해금').toBe(true)
    expect(s.scores.knowledge, '시크릿 1건').toBe(1)
    expect(sec, `소요 ${sec.toFixed(1)}s`).toBeGreaterThan(14.9)
    expect(sec).toBeLessThan(15.3)
  })

  it('효자손을 넘긴 뒤에는 다시 상호작용되지 않는다', () => {
    const { s } = pick(start(7), 1)
    expect(s.act.consumed).toContain(GRANDPA_ID)
    const again = tap(s, { pressInteract: true }, yawTo(s, GP.x, GP.y))
    expect(again.act.dialogId, '선택 UI가 다시 열리지 않는다').toBeNull()
  })
})

describe('S9-2 [2]는 붕어빵 보유 시에만 활성', () => {
  it('미보유면 회색 + 사유, 상태 불변', () => {
    const s0 = start(7)
    expect(grandpaBranches(s0)[1]?.enabled).toBe(false)
    const opened = openDialog(s0)
    const s = tap(opened, { pressSlot: 2 }, yawTo(opened, GP.x, GP.y))
    expect(s.act.denyText).toBe('선물이 없다')
    expect(s.inventory.includes('I-01'), '효자손 안 나온다').toBe(false)
    expect(s.scores.conscience).toBe(0)
  })

  it('보유하면 활성된다', () => {
    expect(grandpaBranches(start(7, { inventory: [null, 'I-12', null] }))[1]?.enabled).toBe(true)
  })
})

describe('S9-3 대화 완주 → 안내 LED가 고장 게이트를 지목한다', () => {
  it('힌트 꺼진 시드에서도 번호가 나온다 (시드 60개)', () => {
    let checked = 0
    for (let seed = 0; seed < 200 && checked < 60; seed++) {
      const roll = rollSeed(seed)
      if (roll.ledHint) continue          // 원래 꺼진 시드만 본다
      checked++
      const s = start(seed, { flags: ['HINT_GRANDPA'] })
      const txt = ledText(s)
      expect(txt, `seed ${seed}`).toMatch(/번 게이트 점검중/)
      // 지목된 번호가 진짜 고장이어야 한다 — 거짓 표시는 GDD §11 위반
      const n = Number(txt.split('번')[0]?.split('·').pop())
      expect(roll.workingIds.includes(n), `seed ${seed}: ${n}번은 정상이면 안 된다`).toBe(false)
    }
    expect(checked, '힌트 꺼진 시드를 60개 확인했다').toBe(60)
  })

  it('이미 켜진 시드에서는 **다른** 번호를 추가로 알려준다', () => {
    for (let seed = 0; seed < 300; seed++) {
      const roll = rollSeed(seed)
      if (!roll.ledHint || roll.ledBrokenId === null) continue
      const before = ledText(start(seed))
      const after = ledText(start(seed, { flags: ['HINT_GRANDPA'] }))
      expect(after, `seed ${seed}`).not.toBe(before)
      expect(after.split('·').length, '번호가 두 개').toBeGreaterThan(1)
      return
    }
    throw new Error('힌트 켜진 시드를 못 찾았다')
  })
})

describe('S9-4 대화는 취소할 수 있고 시간은 환불되지 않는다', () => {
  it('이동 입력으로 끊으면 효자손 없이 경과 시간만 잃는다', () => {
    const opened = openDialog(start(7))
    const yaw = yawTo(opened, GP.x, GP.y)
    let s = tap(opened, { pressSlot: 3 }, yaw)
    const t0 = s.timeLeftMs
    s = wait(s, 5000, yaw)                       // 5초 듣다가
    s = holdFor(s, { moveY: 1 }, 4, yaw)         // 걸어나간다
    expect(s.act.busyId, '중단됐다').toBeNull()
    expect(s.inventory.includes('I-01'), '효자손 없다').toBe(false)
    const spent = (t0 - s.timeLeftMs) / 1000
    expect(spent, `${spent.toFixed(1)}s 를 잃었다 — 환불 없음`).toBeGreaterThan(4.9)
  })

  it('ESC로도 끊긴다', () => {
    const opened = openDialog(start(7))
    const yaw = yawTo(opened, GP.x, GP.y)
    let s = wait(tap(opened, { pressSlot: 3 }, yaw), 2000, yaw)
    s = tap(s, { pressCancel: true }, yaw)
    expect(s.act.busyId).toBeNull()
    expect(s.inventory.includes('I-01')).toBe(false)
  })
})

describe('S9-5 붕어빵 구매 (Z1 노점)', () => {
  const buy = (balance: number): GameState => {
    const s = put(start(7, { cardBalance: balance }), CART.x, CART.y - 1.0, FLOOR.L0)
    const yaw = yawTo(s, CART.x, CART.y)
    return wait(tap(s, { pressInteract: true }, yaw), INTERACT.buyMs + 200, yaw)
  }

  it('500원이 차감되고 붕어빵이 들어온다', () => {
    const s = buy(1250)
    expect(s.inventory.includes('I-12')).toBe(true)
    expect(s.cardBalance).toBe(750)
  })

  it('잔액 0원 시드에서는 살 수 없다 — [2] 루트가 원천 봉쇄된다', () => {
    const s = buy(0)
    expect(s.inventory.includes('I-12')).toBe(false)
    expect(s.cardBalance).toBe(0)
    expect(s.act.denyText).toBe('돈이 부족하다')
  })

  it('구매는 이동으로 취소되고 잔액은 안 빠진다', () => {
    const s0 = put(start(7, { cardBalance: 1250 }), CART.x, CART.y - 1.0, FLOOR.L0)
    const yaw = yawTo(s0, CART.x, CART.y)
    let s = tap(s0, { pressInteract: true }, yaw)
    s = holdFor(s, { moveY: -1 }, 4, yaw)
    s = wait(s, 1600, yaw)
    expect(s.cardBalance, '차감 0').toBe(1250)
    expect(s.inventory.includes('I-12')).toBe(false)
  })
})

describe('S9-6~S9-9 자판기 QTE', () => {
  const HAS_HYO: readonly (ItemId | null)[] = ['I-01', null, null]

  const atVend = (seed = 7, balance = 900): GameState =>
    put(start(seed, { inventory: HAS_HYO, cardBalance: balance }), VEND_A.x, VEND_A.y - 1.1, FLOOR.B1)

  it('S9-9 효자손 없이 누르면 사유만 나온다', () => {
    const s0 = put(start(7), VEND_A.x, VEND_A.y - 1.1, FLOOR.B1)
    const s = tap(s0, { pressInteract: true }, yawTo(s0, VEND_A.x, VEND_A.y))
    expect(s.qte.active).toBe(false)
    expect(s.act.denyText).toBe('효자손이 필요하다')
  })

  it('S9-6 3스트로크 성공 시 시드 결정 금액이 잔액에 정확히 가산된다', () => {
    let checked = 0
    for (let seed = 0; seed < 40 && checked < 12; seed++) {
      const coin = coinFor(seed, 'OBJ-06')
      const s0 = atVend(seed, 900)
      const yaw = yawTo(s0, VEND_A.x, VEND_A.y)
      let s = tap(s0, { pressInteract: true }, yaw)
      expect(s.qte.active, `seed ${seed}: QTE 열림`).toBe(true)
      s = playQte(s)
      if (s.qte.active) continue      // 리듬을 놓친 케이스는 이 테스트 대상이 아니다
      checked++
      expect(s.cardBalance, `seed ${seed}: 900 + ${coin}`).toBe(900 + coin)
      expect(s.tally.coinsEarned, '누적 획득액').toBe(coin)
      expect(s.act.consumed, '자판기 소진').toContain('OBJ-06')
      expect(s.scores.knowledge, '시크릿 1건').toBe(1)
    }
    expect(checked, '12개 시드에서 성공 경로를 확인했다').toBe(12)
  })

  it('S9-6 금액은 시드+자판기별로 독립이고 재현된다', () => {
    expect(coinFor(7, 'OBJ-06')).toBe(coinFor(7, 'OBJ-06'))
    const three = new Set([coinFor(7, 'OBJ-06'), coinFor(7, 'OBJ-07'), coinFor(7, 'OBJ-08')])
    expect(three.size, '세 대가 같은 값만 주지는 않는다').toBeGreaterThan(1)
    for (const id of ['OBJ-06', 'OBJ-07', 'OBJ-08']) {
      for (let seed = 0; seed < 50; seed++) {
        expect(QTE.coinPool as readonly number[]).toContain(coinFor(seed, id))
      }
    }
  })

  it('S9-7 6초 초과 시 −5s, 잔액 불변, 재시도 가능', () => {
    const s0 = atVend(7, 900)
    const yaw = yawTo(s0, VEND_A.x, VEND_A.y)
    let s = tap(s0, { pressInteract: true }, yaw)
    const t0 = s.timeLeftMs
    s = wait(s, QTE.timeoutMs + 200, yaw)      // 아무것도 안 긁는다
    expect(s.qte.active, '닫혔다').toBe(false)
    expect(s.cardBalance, '잔액 불변').toBe(900)
    expect(s.act.consumed, '소진되지 않는다 — 재시도 가능').not.toContain('OBJ-06')
    const lost = (t0 - s.timeLeftMs) / 1000
    expect(lost, `${lost.toFixed(1)}s`).toBeGreaterThan(QTE.timeoutMs / 1000 + 4.9)
  })

  it('S9-7 리듬을 계속 놓치면 3미스로 실패한다', () => {
    const s0 = atVend(7, 900)
    const yaw = yawTo(s0, VEND_A.x, VEND_A.y)
    let s = tap(s0, { pressInteract: true }, yaw)
    // 박자를 무시하고 최고속으로 왕복한다 → 창보다 훨씬 빨라 전부 미스
    s = playQte(s, { perfect: false })
    expect(s.qte.active).toBe(false)
    expect(s.cardBalance).toBe(900)
  })

  it('S9-8 성공한 자판기는 다시 긁을 수 없다', () => {
    const s0 = atVend(7, 900)
    const yaw = yawTo(s0, VEND_A.x, VEND_A.y)
    let s = playQte(tap(s0, { pressInteract: true }, yaw))
    if (s.qte.active) return                        // 이 시드에서 리듬 실패면 스킵
    s = tap(s, { pressInteract: true }, yaw)
    expect(s.qte.active, '다시 열리지 않는다').toBe(false)
  })

  it('효자손을 1번 슬롯에서 눌러도 QTE가 열린다 (슬롯 사용 라우팅)', () => {
    const s0 = atVend(7, 900)
    const s = tap(s0, { pressSlot: 1 }, yawTo(s0, VEND_A.x, VEND_A.y))
    expect(s.qte.active).toBe(true)
    expect(s.qte.vendorId).toBe('OBJ-06')
  })
})

describe('S9-11 잔액 900 시드에서 체인 완주 → 개찰구 통과', () => {
  it('훔쳐서 자판기를 긁고 요금을 낸다', () => {
    // 시드는 자판기 A가 꽝(0원)이 아닌 것을 고른다 — 꽝이면 B·C까지 가야 하고
    // 이 테스트가 재려는 것은 "체인이 잔액을 만든다"이지 시드 운이 아니다.
    const seed = [...Array(60).keys()].find((n) => coinFor(n, 'OBJ-06') >= 1000)
    expect(seed, '조건에 맞는 시드가 있다').toBeDefined()
    const coin = coinFor(seed as number, 'OBJ-06')

    let s = start(seed as number, { cardBalance: 900 })
    expect(s.cardBalance, '요금 미달로 시작').toBeLessThan(FARE)

    // 1) 할아버지 → 효자손
    s = pick(s, 1).s
    expect(s.inventory.includes('I-01')).toBe(true)

    // 2) 자판기 A 로 걸어가 긁는다
    const r = goto(s, VEND_A.x, VEND_A.y - 1.1, { r: 0.6, maxSec: 25 })
    expect(r.ok, '자판기까지 걸어갈 수 있다').toBe(true)
    const yaw = yawTo(r.s, VEND_A.x, VEND_A.y)
    s = playQte(tap(r.s, { pressInteract: true }, yaw))
    expect(s.qte.active, 'QTE 종료').toBe(false)
    expect(s.cardBalance, `900 + ${coin}`).toBe(900 + coin)
    expect(s.cardBalance, '요금을 낼 수 있게 됐다').toBeGreaterThanOrEqual(FARE)

    // 3) 개찰구까지 가서 통과
    const gy = GATES.find((g) => g.id === s.gates.workingIds[0])?.y ?? 14
    const g1 = goto(s, 55, 14, { maxSec: 25 })
    const g2 = goto(g1.s, 58.6, gy, { r: 0.8, maxSec: 20 })
    const g3 = goto(g2.s, 64, gy, { r: 1.6, maxSec: 15 })
    s = g3.s
    expect(s.gates.passed, '운임구역 진입').toBe(true)
    expect(s.cardBalance, '요금 차감').toBe(900 + coin - FARE)
  })
})
