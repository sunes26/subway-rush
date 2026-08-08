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
 * 할아버지 대화 완주 보상으로 공개되는 **정상** 게이트 (디렉터 지시 2026-08-08).
 *
 * 예전엔 "또 다른 고장 게이트"를 하나 더 알려주는 소거법이었다(9→7 후보). 지금은
 * 정답을 직접 찍어준다 — `workingIds` 는 정렬돼 있으므로 첫 값이 항상 같다(시드 고정).
 * 대화 UI(`ui/dialog.ts` STORY_LINES)가 완료 **전에** 같은 값을 미리 읽어 대사로
 * 보여준다 — 거기는 플래그 게이팅이 없다, 대화 자체가 곧 공개의 순간이라서다.
 * 여기(LED)는 그 값을 **나중에**(플래그가 켜진 뒤) Z3에서 다시 확인해 주는 두 번째 채널일
 * 뿐이므로 **같은 소스**(`workingIds[0]`)를 읽어야 번호가 서로 어긋나지 않는다.
 */
export const hintedWorkingId = (s: GameState): number | null => {
  if (!s.flags.includes('HINT_GRANDPA')) return null
  return s.gates.workingIds[0] ?? null
}

/**
 * 안내 LED 문구 (MAP §5.4 ④). 힌트 없는 시드에선 일반 안내만 나간다.
 *
 * 두 신호는 성격이 다르다 — LED 자체 힌트(`ledBrokenId`)는 "이건 고장"(피하라),
 * 할아버지 힌트(`hintedWorkingId`)는 "이건 정상"(가라)이다. 둘 다 있으면 문장에
 * 같이 넣되 각자의 말투를 유지한다.
 */
export const ledText = (s: GameState): string => {
  const working = hintedWorkingId(s)
  const led = s.gates.ledHint && s.gates.ledBrokenId !== null ? s.gates.ledBrokenId : null
  if (led === null && working === null) {
    return '신촌 방면 열차가 곧 도착합니다 · 안전선 뒤로 물러나 주십시오'
  }
  const brokenPart = led !== null ? `${led}번 게이트 점검중 · ` : ''
  const tail = working !== null ? `${working}번 게이트를 이용해 주십시오` : '다른 게이트를 이용해 주십시오'
  return `${brokenPart}${tail}`
}
