/**
 * 인트로 전용 버스 실내.
 *
 * ■ 왜 코드로 짓나
 *
 * 이 리포는 이미 지오메트리를 코드로 만드는 길을 갖고 있다 — `world-builder.ts` 의
 * 그레이박스, `guide-arrows.ts` 의 유도 화살표, `cars.ts` 의 차량 병합이 전부 그렇다.
 * 버스 실내는 상자와 원기둥 몇 개면 끝나는 물건이라 Blender 를 한 바퀴 돌 이유가 없고,
 * **툰 재질(`toonMat`)을 그대로 쓰면 씬의 평면 셰이딩에 저절로 맞는다.**
 *
 * ■ 무엇을 만들고 무엇을 안 만드나
 *
 * 카메라는 인트로 6.6초 중 3.2초만 이 안에 있고, 그동안 **한쪽(북측 창)만** 본다.
 * 그래서 남측 벽·앞유리·운전석은 안 만든다 — 화면에 한 프레임도 안 들어온다.
 * 대신 화면에 실제로 들어오는 것(바닥·천장·북측 창틀·좌석 두 줄·수직봉·손잡이·뒷문)에
 * 폴리곤을 쓴다. 다 만들고 안 보여 주는 것보다, 보이는 것을 제대로 만드는 쪽이 싸고 낫다.
 *
 * ■ 좌표
 *
 * 월드(x 동 · y 북 · z 상) ↔ three(x, z, −y). 다른 렌더 모듈과 같은 규약이다.
 * 치수는 `OBJ-01-BUS` 의 충돌 상자에서 그대로 가져온다 — 실내가 외피보다 크면
 * 창밖으로 벽이 삐져나온다.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, TorusGeometry } from 'three'
import { toonMat } from './toon'

/** `OBJ-01-BUS` 와 같은 값. 여기가 어긋나면 실내가 외피를 뚫는다 */
export const BUS = {
  xMin: -65.3, xMax: -54.4,
  yMin: 19.1, yMax: 21.7,
  /** 바닥 높이 — 연석에서 한 단 올라선다 */
  floor: 0.9,
  /**
   * 실내 천장고.
   *
   * ⚠ 외피가 h3.2 다. 처음에 3.0 을 넣었더니 바닥(0.9) + 3.0 = 3.9 로 **지붕을
   *   뚫고 나갔고**, 실측 스크린샷에서 천장 너머로 하늘과 건물이 보였다.
   *   0.9 + 2.2 = 3.1 이라 외피 안에 정확히 들어간다.
   */
  ceil: 2.2,
} as const

const C = {
  floor: 0x4a4d54,
  wall: 0x9fb3a8,      // 서울 시내버스 실내 — 옅은 청록
  ceiling: 0xd6dcd8,
  seat: 0xd8752f,      // 주황 좌석
  seatBack: 0xb85f22,
  pole: 0xd8b830,      // 노란 손잡이봉
  frame: 0x3d4148,
} as const

const box = (
  w: number, h: number, d: number, color: number,
  x: number, y: number, z: number,
): Mesh => {
  const m = new Mesh(new BoxGeometry(w, h, d), toonMat(color))
  m.position.set(x, y, z)
  return m
}

/** 월드 y → three z. 부호를 한 곳에서만 뒤집는다 */
const tz = (worldY: number): number => -worldY

/**
 * 좌석 한 벌 — 좌판 + 등받이.
 * 등받이를 창 쪽으로 세운다(2인석이 창을 등지지 않고 앞을 본다).
 */
const seatPair = (x: number, worldY: number): Group => {
  const g = new Group()
  const h = BUS.floor
  g.add(box(0.92, 0.1, 0.9, C.seat, x, h + 0.42, tz(worldY)))
  g.add(box(0.92, 0.62, 0.12, C.seatBack, x, h + 0.73, tz(worldY) + 0.39))
  // 다리 — 좌판이 떠 있으면 가볍게 보인다
  g.add(box(0.08, 0.42, 0.08, C.frame, x - 0.36, h + 0.21, tz(worldY)))
  g.add(box(0.08, 0.42, 0.08, C.frame, x + 0.36, h + 0.21, tz(worldY)))
  return g
}

/** 손잡이 — 천장 레일에서 내려온 줄 + 고리 */
const strap = (x: number, worldY: number, drop: number): Group => {
  const g = new Group()
  const top = BUS.floor + BUS.ceil - 0.18
  g.add(box(0.03, drop, 0.03, C.frame, x, top - drop / 2, tz(worldY)))
  const ring = new Mesh(new TorusGeometry(0.075, 0.018, 6, 12), toonMat(C.pole))
  ring.position.set(x, top - drop - 0.07, tz(worldY))
  g.add(ring)
  return g
}

export type BusInterior = Readonly<{
  root: Group
  /** 뒷문을 연다 (0 닫힘 ~ 1 열림) */
  setDoor(open: number): void
  dispose(): void
}>

/**
 * 뒷문의 x — 인트로의 `DOOR` 와 같은 자리여야 한다.
 * 여기만 따로 정하면 캐릭터가 벽으로 걸어 나간다.
 */
export const DOOR_X = -61.0

export const buildBusInterior = (): BusInterior => {
  const root = new Group()
  root.name = 'intro-bus'

  const midX = (BUS.xMin + BUS.xMax) / 2
  const len = BUS.xMax - BUS.xMin
  const wid = BUS.yMax - BUS.yMin
  const f = BUS.floor

  // 바닥 · 천장
  root.add(box(len, 0.08, wid, C.floor, midX, f - 0.04, tz((BUS.yMin + BUS.yMax) / 2)))
  root.add(box(len, 0.1, wid, C.ceiling, midX, f + BUS.ceil, tz((BUS.yMin + BUS.yMax) / 2)))

  /**
   * 북측 벽 — 허리 판 · 창 · 상인방 **세 켜**로 쌓는다.
   *
   * 처음엔 허리 판과 얇은 몰딩만 두고 그 위를 비웠다. 그랬더니 몰딩 위부터
   * 천장까지 0.74m 가 통째로 뚫려서, 실측 스크린샷에서 **버스 안인데 하늘이**
   * 보였다. 창은 구멍이지 벽의 부재가 아니다 — 위아래가 다 막혀야 창이 된다.
   */
  const SILL_TOP = 1.75          // 허리 판 위 끝
  const HEAD_BOT = 2.75          // 상인방 아래 끝
  const yWall = tz(BUS.yMax) + 0.04
  root.add(box(len, SILL_TOP - f, 0.08, C.wall, midX, (f + SILL_TOP) / 2, yWall))
  root.add(box(len, f + BUS.ceil - HEAD_BOT, 0.08, C.wall, midX,
    (HEAD_BOT + f + BUS.ceil) / 2, yWall))

  /**
   * 창틀 세로살. 이게 있어야 버스가 지날 때 **창밖이 끊겨 흐르고**, 그 끊김이
   * 속도를 만든다. 통유리 한 장이면 아무리 움직여도 정지 화면처럼 보인다.
   */
  for (let i = 0; i <= 5; i++) {
    const x = BUS.xMin + 0.4 + (len - 0.8) * (i / 5)
    root.add(box(0.09, HEAD_BOT - SILL_TOP, 0.1, C.frame, x,
      (SILL_TOP + HEAD_BOT) / 2, yWall))
  }

  // 남측 벽 — 카메라가 등지고 있지만 뒤를 돌 때 빈 공간이 보이면 안 된다
  root.add(box(len, BUS.ceil, 0.08, C.wall, midX, f + BUS.ceil / 2, tz(BUS.yMin) - 0.04))
  /**
   * 앞·뒤 격벽 — **뒤(서쪽)를 빼먹으면 안 된다.**
   *
   * 3인칭 카메라는 주인공을 남서쪽에서 올려다보므로 시선이 버스 **뒤쪽**을 향한다.
   * 서쪽 격벽이 없으면 그 방향이 통째로 열려서, 버스 안인데 지도 밖 허공이
   * 화면 절반을 차지한다(Z1 지면은 x −64 에서 끝난다).
   */
  root.add(box(0.08, BUS.ceil, wid, C.wall, BUS.xMax - 0.04, f + BUS.ceil / 2,
    tz((BUS.yMin + BUS.yMax) / 2)))
  root.add(box(0.08, BUS.ceil, wid, C.wall, BUS.xMin + 0.04, f + BUS.ceil / 2,
    tz((BUS.yMin + BUS.yMax) / 2)))

  // 좌석 — 남측 한 줄(창을 등지지 않는 쪽). 뒷문 앞은 비운다
  for (const x of [-64.4, -63.3, -57.6, -56.5]) {
    root.add(seatPair(x, BUS.yMin + 0.75))
  }

  // 수직봉 + 천장 레일
  root.add(box(len - 1.0, 0.06, 0.06, C.pole, midX, f + BUS.ceil - 0.18, tz(20.65)))
  for (const x of [-62.6, -60.3, -58.0]) {
    const p = new Mesh(new CylinderGeometry(0.035, 0.035, BUS.ceil - 0.2, 8), toonMat(C.pole))
    p.position.set(x, f + (BUS.ceil - 0.2) / 2, tz(20.65))
    root.add(p)
  }
  for (const x of [-63.4, -62.0, -59.4, -58.6, -57.2]) {
    root.add(strap(x, 20.65, 0.34))
  }

  /**
   * 뒷문 — 두 짝이 좌우로 갈린다.
   *
   * `setDoor` 로 여닫는 이유: 인트로가 정차 → **열림** → 하차 순서를 눈으로
   * 보여 줘야 하는데, 3인칭 구간에서는 DOM 마스크가 그 일을 못 한다.
   * 화면 밖 UI 가 아니라 **버스에 달린 물건**이 열려야 한다.
   */
  const leaf = (dir: -1 | 1): Mesh => {
    const m = box(0.52, 1.85, 0.08, C.frame, DOOR_X + dir * 0.27, f + 0.92, tz(BUS.yMax) + 0.02)
    return m
  }
  const dL = leaf(-1)
  const dR = leaf(1)
  root.add(dL, dR)

  return {
    root,
    setDoor(open) {
      const k = Math.max(0, Math.min(1, open))
      dL.position.x = DOOR_X - 0.27 - k * 0.5
      dR.position.x = DOOR_X + 0.27 + k * 0.5
      // 완전히 열리면 문짝이 문틀 뒤로 숨는다
      dL.visible = dR.visible = k < 0.995
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
      root.clear()
    },
  }
}
