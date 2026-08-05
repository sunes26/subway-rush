/**
 * 시뮬레이션 1스텝. 렌더를 전혀 모른다.
 *
 * 이 함수가 순수하기 때문에 3분 플레이를 20ms에 시뮬레이션할 수 있고,
 * 시드 1,000개 밸런싱 스윕이 20초에 끝난다. 아키텍처 분리의 진짜 이유가 이것이다.
 */

import type { InputFrame } from '../core/input'
import { EMPTY_INPUT } from '../core/input'
import { resolveEnding } from '../data/endings'
import { TRAFFIC_LIGHT, zoneAt } from '../data/world'
import { applyAll } from '../state/reducer'
import type { Action, GameState } from '../state/types'
import { setDynamicSolids } from './collision'
import { gateFlaps, gateKnockback, gatesSystem } from './gates'
import { movementSystem } from './movement'
import { psdDoors, trainAt, trainSystem } from './train'

export type TickCtx = Readonly<{ input: InputFrame; cameraYaw: number }>

export const lightIsGreen = (s: GameState): boolean => s.lightMs < TRAFFIC_LIGHT.greenMs

/** 현재 위상에서 다음 전환까지 남은 초. 신호등 발광과 HUD 표시가 이 하나를 공유한다. */
export const lightRemainSec = (s: GameState): number =>
  (lightIsGreen(s) ? TRAFFIC_LIGHT.greenMs - s.lightMs : TRAFFIC_LIGHT.cycleMs - s.lightMs) / 1000

/**
 * 이번 스텝의 동적 충돌체를 확정한다. 순서: 게이트 플랩 · PSD 가동문.
 *
 * 예전에는 여기에 적신호 차단벽(`LIGHT-BLOCK`)이 하나 더 있었다. 지금은 **없다** —
 * 디렉터 지시로 적신호에도 건널 수 있다. 대신 차가 진짜 위험이 됐다:
 * 차체에 닿으면 `RESPAWN` 으로 스폰에 되돌아간다(`main.ts` 의 `roadHazard` 판정).
 * 벽으로 막던 것을 규칙이 아니라 **결과**로 바꾼 것이다.
 */
export const rebuildDynamics = (s: GameState): void => {
  setDynamicSolids([...gateFlaps(s), ...psdDoors(s)])
}

export const tick = (state: GameState, dtMs: number, ctx: TickCtx): GameState => {
  let s = state

  // 1) 시계 전진
  s = applyAll(s, [{ t: 'ADVANCE', dtMs }])

  // 2) 열차는 시간의 순수 함수 — 리듀서를 거치지 않고 파생한다
  const train = trainAt(s.elapsedMs)
  if (
    train.state !== s.train.state ||
    train.x !== s.train.x ||
    train.doorProgress !== s.train.doorProgress
  ) {
    s = { ...s, train }
  }

  // 3) 동적 충돌체 갱신 (이동 전에 반드시)
  rebuildDynamics(s)

  // 4) 시스템 → 액션
  const before = s
  const actions: Action[] = [
    ...movementSystem(s, { dtMs, input: ctx.input, cameraYaw: ctx.cameraYaw }),
  ]
  s = applyAll(s, actions)

  const gateActions = gatesSystem(s)
  s = applyAll(s, gateActions)
  s = applyAll(s, gateKnockback(s, before))

  s = applyAll(s, trainSystem(s))

  // 5) 존 판정
  const zone = zoneAt(s.player.pos.x, s.player.pos.z)
  if (zone !== s.zone) s = applyAll(s, [{ t: 'ZONE', zone }])

  // 6) 종료 판정
  //    자유 탐색(`?freeplay`)에서는 열차가 떠나도 끝내지 않는다 — 맵을 계속 보라는 뜻이다.
  if (s.freeplay) return s
  if (s.phase === 'boarding' && s.train.state === 'departed') {
    s = applyAll(s, [{ t: 'END', endingId: resolveEnding(s).id }])
  } else if (s.phase === 'playing' && s.train.state === 'departed') {
    s = applyAll(s, [{ t: 'END', endingId: resolveEnding(s).id }])
  }

  return s
}

/** 헤드리스 시뮬 — 테스트·밸런싱 스윕용. 렌더 없이 게임 전체를 돌린다. */
export const simulate = (
  start: GameState,
  script: readonly InputFrame[],
  cameraYaw = 0,
  dtMs = 1000 / 60,
): GameState =>
  script.reduce((s, input) => tick(s, dtMs, { input, cameraYaw }), start)

/** n스텝 동안 같은 입력을 유지한다. */
export const hold = (input: Partial<InputFrame>, steps: number): InputFrame[] =>
  Array.from({ length: steps }, () => ({ ...EMPTY_INPUT, ...input }))
