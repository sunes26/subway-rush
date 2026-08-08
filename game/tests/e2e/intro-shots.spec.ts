import { SHOT } from '../../src/render/intro'
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
  /**
   * ⚠ 시각을 **`SHOT` 에서 뽑는다.** 밀리초를 박아 뒀다가 ② 가 700ms 길어지자
   *   이름과 그림이 어긋났다 — `04-stopped` 는 ② 폰 OTS 를, `06-rise`(기립)는
   *   기립이 이미 끝난 ③ 을 찍고 있었다. **통과는 하는데 딴 걸 찍는다.**
   *   스크린샷 스펙은 단정이 없어서 이런 어긋남을 스스로 못 잡는다.
   */
  const marks: [string, number][] = [
    ['00-bus', 700], ['01-bus-late', SHOT.interior - 100],
    ['02-phone', SHOT.interior + 500], ['03-phone-beat', SHOT.interior + 1100],
    ['04-stopped', SHOT.phone - 200], ['05-doors', SHOT.phone + 300],
    ['06-rise', SHOT.phone + 700], ['07-step', SHOT.door - 150],
    ['08-dash', SHOT.door + 400], ['09-dash-late', SHOT.dash - 700],
    ['10-clock', SHOT.dash - 120],
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
