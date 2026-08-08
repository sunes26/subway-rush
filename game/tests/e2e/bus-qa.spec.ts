/** STEP QA — 단계별 눈 검사용. 판정은 사람이 한다. */
import { DOORS_MS, SHOT } from '../../src/render/intro'
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

/** STEP 5·6 — 네 샷을 실제 인트로 카메라로 찍는다 */
test('STEP 5·6 — 4샷', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  /**
   * ⚠ `SHOT` 파생. 박아 둔 밀리초는 ② 가 길어지면서 전부 밀렸다 —
   *   `c3-door-open`(3250)은 ② 폰을, `c5-handoff-*`(5500~5790)은 인계(6500)보다
   *   한참 앞을 찍고 있었다. 이름이 가리키는 **순간**을 찍게 되돌린다.
   */
  const marks: [string, number][] = [
    ['c1-interior', 700], ['c2-ots', SHOT.interior + 700],
    ['c2-ots-late', SHOT.phone - 900],
    ['c3-door-shut', DOORS_MS - 120], ['c3-door-open', SHOT.phone + 200],
    ['c3-alight', SHOT.phone + 800], ['c3-peak', SHOT.phone + 950],
    ['c3-out', SHOT.door - 150],
    ['c4-run', SHOT.door + 300], ['c4-late', SHOT.dash - 900],
    ['c5-handoff-a', SHOT.dash - 400], ['c5-handoff-b', SHOT.dash - 200],
    ['c5-handoff-c', SHOT.dash - 60],
  ]
  for (const [name, t] of marks) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.waitForTimeout(650)
    await page.screenshot({ path: `${DIR}/${name}.png` })
    console.log('P', name, JSON.stringify(await page.evaluate(() => window.__game!.introProbe())))
  }
})

for (const sign of ['1', '-1'] as const) {
  test(`팔 방향 실측 — armsign=${sign}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`/?seed=7&armsign=${sign}`)
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
    await page.waitForFunction(
      () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
      null, { timeout: 90_000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__game!.seekIntro(2100))
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${DIR}/arm-${sign}.png` })
    console.log('ARM', sign, JSON.stringify(await page.evaluate(() => window.__game!.introProbe())))
  })
}

/** ③ 샷 카메라 자리에서 **실내 없이** 찍는다 — 회백색의 정체를 가른다 */
test('대조 — ③ 카메라 · 실내 없음', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await cam(page, [-54.6, 26.0, 1.95], [-60.1, 22.1, 1.15])
  await page.screenshot({ path: `${DIR}/ctl-no-interior.png` })
})

for (const q of ['', '&nointerior'] as const) {
  test(`③ A/B — 실내${q ? ' 없음' : ' 있음'}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`/?seed=7${q}`)
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
    await page.waitForFunction(
      () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
      null, { timeout: 90_000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__game!.seekIntro(3980))
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${DIR}/ab-${q ? 'off' : 'on'}.png` })
  })
}

test('③ 흰 면의 정체', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await page.evaluate(() => window.__game!.seekIntro(3400))
  await page.waitForTimeout(800)
  for (const [nx, ny] of [[-0.19, 0.31], [-0.45, 0.20], [-0.62, 0.05]] as const) {
    const hits = await page.evaluate(([x, y]) => window.__game!.pick(x, y), [nx, ny])
    console.log('PICK', nx, ny, JSON.stringify(hits.slice(0, 4)))
  }
})

for (const q of ['', '&nointerior'] as const) {
  test(`③ 차체 픽 — 실내${q ? ' 없음' : ' 있음'}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`/?seed=7${q}`)
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
    await page.waitForFunction(
      () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
      null, { timeout: 90_000 })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__game!.seekIntro(3980))
    await page.waitForTimeout(800)
    for (const [nx, ny] of [[0.41, -0.19], [0.62, -0.28]] as const) {
      const hits = await page.evaluate(([x, y]) => window.__game!.pick(x, y), [nx, ny])
      console.log('BODY', q || 'ON', nx, JSON.stringify(hits.slice(0, 3)))
    }
  })
}

test('팔·폰 실측 + 좌석 방향', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  for (const t of [700, 2100]) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    // 프레임이 실제로 그 시각으로 넘어갈 때까지 기다린다 — 벽시계로는 안 맞는다
    await page.waitForFunction((ms) => {
      const a = window.__game!.introProbe().actor
      return Math.abs(a[0] - window.__game!.introProbe().actor[0]) < 1e-9 && ms > 0
    }, t, { timeout: 20_000 })
    await page.waitForTimeout(900)
    console.log('ARM', t, JSON.stringify((await page.evaluate(() => window.__game!.introProbe())).arm))
  }
  // 좌석 두 벌을 정측면에서 — 등받이가 어느 쪽인지 눈으로 본다
  await cam(page, [-62.5, 19.9, 1.05], [-59.0, 20.6, 0.95])
  await page.screenshot({ path: `${DIR}/seat-facing.png` })
})

/** §10 최종 QA — 여섯 장면 + 게임플레이 첫 프레임 */
test('QA — 여섯 프레임', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)
  const marks: [string, number][] = [
    ['qa-A-seated', 800], ['qa-B-phone', 2150], ['qa-C-door', 3150],
    ['qa-D-exit', 3860], ['qa-E-run', 5000],
  ]
  for (const [name, t] of marks) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${DIR}/${name}.png` })
  }
  // F — 인트로를 실제로 끝까지 흘려보내고 게임플레이 첫 프레임
  await page.evaluate(() => window.__game!.seekIntro(5750))
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null,
    { timeout: 20_000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${DIR}/qa-F-gameplay.png` })
  console.log('F phase', await page.evaluate(() => window.__game!.state().phase))
})
