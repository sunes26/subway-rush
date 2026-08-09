/**
 * 항목별 QA — 지적 캡처와 **같은 시각**으로 잡는다.
 * BEFORE/AFTER 를 눈으로 겹쳐 볼 수 있어야 하므로 시각을 바꾸지 않는다.
 */
import { test, type Page } from '@playwright/test'
import { SHOT } from '../../src/render/intro'

const DIR = 'tests/e2e/__shots__/qa'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(900)
}

/** 지적받은 캡처의 시각 그대로 */
/**
 * ⚠ 시각을 **`SHOT` 에서 파생시킨다.** 원래는 지적 캡처와 겹쳐 보려고 숫자를
 *   그대로 박아 뒀는데, ② 를 늘리면서 샷 경계가 700ms 밀리자 `04` 가 예전 ③ 의
 *   **끝**이 아니라 새 ③ 의 **한복판**을 찍게 됐다 — 아직 사람이 안 나온 자리다.
 *   "같은 시각"이 아니라 **같은 순간**을 찍어야 BEFORE/AFTER 가 비교가 된다.
 */
const MARKS: readonly [string, number][] = [
  ['01_bus_interior_pose', 900],
  // ② 안 — 밀기가 끝나고 화면이 제일 큰 구간
  ['02_phone_readability', SHOT.interior + 600],
  ['03_phone_pose', SHOT.interior + 1050],
  // ③ 안 — 사람이 외피 밖으로 나온 뒤
  ['04_exit_framing', SHOT.door - 200],
  // ④ 초입 — 인도에 서서 역 쪽으로 도는 자리
  ['05_exit_continuity', SHOT.door + 300],
]

test('QA 프레임 — 01~05', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  for (const [name, t] of MARKS) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.evaluate(() => new Promise<void>((res) => {
      let n = 0
      const step = (): void => { if (++n >= 4) res(); else requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }))
    await page.screenshot({ path: `${DIR}/${name}.png` })
  }
})

/**
 * 07 — **네 샷이 정말 네 개인가.**
 *
 * 브리프가 요구한 것은 "컷 4개"지, 따라다니는 카메라가 아니다. 그래서 각 샷의
 * **안쪽 두 지점과 경계 직전·직후**를 찍는다. 한 샷 안의 두 장은 서로 비슷해야
 * 하고(자리에 서 있다), 경계를 낀 두 장은 확 달라야 한다(컷이다).
 */
const SEQ: readonly [string, number][] = [
  ['a_shot1_in', 700], ['b_shot1_end', 1340],
  ['c_shot2_in', 1460], ['d_shot2_end', 3440],
  ['e_shot3_in', 3560], ['f_shot3_end', 4740],
  ['g_shot4_in', 4860], ['h_shot4_end', 6400],
]

test('QA 프레임 — 07 샷 전환 시퀀스', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  for (const [name, t] of SEQ) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    // 시간이 아니라 **프레임**을 기다린다 — 소프트웨어 래스터에서 벽시계는 못 믿는다
    await page.evaluate(() => new Promise<void>((res) => {
      let n = 0
      const step = (): void => { if (++n >= 4) res(); else requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }))
    await page.screenshot({ path: `${DIR}/07_${name}.png` })
  }
})

test('QA 프레임 — 06 게임플레이 인계', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null,
    { timeout: 40_000 })
  await page.waitForTimeout(1100)
  await page.screenshot({ path: `${DIR}/06_gameplay_handoff.png` })
})
