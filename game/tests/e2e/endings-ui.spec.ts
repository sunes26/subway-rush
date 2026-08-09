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
for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
  test(`도감 ${w}×${h}`, async ({ page }) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: w, height: h })
    await boot(page)
    await seed(page)
    await page.keyboard.press('KeyC')
    await page.waitForFunction(() => !!document.querySelector('#collection .slots'),
      null, { timeout: 30_000 })
    await page.click('#collection .slot[data-id="E-05"]')
    await page.waitForTimeout(250)
    /**
     * 눈으로 보기 전에 **숫자로 먼저 본다** — 18칸이 스크롤 없이 들어갔는지,
     * 제목이 몇 px 인지. "작아 보인다"는 판단은 재고 나서 한다.
     */
    const m = await page.evaluate(() => {
      const ul = document.querySelector('#collection .slots') as HTMLElement
      const s0 = document.querySelector('#collection .slot') as HTMLElement
      const nm = s0.querySelector('.name') as HTMLElement
      const dn = document.querySelector('#collection .d-name') as HTMLElement
      const r = s0.getBoundingClientRect()
      return {
        cols: getComputedStyle(ul).gridTemplateColumns.split(' ').length,
        slots: ul.children.length,
        slot: `${Math.round(r.width)}×${Math.round(r.height)}`,
        title: getComputedStyle(nm).fontSize,
        detail: getComputedStyle(dn).fontSize,
        scroll: ul.scrollHeight > ul.clientHeight + 1,
        docScroll: document.documentElement.scrollHeight > innerHeight + 1,
      }
    })
    console.log(`VP ${w}×${h}  ${m.slots}칸/${m.cols}열  슬롯 ${m.slot}  제목 ${m.title}  상세제목 ${m.detail}  그리드스크롤 ${m.scroll ? '★YES' : 'no'}  문서스크롤 ${m.docScroll ? '★YES' : 'no'}`)
    await page.screenshot({ path: `${DIR}/ui-collection-${w}.png` })
    expect(m.scroll).toBe(false)

    /**
     * ★ **선택 테두리는 잠금 여부와 무관하게 같아야 한다.**
     *
     * 한때 잠긴 칸이 `border-style:dashed` 라, 고르면 테두리가 점선 앰버가 되어
     * 해금 칸을 고를 때(실선 앰버)와 선택 표시가 달라 보였다. 눈으로는 "비슷한데"
     * 로 넘어가기 쉬우므로 **계산된 스타일을 직접 비교**한다.
     */
    await page.click('#collection .slot[data-id="E-14"]')
    await page.waitForTimeout(200)
    const pair = await page.evaluate(() => {
      const pick = (sel: string): Record<string, string> => {
        const c = getComputedStyle(document.querySelector(sel) as HTMLElement)
        return { w: c.borderTopWidth, s: c.borderTopStyle, c: c.borderTopColor }
      }
      // E-14 는 지금 선택된 잠긴 칸. E-05 를 다시 골라 해금 선택본을 잰다
      const locked = pick('#collection .slot.locked.sel')
      ;(document.querySelector('#collection .slot[data-id="E-05"]') as HTMLElement).click()
      const got = pick('#collection .slot.got.sel')
      return { locked, got }
    })
    console.log(`SEL ${w}  잠금선택 ${JSON.stringify(pair.locked)}  해금선택 ${JSON.stringify(pair.got)}`)
    expect(pair.locked, '선택 테두리가 잠금 여부에 따라 달라진다').toEqual(pair.got)

    // 잠긴 칸을 고른 상태의 화면도 남긴다
    await page.click('#collection .slot[data-id="E-14"]')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${DIR}/ui-collection-${w}-locked.png` })
  })
}
