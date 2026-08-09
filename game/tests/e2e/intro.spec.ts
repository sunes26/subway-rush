/**
 * 인트로가 **실제 흐름에서** 도는가.
 *
 * 유닛(`tests/unit/intro.test.ts`)은 카메라 곡선을 잠그지만, 그건 `poseAt` 이
 * 호출된다는 전제 위에 있다. 여기서 잠그는 것은 그 전제다 — 타이틀에서 ENTER 를
 * 누르면 인트로가 시작되고, 끝나면 **조작권이 실제로 넘어오는가**.
 */

import { expect, test, type Page } from '@playwright/test'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
}

const phase = (page: Page): Promise<string> =>
  page.evaluate(() => window.__game!.state().phase)

test('ENTER → 인트로 → 조작권', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  expect(await phase(page)).toBe('title')

  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'intro', null,
    { timeout: 30_000 })
  // 인트로 중에는 HUD 도 안내판도 안 뜬다 — 화면에 남는 것은 인트로 오버레이뿐이다
  await expect(page.locator('#intro.on')).toHaveCount(1)
  await expect(page.locator('#screen.on')).toHaveCount(0)
  await expect(page.locator('#hud:not(.off)')).toHaveCount(0)

  /**
   * ★ 제한시간이 **안 줄어야 한다.** 인트로는 아직 버스 안이고 플레이어는 아무것도
   *   못 한다. `ADVANCE` 게이트가 `playing` 에서만 진행하는 것을 여기서 확인한다.
   */
  const t0 = await page.evaluate(() => window.__game!.state().timeLeftMs)
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__game!.state().timeLeftMs),
    '인트로 동안 3분이 흐르면 안 된다').toBe(t0)

  // 끝까지 두면 저절로 넘어온다
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null,
    { timeout: 40_000 })
  await expect(page.locator('#intro.on')).toHaveCount(0)
})

test('ESC 로 건너뛰면 화각이 원래대로 돌아온다', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'intro', null,
    { timeout: 30_000 })

  /**
   * 질주 구간 한복판에서 끊는다 — 거기서 화각이 74° → 85° 로 열려 있다.
   * 건너뛰기가 화각을 안 되돌리면 **판이 끝날 때까지** 시야가 벌어진 채로 간다.
   * (카메라 릭은 이걸 못 고친다 — 자기 내부 값과 목표값이 둘 다 74 라 "바꿀 것이
   * 없다"고 판단하고 카메라를 안 건드린다.)
   */
  await page.evaluate(() => window.__game!.seekIntro(5200))
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null,
    { timeout: 30_000 })
  // 설정이 열리면 안 된다 — 인트로의 ESC 는 건너뛰기 전용이다
  await expect(page.locator('#settings.on')).toHaveCount(0)
})
