/**
 * 월드 지오메트리 — 단일 진실 원천.
 *
 * ★ 모든 좌표의 출처는 MAP-LAYOUT.md **부록 A (구현용 좌표 요약표)** 다.
 *   부록 A는 v0.2에서 전부 월드 좌표로 통일됐고, 존 로컬 좌표계는 폐기됐다.
 *   (§3.2·§7.5의 표는 v0.1 로컬 좌표라 **쓰지 않는다.**)
 *
 * 좌표계: +X = 동(동선 진행 방향) · +Y = 북 · +Z = 상(고도)
 * 층: L0 ±0 / B1 −6 / B2 −20 · 단위 m · 그리드 2m
 *
 * 문서에 치수가 없는 소품(자판기·벤치 등)은 여기서 정하고 `// 신규` 로 표시한다.
 */

import type { Rect } from '../core/math'

export type ZoneId = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'

export const ZONE_NAMES: Record<ZoneId, string> = {
  Z1: '지상 · 버스정류장',
  Z2: '대합실',
  Z3: '개찰구',
  Z4: '하강',
  Z5: '승강장',
}

export const FLOOR = { L0: 0, B1: -6, B2: -20 } as const

// ─────────────────────────── 타입 ───────────────────────────

/** 걸을 수 있는 평면. z는 절대 고도. */
export type Slab = Readonly<{ id: string; rect: Rect; z: number; kind: SlabKind }>
export type SlabKind = 'road' | 'sidewalk' | 'concourse' | 'paid' | 'platform' | 'landing'

/** 경사면. axis를 따라 zAtMin → zAtMax 선형 보간. */
export type Ramp = Readonly<{
  id: string
  rect: Rect
  axis: 'x' | 'y'
  /** rect의 axis **최소**단에서의 고도 */
  zAtMin: number
  /** rect의 axis **최대**단에서의 고도 */
  zAtMax: number
  kind: 'stairs' | 'escalator'
  /** 에스컬레이터: 입력 없이도 이 속도로 이송 (m/s). 0이면 수동 */
  carrySpeed: number
  /** 이송 방향 (+1 = axis 증가 방향) */
  carryDir: 1 | -1
}>

/** 충돌 박스. z0 = 바닥 고도, h = 충돌 높이. */
export type Solid = Readonly<{
  id: string; rect: Rect; z0: number; h: number; look: SolidLook
  /**
   * 렌더 높이. 생략하면 h와 같다.
   * 쿼터뷰에서 카메라는 **반드시 방 밖 위쪽**에 선다 — 외벽을 실제 높이로 그리면
   * 그 벽이 화면 절반을 먹는다. 충돌은 4~5m로 두고 그림만 낮춘다.
   */
  renderH?: number
}>
export type SolidLook =
  | 'wall' | 'glass' | 'column' | 'prop' | 'machine' | 'bench'
  | 'gate' | 'psd' | 'stairs' | 'kiosk' | 'shelter' | 'bus' | 'sign'

// ─────────────────────────── 헬퍼 ───────────────────────────

const at = (cx: number, cy: number, w: number, d: number): Rect =>
  [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2]

const solid = (id: string, rect: Rect, z0: number, h: number, look: SolidLook): Solid =>
  ({ id, rect, z0, h, look })

/** 외벽 — 충돌은 h, 그림은 PARAPET_H. */
const parapet = (id: string, rect: Rect, z0: number, h: number, look: SolidLook = 'wall'): Solid =>
  ({ id, rect, z0, h, look, renderH: PARAPET_H })

/** 외벽 렌더 높이. 카메라 피치 −34°에서 이 높이는 뒤쪽 3.5m만 가린다. */
export const PARAPET_H = 2.4

/** 축을 따라 벽을 세우되 지정 구간(개구부)은 비운다. */
const wallWithGaps = (
  idBase: string,
  axis: 'x' | 'y',
  /** 벽 두께 방향의 고정 좌표 [min, max] */
  fixed: readonly [number, number],
  /** 벽이 뻗는 범위 */
  span: readonly [number, number],
  /** 개구부 [from, to] 목록 (span 좌표계) */
  gaps: readonly (readonly [number, number])[],
  z0: number, h: number, look: SolidLook,
  renderH?: number,
): Solid[] => {
  const cap = (s: Solid): Solid => (renderH === undefined ? s : { ...s, renderH })
  const sorted = [...gaps].sort((a, b) => a[0] - b[0])
  const out: Solid[] = []
  let cursor = span[0]
  let n = 0
  for (const [g0, g1] of sorted) {
    if (g0 > cursor + 1e-6) {
      out.push(cap(solid(
        `${idBase}#${n++}`,
        axis === 'x' ? [cursor, fixed[0], g0, fixed[1]] : [fixed[0], cursor, fixed[1], g0],
        z0, h, look,
      )))
    }
    cursor = Math.max(cursor, g1)
  }
  if (cursor < span[1] - 1e-6) {
    out.push(cap(solid(
      `${idBase}#${n}`,
      axis === 'x' ? [cursor, fixed[0], span[1], fixed[1]] : [fixed[0], cursor, fixed[1], span[1]],
      z0, h, look,
    )))
  }
  return out
}

// ═══════════════════════ Z1 · 지상 (L0 ±0) ═══════════════════════
// 부록 A: world x −64~12, y 16~43 · 차도 y16~22 · 인도 y22~34 · 상가 y34~43
//         이면도로 개구부 x −31~−23 · 횡단보도 x−31~−23, y23.9~31.1

export const SPAWN = { x: -58, y: 24, z: 0 } as const   // 부록 A: spawn(−58,24)

/** 횡단보도(이면도로 횡단) 구간 — 신호에 따라 열리고 닫힌다 */
export const CROSSWALK = { xMin: -31, xMax: -23, yMin: 23.9, yMax: 31.1 } as const

/** MAP §3.3 — 주기 30s (녹 12s / 적 18s) */
export const TRAFFIC_LIGHT = { cycleMs: 30_000, greenMs: 12_000 } as const

/**
 * 지상 → B1 출구계단. 부록 A: 출구계단 Δ6m.
 * OBJ-05 출입구 x−0.9~8.9 안에서 시작해 동쪽으로 내려간다.
 * 지하 계단이 지상 건물 외곽선을 넘어 뻗는 것은 실제 역사와 동일하다.
 *
 * ★ **계단참(踊り場)이 있으므로 단일 경사가 아니다.**
 *   건축법은 높이 3m를 넘는 계단에 3m 이내마다 계단참을 요구하고, 6m 강하인 이 계단은
 *   실제로도 두 구간으로 나뉜다. 처음엔 충돌만 직선 램프로 두고 시각만 계단참을 넣었다가
 *   최대 0.30m가 어긋나 발이 디딤판을 뚫었다 — 보이는 것과 밟는 것이 갈리면 안 되는 지점이다.
 *
 *   아래 수치는 Blender `Z1_st_*` 지오메트리와 **같은 상수에서 나온다**:
 *   단너비 0.325 · 단높이 6/35 · 1구간 18단 · 계단참 1.2m · 2구간 17단.
 *   (도시철도 정거장 설계지침 표준은 330×165. 12.6m 안에 6m를 넣으려면 이 조합이 한계다.)
 */
const STAIR_TREAD = 0.325
const STAIR_RISE = 6 / 35
/** 1구간 끝 = 계단참 시작 */
const LANDING_X0 = 2.0 + 18 * STAIR_TREAD          // 7.85
/** 계단참 끝 = 2구간 시작 */
const LANDING_X1 = LANDING_X0 + 1.2                // 9.05
/** 계단참 고도 */
const LANDING_Z = -18 * STAIR_RISE                 // −3.0857

export const ENTRANCE_RAMP_A: Ramp = {
  id: 'RAMP-EXIT4-A',
  rect: [2.0, 25.4, LANDING_X0, 30.6],
  axis: 'x',
  zAtMin: FLOOR.L0,
  zAtMax: LANDING_Z,
  kind: 'stairs',
  carrySpeed: 0,
  carryDir: 1,
}

export const ENTRANCE_RAMP_B: Ramp = {
  id: 'RAMP-EXIT4-B',
  rect: [LANDING_X1, 25.4, 14.6, 30.6],
  axis: 'x',
  zAtMin: LANDING_Z,
  zAtMax: FLOOR.B1,
  kind: 'stairs',
  carrySpeed: 0,
  carryDir: 1,
}

/** 계단참 — 평면이므로 Slab이다. SLABS에 등록된다. */
export const ENTRANCE_LANDING = {
  id: 'RAMP-EXIT4-LANDING',
  rect: [LANDING_X0, 25.4, LANDING_X1, 30.6] as Rect,
  z: LANDING_Z,
  kind: 'landing' as const,
}

// ═══════════════════════ Z2 · 대합실 (B1 −6) ═══════════════════════
// 부록 A: world x 0~56, y 0~30 · Z3 진입선 x=56 (개구부 y 9~19)

/** 부록 A — 기둥 8개: x 12/24/36/48 × y 10/20, 1.0×1.0 */
const Z2_COLUMNS: Solid[] = [12, 24, 36, 48].flatMap((x) =>
  [10, 20].map((y) => solid(`OBJ-COL-${x}-${y}`, at(x, y, 1.0, 1.0), FLOOR.B1, 3.4, 'column')),
)

// ═══════════════════════ Z3 · 개찰구 (B1 −6) ═══════════════════════
// 부록 A: 게이트 본체 x 60.3~61.7 · G1 y6 · G2 y10 · G3 y14 · G4 y18 · G5 y22 · G6 y26(0.9m)

export type GateDef = Readonly<{
  /** 1..6 */
  id: number
  label: string
  y: number
  /** 통로 폭 m */
  width: number
  /** 교통약자 우대용 */
  wide: boolean
}>

export const GATES: readonly GateDef[] = [
  { id: 1, label: 'G1', y: 6, width: 0.55, wide: false },
  { id: 2, label: 'G2', y: 10, width: 0.55, wide: false },
  { id: 3, label: 'G3', y: 14, width: 0.55, wide: false },
  { id: 4, label: 'G4', y: 18, width: 0.55, wide: false },
  { id: 5, label: 'G5', y: 22, width: 0.55, wide: false },
  { id: 6, label: 'G6', y: 26, width: 0.90, wide: true },
]

export const GATE_BODY = { xMin: 60.3, xMax: 61.7 } as const
/** 충돌 개구 반폭 — 플레이어 반경(0.32) + 여유. 시각 폭과 의도적으로 다르다. */
export const GATE_CLEARANCE = (g: GateDef): number => Math.max(g.width / 2, 0.4)
/** 퍼널 작동 구간 — 이 x 범위에서 플레이어를 게이트 중앙으로 끌어당긴다 */
export const GATE_FUNNEL_X = { min: 58.4, max: 62.4 } as const
/** 태그 트리거 — 게이트 본체 바로 서쪽 */
export const GATE_TRIGGER_X = { min: 59.6, max: 60.3 } as const
/** 운임구역 경계. 이 선을 넘으면 되돌아갈 수 없다 (MAP §0) */
export const PAID_AREA_X = 62.0
/** 상부 표지등 고도 (부록 A: z −3.95) */
export const GATE_LAMP_Z = -3.95

// ═══════════════════════ Z4 · 하강 (B1 → B2) ═══════════════════════
// 부록 A: 운임구역 통로 (72,2)→(96,12) · 하강 x 95.8(z−6) → 120.0(z−20) · 사면 27.96m

export const ESCALATOR: Ramp = {
  id: 'OBJ-24',
  rect: [95.8, 1.35, 120.0, 3.05],
  axis: 'x',
  zAtMin: FLOOR.B1,   // x=95.8  → −6
  zAtMax: FLOOR.B2,   // x=120.0 → −20
  kind: 'escalator',
  carrySpeed: 1.5,    // MAP §1.3 — 에스컬레이터 정지 탑승
  carryDir: 1,
}

export const STAIRS: Ramp = {
  id: 'OBJ-25',
  rect: [95.8, 4.2, 120.0, 9.2],
  axis: 'x',
  zAtMin: FLOOR.B1,
  zAtMax: FLOOR.B2,
  kind: 'stairs',
  carrySpeed: 0,
  carryDir: 1,
}

export const RAMPS: readonly Ramp[] = [ENTRANCE_RAMP_A, ENTRANCE_RAMP_B, ESCALATOR, STAIRS]

// ═══════════════════════ Z5 · 승강장 (B2 −20) ═══════════════════════
// 부록 A: 승강장A y0~12 · 안전문 y12.15 · 선로A y14.0 · x 78~206
//         가동문 32개소: x = 78 + 16k + {2,6,10,14}, k=0..7 · 개구 1.60m

export const PLATFORM = { xMin: 78, xMax: 206, yMin: 0, yMax: 12 } as const
/** 걸을 수 있는 북측 한계. 안전문(12.15)을 살짝 넘겨 **문틀 안에 설 수 있게** 한다.
 *  이 여유가 없으면 문이 열려도 탑승 판정 y범위(11.5~)에 도달하지 못한다. */
export const PLATFORM_WALK_YMAX = 12.3
export const PSD_Y = 12.15
export const PSD_HALF_THICK = 0.12

/** 가동문 32개소의 중심 x. 부록 A 공식 그대로. */
export const DOOR_XS: readonly number[] = Array.from({ length: 8 }, (_, k) =>
  [2, 6, 10, 14].map((o) => 78 + 16 * k + o),
).flat()

/**
 * 승강장 기둥 — Blender `Z5_colr_*` 와 **같은 좌표**에서 나온다.
 * 한쪽만 고치면 통과 가능한 유령 기둥이 되므로 값을 바꿀 땐 양쪽을 같이 본다.
 */
const Z5_COLUMN_Y = 4.0
const Z5_COLUMN_XS = Array.from({ length: 15 }, (_, i) => 84 + i * 8)
const Z5_COLUMNS: Solid[] = Z5_COLUMN_XS.map((x) =>
  solid(`Z5-COL-${x}`, at(x, Z5_COLUMN_Y, 1.1, 1.1), FLOOR.B2, 4.5, 'column'),
)

/**
 * 점자 유도블록이 그리는 동선 — 흐르는 화살표가 이 위를 지난다.
 *
 * Blender의 `*_tact_guide` 지오메트리와 **같은 좌표**다. 한쪽만 고치면 화살표가
 * 블록 밖으로 흘러간다. 방향은 배열 순서 = 진행 방향(역 → 승강장).
 *
 * Z1 구간이 인도 본선에서 입구로 꺾이는 게 핵심이다 — 예전엔 유도선이 입구를
 * 지나쳐 계속 동쪽으로 갔고, 그대로 따라가면 출입구 측벽 앞에서 막혔다.
 */
export type GuidePath = Readonly<{ z: number; points: readonly (readonly [number, number])[] }>

export const GUIDE_PATHS: readonly GuidePath[] = [
  /**
   * Z1 인도 — y 26.5 일직선.
   *
   * 처음엔 y 23.4로 깔았다가 세 군데를 관통했다: 정류장 기둥 두 개(y 23.4~23.7)와
   * **이면도로 차단벽**(y 22~23.9). 유도선이 벽을 뚫고 지나가면 안내가 아니라 함정이다.
   * y 26.5는 쉘터 북쪽 · 횡단보도 대역(23.9~31.1) 안 · 출입구 개구부(25.4~30.6) 정면을
   * 한 번에 만족하는 유일하게 깔끔한 선이다. 꺾을 필요도 없어졌다.
   */
  { z: FLOOR.L0, points: [[-60, 26.5], [1.3, 26.5]] },
  /** 정류장 → 본선 접속 (스폰이 쉘터 안이다) */
  { z: FLOOR.L0, points: [[-58, 25.6], [-58, 26.5]] },
  { z: FLOOR.B1, points: [[15.2, 28], [20, 28], [20, 14], [55.8, 14]] },
  { z: FLOOR.B1, points: [[56, 14], [59.2, 14]] },
  { z: FLOOR.B1, points: [[62.6, 14], [68, 14], [68, 7], [95, 7]] },
  /**
   * Z5 승강장 — y 7.0.
   * y 6.0은 **환승계단(OBJ-34, x138~142.6 · y0.4~6.0)** 을 스쳤다. P0에서 잠긴 계단으로
   * 화살표가 안내하는 꼴이었다. 문 쪽 지선도 x140 → 144로 옮겼다(둘 다 가동문 위치다).
   */
  { z: FLOOR.B2, points: [[80, 7], [202, 7]] },
]

/** 승강장에서 유도선 → 가동문으로 갈라지는 지선의 x. 전부 DOOR_XS 위에 있다. */
export const GUIDE_DOOR_XS = [112, 144, 176] as const

/** 승차 대기줄 마커 — P0은 시각 표시만 (MAP §7.3) */
export const QUEUE_MARKERS = [
  { label: '3-1', x: 112, y: 10 },
  { label: '4-4', x: 140, y: 10 },
  { label: '7-1', x: 176, y: 10 },
] as const

// ═══════════════════════ 바닥 (Slab) ═══════════════════════

export const SLABS: readonly Slab[] = [
  // ── Z1 (L0)
  { id: 'Z1-ROAD', rect: [-64, 16, 12, 22], z: FLOOR.L0, kind: 'road' },
  { id: 'Z1-WALK', rect: [-64, 22, 2, 34], z: FLOOR.L0, kind: 'sidewalk' },
  // 출입구 내부 서측 랜딩 (계단 시작 전)
  { id: 'Z1-LANDING', rect: [-0.9, 25.4, 2.0, 30.6], z: FLOOR.L0, kind: 'landing' },
  // 출구계단 중간 계단참 — 시각 지오메트리와 같은 좌표 (위 ENTRANCE_LANDING 주석 참고)
  ENTRANCE_LANDING,

  // ── Z2 (B1) — 계단통(x2~14.6, y25.4~30) 구멍을 피해 3조각으로 분할
  { id: 'Z2-MAIN', rect: [0, 0, 56, 25.4], z: FLOOR.B1, kind: 'concourse' },
  { id: 'Z2-NW', rect: [0, 25.4, 2.0, 30], z: FLOOR.B1, kind: 'concourse' },
  { id: 'Z2-NE', rect: [14.6, 25.4, 56, 30], z: FLOOR.B1, kind: 'concourse' },

  // ── Z3 (B1)
  { id: 'Z3', rect: [56, 0, 72, 32], z: FLOOR.B1, kind: 'paid' },

  // ── Z4 상부 (B1) — 운임구역 통로
  // xMax는 하강 램프 시작(95.8)과 정확히 맞춘다. 겹치면 경계에서 z가 0.4m 튄다.
  { id: 'Z4-UPPER', rect: [72, 2, 95.8, 12], z: FLOOR.B1, kind: 'paid' },
  // Z4 하부 착지 (B2) — 램프 하단 ~ 승강장
  { id: 'Z4-LOWER', rect: [119.0, 1.0, 128, 9.5], z: FLOOR.B2, kind: 'platform' },

  // ── Z5 (B2)
  { id: 'Z5', rect: [PLATFORM.xMin, PLATFORM.yMin, PLATFORM.xMax, PLATFORM_WALK_YMAX], z: FLOOR.B2, kind: 'platform' },
]

// ═══════════════════════ 충돌체 (정적) ═══════════════════════

export const SOLIDS: readonly Solid[] = [
  // ───────────── Z1 ─────────────
  solid('OBJ-01-BUS', [-65.3, 19.1, -54.4, 21.7], 0, 3.2, 'bus'),
  // 정류장 쉘터 — 지붕과 기둥만. 부록 A의 spawn(−58,24)이 이 안이므로 통짜 박스면 스폰이 벽 속이다.
  { id: 'Z1-SHELTER-ROOF', rect: [-60.0, 23.4, -56.0, 25.4], z0: 2.45, h: 0.3, look: 'shelter' },
  solid('Z1-SHELTER-P1', [-60.0, 23.4, -59.7, 23.7], 0, 2.45, 'shelter'),
  solid('Z1-SHELTER-P2', [-60.0, 25.1, -59.7, 25.4], 0, 2.45, 'shelter'),
  solid('Z1-SHELTER-P3', [-56.3, 23.4, -56.0, 23.7], 0, 2.45, 'shelter'),
  solid('Z1-SHELTER-P4', [-56.3, 25.1, -56.0, 25.4], 0, 2.45, 'shelter'),
  solid('OBJ-03-CART', at(-50, 32, 2.4, 1.6), 0, 2.2, 'kiosk'),        // 붕어빵 카트 · 신규 치수
  solid('OBJ-04-STALL', at(-40, 32, 3.0, 1.4), 0, 1.9, 'kiosk'),       // 인도 좌판 · 신규 치수
  solid('OBJ-02-LIGHT', at(-32.6, 22.6, 0.4, 0.4), 0, 4.2, 'sign'),    // 신호등 폴
  solid('ITM-05-BENCH', at(-12, 32, 2.2, 0.7), 0, 0.9, 'bench'),
  // 인도 남/북 경계 (차도·상가 차단)
  solid('Z1-CURB-S', [-64, 21.8, 2, 22.0], 0, 0.9, 'wall'),
  // 상가는 북쪽 배경이라 높이를 살려 둔다 — 카메라가 북서에 서므로 시야를 막지 않는다
  solid('Z1-SHOPS', [-64, 34.0, 2, 34.4], 0, 4.5, 'wall'),
  // 이면도로 — 횡단보도 밖은 항상 막힘
  solid('Z1-SIDEROAD-S', [CROSSWALK.xMin, 22.0, CROSSWALK.xMax, CROSSWALK.yMin], 0, 1.1, 'wall'),
  solid('Z1-SIDEROAD-N', [CROSSWALK.xMin, CROSSWALK.yMax, CROSSWALK.xMax, 34.0], 0, 1.1, 'wall'),
  // 서쪽 맵 끝 — 인도 슬랩이 x=−64에서 끝나므로 충돌벽은 불필요하다(isWalkable이 막는다).
  // 벽을 세우면 스폰 시 카메라가 그 바깥에 놓여 화면이 통째로 가려진다.
  parapet('Z1-END-W', [-64.4, 16, -64.0, 34], 0, 4.5),
  // 출입구 건물 (OBJ-05, x−0.9~8.9 · H7.79) — 통로 y25.4~30.6만 열림
  ...wallWithGaps('OBJ-05-W', 'y', [-1.3, -0.9], [22, 34], [[25.4, 30.6]], 0, 7.79, 'wall', 3.4),
  parapet('OBJ-05-S', [-0.9, 25.0, 14.6, 25.4], 0, 4.0),
  parapet('OBJ-05-N', [-0.9, 30.6, 14.6, 31.0], 0, 4.0),
  // 인도 동쪽 끝 (건물 남/북 우회 차단)
  parapet('Z1-END-E-S', [1.6, 22, 2.0, 25.4], 0, 4.5),
  parapet('Z1-END-E-N', [1.6, 30.6, 2.0, 34], 0, 4.5),

  // ───────────── Z2 (B1) ─────────────
  ...Z2_COLUMNS,
  solid('OBJ-06-VENDA', at(11, 5, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-07-VENDB', at(22, 5, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-08-VENDC', at(52, 3, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-10-CHARGE', at(10, 21, 1.2, 0.7), FLOOR.B1, 1.6, 'machine'),
  solid('OBJ-15-BOARD', at(26, 16, 1.0, 1.0), FLOOR.B1, 2.8, 'sign'),
  solid('ACT-02-BENCH', at(42, 15, 2.4, 0.8), FLOOR.B1, 0.9, 'bench'),
  solid('OBJ-11-BENCH', at(47, 25, 2.4, 0.8), FLOOR.B1, 0.9, 'bench'),
  solid('OBJ-13-LOST', at(50, 23.6, 3.0, 1.2), FLOOR.B1, 2.6, 'kiosk'),
  // 화장실 — 실제로 지어진 방(Blender `Z2_OBJ14_room`)과 같은 범위.
  // 예전 5.0×3.0(y 27~30)은 문틀보다 1.35m 앞에서부터 막아서, 아무것도 없는데 걸렸다.
  { id: 'OBJ-14-WC', rect: [41.5, 28.35, 46.5, 30.4], z0: FLOOR.B1, h: 3.2, look: 'wall' },
  solid('OBJ-16-UMBRELLA', at(38, 5, 1.0, 0.6), FLOOR.B1, 1.0, 'prop'),
  solid('OBJ-17-NEWSSTAND', at(32, 4.6, 2.6, 1.4), FLOOR.B1, 2.4, 'kiosk'),
  solid('OBJ-18-CAFE', at(29.5, 27.4, 5.0, 3.4), FLOOR.B1, 3.0, 'glass'),
  solid('OBJ-19-CVS', at(24, 27.4, 5.0, 3.4), FLOOR.B1, 3.0, 'glass'),
  // OBJ-28 가림막 ㄱ자 (부록 A 그대로)
  solid('OBJ-28-N', [44, 6.6, 56, 7.0], FLOOR.B1, 2.4, 'wall'),
  solid('OBJ-28-W', [43.8, 0, 44.2, 7.0], FLOOR.B1, 2.4, 'wall'),
  // Z2 외벽
  parapet('Z2-S', [0, -0.4, 56, 0], FLOOR.B1, 4.0),
  parapet('Z2-N', [14.6, 30, 56, 30.4], FLOOR.B1, 4.0),
  parapet('Z2-NW-CAP', [0, 30, 2.0, 30.4], FLOOR.B1, 4.0),
  parapet('Z2-W', [-0.4, 0, 0, 30.4], FLOOR.B1, 4.0),
  // Z2 → Z3 진입선 x=56 · 개구부 y 9~19 (부록 A)
  ...wallWithGaps('Z2-E', 'y', [55.8, 56.2], [0, 30.4], [[9, 19]], FLOOR.B1, 4.0, 'wall', PARAPET_H),

  // ───────────── Z3 (B1) ─────────────
  // OBJ-12 역무실 (부록 A: 실 x56.3~61.5 · y0.2~4.0)
  solid('OBJ-12-OFFICE', [56.3, 0.2, 61.5, 4.0], FLOOR.B1, 3.2, 'glass'),
  // 게이트 뱅크 — 본체 x60.3~61.7, 통로만 개구.
  // ⚠ 물리 개구부는 **시각 폭보다 넓다**: 통로 0.55m는 플레이어 지름(0.64m)보다 좁아서
  //   그대로 두면 정상 게이트조차 못 지나간다. 시각은 고증대로 0.55m를 유지하고,
  //   충돌만 GATE_CLEARANCE만큼 넓힌다 (GDD §11 — 판정은 관대하게).
  //   대신 movement의 게이트 퍼널이 플레이어를 중앙으로 끌어당겨 시각적 관통을 막는다.
  ...wallWithGaps(
    'GATE-BANK', 'y', [GATE_BODY.xMin, GATE_BODY.xMax], [0, 32],
    GATES.map((g) => [g.y - GATE_CLEARANCE(g), g.y + GATE_CLEARANCE(g)] as const),
    FLOOR.B1, 1.15, 'gate',
  ),
  // OBJ-21 비상게이트 (61,30) — P0 잠김
  solid('OBJ-21-EMG', at(61, 30, 1.4, 1.4), FLOOR.B1, 1.3, 'gate'),
  solid('OBJ-22-INTERCOM', at(58.2, 30, 0.5, 0.5), FLOOR.B1, 1.4, 'prop'),
  // Z3 외벽
  parapet('Z3-S', [56, -0.4, 72, 0], FLOOR.B1, 4.0),
  parapet('Z3-N', [56, 32, 72, 32.4], FLOOR.B1, 4.0),
  // Z3 → Z4 : x=72, 개구부 y 2~12 (부록 A: 통로 (72,2)→(96,12))
  ...wallWithGaps('Z3-E', 'y', [71.8, 72.2], [0, 32.4], [[2, 12]], FLOOR.B1, 4.0, 'wall', PARAPET_H),

  // ───────────── Z4 (B1 → B2) ─────────────
  parapet('Z4-COR-S', [72, 1.6, 95.8, 2.0], FLOOR.B1, 4.0),
  parapet('Z4-COR-N', [72, 12.0, 95.8, 12.4], FLOOR.B1, 4.0),
  // 하강부 측벽 · 레인 분리 난간
  // 하강부 측벽·난간 — 충돌은 15m(사면 전체)지만 그림은 낮게. 안 그러면 계단이 안 보인다
  parapet('Z4-DESC-S', [95.8, 0.95, 120.4, 1.35], FLOOR.B2, 15.0),
  { id: 'Z4-DIVIDER', rect: [95.8, 3.05, 120.4, 4.2], z0: FLOOR.B2, h: 15.0, look: 'wall', renderH: 0.9 },
  parapet('Z4-DESC-N', [95.8, 9.2, 120.4, 9.6], FLOOR.B2, 15.0),
  // OBJ-26 엘리베이터 — P0 잠김 (부록 A: x96.0~98.4 · y9.6~12.0)
  solid('OBJ-26-ELEV', [96.0, 9.6, 98.4, 12.0], FLOOR.B1, 3.2, 'glass'),
  // 하강부 진입 전 남은 통로 끝 마감 (x=96 북측)
  parapet('Z4-COR-CAP', [95.8, 9.6, 96.2, 12.0], FLOOR.B1, 4.0),

  // ───────────── Z5 (B2) ─────────────
  parapet('Z5-END-W', [77.6, 0, 78.0, 12], FLOOR.B2, 5.0),
  parapet('Z5-END-E', [206, 0, 206.4, 12], FLOOR.B2, 5.0),
  // 승강장 남측 벽 — Z4 착지 개구부(y1~9.5, x119~128)만 열림
  ...wallWithGaps('Z5-S', 'x', [-0.4, 0], [78, 206], [[119, 128]], FLOOR.B2, 5.0, 'wall', PARAPET_H),
  // 승강장 기둥 — 신도림역 실사 계측(인물 1.72m 기준 지름 ≈1.1m)을 따랐다.
  // 시각은 16각 원기둥이고 충돌은 정사각 AABB다. 판정이 조금 관대한 쪽이라
  // "보이는데 안 막히는" 반대 경우보다 낫다 (GDD §11 — 판정은 관대하게).
  ...Z5_COLUMNS,
  // OBJ-34 환승계단 (부록 A: x138~142.6, y0.4~6.0)
  solid('OBJ-34-XFER', [138, 0.4, 142.6, 6.0], FLOOR.B2, 3.2, 'stairs'),
  solid('ACT-09-SEAT', at(126, 1.5, 2.4, 0.8), FLOOR.B2, 0.9, 'bench'),
  solid('Z5-BENCH', at(190, 1.5, 2.4, 0.8), FLOOR.B2, 0.9, 'bench'),
  // OBJ-32 반대편 연결통로 — P0 잠김 (부록 A: x84.5~87.5, y0.5~4)
  parapet('OBJ-32-LINK', [84.5, 0.5, 87.5, 4.0], FLOOR.B2, 3.2),
  // 안전문(PSD) 고정 구간 — 가동문 32개소만 비운다
  ...wallWithGaps(
    'PSD', 'x', [PSD_Y - PSD_HALF_THICK, PSD_Y + PSD_HALF_THICK], [PLATFORM.xMin, PLATFORM.xMax],
    DOOR_XS.map((x) => [x - 0.8, x + 0.8] as const),
    FLOOR.B2, 2.0, 'psd',
  ),
]

// ═══════════════════════ 존 판정 ═══════════════════════

/** x + z 조합으로 존을 결정한다. Z1/Z2와 Z4/Z5는 x가 겹치므로 층이 필요하다. */
export const zoneAt = (x: number, z: number): ZoneId => {
  if (z > FLOOR.B1 + 2.0) return 'Z1'          // L0 부근 (계단 상단 포함)
  if (z > FLOOR.B2 + 3.0) {                    // B1 층
    if (x < 56) return 'Z2'
    if (x < 72) return 'Z3'
    return 'Z4'
  }
  return x < 119 ? 'Z4' : 'Z5'                 // B2 층
}
