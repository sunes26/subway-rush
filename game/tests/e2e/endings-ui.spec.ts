/**
 * 엔딩 결과 화면 · 도감 화면의 **눈 검사용 캡처**.
 *
 * 단정이 거의 없다 — 레이아웃은 사람이 봐야 한다. 대신 **세 상태가 다 나오는
 * 세이브를 심어** 잠금·해금·선택이 한 장에 같이 잡히게 한다. 실제 플레이로
 * 7종을 따는 것을 기다리면 캡처가 판마다 달라져 비교가 안 된다.
 */
import { expect, test, type Page } from '@playwright/test'
const DIR = 'tests/e2e/__shots__/board'
const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(() =>
    (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForFunction(() =>
    (document.getElementById('screen') as HTMLElement).innerHTML.length > 0,
    null, { timeout: 30_000 })
}
/** 세이브를 심어 "일부 해금" 상태를 만든다 — 도감이 세 상태를 다 보여줘야 한다 */
const seed = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    localStorage.setItem('subway-rush.save.v1', JSON.stringify({
      v: 1, plays: 23,
      endings: {
        'E-01': { seen: 9, bestMs: 4200 }, 'E-02': { seen: 3, bestMs: 41000 },
        'E-04': { seen: 2, bestMs: 800 },  'E-06': { seen: 6, bestMs: 0 },
        'E-08': { seen: 1, bestMs: 22000 }, 'E-13': { seen: 1, bestMs: 0 },
        'E-05': { seen: 1, bestMs: 63000 },
      },
    }))
  })
}
test('결과 화면 3종', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  for (const [n, id] of [['fail', 'E-06'], ['success', 'E-02'], ['hidden', 'E-05']] as const) {
    await page.evaluate((e) => window.__game!.set({ phase: 'ended', endingId: e } as never), id)
    await page.waitForFunction(() => !!document.querySelector('#screen .board.result'),
      null, { timeout: 60_000 })
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${DIR}/ui-result-${n}.png` })
  }
  expect(true).toBe(true)
})
test('도감', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  await seed(page)
  await page.keyboard.press('KeyC')
  await page.waitForFunction(() => !!document.querySelector('#collection .cx'),
    null, { timeout: 30_000 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${DIR}/ui-collection.png` })
  // 해금된 칸을 골라 상세를 본다
  await page.click('#collection .slot[data-id="E-05"]')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${DIR}/ui-collection-sel.png` })
  expect(true).toBe(true)
})
