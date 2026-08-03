/**
 * 개찰기 플랩 문 — **기본은 닫힘**, 통과 허가를 받은 게이트만 열린다.
 *
 * 이 테스트가 없으면 안 잡히는 회귀가 둘 있다.
 *
 *  1. **쉬는 자세가 열림으로 굳는다.** 예전 플랩은 진행 방향과 나란한 판이라
 *     늘 열린 것처럼 보였고, 렌더러는 그걸 옆으로 0.5 m 더 밀어냈다. 화면만 보면
 *     "문이 있다"고 착각하기 쉽다 — 그래서 **회전각을 직접 읽는다.**
 *  2. **보이는 문과 막는 벽이 갈라진다.** 충돌(`gateFlaps`)은 예전부터 닫힘 기준으로
 *     막고 있었다. 둘이 어긋나면 "안 막힌 것처럼 보이는데 안 지나가진다"가 된다.
 */

import { expect, test } from '@playwright/test'

test.setTimeout(240_000)

const HALF_PI = Math.PI / 2

/** `__scene` 은 main.ts 가 계측용으로만 붙이는 훅이라 Window 타입에 없다. */
type SceneNode = { name: string; rotation: { y: number } }
type SceneHook = { traverse(fn: (o: SceneNode) => void): void }

const rotations = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const out: Record<string, number> = {}
    const scene = (window as unknown as { __scene: SceneHook }).__scene
    scene.traverse((o) => {
      if (/^Z3_GATE_G\d_[NS]_flap$/.test(o.name)) out[o.name] = o.rotation.y
    })
    return out
  })

test('개찰기 문은 닫혀 있다가 통과 허가를 받은 게이트만 열린다', async ({ page }) => {
  await page.goto('/?freeplay&seed=1')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 90_000 })

  // ── 1) 처음에는 18장 전부 닫혀 있다
  const rest = await rotations(page)
  expect(Object.keys(rest), '플랩 문 18장이 씬에 있다').toHaveLength(18)
  for (const [name, ry] of Object.entries(rest)) {
    expect(Math.abs(ry), `${name} 은 쉬는 자세에서 닫혀 있다`).toBeLessThan(0.02)
  }

  // ── 2) 정상 게이트에 통과 허가를 주면 **그 게이트만** 열린다
  const gid = await page.evaluate(() => {
    const g = window.__game!
    g.set({ phase: 'playing' })
    const s = g.state()
    const id = s.gates.workingIds[0] as number
    g.set({ gates: { ...s.gates, state: 'open', activeId: id, timerMs: 9_999 } })
    return id
  })
  await page.waitForTimeout(900)

  const open = await rotations(page)
  for (const [name, ry] of Object.entries(open)) {
    const mine = new RegExp(`^Z3_GATE_G${gid}_`).test(name)
    if (mine) {
      // 90° 로 열려야 문이 하우징에 나란히 눕는다. 부호는 N/S 가 반대다.
      expect(Math.abs(ry), `${name} 은 열린다`).toBeGreaterThan(HALF_PI - 0.06)
      expect(Math.abs(ry), `${name} 이 90° 를 넘어가면 하우징을 뚫는다`).toBeLessThan(HALF_PI + 0.02)
    } else {
      expect(Math.abs(ry), `${name} 은 닫힌 채다`).toBeLessThan(0.02)
    }
  }
  const signs = Object.entries(open)
    .filter(([n]) => new RegExp(`^Z3_GATE_G${gid}_`).test(n))
    .map(([, v]) => Math.sign(v))
  expect(new Set(signs).size, 'N·S 문은 서로 반대 방향으로 열린다').toBe(2)

  // ── 3) 닫힌 문은 **실제로 통로를 막는다**
  //    회전각만 보면 "닫힌 자세인데 통로 밖에 서 있는" 형상을 못 잡는다.
  await page.evaluate(() => {
    const g = window.__game!
    const s = g.state()
    g.set({ gates: { ...s.gates, state: 'idle', activeId: null, timerMs: 0, cooldownMs: 9_999 } })
    g.set({ player: { ...g.state().player, pos: { x: 58.6, y: 8, z: -6 }, vel: { x: 0, y: 0 }, vz: 0, grounded: true } })
    g.look(0, -0.30)
  })
  await page.waitForTimeout(900)

  // 통로 중앙은 두 문이 맞물리는 이음새라 레이가 빠져나간다 — 살짝 비껴 쏜다
  for (const ndcX of [-0.05, 0.05]) {
    const hit = await page.evaluate((v) => window.__game!.pick(v, -0.1), ndcX)
    expect(hit[0]?.name, `ndcX ${ndcX}: 가장 먼저 맞는 것이 문이다`).toMatch(/^Z3_GATE_G1_[NS]_flap$/)
  }
})
