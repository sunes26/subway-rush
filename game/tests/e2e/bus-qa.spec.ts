/** STEP QA — 단계별 눈 검사용. 판정은 사람이 한다. */
import { test, type Page } from '@playwright/test'
const DIR = 'tests/e2e/__shots__/bus'
const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(900)
  // 안내판·HUD 를 걷어낸다 — 버스만 봐야 한다
  await page.evaluate(() => window.__game!.set({ phase: 'playing' }))
  await page.waitForTimeout(300)
}
/** 자유 카메라 — 월드 좌표로 세우고 한 점을 본다 */
const cam = async (page: Page, p: [number, number, number], look: [number, number, number]) => {
  await page.evaluate(({ p, look }) => window.__game!.freeCam(p, look), { p, look })
  await page.waitForTimeout(700)
}
test('STEP 1 — 기존 버스만', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  // 버스 AABB: x −65.30~−54.40 · y 19.07~21.73 · z 0~3.25
  await cam(page, [-50, 28.5, 5.5], [-60, 20.4, 1.5])
  await page.screenshot({ path: `${DIR}/s1-exterior-3q.png` })
  await cam(page, [-59.9, 32, 1.9], [-59.9, 21.0, 1.6])     // 연석 쪽 측면 정면
  await page.screenshot({ path: `${DIR}/s1-exterior-side.png` })
})

test('STEP 2·3 — 실내 셸 · 좌석 · 창', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await page.evaluate(() => window.__game!.seekIntro(3000))
  await page.waitForTimeout(600)
  // 실내를 통로 서쪽 끝에서 길게 본다
  await cam(page, [-64.4, 20.45, 1.60], [-56.0, 20.55, 1.40])
  await page.screenshot({ path: `${DIR}/s2-aisle.png` })
  // 좌석 · 창 — 통로에서 북측을 본다
  await cam(page, [-63.6, 20.30, 1.55], [-61.4, 21.7, 1.30])
  await page.screenshot({ path: `${DIR}/s3-seats-windows.png` })
  // 문 칸
  await cam(page, [-62.6, 20.20, 1.60], [-60.3, 21.7, 1.30])
  await page.screenshot({ path: `${DIR}/s3-door.png` })
})

test('STEP 4 — 앉은 주인공', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await page.evaluate(() => window.__game!.seekIntro(3100))
  await page.waitForTimeout(700)
  await cam(page, [-60.55, 20.30, 1.42], [-62.08, 21.22, 1.02])
  await page.screenshot({ path: `${DIR}/s4-seated-3q.png` })
  await cam(page, [-62.08, 20.35, 1.30], [-62.08, 21.9, 1.02])
  await page.screenshot({ path: `${DIR}/s4-seated-side.png` })
  console.log('SIT', JSON.stringify(await page.evaluate(() => window.__game!.introProbe())))
})

for (const axis of ['x', 'z'] as const) {
  test(`STEP 4 축 실측 — sitaxis=${axis}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`/?seed=7&sitaxis=${axis}`)
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
    await page.waitForFunction(
      () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
      null, { timeout: 90_000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__game!.seekIntro(3100))
    await page.waitForTimeout(800)
    await cam(page, [-60.55, 20.30, 1.42], [-62.08, 21.22, 1.02])
    await page.screenshot({ path: `${DIR}/s4-axis-${axis}.png` })
    console.log('AXIS', axis, JSON.stringify(await page.evaluate(() => window.__game!.introProbe())))
  })
}
