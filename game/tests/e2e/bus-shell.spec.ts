/**
 * 실내 노출 QA — **밖에서 실내가 보이지 않는가.**
 *
 * ⚠ 실내 AABB 를 잴 때는 **정차 후**(`BUS_STOP_MS` 2900)에 재야 한다. 그 전에는
 *   `busDx(t)` 만큼 서쪽에 있어서 "0.62m 삐져나왔다"는 오판이 나온다 — 실제로 그랬다.
 *   움직이는 물체를 정지 기준과 비교하면 안 된다.
 */
import { expect, test, type Page } from '@playwright/test'
import { DOORS_MS, INTRO_MS, SHOT } from '../../src/render/intro'

const DIR = 'tests/e2e/__shots__/bus-qa2'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(() =>
    (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(600)
}
const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => {
  let n = 0
  const s = (): void => { if (++n >= 4) r(); else requestAnimationFrame(s) }
  requestAnimationFrame(s)
}))
/** 실내 셸이 켜져 있나 */
const shellOn = (page: Page): Promise<boolean | string> => page.evaluate(() => {
  const cam: any = (window as any).__camera
  let root: any = cam; while (root.parent) root = root.parent
  let sh: any = null
  root.traverse((x: any) => { if (x.name === 'intro-bus-shell') sh = x })
  return sh ? (sh.visible as boolean) : '없음'
})

test('실내 AABB 는 정차 후 외피 안에 들어간다', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  await page.evaluate(() => window.__game!.seekIntro(3200))   // 정차 완료 · 셸 아직 켜짐
  await frame(page)
  const r = await page.evaluate(() => {
    const cam: any = (window as any).__camera
    let root: any = cam; while (root.parent) root = root.parent
    let inner: any = null
    root.traverse((x: any) => { if (!inner && x.name === 'intro-bus-interior') inner = x })
    inner.updateWorldMatrix(true, true)
    let xmin = 1e9, xmax = -1e9, nmax = -1e9
    inner.traverse((o: any) => {
      if (!o.geometry) return
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox, m = o.matrixWorld.elements
      for (const X of [bb.min.x, bb.max.x]) for (const Y of [bb.min.y, bb.max.y]) for (const Z of [bb.min.z, bb.max.z]) {
        const wx = m[0] * X + m[4] * Y + m[8] * Z + m[12]
        xmin = Math.min(xmin, wx); xmax = Math.max(xmax, wx)
        nmax = Math.max(nmax, -(m[2] * X + m[6] * Y + m[10] * Z + m[14]))
      }
    })
    return { dx: +inner.position.x.toFixed(3), xmin: +xmin.toFixed(2), xmax: +xmax.toFixed(2), nmax: +nmax.toFixed(3) }
  })
  console.log(`AABB dx=${r.dx}  x ${r.xmin} ~ ${r.xmax}  최북단 ${r.nmax}  (외피 x −65.30~−54.40 · 옆판 21.58)`)
  expect(r.dx, '정차 후여야 한다').toBe(0)
  expect(r.xmin, '서쪽으로 안 나간다').toBeGreaterThan(-65.30)
  expect(r.xmax, '동쪽으로 안 나간다').toBeLessThan(-54.40)
  /**
   * ★ 북쪽(옆판 21.58)도 안 넘는다.
   *
   * 한동안 문짝·문틀 9면이 옆판을 +0.03~0.067 넘고 있었다 — 외피에 문 구멍이 없어서
   * 밖에서 보이려면 그래야 했다. 이제 구멍이 있으므로(`tools/hq_punch_bus_door.py`)
   * 문짝을 안으로 넣었고, 이 단정이 다시 밖으로 나가는 것을 막는다.
   */
  expect(r.nmax, '실내가 옆판을 넘는다').toBeLessThan(21.58)
})

const MARKS: readonly [string, number][] = [
  ['1_side_outside', SHOT.phone + 60],
  ['2_door_shut', DOORS_MS - 150],
  ['3_door_open', DOORS_MS + 700],
  ['4_after_exit', SHOT.door - 150],
  ['5_run', SHOT.door + 500],
]

test('밖에서 본 여섯 장면 — 실내가 안 보인다', async ({ page }) => {
  test.setTimeout(400_000)
  await boot(page)
  for (const [name, t] of MARKS) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await frame(page)
    const on = await shellOn(page)
    console.log(`SHELL ${name} t=${t}  셸=${on}`)
    // 밖으로 나간 뒤(SHOT.phone 이후)에는 반드시 꺼져 있어야 한다
    if (t >= SHOT.phone) expect(on, `${name} 에서 실내가 켜져 있다`).toBe(false)
    await page.screenshot({ path: `${DIR}/${name}.png` })
  }
  /**
   * 인트로 종료 후 게임 첫 화면.
   *
   * ⚠ **`freeCam` 보다 먼저 해야 한다.** `main.ts` 는 `freeCamAt` 이 있으면 인트로
   *   분기를 아예 안 타므로 `endIntro()` 가 안 돌고 `phase` 가 `playing` 이 안 된다 —
   *   실제로 그 순서로 짜서 30초 타임아웃을 봤다.
   */
  await page.evaluate((ms) => window.__game!.seekIntro(ms), INTRO_MS)
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null, { timeout: 30_000 })
  await frame(page)
  const after = await shellOn(page)
  console.log(`SHELL gameplay  셸=${after}`)
  expect(after, '게임 시작 후에도 실내가 켜져 있다').toBe(false)
  await page.screenshot({ path: `${DIR}/7_gameplay.png` })

  // 서쪽(후면) 끝을 따로 본다 — 삐져나온 게 있으면 여기서 바로 보인다
  await page.evaluate(() => window.__game!.freeCam([-67.5, 23.4, 1.9], [-62.0, 20.6, 1.6]))
  await frame(page)
  await page.screenshot({ path: `${DIR}/6_rear_west.png` })
})
