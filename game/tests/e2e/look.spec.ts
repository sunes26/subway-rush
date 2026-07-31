/**
 * 1인칭 시선 **배선** 검증.
 *
 * 여기서 보는 건 하나다 — 마우스 이벤트가 실제로 카메라를 돌리는가.
 * 필터 자체(락 직후 워프·단발 스파이크·프레임 히치)는 `tests/unit/look.test.ts`가 본다.
 * 유닛 테스트가 다 통과해도 이벤트 이름 하나가 어긋나면(mousemove ↔ pointermove)
 * 게임에선 아무 일도 안 일어나므로, 그 연결만은 진짜 입력으로 확인해야 한다.
 * 포인터 락은 신뢰된 제스처를 요구하니 Playwright의 클릭이 유일한 수단이다.
 *
 * ⚠ **스파이크 억제는 여기서 검증하지 않는다.** 계측해 보니 포인터 락 상태에서
 *   Playwright의 mouse.move는 요청한 이동량을 그대로 전달하지 못한다 —
 *   200px을 요청하면 약 40px만 들어오고, 900px은 아예 이벤트가 발생하지 않는다
 *   (jump=0.0000). 필터를 꺼도 통과하는 단언은 보증이 아니라 착각이다.
 *   스파이크·히치는 현상을 재현할 수 있는 유닛 테스트 쪽에 둔다.
 */

import { expect, test, type Page } from '@playwright/test'

const SENSITIVITY = 0.0022   // data/tuning.ts FPV.sensitivity
const SETTLE_MS = 80         // core/look.ts — 락 직후 워프 델타를 버리는 구간

const camYaw = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __camera: { rotation: { y: number } } }).__camera.rotation.y)

test('포인터 락이 걸리고 마우스가 시선을 돌린다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 45_000 })
  await page.evaluate(() => window.__game!.set({ phase: 'playing' }))

  await page.click('#gl')
  const locked = await page.evaluate(() => document.pointerLockElement !== null)
  // 락이 안 걸리는 환경이면 조용히 통과시키지 않는다 — "못 쟀다"고 표시한다.
  test.skip(!locked, '이 브라우저에서 포인터 락이 걸리지 않아 시선 경로를 잴 수 없다')

  // 워프 델타 구간이 지나가야 한다. 이 대기가 없으면 아래 회전량에 워프분이 섞인다.
  await page.waitForTimeout(SETTLE_MS + 140)

  const before = await camYaw(page)
  let x = 400
  for (let i = 0; i < 5; i++) { x += 40; await page.mouse.move(x, 300, { steps: 1 }) }
  await page.waitForTimeout(160)
  const after = await camYaw(page)

  const turned = Math.abs(after - before)
  expect(turned, '마우스 이벤트가 카메라에 연결돼 있다').toBeGreaterThan(0.01)
  // 전달된 px × 감도를 넘지 않는다 — 어딘가에서 델타가 중복 적용되면 여기서 잡힌다
  expect(turned, '요청한 이동량(200px)이 감도 이상으로 증폭되지 않는다')
    .toBeLessThan(200 * SENSITIVITY * 1.2)

  // 마우스를 놓으면 시선도 멈춘다 (이월분이 무한히 흘러나오지 않는다)
  await page.waitForTimeout(300)
  const settled = await camYaw(page)
  await page.waitForTimeout(300)
  expect(Math.abs((await camYaw(page)) - settled), '입력이 없으면 시선이 정지한다').toBeLessThan(1e-6)

  expect(errors.join(' | ')).toBe('')
})
