/**
 * P1 시각 확인용 스크린샷. **판정은 하지 않는다** — 사람이 보는 산출물이다.
 *
 * 이 리포는 스크린샷 베이스라인 비교를 쓰지 않는다(P0 규약). 정확성은 유닛·E2E가 맡고
 * 이 파일은 "골드 아웃라인이 실제로 금색인가", "대화 UI가 안 잘리는가" 같은
 * **눈으로만 판단되는 것**을 남긴다.
 */

import { test, type Page } from '@playwright/test'

const DIR = 'tests/e2e/__shots__/p1'

const boot = async (page: Page, seed = 7): Promise<void> => {
  await page.goto(`/?seed=${seed}`)
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 },
  )
  await page.waitForTimeout(1000)
}

const place = async (
  page: Page, x: number, y: number, lookAt: [number, number],
  patch: Record<string, unknown> = {}, pitch = 0,
): Promise<void> => {
  await page.evaluate(({ x, y, lookAt, patch, pitch }) => {
    const g = window.__game!
    const st = g.state()
    g.set({ phase: 'playing', ...patch,
      player: { ...st.player, pos: { x, y, z: -6 }, vel: { x: 0, y: 0 } } })
    g.look(Math.atan2(lookAt[1] - y, lookAt[0] - x), pitch)
  }, { x, y, lookAt, patch, pitch })
  await page.waitForTimeout(900)
}

test('P1 스크린샷 — 아웃라인 · 대화 · QTE · HUD', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)

  // 1) 골드 아웃라인 + 프롬프트 — 우산꽂이 조준
  await place(page, 38, 2.7, [38, 5.35])
  await page.screenshot({ path: `${DIR}/01-outline-umbrella.png` })

  // 2) 인벤 3슬롯 (아이템을 채워 보여준다)
  await place(page, 30, 12, [42, 15], {
    inventory: ['I-01', 'I-06', 'I-12'],
    scores: { style: 2, knowledge: 1 },
    flags: ['MASK_ON', 'GRANDPA_HELPED'],
  })
  await page.screenshot({ path: `${DIR}/02-hud-inventory.png` })

  // 3) 할아버지 3분기 대화 UI (붕어빵 보유 → [2] 활성)
  await place(page, 42, 13.3, [42, 14.9], { inventory: ['I-12', null, null] })
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${DIR}/03-dialog-grandpa.png` })
  await page.keyboard.press('Escape')

  // 4) 자판기 QTE 게이지. 0.8m 에서는 발광 패널이 화면을 다 먹으므로 한 발 물러선다
  await place(page, 13.03, 2.1, [13.03, 4.15], { inventory: ['I-01', null, null] })
  await page.keyboard.press('Digit1')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/04-qte-vending.png` })
  await page.keyboard.press('Escape')

  /**
   * 5) 단소 추격 — 할아버지가 일어서서 따라온다.
   *
   * 벤치는 동쪽(x 42)이므로 **동쪽을 봐야** 쫓아오는 게 들어온다. 그리고 **시선을 내려야**
   * 한다 — 3등신 SD 는 키가 1.2m 라 1.2m 거리에서는 눈높이(1.62m)보다 19° 아래에 있어
   * HUD 하단에 가린다. 실제 플레이에서도 가까이 붙으면 내려다보게 된다.
   */
  await place(page, 36, 13.5, [42, 13.9], {
    inventory: ['I-01', null, null],
    flags: ['GRANDPA_ANGRY'],
  }, -0.28)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: `${DIR}/05-chase-danso.png` })

  // 6) 엔딩 화면 — 4축 채점 표시
  await page.evaluate(() => {
    const g = window.__game!
    g.set({ phase: 'ended', endingId: 'E-14', boarded: true, timeLeftMs: 24_000,
      scores: { style: 4, knowledge: 4 },
      tally: { coinsEarned: 3500, itemsUsed: ['I-01', 'I-06', 'I-09', 'I-12'],
        secrets: ['a', 'b', 'c', 'd'], pushes: 0, crowdMs: 41_000, staminaMin: 34 } })
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${DIR}/06-ending-e14.png` })
})
