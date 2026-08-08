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
  /**
   * ★ **옆구리 실측값.** AABB 의 y 최대는 21.727 인데 그건 앞뒤 곡면과 휠하우스가
   *   만든 값이고, 사람이 앉는 구간(x −62~−58)의 **평평한 옆판은 21.58** 이다.
   *
   *   처음엔 AABB 를 그대로 믿고 실내 벽을 21.66 에 세웠다. 그랬더니 아이보리
   *   판넬이 파란 차체를 **뚫고 나와**, 밖에서 보면 버스가 회백색 판때기가 됐다.
   *   눈으로는 "실내가 외피를 가린다"까지만 보이고 원인이 안 보인다 — 높이별로
   *   옆판 y 를 다시 재서야 알았다(z 0.5~1.2 구간에서 21.579~21.585로 일정).
   */
  skinN: 21.58,
  /** 남측 옆판 — 중심선 20.4 에 대해 대칭이다 */
  skinS: 19.22,
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

/** 실내 면의 위치 — **실측 옆판**에서 5cm 안으로 */
const IN = {
  yS: BUS.skinS + 0.05,
  yN: BUS.skinN - 0.05,
  xW: BUS.xMin + 0.10,
  xE: BUS.xMax - 0.10,
} as const

/** 문짝이 붙는 면 — 옆판 **바로 바깥**. 여기가 뜨면 문이 공중에 뜬다 */
const SKIN_OUT = BUS.skinN + 0.02

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
  root.add(box(len, 0.012, 0.72, C.aisle, midX, f + 0.006, tz(20.49)))
  root.add(box(len, 0.05, wid, C.ceiling, midX, BUS.ceil + 0.025, tz(midY)))
  // 천장 패널 이음선 두 줄
  for (const y of [20.15, 20.85]) {
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
   * 실내 폭 2.26m 를 2인석(0.82) + 통로(0.72) + 1인석(0.62) 로 나눈다.
   * 서울 시내버스의 실제 배분이고, 통로 0.8m 는 사람이 지나갈 수 있는 최소폭이다.
   * 열 간격 0.80m 도 실물과 같다 — 여기를 제각각으로 두면 즉시 조악해 보인다.
   */
  const PITCH = 0.80
  const rows: number[] = []
  for (let x = IN.xW + 0.75; x <= IN.xE - 0.75; x += PITCH) rows.push(x)
  for (const x of rows) {
    root.add(seatUnit(x, 19.72, 0.82))                       // 남측 2인석
    // 북측 1인석 — 문 칸은 비운다. 문 앞에 좌석이 있으면 내릴 수가 없다
    if (x < DOOR.xMin - 0.25 || x > DOOR.xMax + 0.25) {
      root.add(seatUnit(x, 21.20, 0.62))
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
  for (const y of [20.15, 20.85]) {
    root.add(box(len - 1.2, 0.05, 0.05, C.pole, midX, railZ, tz(y)))
  }
  /**
   * 수직봉 x — 좌석(−61.28)과 문(−61.0~−59.6)을 **피한다.** 처음엔 −61.4 에 세웠는데
   * 앉은 사람 코앞이었고, 통로에서 그 사람을 보는 카메라의 시선을 정확히 가로막았다.
   */
  for (const x of [-63.9, -62.35, -58.5, -56.6]) {
    const p = new Mesh(new CylinderGeometry(0.032, 0.032, railZ - f, 10), toonMat(C.pole))
    p.position.set(x, f + (railZ - f) / 2, tz(20.83))
    root.add(p)
  }
  for (const x of [-64.2, -63.0, -62.0, -58.9, -57.8, -56.6]) {
    root.add(strap(x, 20.15, railZ))
    root.add(strap(x, 20.85, railZ))
  }

  /**
   * ── 뒷문 — **바깥쪽에 단다.**
   *
   * 외피에는 문이 없다. 그래서 문짝을 차체 표면 **밖**(y 21.75, 외피 21.727 바로
   * 앞)에 걸어 실제 시내버스의 미닫이문처럼 옆으로 빠지게 한다. 닫혀 있으면
   * 차체 색과 유리색을 그대로 써서 버스의 일부로 읽히고, 열리면 그 자리에
   * **어두운 구멍**이 남는다.
   *
   * 왜 안쪽이 아니라 바깥인가: ③ 샷은 인도에서 버스를 본다. 문짝이 실내에 있으면
   * 밖에서는 외피 유리만 보여 "열렸다"가 전혀 안 읽힌다. 여닫이는 **보는 쪽에**
   * 있어야 한다.
   *
   * 실루엣은 안 건드린다 — 두께 5cm 판이 차체에 붙는 것이고, 창 분할선
   * (−61.0 · −59.6) 사이에 정확히 들어가므로 창 배열도 그대로다.
   */
  const doorTop = BUS.winTop
  const doorH = doorTop - 0.06
  const yOut = tz(SKIN_OUT)
  const dw = DOOR.xMax - DOOR.xMin

  // 열렸을 때 드러나는 구멍 — 실내 그늘. 문짝보다 살짝 안쪽이다
  root.add(box(dw - 0.04, doorH - 0.06, 0.03, 0x14161a, DOOR_X, (doorH + 0.06) / 2, yOut + 0.05))
  // 문틀
  root.add(box(0.08, doorH, 0.09, C.trim, DOOR.xMin, doorH / 2 + 0.03, yOut))
  root.add(box(0.08, doorH, 0.09, C.trim, DOOR.xMax, doorH / 2 + 0.03, yOut))
  root.add(box(dw + 0.16, 0.08, 0.09, C.trim, DOOR_X, doorTop, yOut))
  // 내릴 때 잡는 세로봉 — 문 안쪽
  const grab = new Mesh(new CylinderGeometry(0.028, 0.028, doorH - 0.2, 10), toonMat(C.pole))
  grab.position.set(DOOR.xMin - 0.20, doorH / 2 + 0.03, tz(21.10))
  root.add(grab)

  /**
   * 문짝 — 아래는 차체 색, 위는 유리색. 외피의 허리선(창 하단 1.24)에서 갈린다.
   * 그래야 닫혀 있을 때 옆 칸 창과 높이가 이어져 한 대의 버스로 보인다.
   */
  const leafW = dw / 2 - 0.015
  const leafOf = (dir: -1 | 1): Group => {
    const g = new Group()
    const cx = DOOR_X + dir * leafW / 2
    const lower = BUS.winBottom - 0.06
    g.add(box(leafW, lower, 0.05, 0x1c6bc7, cx, 0.06 + lower / 2, yOut))
    g.add(box(leafW, doorTop - BUS.winBottom, 0.05, 0x171c24, cx,
      (BUS.winBottom + doorTop) / 2, yOut))
    // 문짝 가운데 세로 몰딩 — 두 짝이 맞물린 자리
    g.add(box(0.04, doorH - 0.1, 0.06, C.trim, DOOR_X + dir * 0.02, doorH / 2 + 0.03, yOut - 0.02))
    return g
  }
  const dL = leafOf(-1)
  const dR = leafOf(1)
  root.add(dL, dR)

  return {
    root,
    setDoor(open) {
      const k = Math.max(0, Math.min(1, open))
      // 옆으로 빠진다 — 실제 시내버스 미닫이문과 같다
      dL.position.x = -k * (leafW + 0.02)
      dR.position.x = k * (leafW + 0.02)
    },
    dispose() {
      root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose() })
      root.clear()
    },
  }
}
