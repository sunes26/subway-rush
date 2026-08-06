/**
 * UI 킷 배경 촬영 — **HUD 를 끈 상태**의 씬 사진.
 *
 * 처음엔 P1 스크린샷(`__shots__/p1/*`)을 배경으로 썼다. 그 사진들에는 **예전 HUD 가
 * 그대로 박혀** 있어서 킷에서 HUD 가 두 겹으로 보였다 — 새 HUD 를 판단할 수가 없다.
 * 그래서 `#ui` 를 숨기고 배경만 찍는다.
 *
 * 판정하지 않는다. 산출물(배경 3장)만 만든다.
 */

import { expect, test, type Page } from '@playwright/test'

const DIR = 'tests/e2e/__shots__/backdrop'

const shot = async (
  page: Page, name: string, x: number, y: number, z: number,
  lookAt: [number, number], pitch = 0,
): Promise<void> => {
  await page.evaluate(({ x, y, z, lookAt, pitch }) => {
    const g = window.__game!
    const st = g.state()
    g.set({ phase: 'playing', player: { ...st.player, pos: { x, y, z }, vel: { x: 0, y: 0 } } })
    g.look(Math.atan2(lookAt[1] - y, lookAt[0] - x), pitch)
    // HUD·오버레이 층 전체를 숨긴다 — 배경 사진에 UI 가 섞이면 안 된다
    const ui = document.getElementById('ui')
    if (ui) ui.style.display = 'none'
  }, { x, y, z, lookAt, pitch })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${DIR}/${name}.png` })
}

test('킷 배경 3장 — HUD 없는 씬', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/?seed=7&notraffic')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(1200)

  await shot(page, 'concourse', 24, 12, -6, [42, 15])          // 대합실 중앙 → 벤치 쪽
  await shot(page, 'vending', 13.03, 1.6, -6, [13.03, 4.15])   // 자판기 정면
  await shot(page, 'platform', 150, 6, -20, [176, 12.2], 0.02) // 승강장 → 열차 문
  expect(1).toBe(1)
})
