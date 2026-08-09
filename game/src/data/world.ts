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
  /** false면 그려지기만 하고 충돌하지 않는다. 생략하면 true. */
  collide?: boolean
}>
export type SolidLook =
  | 'wall' | 'glass' | 'column' | 'prop' | 'machine' | 'bench'
  | 'gate' | 'psd' | 'stairs' | 'kiosk' | 'shelter' | 'bus' | 'sign'

// ─────────────────────────── 헬퍼 ───────────────────────────

const at = (cx: number, cy: number, w: number, d: number): Rect =>
  [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2]

const solid = (id: string, rect: Rect, z0: number, h: number, look: SolidLook, collide = true): Solid =>
  ({ id, rect, z0, h, look, collide })

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
// 게이트 본체 x 60.3~61.7 · G1 y8 … G9 y24 · 피치 2.0m · G9만 우대용 0.9m
//
// 피치는 원래 4.0m였다. 2.0m로 좁히면서 6기 → 9기로 늘렸고, 뱅크가
// y 7.45~24.73 (17.3m)으로 오히려 짧아졌다. 남은 구간은 Blender의
// `Z3_gate_glass`(유리 칸막이)가 시각적으로 막는다 — 충돌은 예전부터
// wallWithGaps가 y 0~32 전체를 막고 있었지만 **보이는 게 없어서
// 통과할 수 있어 보였다.**

export type GateDef = Readonly<{
  /** 1..9 */
  id: number
  label: string
  y: number
  /** 통로 폭 m */
  width: number
  /** 교통약자 우대용 */
  wide: boolean
}>

/** 피치 2.0m로 배열. Blender `Z3_GATE_G{id}_*` 이름과 1:1 대응한다. */
export const GATES: readonly GateDef[] = [
  { id: 1, label: 'G1', y: 8, width: 0.55, wide: false },
  { id: 2, label: 'G2', y: 10, width: 0.55, wide: false },
  { id: 3, label: 'G3', y: 12, width: 0.55, wide: false },
  { id: 4, label: 'G4', y: 14, width: 0.55, wide: false },
  { id: 5, label: 'G5', y: 16, width: 0.55, wide: false },
  { id: 6, label: 'G6', y: 18, width: 0.55, wide: false },
  { id: 7, label: 'G7', y: 20, width: 0.55, wide: false },
  { id: 8, label: 'G8', y: 22, width: 0.55, wide: false },
  { id: 9, label: 'G9', y: 24, width: 0.90, wide: true },
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

/**
 * P2 — OBJ-21 비상게이트. 개찰기 뱅크 북쪽 끝(y 30)의 폭 1.4m 개구부.
 *
 * **요금을 안 본다.** 잔액 0원 시드에서 자판기를 다 긁어도 요금이 모자랄 수 있고,
 * P1은 자판기 합계 보장으로 그걸 막았다. P2는 막는 대신 문을 하나 더 준다
 * (GDD §11 "충전 루트 4개"가 여기서 완성된다).
 */
export const EMERGENCY_GATE = { x: 61, y: 30, halfW: 0.7 } as const
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

/**
 * 반대 방면(디렉터 지시) — 게이트9(y24) 동쪽 빈 홀을 뚫어 새 통로를 냈다.
 * Blender에서 기존 Z4_DESCENT·Z5_PLATFORM·Z5_TRAIN 을 **y만 +40** 미러 복제했다
 * (회전은 안 줬다 — "반대 방면"은 시각 반전이 아니라 별도 플랫폼·열차로 표현한다).
 * 그래서 이 아래 값들도 전부 원본에 `Y_OFFSET_OPP` 를 더한 것뿐이다 — x·z는 원본과 동일.
 */
export const Y_OFFSET_OPP = 40

export const ESCALATOR_OPP: Ramp = {
  id: 'OBJ-24-OPP',
  rect: [95.8, 1.35 + Y_OFFSET_OPP, 120.0, 3.05 + Y_OFFSET_OPP],
  axis: 'x',
  zAtMin: FLOOR.B1,
  zAtMax: FLOOR.B2,
  kind: 'escalator',
  carrySpeed: 1.5,
  carryDir: 1,
}

export const STAIRS_OPP: Ramp = {
  id: 'OBJ-25-OPP',
  rect: [95.8, 4.2 + Y_OFFSET_OPP, 120.0, 9.2 + Y_OFFSET_OPP],
  axis: 'x',
  zAtMin: FLOOR.B1,
  zAtMax: FLOOR.B2,
  kind: 'stairs',
  carrySpeed: 0,
  carryDir: 1,
}

export const RAMPS: readonly Ramp[] = [
  ENTRANCE_RAMP_A, ENTRANCE_RAMP_B, ESCALATOR, STAIRS, ESCALATOR_OPP, STAIRS_OPP,
]

/**
 * 계단·에스컬레이터·엘리베이터 앞 착지대(B1 쪽) — 디렉터 지시로 열차 도착의
 * 위치 트리거로 쓴다. STAIRS·ESCALATOR 상단(x 95.8)과 OBJ-26-ELEV(x96~98.4·y9.6~12)를
 * 아우르는 폭으로 잡았다 — "계단/엘리베이터 위치에 도착했을 때"가 이 셋 중 아무거나
 * 앞이면 성립해야 하기 때문이다.
 */
export const TRAIN_TRIGGER_ZONE: Rect = [95.0, 1.0, 99.5, 12.5]
export const TRAIN_TRIGGER_ZONE_OPP: Rect =
  [95.0, 1.0 + Y_OFFSET_OPP, 99.5, 12.5 + Y_OFFSET_OPP]

// ═══════════════════════ Z5 · 승강장 (B2 −20) ═══════════════════════
// 부록 A: 승강장A y0~12 · 안전문 y12.15 · 선로A y14.0 · x 78~206
//         가동문 32개소: x = 78 + 16k + {2,6,10,14}, k=0..7 · 개구 1.60m

export const PLATFORM = { xMin: 78, xMax: 206, yMin: 0, yMax: 12 } as const
/** 걸을 수 있는 북측 한계. 안전문(12.15)을 살짝 넘겨 **문틀 안에 설 수 있게** 한다.
 *  이 여유가 없으면 문이 열려도 탑승 판정 y범위(11.5~)에 도달하지 못한다. */
export const PLATFORM_WALK_YMAX = 12.3
export const PSD_Y = 12.15
export const PSD_HALF_THICK = 0.12

/**
 * 객실 내부 — 걸어 들어갈 수 있는 y 구간.
 *
 * 치수는 `tools/hq_train.py` 의 차체 실측에서 왔다: 근측 벽 안쪽 면 12.52 ·
 * 원측 벽 안쪽 면 15.48. 바닥은 승강장 슬래브 끝(12.3)보다 **앞에서 시작**해
 * 겹쳐야 한다 — 딱 맞대면 경계에서 발밑이 한 프레임 비어 떨어진다.
 */
export const CABIN_Y0 = 12.2
export const CABIN_Y1 = 15.45

/** 가동문 32개소의 중심 x. 부록 A 공식 그대로. */
export const DOOR_XS: readonly number[] = Array.from({ length: 8 }, (_, k) =>
  [2, 6, 10, 14].map((o) => 78 + 16 * k + o),
).flat()

/** 반대 방면 플랫폼 — x·문 배치는 원본과 같고 y만 `Y_OFFSET_OPP` 만큼 밀렸다 */
export const PLATFORM_OPP = {
  xMin: PLATFORM.xMin, xMax: PLATFORM.xMax,
  yMin: PLATFORM.yMin + Y_OFFSET_OPP, yMax: PLATFORM.yMax + Y_OFFSET_OPP,
} as const
export const PLATFORM_WALK_YMAX_OPP = PLATFORM_WALK_YMAX + Y_OFFSET_OPP
export const PSD_Y_OPP = PSD_Y + Y_OFFSET_OPP
/** 문 x 위치는 원본과 동일 — 두 플랫폼이 나란히 안 놓이고 y로만 갈리기 때문이다 */
export const DOOR_XS_OPP: readonly number[] = DOOR_XS

/**
 * 승강장 기둥 — Blender `Z5_colr_*` 와 **같은 좌표**에서 나온다.
 * 한쪽만 고치면 통과 가능한 유령 기둥이 되므로 값을 바꿀 땐 양쪽을 같이 본다.
 */
const Z5_COLUMN_Y = 4.0
/**
 * x=84 · x=140 은 뺀다 — 8m 등간격이 하필 **환승계단 두 곳 위**에 떨어졌다.
 * (OBJ-32 x84.2~88.8 · OBJ-34 x137.6~143.2, 둘 다 y가 4.0을 지난다)
 * 기둥이 계단 한복판에 박혀 있었다. Blender `Z5_colr_*` 에서도 같이 지웠다.
 */
const Z5_COLUMN_SKIP = new Set([84, 140])
const Z5_COLUMN_XS = Array.from({ length: 15 }, (_, i) => 84 + i * 8)
  .filter((x) => !Z5_COLUMN_SKIP.has(x))
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
  /**
   * 객실 바닥 — **열차 안까지 걸어 들어가려면 발밑이 있어야 한다.**
   *
   * 열차는 지금까지 순수 시각물이었다(GLB만 있고 충돌체가 없다). 그래서 문이 열려도
   * 문틀을 넘는 순간 슬래브가 끊겨 밟을 데가 없었고, 탑승은 문 앞에서 **판정으로만**
   * 일어났다. 실제로 들어가게 하려면 승강장 슬래브(…12.3)와 맞물리는 칸 바닥이 필요하다.
   *
   * 열차가 없을 때 허공을 밟는 문제는 안 생긴다 — 이 구역으로 가는 유일한 길이
   * 가동문이고, 문이 안 열렸으면 `systems/train.ts psdDoors` 가 동적 벽으로 막는다.
   */
  { id: 'Z5-CABIN', rect: [PLATFORM.xMin, CABIN_Y0, PLATFORM.xMax, CABIN_Y1], z: FLOOR.B2, kind: 'platform' },

  /**
   * ⚠ 반대 방면(디렉터 지시) — 여기부터가 실제 사고였다. `SOLIDS`(벽)만 미러
   * 복제했지 **바닥(`SLABS`)은 하나도 안 옮겼다.** `isWalkable`은 `SOLIDS`가 아니라
   * `SLABS`/`RAMPS`로 발밑을 잰다 — 그래서 벽은 다 있는데 반대 방면 전체가
   * "밟을 데가 없어서" 실측 스크린샷처럼 안 이어진 것처럼 보였다.
   * CONN 연결부·Z4-OPP 통로·Z5-OPP 승강장을 전부 원본과 같은 폭으로 y만
   * `Y_OFFSET_OPP` 만큼 밀어 새로 등록한다.
   */
  // ── Z3 연결부 — CONN-W/E(위 SOLIDS) 사이 바닥. y42.2까지 — Z4-COR-S-OPP 북쪽 면에 닿는다.
  { id: 'Z3-CONN-OPP', rect: [56, 32, 72, 52.4], z: FLOOR.B1, kind: 'paid' },
  // ── Z4-OPP 상부 (B1) — 반대 방면 운임구역 통로
  { id: 'Z4-UPPER-OPP', rect: [72, 2 + Y_OFFSET_OPP, 95.8, 12 + Y_OFFSET_OPP], z: FLOOR.B1, kind: 'paid' },
  // Z4-OPP 하부 착지 (B2) — 램프 하단 ~ 승강장
  { id: 'Z4-LOWER-OPP', rect: [119.0, 1.0 + Y_OFFSET_OPP, 128, 9.5 + Y_OFFSET_OPP], z: FLOOR.B2, kind: 'platform' },
  // ── Z5-OPP (B2)
  {
    id: 'Z5-OPP',
    rect: [PLATFORM_OPP.xMin, PLATFORM_OPP.yMin, PLATFORM_OPP.xMax, PLATFORM_WALK_YMAX_OPP],
    z: FLOOR.B2,
    kind: 'platform',
  },
  {
    id: 'Z5-CABIN-OPP',
    rect: [PLATFORM.xMin, CABIN_Y0 + Y_OFFSET_OPP, PLATFORM.xMax, CABIN_Y1 + Y_OFFSET_OPP],
    z: FLOOR.B2,
    kind: 'platform',
  },
]

// ═══════════════════════ 충돌체 (정적) ═══════════════════════

export const SOLIDS: readonly Solid[] = [
  // ───────────── Z1 ─────────────
  solid('OBJ-01-BUS', [-65.3, 19.1, -54.4, 21.7], 0, 3.2, 'bus'),
  // 정류장 쉘터 — 지붕과 기둥만. 부록 A의 spawn(−58,24)이 이 안이므로 통짜 박스면 스폰이 벽 속이다.
  { id: 'Z1-SHELTER-ROOF', rect: [-60.0, 23.4, -56.0, 25.4], z0: 2.45, h: 0.3, look: 'shelter' },
  // 기둥은 스폰(−58,24)에 너무 가까워 반경 0.32 캡슐이 걸린다 — 그려지기만 하고 충돌은 안 한다.
  solid('Z1-SHELTER-P1', [-60.0, 23.4, -59.7, 23.7], 0, 2.45, 'shelter', false),
  solid('Z1-SHELTER-P2', [-60.0, 25.1, -59.7, 25.4], 0, 2.45, 'shelter', false),
  solid('Z1-SHELTER-P3', [-56.3, 23.4, -56.0, 23.7], 0, 2.45, 'shelter', false),
  solid('Z1-SHELTER-P4', [-56.3, 25.1, -56.0, 25.4], 0, 2.45, 'shelter', false),
  solid('OBJ-03-CART', at(-50, 32, 2.4, 1.6), 0, 2.2, 'kiosk'),        // 붕어빵 카트 · 신규 치수
  solid('OBJ-04-STALL', at(-40, 32, 3.0, 1.4), 0, 1.9, 'kiosk'),       // 인도 좌판 · 신규 치수
  solid('OBJ-02-LIGHT', at(-32.6, 22.6, 0.4, 0.4), 0, 4.2, 'sign'),    // 신호등 폴
  solid('ITM-05-BENCH', at(-12, 32, 2.2, 0.7), 0, 0.9, 'bench'),
  // 상가는 북쪽 배경이라 높이를 살려 둔다 — 카메라가 북서에 서므로 시야를 막지 않는다
  solid('Z1-SHOPS', [-64, 34.0, 2, 34.4], 0, 4.5, 'wall'),
  /**
   * ⚠ 차도 연석(`Z1-CURB-S`)과 이면도로 벽(`Z1-SIDEROAD-S/N`)은 **일부러 없앴다.**
   *
   * 디렉터 지시 — 적신호에도 자유롭게 건너고, 옆 차도에도 내려설 수 있어야 한다.
   * 차도 바닥은 이미 `Z1-ROAD` 슬랩(y 16~22)이라 벽만 걷으면 걸어 들어간다.
   * 막는 대신 **차에 치이면 그 자리에서 끝난다**(E-18, `systems/roadHazard`).
   *
   * 남쪽 한계는 y 16 이다 — 그 너머 인도(y 12.6~16)는 슬랩이 없어 `isWalkable` 이
   * 막는다. 건너편 건물이 거기서 시작하므로 그 선이 곧 반대편 연석이다.
   */
  // 서쪽 맵 끝 — 인도 슬랩이 x=−64에서 끝나므로 충돌벽은 불필요하다(isWalkable이 막는다).
  // 벽을 세우면 스폰 시 카메라가 그 바깥에 놓여 화면이 통째로 가려진다.
  parapet('Z1-END-W', [-64.4, 16, -64.0, 34], 0, 4.5),
  // 출입구 건물 (OBJ-05, x−0.9~8.9 · H7.79) — 통로 y25.4~30.6만 열림
  ...wallWithGaps('OBJ-05-W', 'y', [-1.3, -0.9], [22, 34], [[25.4, 30.6]], 0, 7.79, 'wall', 3.4),
  parapet('OBJ-05-S', [-0.9, 25.0, 14.6, 25.4], 0, 4.0),
  parapet('OBJ-05-N', [-0.9, 30.6, 14.6, 31.0], 0, 4.0),
  // 출구계단 **계단실 측벽**. 위 두 벽은 z0=0 부터라 지상만 막고,
  // 계단을 내려가는 동안(z −6~0)에는 옆이 뚫려 있었다 —
  // 시각(`Z1_st_wall`)은 처음부터 있었으니 벽을 통과해 계단 밖으로 나갈 수 있었다.
  // 위쪽 끝을 z=0 에 맞춰야 인도를 걸을 때 이 벽에 걸리지 않는다.
  parapet('Z1-STW-S', [2.0, 25.2, 14.88, 25.4], FLOOR.B1, 6.0),
  parapet('Z1-STW-N', [2.0, 30.6, 14.88, 30.8], FLOOR.B1, 6.0),
  // 인도 동쪽 끝 (건물 남/북 우회 차단)
  parapet('Z1-END-E-S', [1.6, 22, 2.0, 25.4], 0, 4.5),
  parapet('Z1-END-E-N', [1.6, 30.6, 2.0, 34], 0, 4.5),

  // ───────────── Z2 (B1) ─────────────
  ...Z2_COLUMNS,
  // 자판기는 점포 파일런(칸 사이 0.40 m 띠) 앞에 등을 붙인다 — 개구부는
  // 칸 중심 ±0.80 이라 파일런 중심(13.03 · 21.63 · 25.93)이면 문과 안 겹친다.
  // 예전 (11,5)·(22,5) 는 편의점 문 한복판과 통로 한가운데였고,
  // (52,3) 은 `Z2_OBJ28_hoard` 가벽 안에 파묻혀 보이지도 않았다.
  // ⚠ `tools/hq_fixups.VEND_TARGET` 과 **같이** 고쳐야 한다. 그림과 충돌이 갈라진다.
  solid('OBJ-06-VENDA', at(13.03, 4.15, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-07-VENDB', at(21.63, 4.15, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-08-VENDC', at(25.93, 4.15, 1.4, 0.9), FLOOR.B1, 2.0, 'machine'),
  solid('OBJ-10-CHARGE', at(10, 21, 1.2, 0.7), FLOOR.B1, 1.6, 'machine'),
  solid('OBJ-15-BOARD', at(26, 16, 1.0, 1.0), FLOOR.B1, 2.8, 'sign'),
  solid('ACT-02-BENCH', at(42, 15, 2.4, 0.8), FLOOR.B1, 0.9, 'bench'),
  // 화장실 확장(파사드 y26 → y25)에 맞춰 두 번 물렸다.
  // x는 남·여 출입구 사이 벽 앞, y는 파사드에 등을 붙인 위치다.
  solid('OBJ-11-BENCH', at(44.6, 24.73, 2.4, 0.8), FLOOR.B1, 0.9, 'bench'),
  // 다목적 화장실(x48.5~51) 정문 앞이 아니라 옆(WC-E 동쪽)으로, 뒷면을 그 벽(x51.0)에
  // 붙였다 — 디렉터 지시 두 번(옆으로 → 뒤를 벽에). 남향이던 걸 90도 돌려 동향으로
  // 뒀다(안 돌리면 뒤가 콘코스 허공이라 벽에 안 닿는다). `tools/hq_move_lost_and_found.py`
  // 와 같은 좌표.
  solid('OBJ-13-LOST', at(51.84, 27.5, 1.68, 2.6), FLOOR.B1, 2.6, 'kiosk'),
  // ── OBJ-14 화장실 (남 · 여 · 다목적) ───────────────────────────────
  // 좌표는 전부 `tools/build_wc.py`의 상수와 같은 값이다. **한쪽만 고치면
  // 벽 없는 데서 막히거나 벽을 통과한다** — 예전 통짜 박스가 정확히 그랬다.
  // 이제 들어갈 수 있는 방이므로 벽·칸막이·위생기구를 각각 막는다.
  ...wallWithGaps(
    'WC-S', 'x', [25.0, 25.2], [36.0, 51.0],
    [[40.3, 41.5], [46.9, 48.1], [49.3, 50.5]],   // 남 · 여 · 다목적 출입구
    FLOOR.B1, 3.2, 'wall',
  ),
  solid('WC-N', [36.0, 29.8, 51.0, 30.0], FLOOR.B1, 3.2, 'wall'),
  solid('WC-W', [36.0, 25.0, 36.2, 30.0], FLOOR.B1, 3.2, 'wall'),
  solid('WC-E', [50.8, 25.0, 51.0, 30.0], FLOOR.B1, 3.2, 'wall'),
  solid('WC-DIV-MF', [41.9, 25.0, 42.1, 30.0], FLOOR.B1, 3.2, 'wall'),
  solid('WC-DIV-FA', [48.5, 25.0, 48.7, 30.0], FLOOR.B1, 3.2, 'wall'),
  // 가림벽 — 입구에서 안이 바로 보이지 않게 하는 벽. 시각과 충돌이 같이 있어야 의미가 있다
  solid('WC-SCR-M', [39.7, 25.2, 39.9, 26.6], FLOOR.B1, 2.0, 'wall'),
  solid('WC-SCR-F', [46.3, 25.2, 46.5, 26.6], FLOOR.B1, 2.0, 'wall'),
  // 대변기 부스는 통째로 막는다. 칸막이만 막으면 플레이어가 부스 안에 갇힌다
  solid('WC-BOOTH-M', [36.2, 28.2, 39.7, 29.8], FLOOR.B1, 1.9, 'wall'),
  solid('WC-BOOTH-F', [42.1, 28.2, 46.3, 29.8], FLOOR.B1, 1.9, 'wall'),
  solid('WC-CNT-M', [36.4, 25.2, 38.95, 25.75], FLOOR.B1, 0.8, 'prop'),
  solid('WC-CNT-F', [42.3, 25.2, 45.4, 25.75], FLOOR.B1, 0.8, 'prop'),
  solid('WC-CNT-A', [50.1, 25.2, 50.8, 25.75], FLOOR.B1, 0.8, 'prop'),
  solid('WC-URINAL', [41.56, 26.19, 41.9, 28.07], FLOOR.B1, 1.28, 'prop'),
  solid('WC-WCA', [48.92, 29.18, 49.49, 29.8], FLOOR.B1, 0.82, 'prop'),
  solid('OBJ-16-UMBRELLA', at(38, 5, 1.0, 0.6), FLOOR.B1, 1.0, 'prop'),
  solid('OBJ-17-NEWSSTAND', at(32, 4.6, 2.6, 1.4), FLOOR.B1, 2.4, 'kiosk'),
  // 유리 점포로 다시 지으면서 북벽(y30)까지 붙였다 — 예전엔 뒤에 0.9m 죽은 공간이 남았다.
  // 출입구는 각 점포 동쪽 끝 1.3m. 충돌은 점포 전체를 막는다(P0에 입장이 없다).
  solid('OBJ-18-CAFE', [27.0, 25.7, 32.0, 30.0], FLOOR.B1, 3.0, 'glass'),
  solid('OBJ-19-CVS', [21.5, 25.7, 26.5, 30.0], FLOOR.B1, 3.0, 'glass'),
  // OBJ-28 가림막 ㄱ자 (부록 A 그대로)
  solid('OBJ-28-N', [44, 6.6, 56, 7.0], FLOOR.B1, 2.4, 'wall'),
  solid('OBJ-28-W', [43.8, 0, 44.2, 7.0], FLOOR.B1, 2.4, 'wall'),
  // Z2 외벽
  parapet('Z2-S', [0, -0.4, 56, 0], FLOOR.B1, 4.0),
  parapet('Z2-N', [14.6, 30, 56, 30.4], FLOOR.B1, 4.0),
  parapet('Z2-NW-CAP', [0, 30, 2.0, 30.4], FLOOR.B1, 4.0),
  parapet('Z2-W', [-0.4, 0, 0, 30.4], FLOOR.B1, 4.0),
  // Z2 → Z3 진입선 x=56 · 개구부 y 9~29.7 (디렉터 지시로 확장 — 실측 좌표
  // (55.4, 18.5~29.7)에서 벽이 막고 있던 걸 걷어냈다)
  /**
   * ⚠ **원래부터 y30.4에서 멈춰 있었다 — Z3 쪽 방(y0~32) 폭보다 1.6m 짧다.**
   * 이 틈(x56·y30.4~32)은 예전 `Z3-N`(원본)이 정확히 그 위치에서 이 구멍을 가려서
   * 안 보였을 뿐, 충돌·시각 둘 다 원래 뚫려 있었다 — `Z3-N`을 반대 방면 연결부로
   * 대체하면서 노출됐다(실측: 연결부 근처에서 서쪽 위를 보면 Z1 지상 건물이 그대로
   * 비쳤다). y32까지 늘려 `Z3` 방의 실제 서쪽 경계와 맞춘다.
   */
  ...wallWithGaps('Z2-E', 'y', [55.8, 56.2], [0, 32], [[9, 29.7]], FLOOR.B1, 4.0, 'wall', PARAPET_H),

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
    [
      ...GATES.map((g) => [g.y - GATE_CLEARANCE(g), g.y + GATE_CLEARANCE(g)] as const),
      // P2 — 비상게이트 자리. **벽에 구멍을 뚫고 문은 동적 솔리드로 세운다**
      // (개찰기 플랩과 같은 규약: `systems/emergency.ts emergencyDoor`).
      // 정적 벽으로 두면 열 방법이 없다 — 정적 솔리드는 프레임마다 못 뺀다.
      [EMERGENCY_GATE.y - EMERGENCY_GATE.halfW, EMERGENCY_GATE.y + EMERGENCY_GATE.halfW] as const,
    ],
    FLOOR.B1, 1.15, 'gate',
  ),
  solid('OBJ-22-INTERCOM', at(58.2, 30, 0.5, 0.5), FLOOR.B1, 1.4, 'prop'),
  // Z3 외벽
  parapet('Z3-S', [56, -0.4, 72, 0], FLOOR.B1, 4.0),
  /**
   * Z3-N — 개찰구 서쪽(x56~61)만 막는다. 그 동쪽(x61~72)은 반대 방면
   * 통로로 가는 연결부라 막으면 안 된다(디렉터 지시). `tools/hq_walls.py`의
   * Z3wN 개구부도 같은 x61 경계를 쓴다 — 시각과 충돌이 같은 곳에서 갈린다.
   *
   * ⚠ **한때 x56~72 전체를 뺐었다.** Blender에서 `xx_Z3_wall_N`으로 벽을
   * 통째로 은퇴시켰는데, 그러면 개찰구 서쪽도 뚫려 아무나 게이트를 안 거치고
   * 옆으로 돌아 들어간다 — 실측(플레이)으로 걸렸다.
   *
   * ⚠ **`Z4-COR-S-OPP`(통로 남쪽 벽, x72~95.8·y41.6~42.0)의 서쪽 모서리가 x=72에서
   * 시작한다 — `CONN-E`류 벽을 세우든 없애든 그 모서리 자체는 그대로다.**
   * `CONN-E`를 세웠을 때도(모서리 두 개), 없앴을 때도(모서리 한 개) 실제 `tick()`으로
   * 대각선으로 걸어 재현하면 x=72 언저리에서 걸렸다 — `isWalkable`(바닥 유무)로는
   * 안 잡히고 `movementSystem`의 원형 충돌로만 드러났다. 원본(`Z4-COR-S`, x72~95.8·
   * y1.6~2.0)도 **같은 모서리 구조**지만 실전에서 안 걸리는 이유는 `Z3-E`의 좁은 틈
   * ([2,12], 폭 0.4m)이 x=72 를 넘기 **전에** 플레이어 y를 이미 그 대역 안으로
   * 강제하기 때문이다 — 틈 자체가 방향을 정렬해 준다. 그래서 여기도 `Z3-E-OPP`
   * (아래, `Z3-E`와 같은 자리·같은 폭)를 세워 같은 역할을 시킨다. 대신 연결부 바닥
   * (`Z3-CONN-OPP` 슬랩)과 서쪽 벽(`CONN-W`)도 반대 방면 통로 안쪽까지 넉넉히
   * 겹쳐서, x=72 를 넘기 전에 이미 통로의 걷는 폭(y42~52) 한가운데 들어와 있게
   * 만든다 — 그래야 `Z4-COR-S-OPP`(통로 남쪽 벽, y41.6~42.0) 근처를 스치지 않는다.
   * 실측: `tick()` 시뮬레이션으로 여러 진입 각도에서 걸어 전부 통과 확인.
   *
   * ⚠ **처음엔 y46까지만 겹쳤다가 또 뚫렸다.** 통로 안(x>72)은 y42~52 전 구간이
   * 유효한데, 연결부(x<72)는 y46에서 끝나 있었다 — 그래서 통로 안 y47~52 어디서든
   * 서서 서쪽(연결부 쪽)을 보면 그 시야가 연결부의 바닥·천장이 없는 구간을 그대로
   * 지나쳐 허공이 비쳤다(실측: x77.4·y46.7 에서 뒤돌아보면 새까만 사각형).
   * `isWalkable`도 실측 스크린샷도 이 결함을 못 잡는다 — **통로 반대쪽 끝에서
   * 되돌아보는 것**까지 확인해야 한다. 통로와 정확히 같은 폭(y32~52.4, `Z4-COR-N-OPP`
   * 북쪽 벽 두께까지)으로 맞춘다.
   *
   * ⚠ **`opp-connector.test.ts`가 x56~61에서도 연결부에 닿아야 한다고 가정한
   * 채로 남아 있었다** — Z3-N이 통째로 뚫려 있던 시절 쓴 테스트라, 지금처럼
   * 서쪽에 벽이 서면 직선 추적 워커가 벽 모서리(x61,y32)에 걸려 멈춘다.
   * 이 파일 헤더가 이미 세 번 겪은 "모서리에 걸린다" 결함과 겉보기엔 같지만
   * 원인이 다르다 — 이번엔 벽이 실제로 거기 있어야 맞다. 테스트의 출발 x를
   * x61 동쪽(연결부 쪽)으로 옮겼다.
   */
  parapet('Z3-N', [56, 32, 61.0, 32.4], FLOOR.B1, 4.0),
  parapet('CONN-W', [55.8, 32, 56.2, 52.4], FLOOR.B1, 4.0),
  ...wallWithGaps('Z3-E-OPP', 'y', [71.8, 72.2], [32, 52.4], [[42, 52]], FLOOR.B1, 4.0, 'wall', PARAPET_H),
  /**
   * 연결부 북쪽 마감 — `Z4-COR-N-OPP`(통로 북쪽 벽, y52.0~52.4)와 같은 y 대역으로
   * 맞춰서 x56~95.8 전체가 한 벽처럼 이어지게 한다. x=72 까지만 막는다 — 그 너머는
   * 통로 안쪽이라 여기서 막으면 통로 왕래를 가로막는다.
   */
  parapet('CONN-N-CAP', [56, 52, 72, 52.4], FLOOR.B1, 4.0),
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
  // 승강장 남측 외벽. 개구부 없음.
  //
  // 예전엔 x119~128 이 뚫려 있었고 주석은 "Z4 착지 개구부"라고 적혀 있었는데,
  // 착지는 y1~9.5 에서 일어나고 이 벽은 y −0.4~0 이다. 서로 만나지 않는다.
  // 시각(`Z5_wall_S`)은 처음부터 통짜여서 **벽이 보이는데 걸어 나갈 수 있었다.**
  parapet('Z5-S', [78, -0.4, 206, 0], FLOOR.B2, 5.0),
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
  /**
   * 객실 벽 — 바닥(`Z5-CABIN`)을 깔았으니 **테두리도 같이 깔아야 한다.**
   * 안 그러면 문으로 들어간 플레이어가 반대쪽 차체를 통과해 선로 위 허공으로 걸어 나간다
   * (바닥만 미러하고 벽을 빼먹은 반대 방면 통로 사고의 정확한 반대 경우다).
   * 근측 기둥벽은 안 세운다 — 탑승 판정이 들어서는 즉시 걸리므로 의미가 없고,
   * 세우면 문 32개소마다 개구를 뚫어야 해서 충돌체만 40개 늘어난다.
   */
  parapet('Z5-CABIN-N', [PLATFORM.xMin, CABIN_Y1, PLATFORM.xMax, CABIN_Y1 + 0.12], FLOOR.B2, 2.4),
  parapet('Z5-CABIN-W', [PLATFORM.xMin - 0.12, CABIN_Y0, PLATFORM.xMin, CABIN_Y1], FLOOR.B2, 2.4),
  parapet('Z5-CABIN-E', [PLATFORM.xMax, CABIN_Y0, PLATFORM.xMax + 0.12, CABIN_Y1], FLOOR.B2, 2.4),

  // ═══════════ 반대 방면(디렉터 지시) — 전부 원본 + Y_OFFSET_OPP ═══════════
  // ───────────── Z4-OPP (B1 → B2) ─────────────
  parapet('Z4-COR-S-OPP', [72, 1.6 + Y_OFFSET_OPP, 95.8, 2.0 + Y_OFFSET_OPP], FLOOR.B1, 4.0),
  parapet('Z4-COR-N-OPP', [72, 12.0 + Y_OFFSET_OPP, 95.8, 12.4 + Y_OFFSET_OPP], FLOOR.B1, 4.0),
  parapet('Z4-DESC-S-OPP', [95.8, 0.95 + Y_OFFSET_OPP, 120.4, 1.35 + Y_OFFSET_OPP], FLOOR.B2, 15.0),
  {
    id: 'Z4-DIVIDER-OPP', rect: [95.8, 3.05 + Y_OFFSET_OPP, 120.4, 4.2 + Y_OFFSET_OPP],
    z0: FLOOR.B2, h: 15.0, look: 'wall', renderH: 0.9,
  },
  parapet('Z4-DESC-N-OPP', [95.8, 9.2 + Y_OFFSET_OPP, 120.4, 9.6 + Y_OFFSET_OPP], FLOOR.B2, 15.0),
  solid('OBJ-26-ELEV-OPP', [96.0, 9.6 + Y_OFFSET_OPP, 98.4, 12.0 + Y_OFFSET_OPP], FLOOR.B1, 3.2, 'glass'),
  parapet('Z4-COR-CAP-OPP', [95.8, 9.6 + Y_OFFSET_OPP, 96.2, 12.0 + Y_OFFSET_OPP], FLOOR.B1, 4.0),

  // ───────────── Z5-OPP (B2) ─────────────
  parapet('Z5-END-W-OPP', [77.6, Y_OFFSET_OPP, 78.0, 12 + Y_OFFSET_OPP], FLOOR.B2, 5.0),
  parapet('Z5-END-E-OPP', [206, Y_OFFSET_OPP, 206.4, 12 + Y_OFFSET_OPP], FLOOR.B2, 5.0),
  parapet('Z5-S-OPP', [78, -0.4 + Y_OFFSET_OPP, 206, Y_OFFSET_OPP], FLOOR.B2, 5.0),
  ...Z5_COLUMN_XS.map((x) =>
    solid(`Z5-COL-OPP-${x}`, at(x, Z5_COLUMN_Y + Y_OFFSET_OPP, 1.1, 1.1), FLOOR.B2, 4.5, 'column')),
  ...wallWithGaps(
    'PSD-OPP', 'x', [PSD_Y_OPP - PSD_HALF_THICK, PSD_Y_OPP + PSD_HALF_THICK],
    [PLATFORM_OPP.xMin, PLATFORM_OPP.xMax],
    DOOR_XS_OPP.map((x) => [x - 0.8, x + 0.8] as const),
    FLOOR.B2, 2.0, 'psd',
  ),
  parapet('Z5-CABIN-N-OPP',
    [PLATFORM.xMin, CABIN_Y1 + Y_OFFSET_OPP, PLATFORM.xMax, CABIN_Y1 + 0.12 + Y_OFFSET_OPP],
    FLOOR.B2, 2.4),
  parapet('Z5-CABIN-W-OPP',
    [PLATFORM.xMin - 0.12, CABIN_Y0 + Y_OFFSET_OPP, PLATFORM.xMin, CABIN_Y1 + Y_OFFSET_OPP],
    FLOOR.B2, 2.4),
  parapet('Z5-CABIN-E-OPP',
    [PLATFORM.xMax, CABIN_Y0 + Y_OFFSET_OPP, PLATFORM.xMax + 0.12, CABIN_Y1 + Y_OFFSET_OPP],
    FLOOR.B2, 2.4),
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
