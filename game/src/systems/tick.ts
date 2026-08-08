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
import { ambushSystem } from './ambush'
import { chaseSolids, chaseSystem } from './chase'
import { crowdSolids, crowdSystem } from './crowd'
import { setDynamicSolids } from './collision'
import { disembarkSystem } from './disembark'
import { gateFlaps, gateKnockback, gatesSystem } from './gates'
import { interactSystem } from './interact'
import { movementSystem } from './movement'
import { emergencyDoor, emergencySystem } from './emergency'
import { obstacleSystem } from './obstacles'
import { staffSystem } from './staff'
import { qteSystem } from './qte'
import {
  psdDoors, psdDoors2, trainAt, trainClock, trainClock2, trainSystem, trainSystem2,
  trainTriggerSystem, trainTriggerSystem2,
} from './train'
import { umbrellaSystem } from './umbrella'

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
  setDynamicSolids([
    ...gateFlaps(s), ...psdDoors(s), ...psdDoors2(s), ...chaseSolids(s), ...crowdSolids(s),
    ...emergencyDoor(s),
  ])
}

export const tick = (state: GameState, dtMs: number, ctx: TickCtx): GameState => {
  let s = state

  // 1) 시계 전진
  s = applyAll(s, [{ t: 'ADVANCE', dtMs }])

  // 2) 계단/엘리베이터 위치 트리거 — 같은 틱에 반영되도록 열차 파생보다 먼저 처리한다
  s = applyAll(s, trainTriggerSystem(s))
  s = applyAll(s, trainTriggerSystem2(s))

  // 열차는 시간의 순수 함수(트리거를 반영한 `trainClock`) — 리듀서를 거치지 않고 파생한다
  const train = trainAt(trainClock(s))
  if (
    train.state !== s.train.state ||
    train.x !== s.train.x ||
    train.doorProgress !== s.train.doorProgress
  ) {
    s = { ...s, train }
  }
  // 반대 방면 열차도 같은 식으로 파생한다
  const train2 = trainAt(trainClock2(s))
  if (
    train2.state !== s.train2.state ||
    train2.x !== s.train2.x ||
    train2.doorProgress !== s.train2.doorProgress
  ) {
    s = { ...s, train2 }
  }

  // 3) 동적 충돌체 갱신 (이동 전에 반드시)
  rebuildDynamics(s)

  // 4) 시스템 → 액션
  const before = s
  const actions: Action[] = [
    ...movementSystem(s, { dtMs, input: ctx.input, cameraYaw: ctx.cameraYaw }),
  ]
  s = applyAll(s, actions)

  /**
   * 추격은 **이동 뒤**다. 앞이면 플레이어가 이미 도망친 위치를 못 보고 한 프레임 늦게 때린다
   * (16.7ms × 걷기 5m/s = 8cm — 타격 반경 1.2m에서 티가 난다).
   */
  s = applyAll(s, chaseSystem(s, { dtMs }))

  /** 역무원도 이동 뒤다 — 추격과 같은 이유(한 프레임 늦은 위치를 보면 판정이 어긋난다) */
  s = applyAll(s, staffSystem(s))

  /** 개찰구 매복 — x≥57 트리거도 이번 스텝의 최종 위치로 판정해야 한다 */
  s = applyAll(s, ambushSystem(s, { dtMs }))

  /**
   * 인파 — 역류의 밀어내기는 `MOVE` 전량 재발행이라 반드시 이동 **뒤**여야 한다
   * (`gateKnockback` 과 같은 수법·같은 이유).
   */
  s = applyAll(s, crowdSystem(s, { dtMs, prev: before }))

  /** 하차 인파(디렉터 지시) — 역류와 같은 이유로 이동 뒤. 부딪힌 순간에만 민다 */
  s = applyAll(s, disembarkSystem(s, { dtMs }))

  /**
   * 방해요소는 **인파 뒤**다. 인파에 밀려 물청소 구역으로 들어가는 일이 있고,
   * 앞에 두면 밀리기 전 위치로 판정해 "분명 밟았는데 안 미끄러졌다"가 된다.
   */
  s = applyAll(s, obstacleSystem(s, { dtMs, prev: before }))

  /**
   * 상호작용 → QTE 순서다.
   *
   * `interact` 가 `E` 를 읽어 QTE를 켜고, **같은 틱에** `qte` 가 첫 델타를 먹는다.
   * 반대로 두면 시작 프레임의 마우스 입력이 통째로 버려진다.
   * 둘 다 이동보다 뒤인 것도 이유가 있다 — 타겟팅은 이번 틱의 **최종 위치**에서 해야 한다.
   */
  s = applyAll(s, interactSystem(s, { dtMs, input: ctx.input, cameraYaw: ctx.cameraYaw }))
  s = applyAll(s, qteSystem(s, { dtMs, input: ctx.input }))

  /**
   * 펼친 우산 훑기 — **상호작용 뒤**다. 같은 스텝에 좌클릭으로 편 우산이 곧바로
   * 판정에 들어가야 "펴자마자 옆 사람이 날아간다"가 성립한다.
   * (인파 솔리드는 이번 스텝 시작에 이미 확정됐으므로 실제로 길이 열리는 것은
   *  다음 스텝이다 — 예전 슬롯 키 경로와 같은 한 프레임이라 체감이 달라지지 않는다.)
   */
  s = applyAll(s, umbrellaSystem(s, { dtMs }))

  const gateActions = gatesSystem(s)
  s = applyAll(s, gateActions)
  s = applyAll(s, gateKnockback(s, before))

  /**
   * 비상게이트는 **개찰구 뒤**다. 같은 틱에 둘 다 `GATE_PASSED` 를 내면 나중 것이 이기고,
   * 그러면 요금 차감 여부가 뒤바뀐다.
   */
  s = applyAll(s, emergencySystem(s))

  s = applyAll(s, trainSystem(s))
  s = applyAll(s, trainSystem2(s))

  // 5) 존 판정
  const zone = zoneAt(s.player.pos.x, s.player.pos.z)
  if (zone !== s.zone) s = applyAll(s, [{ t: 'ZONE', zone }])

  // 6) 종료 판정
  //    자유 탐색(`?freeplay`)에서는 열차가 떠나도 끝내지 않는다 — 맵을 계속 보라는 뜻이다.
  if (s.freeplay) return s
  /**
   * 탄 게 반대 방면(`boardedTrain2`)이면 **그 열차**의 출발을 본다 — 본편 열차(`s.train`)는
   * 계속 대기 중이라 영원히 안 끝난다. 안 탔을 때(missed) 는 여전히 본편만 본다 —
   * 반대 방면 열차가 그냥 지나가는 건 이 판의 실패 사유가 아니다.
   */
  if (s.phase === 'boarding') {
    const boardedTrainStatus = s.boardedTrain2 ? s.train2 : s.train
    if (boardedTrainStatus.state === 'departed') {
      s = applyAll(s, [{ t: 'END', endingId: resolveEnding(s).id }])
    }
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
