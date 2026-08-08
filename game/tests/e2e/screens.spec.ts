/**
 * 화면 레이어 불변식 — **안내판과 HUD 는 절대 같이 뜨지 않는다.**
 *
 * 셋 다 한 번씩 실제로 틀렸던 방향이라 셋 다 잠근다.
 *  · 플레이 중에 안내판이 남아 있으면 화면 절반을 가린다
 *  · 타이틀에 HUD 가 비치면 아직 시작도 안 한 판의 3:00·스태미너 100%·
 *    소지품 0/10 이 다 보인다(예전 `00-title.png` 이 그랬다)
 *  · 엔딩에 HUD 가 비치면 결과와 같은 밝기로 겹쳐 어디를 읽을지 알 수 없다
 *
 * ⚠ **고정 대기로 재지 않는다.** 로딩이 끝난 직후 1~2초는 셰이더 컴파일·텍스처
 *   업로드로 프레임이 거의 안 돈다. 2.2초를 기다렸다가 "타이틀에도 안내판이
 *   없다"는 오판을 한 적이 있다 — 기다릴 것은 시간이 아니라 **첫 렌더**다.
 */

import { expect, test, type Page } from '@playwright/test'

const shown = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((x) => {
    const el = document.getElementById(x)
    return !!el && getComputedStyle(el).display !== 'none'
  }, id)

const boardHtmlLen = (page: Page): Promise<number> =>
  page.evaluate(() => (document.getElementById('screen') as HTMLElement).innerHTML.length)

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 20_000 },
  )
  // 워밍업이 끝나 **타이틀이 실제로 그려질 때까지** 기다린다
  await page.waitForFunction(
    () => (document.getElementById('screen') as HTMLElement).innerHTML.length > 0,
    null, { timeout: 20_000 },
  )
}

test('안내판은 타이틀·엔딩에만 뜨고, HUD 는 그 반대다', async ({ page }) => {
  await boot(page)

  // ── 타이틀 — 안내판만
  expect(await shown(page, 'screen'), '타이틀 안내판').toBe(true)
  expect(await shown(page, 'hud'), '타이틀 HUD 는 숨는다').toBe(false)
  await expect(page.locator('#screen .board.title')).toBeVisible()

  // ── 플레이 — HUD 만. **DOM 까지 비어야** 한다(숨기기만 하면 클릭을 먹는다)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing',
    null, { timeout: 20_000 })
  await page.waitForFunction(
    () => (document.getElementById('screen') as HTMLElement).innerHTML.length === 0,
    null, { timeout: 10_000 })
  expect(await shown(page, 'screen'), '플레이 중 안내판').toBe(false)
  expect(await boardHtmlLen(page), '플레이 중에는 DOM 도 비어 있다').toBe(0)
  expect(await shown(page, 'hud'), '플레이 중 HUD').toBe(true)

  // ── 엔딩 — 다시 안내판만
  await page.evaluate(() => window.__game!.set({ phase: 'ended', endingId: 'E-06' } as never))
  await page.waitForFunction(
    () => (document.getElementById('screen') as HTMLElement).innerHTML.length > 0,
    null, { timeout: 10_000 })
  expect(await shown(page, 'screen'), '엔딩 안내판').toBe(true)
  expect(await shown(page, 'hud'), '엔딩 HUD 는 숨는다').toBe(false)
  await expect(page.locator('#screen .board.result')).toBeVisible()
})
