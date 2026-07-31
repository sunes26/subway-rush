import { describe, expect, it } from 'vitest'
import { MAX_STEPS_PER_FRAME, STEP_MS } from '../../src/data/tuning'

/**
 * 렌더 보간 검증.
 *
 * 시뮬은 고정 60Hz, 렌더는 가변이다. 프레임이 60Hz보다 **빠르면** 시뮬 스텝이 0회인 프레임이 섞이고,
 * 보간 없이 시뮬 위치를 그대로 그리면 화면이 멈췄다 튀었다 한다(저더).
 *
 * 헤드리스 브라우저는 소프트웨어 렌더러라 항상 60Hz보다 느려 이 현상이 재현되지 않는다.
 * 그래서 루프 수식만 떼어내 결정론적으로 검증한다.
 */
const simulate = (frameMs: number, frames: number, speed: number, interpolate: boolean): number[] => {
  let acc = 0
  let pos = 0
  let prevPos = 0
  const rendered: number[] = []
  for (let f = 0; f < frames; f++) {
    acc += frameMs
    let steps = 0
    while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      prevPos = pos
      pos += (speed * STEP_MS) / 1000
      acc -= STEP_MS
      steps++
    }
    const alpha = interpolate ? Math.min(1, acc / STEP_MS) : 1
    rendered.push(prevPos + (pos - prevPos) * alpha)
  }
  return rendered
}

/** 변동계수. 시작 직후 몇 프레임은 아직 스텝이 안 돈 워밍업이라 제외한다. */
const cv = (xs: readonly number[], skip = 12): number => {
  const d: number[] = []
  for (let i = skip + 1; i < xs.length; i++) d.push(xs[i]! - xs[i - 1]!)
  const mean = d.reduce((a, b) => a + b, 0) / d.length
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length)
  return sd / mean
}

describe('렌더 보간 — 저더 제거', () => {
  // 144Hz(6.94ms)·120Hz(8.33ms)는 60Hz보다 빠르므로 0스텝 프레임이 반드시 생긴다
  for (const [name, frameMs] of [['144Hz', 1000 / 144], ['120Hz', 1000 / 120], ['90Hz', 1000 / 90]] as const) {
    it(`${name}에서 보간이 저더를 없앤다`, () => {
      const on = cv(simulate(frameMs, 240, 5, true))
      const off = cv(simulate(frameMs, 240, 5, false))
      expect(off, `${name} 보간 OFF cv=${off.toFixed(3)}`).toBeGreaterThan(0.3)
      expect(on, `${name} 보간 ON cv=${on.toFixed(4)} vs OFF ${off.toFixed(3)}`).toBeLessThan(0.02)
    })
  }

  it('60Hz 정각에서는 둘 다 균일하다', () => {
    expect(cv(simulate(STEP_MS, 240, 5, true))).toBeLessThan(0.02)
    expect(cv(simulate(STEP_MS, 240, 5, false))).toBeLessThan(0.02)
  })

  it('보간해도 총 이동 거리는 시뮬과 어긋나지 않는다', () => {
    const r = simulate(1000 / 144, 288, 5, true)   // 2.0초
    const travelled = r[r.length - 1]! - r[0]!
    expect(Math.abs(travelled - 5 * 2.0)).toBeLessThan(0.1)
  })
})
