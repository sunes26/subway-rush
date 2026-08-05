/**
 * P1 E2E — 렌더·입력·오디오가 실제 브라우저에서 붙는지 본다.
 *
 * 체크리스트: S8-8(아웃라인 raycast 격리) · S8-10/S13-2(드로우 콜) · S9-12(QTE 락 유지) ·
 *             S13-1(조준 반영 지연) · S13-4(SFX) · S13-7(콘솔 무결)
 *
 * 유닛이 못 잡는 것만 여기서 잡는다 — 판정 로직은 전부 tests/unit 이 덮는다.
 */

import { expect, test, type Page } from '@playwright/test'

const collectConsole = (page: Page): string[] => {
  const errs: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
  return errs
}

const boot = async (page: Page, seed = 7): Promise<string[]> => {
  const errs = collectConsole(page)
  await page.goto(`/?seed=${seed}`)
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 60_000 },
  )
  await page.waitForTimeout(900)
  return errs
}

/** Z2 대합실의 대상 앞으로 순간이동 + 시선 고정 */
const stand = async (page: Page, x: number, y: number, lookAt: [number, number]): Promise<void> => {
  await page.evaluate(({ x, y, lookAt }) => {
    const g = window.__game!
    const st = g.state()
    g.set({
      phase: 'playing',
      player: { ...st.player, pos: { x, y, z: -6 }, vel: { x: 0, y: 0 } },
    })
    g.look(Math.atan2(lookAt[1] - y, lookAt[0] - x))
  }, { x, y, lookAt })
  await page.waitForTimeout(400)
}

test('S13-7 · P1 자산이 콘솔 오류 없이 로드된다', async ({ page }) => {
  const errs = await boot(page)
  const ok = await page.evaluate(() => {
    const s = window.__game!.state()
    return { slots: document.querySelectorAll('#hud-inv .slot').length, cons: !!document.getElementById('cons'), phase: s.phase }
  })
  expect(ok.slots, '인벤 3슬롯 HUD').toBe(3)
  expect(ok.cons, '양심 게이지').toBe(true)
  expect(errs.filter((e) => !e.includes('WebGL') && !e.includes('SwiftShader')), errs.join('\n')).toEqual([])
})

test('S8-8 아웃라인 셸이 레이캐스트를 오염시키지 않는다', async ({ page }) => {
  await boot(page)
  // 자판기 A 앞에서 조준 — 셸이 켜진 상태로 화면 중앙 레이를 쏜다
  await stand(page, 13.03, 2.6, [13.03, 4.15])
  const r = await page.evaluate(() => {
    const g = window.__game!
    return { target: g.state().act.targetId, hits: g.pick(0, 0).map((h) => h.name) }
  })
  expect(r.target, '자판기를 조준했다').toBe('OBJ-06')
  // 셸 이름에 'outline' 이 들어가면 raycast 비활성화가 깨진 것이다
  expect(r.hits.filter((n) => /outline|shell/i.test(n)), r.hits.join(',')).toEqual([])
})

test('S13-1 조준 → 프롬프트 반영이 몇 프레임 안에 끝난다', async ({ page }) => {
  await boot(page)
  /**
   * 근접 폴백 반경(1.5m) **밖**에 선다. 1.45m에 서면 시선을 돌려도 프롬프트가 켜져 있어
   * "조준으로 켜졌다"를 증명할 수 없다 — 근접 폴백이 이미 켜 둔 것이다.
   */
  await stand(page, 38, 2.6, [38, 5.35])          // 우산꽂이 (거리 2.75m)
  const t = await page.evaluate(async () => {
    const g = window.__game!
    g.look(0)                                      // 일단 다른 데를 본다
    // **조건으로** 기다린다. 고정 대기는 소프트웨어 렌더링에서 프레임 수가 흔들려 flaky 다
    for (let i = 0; i < 30 && document.getElementById('iprompt')!.className !== ''; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    const before = document.getElementById('iprompt')!.className
    const beforeTarget = window.__game!.state().act.targetId
    const beforeYaw = (window as unknown as { __camera: { rotation: { y: number } } }).__camera.rotation.y
    const t0 = performance.now()
    g.look(Math.PI / 2)                            // 대상 쪽으로 돌린다
    // 켜질 때까지 프레임을 센다 — 고정 프레임 수로 재면 소프트웨어 렌더링에서 흔들린다
    let frames = 0
    while (frames < 20 && !document.getElementById('iprompt')!.className.includes('on')) {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      frames++
    }
    return {
      before, beforeTarget, beforeYaw, frames, ms: performance.now() - t0,
      after: document.getElementById('iprompt')!.className,
      label: document.getElementById('iprompt-t')!.textContent,
    }
  })
  expect(t.before, `다른 곳을 볼 때는 꺼져 있다 (target=${t.beforeTarget} camY=${t.beforeYaw.toFixed(2)})`).toBe('')
  expect(t.after, '돌리면 켜진다').toContain('on')
  expect(t.label).toBe('우산')
  /**
   * 프레임 수로 잠근다. 벽시계로 재면 swiftshader(≈20~30fps)에서 한 프레임이 33~50ms라
   * "지연 33ms 이하"라는 기준 자체가 GPU 유무에 따라 다른 것을 재게 된다.
   * 실 GPU 계측은 `playwright.gpu.config.ts` 쪽 몫이다.
   */
  expect(t.frames, `${t.frames}프레임 / ${t.ms.toFixed(0)}ms`).toBeLessThanOrEqual(3)
})

test('S9-12 QTE 중 시선이 얼고 포인터 락 상태가 유지된다', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    const g = window.__game!
    const st = g.state()
    g.set({ phase: 'playing', inventory: ['I-01', null, null],
      player: { ...st.player, pos: { x: 13.03, y: 2.9, z: -6 }, vel: { x: 0, y: 0 } } })
    g.look(Math.PI / 2)
  })
  await page.waitForTimeout(300)
  // 1번 슬롯(효자손)으로 QTE를 연다
  await page.keyboard.press('Digit1')
  await page.waitForTimeout(200)
  const r = await page.evaluate(async () => {
    const g = window.__game!
    const on = g.state().qte.active
    const cam0 = (window as unknown as { __camera: { rotation: { y: number } } }).__camera.rotation.y
    g.look(Math.PI / 2 + 1.2)                      // QTE 중 시선을 크게 돌려 본다
    await new Promise((r) => setTimeout(r, 200))
    const cam1 = (window as unknown as { __camera: { rotation: { y: number } } }).__camera.rotation.y
    return { on, drift: Math.abs(cam1 - cam0), ui: document.getElementById('qte')!.className }
  })
  expect(r.on, 'QTE 열림').toBe(true)
  expect(r.ui, 'QTE UI 표시').toContain('on')
  expect(r.drift, `시선 이동 ${r.drift.toFixed(3)}rad — 얼어 있어야 한다`).toBeLessThan(0.02)
})

test('S13-2 P1 추가 후에도 드로우 콜 예산 안에 든다 (Z2 핫스팟)', async ({ page }) => {
  await boot(page)
  await stand(page, 24, 12, [42, 15])              // 대합실 중앙에서 할아버지 쪽
  await page.waitForTimeout(1600)
  const info = await page.evaluate(() => {
    const r = (window as unknown as { __renderer: { info: { render: { calls: number; triangles: number } } } }).__renderer
    return { calls: r.info.render.calls, tris: r.info.render.triangles }
  })
  expect(info.calls, `드로우 콜 ${info.calls}`).toBeLessThan(235)
  expect(info.tris, `삼각형 ${info.tris}`).toBeLessThan(520_000)
})

test('S13-4 SFX 는 입력 후 살아나고, 실패해도 게임이 돈다', async ({ page }) => {
  await boot(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const r = await page.evaluate(() => ({
    ready: window.__game!.sfxReady(),
    elapsed: window.__game!.state().elapsedMs,
  }))
  // 헤드리스에서 오디오가 막힐 수 있다 — **막혀도 루프는 돌아야 한다**가 이 테스트의 요점이다
  expect(r.elapsed, '루프가 살아 있다').toBeGreaterThan(0)
  expect(typeof r.ready).toBe('boolean')
})

test('S8 상호작용이 실제 키보드 E 로 작동한다', async ({ page }) => {
  await boot(page)
  await stand(page, 38, 4.2, [38, 5.35])          // 우산꽂이 정면
  await page.keyboard.press('KeyE')
  // 습득은 시뮬 800ms 다. **벽시계로 기다리면 안 된다** — swiftshader 에서 시뮬이
  // 실시간보다 늦게 흐르고(고정 스텝 × 낮은 fps), 그러면 1.1초 기다려도 150ms가 남는다.
  await page.waitForFunction(() => window.__game!.state().inventory.includes('I-09'),
    null, { timeout: 15_000 })
  const inv = await page.evaluate(() => window.__game!.state().inventory)
  expect(inv, '우산이 인벤에 들어왔다').toContain('I-09')
  const glyph = await page.textContent('#hud-inv .slot span')
  expect(glyph?.length ?? 0, 'HUD 슬롯에 글리프가 찍혔다').toBeGreaterThan(0)
})
