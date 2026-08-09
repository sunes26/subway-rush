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
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, DoubleSide, Group, LinearFilter, LinearMipmapLinearFilter, Mesh,
  MeshBasicMaterial, PlaneGeometry, PointLight, Points, PointsMaterial,
  RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture,
} from 'three'
import { TRAIN } from '../data/tuning'
import { FLOOR } from '../data/world'
import { GLASS_Y } from './outro'

/**
 * 창밖 판이 서는 y — **객실 안쪽, 맞은편 벽 바로 앞.**
 *
 * ★ 한때 차체 **바깥**(15.64)에 뒀다. 진짜 차창을 통해 보이게 하려는 것이었고
 *   실제로 보이기도 했는데, 그건 **문의 유리**를 통해서였다. 문 사이 벽에 있는 창은
 *   이 GLB 에서 불투명이라, 카메라가 벽 구간을 보는 순간 창이 회색 판이 됐다(실측).
 *
 *   문 유리에 기대려면 카메라가 문 정면에 서야 하는데 **거기는 문틀이 화면을 자르는
 *   자리**다 — 두 조건을 동시에 만족할 수 없다. 그래서 유리에 안 기댄다:
 *   맞은편 벽 **앞**에 판을 세워 창 자리를 직접 덮는다.
 *
 *   높이를 차창 띠에 맞추므로(아래) 좌석은 아래로, 안내판은 위로 그대로 남는다 —
 *   예전에 벽·천장까지 지어 내부를 통째로 덮던 것과는 다르다.
 */
// 단일 출처는 `render/outro.ts` 다 — 아래 import 참고
/**
 * 창 높이 — **좌석 등받이 위부터 안내판 아래까지.** 그 사이가 실제 차창 띠다.
 *
 * 한때 1.60m(B2+0.80~2.40)까지 키웠다. 판을 차체 바깥에 두던 시절엔 그래도 됐지만,
 * 객실 안으로 들여온 지금은 **좌석과 안내판을 덮는다.** 1.04m 로 되돌린다 —
 * 대신 창이 작아 보이지 않는 이유는 카메라가 2.3m 앞에 서기 때문이다.
 */
const GLASS_Z0 = FLOOR.B2 + 1.12
const GLASS_Z1 = FLOOR.B2 + 2.16
const GLASS_Z = (GLASS_Z0 + GLASS_Z1) / 2
const GLASS_H = GLASS_Z1 - GLASS_Z0
/**
 * 창밖 판의 x 반폭 — **카메라가 보는 만큼만.**
 *
 * 한때 16m(폭 32m)였다. 카메라가 객차 길이 방향을 45° 로 비껴보던 시절의 방어값인데,
 * 지금은 정북을 보므로 그만큼 필요 없다. 실제로 화면에 들어오는 창 폭을 재면:
 *
 *   카메라 → 창 2.84~3.14m · 최대 화각 55°(16:9 → 수평 85°)
 *   → 보이는 폭 **약 5.7m** (px−2.6 ~ px+3.1)
 *
 * 32m 중 5.7m 만 보고 있었다는 뜻이고, 그 대가가 **해상도**였다: 2560px 그림을
 * 32m 에 늘리면 80px/m 이라 보이는 구간이 원본 456px 뿐이다(960px 화면에 2배 확대).
 * 12m 로 줄이면 같은 그림이 213px/m — **2.7배 선명해진다.**
 *
 * 6m 는 보이는 폭의 2배가 넘는 여유다. 이보다 줄이면 화각을 넓히는 순간 새기 시작한다.
 */
const HALF_W = 6.0
const GLASS_W = HALF_W * 2

/** 차내 안내판 — 문 위 띠. 차체 안쪽 면에 붙인다 */
const LED_Y = 15.36
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
   * @param wrong  참이면 안내판이 **신촌**을 띄우고 창밖이 **지옥**이 된다
   * @param glow   창밖 빛이 객실로 들어오는 정도 0 → 1. **이 값이 이 컷의 절반이다**
   * @param flash  번개 — 창밖 빛의 순간 배율(1 = 평소). 새 광원을 안 만든다
   *
   * ⚠ 실내 감광(`dim`)은 여기서 안 한다 — `stage.setIndirect()` 가 그 일을 이미
   *   갖고 있고(`render/scene.ts`), 그쪽은 `main.ts` 가 쥐고 있다.
   */
  sync(o: {
    x: number; yOff: number; tunnel: number; scroll: number
    led: number; wrong: boolean; glow: number; flash: number
  }): void
  setVisible(on: boolean): void
}>

// ─────────────────────────── 그림 ───────────────────────────

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

/**
 * 이방성 필터링 배율. three 가 기기 최대치로 알아서 물리므로(`WebGLTextures` 가
 * `Math.min(anisotropy, getMaxAnisotropy())`) 높게 적어 두면 된다.
 */
const ANISO = 16

const texOf = (c: HTMLCanvasElement, repeatX = 1): Texture => {
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(repeatX, 1)
  /**
   * ★ **밉맵과 이방성을 켠다.**
   *
   * `minFilter` 가 `LinearFilter` 면 three 는 밉맵을 **아예 안 만든다**(밉맵 계열
   * 필터일 때만 만든다). 창은 축소돼 그려지는 데다 카메라가 10~15° 비스듬해서,
   * 밉맵 없이 2탭 선형 보간만 하면 가장자리가 깜빡이고 가로로 뭉갠다.
   *
   * 이방성은 **비스듬한 각도 전용**이다. 밉맵만 켜면 비스듬한 면이 오히려 더
   * 흐려지는데(가장 흐린 밉을 고르므로), 이방성이 그 손해를 되돌린다. 둘은 짝이다.
   */
  t.minFilter = LinearMipmapLinearFilter
  t.magFilter = LinearFilter
  t.generateMipmaps = true
  t.anisotropy = ANISO
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
 * 배경 한 장 — **이미지가 있으면 그것을, 없으면 그려서 쓴다.**
 *
 * 절차 생성으로는 색과 실루엣까지가 한계다. 레퍼런스 수준(구름 결·물 반사·첨탑
 * 디테일)은 그림 파일이라야 나온다. 그렇다고 파일이 없을 때 창이 까맣게 비면
 * 컷 자체가 죽으므로, **둘을 같은 자리에 놓고 있는 쪽을 쓴다.**
 *
 *   `game/public/textures/<name>.webp` 가 있으면 → 그 그림
 *   없으면(404)                                → `draw()` 가 그린 캔버스
 *
 * 로드는 비동기라 첫 프레임은 캔버스로 시작했다가 도착하면 갈아탄다. 컷이 5.2초라
 * 그 사이에 거의 항상 도착하고, 늦어도 그림이 바뀔 뿐 깨지지 않는다.
 *
 * @param band 잘라 쓸 띠의 **중심**이 원본 위에서 몇 % 지점인가(0~1).
 *   이미지마다 지평선 높이가 달라서 상수 하나로는 안 된다 — 일출은 해와 다리가,
 *   지옥은 지옥문과 번개가 띠에 들어와야 한다. 실측으로 정한다.
 */
const loadOrDraw = (
  name: string, draw: () => HTMLCanvasElement, repeatX: number, band: number,
): Texture => {
  const tex = texOf(draw(), repeatX)
  /**
   * 확장자를 **순서대로 시도한다.** 배포용은 WebP 지만, 원본을 PNG 로 떨궈 두는 일이
   * 실제로 있었고(그때 로더가 `.webp` 만 찾아서 조용히 폴백으로 돌아갔다) 화면만
   * 보고는 원인을 알 수 없었다. 둘 다 받으면 그 실패가 안 난다.
   */
  const tryLoad = (exts: readonly string[]): void => {
    const [ext, ...rest] = exts
    if (ext === undefined) return
    new TextureLoader().load(
      `${import.meta.env.BASE_URL}textures/${name}.${ext}`,
      (img) => {
        img.wrapS = RepeatWrapping
        img.wrapT = RepeatWrapping
        img.colorSpace = SRGBColorSpace
        // 캔버스 폴백과 **같은 필터**를 건다 — 안 그러면 그림이 도착하는 순간 흐려진다
        img.minFilter = LinearMipmapLinearFilter
        img.magFilter = LinearFilter
        img.generateMipmaps = true
        img.anisotropy = ANISO

        /**
         * ★ **가로 띠를 잘라 쓴다 — 그래서 아무 가로 이미지나 넣어도 된다.**
         *
         * 창은 12m × 1.6m 라 **7.5:1** 이다. 여기 16:9 그림을 그대로 붙이면 가로로
         * 4배 늘어나 건물이 옆으로 퍼진다. 그렇다고 그림을 7.5:1 로 만들어 오라고
         * 요구하면 쓸 수 있는 그림이 거의 없다.
         *
         * 대신 세로를 **잘라서** 비율을 맞춘다: 원본에서 높이의 `h` 만큼만 샘플링하면
         * 보이는 영역이 `w : (h·원본높이)` 가 되고, 이것을 7.5:1 로 두면 늘어남이 0 이다.
         * 잘라 낸 띠는 지평선 근처를 잡도록 위에서 30% 지점부터 센다 — 하늘만 나오거나
         * 물만 나오는 것을 막는다.
         */
        const src = img.image as { width: number; height: number }
        const want = (HALF_W * 2) / GLASS_H          // 창의 종횡비 (7.5)
        const bandY = Math.min(1, src.width / (want * src.height))
        /**
         * UV 의 y 원점은 **아래**다. `band` 는 읽기 쉽게 위에서 잰 값이라 뒤집어 쓴다.
         * 띠가 위아래로 넘치지 않게 [0, 1−bandY] 로 물린다.
         */
        const fromBottom = 1 - band
        const offY = Math.max(0, Math.min(1 - bandY, fromBottom - bandY / 2))
        img.repeat.set(repeatX, bandY)
        img.offset.set(tex.offset.x, offY)

        // 캔버스가 쓰던 자리를 그대로 물려받는다 — 흐른 거리(offset.x)까지 이어야 안 튄다
        tex.image = img.image
        tex.repeat.copy(img.repeat)
        tex.offset.y = img.offset.y
        tex.anisotropy = img.anisotropy
        tex.needsUpdate = true
      },
      undefined,
      // 이 확장자가 없으면 다음 것을 본다. 다 없으면 그린 것을 쓴다 — **정상 상태다**
      () => tryLoad(rest),
    )
  }
  tryLoad(['webp', 'png'])
  return tex
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

/**
 * 지옥 — **반대 방면의 창밖.**
 *
 * 처음엔 여기를 터널 그대로 뒀다. "잘못 탄 사람에게 일출은 보상이다"가 이유였는데,
 * 절반만 맞았다: 보상을 안 주는 것과 **아무 일도 안 일어나는 것**은 다르다.
 * 어두운 터널은 정상 주행과 구분되지 않아서, 절망이 안내판 글자 하나에만 얹혀 있었다.
 * 창밖이 바뀌어야 "이 열차가 어디로 가는가"가 화면에 있다.
 *
 * ★ 실사를 흉내 내지 않는다. 절차 생성으로 낼 수 있는 것은 **색과 실루엣**뿐이고,
 *   그 둘만 제대로 잡으면 5초 컷에서는 충분하다 — 흐르는 창밖은 어차피 정지해서
 *   뜯어볼 수 없다. 이미지 에셋이 들어오면 이 함수는 폴백으로 물러난다.
 */
const drawHell = (): HTMLCanvasElement => {
  const [c, g] = canvas(1024, 256)

  // 하늘 — 위가 더 어둡다. 빛이 **아래(용암)** 에서 온다는 것을 색으로 먼저 말한다
  const sky = g.createLinearGradient(0, 0, 0, 256)
  sky.addColorStop(0, '#120301')
  sky.addColorStop(0.34, '#4a0d06')
  sky.addColorStop(0.62, '#9e1e08')
  sky.addColorStop(0.80, '#e84a10')
  sky.addColorStop(1, '#ffb24a')
  g.fillStyle = sky
  g.fillRect(0, 0, 1024, 256)

  // 연기 — 가로로 늘어난 덩어리 몇 개. 하늘이 평평하면 그라디언트로 읽힌다
  g.fillStyle = 'rgba(20,3,2,.55)'
  for (let i = 0; i < 22; i++) {
    const x = (i * 137) % 1024
    const y = 12 + ((i * 53) % 90)
    g.beginPath()
    g.ellipse(x, y, 90 + ((i * 31) % 70), 16 + ((i * 17) % 14), 0, 0, Math.PI * 2)
    g.fill()
  }

  // 첨탑 실루엣 — 뾰족할수록 자연물이 아니게 보인다
  g.fillStyle = '#1a0503'
  for (let x = -40; x < 1064; x += 46) {
    const h = 52 + ((x * 37) % 96)
    const w = 26 + ((x * 13) % 22)
    g.beginPath()
    g.moveTo(x, 196)
    g.lineTo(x + w / 2, 196 - h)
    g.lineTo(x + w, 196)
    g.closePath()
    g.fill()
  }

  // 지옥문 — **한 장에 하나만.** 둘이면 5초 안에 두 번 지나가 정체가 드러난다
  const gx = 300
  g.fillStyle = '#160402'
  g.fillRect(gx, 96, 150, 100)
  g.beginPath(); g.arc(gx + 75, 96, 75, Math.PI, 0); g.fill()
  const inner = g.createLinearGradient(0, 110, 0, 196)
  inner.addColorStop(0, '#ffdf9a')
  inner.addColorStop(1, '#ff5a12')
  g.fillStyle = inner
  g.fillRect(gx + 26, 118, 98, 78)
  g.beginPath(); g.arc(gx + 75, 118, 49, Math.PI, 0); g.fill()

  // 쇠사슬 — 위에서 늘어진 고리 두 줄. 지옥 특유의 "매달린 것"이 화면에 필요하다
  g.strokeStyle = '#2a0d07'
  g.lineWidth = 5
  for (const [x0, sag] of [[130, 46], [760, 38]] as const) {
    g.beginPath()
    for (let i = 0; i <= 20; i++) {
      const x = x0 + i * 9
      g.lineTo(x, 8 + Math.sin((i / 20) * Math.PI) * sag)
    }
    g.stroke()
  }

  // 용암 — 아래쪽. 갈라진 틈이 밝고 그 사이 바닥은 검다
  g.fillStyle = '#0d0301'
  g.fillRect(0, 196, 1024, 60)
  for (let i = 0; i < 40; i++) {
    const x = (i * 79) % 1024
    const y = 200 + ((i * 29) % 50)
    const w = 30 + ((i * 41) % 90)
    const grd = g.createLinearGradient(x, y, x + w, y)
    grd.addColorStop(0, 'rgba(255,90,18,0)')
    grd.addColorStop(0.5, '#ff8a2a')
    grd.addColorStop(1, 'rgba(255,90,18,0)')
    g.fillStyle = grd
    g.fillRect(x, y, w, 3 + ((i * 7) % 4))
  }
  return c
}

/**
 * 부드러운 방사형 폴오프 — 가산 판에 쓴다.
 *
 * ★ 후처리 블룸을 안 쓰는 대신이다. `render/glow.ts` 헤더에 이 저장소에서 실측한
 *   근거가 있다(컴포저를 넣으면 톤매핑 경로가 바뀌어 게이트 사인 색이 변한다).
 *   그쪽은 인스턴스 셰이더로 크게 짜 놨는데, 엔딩은 판이 서너 장이라 텍스처 한 장이면
 *   충분하다 — 같은 원리, 훨씬 작은 구현.
 */
const drawFalloff = (): HTMLCanvasElement => {
  const [c, g] = canvas(128, 128)
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.45, 'rgba(255,255,255,.42)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return c
}

/**
 * 유리의 반사 — **창이라는 것을 말해 주는 유일한 단서다.**
 *
 * 지금 창은 그림 한 장이라 "벽에 붙인 포스터"로 읽힌다. 실제 차창은 실내를 옅게
 * 비추고, 그 반사가 **비스듬한 띠**로 지나간다. 그 띠 하나만 얹어도 유리가 생긴다.
 */
const drawSheen = (): HTMLCanvasElement => {
  const [c, g] = canvas(256, 64)
  const grd = g.createLinearGradient(0, 64, 256, 0)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(0.42, 'rgba(255,255,255,0)')
  grd.addColorStop(0.5, 'rgba(255,255,255,.55)')
  grd.addColorStop(0.58, 'rgba(255,255,255,0)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 64)
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

/**
 * 텍스처는 **부팅 때 만든다 — 컷이 시작될 때가 아니라.**
 *
 * 한때 `buildEndingStage()` 안에서 만들었다. 그러면 그림 파일 요청이 **컷이 시작되는
 * 바로 그 순간** 나가는데, 하필 그때가 메인 스레드가 가장 바쁜 시점이라(카메라 전환 ·
 * 포즈 계산 · 무대 생성) 5.2초 안에 디코드가 못 끝났다. 실측: 파일을 900KB 에서
 * 84KB 로 줄여도 컷 내내 폴백 그림이 나왔다 — 크기 문제가 아니라 **타이밍** 문제였다.
 *
 * 모듈 최상위에 두면 `main.ts` 가 이 파일을 import 하는 순간(=부팅) 요청이 나가고,
 * 실제 컷은 아무리 빨라도 몇 분 뒤라 항상 준비돼 있다. 판마다 다시 만들 이유도 없다.
 *
 * 풍경(일출·지옥)은 **반복하지 않는다(1회).** 창이 12m 라 한 장이 그 폭을 그대로
 * 덮는다 — 이음매가 존재하지 않으므로 그림의 좌우 끝을 맞출 필요도 없다.
 * 터널만 4m 마다(3회) 되풀이한다: 케이블·보수등은 원래 일정 간격으로 지나간다.
 *
 * 띠 중심(원본 위에서 %)은 **그림마다 실측해서 정한다.** 행별 평균 밝기를 재면
 * 지평선과 광원이 어디 있는지 바로 나온다:
 *
 *   일출 — 하늘·해가 20~33% 에서 가장 밝고, 58% 에 어두운 띠(대안 강변)가 있고,
 *          73~86% 가 물 반사다. 띠(높이 40%)가 해와 지평선을 다 물려면 중심 **0.45**.
 *   지옥 — 20% 에 번개, 86% 에 용암이 몰려 있다. 중심 **0.55** 면 둘 다 들어온다.
 *
 * ⚠ **그림을 바꾸면 이 값을 다시 재야 한다.** 종횡비가 바뀌면 띠 높이가 달라져서
 *   같은 중심값이 다른 구간을 자른다 — 실제로 3.6:1 → 3:1 로 바뀌자 0.70 이 물만
 *   잡았다(하늘도 해도 화면 밖이었다).
 */
const dawnTex = loadOrDraw('ending-dawn', drawDawn, 1, 0.45)
const hellTex = loadOrDraw('ending-hell', drawHell, 1, 0.55)
const tunnelTex = texOf(drawTunnel(), 3)
const falloffTex = texOf(drawFalloff())
const sheenTex = texOf(drawSheen())
const ledOk = texOf(drawLed(false))
const ledWrong = texOf(drawLed(true))

// ─────────────────────────── 조립 ───────────────────────────

const panel = (w: number, h: number, tex: Texture, opacity: number): Mesh => {
  const m = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({
      map: tex, transparent: true, opacity, side: DoubleSide, depthWrite: false,
      /**
       * ★★ **톤매핑을 통과시키지 않는다.** 이 한 줄이 화질 문제의 대부분이었다.
       *
       * 렌더러는 `ACESFilmicToneMapping` + `exposure 0.88` 로 돈다(`render/scene.ts`).
       * ACES 는 하이라이트를 압축하면서 **채도를 강하게 빼는** 커브라, 창밖 그림이
       * 그걸 통과하면 원본과 다른 그림이 된다. 실측(원본 vs 화면, 같은 영역):
       *
       *   채도 137 → 80  (−42%) · 대비 38.6 → 25.8 (−33%) · 밝기 188 → 154
       *
       * 밝은 그림일수록 손해가 크다 — 일출은 −42% 인데 지옥은 −10% 였다. 그 비대칭이
       * 원인을 특정해 줬다. 창밖은 **우리 씬의 빛이 아니라 자기 색을 내는 화면**이라
       * 톤매핑 대상이 아니다.
       *
       * 이 저장소가 이미 쓰는 규칙이다: `render/phone.ts` 의 폰 화면, `station.ts` 의
       * 광고판·사인, `decals.ts`, `guide-arrows.ts` 가 전부 `toneMapped: false` 다.
       * 창밖만 빠져 있었다.
       *
       * ★ `color` 배율(한때 1.3)은 **뺐다.** 어두운 실내 대비 밝은 바깥을 만들려던
       *   것이었는데, 이미 밝은 일출에 곱하니 ACES 어깨로 밀려 하얗게 탈색됐다.
       *   톤매핑을 끄면 노출차는 저절로 생긴다 — 객실은 ACES·0.88 을 지나 눌리고
       *   창밖은 원본 그대로 나오므로, 곱하지 않아도 창이 더 밝다.
       */
      toneMapped: false,
    }),
  )
  // 창밖은 조명을 안 받는다 — 바깥은 우리 역의 형광등과 무관하다(`MeshBasicMaterial`)
  return m
}

export const buildEndingStage = (): EndingStage => {
  const root = new Group()
  root.name = 'ending-stage'
  root.visible = false


  /**
   * 뒤(풍경) → 앞(터널) 두 장. 터널이 걷히면 뒤가 드러난다.
   * 뒤에 무엇이 오는지는 `wrong` 이 정한다 — 성공이면 일출, 반대 방면이면 지옥.
   */
  const back = panel(GLASS_W, GLASS_H, dawnTex, 1)
  back.position.set(0, GLASS_Z, -GLASS_Y - 0.02)
  root.add(back)

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

  /**
   * ★ **빛 번짐** — 창이 밝고 객실이 어두우면 그 경계에서 빛이 샌다.
   *
   * 후처리 블룸이 할 일을 가산 판 한 장으로 대신한다(`render/glow.ts` 와 같은 선택).
   * 창보다 세로로 1.9 배 크게 깔아 창틀 위아래로 번지게 한다 — 이 번짐이 있어야
   * "창이 실내보다 훨씬 밝다"가 눈에 읽히고, 그게 노출차의 마무리다.
   */
  const bleed = new Mesh(
    new PlaneGeometry(GLASS_W * 0.98, GLASS_H * 1.9),
    new MeshBasicMaterial({
      map: falloffTex, transparent: true, opacity: 0, depthWrite: false,
      blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    }),
  )
  bleed.position.set(0, GLASS_Z, -GLASS_Y + 0.04)
  root.add(bleed)

  /**
   * 유리 반사 — 비스듬한 띠 하나. **이것 하나로 창이 유리가 된다.**
   * 아주 약하게(0.16) 얹는다. 세게 주면 그림을 덮어 오히려 포스터로 돌아간다.
   */
  const sheen = new Mesh(
    new PlaneGeometry(GLASS_W, GLASS_H),
    new MeshBasicMaterial({
      map: sheenTex, transparent: true, opacity: 0, depthWrite: false,
      blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    }),
  )
  sheen.position.set(0, GLASS_Z, -GLASS_Y + 0.05)
  root.add(sheen)

  /**
   * 불티 — WRONG WAY 전용. **24 장이면 충분하다.**
   *
   * 파티클 시스템을 안 만든다. 위치를 시간의 함수로 매 프레임 다시 쓰는 `Points`
   * 하나면 되고(드로우 콜 1), 그래서 정리할 상태도 없다 — 무대가 꺼지면 같이 꺼진다.
   */
  const EMBERS = 24
  const emberPos = new Float32Array(EMBERS * 3)
  const emberGeo = new BufferGeometry()
  emberGeo.setAttribute('position', new BufferAttribute(emberPos, 3))
  const embers = new Points(
    emberGeo,
    new PointsMaterial({
      map: falloffTex, size: 0.13, transparent: true, opacity: 0, depthWrite: false,
      blending: AdditiveBlending, toneMapped: false, color: new Color(0xff7a2a),
      sizeAttenuation: true,
    }),
  )
  embers.frustumCulled = false
  root.add(embers)

  /**
   * ★ **창밖 빛을 객실 안으로 들여보낸다. 이 컷에서 가장 중요한 물건이다.**
   *
   * 창밖 판은 `MeshBasicMaterial`(unlit)이라 아무리 밝게 그려도 **빛이 0** 이다.
   * 그래서 배경만 바꿨을 때 "창에 붙인 사진"으로 보였다 — 배경과 인물이 같은 공간에
   * 있다는 증거가 화면에 없었기 때문이다. 레퍼런스 이미지에서 감동을 만드는 것의
   * 절반은 하늘이 아니라 **인물 뒷목과 어깨에 걸린 역광**이다.
   *
   * 객실 재질은 `MeshToonMaterial`(`render/toon.ts`)이라 광원에 반응한다. 창 바깥에
   * 광원 하나를 두고 컷과 함께 강도를 올리면, 좌석·손잡이봉·주인공이 **같이** 물든다.
   *
   * ⚠ `scene.ts setMood` 가 쥔 5개 광원은 손대지 않는다 — 그쪽은 매 프레임 존 기준으로
   *   자기 값을 되돌리므로 여기서 만지면 싸움이 난다. 이 광원은 무대 소유다.
   */
  const sunLight = new DirectionalLight(0xffb066, 0)
  sunLight.position.set(0, GLASS_Z + 0.4, -GLASS_Y - 4)
  sunLight.target.position.set(0, FLOOR.B2 + 1.0, -(TRAIN.bodyYMin + 0.4))
  root.add(sunLight)
  root.add(sunLight.target)

  /**
   * 지옥은 **아래에서** 비친다. 용암이 바닥에 있으니 당연한데, 이 방향 하나가
   * "붉은 필터"와 "붉은 공간"을 가른다 — 위에서 붉게 비추면 그냥 조명색이다.
   */
  const lavaLight = new PointLight(0xff3b12, 0, 26, 1.4)
  lavaLight.position.set(0, FLOOR.B2 + 0.35, -GLASS_Y + 0.6)
  root.add(lavaLight)

  const bleedMat = bleed.material as MeshBasicMaterial
  const sheenMat = sheen.material as MeshBasicMaterial
  const emberMat = embers.material as PointsMaterial
  const ledMat = led.material as MeshBasicMaterial
  const backMat = back.material as MeshBasicMaterial
  const tunnelMat = tunnel.material as MeshBasicMaterial

  return {
    root,
    setVisible(on) {
      root.visible = on
      if (on) return
      // 꺼질 때 광원도 확실히 끈다 — 다시하기 뒤 역이 주황색으로 물들면 안 된다
      sunLight.intensity = 0
      lavaLight.intensity = 0
    },
    sync({ x, yOff, tunnel: tunnelK, scroll, led: ledK, wrong, glow, flash }) {
      root.position.x = x
      // 월드 y 는 three z 로 부호가 뒤집혀 들어간다(`train-rig.ts` 와 같은 규약)
      root.position.z = -yOff
      tunnelMat.opacity = tunnelK
      ledMat.opacity = ledK

      const wantLed = wrong ? ledWrong : ledOk
      if (ledMat.map !== wantLed) { ledMat.map = wantLed; ledMat.needsUpdate = true }
      const wantBack = wrong ? hellTex : dawnTex
      if (backMat.map !== wantBack) { backMat.map = wantBack; backMat.needsUpdate = true }

      // 빛은 창밖이 드러난 만큼만 들어온다 — 터널이 걷히는 곡선과 같이 움직인다
      sunLight.intensity = wrong ? 0 : glow * 1.15
      /**
       * 툰 재질은 3단 램프라 일정 밝기를 넘으면 전부 최상단 계단으로 붙는다 —
       * **세게 줄수록 붉어지는 게 아니라 평평해진다.** 2.4 → 1.7 → 1.15 로 두 번
       * 내렸다. 1.7 에서도 인물이 하얗게 떠서 형태가 죽었다(실측). 붉은 공간감은
       * 광원이 아니라 **창밖 그림과 바닥 반사**가 이미 충분히 만들고 있고,
       * 광원이 할 일은 "그 빛이 여기까지 닿는다"를 보이는 것까지다.
       */
      lavaLight.intensity = wrong ? glow * 1.15 * flash : 0

      /**
       * 창밖이 흐르는 방향은 **진행의 반대**다. 열차가 +x 로 가면 바깥은 −x 로 흐른다.
       * 터널이 풍경보다 빨리 흐른다 — 가까운 것이 빨리 지나가는 그 차이가 거리감이다.
       */
      /**
       * 빛 번짐·유리·불티 — 전부 `glow` 에 매인다. 창밖이 안 드러났으면 0 이라,
       * 터널 구간에서는 아무것도 안 그린다(가산 판이 검은 화면을 들추지 않는다).
       */
      const warm = wrong ? 0xff4a14 : 0xffb066
      if (bleedMat.color.getHex() !== warm) bleedMat.color.setHex(warm)
      bleedMat.opacity = glow * (wrong ? 0.5 : 0.34) * flash
      // 유리 반사는 **창이 밝을 때만** 보인다. 어두운 터널에 반사가 있으면 이상하다
      sheenMat.opacity = glow * 0.16
      sheenTex.offset.x = scroll * 0.06

      if (wrong) {
        /**
         * 불티는 **아래에서 위로** 흐른다(용암이 바닥에 있다). 각 알갱이가 자기
         * 주기를 갖도록 인덱스로 위상을 흩고, 위로 갈수록 옆으로도 흔들린다.
         */
        for (let i = 0; i < EMBERS; i++) {
          const seed = i * 12.9898
          const life = ((scroll * 0.42 + (seed % 1)) % 1)
          emberPos[i * 3] = ((seed * 7.13) % 9) - 4.5 + Math.sin(life * 6 + i) * 0.25
          emberPos[i * 3 + 1] = GLASS_Z0 - 0.15 + life * (GLASS_H + 0.9)
          emberPos[i * 3 + 2] = -GLASS_Y + 0.12 + ((seed * 3.7) % 0.35)
        }
        emberGeo.attributes.position!.needsUpdate = true
        // 위로 갈수록 사그라든다 — 끝까지 밝으면 벌레처럼 보인다
        emberMat.opacity = glow * 0.75
      } else {
        emberMat.opacity = 0
      }

      tunnelTex.offset.x = scroll * 0.11
      /**
       * 풍경 속도. 0.018/0.022 였을 때 컷 내내 그림의 8% 밖에 안 흘러 **멈춘 것처럼**
       * 보였다. 0.030/0.040 이면 13~17% — 흐르는 게 눈에 잡히면서도, 한 장이 안 끝난다
       * (끝이 화면에 들어오는 한계는 offset 0.24 다. 시야 우단 +3.1m 와 판 끝 +6m 의 차).
       * 지옥이 33% 빠르다 — 같은 열차인데 더 급해 보이는 것이 이 엔딩의 불안이다.
       */
      dawnTex.offset.x = scroll * 0.030
      hellTex.offset.x = scroll * 0.040
    },
  }
}
