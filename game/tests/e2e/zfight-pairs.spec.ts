/**
 * 깜빡이는 픽셀 자리의 **실제 면 간격**을 μm 까지 잰다 — 계측기.
 *
 * `__game.pick()` 은 거리를 cm 로 반올림해 돌려주므로 z-fighting 판단에 못 쓴다.
 * 여기서는 깊이 판정이 뒤집힌 칸(near 흔들기로 찾는다)에만 배정밀도
 * 레이-삼각형 교차를 직접 돌린다.
 *
 *  · 간격 0 → **면이 진짜로 겹쳤다**(모델링). near 를 넓혀도 안 낫는다 → 깊이 바이어스가 답
 *  · 간격 μm~mm → **깊이 버퍼 정밀도**. near/far 가 답
 */

import { test } from '@playwright/test'

type Spot = Readonly<{ name: string; x: number; y: number; z: number; yaw: number; pitch: number }>

const SPOTS: readonly Spot[] = [
  { name: 'stair-mid', x: 7.5, y: 28, z: -2.6, yaw: 1.0, pitch: -0.1 },
  { name: 'stair-mid-b', x: 7.5, y: 28, z: -2.6, yaw: -1.0, pitch: -0.1 },
  { name: 'stair-mid-c', x: 7.5, y: 28, z: -2.6, yaw: -1.8, pitch: 0 },
  { name: 'pids', x: 17.3, y: 26.5, z: -6.0, yaw: 1.2, pitch: 0 },
  { name: 'pids-b', x: 17.3, y: 26.5, z: -6.0, yaw: 2.4, pitch: 0 },
  { name: 'z3-gates', x: 56.5, y: 16, z: -6, yaw: 1.8, pitch: 0 },
  { name: 'z5-platform', x: 128, y: 6, z: -20, yaw: 0.6, pitch: 0 },
  { name: 'z5-platform-b', x: 128, y: 6, z: -20, yaw: 2.4, pitch: 0 },
  { name: 'z2-concourse', x: 20, y: 15, z: -6, yaw: -0.6, pitch: 0 },
  { name: 'z2-lost', x: 49, y: 21.5, z: -6, yaw: 1.2, pitch: 0 },
  { name: 'z2-lost-b', x: 49, y: 21.5, z: -6, yaw: 0.6, pitch: 0.2 },
  { name: 'z4-descent', x: 94.5, y: 6.7, z: -6, yaw: -1.8, pitch: 0 },
]

test('겹침 간격 실측', async ({ page }) => {
  await page.goto('/?freeplay&seed=42')
  await page.waitForFunction(() => !!window.__game?.stationStats(), null, { timeout: 90_000 })

  for (const s of SPOTS) {
    await page.evaluate((spot) => {
      const g = window.__game!
      g.set({ phase: 'playing' })
      const st = g.state()
      g.set({
        player: {
          ...st.player,
          pos: { x: spot.x, y: spot.y, z: spot.z + 0.6 },
          vel: { x: 0, y: 0 }, vz: 0, grounded: false, moving: false, sprinting: false,
        },
      })
      g.look(spot.yaw, spot.pitch)
    }, s as unknown as Spot)
    await page.waitForTimeout(700)

    const report = await page.evaluate(async () => {
      type Attr = { array: ArrayLike<number> }
      type M = {
        name: string; visible: boolean; isMesh?: boolean
        geometry: { attributes: { position?: Attr }; index: { array: ArrayLike<number> } | null }
      }
      const cam = (window as unknown as {
        __camera: {
          near: number; updateProjectionMatrix(): void
          matrixWorld: { elements: number[] }
          projectionMatrixInverse: { elements: number[] }
        }
      }).__camera
      const scene = (window as unknown as { __scene: { traverse(f: (o: M) => void): void } }).__scene
      const gl = (window as unknown as {
        __renderer: { getContext(): WebGL2RenderingContext }
      }).__renderer.getContext()

      // ── 1) near 를 흔들어 깊이 판정이 뒤집힌 칸을 찾는다
      const grab = (near: number): Promise<{ w: number; h: number; buf: Uint8Array }> =>
        new Promise((res) => {
          cam.near = near
          cam.updateProjectionMatrix()
          requestAnimationFrame(() => {
            const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight
            const buf = new Uint8Array(w * h * 4)
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
            res({ w, h, buf })
          })
        })
      const A = await grab(0.08)
      const B = await grab(0.0805)
      await grab(0.08)
      const CX = 24; const CY = 14
      const cells = new Int32Array(CX * CY)
      for (let i = 0, px = 0; i < A.buf.length; i += 4, px++) {
        if (Math.abs(A.buf[i]! - B.buf[i]!) + Math.abs(A.buf[i + 1]! - B.buf[i + 1]!)
          + Math.abs(A.buf[i + 2]! - B.buf[i + 2]!) < 24) continue
        cells[Math.floor((Math.floor(px / A.w) / A.h) * CY) * CX
          + Math.floor(((px % A.w) / A.w) * CX)]!++
      }
      const flipTotal = [...cells].reduce((a, b) => a + b, 0)
      const top = [...cells].map((n, i) => ({ n, i })).sort((p, q) => q.n - p.n)
        .filter((c) => c.n > 20).slice(0, 5)
      if (top.length === 0) return [`(뒤집힌 칸 없음, 총 ${flipTotal})`]

      // ── 2) 그 칸에만 배정밀도 레이를 쏜다
      const tris: { name: string; p: ArrayLike<number>; idx: ArrayLike<number> | null }[] = []
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible || !/^(merged:|glow:|contact-shadows)/.test(o.name)) return
        const p = o.geometry.attributes.position
        if (p) tris.push({ name: o.name, p: p.array, idx: o.geometry.index?.array ?? null })
      })

      const mw = cam.matrixWorld.elements
      const pi = cam.projectionMatrixInverse.elements
      const org = [mw[12]!, mw[13]!, mw[14]!]
      const rayDir = (nx: number, ny: number): number[] => {
        // NDC(−1..1, z=0.5) → 뷰 → 월드
        const x = nx; const y = ny; const z = 0.5
        const w = pi[3]! * x + pi[7]! * y + pi[11]! * z + pi[15]!
        const vx = (pi[0]! * x + pi[4]! * y + pi[8]! * z + pi[12]!) / w
        const vy = (pi[1]! * x + pi[5]! * y + pi[9]! * z + pi[13]!) / w
        const vz = (pi[2]! * x + pi[6]! * y + pi[10]! * z + pi[14]!) / w
        const dx = mw[0]! * vx + mw[4]! * vy + mw[8]! * vz
        const dy = mw[1]! * vx + mw[5]! * vy + mw[9]! * vz
        const dz = mw[2]! * vx + mw[6]! * vy + mw[10]! * vz
        const l = Math.hypot(dx, dy, dz)
        return [dx / l, dy / l, dz / l]
      }

      const out: string[] = []
      for (const c of top) {
        const nx = (((c.i % CX) + 0.5) / CX) * 2 - 1
        const ny = ((Math.floor(c.i / CX) + 0.5) / CY) * 2 - 1
        const d = rayDir(nx, ny)
        const hits: { name: string; t: number }[] = []
        for (const m of tris) {
          const p = m.p; const idx = m.idx
          const n = idx ? idx.length / 3 : p.length / 9
          for (let f = 0; f < n; f++) {
            const i0 = (idx ? idx[f * 3]! : f * 3) * 3
            const i1 = (idx ? idx[f * 3 + 1]! : f * 3 + 1) * 3
            const i2 = (idx ? idx[f * 3 + 2]! : f * 3 + 2) * 3
            const ax = p[i0]!; const ay = p[i0 + 1]!; const az = p[i0 + 2]!
            const e1x = p[i1]! - ax; const e1y = p[i1 + 1]! - ay; const e1z = p[i1 + 2]! - az
            const e2x = p[i2]! - ax; const e2y = p[i2 + 1]! - ay; const e2z = p[i2 + 2]! - az
            const hx = d[1]! * e2z - d[2]! * e2y
            const hy = d[2]! * e2x - d[0]! * e2z
            const hz = d[0]! * e2y - d[1]! * e2x
            const a = e1x * hx + e1y * hy + e1z * hz
            if (a > -1e-12 && a < 1e-12) continue
            const inv = 1 / a
            const sx = org[0]! - ax; const sy = org[1]! - ay; const sz = org[2]! - az
            const u = inv * (sx * hx + sy * hy + sz * hz)
            if (u < 0 || u > 1) continue
            const qx = sy * e1z - sz * e1y
            const qy = sz * e1x - sx * e1z
            const qz = sx * e1y - sy * e1x
            const v = inv * (d[0]! * qx + d[1]! * qy + d[2]! * qz)
            if (v < 0 || u + v > 1) continue
            const t = inv * (e2x * qx + e2y * qy + e2z * qz)
            if (t > 0.05) hits.push({ name: m.name, t })
          }
        }
        hits.sort((x, y) => x.t - y.t)
        const pairs: string[] = []
        for (let i = 1; i < Math.min(hits.length, 5); i++) {
          const gap = (hits[i]!.t - hits[i - 1]!.t) * 1000
          if (gap > 8) break
          pairs.push(`${hits[i - 1]!.name}→${hits[i]!.name} ${gap.toFixed(5)}mm`)
        }
        out.push(`${c.n}px ndc(${nx.toFixed(2)},${ny.toFixed(2)}) d=${hits[0]?.t.toFixed(4)}  `
          + (pairs.length ? pairs.join(' | ') : `단일면 ${hits[0]?.name}`))
      }
      return out
    })

    console.log(`\n=== ${s.name}`)
    for (const r of report) console.log(`  ${r}`)
  }
})
