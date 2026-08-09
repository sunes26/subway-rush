/**
 * 버스 연속성 — **하차한 버스와 게임 시작 버스가 같은 물건인가.**
 *
 * 눈으로 "다른 버스 같다"를 판정하지 않는다. 네 시점에서 외피 메시의 **uuid ·
 * 위치 · 재질**과 **카메라 · 주인공의 transform** 을 같이 찍어, 무엇이 바뀌었는지
 * 값으로 가른다. 물건이 바뀐 것과 보는 자리가 바뀐 것은 고치는 데가 다르다.
 */
import { expect, test, type Page } from '@playwright/test'
import { INTRO_MS, SHOT } from '../../src/render/intro'

const DIR = 'tests/e2e/__shots__/bus-cont'

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
  const step = (): void => { if (++n >= 4) r(); else requestAnimationFrame(step) }
  requestAnimationFrame(step)
}))

type Snap = Record<string, unknown>

const snap = (page: Page, label: string): Promise<Snap> => page.evaluate((tag) => {
  const cam: any = (window as any).__camera
  let root: any = cam; while (root.parent) root = root.parent
  const n3 = (v: number): number => Math.round(v * 100) / 100

  /** 외피 네 조각 — 이름·uuid·재질·월드 transform */
  const parts: any[] = []
  for (const nm of ['BUS_BODY', 'BUS_GLASS', 'BUS_TRIM', 'BUS_ROOF']) {
    let o: any = null
    root.traverse((x: any) => { if (!o && x.name === `merged:${nm}`) o = x })
    if (!o) { parts.push({ nm, missing: true }); continue }
    o.updateWorldMatrix(true, false)
    const m = o.matrixWorld.elements
    parts.push({
      nm, uuid: o.uuid.slice(0, 8), geo: o.geometry?.uuid.slice(0, 8),
      mat: Array.isArray(o.material) ? o.material.map((x: any) => x.uuid.slice(0, 8)).join('|')
        : o.material?.uuid.slice(0, 8),
      vis: o.visible,
      pos: [n3(m[12]), n3(m[14] * -1), n3(m[13])],   // 월드 x, y(북), z(상)
      scl: [n3(Math.hypot(m[0], m[1], m[2])), n3(Math.hypot(m[4], m[5], m[6]))],
    })
  }
  /** 인트로 실내 — 있으면 어디에 */
  let inner: any = null
  root.traverse((x: any) => { if (!inner && x.name === 'bus-interior') inner = x })

  const C = cam.matrixWorld.elements
  const st = (window as any).__game.state()
  return {
    tag,
    bus: parts,
    interior: inner ? { vis: inner.visible, x: n3(inner.position.x) } : null,
    cam: [n3(C[12]), n3(-C[14]), n3(C[13])],
    player: [n3(st.player.pos.x), n3(st.player.pos.y), n3(st.player.pos.z)],
    facing: n3(st.player.facing),
    phase: st.phase,
  }
}, label)

test('버스 연속성 — A 하차직전 · B 하차직후 · C 3:00 · D 게임첫프레임', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)

  const out: Snap[] = []
  const marks: readonly [string, string, number][] = [
    ['01_exit_bus', 'A 하차직전', SHOT.door - 300],
    ['02_countdown_bus', 'B 하차직후', SHOT.door + 300],
    ['03_before_handoff_bus', 'C 3:00', INTRO_MS - 120],
  ]
  for (const [file, tag, t] of marks) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await frame(page)
    out.push(await snap(page, tag))
    await page.screenshot({ path: `${DIR}/${file}.png` })
  }

  // D — 인트로를 끝까지 보내 조작권이 넘어온 첫 프레임
  await page.evaluate((ms) => window.__game!.seekIntro(ms), INTRO_MS)
  await page.waitForFunction(() => window.__game!.state().phase === 'playing',
    null, { timeout: 30_000 })
  await frame(page)
  out.push(await snap(page, 'D 게임첫프레임'))
  await page.screenshot({ path: `${DIR}/04_gameplay_bus.png` })

  for (const s of out) console.log('SNAP ' + JSON.stringify(s))
  expect(out.length).toBe(4)
})
