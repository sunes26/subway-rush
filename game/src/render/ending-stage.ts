/**
 * 엔딩 무대 — **창밖과 안내판, 둘뿐이다.**
 *
 * ★ 한때 여기서 객실(바닥·천장·안쪽 벽·양끝 벽)까지 지었다. **틀렸다.**
 *   `Z5_TRAIN.glb` 가 이미 객실 내부를 통째로 들고 있다 — 좌석·손잡이봉·출입문·창까지
 *   있고, `render/station.ts` 가 본편(`trainGroup`)과 반대 방면(`train2Group`, `B_` 접두사)
 *   두 벌로 세운다. 우리가 세운 판들은 그 진짜 내부를 **가리고 있었다**(실측: 본편
 *   승강장 컷에서 좌석이 안 보이고 회색 벽만 나왔다. 반대 방면에서는 우리 무대가
 *   40m 떨어진 자리에 놓여 안 가렸고, 그래서 거기서만 진짜 객실이 보였다).
 *
 * 그래서 남기는 것은 **원래 없던 것**뿐이다:
 *   · 창밖 — 차창 너머는 비어 있다. 터널과 한강 일출을 그 자리에 놓는다
 *   · 차내 안내판 — 「이번 역 · 다음 역」. WRONG WAY 의 전부가 이 한 장이다
 *
 * ■ 창밖을 지오메트리로 안 만든다
 *
 * 바깥 풍경은 판 한 장에 그린 그림이고, **텍스처를 옆으로 흘려** 속도를 낸다.
 * 5초짜리 컷에서 시차(parallax)로 얻을 것보다 판 하나로 끝나는 값이 크다 —
 * 창밖이 흐르는 것이 곧 "열차가 달린다"이고, 그건 시차가 아니라 속도로 읽힌다.
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
import { TRAIN } from '../data/tuning'
import { FLOOR } from '../data/world'

/**
 * 창밖 판이 서는 y — **차체 바깥쪽.** 차체는 y 12.42~15.58 이고 그 너머는 비어 있다.
 * 진짜 차창(`TR_dwin_`) 뒤에 이 판이 놓여야 창을 통해 보인다.
 */
const GLASS_Y = TRAIN.bodyYMax + 0.06
/** 창 높이 — 실제 차창 띠에 맞춘다. 아래는 좌석 등받이 위, 위는 선 사람 눈 위 */
const GLASS_Z0 = FLOOR.B2 + 1.02
const GLASS_Z1 = FLOOR.B2 + 2.06
const GLASS_Z = (GLASS_Z0 + GLASS_Z1) / 2
const GLASS_H = GLASS_Z1 - GLASS_Z0
/**
 * 창밖 판의 x 반폭. 카메라가 어디를 보든 끝이 안 보여야 한다 —
 * 좁게 잡았다가 프레임 옆으로 역이 새는 것을 실측으로 겪었다.
 */
const HALF_W = 16.0
const GLASS_W = HALF_W * 2

/** 차내 안내판 — 문 위 띠. 차체 안쪽 면에 붙인다 */
const LED_Y = TRAIN.bodyYMax - 0.14
const LED_Z = FLOOR.B2 + 2.28
const LED_W = 3.4
const LED_H = 0.42

export type EndingStage = Readonly<{
  root: Group
  /**
   * @param x     주인공이 선 x — 창과 안내판을 그 앞으로 옮긴다
   * @param yOff  반대 방면이면 `Y_OFFSET_OPP`. 두 승강장은 y 만 다르다
   * @param tunnel 터널 불투명도 1 → 0 (내려가면 일출이 드러난다)
   * @param scroll 창밖이 흐른 누적 거리(m 상당). 속도가 곧 이 값의 증가율이다
   * @param led    안내판 불투명도 0 → 1
   * @param wrong  참이면 안내판이 **신촌**(반대 방면)을 띄운다
   */
  sync(o: { x: number; yOff: number; tunnel: number; scroll: number; led: number; wrong: boolean }): void
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
   * 창틀 — 창밖 판의 위아래 경계. 진짜 차창(`TR_dwin_`)이 이 앞에 있지만, 그 유리는
   * 반투명이라 경계가 흐리다. 얇은 띠 두 줄을 뒤에 깔아 **창의 위아래가 어디인지**를
   * 분명히 한다. 이게 없으면 바깥 그림이 차체를 뚫고 떠 있는 것처럼 보인다.
   */
  const frameMat = new MeshBasicMaterial({ color: new Color(0x2a3038) })
  for (const z of [GLASS_Z0, GLASS_Z1]) {
    const bar = new Mesh(new PlaneGeometry(HALF_W * 2, 0.10), frameMat)
    bar.position.set(0, z, -GLASS_Y + 0.02)
    root.add(bar)
  }

  const led = panel(LED_W, LED_H, ledOk, 0)
  led.position.set(0, LED_Z, -LED_Y)
  root.add(led)

  const ledMat = led.material as MeshBasicMaterial
  const tunnelMat = tunnel.material as MeshBasicMaterial

  return {
    root,
    setVisible(on) { root.visible = on },
    sync({ x, yOff, tunnel: tunnelK, scroll, led: ledK, wrong }) {
      root.position.x = x
      // 월드 y 는 three z 로 부호가 뒤집혀 들어간다(`train-rig.ts` 와 같은 규약)
      root.position.z = -yOff
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
