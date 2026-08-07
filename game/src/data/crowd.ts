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
