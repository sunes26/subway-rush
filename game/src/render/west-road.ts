/**
 * 인트로 전용 **서쪽 도로 연장** — 버스가 실제로 달릴 거리를 만든다.
 *
 * ■ 왜 필요한가
 *
 * Z1 의 지면은 x −64 에서 끝난다(`Z1-ROAD`·`Z1-WALK`). 그래서 버스가 정류장에
 * 붙는 연출을 1.2m 밖에 못 줬고, 창밖이 거의 안 흘러서 "달리는 버스"가 아니라
 * "서 있는 버스"로 보였다 — 흔들림과 제동 쏠림만으로 버티고 있었다.
 *
 * 여기서 x −96 까지 32m 를 이어 붙인다. 버스는 24m 를 달려 들어오고, 창밖으로
 * 가로등·가로수·건물이 **실제로 지나간다.** 속도감을 만드는 것은 결국 이것이다.
 *
 * ■ 왜 게임 월드에 안 넣고 인트로 전용인가
 *
 * `data/world.ts` 에 슬래브를 더해도 **화면에는 안 나온다** — 절차 생성 월드는
 * `world.root.visible = false` 라 충돌·레이캐스트 프록시로만 쓰이고, 보이는 것은
 * 전부 station GLB 다. 그렇다고 GLB 를 다시 뽑는 것은 이 작업의 범위가 아니다.
 *
 * 그래서 인트로 동안만 씬에 붙였다 뗀다. 플레이 중에는 존재하지 않으므로
 * 맵 경계·미니맵·충돌 어디에도 영향이 없다.
 *
 * ■ 무엇을 만드나 — **창밖으로 지나가는 것**만
 *
 * 카메라는 버스 안에서 북쪽 창만 본다. 그래서 남쪽 차도 건너편은 안 만든다.
 * 대신 창에 가까이 스쳐 지나가는 것(가로등·가로수·연석)에 힘을 준다 —
 * 멀리 있는 건물은 천천히 움직여서 속도가 안 읽히고, 가까운 것이 빨리 지나가야
 * 속도가 된다.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three'
import { PALETTE } from '../data/tuning'
import { toonMat } from './toon'

/** 이어 붙이는 구간. 동쪽 끝은 기존 지면(x −64)에 딱 맞춘다 */
export const WEST = { xMin: -96, xMax: -64 } as const

const C = {
  road: PALETTE.asphalt,
  walk: PALETTE.sidewalk,
  curb: PALETTE.concreteDark,
  shop: PALETTE.concrete,
  /** 건물 — 기존 Z1 상가와 같은 계열에서 명도만 흔든다 */
  bldA: 0xd2cec4,
  bldB: 0xc4bfb4,
  bldC: 0xdbd8d0,
  pole: 0x8d9298,
  leaf: 0x6f8c5a,
  trunk: 0x6b5b4a,
} as const

const box = (
  w: number, h: number, d: number, color: number, x: number, y: number, z: number,
): Mesh => {
  const m = new Mesh(new BoxGeometry(w, h, d), toonMat(color))
  m.position.set(x, y, z)
  return m
}

/** 월드 y → three z */
const tz = (worldY: number): number => -worldY

/** 가로등 — 연석 바로 안쪽. 창에 제일 가까이 스쳐 지나가는 물건이다 */
const lamp = (x: number): Group => {
  const g = new Group()
  const pole = new Mesh(new CylinderGeometry(0.07, 0.09, 5.2, 8), toonMat(C.pole))
  pole.position.set(x, 2.6, tz(22.8))
  g.add(pole)
  g.add(box(1.5, 0.10, 0.16, C.pole, x - 0.7, 5.1, tz(22.4)))
  return g
}

/**
 * 가로수 — 두 덩어리면 충분하다.
 *
 * ⚠ 처음엔 연석에서 1.6m(y 23.6)에 심고 수관을 1.9m 로 키웠다. 창에서 2m 라
 *   **초록 덩어리가 창을 통째로 막았고** 창밖 풍경이 하나도 안 보였다.
 *   가까이 있는 것이 빨리 지나가긴 하지만, 시야를 다 먹으면 속도가 아니라
 *   가림막이 된다. 인도 안쪽으로 물리고 수관을 줄인다.
 */
const tree = (x: number): Group => {
  const g = new Group()
  const t = new Mesh(new CylinderGeometry(0.10, 0.14, 2.6, 6), toonMat(C.trunk))
  t.position.set(x, 1.3, tz(25.6))
  g.add(t)
  g.add(box(1.5, 1.1, 1.5, C.leaf, x, 3.05, tz(25.6)))
  g.add(box(1.1, 0.8, 1.1, C.leaf, x + 0.22, 3.7, tz(25.4)))
  return g
}

export const buildWestRoad = (): { root: Group; dispose(): void } => {
  const root = new Group()
  root.name = 'intro-west-road'

  const len = WEST.xMax - WEST.xMin
  const midX = (WEST.xMin + WEST.xMax) / 2

  // 차도 · 인도 — 기존 y 구획(차도 16~22 · 인도 22~34)을 그대로 잇는다
  root.add(box(len, 0.06, 6.0, C.road, midX, -0.03, tz(19.0)))
  root.add(box(len, 0.06, 12.0, C.walk, midX, -0.03, tz(28.0)))
  // 연석 — 차도와 인도를 가르는 선. 이게 없으면 두 판이 한 판으로 보인다
  root.add(box(len, 0.14, 0.30, C.curb, midX, 0.07, tz(22.0)))
  // 중앙선
  root.add(box(len, 0.01, 0.16, 0xd8c860, midX, 0.005, tz(18.2)))
  /**
   * 연석 난간 — 창 바로 아래를 **가장 빠르게** 지나간다. 시야를 안 막으면서
   * 속도만 만드는 물건이라 이 연출에서 가장 값싼 한 줄이다.
   */
  for (let rx = WEST.xMin + 1; rx < WEST.xMax - 0.5; rx += 2.4) {
    root.add(box(0.09, 0.75, 0.09, C.pole, rx, 0.52, tz(22.35)))
  }
  root.add(box(len - 2, 0.07, 0.07, C.pole, midX, 0.86, tz(22.35)))

  // 상가 벽 — 기존 `Z1-SHOPS`(y 34.0~34.4, h4.5)와 같은 자리·같은 높이
  root.add(box(len, 4.5, 0.4, C.shop, midX, 2.25, tz(34.2)))

  /**
   * 건물 — 폭·높이·색을 흔들어 **경계가 규칙적으로 지나가게** 한다.
   * 한 덩어리로 길게 두면 아무리 달려도 배경이 안 움직인다.
   */
  const cols = [C.bldA, C.bldB, C.bldC]
  let x = WEST.xMin + 3
  let i = 0
  while (x < WEST.xMax - 2) {
    const w = 5.5 + ((i * 7) % 5)
    const h = 9 + ((i * 5) % 8)
    root.add(box(w - 0.6, h, 8.5, cols[i % 3]!, x + w / 2, h / 2, tz(38.5)))
    x += w
    i++
  }

  // 가로등·가로수 — 6m 간격으로 번갈아. 창에 가까워 가장 빠르게 흐른다
  for (let lx = WEST.xMin + 4; lx < WEST.xMax - 1; lx += 6) {
    root.add(lamp(lx))
    root.add(tree(lx + 3))
  }

  return {
    root,
    dispose() {
      root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      root.clear()
    },
  }
}
