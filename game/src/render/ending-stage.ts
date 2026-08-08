/**
 * 엔딩 무대 — **객실은 안 만든다. 창과 안내판만 만든다.**
 *
 * 객실은 이미 실제 공간이다(`data/world.ts` `Z5-CABIN`, y 12.2~15.45 · 벽 3면).
 * 탑승 판정이 "객실 안에 들어섰는가"라서(`systems/train.ts trainSystem`) 판이 끝나는
 * 순간 주인공은 **이미 그 안에 서 있다.** 그러니 엔딩을 위해 옮길 것도, 지을 것도,
 * 씬을 갈아탈 것도 없다 — 없는 것은 **창밖**뿐이다.
 *
 * ■ 창밖을 지오메트리로 안 만든다
 *
 * 객실 북쪽 벽(`Z5-CABIN-N`)은 2.4m 짜리 불투명 벽이고, 월드의 벽들은 look 별로
 * 묶인 `InstancedMesh` 라(`world-builder.ts`) 한 장만 골라 숨기기가 어렵다.
 * 그래서 **벽 안쪽에 창 패널을 덧댄다.** 바깥 풍경은 그 패널에 그려진 그림이다 —
 * 5초짜리 컷에서 시차(parallax)를 살려 얻을 것보다, 벽을 건드리지 않아 잃지 않는
 * 것이 훨씬 크다. 대신 **텍스처를 옆으로 흘려** 속도를 낸다: 창밖이 흐르는 것이
 * 곧 "열차가 달린다"이고, 그건 시차가 아니라 속도로 읽히는 정보다.
 *
 * ■ 왜 두 장인가
 *
 * 터널과 일출을 한 장에 그려 놓고 색을 보간하면 "어두운 그림이 밝아진다"가 된다.
 * 실제로는 **터널이 끝나고 다른 것이 나타난다.** 그래서 두 장을 겹쳐 두고
 * 앞장(터널)의 불투명도를 내린다 — 터널이 걷히면서 뒤에 있던 강이 드러난다.
 */

import {
  CanvasTexture, Color, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, type Texture,
} from 'three'
import { CABIN_Y1, FLOOR } from '../data/world'

/** 안쪽 벽이 서는 y — 객실 북쪽 한계(15.45) 바로 앞. 살짝 당겨 z-fighting 을 피한다 */
const WALL_Y = CABIN_Y1 - 0.05
/** 창(유리)은 벽보다 아주 조금 더 뒤 — 벽에 뚫린 구멍처럼 보이게 한다 */
const GLASS_Y = WALL_Y + 0.03

/**
 * 객실 치수.
 *
 * ★ **걸어 다니는 공간(`Z5-CABIN`)은 이미 있는데 「안」이 없었다.** 바닥 슬랩과
 *   충돌 벽만 있고 안쪽에서 보이는 면이 없어서, 객실에 들어서면 어두운 허공에
 *   서 있는 그림이 됐다(실측). 컷이 성립하려면 최소한 **천장과 안쪽 벽**이 있어야
 *   한다 — 그 둘이 "실내"의 전부다. 좌석·손잡이까지 가지 않는 이유는, 5초 컷에서
 *   카메라가 보는 것은 사람과 창뿐이고 나머지는 화면 밖이기 때문이다.
 */
const CEIL_Z = FLOOR.B2 + 2.62
/**
 * 무대의 x 반폭 — **객차 한 칸의 절반보다 넉넉하게.**
 *
 * 7m 로 잡았다가 실측에서 프레임 왼쪽으로 승강장이 새어 들어왔다. 객실은 x 로
 * 128m 짜리 통이라 "적당히 넓게"가 통하지 않는다 — 카메라가 어디를 보든 **끝이
 * 안 보여야** 실내가 된다. 16m 면 화각 57° 에서 어느 방향으로도 가장자리가 안 잡힌다.
 */
const HALF_W = 16.0
/** 남쪽(문 쪽) 한계 — 바닥과 천장이 여기까지 깔린다. 카메라는 이 안에서만 움직인다 */
const SOUTH_Y = 12.25

/** 창 — 아래는 앉은 사람 어깨, 위는 선 사람 눈 위 */
const GLASS_Z0 = FLOOR.B2 + 0.95
const GLASS_Z1 = FLOOR.B2 + 2.02
const GLASS_Z = (GLASS_Z0 + GLASS_Z1) / 2
const GLASS_H = GLASS_Z1 - GLASS_Z0
const GLASS_W = HALF_W * 2

/** 안내판 — 창 위 띠. 실제 객실에서 문 위에 붙는 그 자리다 */
const LED_Z = (GLASS_Z1 + CEIL_Z) / 2
const LED_W = 3.4
const LED_H = 0.42

export type EndingStage = Readonly<{
  root: Group
  /**
   * @param x     주인공이 선 x — 창과 안내판을 그 앞으로 옮긴다
   * @param tunnel 터널 불투명도 1 → 0 (내려가면 일출이 드러난다)
   * @param scroll 창밖이 흐른 누적 거리(m 상당). 속도가 곧 이 값의 증가율이다
   * @param led    안내판 불투명도 0 → 1
   * @param wrong  참이면 안내판이 **신촌**(반대 방면)을 띄운다
   */
  sync(o: { x: number; tunnel: number; scroll: number; led: number; wrong: boolean }): void
  setVisible(on: boolean): void
}>

// ─────────────────────────── 그림 ───────────────────────────

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

const texOf = (c: HTMLCanvasElement, repeatX = 1): Texture => {
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(repeatX, 1)
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  /**
   * ★ **색 공간을 반드시 밝힌다.** 캔버스에 적은 `#e79a63` 같은 값은 sRGB 인데,
   *   three 는 지정이 없으면 선형으로 읽는다. 그러면 렌더러가 출력에서 한 번 더
   *   sRGB 로 올려 **두 번 밝아진다** — 실측에서 한강 일출이 통째로 뿌연 연보라
   *   띠가 됐다. 해도 물도 안 보였고 색만 남았다.
   */
  t.colorSpace = SRGBColorSpace
  return t
}

/**
 * 터널 — **어둠 자체는 그림이 아니다.** 검은 벽만 흐르면 정지 화면과 구별이 안 된다.
 * 지나가는 것(케이블·전등·기둥)이 있어야 흐른다는 것이 보인다.
 */
const drawTunnel = (): HTMLCanvasElement => {
  const [c, g] = canvas(512, 128)
  g.fillStyle = '#0a0c10'
  g.fillRect(0, 0, 512, 128)
  // 벽면 케이블 두 줄 — 살짝 처진 곡선이라야 콘크리트 벽처럼 읽힌다
  g.strokeStyle = '#171b21'
  g.lineWidth = 3
  for (const y0 of [46, 58]) {
    g.beginPath()
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, y0 + Math.sin(x / 64) * 3)
    g.stroke()
  }
  // 일정 간격의 보수등 — 이것 하나가 속도를 만든다
  for (let x = 24; x < 512; x += 96) {
    const grd = g.createRadialGradient(x, 34, 1, x, 34, 26)
    grd.addColorStop(0, 'rgba(255,214,140,.85)')
    grd.addColorStop(1, 'rgba(255,214,140,0)')
    g.fillStyle = grd
    g.fillRect(x - 26, 8, 52, 52)
  }
  // 바닥 쪽 기둥 그림자
  g.fillStyle = '#05070a'
  for (let x = 0; x < 512; x += 48) g.fillRect(x, 96, 12, 32)
  return c
}

/**
 * 한강 일출 — 홍대입구에서 신도림 방면이면 **합정과 당산 사이에서 당산철교를 건넌다.**
 * 임의로 붙인 배경이 아니라 이 노선에서 실제로 보이는 것이라, 그리는 것도 그대로다:
 * 낮은 해 · 물 위의 윤슬 · 멀리 다리와 강변 건물 실루엣.
 */
const drawDawn = (): HTMLCanvasElement => {
  const [c, g] = canvas(1024, 128)

  const sky = g.createLinearGradient(0, 0, 0, 128)
  sky.addColorStop(0, '#2b3f6b')
  sky.addColorStop(0.42, '#8d6f8e')
  sky.addColorStop(0.66, '#e79a63')
  sky.addColorStop(0.72, '#f6c07a')
  sky.addColorStop(1, '#2a3550')
  g.fillStyle = sky
  g.fillRect(0, 0, 1024, 128)

  // 해 — 수평선에 반쯤 걸린다. 다 뜬 해는 아침이 아니라 낮이다
  const sunX = 700
  const sunY = 86
  const halo = g.createRadialGradient(sunX, sunY, 2, sunX, sunY, 56)
  halo.addColorStop(0, 'rgba(255,236,190,.95)')
  halo.addColorStop(0.35, 'rgba(255,187,110,.45)')
  halo.addColorStop(1, 'rgba(255,187,110,0)')
  g.fillStyle = halo
  g.fillRect(sunX - 56, sunY - 56, 112, 112)
  g.fillStyle = '#fff0cf'
  g.beginPath(); g.arc(sunX, sunY, 11, 0, Math.PI * 2); g.fill()

  // 강 건너 건물 — 실루엣만. 형태를 그리면 어느 도시인지 우겨야 한다
  g.fillStyle = 'rgba(26,32,48,.86)'
  let x = 0
  while (x < 1024) {
    const w = 14 + ((x * 37) % 26)
    const h = 10 + ((x * 53) % 26)
    g.fillRect(x, 82 - h, w, h + 4)
    x += w + 4 + ((x * 17) % 9)
  }
  // 다리 — 상판 한 줄과 교각. 당산철교는 이 실루엣이 전부다
  g.fillStyle = 'rgba(20,25,38,.9)'
  g.fillRect(0, 80, 1024, 4)
  for (let px = 40; px < 1024; px += 128) g.fillRect(px, 84, 6, 14)

  // 물 — 해 아래로 윤슬이 세로로 길게 부서진다
  const water = g.createLinearGradient(0, 86, 0, 128)
  water.addColorStop(0, '#3b4a6b')
  water.addColorStop(1, '#141c2e')
  g.fillStyle = water
  g.fillRect(0, 86, 1024, 42)
  g.fillStyle = 'rgba(255,206,140,.5)'
  for (let y = 90; y < 128; y += 3) {
    const w = 22 - (y - 90) * 0.35
    g.fillRect(sunX - w / 2 + Math.sin(y) * 4, y, w, 1.4)
  }
  return c
}

/** 차내 안내판 — 「이번 역」과 「다음 역」. 이 한 장이 WRONG WAY 의 전부다 */
const drawLed = (wrong: boolean): HTMLCanvasElement => {
  const [c, g] = canvas(512, 64)
  g.fillStyle = '#07080a'
  g.fillRect(0, 0, 512, 64)
  const sans = '"Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif'

  g.font = `600 19px ${sans}`
  g.fillStyle = '#6d7480'
  g.fillText('이번 역', 16, 39)
  g.fillStyle = '#cfd6de'
  g.font = `700 24px ${sans}`
  g.fillText('홍대입구', 74, 40)

  g.fillStyle = '#2a2f37'
  g.fillRect(186, 14, 2, 36)

  g.font = `600 19px ${sans}`
  g.fillStyle = '#6d7480'
  g.fillText('다음 역', 204, 39)
  // 잘못 탄 쪽만 호박색이다 — 색이 먼저 말하고 글자가 확인해 준다
  g.fillStyle = wrong ? '#ffc83d' : '#7fe0a0'
  g.font = `700 26px ${sans}`
  g.fillText(`▶ ${wrong ? '신촌' : '합정'}`, 262, 41)
  return c
}

// ─────────────────────────── 조립 ───────────────────────────

const panel = (w: number, h: number, tex: Texture, opacity: number): Mesh => {
  const m = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
  )
  // 창밖은 조명을 안 받는다 — 바깥은 우리 역의 형광등과 무관하다(`MeshBasicMaterial`)
  return m
}

export const buildEndingStage = (): EndingStage => {
  const root = new Group()
  root.name = 'ending-stage'
  root.visible = false

  /**
   * 반복 횟수는 **창 폭(32m)에 맞춘다.** 1회로 두면 512px 그림이 32m 로 늘어나
   * 보수등이 뭉갠 얼룩이 된다(실측). 터널은 4m 마다(8회), 강은 12.8m 마다(2.5회)
   * 되풀이한다 — 가까운 것일수록 촘촘해야 흐르는 속도가 눈에 잡힌다.
   */
  const dawnTex = texOf(drawDawn(), 2.5)
  const tunnelTex = texOf(drawTunnel(), 8)
  const ledOk = texOf(drawLed(false))
  const ledWrong = texOf(drawLed(true))

  // 뒤(일출) → 앞(터널) 순으로 겹친다. 터널이 걷히면 뒤가 드러난다
  const dawn = panel(GLASS_W, GLASS_H, dawnTex, 1)
  dawn.position.set(0, GLASS_Z, -GLASS_Y - 0.02)
  root.add(dawn)

  const tunnel = panel(GLASS_W, GLASS_H, tunnelTex, 1)
  tunnel.position.set(0, GLASS_Z, -GLASS_Y)
  root.add(tunnel)

  /**
   * 안쪽 벽 — 창 **아래**와 **위** 두 판. 가운데를 비워 두는 것이 곧 창이다.
   *
   * 한 장짜리 벽에 유리를 덧대는 방법도 되지만, 그러면 유리가 벽에 걸린 액자로
   * 읽힌다. 벽이 창을 **둘러싸야** 창문이 된다 — 실제 객실 벽도 창 위아래로 나뉜다.
   */
  const wallMat = new MeshBasicMaterial({ color: new Color(0xb9bfc6) })
  const wallPanel = (z0: number, z1: number): Mesh => {
    const m = new Mesh(new PlaneGeometry(HALF_W * 2, z1 - z0), wallMat)
    m.position.set(0, (z0 + z1) / 2, -WALL_Y)
    return m
  }
  root.add(wallPanel(FLOOR.B2, GLASS_Z0))
  root.add(wallPanel(GLASS_Z1, CEIL_Z))

  /** 창틀 — 유리와 벽이 만나는 자리에 굵은 띠 두 줄. 이게 있어야 구멍이 창이 된다 */
  const frameMat = new MeshBasicMaterial({ color: new Color(0x39414a) })
  for (const z of [GLASS_Z0, GLASS_Z1]) {
    const bar = new Mesh(new PlaneGeometry(HALF_W * 2, 0.09), frameMat)
    bar.position.set(0, z, -WALL_Y + 0.012)
    root.add(bar)
  }

  /**
   * 바닥과 천장 — **이 둘이 실내를 만든다.**
   *
   * 없으면 머리 위가 역 천장이고 발밑으로 선로가 보인다. 실제로 그랬다:
   * 객실 슬랩(`Z5-CABIN`)은 걷기 위한 면이라 이 각도에서 선로를 못 가렸다.
   * 여기서 한 겹 더 까는 것은 중복이 아니라, **컷이 보는 면**을 우리가 쥐는 것이다.
   */
  const depth = CABIN_Y1 - SOUTH_Y
  const midY = (SOUTH_Y + CABIN_Y1) / 2
  const slab = (z: number, color: number): Mesh => {
    const m = new Mesh(
      new PlaneGeometry(HALF_W * 2, depth),
      new MeshBasicMaterial({ color: new Color(color), side: DoubleSide }),
    )
    m.rotation.x = Math.PI / 2
    m.position.set(0, z, -midY)
    return m
  }
  root.add(slab(FLOOR.B2 + 0.012, 0x8f959c))   // 바닥 — 객실 바닥은 승강장보다 어둡다
  root.add(slab(CEIL_Z, 0xd7dce1))

  /**
   * 형광등 띠 — 객실 조명은 늘 이 모양이고, 무엇보다 **인물 위에 밝은 선이 있어야**
   * 어두운 컷에서 실루엣이 산다. 천장보다 1.5cm 아래에 둬 z-fighting 을 피한다.
   */
  const strip = new Mesh(
    new PlaneGeometry(HALF_W * 2, 0.34),
    new MeshBasicMaterial({ color: new Color(0xfff6e2), side: DoubleSide }),
  )
  strip.rotation.x = Math.PI / 2
  strip.position.set(0, CEIL_Z - 0.015, -(midY + 0.35))
  root.add(strip)

  /**
   * 양 끝 벽 — 옆 칸으로 넘어가는 관통문 자리. 실제 객차에도 있고, 여기서는
   * **프레임을 닫는 일**을 한다. 카메라가 아무리 틀어져도 통 끝이 안 보인다.
   */
  for (const sx of [-HALF_W, HALF_W]) {
    const end = new Mesh(
      new PlaneGeometry(depth, CEIL_Z - FLOOR.B2),
      new MeshBasicMaterial({ color: new Color(0xa9b0b7), side: DoubleSide }),
    )
    end.rotation.y = Math.PI / 2
    end.position.set(sx, (FLOOR.B2 + CEIL_Z) / 2, -midY)
    root.add(end)
  }

  const led = panel(LED_W, LED_H, ledOk, 0)
  led.position.set(0, LED_Z, -WALL_Y + 0.02)
  root.add(led)

  const ledMat = led.material as MeshBasicMaterial
  const tunnelMat = tunnel.material as MeshBasicMaterial

  return {
    root,
    setVisible(on) { root.visible = on },
    sync({ x, tunnel: tunnelK, scroll, led: ledK, wrong }) {
      root.position.x = x
      tunnelMat.opacity = tunnelK
      ledMat.opacity = ledK
      const want = wrong ? ledWrong : ledOk
      if (ledMat.map !== want) { ledMat.map = want; ledMat.needsUpdate = true }
      /**
       * 창밖이 흐르는 방향은 **진행의 반대**다. 열차가 +x 로 가면 바깥은 −x 로 흐른다.
       * 터널이 강보다 빨리 흐른다 — 가까운 것이 빨리 지나가는 그 차이가 거리감이다.
       */
      tunnelTex.offset.x = scroll * 0.11
      dawnTex.offset.x = scroll * 0.018
    },
  }
}
