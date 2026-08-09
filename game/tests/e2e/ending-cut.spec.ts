/**
 * 엔딩 컷 — **실제 플레이로** 잡는다.
 *
 * `seekOutro` 로 시각을 못 박아 찍는 방법도 있고 그쪽이 훨씬 싸다. 그런데 그건
 * 컷 함수가 내는 그림만 확인할 뿐, **판이 실제로 그 컷에 도달하는지**는 말해 주지
 * 않는다 — E-12 가 도달 불가인 채로 유닛 테스트를 통과하고 있었던 것과 같은 종류의
 * 사각이다. 그래서 여기서는 아무것도 못 박지 않는다:
 *
 *   실제 키 입력으로 시작 → 실제 열차 스케줄로 문이 열림 → 걸어 들어가 `BOARD`
 *   → `tick` 이 `END` 발행 → `main.ts` 가 컷을 켬 → 5.2초를 **실시간으로** 흘려보냄
 *
 * ⚠ 앞 2.5분(도보·자판기·개찰구)만 건너뛴다. 열차가 오기 직전 승강장에 세우는 것이
 *   전부이고, 그 뒤로는 손대지 않는다 — 탑승 판정도 종료 판정도 컷 시작도 전부
 *   실제 코드가 낸다.
 */

import { expect, test, type Page } from '@playwright/test'
import { TRAIN } from '../../src/data/tuning'
import { DOOR_XS, FLOOR, Y_OFFSET_OPP } from '../../src/data/world'
import { OUTRO_MS, SHOT } from '../../src/render/outro'

const DIR = 'tests/e2e/__shots__/ending'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(600)
}

/** 실제 키로 시작하고 인트로를 건너뛴다 — 게임이 쓰는 그 경로 그대로다 */
const startPlaying = async (page: Page): Promise<void> => {
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'intro', null, { timeout: 30_000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null, { timeout: 30_000 })
}

/**
 * 열차가 문을 여는 순간의 승강장에 세운다.
 *
 * ⚠ **시계를 미는 것까지가 건너뛰는 전부다.** 소프트웨어 래스터(swiftshader)에서는
 *   한 프레임이 수백 ms 라, 프레임당 시뮬이 `MAX_STEPS_PER_FRAME` 만큼밖에 못
 *   전진한다 — 실측으로 10초 동안 시뮬은 0.2초 흘렀다. 3분을 실시간으로 흘리는 것은
 *   이 환경에서 원리적으로 불가능하고, 기존 인트로 스펙들이 `seekIntro` 로 시각을
 *   못 박는 이유도 같다.
 *
 *   대신 **판정은 하나도 안 건드린다**: 문이 열리는지, 걸어 들어가 탑승이 성립하는지,
 *   열차가 떠나 엔딩이 나는지, 컷이 켜지는지는 전부 실제 코드가 낸다.
 *
 * @param opp 반대 방면 승강장이면 참
 */
const toPlatform = async (page: Page, opp: boolean): Promise<void> => {
  await page.evaluate(({ doorX, floorB2, stopMs, yOff }) => {
    const g = window.__game!
    const s = g.state()
    // 문이 완전히 열린 직후 — 여유 있게 걸어 들어가는 판이다
    const at = stopMs + 1_300
    g.set({
      elapsedMs: at,
      timeLeftMs: 180_000 - at,
      player: { ...s.player, pos: { x: doorX, y: 10.4 + yOff, z: floorB2 } },
    })
  }, {
    doorX: DOOR_XS[8] as number,
    floorB2: FLOOR.B2,
    stopMs: TRAIN.stopMs,
    yOff: opp ? Y_OFFSET_OPP : 0,
  })
}

/** 문이 열릴 때까지 기다렸다가 **실제 이동 입력**으로 걸어 들어간다 */
const walkIn = async (page: Page, opp: boolean): Promise<void> => {
  await page.waitForFunction(
    (o) => {
      const t = o ? window.__game!.state().train2 : window.__game!.state().train
      return (t.state === 'open' || t.state === 'closing') && t.doorProgress > 0.3
    },
    opp, { timeout: 40_000 })
  // 월드 +y 로 걷는다 — 시선이 동쪽(yaw 0)일 때 그 방향은 A 다
  await page.keyboard.down('a')
  await page.waitForFunction(() => window.__game!.state().boarded, null, { timeout: 120_000 })
  await page.keyboard.up('a')

  /**
   * 탑승 뒤 출발까지도 3초(문 닫힘 1.2 + 대기 0.8 + 출발 2)를 시뮬이 흘려야 한다.
   * 그 3초가 여기서는 수십 초라 시계만 출발 직전으로 민다 — **종료 판정은 그대로
   * `tick` 이 낸다**(`train.state === 'departed'` 를 보고 `END` 를 발행).
   */
  await page.evaluate(() => {
    const g = window.__game!
    g.set({ elapsedMs: 181_900, timeLeftMs: -1_900 })
  })
}

/**
 * 컷의 각 박자를 찍는다.
 *
 * ★ **찍을 때만 컷 시계를 고정한다**(`seekOutro`). 컷 자체는 실제 플레이가 켠
 *   것이고 여기서 다시 켜지 않는다 — 다만 이 환경에서는 스크린샷 한 장에 수십 초가
 *   걸려서(소프트웨어 래스터 + ReadPixels 스톨), 벽시계로 흐르게 두면 첫 장을 찍기도
 *   전에 5.2초가 끝난다. 실측으로 그랬다: 첫 장이 이미 결과판이었다.
 *   `render/intro.ts` 의 `seekIntro` 와 같은 이유·같은 수법이다.
 */
const shots = async (page: Page, tag: string, kind: 'success' | 'jit' | 'wrongway'): Promise<void> => {
  const marks: readonly [string, number][] = [
    ['1-body', 600],
    ['2-turn', SHOT.turn - 200],
    ['3-outside', SHOT.turn + 900],
    ['4-end', OUTRO_MS - 400],
  ]
  for (const [name, at] of marks) {
    await page.evaluate(([k, t]) => window.__game!.seekOutro(k as 'success', t as number),
      [kind, at] as [string, number])
    // 고정한 시각이 실제로 그려질 때까지 몇 프레임 흘린다
    await page.evaluate(() => new Promise<void>((res) => {
      let n = 0
      const step = (): void => { if (++n >= 4) res(); else requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }))
    await page.screenshot({ path: `${DIR}/${tag}-${name}.png` })
  }
}

const runCut = async (page: Page, opp: boolean, tag: string): Promise<string> => {
  await page.setViewportSize({ width: 960, height: 540 })
  await boot(page)
  await startPlaying(page)
  await toPlatform(page, opp)
  await walkIn(page, opp)

  // 탑승 → 출발 → 종료까지도 실제 시계로 기다린다(`TRAIN.boardDwellMs` + 2초)
  await page.waitForFunction(() => window.__game!.state().phase === 'ended', null, { timeout: 30_000 })
  const id = await page.evaluate(() => window.__game!.state().endingId!)
  await shots(page, tag, opp ? 'wrongway' : 'success')
  // 컷이 끝나면 결과판이 뜬다 — 그것까지가 한 판이다
  await page.evaluate(() => window.__game!.seekOutro('success', 99_999))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${DIR}/${tag}-5-board.png` })
  return id
}

test.describe('엔딩 컷 — 실제 플레이', () => {
  test.setTimeout(600_000)

  test('여유 있게 타면 성공 컷이 돌고 결과판으로 넘어간다', async ({ page }) => {
    const id = await runCut(page, false, 'success')
    // 문이 열리자마자 탔으므로 「문틈 낑김」이 아니어야 한다
    expect(id).not.toBe('E-04')
    expect(id).not.toBe('E-08')
  })

  test('반대 방면에 타면 WRONG WAY 컷이 돈다', async ({ page }) => {
    const id = await runCut(page, true, 'wrongway')
    expect(id).toBe('E-08')
  })
})
