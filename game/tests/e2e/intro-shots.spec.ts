import { test, type Page } from '@playwright/test'
const DIR = 'tests/e2e/__shots__/intro'
const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(1200)
}
test('인트로 4샷', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  const marks: [string, number][] = [
    ['00-bus', 700], ['01-bus-late', 1500], ['02-phone', 2300], ['03-phone-beat', 2600],
    ['04-stopped', 3050], ['05-doors', 3600], ['06-rise', 4100], ['07-step', 4550],
    ['08-dash', 5100], ['09-dash-late', 5900], ['10-clock', 6350],
  ]
  for (const [name, t] of marks) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${DIR}/${name}.png` })
    console.log('P', name, JSON.stringify(await page.evaluate(() => window.__game!.introProbe())))
  }
  await page.evaluate((ms) => window.__game!.seekIntro(ms), 1200)
  await page.waitForTimeout(600)
  const probe = await page.evaluate(() => {
    const g = window.__game!
    const w = (window as unknown as { __scene?: unknown }).__scene
    return { phase: g.state().phase, cls: document.getElementById('intro')?.className, w: !!w }
  })
  console.log('PROBE', JSON.stringify(probe))
})
