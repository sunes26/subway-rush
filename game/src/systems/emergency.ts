/**
 * 비상게이트 (OBJ-21) + 개방 3경로 — `docs/P2-SPEC.md` §5.
 *
 * 개찰구 말고 **문이 하나 더** 생긴다. GDD 부록 A 시크릿 3·8번이 여기로 들어온다.
 *
 * | 경로 | 조건 | 비용 |
 * |---|---|---|
 * | 유실물 지갑 반납 (OBJ-13) | I-11 소지 | 반납 2.0s |
 * | 인터폰 호출 (OBJ-22) | 통화에서 **정중히** 부탁 | 시간 비용 없음 — 말투가 값이다 |
 * | 무단 통과 | 열린 상태 + 요금 미납 | 0s → 역무원 시야면 E-09 |
 *
 * 인터폰은 예전에 −15초를 무는 무조건 개방이었다. 디렉터 지시(2026-08-10)로
 * 선택지 있는 대화로 바뀌었다 — 셋 중 하나만 열리고, 거절당하면 다시 걸어야 한다
 * (`systems/interact.ts intercomChoice`).
 *
 * ★ 이 시스템은 `gates` **뒤**다. 같은 틱에 둘 다 `GATE_PASSED` 를 내면 나중 것이 이기고,
 *   그러면 요금 차감 여부가 뒤바뀐다.
 */

import { EMERGENCY_GATE, FLOOR, type Solid } from '../data/world'
import { EMERGENCY } from '../data/tuning'
import type { Action, GameState } from '../state/types'

/**
 * 닫힌 문의 충돌체. 열리면 **아무것도 안 낸다** — 개찰기 플랩과 같은 규약이다.
 * 정적 SOLIDS 가 아니라 여기 있는 이유: 정적 솔리드는 프레임마다 뺄 수 없다.
 */
export const emergencyDoor = (s: GameState): Solid[] =>
  s.flags.includes('EMERGENCY_OPEN')
    ? []
    : [{
        id: 'OBJ-21-EMG',
        rect: [
          EMERGENCY_GATE.x - 0.7, EMERGENCY_GATE.y - EMERGENCY_GATE.halfW,
          EMERGENCY_GATE.x + 0.7, EMERGENCY_GATE.y + EMERGENCY_GATE.halfW,
        ],
        z0: FLOOR.B1,
        h: 1.3,
        look: 'gate',
      }]

/** 비상게이트 개구부 안에 있는가 (y 기준) */
const inDoorway = (s: GameState): boolean =>
  Math.abs(s.player.pos.y - EMERGENCY_GATE.y) <= EMERGENCY_GATE.halfW + 0.3 &&
  Math.abs(s.player.pos.z - FLOOR.B1) < 2.5

export const emergencySystem = (s: GameState): Action[] => {
  if (s.phase !== 'playing') return []
  if (s.gates.passed) return []                       // 이미 운임구역 안이다
  if (!s.flags.includes('EMERGENCY_OPEN')) return []
  if (!inDoorway(s)) return []
  if (s.player.pos.x < EMERGENCY.passX) return []

  /**
   * **이미 개찰구에서 냈으면 끝이다.** 태그는 성공했는데 통과 시간 안에 못 건너
   * 문이 다시 닫힌 경우가 여기 걸린다 — 돈은 나갔고 `passed` 는 false 다.
   * 그 사람에게 요금을 또 물리면 이중 과금이고, 잔액이 모자라면 부정승차로 몰린다.
   * 판정 근거는 잔액이 아니라 **납부 사실**(`gates.farePaid`)이어야 한다.
   */
  if (s.gates.farePaid) {
    return [
      { t: 'GATE_PASSED' },
      { t: 'FX', kind: 'toast', text: '비상게이트 통과 — 요금은 이미 냈다', lifeMs: 2000, value: 0 },
    ]
  }

  /**
   * 요금을 안 냈으면 **부정승차다.**
   *
   * 지갑 반납·인터폰으로 열었어도 요금은 별개다 — 문이 열린 것과 요금을 낸 것은
   * 다른 일이고, GDD §9.4 의 E-09 는 *"개찰구를 정상적으로 통과하지 않았다"* 를 본다.
   * 대신 잔액이 충분하면 **자동으로 낸다** — 낼 돈이 있는데 굳이 부정승차가 되는 것은
   * 플레이어의 의도가 아니다(§6.2 "벌은 주되 문은 닫지 않는다"의 반대 방향 적용).
   */
  if (s.cardBalance >= EMERGENCY.fare) {
    return [
      { t: 'BALANCE', delta: -EMERGENCY.fare, label: '비상게이트 요금' },
      { t: 'GATE_PASSED' },
      { t: 'FX', kind: 'toast', text: '비상게이트 통과 — 요금은 냈다', lifeMs: 2000, value: 0 },
    ]
  }

  return [
    { t: 'GATE_PASSED' },
    { t: 'FLAG', id: 'FARE_EVADED', on: true },
    { t: 'FX', kind: 'toast', text: '요금을 안 내고 지났다 — 역무원 눈에 띄면 끝이다', lifeMs: 2800, value: 0 },
  ]
}
