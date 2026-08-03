/**
 * 깊이 점멸(z-fighting) 회귀 — "카메라를 돌리면 화면이 깜빡인다"를 숫자로 막는다.
 *
 * ── 어떻게 재는가
 * 카메라 `near` 만 ×1.006 흔들어 두 프레임을 비교한다. 투시행렬에서 near 는
 * **깊이 열에만** 들어가므로(x·y 스케일은 fov·aspect 가 정한다) 화면 위 어떤 것도
 * 움직이지 않고 깊이 매핑만 바뀐다. 그때 색이 바뀌는 픽셀은 전부 **깊이 판정이
 * 뒤집힌 곳**, 곧 눈에 보이는 깜빡임이다.
 *
 * 시점을 미세하게 돌려 비교하는 방법으로 먼저 시도했다가 버렸다 — MSAA 경계 픽셀이
 * 같이 변해 z-fighting 과 구분이 안 된다. near 만 흔들면 경계는 한 픽셀도 안 움직인다.
 *
 * 씬에는 매 프레임 움직이는 것이 있으므로(유도 화살표·열차·문) near 를 **안 바꾸고**
 * 잰 대조값을 빼야 남는 것이 깊이 몫이다.
 *
 * 어느 면과 어느 면이 붙었는지는 `zfight-pairs.spec.ts` 가 이름으로 알려 준다.
 */

import { expect, test, type Page } from '@playwright/test'

type Base = Readonly<{ name: string; x: number; y: number; z: number }>

/** 실제로 신고가 들어왔던 두 곳(계단·전광판)을 포함해 존마다 한 지점씩 */
const BASES: readonly Base[] = [
  { name: 'stair-mid', x: 7.5, y: 28, z: -2.6 },
  { name: 'stair-bottom', x: 16, y: 28, z: -6 },
  { name: 'pids', x: 17.3, y: 26.5, z: -6.0 },
  { name: 'z2-concourse', x: 20, y: 15, z: -6 },
  // 유실물 보관소·화장실 사인 — 판 뒷면이 뒤 부재 앞면과 같은 평면이었다
  { name: 'z2-lost', x: 49, y: 21.5, z: -6 },
  { name: 'z3-gates', x: 56.5, y: 16, z: -6 },
  { name: 'z4-descent', x: 94.5, y: 6.7, z: -6 },
  { name: 'z5-platform', x: 128, y: 6, z: -20 },
]

const YAWS = [0, 0.6, 1.2, 1.8, 2.4, 3.0, -0.6, -1.2, -1.8, -2.4] as const

/**
 * 한 지점(시선 10방향 합)에서 허용하는 뒤집힘 픽셀 수.
 *
 * 화면은 921,600 px 이고 10 장을 더하므로 921만 px 중 4천이다.
 * 수정 전 실측은 계단 중간 151,424 · 전광판 19,671 이었고, 겹친 면의 앞뒤를 고정한 뒤
 * 56 · 1,821 로 떨어졌다. 남은 값은 애니메이션 대조값(1천 안팎)과 같은 수준이라
 * 여기가 바닥이다. 4천은 "다시 겹치기 시작하면 걸리되 잡음에는 안 걸리는" 선이다.
 */
const BUDGET = 4000

declare global {
  interface Window {
    __zf?: { probe(near: number): Promise<Uint8Array> }
  }
}

const install = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const cam = (window as unknown as {
      __camera: { near: number; updateProjectionMatrix(): void }
    }).__camera
    const gl = (window as unknown as {
      __renderer: { getContext(): WebGL2RenderingContext }
    }).__renderer.getContext()
    window.__zf = {
      probe: (near) => new Promise((res) => {
        cam.near = near
        cam.updateProjectionMatrix()
        // 게임 루프의 rAF 가 먼저 큐에 있으므로 이 콜백은 render 직후에 돈다
        requestAnimationFrame(() => {
          const buf = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
            gl.RGBA, gl.UNSIGNED_BYTE, buf)
          res(buf)
        })
      }),
    }
  })
}

/** `[대조, 깊이]` — 대조는 near 를 안 바꾸고 잰 프레임 간 변동(애니메이션 몫) */
const flips = async (page: Page): Promise<readonly [number, number]> =>
  page.evaluate(async () => {
    const d = window.__zf!
    const diff = (a: Uint8Array, b: Uint8Array): number => {
      let c = 0
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!)
          + Math.abs(a[i + 2]! - b[i + 2]!) >= 24) c++
      }
      return c
    }
    const c0 = await d.probe(0.08)
    const c1 = await d.probe(0.08)
    const z0 = await d.probe(0.08)
    const z1 = await d.probe(0.08 * 1.006)
    await d.probe(0.08)
    const ctl = diff(c0, c1)
    return [ctl, Math.max(0, diff(z0, z1) - ctl)] as const
  })

const place = async (page: Page, s: Base, yaw: number): Promise<void> => {
  await page.evaluate(([spot, y]) => {
    const g = window.__game!
    g.set({ phase: 'playing' })
    const st = g.state()
    const p = spot as Base
    g.set({
      player: {
        ...st.player,
        pos: { x: p.x, y: p.y, z: p.z + 0.6 },
        vel: { x: 0, y: 0 }, vz: 0, grounded: false, moving: false, sprinting: false,
      },
    })
    g.look(y as number, 0)
  }, [s, yaw] as const)
  // ⚠ 넉넉히 기다린다. 배치는 0.6 m 위에서 떨어뜨려 접지시키는데, 계단 중간처럼
  //   낙차가 큰 지점은 0.3 초로는 아직 떨어지는 중이다 — 그러면 카메라가 움직이는
  //   프레임을 비교하게 되어 대조값이 5만 px 로 튄다(실제로 그렇게 헛짚었다).
  await page.waitForTimeout(700)
}

test('깊이 점멸', async ({ page }) => {
  // 지점 7 × 시선 10 × 프레임 5 = 350 프레임을 읽는다. 실제 GPU 로는 50초면 끝난다.
  test.setTimeout(180_000)
  await page.goto('/?freeplay&seed=42')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 90_000 })

  /**
   * ⚠ 소프트웨어 래스터라이저에서는 **건너뛴다.**
   *
   * 기본 설정은 `--use-angle=swiftshader`, 즉 WebGL 을 CPU 로 그린다. 그 위에서
   * 921,600 px 를 350번 읽어 오면 5분을 넘긴다. 그리고 여기서 재는 것은 깊이 버퍼의
   * 동률 판정이라 **실제 GPU 의 결과라야 의미가 있다** — 이 저장소는 소프트웨어
   * 래스터의 수치를 믿었다가 두 번 헛짚은 기록이 있다(playwright.gpu.config.ts 주석).
   *
   *     npx playwright test -c playwright.gpu.config.ts
   */
  const soft = await page.evaluate(() => {
    const gl = (window as unknown as {
      __renderer: { getContext(): WebGL2RenderingContext }
    }).__renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
  })
  test.skip(/swiftshader|software|llvmpipe/i.test(soft), `소프트웨어 렌더러(${soft})`)

  await install(page)

  const totals: Record<string, number> = {}
  for (const s of BASES) {
    const depth: number[] = []
    const ctl: number[] = []
    for (const yaw of YAWS) {
      await place(page, s, yaw)
      const [c, z] = await flips(page)
      ctl.push(c)
      depth.push(z)
    }
    const sum = depth.reduce((a, b) => a + b, 0)
    totals[s.name] = sum
    console.log(`${s.name.padEnd(14)} 깊이 ${sum.toString().padStart(6)}`
      + ` (최대 ${Math.max(...depth).toString().padStart(5)})`
      + ` | 대조 ${ctl.reduce((a, b) => a + b, 0).toString().padStart(5)}`)
  }
  for (const [name, n] of Object.entries(totals)) {
    expect(n, `${name} 깊이 뒤집힘 (zfight-pairs.spec 으로 어느 면인지 확인할 것)`)
      .toBeLessThan(BUDGET)
  }
})
