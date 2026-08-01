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
    // 그레이박스 시절 목표 80 → 실물 120 → 1인칭 160 → 실내 마감 180 → 개찰구 증설 200.
    //
    // 로더가 **머티리얼별로 병합**하므로 병합분의 드로우 콜 수 ≈ 머티리얼 종류다.
    // 다만 게이트는 상태에 따라 색·위치가 바뀌어 **병합에서 제외**된다
    // (`DYNAMIC_NAME`: 플랩 2 · 사인면 1 · 바닥램프 1 = 게이트당 4개).
    //
    // 이번 상향의 근거는 마감이 아니라 구조 변경이다 — 개찰구를 6기 → 9기로 늘리면서
    // 동적 메시가 24 → 36개로 **+12** 늘었다. Z2 지점에서 게이트 뱅크가 시야에 들어온다.
    // 화장실을 새로 지으며 늘어난 머티리얼은 7종 → 2종으로 이미 통합했다(−4 콜).
    //
    // 진짜 상한은 여기가 아니라 `A-6 60fps 유지` 쪽이다.
    // 더 줄여야 하면 `render/gate-rig.ts`가 답이다 — 플랩을 InstancedMesh로 그리는
    // 구현이 이미 있는데 main.ts가 임포트하지 않아 죽어 있고, 살리면 18콜을 1콜로 줄인다.
    expect(v.calls, `${zone} draw calls`).toBeLessThan(200)
    expect(v.tris, `${zone} triangles`).toBeLessThan(120_000)
  }
})
