/**
 * F-05 개찰구 — P0의 유일한 게임플레이.
 *
 * 램프 색은 시드 결과의 **직접 투영**이다 (`workingIds.includes(id)`).
 * 별도 데이터가 아니므로 램프가 거짓말할 구조적 가능성 자체가 없다 — MAP §5.4의 요구.
 */

import { FARE, GATE } from '../data/tuning'
import { GATES, GATE_BODY, GATE_TRIGGER_X, PAID_AREA_X, type GateDef } from '../data/world'
import type { Action, GameState } from '../state/types'
import type { Solid } from '../data/world'
import { FLOOR } from '../data/world'

export const gateById = (id: number): GateDef => {
  const g = GATES.find((x) => x.id === id)
  if (!g) throw new Error(`unknown gate ${id}`)
  return g
}

export const isWorking = (s: GameState, id: number): boolean => s.gates.workingIds.includes(id)

/** 플레이어가 서 있는 게이트 통로. 없으면 null. */
export const gateAtPlayer = (s: GameState): GateDef | null => {
  const { x, y } = s.player.pos
  if (x < GATE_TRIGGER_X.min || x > GATE_BODY.xMax) return null
  for (const g of GATES) {
    if (Math.abs(y - g.y) <= g.width / 2 + 0.18) return g
  }
  return null
}

/**
 * 게이트 플랩 — 동적 충돌체.
 * 통과 허가(`open`)를 받은 게이트만 열린다. 나머지는 전부 물리적 벽이다.
 */
export const gateFlaps = (s: GameState): Solid[] => {
  const out: Solid[] = []
  for (const g of GATES) {
    const open = s.gates.state === 'open' && s.gates.activeId === g.id
    if (open || s.gates.passed) continue
    out.push({
      id: `FLAP-${g.label}`,
      rect: [GATE_BODY.xMin, g.y - g.width / 2, GATE_BODY.xMax, g.y + g.width / 2],
      z0: FLOOR.B1,
      h: 1.15,
      look: 'gate',
    })
  }
  return out
}

export const gatesSystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing' || s.gates.passed) return []
  const out: Action[] = []
  const g = s.gates

  switch (g.state) {
    case 'idle': {
      if (g.cooldownMs > 0) break
      const target = gateAtPlayer(s)
      // 태그 트리거는 게이트 본체 바로 서쪽. 실제 개찰구처럼 별도 키 입력이 없다.
      if (target && s.player.pos.x >= GATE_TRIGGER_X.min && s.player.pos.x <= GATE_TRIGGER_X.max) {
        out.push({ t: 'GATE_BEGIN_TAG', gateId: target.id })
      }
      break
    }

    case 'tagging': {
      if (g.timerMs > 0 || g.activeId === null) break
      const id = g.activeId
      if (!isWorking(s, id)) {
        out.push({ t: 'GATE_REJECT', gateId: id, reason: 'broken' })
        out.push({ t: 'TIME_PENALTY', ms: GATE.brokenPenaltyMs, label: '고장' })
        out.push({ t: 'FX', kind: 'shake', text: '', lifeMs: 220, value: 1 })
      } else if (s.cardBalance < FARE) {
        out.push({ t: 'GATE_REJECT', gateId: id, reason: 'low' })
        out.push({ t: 'TIME_PENALTY', ms: GATE.lowBalancePenaltyMs, label: '잔액부족' })
        out.push({ t: 'FX', kind: 'shake', text: '', lifeMs: 220, value: 1 })
      } else {
        out.push({ t: 'GATE_ACCEPT', gateId: id })
        out.push({ t: 'FX', kind: 'balance', text: `−${FARE.toLocaleString('ko-KR')}원`, lifeMs: 1200, value: -FARE })
      }
      break
    }

    case 'open': {
      if (s.player.pos.x >= PAID_AREA_X) {
        out.push({ t: 'GATE_PASSED' })
        out.push({ t: 'FX', kind: 'toast', text: '운임구역 진입', lifeMs: 1400, value: 0 })
      } else if (g.timerMs <= 0) {
        out.push({ t: 'GATE_SET', state: 'idle', timerMs: 0 })
      }
      break
    }

    case 'reject': {
      if (g.timerMs <= 0) out.push({ t: 'GATE_SET', state: 'idle', timerMs: 0 })
      break
    }
  }
  return out
}

/** 거부 시 후퇴 — MOVE 액션 이후에 적용해야 하므로 별도로 뽑는다. */
export const gateKnockback = (s: GameState, prevState: GameState): Action[] => {
  if (prevState.gates.state === 'reject' || s.gates.state !== 'reject') return []
  const p = s.player
  return [{
    t: 'MOVE',
    pos: { x: p.pos.x - GATE.knockbackM, y: p.pos.y, z: p.pos.z },
    vel: { x: 0, y: 0 },
    facing: p.facing,
    rampId: p.rampId,
    moving: false,
    sprinting: false,
    vz: p.vz,
    grounded: p.grounded,
    airborneMs: p.airborneMs,
    jumpBufferMs: p.jumpBufferMs,
  }]
}

/**
 * 할아버지 대화 완주 보상으로 공개되는 고장 게이트 (P1 · GDD §5.4 [C]).
 *
 * `ledBrokenId` 와 **다른** 번호를 고른다 — 이미 LED가 알려준 것을 또 알려주면
 * 15초를 지불한 대가가 0이 된다. 힌트가 꺼진 시드(40%)에서는 첫 번째 고장 게이트를 준다.
 * 시드 결정이므로 같은 판에서 몇 번을 물어도 같은 번호가 나온다.
 */
export const hintedBrokenId = (s: GameState): number | null => {
  if (!s.flags.includes('HINT_GRANDPA')) return null
  const broken = GATES.map((g) => g.id).filter((id) => !isWorking(s, id) && id !== s.gates.ledBrokenId)
  if (broken.length === 0) return null
  return broken[Math.abs(s.seed) % broken.length] ?? null
}

/**
 * 안내 LED 문구 (MAP §5.4 ④). 힌트 없는 시드에선 일반 안내만 나간다.
 *
 * P1: 할아버지 힌트가 있으면 **두 번째 번호까지** 붙는다. Z3에서 후보가 9기 → 7기로
 * 줄어드는 것이 15초의 실제 대가다(GDD §8.1.1의 "−20s 회수").
 */
export const ledText = (s: GameState): string => {
  const hinted = hintedBrokenId(s)
  const led = s.gates.ledHint && s.gates.ledBrokenId !== null ? s.gates.ledBrokenId : null
  const ids = [led, hinted].filter((v): v is number => v !== null)
  if (ids.length === 0) return '신도림 방면 열차가 곧 도착합니다 · 안전선 뒤로 물러나 주십시오'
  return `${ids.join('·')}번 게이트 점검중 · 다른 게이트를 이용해 주십시오`
}
