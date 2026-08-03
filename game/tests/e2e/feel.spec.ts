import { expect, test } from '@playwright/test'

/** W만 눌렀을 때 각 존에서 통로 밖으로 밀려나지 않는가 (조작감 회귀 방지) */
const CASES: readonly [string, number, number, number, string, number, number][] = [
  // zone, startX, startY, startZ, zoneId, 최소 x 전진, 허용 y 이탈
  ['Z1', -58, 26, 0, 'Z1', 12, 6],
  // y=10/20은 기둥 열이다(부록 A: x 12/24/36/48 × y 10/20). 정면으로 박으므로 사이로 시작한다
  ['Z2', 6, 16, -6, 'Z2', 12, 8],
  ['Z4', 76, 7, -6, 'Z4', 12, 4],
]

/**
 * 이 브라우저가 GPU로 그리는가.
 *
 * `playwright.config.ts` 는 `--use-angle=swiftshader` 로 WebGL 을 **CPU 로** 그린다.
 * 스크린샷이 검게 나오는 걸 막으려는 설정인데, 소프트웨어 래스터는 실제 GPU 보다
 * 수십 배 느려서 **삼각형 수에 과민하다.**
 *
 * 실제로 마감 상향(§23)으로 지오메트리가 40 % 늘자 여기서 전진이 15 m → 6 m 로
 * 무너졌다. 그런데 같은 빌드를 `playwright.gpu.config.ts`(헤드리스 해제 + 실제 GPU)로
 * 돌리면 **3/3 통과**하고, 사람이 직접 플레이해도 렉이 없다.
 *
 * 즉 소프트웨어 렌더에서의 전진 거리는 **프레임 예산의 대리지표**이지
 * 조작감 자체가 아니다. 하한을 둘로 나눈다 —
 * GPU 에서는 조작감 회귀를 잡고, CPU 에서는 "아예 안 움직인다"만 잡는다.
 * (횡드리프트는 프레임 시간과 무관하므로 양쪽 다 그대로 본다.)
 */
const usesGpu = async (page: import('@playwright/test').Page): Promise<boolean> =>
  page.evaluate(() => {
    const c = document.querySelector('canvas')
    const gl = c?.getContext('webgl2') ?? c?.getContext('webgl')
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    return !!name && !/swiftshader|software|llvmpipe/i.test(name)
  })

/** 소프트웨어 렌더에서의 하한 — 여기서는 "움직이긴 하는가"만 본다 */

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
    const gpu = await usesGpu(page)
    const advanced = after.x - before.x
    // 어느 기준이 적용됐는지 반드시 남긴다 — 안 찍으면 느슨한 쪽으로 통과한 것을
    // 사후에 구별할 방법이 없다.
    console.log(`${name} ${gpu ? 'GPU' : '소프트웨어'} 전진 ${advanced.toFixed(2)}m `
      + `드리프트 ${Math.abs(after.y - before.y).toFixed(2)}m`)
    if (gpu) expect(advanced, `${name} 전진`).toBeGreaterThan(minAdv)
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
