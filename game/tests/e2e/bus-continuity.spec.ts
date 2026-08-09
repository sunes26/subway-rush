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

  /** 외피 네 조각이 처음부터 끝까지 **같은 물건**이어야 한다 */
  const ids = out.map((s) => (s['bus'] as any[]).map((b) => b.uuid).join(','))
  for (let i = 1; i < ids.length; i++) {
    expect(ids[i], `${out[i]!['tag']} 에서 버스 객체가 바뀌었다`).toBe(ids[0])
  }
})

/**
 * ★ **화면의 같은 자리가 버스의 같은 구간을 보고 있는가.**
 *
 * 위 스냅샷은 "같은 물건인가"를 본다. 그런데 물건이 같아도 **보는 자리**가 훑고
 * 지나가면 사람 눈에는 다른 버스가 된다 — 실제로 그 지적이 나왔고, 스틸 네 장으로는
 * 그게 안 보였다(네 지점의 카메라 위치는 원래도 거의 같다). 문제는 그 **사이**에 있다.
 *
 * 그래서 화면 오른쪽 한 지점에서 레이를 쏴 **버스의 어느 x 를 맞히는지** 기록한다.
 * 이 값이 구간 내내 크게 흐르면 "다른 버스로 바뀌었다"가 된다.
 */
test('전환 구간 — 화면 같은 자리가 버스의 어느 구간을 보나', async ({ page }) => {
  test.setTimeout(300_000)
  await boot(page)
  const rows: { t: number; gap: number; x: number | null }[] = []
  for (const t of [SHOT.door - 200, 5000, 5400, 5800, 6200, INTRO_MS - 60]) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await frame(page)
    const r = await page.evaluate(() => {
      const p = window.__game!.introProbe()
      const camY = -p.cam[2]
      const bus = window.__game!.pick(0.55, -0.15).find((h: any) => /BUS_/.test(h.name))
      return {
        gap: +(camY - 21.73).toFixed(2),         // 외피 북면까지
        x: bus ? (bus.point[0] as number) : null,
        hit: bus ? bus.name : '(안 맞음)',
      }
    })
    rows.push({ t, gap: r.gap, x: r.x })
    console.log(`RAY t=${String(t).padStart(4)}  버스와 ${r.gap}m  →  ${r.hit} x=${r.x ?? '-'}`)
  }
  const xs = rows.map((r) => r.x).filter((v): v is number => v !== null)
  const sweep = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0
  const lost = rows.filter((r) => r.x === null).map((r) => r.t)
  console.log(`RAY 스윕 ${sweep.toFixed(2)}m · 버스를 놓친 시점 [${lost.join(', ')}]`)

  /**
   * ■ 이 수치가 무엇을 재는가
   *
   * 화면의 **같은 자리**가 버스의 어느 x 를 보고 있는지, 그 값이 전환 구간 동안
   * 얼마나 흐르는가다. 크게 흐르면 물건이 그대로여도 사람 눈에는 "다른 버스"가 된다.
   *
   * ■ 지금까지 줄인 경과
   *
   *   5.85m  최초 — 문 −60.3 · 하차 y 22.6
   *   4.70m  문을 동쪽 베이(−58.9)로 옮겨 동서 이동 2.2m → 0.8m
   *   3.40m  하차 지점 y 22.6 → 23.25 로 올려 버스와의 거리 변화를 줄임
   *
   * ■ ★ 남은 3.4m 는 **스폰 위치**에서 온다 — 여기서 더는 못 줄인다
   *
   * 인트로의 마지막 프레임은 반드시 FP 스폰 포즈와 같아야 하고(그 일치가 이
   * 인트로의 핵심 불변식이다), 스폰 (−58, 24) 은 외피 북면에서 **2.27m** 다.
   * 하차 지점이 1.5m 이므로 카메라가 버스에서 멀어지는 것 자체를 못 막는다 —
   * 같은 화각이면 닿는 지점이 그만큼 동쪽으로 밀린다.
   *
   * 더 줄이려면 `data/world.ts` 의 `SPAWN` 을 버스 쪽으로 당겨야 하는데 그건
   * **게임 시작 위치**라 이 작업의 범위 밖이다(부록 A 에 명시된 좌표이기도 하다).
   *
   * 그래서 임계값은 **"목표"가 아니라 "회귀 방지선"**이다. 목표치(≈2.5)는 스폰을
   * 옮기기로 할 때 같이 내린다.
   *
   * ⚠ 이 수치는 **레이 하나**로 재므로 프레임 타이밍에 따라 흔들린다(같은 코드에서
   *   3.40 / 3.68 을 봤다). 그래서 방지선을 실측 최대치 바로 위가 아니라 **여유를
   *   두고** 잡는다 — 너무 조이면 코드가 안 바뀌어도 빨간불이 뜨고, 그러면 이
   *   검사는 신호가 아니라 소음이 된다. 4.2 는 개선 전(5.85)보다 확실히 낮으면서
   *   관측된 흔들림(±0.3) 위다.
   */
  expect(sweep, `화면 같은 자리가 버스를 ${sweep.toFixed(2)}m 훑는다 (회귀)`).toBeLessThan(4.2)
})
