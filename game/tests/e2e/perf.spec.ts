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
    // 1인칭 기준 예산.
    // 쿼터뷰는 위에서 내려다보며 한 존만 담았지만, 1인칭은 눈높이에서 통로를 따라
    // 멀리까지 본다 — 인접 존과 천장이 동시에 시야에 들어오므로 콜이 늘어난다.
    // 그레이박스 시절 목표 80 → 실물 120 → 1인칭 160 → 실내 마감 180.
    //
    // 마지막 상향의 근거: 로더가 **머티리얼별로 병합**하므로 드로우 콜 수 ≈ 머티리얼 종류다.
    // 원기둥 3종·점자블록 2종·줄눈·천장 리브·조명·덕트·노선띠를 넣으면서 Z2에서만
    // 머티리얼이 10종쯤 늘었다. 즉 이 증가분은 낭비가 아니라 **추가한 마감의 개수**다.
    // 진짜 상한은 여기가 아니라 `A-6 60fps 유지` 쪽이고, 실측 최저는 232 fps로 여유가 크다.
    // 이 값을 또 올려야 할 상황이 오면 머티리얼 통합부터 검토할 것.
    expect(v.calls, `${zone} draw calls`).toBeLessThan(180)
    expect(v.tris, `${zone} triangles`).toBeLessThan(120_000)
  }
})
