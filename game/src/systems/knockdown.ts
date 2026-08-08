/**
 * E-18 차에 치임 — 붕 떴다가 떨어져 쓰러지는 연출 (`main.ts` 의 `carHits` 판정이 시작한다).
 *
 * 매복(`systems/ambush.ts`)과 **같은 모양의 시스템**이다: 상태는 `active`·`phaseMs` 둘뿐이고,
 * 카메라 오프셋은 그 하나에서 파생되는 순수 함수다. 다른 것은 궤적뿐이다 —
 * 테이저는 무너지고(단조 하강), 차는 **띄운다**(포물선).
 *
 * 판정을 여기서 하지 않는 이유는 차가 시간의 순수 함수가 아니기 때문이다(`main.ts` 헤더 참고).
 * 이 시스템은 **맞은 뒤**만 책임진다: 시간을 흘리고, 다 끝나면 엔딩을 낸다.
 */

import { KNOCKDOWN_CAM } from '../data/tuning'
import type { Action, GameState } from '../state/types'

export const KNOCKDOWN_TOTAL_MS = KNOCKDOWN_CAM.airMs + KNOCKDOWN_CAM.settleMs

/**
 * 포물선 상수 — 정점 시각을 전체 체공시간의 몇 분의 일로 둘지.
 *
 * 높이를 `peak * (2ru − r²u²)` 로 쓰면 `u=0` 에서 0, `u=1/r` 에서 정확히 `peak`,
 * `u=1` 에서 `−drop` 이 된다. 그 세 조건을 동시에 만족하는 `r` 이 아래 식이다
 * (`r² − 2r − drop/peak = 0` 의 양근). **정점이 한가운데가 아니라 앞쪽에 오는 것**이
 * 이 곡선의 핵심이다 — 올라가는 시간보다 떨어지는 시간이 길어야 맞은 것처럼 보인다.
 */
const R = 1 + Math.sqrt(1 + KNOCKDOWN_CAM.dropM / KNOCKDOWN_CAM.peakM)

/** 진행도 0..1 */
export const knockdownT = (phaseMs: number): number =>
  Math.min(1, Math.max(0, phaseMs / KNOCKDOWN_TOTAL_MS))

/**
 * 카메라 오프셋 — `main.ts` 가 `cameraRig.update()` 결과 **위에 더한다**.
 *
 * `liftM` 은 부호가 있다: 양수면 눈높이보다 위(떠 있다), 음수면 아래(쓰러졌다).
 * 매복의 `dropM`(항상 하강)과 부호 규약이 다르므로 이름을 다르게 뒀다 — 같은 이름으로
 * 두면 호출부에서 부호를 한 번 뒤집어야 하고, 그 한 번을 잊는 것이 딱 이런 코드의 사고다.
 */
export const knockdownCamera = (
  phaseMs: number,
): { liftM: number; rollRad: number; pitchRad: number } => {
  const c = KNOCKDOWN_CAM
  const air = Math.min(1, Math.max(0, phaseMs / c.airMs))

  // 1) 높이 — 체공 중엔 포물선, 착지 뒤엔 바닥에 붙은 채 감쇠 진동
  let liftM: number
  if (phaseMs < c.airMs) {
    liftM = c.peakM * (2 * R * air - R * R * air * air)
  } else {
    const landedMs = phaseMs - c.airMs
    const bounce = Math.sin((landedMs / 1000) * c.settleHz * Math.PI * 2) *
      c.settleAmpM * Math.exp(-landedMs / c.settleTauMs)
    liftM = -c.dropM + bounce
  }

  /**
   * 2) 회전 — **체공 내내** 돈다. 착지 시점에 최종 각으로 도달하고 그 뒤엔 굳는다.
   * `air²` 이 아니라 `air^1.4` 인 이유: 제곱이면 초반이 너무 느려 맞자마자 뻣뻣해 보이고,
   * 선형이면 정점에서 이미 다 돌아 착지할 때 볼 것이 없다.
   */
  const spin = Math.pow(air, 1.4)
  const rollRad = spin * c.rollRad

  /**
   * 3) 시선 — 뜨는 동안 하늘을 보고(정점 최대), 떨어지며 조금 되돌아온다.
   * 착지 후에도 `pitchRestRad` 는 남는다: 누워서 위를 보고 있다는 뜻이다.
   */
  const peakU = 1 / R
  const pitchRad = air <= peakU
    ? c.pitchUpRad * (air / peakU)
    : c.pitchRestRad + (c.pitchUpRad - c.pitchRestRad) * (1 - (air - peakU) / (1 - peakU))

  return { liftM, rollRad, pitchRad }
}

export const knockdownSystem = (s: GameState, ctx: { dtMs: number }): Action[] => {
  if (s.phase !== 'playing' || !s.knockdown.active) return []

  const next = s.knockdown.phaseMs + ctx.dtMs
  /**
   * 끝나는 순간엔 연출을 안 낸다 — 암전이 이미 다 깔린 뒤라 보이지 않는다
   * (`ui/dialog.ts` 의 `#blackout`, 매복과 같은 이유).
   */
  if (next >= KNOCKDOWN_TOTAL_MS) return [{ t: 'END', endingId: 'E-18' }]

  /** 착지 충격 — 바닥에 닿는 그 한 프레임에만. 맞는 순간의 흔들림은 `main.ts` 가 이미 냈다 */
  const landNow = s.knockdown.phaseMs < KNOCKDOWN_CAM.airMs && next >= KNOCKDOWN_CAM.airMs
  const tick: Action = { t: 'KNOCKDOWN_TICK', dtMs: ctx.dtMs }
  return landNow
    ? [{ t: 'FX', kind: 'shake', text: '', lifeMs: 380, value: 1 }, tick]
    : [tick]
}
