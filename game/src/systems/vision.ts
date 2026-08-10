/**
 * NPC 시야 판정 — **각도 + 거리**, 레이캐스트 없음.
 *
 * 역무원(`staff.ts`)이 쓰던 식을 아주머니·학생(`obstacles.ts` OBS-07)도 같이 쓰게
 * 꺼낸 것이다(디렉터 지시 2026-08-10 — "똑같은 원리로"). 두 곳이 각자 삼각함수를
 * 적어 두면 한쪽만 고쳐지고, 그 차이는 화면에서 **같아 보이는데 다르게 걸리는** 버그가 된다.
 *
 * 규약 둘:
 *  · 판정은 2D 다. 눈높이는 안 본다 — 층 검사는 부르는 쪽 몫이다.
 *  · `facing` 은 전방축(rad, +x 기준)이다. 렌더가 쓰는 값과 같은 정의여야 한다.
 */

export type Facing2D = Readonly<{ x: number; y: number; facing: number }>

/**
 * NPC 가 (px, py) 를 **마주보고 있는가** — 반경 `rangeM` 안 + 전방 반각 `halfAngleRad` 안.
 * 겹쳐 선 경우(거리 ~0)는 각도를 못 재므로 마주본 것으로 본다.
 */
export const facesPoint = (
  pose: Facing2D,
  px: number,
  py: number,
  rangeM: number,
  halfAngleRad: number,
): boolean => {
  const dx = px - pose.x
  const dy = py - pose.y
  const d = Math.hypot(dx, dy)
  if (d > rangeM) return false
  if (d < 1e-4) return true
  const cos = (dx * Math.cos(pose.facing) + dy * Math.sin(pose.facing)) / d
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= halfAngleRad
}
