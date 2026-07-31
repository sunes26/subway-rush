import { expect, test } from '@playwright/test'

/** S1-6 · S7-2 — 드로우 콜·삼각형 예산 검증 */
test('렌더 예산', async ({ page }) => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Enter')

  const results: Record<string, { calls: number; tris: number }> = {}
  const spots: readonly [string, number, number, number, string][] = [
    ['Z1', -58, 24, 0, 'Z1'],
    ['Z2', 30, 20, -6, 'Z2'],
    ['Z3', 57, 14, -6, 'Z3'],
    ['Z4', 104, 6.7, -13, 'Z4'],
    ['Z5', 130, 8, -20, 'Z5'],
  ]
  for (const [name, x, y, z, zone] of spots) {
    await page.evaluate(([px, py, pz, zn]) => {
      const s = window.__game!.state()
      window.__game!.set({ zone: zn as never,
        player: { ...s.player, pos: { x: px as number, y: py as number, z: pz as number } } } as never)
    }, [x, y, z, zone] as const)
    await page.waitForTimeout(1600)
    results[name] = await page.evaluate(() => {
      const r = (window as unknown as { __renderer?: { info: { render: { calls: number; triangles: number } } } }).__renderer
      return { calls: r?.info.render.calls ?? -1, tris: r?.info.render.triangles ?? -1 }
    })
  }
  console.log('RENDER BUDGET', JSON.stringify(results, null, 1))
  for (const [zone, v] of Object.entries(results)) {
    // S1-6 상한 120 · S7-2 목표 80
    expect(v.calls, `${zone} draw calls`).toBeLessThan(80)
    expect(v.tris, `${zone} triangles`).toBeLessThan(180_000)
  }
})
