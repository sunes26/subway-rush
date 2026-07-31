/**
 * 충돌 · 지면 샘플링.
 *
 * 맵이 전부 2m 격자 직교라 AABB로 충분하다. 물리 엔진은 WASM 400KB에
 * 예측 불가능한 떨림까지 얹어 온다 — 이 맵에는 손해다.
 */

import { clamp, rectContains, rectOverlapsCircle, type Rect } from '../core/math'
import { MOVE } from '../data/tuning'
import { RAMPS, SLABS, SOLIDS, type Ramp, type Slab, type Solid } from '../data/world'

// ─────────────────── 브로드페이즈: 균일 그리드 해시 ───────────────────

const CELL = 16

const key = (cx: number, cy: number): number => (cx + 4096) * 8192 + (cy + 4096)

const buildGrid = (items: readonly Solid[]): Map<number, Solid[]> => {
  const g = new Map<number, Solid[]>()
  for (const s of items) {
    const x0 = Math.floor(s.rect[0] / CELL)
    const y0 = Math.floor(s.rect[1] / CELL)
    const x1 = Math.floor(s.rect[2] / CELL)
    const y1 = Math.floor(s.rect[3] / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy)
        const list = g.get(k)
        if (list) list.push(s)
        else g.set(k, [s])
      }
    }
  }
  return g
}

const STATIC_GRID = buildGrid(SOLIDS)

/** 프레임마다 갈아끼우는 동적 충돌체 (게이트 플랩 · PSD 가동문 · 신호등 차단). */
let dynamicSolids: readonly Solid[] = []
export const setDynamicSolids = (list: readonly Solid[]): void => { dynamicSolids = list }
export const getDynamicSolids = (): readonly Solid[] => dynamicSolids

const queryNear = (x: number, y: number, r: number): Solid[] => {
  const out: Solid[] = []
  const x0 = Math.floor((x - r) / CELL)
  const y0 = Math.floor((y - r) / CELL)
  const x1 = Math.floor((x + r) / CELL)
  const y1 = Math.floor((y + r) / CELL)
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = STATIC_GRID.get(key(cx, cy))
      if (list) out.push(...list)
    }
  }
  for (const d of dynamicSolids) out.push(d)
  return out
}

// ─────────────────── 지면 샘플링 ───────────────────

/** 램프 위 z. rect 밖이면 null. */
export const rampZ = (r: Ramp, x: number, y: number): number | null => {
  if (!rectContains(r.rect, x, y)) return null
  const [minA, maxA] = r.axis === 'x' ? [r.rect[0], r.rect[2]] : [r.rect[1], r.rect[3]]
  const v = r.axis === 'x' ? x : y
  const t = clamp((v - minA) / (maxA - minA), 0, 1)
  return r.zAtMin + (r.zAtMax - r.zAtMin) * t
}

export type Ground = Readonly<{ z: number; rampId: string | null; ramp: Ramp | null }>

const NO_GROUND: Ground = { z: Number.NEGATIVE_INFINITY, rampId: null, ramp: null }

/** 밟고 올라설 수 있는 최대 단차(m). 계단 접합부의 미세 오차를 흡수한다. */
const STEP_UP = 0.6

/**
 * (x, y)에서 발 밑 지면을 찾는다.
 *
 * 층이 겹치는 구간(Z1/Z2, Z4/Z5)이 있으므로 **현재 고도 이하 중 가장 높은 면**을 고른다.
 * 이게 없으면 대합실에 서 있는데 지상 인도로 순간이동한다.
 */
export const sampleGround = (x: number, y: number, currentZ: number): Ground => {
  let best: Ground = NO_GROUND
  const ceiling = currentZ + STEP_UP

  for (const r of RAMPS) {
    const z = rampZ(r, x, y)
    if (z === null || z > ceiling) continue
    if (z > best.z) best = { z, rampId: r.id, ramp: r }
  }
  for (const s of SLABS) {
    if (!rectContains(s.rect, x, y)) continue
    if (s.z > ceiling) continue
    if (s.z > best.z) best = { z: s.z, rampId: null, ramp: null }
  }

  if (best.z === Number.NEGATIVE_INFINITY) {
    // 어떤 면도 못 찾음 — 아래를 무시하고 가장 가까운 면으로 폴백(낙하 방지)
    let fb = NO_GROUND
    let bestGap = Infinity
    for (const s of SLABS) {
      if (!rectContains(s.rect, x, y)) continue
      const gap = Math.abs(s.z - currentZ)
      if (gap < bestGap) { bestGap = gap; fb = { z: s.z, rampId: null, ramp: null } }
    }
    return fb
  }
  return best
}

/** (x, y)가 걸을 수 있는 면 위인가 */
export const isWalkable = (x: number, y: number, currentZ: number): boolean =>
  sampleGround(x, y, currentZ).z !== Number.NEGATIVE_INFINITY

/** 해당 고도에서 이 충돌체가 실제로 막는가 (다른 층의 벽은 무시) */
const blocksAt = (s: Solid, z: number): boolean => z > s.z0 - 1.2 && z < s.z0 + s.h

// ─────────────────── 슬라이딩 해결 ───────────────────

const overlapsAny = (list: readonly Solid[], x: number, y: number, z: number, r: number): boolean => {
  for (const s of list) {
    if (!blocksAt(s, z)) continue
    if (rectOverlapsCircle(s.rect, x, y, r)) return true
  }
  return false
}

export type MoveResult = Readonly<{ x: number; y: number; hitX: boolean; hitY: boolean }>

/**
 * X축·Y축을 **분리해서** 해결한다.
 * 동시에 풀면 모서리에서 끼인다. 축별 분리가 벽을 스치며 미끄러지는 느낌을 만든다.
 */
export const resolveMove = (
  fromX: number, fromY: number, toX: number, toY: number, z: number,
  radius = MOVE.radius,
): MoveResult => {
  const span = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)) + radius + 1
  const near = queryNear((fromX + toX) / 2, (fromY + toY) / 2, span)

  let x = fromX
  let y = fromY

  if (toX !== fromX && !overlapsAny(near, toX, y, z, radius)) x = toX
  const hitX = x !== toX

  if (toY !== fromY && !overlapsAny(near, x, toY, z, radius)) y = toY
  const hitY = y !== toY

  // 축 분리가 실패했는데 대각 목표는 열려 있는 경우(좁은 통로 진입) 한 번 더 시도
  if (hitX && hitY && !overlapsAny(near, toX, toY, z, radius)) return { x: toX, y: toY, hitX: false, hitY: false }

  // 걸을 면이 없는 곳으로는 못 간다 (맵 이탈 방지)
  if (!isWalkable(x, y, z)) {
    if (isWalkable(fromX, y, z)) return { x: fromX, y, hitX: true, hitY }
    if (isWalkable(x, fromY, z)) return { x, y: fromY, hitX, hitY: true }
    return { x: fromX, y: fromY, hitX: true, hitY: true }
  }
  return { x, y, hitX, hitY }
}

/** 밀어내기 — 동적 충돌체(닫히는 문 등)에 낀 경우 탈출시킨다. */
export const depenetrate = (x: number, y: number, z: number, radius = MOVE.radius): { x: number; y: number } => {
  const near = queryNear(x, y, radius + 1)
  let px = x
  let py = y
  for (const s of near) {
    if (!blocksAt(s, z)) continue
    if (!rectOverlapsCircle(s.rect, px, py, radius)) continue
    const cx = (s.rect[0] + s.rect[2]) / 2
    const cy = (s.rect[1] + s.rect[3]) / 2
    const hw = (s.rect[2] - s.rect[0]) / 2 + radius
    const hh = (s.rect[3] - s.rect[1]) / 2 + radius
    const dx = px - cx
    const dy = py - cy
    const ox = hw - Math.abs(dx)
    const oy = hh - Math.abs(dy)
    if (ox <= 0 || oy <= 0) continue
    if (ox < oy) px = cx + Math.sign(dx || 1) * hw
    else py = cy + Math.sign(dy || 1) * hh
  }
  return { x: px, y: py }
}

export const allSolidRects = (): readonly Rect[] => SOLIDS.map((s) => s.rect)
export const allSlabs = (): readonly Slab[] => SLABS
