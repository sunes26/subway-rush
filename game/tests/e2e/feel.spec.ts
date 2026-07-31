import { expect, test } from '@playwright/test'

/** W만 눌렀을 때 각 존에서 통로 밖으로 밀려나지 않는가 (조작감 회귀 방지) */
const CASES: readonly [string, number, number, number, string, number, number][] = [
  // zone, startX, startY, startZ, zoneId, 최소 x 전진, 허용 y 이탈
  ['Z1', -58, 26, 0, 'Z1', 12, 6],
  // y=10/20은 기둥 열이다(부록 A: x 12/24/36/48 × y 10/20). 정면으로 박으므로 사이로 시작한다
  ['Z2', 6, 16, -6, 'Z2', 12, 8],
  ['Z4', 76, 7, -6, 'Z4', 12, 4],
]

for (const [name, x, y, z, zone, minAdv, maxDrift] of CASES) {
  test(`${name} — W 직진 시 통로를 벗어나지 않는다`, async ({ page }) => {
    await page.goto('/?seed=42')
    await page.waitForFunction(() => !!window.__game, null, { timeout: 20_000 })
    await page.waitForTimeout(1200)
    await page.keyboard.press('Enter')
    await page.evaluate(([px, py, pz, zn]) => {
      const s = window.__game!.state()
      window.__game!.set({ zone: zn as never,
        player: { ...s.player, pos: { x: px as number, y: py as number, z: pz as number } } } as never)
    }, [x, y, z, zone] as const)
    await page.waitForTimeout(1600)
    const before = await page.evaluate(() => window.__game!.state().player.pos)
    await page.keyboard.down('w')
    await page.waitForTimeout(3000)
    await page.keyboard.up('w')
    const after = await page.evaluate(() => window.__game!.state().player.pos)
    expect(after.x - before.x, `${name} 전진`).toBeGreaterThan(minAdv)
    expect(Math.abs(after.y - before.y), `${name} 횡드리프트`).toBeLessThan(maxDrift)
  })
}

/**
 * 저더(덜컹거림) 계측.
 *
 * 시뮬은 고정 60Hz, 렌더는 가변이다. 보간 없이 시뮬 위치를 그대로 그리면
 * 한 프레임에 스텝이 0회 또는 2회 도는 경우가 섞이며 카메라가 계단처럼 튄다.
 * 등속 직진 중이라면 프레임간 이동량은 거의 일정해야 한다 — 그 분산을 본다.
 */
