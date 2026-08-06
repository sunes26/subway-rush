/**
 * UI 킷 회귀 — 킷이 **썩지 않게** 잡아 두는 테스트.
 *
 * 킷은 게임의 실제 UI 코드를 구동하므로, UI 를 고치다 킷이 깨지면 그건 킷의 문제가
 * 아니라 **UI 의 문제일 수도** 있다. 그래서 확인하는 것은 두 가지뿐이다.
 *  1. 모든 프리셋이 콘솔 에러 없이 그려진다
 *  2. 각 프리셋이 **의도한 표면**을 실제로 띄운다 (프롬프트 프리셋인데 프롬프트가 없으면 실패)
 *
 * 스크린샷은 판정이 아니라 검토용 산출물이다 (P0 규약 — 베이스라인 비교를 쓰지 않는다).
 */

import { expect, test, type Page } from '@playwright/test'

const DIR = 'tests/e2e/__shots__/uikit'

/** 그룹별로 "이 프리셋이면 이게 켜져 있어야 한다" */
const EXPECT_ON: Readonly<Record<string, string>> = {
  '프롬프트': '#iprompt',
  '진행링': '#iring',
  '사유': '#ireason',
  '대화 3분기': '#dlg',
  'QTE': '#qte',
  '종합': '#iprompt',
}

const boot = async (page: Page): Promise<string[]> => {
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto('/uikit.html')
  await page.waitForFunction(() => document.querySelectorAll('#list button').length > 0,
    null, { timeout: 20_000 })
  await page.waitForTimeout(400)
  return errs
}

test('모든 프리셋이 의도한 표면을 띄운다', async ({ page }) => {
  test.setTimeout(180_000)
  const errs = await boot(page)

  const presets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#list button')].map((b) => ({
      id: b.dataset['id'] as string,
      group: (b.previousElementSibling?.classList.contains('grp')
        ? b.previousElementSibling.textContent
        : null) ?? '',
    })))
  expect(presets.length, '프리셋이 있다').toBeGreaterThan(15)

  // 그룹 라벨은 첫 버튼 앞에만 있으므로 앞에서부터 채워 내려간다
  let group = ''
  const failures: string[] = []
  for (const p of presets) {
    if (p.group) group = p.group
    await page.click(`#list button[data-id="${p.id}"]`)
    await page.waitForTimeout(260)

    const want = EXPECT_ON[group]
    if (want) {
      const cls = await page.getAttribute(want, 'class')
      if (!(cls ?? '').includes('on')) failures.push(`${p.id} (${group}): ${want} 가 꺼져 있다`)
    }
    // 인벤·양심은 상시 표시라 존재만 본다
    const base = await page.evaluate(() => ({
      slots: document.querySelectorAll('#hud-inv .slot').length,
      cons: !!document.getElementById('cons'),
    }))
    if (base.slots !== 3) failures.push(`${p.id}: 인벤 슬롯이 ${base.slots}개`)
    if (!base.cons) failures.push(`${p.id}: 양심 게이지 없음`)
  }
  expect(failures.join('\n')).toBe('')
  expect(errs.join(' | '), '콘솔 무결').toBe('')
})

test('킷과 게임이 같은 CSS·같은 토큰을 읽는다', async ({ page }) => {
  await boot(page)
  const kit = await page.evaluate(() => ({
    gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
    // 프롬프트 테두리색은 dialog.css 가 정한다 — 킷에 주입된 스타일이 그 파일에서 왔는지 본다
    promptBorder: getComputedStyle(document.getElementById('iprompt') as HTMLElement).borderTopColor,
  }))
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  const game = await page.evaluate(() => ({
    gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
    promptBorder: getComputedStyle(document.getElementById('iprompt') as HTMLElement).borderTopColor,
  }))
  expect(kit.gold, '토큰이 같다').toBe(game.gold)
  expect(kit.promptBorder, 'UI 스타일이 같다').toBe(game.promptBorder)
})

test('검토용 스크린샷 — 그룹 대표 상태', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  const reps = ['prompt-aimed', 'ring-story', 'deny-need', 'dlg-fish', 'qte-live',
    'inv-worn', 'cons-bad', 'combo-chase',
    'hud-calm', 'hud-crit', 'hud-stam-low', 'hud-lowbal']
  for (const id of reps) {
    await page.click(`#list button[data-id="${id}"]`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${DIR}/${id}.png` })
  }
})
