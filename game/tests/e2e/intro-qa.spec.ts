/**
 * 항목별 QA — 지적 캡처와 **같은 시각**으로 잡는다.
 * BEFORE/AFTER 를 눈으로 겹쳐 볼 수 있어야 하므로 시각을 바꾸지 않는다.
 */
import { test, type Page } from '@playwright/test'

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
const MARKS: readonly [string, number][] = [
  ['01_bus_interior_pose', 900],
  ['02_phone_readability', 2000],
  ['03_phone_pose', 2450],
  ['04_exit_framing', 4100],
  ['05_exit_continuity', 4700],
]

test('QA 프레임 — 01~05', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  for (const [name, t] of MARKS) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${DIR}/${name}.png` })
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
