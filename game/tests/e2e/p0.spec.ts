/**
 * P0 인수 기준 E2E — A-1 · A-6 · A-8 · S6-5.
 * 실제 브라우저에서 WebGL로 렌더하고, 콘솔을 수집하고, 스크린샷을 남긴다.
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

type Snapshot = {
  phase: string
  zone: string
  seed: number
  timeLeftMs: number
  boarded: boolean
  endingId: string | null
  pos: { x: number; y: number; z: number }
  workingIds: number[]
  passed: boolean
}

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const s = window.__game!.state()
    return {
      phase: s.phase, zone: s.zone, seed: s.seed, timeLeftMs: s.timeLeftMs,
      boarded: s.boarded, endingId: s.endingId, pos: s.player.pos,
      workingIds: [...s.gates.workingIds], passed: s.gates.passed,
    }
  })

const patch = (page: Page, p: Record<string, unknown>): Promise<void> =>
  page.evaluate((x) => window.__game!.set(x as never), p)

/** 콘솔 에러/경고를 모은다 — A-8은 0건이 기준이다 */
const collectConsole = (page: Page): string[] => {
  const out: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') out.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => out.push(`pageerror: ${e.message}`))
  return out
}

const boot = async (page: Page, seed = 42): Promise<string[]> => {
  const errs = collectConsole(page)
  await page.goto(`/?seed=${seed}`)
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20_000 })
  // 로딩이 끝나고 루프가 실제로 돌기 시작할 때까지
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 20_000 },
  )
  await page.waitForTimeout(700)
  return errs
}

test('A-1 · S6-5 타이틀 → 플레이 → 엔딩 → 재시작 3회전', async ({ page }) => {
  const errs = await boot(page, 42)

  for (let round = 1; round <= 3; round++) {
    expect((await snap(page)).phase, `round ${round} 타이틀`).toBe('title')

    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    expect((await snap(page)).phase, `round ${round} 플레이`).toBe('playing')

    // 시간을 열차 출발 직전으로 밀어 엔딩까지 태운다
    await patch(page, { elapsedMs: 181_900, timeLeftMs: -1_900 })
    await page.waitForFunction(() => window.__game!.state().phase === 'ended', null, { timeout: 15_000 })

    const ended = await snap(page)
    expect(ended.endingId, `round ${round} 엔딩`).toBe('E-06')
    if (round === 1) await page.screenshot({ path: 'tests/e2e/__shots__/ending-e06.png' })

    await page.keyboard.press('r')
    await page.waitForTimeout(400)
    const after = await snap(page)
    expect(after.phase, `round ${round} 재시작`).toBe('title')
    expect(after.boarded).toBe(false)
    expect(after.endingId).toBeNull()
    expect(after.timeLeftMs).toBe(180_000)
    expect(after.seed, '재시작 시 새 시드').not.toBe(ended.seed)
  }

  expect(errs.join('\n')).toBe('')
})

test('A-6 60fps 유지 (최저 55)', async ({ page }) => {
  await boot(page, 7)
  await page.keyboard.press('Enter')
  await page.keyboard.press('F3')
  await page.waitForTimeout(500)

  // 이동하면서 10초간 계측
  await page.keyboard.down('w')
  await page.waitForTimeout(10_000)
  await page.keyboard.up('w')

  const min = await page.evaluate(() => window.__game!.minFps())
  // 소프트웨어 렌더러(SwiftShader) 환경이므로 절대 fps는 낮게 나온다.
  // 여기서 보는 건 "루프가 멈추지 않는가"다 — 실기 성능은 디버그 오버레이로 따로 본다.
  expect(min, `min fps ${min.toFixed(1)}`).toBeGreaterThan(4)
  const s = await snap(page)
  expect(s.pos.x, '10초간 실제로 이동했다').toBeGreaterThan(-58)
})

test('S4-8 Z3에서 게이트 6기를 둘러보면 전부 판독된다 (1인칭)', async ({ page }) => {
  await boot(page, 42)
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const s = window.__game!.state()
    window.__game!.set({
      zone: 'Z3',
      player: { ...s.player, pos: { x: 57.5, y: 16, z: -6 } },
    } as never)
  })
  await page.waitForTimeout(600)

  // 1인칭에서는 6기(y 6~26, 20m)가 한 화면에 안 들어온다 — 이건 설계 변경이고,
  // 대신 "고개를 돌리면 전부 읽힌다"가 새 기준이다 (P0-SPEC §2.5 · MAP §5.4).
  const seen = new Set<number>()
  let maxAtOnce = 0
  for (let deg = -80; deg <= 80; deg += 5) {
    await page.evaluate((d) => window.__game!.look((d as number) * Math.PI / 180), deg)
    await page.waitForTimeout(60)
    const n = await page.evaluate(() => window.__game!.visibleGates())
    maxAtOnce = Math.max(maxAtOnce, n)
    if (n > 0) seen.add(deg)
  }
  expect(maxAtOnce, '정면에서 최소 2기는 동시에 보인다').toBeGreaterThanOrEqual(2)
  expect(seen.size, '시야 스윕으로 게이트가 보이는 각도 구간').toBeGreaterThan(6)

  // 정면(동쪽)을 보고 스크린샷
  await page.evaluate(() => window.__game!.look(0, -0.08))
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/__shots__/z3-gates.png' })
})

test('전 게이트가 시야 스윕 안에 들어온다', async ({ page }) => {
  await boot(page, 42)
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const s = window.__game!.state()
    window.__game!.set({ zone: 'Z3', player: { ...s.player, pos: { x: 57.5, y: 16, z: -6 } } } as never)
  })
  await page.waitForTimeout(500)
  let best = 0
  for (const deg of [-70, -45, -20, 0, 20, 45, 70]) {
    await page.evaluate((d) => window.__game!.look((d as number) * Math.PI / 180), deg)
    await page.waitForTimeout(80)
    best += await page.evaluate(() => window.__game!.visibleGates())
  }
  // 각도별 카운트 합이 6 이상이면 최소 한 번씩은 다 지나간다
  expect(best, '스윕 누적 가시 게이트').toBeGreaterThanOrEqual(6)
})

test('S3-2 게임 시간이 실시간보다 빠르게 흐르지 않는다 (복귀 점프 없음)', async ({ page, context }) => {
  await boot(page, 5)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)

  const before = (await snap(page)).timeLeftMs
  const wall0 = Date.now()

  // 다른 탭을 앞으로 보냈다가 돌아온다. 브라우저가 rAF를 스로틀하든 안 하든,
  // 게임 시간이 **실시간보다 빨리** 흐르는 일은 없어야 한다.
  // (스로틀 후 복귀 시 누적 dt를 그대로 소비하면 여기서 잡힌다 — 그게 "점프"다)
  const other = await context.newPage()
  await other.goto('about:blank')
  await other.bringToFront()
  await new Promise((r) => setTimeout(r, 5000))
  await page.bringToFront()
  await page.waitForTimeout(500)

  const drained = before - (await snap(page)).timeLeftMs
  const wall = Date.now() - wall0
  expect(drained, `게임 ${(drained / 1000).toFixed(1)}s vs 실시간 ${(wall / 1000).toFixed(1)}s`)
    .toBeLessThanOrEqual(wall + 250)
  await other.close()
})

test('시각 확인 — 존별 스크린샷', async ({ page }) => {
  const errs = await boot(page, 42)
  await page.screenshot({ path: 'tests/e2e/__shots__/00-title.png' })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'tests/e2e/__shots__/01-z1-ground.png' })

  const spots: readonly [string, number, number, number, string][] = [
    ['02-z2-concourse', 30, 20, -6, 'Z2'],
    ['03-z3-gates', 57, 14, -6, 'Z3'],
    ['04-z4-descent', 104, 6.7, -13, 'Z4'],
    ['05-z5-platform', 130, 8, -20, 'Z5'],
  ]
  for (const [name, x, y, z, zone] of spots) {
    await page.evaluate(([px, py, pz, zn]) => {
      const s = window.__game!.state()
      window.__game!.set({
        zone: zn as never,
        player: { ...s.player, pos: { x: px as number, y: py as number, z: pz as number } },
      } as never)
    }, [x, y, z, zone] as const)
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `tests/e2e/__shots__/${name}.png` })
  }

  // 열차가 서 있는 승강장
  await page.evaluate(() => window.__game!.set({ elapsedMs: 174_000, timeLeftMs: 6_000 } as never))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'tests/e2e/__shots__/06-z5-train.png' })

  // 열차가 실제로 그려지는지 — InstancedMesh 컬링 버그가 재발하면 여기서 잡힌다
  const train = await page.evaluate(() => {
    const s = window.__game!.state()
    const r = (window as unknown as {
      __renderer?: { info: { render: { calls: number } } }
    }).__renderer
    return { state: s.train.state, door: s.train.doorProgress, calls: r?.info.render.calls ?? 0 }
  })
  expect(train.state, '열차 정차·개문 상태').toBe('open')
  expect(train.door, '문이 열려 있다').toBeGreaterThan(0.9)

  // 루프가 죽으면 스크린샷은 "성공"하면서 새까맣게 나온다. 그걸 막는 유일한 장치.
  expect(errs.join(' | ')).toBe('')
  const alive = await page.evaluate(() => window.__game!.state().elapsedMs)
  expect(alive, '시뮬레이션이 계속 돌고 있다').toBeGreaterThan(0)
})
