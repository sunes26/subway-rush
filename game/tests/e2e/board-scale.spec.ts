/**
 * 전광판 크기 대조 — 타이틀 / 엔딩 각각을 같은 조건으로 찍는다.
 * BEFORE/AFTER 를 눈으로 겹쳐 보기 위한 것이라 시각·시드·뷰포트를 고정한다.
 */
import { expect, test, type Page } from '@playwright/test'

const DIR = 'tests/e2e/__shots__/board'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForFunction(
    () => (document.getElementById('screen') as HTMLElement).innerHTML.length > 0,
    null, { timeout: 20_000 })
}

/** 판이 실제로 화면에서 몇 px 를 차지하는가 — 눈이 아니라 숫자로 남긴다 */
const boardBox = (page: Page, sel: string): Promise<{ w: number; h: number; pct: number }> =>
  page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    if (!el) return { w: -1, h: -1, pct: -1 }
    const r = el.getBoundingClientRect()
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      pct: Math.round(r.width / window.innerWidth * 1000) / 10,
    }
  }, sel)

test('전광판 — 타이틀', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  const b = await boardBox(page, '#screen .board.title')
  console.log(`BOX title  ${b.w}×${b.h}px  뷰포트의 ${b.pct}%`)
  expect(b.w).toBeGreaterThan(0)
  await page.screenshot({ path: `${DIR}/title.png` })
})

for (const [name, id] of [['fail', 'E-06'], ['success', 'E-02'], ['hidden', 'E-05']] as const) {
  test(`전광판 — 엔딩 ${name} (${id})`, async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await page.evaluate((e) => window.__game!.set({ phase: 'ended', endingId: e } as never), id)
    await page.waitForFunction(() => !!document.querySelector('#screen .board.result'),
      null, { timeout: 20_000 })
    const b = await boardBox(page, '#screen .board.result')
    console.log(`BOX ${name}  ${b.w}×${b.h}px  뷰포트의 ${b.pct}%`)
    expect(b.w).toBeGreaterThan(0)
    await page.screenshot({ path: `${DIR}/ending-${name}.png` })
  })
}
