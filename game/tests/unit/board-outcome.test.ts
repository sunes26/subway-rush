/**
 * 탑승 결과 3종이 **실제 시뮬로** 갈리는가 — SUCCESS · JUST IN TIME · WRONG WAY.
 *
 * ■ 왜 합성 상태로는 부족한가
 *
 * `ending6.test.ts` 는 조건을 직접 만들어 판정기를 부른다. 그건 엔딩의 **정의**를
 * 잠그는 테스트고 그대로 필요하다. 하지만 정의가 맞아도 **그 상태에 이르는 길이
 * 없으면** 엔딩은 게임에 존재하지 않는다 — 이 리포에서 이미 두 번 일어났다:
 *
 *   · E-12 는 아무도 켜지 않는 플래그를 조건에 들고 있었다 (커밋 e64094b)
 *   · E-04 는 `timeLeftMs <= 1000` 이었는데, 그 값은 열차 스케줄과 무관하게 움직인다
 *
 * 둘 다 유닛 테스트는 통과하고 있었다. 판정기를 부르는 대신 **플레이어를 실제로
 * 걸어 들어가게 해서** 그 길이 살아 있는지 본다.
 *
 * ■ 무대
 *
 * 객실은 실제 공간이다(`data/world.ts` `Z5-CABIN`, y 12.2~15.45). 탑승 판정은
 * "문 앞에서 탈 의사를 보였는가"가 아니라 **"객실 안에 들어섰는가"**다
 * (`systems/train.ts trainSystem`). 그래서 여기서도 문 앞에 세워 두고 +y 로 걷게 한다.
 */

import { describe, expect, it } from 'vitest'
import { resolveEnding } from '../../src/data/endings'
import { TRAIN } from '../../src/data/tuning'
import { DOOR_XS, FLOOR, Y_OFFSET_OPP } from '../../src/data/world'
import type { GameState } from '../../src/state/types'
import { frame, put, run, start } from './_pilot'

/** 문 하나를 골라 그 앞 승강장에 세운다. 열차는 이미 서 있고 문은 열려 있다 */
const atDoor = (elapsedMs: number, opp = false): GameState => {
  const doorX = DOOR_XS[8] as number
  const y = (opp ? Y_OFFSET_OPP : 0) + 10.6
  return put({ ...start(7), elapsedMs, timeLeftMs: TRAIN.closeStartMs - elapsedMs }, doorX, y, FLOOR.B2)
}

/**
 * 문을 향해(월드 +y) 걸어 들어간다. 객실 바닥에 올라서면 `trainSystem` 이 탑승을 낸다.
 *
 * ⚠ `cameraYaw = 0` 에서 이동 변환은 `dirX = moveY`, `dirY = −moveX` 다
 * (`_pilot.ts seek` 와 같은 규약). **+y 로 가려면 `moveX: −1`** 이고,
 * `moveY` 를 주면 승강장을 따라 +x 로 걷는다 — 그러면 영원히 안 탄다.
 */
const walkIn = (s: GameState, steps = 210): GameState =>
  run(s, Array.from({ length: steps }, () => frame({ moveX: -1 })), 0)

/** 끝까지 굴려 엔딩을 받는다 — 열차가 떠나야 `tick` 이 `END` 를 낸다 */
const runToEnd = (s: GameState, maxSec = 30): GameState => {
  let cur = s
  for (let i = 0; i < maxSec * 60 && cur.phase !== 'ended'; i++) {
    cur = run(cur, [frame()], 0)
  }
  return cur
}

describe('탑승 결과 3종 — 실제 시뮬로 도달한다', () => {
  it('SUCCESS — 문이 넉넉히 열려 있을 때 타면 아슬아슬이 아니다', () => {
    // 문이 열린 직후(172.5s). 닫힘까지 7.5초 남았다
    const boarded = walkIn(atDoor(172_500))
    expect(boarded.boarded, '객실에 들어서지 못했다').toBe(true)
    expect(boarded.boardedTrain2).toBe(false)
    expect(boarded.boardedCloseInMs).not.toBeNull()
    expect(boarded.boardedCloseInMs!).toBeGreaterThan(TRAIN.justInTimeMs)

    const end = runToEnd(boarded)
    expect(end.phase).toBe('ended')
    expect(end.endingId, 'JUST IN TIME 이 아니어야 한다').not.toBe('E-04')
    expect(end.endingId).not.toBe('E-08')
  })

  it('JUST IN TIME — 닫히기 직전에 타면 E-04 다', () => {
    // 닫힘 시작 1초 전에 문 앞에 선다. 걸어 들어가는 사이 문은 닫히기 시작한다
    const boarded = walkIn(atDoor(TRAIN.closeStartMs - 1_000))
    expect(boarded.boarded, '닫히는 문으로 못 들어갔다').toBe(true)
    expect(boarded.boardedCloseInMs!).toBeLessThanOrEqual(TRAIN.justInTimeMs)

    expect(runToEnd(boarded).endingId).toBe('E-04')
  })

  it('WRONG WAY — 반대 방면 승강장에서 타면 E-08 이다', () => {
    const boarded = walkIn(atDoor(172_500, true))
    expect(boarded.boarded, '반대 방면 객실에 들어서지 못했다').toBe(true)
    expect(boarded.boardedTrain2, '탄 열차가 반대 방면으로 기록되지 않았다').toBe(true)
    expect(boarded.flags).toContain('OPPOSITE_SIDE')

    expect(runToEnd(boarded).endingId).toBe('E-08')
  })

  /**
   * ★ 이 테스트가 이번 변경의 핵심이다.
   *
   * 위치 트리거로 열차를 일찍 부르면 3분 예산은 그대로 흐르는데 문은 이미 열려 있다.
   * 예전 조건(`timeLeftMs <= 1000`)이면 **여유롭게 걸어 들어간 판에 「문틈 낑김」**이 떴다.
   * 문에 낀 적이 없는데도. 이제는 문 기준으로 재므로 그런 일이 없다.
   */
  it('일찍 온 열차에 여유 있게 타면, 전체 시간을 다 썼어도 문틈 낑김이 아니다', () => {
    const doorX = DOOR_XS[8] as number
    // 60초에 트리거 → 67.2초에 완전 개방. 그 뒤로는 실제 시간이 따라잡을 때까지 열려 있다
    const s = put(
      { ...start(7), elapsedMs: 179_500, timeLeftMs: 500, trainTriggerMs: 60_000 },
      doorX, 10.6, FLOOR.B2,
    )
    const boarded = walkIn(s)
    expect(boarded.boarded).toBe(true)
    // 자연 시계가 이미 179.5초라 닫힘까지 0.5초 미만 — 이 판은 실제로 아슬아슬하다
    expect(boarded.boardedCloseInMs!).toBeLessThanOrEqual(TRAIN.justInTimeMs)

    // 반대로, 문이 열리자마자 탄 판은 잔여 시간과 무관하게 여유가 있다
    const early = walkIn(put(
      { ...start(7), elapsedMs: 70_000, timeLeftMs: 110_000, trainTriggerMs: 60_000 },
      doorX, 10.6, FLOOR.B2,
    ))
    expect(early.boarded).toBe(true)
    expect(early.boardedCloseInMs!).toBeGreaterThan(TRAIN.justInTimeMs)
    expect(resolveEnding(early).id).not.toBe('E-04')
  })
})
