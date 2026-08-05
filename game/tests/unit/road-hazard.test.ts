/**
 * 차도 위험 판정 — 차체 상자와 플레이어 원의 겹침.
 *
 * 적신호 차단벽을 걷어낸 대신 들어온 규칙이라, 이 판정이 느슨하면 무단횡단이
 * 공짜가 되고 빡빡하면 스치기만 해도 처음으로 돌아간다. 경계를 숫자로 못 박는다.
 *
 * 차 판정은 `cars.ts` 의 `HIT_W`(0.85) · `HIT_L`(2.10) 반치수를 쓴다.
 * 플레이어 반경은 `MOVE.radius`.
 */

import { describe, expect, it } from 'vitest'
import { MOVE } from '../../src/data/tuning'
import { boxHitsCircle, carHits, type CarBox } from '../../src/systems/roadHazard'

/** 남북 차선(이면도로) 차 — 길이축이 y */
const NS: CarBox = { x: -28.8, y: 27.0, hx: 0.85, hy: 2.10 }
/** 동서 차선(주 차도) 차 — 길이축이 x */
const EW: CarBox = { x: -40.0, y: 17.5, hx: 2.10, hy: 0.85 }

describe('boxHitsCircle', () => {
  it('한복판은 닿는다', () => {
    expect(boxHitsCircle(NS, NS.x, NS.y, MOVE.radius)).toBe(true)
  })

  it('옆으로 반폭 + 반경만큼 벗어나면 안 닿는다', () => {
    const just = NS.x + NS.hx + MOVE.radius
    expect(boxHitsCircle(NS, just - 0.02, NS.y, MOVE.radius)).toBe(true)
    expect(boxHitsCircle(NS, just + 0.02, NS.y, MOVE.radius)).toBe(false)
  })

  it('앞뒤도 같다 — 길이축이 y 인 차', () => {
    const just = NS.y + NS.hy + MOVE.radius
    expect(boxHitsCircle(NS, NS.x, just - 0.02, MOVE.radius)).toBe(true)
    expect(boxHitsCircle(NS, NS.x, just + 0.02, MOVE.radius)).toBe(false)
  })

  it('모서리는 대각 거리로 본다 — 축 투영만 보면 헛맞는다', () => {
    // 두 축 모두 반치수를 0.4 씩 넘긴 점. 축만 보면 각각 반경 안이지만
    // 실제 거리는 √(0.4²+0.4²)=0.566 이라 반경(0.35 안팎)보다 멀다.
    const p = { x: NS.x + NS.hx + 0.4, y: NS.y + NS.hy + 0.4 }
    expect(boxHitsCircle(NS, p.x, p.y, 0.35)).toBe(false)
    expect(boxHitsCircle(NS, p.x, p.y, 0.60)).toBe(true)
  })

  it('길이축이 x 인 차는 좌우로 길다', () => {
    expect(boxHitsCircle(EW, EW.x + 1.8, EW.y, 0.1)).toBe(true)
    expect(boxHitsCircle(EW, EW.x, EW.y + 1.8, 0.1)).toBe(false)
  })
})

describe('carHits', () => {
  it('빈 목록은 절대 안 맞는다', () => {
    expect(carHits([], -28.8, 27.0, MOVE.radius)).toBe(false)
  })

  it('여러 대 중 하나만 닿아도 true', () => {
    expect(carHits([EW, NS], NS.x, NS.y, MOVE.radius)).toBe(true)
  })

  it('차선 사이(x −27) 를 걸으면 둘 다 안 닿는다', () => {
    // 이면도로 차선은 x −28.8 · −25.2 다. 그 사이 중앙선은 안전지대여야 한다.
    const lanes: CarBox[] = [
      { x: -28.8, y: 27.0, hx: 0.85, hy: 2.10 },
      { x: -25.2, y: 27.0, hx: 0.85, hy: 2.10 },
    ]
    expect(carHits(lanes, -27.0, 27.0, MOVE.radius)).toBe(false)
  })
})
