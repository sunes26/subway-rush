/** 순수 수학 유틸. Three.js 비의존 — 헤드리스 시뮬에서 그대로 쓴다. */

export type Vec2 = Readonly<{ x: number; y: number }>
export type Vec3 = Readonly<{ x: number; y: number; z: number }>

/** [minX, minY, maxX, maxY] — 월드 XY 평면 축정렬 사각형 */
export type Rect = readonly [number, number, number, number]

export const v2 = (x: number, y: number): Vec2 => ({ x, y })
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export const clamp01 = (v: number): number => clamp(v, 0, 1)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** 0..1 구간 정규화. hi === lo 이면 0. */
export const invLerp = (lo: number, hi: number, v: number): number =>
  hi === lo ? 0 : clamp01((v - lo) / (hi - lo))

/**
 * 프레임레이트 독립 지수 보간.
 * 흔한 `lerp(a, b, 0.2)`는 60fps와 144fps에서 다르게 움직인다 — 그건 버그다.
 * @param tau 시정수(초). 작을수록 빠르게 수렴.
 */
export const lerpExp = (a: number, b: number, dtSec: number, tau: number): number =>
  tau <= 0 ? b : b + (a - b) * Math.exp(-dtSec / tau)

export const TAU = Math.PI * 2

/** 각도 차를 −π..π 로 감아 최단 회전 방향을 준다. */
export const wrapAngle = (a: number): number => {
  let r = (a + Math.PI) % TAU
  if (r < 0) r += TAU
  return r - Math.PI
}

/** 최단 방향으로 각도 보간. maxRate = rad/s. */
export const rotateToward = (from: number, to: number, dtSec: number, maxRate: number): number => {
  const d = wrapAngle(to - from)
  const step = maxRate * dtSec
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step
}

export const easeInOut = (t: number): number => {
  const x = clamp01(t)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3)

export const len2 = (x: number, y: number): number => Math.hypot(x, y)

export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

export const rectContains = (r: Rect, x: number, y: number): boolean =>
  x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]

/** 원(중심 c, 반경 rad)이 사각형과 겹치는가 — 캡슐 충돌의 브로드/내로 양쪽에 쓴다. */
export const rectOverlapsCircle = (r: Rect, cx: number, cy: number, rad: number): boolean => {
  const nx = clamp(cx, r[0], r[2])
  const ny = clamp(cy, r[1], r[3])
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy < rad * rad
}

export const rectExpand = (r: Rect, m: number): Rect => [r[0] - m, r[1] - m, r[2] + m, r[3] + m]

/** 밀리초 → `M:SS` (전광판 표기). 음수는 0으로 클램프. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
