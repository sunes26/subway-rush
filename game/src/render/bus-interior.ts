/**
 * 버스 실내 — **기존 버스(`Z1_OBJ01_bus.001`)의 확장**이다.
 *
 * ■ 새 버스를 만드는 파일이 아니다
 *
 * 외피는 이미 게임에 있다: `public/models/map/Z1_GROUND.glb` 의 노드 103,
 * translation (−60, −0.022, −20.4) · scale 2.1457 · quat (0.5, −0.5, 0.5, 0.5).
 * 여기서는 **그 안쪽만** 채운다. 외피는 한 폴리곤도 안 건드린다.
 *
 * ■ 아래 숫자는 전부 그 메시에서 잰 값이다 (추정이 아니다)
 *
 *   월드 AABB   x −65.302 ~ −54.398 (10.90m) · y 19.074 ~ 21.727 (2.65m) · z 0 ~ 3.253
 *   측면 유리   z 1.24 ~ 2.43 · x −64.4 ~ −56.4
 *   멀리언 x    −64.4 · −62.4 · −61.0 · −59.6 · −58.2 · −57.4 · −56.4   ← 간격이 제각각이다
 *   스커트·바퀴 z 0 ~ 0.83          (BUS_TRIM)
 *   차체        z 0.24 ~ 3.01       (BUS_BODY)
 *   지붕        z 2.79 ~ 3.25       (BUS_ROOF)
 *
 * ★ 이전 판이 어색했던 **진짜 이유**가 여기 있다. 그때는 `data/world.ts` 의
 *   충돌 상자(`OBJ-01-BUS`)를 기준으로 지었다. 겉 치수는 우연히 비슷했지만
 *   창 높이를 1.75~2.75 로, 천장을 3.10 으로 임의로 정했다 — 실제 창은
 *   1.24~2.43 이고 지붕 안쪽은 2.86 이다. **창 하나 안 맞았다.** 그래서 안과 밖이
 *   다른 물체로 읽혔다. 치수는 외형에서 역산해야지 상자에서 가져오면 안 된다.
 *
 * ■ 바닥 높이를 0.45 로 잡은 근거
 *
 *   창 하단이 z 1.24 다. 시내버스 창 하단은 바닥에서 0.75~0.85m 에 온다(앉은 사람의
 *   어깨 높이). 역산하면 바닥은 0.40~0.50 — 즉 **저상버스**다. 스커트(BUS_TRIM)가
 *   0.83 까지 올라오는 것과도 맞는다. 0.9 로 잡으면 창이 허리 아래로 내려와
 *   앉아서 창밖을 볼 수 없다.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, TorusGeometry } from 'three'
import { toonMat } from './toon'

/**
 * 외피에서 잰 값. **여기를 고치려면 GLB 를 다시 재야 한다.**
 * `data/world.ts` 의 충돌 상자와 비슷하지만 같지 않다 — 그쪽은 충돌용이다.
 */
export const BUS = {
  xMin: -65.30, xMax: -54.40,
  yMin: 19.07, yMax: 21.73,
  /** 차체 껍데기 두께 — 실내 면을 이만큼 안으로 들인다 */
  shell: 0.07,
  /** 바닥 윗면 z (저상버스) */
  floor: 0.45,
  /** 천장 아랫면 z — 지붕 안쪽 */
  ceil: 2.86,
  /** 측면 유리 대역 — 실내 창틀이 여기에 **정확히** 맞아야 한다 */
  winBottom: 1.24,
  winTop: 2.43,
  /** 측면 유리의 x 범위 */
  winXMin: -64.4,
  winXMax: -56.4,
  /** 실측 멀리언 x. 균등 분할이 아니다 */
  mullions: [-64.4, -62.4, -61.0, -59.6, -58.2, -57.4, -56.4],
} as const

/**
 * 뒷문 — 실측 멀리언 사이 한 칸(−61.0 ~ −59.6, 폭 1.4m)을 그대로 문으로 쓴다.
 *
 * 외피에는 문이 **없다**(북측 유리가 z 1.24~2.43 대역으로 끊김 없이 이어진다).
 * 그래서 창 리듬을 깨지 않는 유일한 자리가 기존 분할선 사이다. 새 구멍을 뚫는
 * 대신 있는 칸을 쓰는 것이라 실루엣·창 배열이 그대로 남는다.
 */
export const DOOR = { xMin: -61.0, xMax: -59.6 } as const
export const DOOR_X = (DOOR.xMin + DOOR.xMax) / 2

/**
 * 팔레트 — 외피(파랑 차체)와 충돌하지 않는 작은 조합.
 * 랜덤한 단색을 쌓지 않는다. 밝은 실내 + 절제된 좌석 + 노란 봉 하나.
 */
const C = {
  /** 실내 판넬 — 따뜻한 아이보리. 어두우면 "테스트 공간"으로 읽힌다 */
  panel: 0xdedbd3,
  ceiling: 0xeceae4,
  /** 바닥 — 중간 톤 뉴트럴 그레이. 검정으로 문제를 숨기지 않는다 */
  floor: 0x74777d,
  /** 통로 미끄럼 방지대 — 바닥에 결을 준다 */
  aisle: 0x63666c,
  /** 좌석 — 절제된 청회색. 파랑 외피와 같은 계열이되 채도를 낮춘다 */
  seat: 0x5d7c9e,
  seatBack: 0x4d6987,
  /** 좌석 다리·프레임 */
  frame: 0x8d9298,
  /** 봉·손잡이 — 노랑 하나만 */
  pole: 0xdcb838,
  /** 창틀 · 문틀 — 외피 트림과 같은 어두운 회색 */
  trim: 0x2b2e33,
} as const

const box = (
  w: number, h: number, d: number, color: number, x: number, y: number, z: number,
): Mesh => {
  const m = new Mesh(new BoxGeometry(w, h, d), toonMat(color))
  m.position.set(x, y, z)
  return m
}

/** 월드 y → three z. 부호를 한 곳에서만 뒤집는다 */
const tz = (worldY: number): number => -worldY

/** 실내 면의 위치 — 외피에서 껍데기 두께만큼 안으로 */
const IN = {
  yS: BUS.yMin + BUS.shell,
  yN: BUS.yMax - BUS.shell,
  xW: BUS.xMin + BUS.shell,
  xE: BUS.xMax - BUS.shell,
} as const

/**
 * 좌석 한 벌 — **좌판 · 등받이 · 다리** 세 부분이 구분된다.
 *
 * 진행 방향(+x, 동쪽)을 보고 앉는다. 그래서 등받이는 좌판의 **서쪽**에 선다.
 * 치수는 3등신 SD(키 1.48m)의 앉은키에서 잡았다 — 좌면 0.42m 는 실물 버스와
 * 같고, 이 캐릭터의 엉덩이가 그 위에 얹힌다.
 */
const seatUnit = (cx: number, cy: number, width: number): Group => {
  const g = new Group()
  const f = BUS.floor
  const z = tz(cy)
  // 좌판
  g.add(box(0.46, 0.09, width, C.seat, cx, f + 0.42, z))
  // 등받이 — 살짝 뒤로 눕힌다
  const back = box(0.10, 0.50, width, C.seatBack, cx - 0.24, f + 0.70, z)
  back.rotation.z = 0.10
  g.add(back)
  // 다리 — 좌판이 떠 있으면 얹어 놓은 것처럼 보인다
  g.add(box(0.06, 0.42, 0.06, C.frame, cx + 0.16, f + 0.21, z - width / 2 + 0.08))
  g.add(box(0.06, 0.42, 0.06, C.frame, cx + 0.16, f + 0.21, z + width / 2 - 0.08))
  return g
}

/** 손잡이 — 천장 레일에서 내려온 줄 + 고리 */
const strap = (x: number, cy: number, railZ: number): Group => {
  const g = new Group()
  const drop = 0.30
  g.add(box(0.025, drop, 0.025, C.trim, x, railZ - drop / 2, tz(cy)))
  const ring = new Mesh(new TorusGeometry(0.068, 0.016, 6, 12), toonMat(C.pole))
  ring.position.set(x, railZ - drop - 0.06, tz(cy))
  g.add(ring)
  return g
}

export type BusInterior = Readonly<{
  root: Group
  /** 뒷문을 연다 (0 닫힘 ~ 1 열림) */
  setDoor(open: number): void
  dispose(): void
}>

export const buildBusInterior = (): BusInterior => {
  const root = new Group()
  root.name = 'intro-bus-interior'

  const f = BUS.floor
  const midX = (IN.xW + IN.xE) / 2
  const midY = (IN.yS + IN.yN) / 2
  const len = IN.xE - IN.xW
  const wid = IN.yN - IN.yS

  // ── 바닥 · 천장
  root.add(box(len, 0.06, wid, C.floor, midX, f - 0.03, tz(midY)))
  // 통로 미끄럼 방지대 — 바닥이 한 장 판때기로 보이지 않게 결을 준다
  root.add(box(len, 0.012, 0.86, C.aisle, midX, f + 0.006, tz(20.45)))
  root.add(box(len, 0.05, wid, C.ceiling, midX, BUS.ceil + 0.025, tz(midY)))
  // 천장 패널 이음선 두 줄
  for (const y of [20.05, 20.85]) {
    root.add(box(len, 0.02, 0.05, C.trim, midX, BUS.ceil - 0.01, tz(y)))
  }

  /**
   * ── 북측(연석 쪽) 벽 — 허리 판 · **창 구멍** · 상인방.
   *
   * 창은 뚫린 채로 둔다. 유리를 여기 또 깔지 않는 이유: 외피의 `BUS_GLASS` 가
   * 이미 그 자리에 있고 단면 재질이라 **안에서는 뒷면이 컬링돼 저절로 투명**하다.
   * 안쪽에 유리를 한 겹 더 깔면 밖이 두 번 어두워진다.
   */
  const yN = tz(IN.yN)
  root.add(box(len, BUS.winBottom - f, 0.06, C.panel, midX, (f + BUS.winBottom) / 2, yN))
  root.add(box(len, BUS.ceil - BUS.winTop, 0.06, C.panel, midX,
    (BUS.winTop + BUS.ceil) / 2, yN))
  // 창 위아래 테 — 판과 구멍의 경계를 끊어 준다
  for (const z of [BUS.winBottom, BUS.winTop]) {
    root.add(box(len, 0.05, 0.08, C.trim, midX, z, yN))
  }
  /**
   * 창틀 세로살 — **실측 멀리언 위치 그대로**다. 균등 분할로 넣으면 밖에서 본
   * 창 분할과 안에서 본 창 분할이 어긋나 같은 버스로 안 읽힌다.
   */
  for (const x of BUS.mullions) {
    root.add(box(0.07, BUS.winTop - BUS.winBottom, 0.07, C.trim, x,
      (BUS.winBottom + BUS.winTop) / 2, yN))
  }

  // ── 남측 벽 · 앞뒤 격벽. 카메라가 등지더라도 뚫려 있으면 지도 밖이 보인다
  const yS = tz(IN.yS)
  root.add(box(len, BUS.ceil - f, 0.06, C.panel, midX, (f + BUS.ceil) / 2, yS))
  root.add(box(0.06, BUS.ceil - f, wid, C.panel, IN.xE, (f + BUS.ceil) / 2, tz(midY)))
  root.add(box(0.06, BUS.ceil - f, wid, C.panel, IN.xW, (f + BUS.ceil) / 2, tz(midY)))

  /**
   * ── 좌석 — 남측 2인석 · 북측 1인석 · 가운데 통로.
   *
   * 실내 폭 2.52m 를 2인석(0.86) + 통로(0.80) + 1인석(0.60)+ 여유 로 나눈다.
   * 서울 시내버스의 실제 배분이고, 통로 0.8m 는 사람이 지나갈 수 있는 최소폭이다.
   * 열 간격 0.80m 도 실물과 같다 — 여기를 제각각으로 두면 즉시 조악해 보인다.
   */
  const PITCH = 0.80
  const rows: number[] = []
  for (let x = IN.xW + 0.75; x <= IN.xE - 0.75; x += PITCH) rows.push(x)
  for (const x of rows) {
    root.add(seatUnit(x, 19.62, 0.86))                       // 남측 2인석
    // 북측 1인석 — 문 칸은 비운다. 문 앞에 좌석이 있으면 내릴 수가 없다
    if (x < DOOR.xMin - 0.25 || x > DOOR.xMax + 0.25) {
      root.add(seatUnit(x, 21.22, 0.60))
    }
  }

  /**
   * ── 봉 · 레일 · 손잡이.
   *
   * 수직봉은 통로 **가장자리**에 선다(통로 한복판에 세우면 길을 막는다).
   * 천장 레일은 좌석 열 위를 지나고, 손잡이는 그 레일에 매단다 — 셋이 이어져야
   * 손잡이가 공중에 뜬 것으로 안 보인다.
   */
  const railZ = BUS.ceil - 0.14
  for (const y of [20.05, 20.85]) {
    root.add(box(len - 1.2, 0.05, 0.05, C.pole, midX, railZ, tz(y)))
  }
  for (const x of [-63.6, -61.4, -59.2, -56.9]) {
    const p = new Mesh(new CylinderGeometry(0.032, 0.032, railZ - f, 10), toonMat(C.pole))
    p.position.set(x, f + (railZ - f) / 2, tz(20.85))
    root.add(p)
  }
  for (const x of [-64.2, -63.0, -61.8, -60.6, -59.4, -57.0, -55.8]) {
    root.add(strap(x, 20.05, railZ))
    root.add(strap(x, 20.85, railZ))
  }

  /**
   * ── 뒷문.
   *
   * 문틀은 고정, 문짝 두 짝이 좌우로 갈린다. 열리면 문짝이 문틀 **바깥으로**
   * 빠져 실내에서 안 보인다 — 실제 버스의 미닫이문과 같다.
   *
   * 열린 뒤 그 자리에 남는 것은 외피의 유리인데, 단면 재질이라 밖에서 안을 볼 때
   * 뒷면이 컬링돼 그대로 통과한다. 즉 **문이 열리면 진짜 구멍처럼 보인다.**
   */
  const doorH = BUS.winTop - f
  const doorZ = f + doorH / 2
  const yDoor = tz(IN.yN) + 0.01
  // 문틀 — 좌우 기둥 + 상인방
  root.add(box(0.07, doorH, 0.10, C.trim, DOOR.xMin, doorZ, yDoor))
  root.add(box(0.07, doorH, 0.10, C.trim, DOOR.xMax, doorZ, yDoor))
  root.add(box(DOOR.xMax - DOOR.xMin, 0.07, 0.10, C.trim,
    DOOR_X, f + doorH, yDoor))
  // 문 손잡이봉 — 내릴 때 잡는 세로봉
  const grab = new Mesh(new CylinderGeometry(0.028, 0.028, doorH - 0.1, 10), toonMat(C.pole))
  grab.position.set(DOOR.xMin - 0.18, doorZ, tz(21.05))
  root.add(grab)

  const leafW = (DOOR.xMax - DOOR.xMin) / 2 - 0.02
  const leaf = (dir: -1 | 1): Mesh =>
    box(leafW, doorH - 0.08, 0.05, C.panel,
      DOOR_X + dir * leafW / 2, doorZ, yDoor - 0.03)
  const dL = leaf(-1)
  const dR = leaf(1)
  root.add(dL, dR)

  return {
    root,
    setDoor(open) {
      const k = Math.max(0, Math.min(1, open))
      dL.position.x = DOOR_X - leafW / 2 - k * leafW
      dR.position.x = DOOR_X + leafW / 2 + k * leafW
      dL.visible = dR.visible = k < 0.99
    },
    dispose() {
      root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      root.clear()
    },
  }
}
