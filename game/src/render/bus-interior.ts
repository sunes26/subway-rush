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

import { BoxGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, TorusGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
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
/**
 * ■ ★ 문을 **동쪽 베이**로 옮겼다 — 하차 지점과 스폰이 너무 멀었다
 *
 * 예전 문(−61.0 ~ −59.6, 중심 −60.3)에서 내리면 하차 지점이 (−60.2, 22.6)이고,
 * 게임이 시작되는 스폰은 (−58, 24)다. 동 2.2m · 북 1.4m 떨어져 있고 버스와의
 * 거리도 0.87m → 2.27m 로 **2.6배**가 된다.
 *
 * 그 사이를 카메라가 어떻게 보간해도 **화면의 같은 자리가 버스를 훑는다** —
 * 실측으로 문(−60.6)에서 앞머리(−55.4)까지 5.85m 를 지나가고 마지막엔 버스가
 * 프레임에서 빠졌다. "내린 버스가 다른 버스로 바뀌었다"는 지적의 정체가 이것이다.
 * 카메라 문제가 아니라 **무대 배치** 문제였다.
 *
 * 실측 멀리언에 −59.6 ~ −58.2 칸이 이미 있다. 그쪽으로 옮기면 문 중심이 −58.9,
 * 하차 지점이 (−58.8, 22.6)이 되어 스폰까지 **동 0.8m** 만 남는다.
 * 창 리듬은 그대로다 — 새 구멍을 뚫는 게 아니라 있는 칸을 쓰는 것이다.
 */
export const DOOR = { xMin: -59.6, xMax: -58.2 } as const
export const DOOR_X = (DOOR.xMin + DOOR.xMax) / 2

/**
 * 팔레트 — 외피(파랑 차체)와 충돌하지 않는 작은 조합.
 * 랜덤한 단색을 쌓지 않는다. 밝은 실내 + 절제된 좌석 + 노란 봉 하나.
 */
/**
 * 팔레트 — **좁게 묶는다.** 물체마다 색을 새로 고르면 그것만으로 프로토타입이 된다.
 * 밝기 차이는 "무엇인지 구분될 정도"까지만 준다.
 */
const C = {
  /** 실내 판넬 — 따뜻한 밝은 회색. 어두우면 그대로 "테스트 공간"이 된다 */
  panel: 0xe2ded5,
  ceiling: 0xf0ede6,
  /** 바닥 — 중간 톤 뉴트럴 그레이 */
  floor: 0x7c7f85,
  /** 통로 — 바닥보다 한 단 어둡게. 결이 없으면 바닥이 판때기 한 장이 된다 */
  aisle: 0x6b6e74,
  /** 좌석 방석 — 살짝 밝은 네이비. 등받이와 갈라 놔야 두 부분으로 읽힌다 */
  cushion: 0x51749b,
  /** 등받이 — 한 단 어두운 네이비 */
  seatBack: 0x3f5c7d,
  /** 좌석 다리 — 금속 */
  frame: 0x9aa0a6,
  /** 봉·손잡이 — 교통 노랑 하나만 */
  pole: 0xe0bc3c,
  /** 창틀 · 문틀 — 차콜. 순검정으로 두면 실내가 검은 격자 구조물이 된다 */
  trim: 0x3c4046,
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

/**
 * 문짝이 놓이는 면 — **개구부 안쪽**이다.
 *
 * ■ ★ 한동안 옆판 **바깥**(`skinN + 0.02`)이었다
 *
 * 외피에 문 구멍이 없던 시절의 편법이다. 문짝을 차체 표면에 띄워 붙여야 밖에서
 * 보이니까 그랬다. 대가는 컸다 — 정면에서 보면 **차체에 판을 덧댄** 것으로 읽히고,
 * 그 앞을 지나는 주인공이 차체 옆면에 붙어 보였다. 실측으로도 9개 면이 옆판을
 * +0.03~0.067 넘고 있었다.
 *
 * 이제 외피에 실제 구멍이 있다(`tools/hq_punch_bus_door.py` · 함몰 깊이 0.28).
 * 그래서 문짝을 **구멍 안**으로 넣는다. 실물 시내버스의 미닫이문도 옆판 안쪽에서
 * 옆으로 빠진다.
 *
 * 0.10 은 옆판(21.58)에서 안쪽, 함몰 뒷벽(21.30)에서 0.18 앞이다 — 두께 0.05 짜리
 * 문짝이 어느 쪽에도 닿지 않는다.
 */
const DOOR_INSET = 0.10
const SKIN_IN = BUS.skinN - DOOR_INSET

/**
 * 모서리를 죽인 상자. **날 선 박스 하나가 통째로 프로토타입처럼 보이게 만든다.**
 * 반지름은 2~3cm — 로우폴리 실루엣은 그대로 두고 모서리 하이라이트만 만든다.
 */
const soft = (
  w: number, h: number, d: number, r: number, color: number,
  x: number, y: number, z: number,
): Mesh => {
  const rr = Math.min(r, Math.min(w, h, d) / 2 - 1e-3)
  const m = new Mesh(new RoundedBoxGeometry(w, h, d, 2, rr), toonMat(color))
  m.position.set(x, y, z)
  return m
}

/**
 * 좌면 높이(바닥에서 방석 윗면까지, m).
 *
 * ★ 실물 시내버스는 0.42 다. 그런데 이 캐릭터는 **정강이가 0.275m 뿐이다**
 *   (실측: 골반 0.870 · 무릎 0.804 · 발목 0.529 → 허벅지 0.303 · 정강이 0.275).
 *   0.42 짜리 좌석에 앉히면 발이 바닥에서 15cm 떠서 아이가 어른 의자에 앉은
 *   그림이 되고, 골반을 좌면에 맞추면 이번엔 다리가 안 닿는다.
 *
 *   실물 치수보다 **캐릭터 체형이 먼저다**(브리프 §5). 정강이 + 여유 로 잡는다.
 */
const SEAT_H = 0.30

/**
 * 좌석 한 벌 — **방석 · 등받이 · 다리** 세 부분이 눈으로 구분된다.
 *
 * 진행 방향(+x, 동쪽)을 보고 앉는다. 그래서 등받이는 방석의 **서쪽**에 선다.
 * 좌면 0.42m · 등받이 위 0.98m 는 실물 시내버스 치수이고, 3등신 SD(키 1.48m)의
 * 앉은키가 그 안에 들어간다.
 *
 * ★ 방석을 등받이보다 **밝게** 두는 것이 핵심이다. 같은 색이면 아무리 나눠 만들어도
 *   한 덩어리 상자로 읽힌다 — 이전 판이 "얇은 직육면체를 반복 배치한 것" 처럼
 *   보였던 이유의 절반이 여기 있었다. 나머지 절반은 날 선 모서리였다.
 */
const seatUnit = (cx: number, cy: number, width: number): Group => {
  const g = new Group()
  const f = BUS.floor
  const z = tz(cy)
  // 방석 — 윗면이 `f + SEAT_H` 에 오도록 중심을 잡는다
  g.add(soft(0.46, 0.11, width, 0.035, C.cushion, cx + 0.01, f + SEAT_H - 0.055, z))
  // 등받이 — 방석 윗면에서 올라간다. 뒤로 조금 눕는다
  const back = soft(0.09, 0.50, width, 0.028, C.seatBack, cx - 0.225, f + SEAT_H + 0.25, z)
  back.rotation.z = 0.09
  g.add(back)
  // 등받이 위 손잡이 — 시내버스에 늘 있는 것. 이거 하나로 좌석이 가구가 된다
  const grip = new Mesh(new CylinderGeometry(0.018, 0.018, width * 0.72, 8), toonMat(C.pole))
  grip.rotation.x = Math.PI / 2
  grip.position.set(cx - 0.19, f + SEAT_H + 0.52, z)
  g.add(grip)
  // 다리 — 방석이 떠 있으면 얹어 놓은 것처럼 보인다
  const legH = SEAT_H - 0.11
  for (const side of [-1, 1]) {
    g.add(box(0.05, legH, 0.05, C.frame, cx + 0.13, f + legH / 2, z + side * (width / 2 - 0.10)))
  }
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
  /**
   * 문짝을 **뺀** 실내(바닥·천장·벽·좌석·봉…)를 켜고 끈다.
   *
   * ■ 왜 필요한가 — 밖으로 나간 뒤에도 실내가 그려지고 있었다
   *
   * 하차 컷(3.5s) 이후 외피는 켜고 승객은 껐는데 **실내만 안 껐다.** 밖에서 보는데
   * 실내가 계속 그려지니 외피 위로 삐져나왔다. 증상 셋이 전부 여기서 나왔다:
   *   · 천장(0xf0ede6)이 차체 위 **밝은 베이지 덩어리**로
   *   · 바닥(z 0.45) 위의 주인공이 차체 옆면에 **떠 있는 사람**으로
   *   · 실내 벽·좌석이 창 너머로 비쳐 차체가 뚫린 것처럼
   *
   * ⚠ `pick()` 은 `station.root`·`player.root` 만 훑어서 **이 그룹을 못 본다.**
   *   그래서 레이는 실내를 통과해 건너편 유리를 맞혔고, 한동안 "외피에 구멍이
   *   있다"고 잘못 읽었다. 도구가 안 보는 물체가 있다는 것을 같이 기억할 것.
   *
   * 문짝은 **남긴다** — 하차 연출의 "문이 열린다"가 그것 하나로 성립한다.
   */
  setShell(on: boolean): void
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
  /**
   * 천장 — 패널 이음선 두 줄 + **조명등**.
   *
   * 천장이 아무것도 없는 흰 판이면 실내가 통째로 비어 보인다. 실물 버스의
   * 천장에는 반드시 형광등 띠가 있고, 그 하나만으로 "정돈된 공간"이 된다.
   */
  for (const y of [20.15, 20.85]) {
    root.add(box(len, 0.02, 0.05, C.trim, midX, BUS.ceil - 0.01, tz(y)))
  }
  for (let lx = IN.xW + 1.1; lx < IN.xE - 0.8; lx += 2.6) {
    const lamp = box(1.7, 0.05, 0.20, 0xfdfbf4, lx, BUS.ceil - 0.045, tz(20.50))
    root.add(lamp)
    root.add(box(1.85, 0.06, 0.28, C.ceiling, lx, BUS.ceil - 0.02, tz(20.50)))
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
    root.add(box(len, 0.035, 0.06, C.trim, midX, z, yN))
  }
  /**
   * 창틀 세로살 — **실측 멀리언 위치 그대로**다. 균등 분할로 넣으면 밖에서 본
   * 창 분할과 안에서 본 창 분할이 어긋나 같은 버스로 안 읽힌다.
   */
  /**
   * ⚠ 세로살을 0.07 로 두었더니 **실내가 검은 격자 구조물**처럼 보였다. 실물
   * 버스의 창 기둥은 5cm 안팎이고 색도 순검정이 아니다. 얇게, 차콜로.
   */
  for (const x of BUS.mullions) {
    root.add(box(0.038, BUS.winTop - BUS.winBottom, 0.05, C.trim, x,
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
  for (const x of [-64.2, -63.15, -62.35, -58.4, -56.5]) {
    const p = new Mesh(new CylinderGeometry(0.032, 0.032, railZ - f, 10), toonMat(C.pole))
    p.position.set(x, f + (railZ - f) / 2, tz(20.83))
    root.add(p)
  }
  for (const x of [-64.2, -63.0, -62.0, -58.9, -57.8, -56.6]) {
    root.add(strap(x, 20.15, railZ))
    root.add(strap(x, 20.85, railZ))
  }

  /**
   * ── 생활감 소품 — **카메라에 실제로 보이는 것만.**
   *
   * 소품을 늘린다고 공간이 좋아지지 않는다(브리프 §29 — 기본 구조가 먼저다).
   * 그래서 ① 샷에 실제로 남는 자리 둘에만 얹는다.
   */
  /**
   * 하차벨 — 수직봉에 붙은 빨간 버튼. 버스에서 가장 알아보기 쉬운 물건이다.
   *
   * ⚠ 봉이 y 20.83 이고 통로는 그 **남쪽**이므로 `tz(20.83) + 0.06`(월드 y 20.77)
   *   이어야 통로를 향한다. 부호를 반대로 주면 봉 뒤에 숨어 한 프레임도 안 보인다.
   */
  for (const x of [-62.35, -63.15]) {
    root.add(box(0.095, 0.115, 0.02, 0xf2efe8, x, f + 1.24, tz(20.83) + 0.06))
    root.add(box(0.062, 0.078, 0.03, 0xd83a34, x, f + 1.24, tz(20.83) + 0.078))
  }
  /**
   * 노선 안내 띠 — 창 **위**. 실물 버스에는 정차역이 줄줄이 적힌 띠가 붙어 있고,
   * 그 가로선 하나가 실내를 "운행 중인 차"로 만든다.
   *
   * ⚠ 한 번 지웠다가 되살렸다. OTS(②) 화각에서 화면 위로 잘리길래 없앴는데,
   *   **넓은 실내 샷(①)에서는 오른쪽 벽에 그대로 보인다.** 샷마다 보이는 자리가
   *   다르므로 한 샷만 보고 지우면 안 된다.
   */
  root.add(box(len - 2.0, 0.16, 0.02, 0xf2efe8, midX, BUS.winTop + 0.20, yN + 0.04))
  for (let i = 0; i < 10; i++) {
    const sx = midX - (len - 3.0) / 2 + ((len - 3.0) / 9) * i
    root.add(box(0.06, 0.06, 0.02, 0x2f6fbf, sx, BUS.winTop + 0.20, yN + 0.055))
  }
  /** 창 기둥 안내 스티커 — 눈높이에 붙는 작은 표지 */
  for (const x of [-62.4, -59.6]) {
    root.add(box(0.02, 0.20, 0.13, 0xf2efe8, x, f + 1.46, yN + 0.05))
    root.add(box(0.02, 0.05, 0.09, 0x2f6fbf, x, f + 1.52, yN + 0.062))
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
  /**
   * ★ 문 부품은 **개구부 아래 끝(0.35)에서 시작한다.**
   *
   * 예전엔 문틀·몰딩이 z 0.03~0.08 부터 올라왔다. 외피에 구멍이 없던 시절에는
   * 차체 표면에 얹혀 있으니 어디서 시작해도 "문 모양"으로 읽혔다. 지금은 구멍이
   * z 0.35 부터라, 그 아래로 내려간 부품이 **스커트 위에 검은 막대로 남는다**
   * (실측 캡처 t=3800: 몰딩 둘이 개구부 밑으로 0.27m 뻗어 있었다).
   *
   * 문짝 아래 판만 0.35 로 올리고 문틀·몰딩을 안 고친 것이 원인이다.
   * 이제 셋이 같은 값을 쓴다 — 개구부와 정확히 같은 높이 대역이다.
   */
  const doorBottom = 0.35
  const doorH = doorTop - doorBottom
  const yIn = tz(SKIN_IN)
  const dw = DOOR.xMax - DOOR.xMin

  /*
   * ★ 여기 있던 **가짜 개구부 평면을 걷어냈다.**
   *
   * 외피에 구멍이 없던 시절, "열렸을 때 드러나는 그늘"을 어두운 평면 한 장으로
   * 흉내 냈다. 이제 외피에 실제 구멍과 0.28m 함몰이 있으므로(`BUS_TRIM` 재사용)
   * 그 평면은 진짜 함몰 **앞을 가리는** 판이 된다. 없는 것이 맞다.
   */
  // 문틀
  root.add(box(0.08, doorH, 0.09, C.trim, DOOR.xMin, doorBottom + doorH / 2, yIn))
  root.add(box(0.08, doorH, 0.09, C.trim, DOOR.xMax, doorBottom + doorH / 2, yIn))
  root.add(box(dw + 0.16, 0.08, 0.09, C.trim, DOOR_X, doorTop, yIn))
  /**
   * 내릴 때 잡는 세로봉 — 문 **동쪽**.
   *
   * ⚠ 서쪽(−61.2)에 세웠더니 주인공 좌석(−61.28)에서 8cm 앞이었다. ① 샷에서
   *   노란 봉이 얼굴을 정확히 세로로 갈랐다. 좌석이 없는 쪽에 둔다.
   */
  const grab = new Mesh(new CylinderGeometry(0.028, 0.028, doorH - 0.2, 10), toonMat(C.pole))
  grab.position.set(DOOR.xMax + 0.20, doorH / 2 + 0.03, tz(21.10))
  root.add(grab)

  /**
   * 문짝 — 아래는 차체 색, 위는 유리색. 외피의 허리선(창 하단 1.24)에서 갈린다.
   * 그래야 닫혀 있을 때 옆 칸 창과 높이가 이어져 한 대의 버스로 보인다.
   */
  const leafW = dw / 2 - 0.015
  /**
   * 문짝 — 아래는 차체 색 판, 위는 **유리**다. 외피의 창 하단(1.24)에서 갈린다.
   * 그래야 닫혀 있을 때 옆 칸 창과 높이가 이어져 한 대의 버스로 보인다.
   *
   * ⚠ 유리를 **상자로 만들면 안 된다.** 상자는 안쪽 면이 있어서 버스 안에서 보면
   *   문 자리가 시커먼 벽이 된다 — 실제로 ① 샷 오른쪽이 통째로 검은 사각형이었다.
   *   실물 버스의 문은 안에서 유리 너머가 보인다. 그래서 유리는 **바깥만 향하는
   *   평면 한 장**으로 둔다: 밖에서는 짙은 유리, 안에서는 그냥 창이 된다.
   */
  const leafOf = (dir: -1 | 1): Group => {
    const g = new Group()
    const cx = DOOR_X + dir * leafW / 2
    /**
     * ⚠ 아래 판을 **z 0.06 부터** 세웠더니 차체 밑단보다 낮게 내려와, 밖에서 보면
     *   버스에 파란 판을 덧대 인도까지 늘어뜨린 그림이 됐다(실측 캡처 t=3500).
     *   실물 저상버스의 문도 발판(0.35) 언저리에서 끝난다. 차체 안에 들어가므로
     *   실루엣을 안 깨뜨린다.
     */
    const lower = BUS.winBottom - doorBottom
    // 아래 판 — 양면 다 차체 색이라 상자로 둬도 된다
    g.add(box(leafW, lower, 0.05, 0x1c6bc7, cx, doorBottom + lower / 2, yIn))
    const glass = new Mesh(new PlaneGeometry(leafW - 0.02, doorTop - BUS.winBottom - 0.02),
      toonMat(0x171c24))
    glass.position.set(cx, (BUS.winBottom + doorTop) / 2, yIn - 0.01)
    glass.rotation.y = Math.PI
    g.add(glass)
    // 문짝 가운데 세로 몰딩 — 두 짝이 맞물린 자리
    g.add(box(0.035, doorH - 0.08, 0.055, C.trim, DOOR_X + dir * 0.018,
      doorBottom + doorH / 2, yIn - 0.02))
    return g
  }
  const dL = leafOf(-1)
  const dR = leafOf(1)
  root.add(dL, dR)

  /**
   * 문짝을 뺀 나머지를 한 그룹으로 묶는다. 만들 때마다 `shell.add` 로 넣는 대신
   * **다 만든 뒤 옮긴다** — 추가 지점이 서른 곳 가까이라 한 곳만 빠뜨리면
   * 그것만 밖에서 보인다.
   */
  const shell = new Group()
  shell.name = 'intro-bus-shell'
  for (const c of [...root.children]) if (c !== dL && c !== dR) shell.add(c)
  root.add(shell)

  return {
    root,
    setShell(on) { shell.visible = on },
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
