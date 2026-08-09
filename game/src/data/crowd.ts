/**
 * 에스컬레이터 승객(장식) 좌표 — **판정과 렌더가 공유한다.**
 *
 * 처음엔 렌더(`render/actors.ts`)에만 있었다. 인파벽 3인(`CP_IDS`)만 우산에 맞아 날아가고
 * 장식 승객은 안 날아간다는 지적(디렉터, 2026-08-07)을 받고서야 "장식 = 판정 없음"이
 * 그림과 규칙을 갈랐다는 게 드러났다 — 우산은 눈에 보이는 모두를 쳐야 맞는 도구다.
 *
 * ★ x·y 만 둔다. z(경사면 고도)는 `systems/collision.ts rampZ` 로 매 소비처가 직접 계산한다 —
 *   여기(데이터 계층)가 `systems/`에 의존하면 계층이 거꾸로 된다.
 */

import { clamp } from '../core/math'
import { DISEMBARK } from './tuning'
import { DOOR_XS, FLOOR, GATES, Y_OFFSET_OPP } from './world'

export type RiderSpot = Readonly<{ id: string; x: number; y: number }>

const LANES = [1.75, 2.95] as const   // 통로 폭 1.35~3.05 를 두 줄로 나눠 채운다
const ROW_START = 101.0               // 인파벽 마지막 사람(x 99.0) 뒤 — 1.2m 이상 띄운다
const ROW_SPACING = 2.0
/** 5행 × 2줄 = 10명. 개수 근거는 `render/actors.ts` RIDER_ROWS 주석(삼각형 예산) 참고 */
const ROWS = 5

export const RIDER_SPOTS: readonly RiderSpot[] = Array.from(
  { length: ROWS },
  (_, row): readonly RiderSpot[] =>
    LANES.map((y, lane) => ({ id: `ESC-R${row}-${lane}`, x: ROW_START + row * ROW_SPACING, y })),
).flat()

/**
 * 하차 인파 40명(디렉터 지시) — 승강장 문 → 계단 → 대합실 유도선 → 개찰구 → 퇴장.
 *
 * 좀비폰족·아주머니와 같은 수법으로 **시간의 순수 함수**다: `elapsedSinceOpenSec` 와
 * NPC 순번만으로 매 순간의 자리가 정해진다(`systems/train.ts trainClock` 이 문 열림
 * 시각을 잰다). `workingGateIds` 만 예외로 받는다 — 닫힌 게이트 앞으로 걸어가면
 * 눈에 뻔히 막힌 문을 향해 걷는 것처럼 보이기 때문이다.
 *
 * ★ 데이터 계층이라 `systems/`·`GameState` 를 모른다. 게이트 목록은 호출부
 *   (`systems/disembark.ts`)가 `s.gates.workingIds` 에서 뽑아 넘긴다.
 */

/**
 * 계단 하단 착지대(x 119~128)에 가장 가까운 문 4곳만 쓴다 — 10초 예산(위 `DISEMBARK.speedMps`
 * 주석 참고) 안에 계단 상단까지 닿으려면 승강장을 오래 걸어선 안 된다.
 */
const NEAR_STAIR_DOORS = DOOR_XS.filter((x) => x >= 112 && x <= 124)

/** 계단 폭(4.2~9.2)을 4갈래로 나눠 겹치지 않게 한다 */
const STAIR_LANES = [5.2, 6.2, 7.2, 8.2] as const

const gateYOf = (gateId: number): number =>
  GATES.find((g) => g.id === gateId)?.y ?? 14

/**
 * x=48 부근 기둥 두 개(y 9.5~10.5 · 19.5~20.5, `world.ts OBJ-COL-48-*`)를 비켜 간다.
 * 게이트2(y10)·게이트7(y20)은 그 기둥 중심과 정확히 겹쳐서, 문턱 통과 y를 그대로 쓰면
 * x47~48.5 구간 내내 기둥 안에 있는 채로 걷는다 — 14(둘 사이 안전지대)로 잠깐 피한다.
 */
const dodgeColumn = (y: number): number => (y > 9 && y < 11) || (y > 19 && y < 21) ? 14 : y

type Waypoint = Readonly<{ x: number; y: number; z: number }>

/**
 * 순번 하나의 전체 경로 — 문·레인·게이트만 순번에 따라 바뀐다.
 *
 * ★ **직선 8점이던 원래 경로는 벽을 그대로 뚫고 지나갔다.** Z4 통로(x72~95.8)는
 *   남·북 벽(`Z4-COR-S/N`, y 2.0~12.0 안쪽만 비었다)에 갇혀 있고, Z3→Z2 사이의
 *   `Z2-E` 문턱(x56)은 y 9~19 구간에만 문이 뚫려 있다 — 그런데 게이트는 y 8~24에
 *   흩어져 있어서 대부분(1·7·8·9번)은 그 문턱 밖에 있다. 좌표는 실측(월드 솔리드 표,
 *   `world.ts` 의 Z4-COR-*·Z2-E 항목)에서 그대로 가져왔다. 게이트 본체(x60.3~61.7)
 *   자체는 안 막는다 — 계단까지 오려면 이미 개찰구를 한 번 지났어야 하므로
 *   `s.gates.passed`가 항상 참이고, 그러면 게이트 플랩은 전부 사라진다
 *   (`systems/gates.ts gateFlaps`).
 */
const pathFor = (index: number, workingGateIds: readonly number[]): readonly Waypoint[] => {
  const doorX = NEAR_STAIR_DOORS[index % NEAR_STAIR_DOORS.length] ?? 108
  const lane = STAIR_LANES[index % STAIR_LANES.length] as number
  const gateId = workingGateIds.length > 0
    ? (workingGateIds[index % workingGateIds.length] as number)
    : 5
  const gateY = gateYOf(gateId)
  // Z2-E 문턱(x56)은 y 9~19에만 뚫려 있다 — 게이트가 그 밖(1·7·8·9번)이면 문턱 앞뒤로만 이 y로 모인다
  const doorwayY = clamp(gateY, 9, 19)
  return [
    { x: doorX, y: 11.0, z: FLOOR.B2 },          // 문 앞
    { x: 122.0, y: lane, z: FLOOR.B2 },          // 계단 하단 착지대로 대각선 직행
    { x: 119.8, y: lane, z: FLOOR.B2 },          // 계단 진입
    { x: 95.9, y: lane, z: FLOOR.B1 },           // 계단 상단(램프를 그대로 직선 보간)
    { x: 72.2, y: lane, z: FLOOR.B1 },           // Z4 통로 — 레인 y를 그대로 끝까지 유지(남·북 벽 회피)
    { x: 65.0, y: gateY, z: FLOOR.B1 },          // 넓어진 Z3 홀에서 실제 게이트 높이로 갈아탄다
    { x: 61.0, y: gateY, z: FLOOR.B1 },          // 게이트 본체 통과(플랩은 이미 사라져 있다)
    { x: 58.0, y: doorwayY, z: FLOOR.B1 },       // Z2-E 문턱 앞 — 안전 구간으로 모은다
    { x: 47.0, y: dodgeColumn(doorwayY), z: FLOOR.B1 }, // Z2-E 통과 + 기둥 구간을 안전 y로 지난다
    { x: 45.5, y: gateY, z: FLOOR.B1 },          // 기둥을 벗어난 뒤에야 실제 높이로 복귀해 퇴장
  ]
}

/** 순번 하나의 열차 출발 지연(초) — 문이 열린 뒤 스태거드 하차 */
export const disembarkDelaySec = (index: number, count: number, spreadMs: number): number =>
  (index / Math.max(1, count)) * (spreadMs / 1000)

/** 경로 위 한 점 + 진행 방향. `dist` 가 전체 길이를 넘으면 마지막 점에서 멈추지 않고 null(소멸) */
const walkPolyline = (
  wps: readonly Waypoint[], dist: number,
): Readonly<{ x: number; y: number; z: number; facing: number }> | null => {
  if (dist < 0) return null
  let remain = dist
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i] as Waypoint
    const b = wps[i + 1] as Waypoint
    const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    if (remain > segLen) { remain -= segLen; continue }
    const t = segLen < 1e-6 ? 0 : remain / segLen
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      facing: Math.atan2(b.y - a.y, b.x - a.x),
    }
  }
  return null   // 경로를 다 걸었다 — 개찰구 밖으로 사라졌다
}

/**
 * 순번 `index` 의 승객이 문이 열린 시각으로부터 `elapsedSinceOpenSec` 뒤 있는 자리.
 * 아직 스태거 대기 중이면 null. 그 뒤로는 경로를 한 번만 걷고, 개찰구 밖으로 나가면
 * (`walkPolyline` 이 null을 돌려주면) 그대로 소멸한 채 다시 나타나지 않는다.
 */
export const disembarkAt = (
  index: number, elapsedSinceOpenSec: number, workingGateIds: readonly number[],
): Readonly<{ x: number; y: number; z: number; facing: number }> | null => {
  const delay = disembarkDelaySec(index, DISEMBARK.count, DISEMBARK.spawnSpreadMs)
  if (elapsedSinceOpenSec < delay) return null
  const sinceFirstWave = elapsedSinceOpenSec - delay
  const walked = sinceFirstWave * DISEMBARK.speedMps
  return walkPolyline(pathFor(index, workingGateIds), walked)
}

// ═══════════════ 반대 방면 하차 인파(디렉터 지시) ═══════════════

/**
 * 반대 방면 경로 — 계단2(레인 +40) → 연결 통로(y40~32) → 게이트9(유일한 입구, x61·y24) →
 * 개찰구 안쪽으로 흩어져 소멸. 원본과 달리 **게이트가 하나뿐**이라(연결 통로가 그
 * 자리에만 뚫려 있다) 게이트 선택 로직이 없다 — Z2-E 문턱까지 안 간다(그쪽은 원본
 * 통로 담당). 문 앞(y41)만 원본(y11)에서 `Y_OFFSET_OPP` 를 더했고, 나머지는 실측
 * 좌표를 그대로 손으로 짰다.
 */
const GATE9_Y = gateYOf(9)

const pathForOpp = (index: number): readonly Waypoint[] => {
  const doorX = NEAR_STAIR_DOORS[index % NEAR_STAIR_DOORS.length] ?? 108
  const lane = (STAIR_LANES[index % STAIR_LANES.length] as number) + Y_OFFSET_OPP
  return [
    { x: doorX, y: 11.0 + Y_OFFSET_OPP, z: FLOOR.B2 },  // 문 앞
    { x: 122.0, y: lane, z: FLOOR.B2 },                 // 계단 하단 착지대
    { x: 119.8, y: lane, z: FLOOR.B2 },                 // 계단 진입
    { x: 95.9, y: lane, z: FLOOR.B1 },                  // 계단 상단
    { x: 72.2, y: lane, z: FLOOR.B1 },                  // Z4-OPP 통로 끝까지 레인 유지
    { x: 66.0, y: 36.0, z: FLOOR.B1 },                  // 연결 통로 진입(x56~72·y32~40 안)
    { x: 63.0, y: GATE9_Y, z: FLOOR.B1 },                // 게이트9 높이로 갈아탄다
    { x: 55.0, y: GATE9_Y - 4, z: FLOOR.B1 },           // 게이트9 통과 후 개찰구 안쪽으로 흩어지며 퇴장
  ]
}

/** `disembarkAt` 과 같은 식(스태거, 한 번만 걷고 소멸), 경로만 `pathForOpp`. 게이트 목록이 필요 없다 */
export const disembarkAtOpp = (
  index: number, elapsedSinceOpenSec: number,
): Readonly<{ x: number; y: number; z: number; facing: number }> | null => {
  const delay = disembarkDelaySec(index, DISEMBARK.count, DISEMBARK.spawnSpreadMs)
  if (elapsedSinceOpenSec < delay) return null
  const sinceFirstWave = elapsedSinceOpenSec - delay
  const walked = sinceFirstWave * DISEMBARK.speedMps
  return walkPolyline(pathForOpp(index), walked)
}
