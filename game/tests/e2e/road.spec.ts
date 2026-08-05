/**
 * 차도 규칙 — 적신호에도 건너지만 차에 치이면 처음으로 돌아간다.
 *
 * 이 규칙만 단위 테스트로 못 덮는다. 차는 시뮬이 아니라 렌더 쪽에서 굴러가고
 * (앞차·신호를 보고 매 프레임 적분한다), 판정도 `main.ts` 의 프레임 루프에 있다.
 * 겹침 계산 자체는 `tests/unit/road-hazard.test.ts` 가 순수 함수로 덮으므로
 * 여기서는 **배선이 살아 있는가**만 본다 — 차선에 서 있으면 결국 스폰으로 돌아온다.
 *
 * 대기 시간을 넉넉히 준다. 두 방향이 반대 위상이라 서 있는 차선이면 다음 위상까지
 * 최대 한 주기(30초)를 기다려야 한다.
 */

import { expect, test, type Page } from '@playwright/test'

test.setTimeout(180_000)

const SPAWN = { x: -58, y: 24 } as const

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?freeplay')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60_000 })
  // 차량 GLB 는 부팅 경로 밖에서 로드된다 — 실제로 굴러갈 때까지 기다린다
  await page.waitForTimeout(4000)
}

const place = async (page: Page, x: number, y: number): Promise<void> => {
  await page.evaluate(({ px, py }: { px: number; py: number }) => {
    const g = window.__game!
    g.set({ phase: 'playing' })
    const st = g.state()
    g.set({
      player: {
        ...st.player,
        pos: { x: px, y: py, z: 0 },
        vel: { x: 0, y: 0 },
        vz: 0,
        grounded: true,
        moving: false,
        sprinting: false,
      },
    })
  }, { px: x, py: y })
}

const distFromSpawn = (p: { x: number; y: number }): number =>
  Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y)

test('차선 한복판에 서 있으면 차에 치여 스폰으로 돌아간다', async ({ page }) => {
  await boot(page)
  // 이면도로 남행 차선(x −28.8). 횡단보도 한복판이라 보행 녹색이면 차가 서 있고,
  // 적색으로 바뀌면 달려온다.
  await place(page, -28.8, 27.5)

  await expect.poll(async () => {
    const p = await page.evaluate(() => window.__game!.state().player.pos)
    // 치이면 스폰으로 순간이동하므로 거리로 본다 (플레이어는 스스로 안 움직인다)
    return distFromSpawn(p) < 1.0
  }, { timeout: 90_000, intervals: [500] }).toBe(true)
})

test('인도에 서 있으면 아무 일도 없다 — 오탐이 없다', async ({ page }) => {
  await boot(page)
  // 횡단보도 서쪽 인도. 차선(x −28.8 · −25.2)에서 4 m 넘게 떨어져 있다.
  await place(page, -34.0, 27.5)
  await page.waitForTimeout(20_000)
  const p = await page.evaluate(() => window.__game!.state().player.pos)
  expect(distFromSpawn(p), '인도에 서 있는데 되돌아갔다').toBeGreaterThan(1.0)
})
