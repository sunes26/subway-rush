/**
 * 차도 위험 판정 — 달리는 차와 플레이어가 닿았는가.
 *
 * 신호를 무시하고 건널 수 있게 되면서 차가 **장식이 아니라 위험**이 됐다.
 * 판정 자체는 three 를 모른다. `cars.ts` 가 차체 상자를 월드 좌표로 넘기고
 * 여기서는 순수 계산만 한다 — 그래야 단위 테스트로 덮을 수 있다.
 *
 * 차선은 전부 축에 나란하다(이면도로는 남북, 주 차도는 동서). 그래서 회전 상자가
 * 아니라 **AABB 대 원**으로 충분하다. 회전 상자를 쓰면 코드만 늘고 결과는 같다.
 */

/** 차체 하나 — 월드 좌표의 축정렬 상자. `hx`·`hy` 는 반폭이다. */
export type CarBox = Readonly<{ x: number; y: number; hx: number; hy: number }>

/** 상자와 원이 겹치는가. 상자 안쪽으로 클램프한 최근접점까지의 거리로 본다. */
export const boxHitsCircle = (b: CarBox, px: number, py: number, r: number): boolean => {
  const dx = Math.max(Math.abs(px - b.x) - b.hx, 0)
  const dy = Math.max(Math.abs(py - b.y) - b.hy, 0)
  return dx * dx + dy * dy < r * r
}

/** 한 대라도 닿으면 true. */
export const carHits = (
  boxes: readonly CarBox[], px: number, py: number, r: number,
): boolean => boxes.some((b) => boxHitsCircle(b, px, py, r))
