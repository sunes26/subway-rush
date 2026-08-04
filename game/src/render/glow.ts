/**
 * 발광면 글로우 — **후처리 없이** 그리는 빛 번짐.
 *
 * ── 왜 EffectComposer 블룸이 아닌가 (전부 이 저장소에서 실측한 근거다)
 *
 * 1. 광도 임계값으로 발광면을 고를 수 없다.
 *    GLB baseColorFactor(선형)를 재 보면 자체발광 AD_PANEL 0.274 · CHG_SCR 0.265 인데
 *    발광이 **아닌** 벽 SIGN_PLATE 0.968 · MAP_FACE 0.968 · PF_WALL 0.929 다.
 *    거기에 광원 5개(합산 강도 1.2 초과)가 얹히므로 HDR 버퍼에서 가장 밝은 것은
 *    사인이 아니라 **흰 벽**이다. 광고판을 살리는 임계값은 역사 전체를 번지게 한다 —
 *    "180초 안에 안내 사인을 읽는 게임"에서 그건 기능 상실이다.
 *
 * 2. 선택적(레이어) 블룸은 이 씬에서 가림 처리가 성립하지 않는다.
 *    발광면은 존 단위로 머티리얼별 병합돼 있어(`merged:AD_PANEL` 하나가 Z2 전체)
 *    발광 레이어만 따로 그리면 **벽 뒤 광고판이 벽을 통과해 빛난다.**
 *    막으려면 본 패스의 깊이를 발광 패스와 공유해야 하는데, 본 패스가 캔버스 직행이면
 *    기본 프레임버퍼의 깊이 버퍼를 FBO 에 붙일 수 없다(WebGL 제약).
 *
 * 3. 본 패스를 렌더타깃으로 옮기면 사인 색이 변한다.
 *    three 는 `currentRenderTarget === null` 일 때만 톤매핑을 적용한다. 컴포저를 넣는 순간
 *    `toneMapped:false` 가 무효가 되고 합성 단계에서 ACES 를 화면 전체에 다시 먹인다.
 *    station.ts 의 `emissiveOf` 주석에 "초록으로 칠한 사인이 살구색으로 나왔다"는
 *    같은 사고가 이미 기록돼 있다. 게이트 색은 이 게임의 유일한 판단 근거다.
 *    알파 채널에 마스크를 심어 선택적으로 톤매핑하는 우회도 막혀 있다 —
 *    three 는 불투명 머티리얼에 `#define OPAQUE` 를 걸고 `diffuseColor.a = 1.0` 으로
 *    **덮어쓴다**(three.module.js 의 `opaque_fragment`). 마스크가 살아남지 못한다.
 *
 * ── 그래서 지오메트리로 푼다
 *
 * 발광 부품마다 그 부품을 감싸는 **소프트 폴오프 판**을 한 장 깔고 가산 블렌딩으로 더한다.
 * toon.ts 의 아웃라인이 후처리 대신 후면 폴리곤 확장을 쓴 것과 같은 선택이고
 * ("포스트프로세싱 대비: 패스 추가 0"), 이 씬에서는 얻는 게 더 많다.
 *   · 톤매핑 경로가 그대로다 → 사인 색이 한 픽셀도 안 변한다
 *   · 캔버스 MSAA(scene.ts 의 `antialias:true`)가 그대로다 → 얇은 글자에 계단이 안 생긴다
 *   · 깊이 테스트가 진짜 씬을 상대로 걸린다 → 벽 뒤 광고판이 벽을 통과해 빛나지 않는다
 *   · Reflector 의 virtualCamera 패스에도 그대로 잡힌다 → 거울에도 빛이 비친다
 *   · 맵 전체를 한 덩어리로 병합하므로 **드로우 콜은 총 3개**(정적 · 천장 · 동적)
 */

import {
  AdditiveBlending, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh,
  ShaderMaterial, Vector3,
} from 'three'

/**
 * 발광 판 하나.
 *
 * ⚠ 판은 **자기가 놓인 두 축을 직접 들고 있는다.** 법선 축 하나만 저장하고
 * 굽는 쪽에서 나머지 두 축을 되유추하면 안 된다 — 실제로 그렇게 짰다가
 * 천장 조명이 세로인데 번짐만 가로로 나왔다.
 *
 * 원인: 판을 만드는 쪽은 두 축을 **길이 순**(짧은 축 → 긴 축)으로 골라 `w`·`h` 를 매기는데,
 * 굽는 쪽은 축 번호 오름차순 표로 되유추했다. 둘의 순서가 반대인 경우
 * (천장 조명 5.6×0.06×0.28 은 `[2,0]` vs `[0,2]`) `w`·`h` 가 서로 바뀌어 판이 90° 돈다.
 * 실측: 조명 실체는 x 0.6~55.4 · z 0.28 인데 판은 x 0.59 · z 5.79 로 나왔다.
 */
export type GlowQuad = Readonly<{
  cx: number; cy: number; cz: number
  /** 판이 놓인 두 월드 축(0=x, 1=y, 2=z). `w`가 `ua`, `h`가 `va` 방향이다. 법선은 남은 축. */
  ua: 0 | 1 | 2; va: 0 | 1 | 2
  w: number; h: number
  /** 선형 RGB (이미 gain 이 곱해진 값) */
  r: number; g: number; b: number
}>

/**
 * 머티리얼별 발광 강도.
 *
 * 기준은 측정된 baseColorFactor(선형)다 — 광고판이 조명기구보다 3배 어둡기 때문에
 * 같은 계수를 쓰면 광고판은 블러해도 안 빛나고 조명은 타 버린다.
 *   VM_LIGHT 0.997 · FIXTURE 0.980 · LED_AMBER 0.663 · ESC_COMB 0.640 · SH_GREEN 0.448
 *   AD_PANEL3 0.410 · AD_PANEL2 0.379 · SH_RED 0.325 · AD_PANEL 0.274 · CHG_SCR 0.265
 * 어두운 쪽을 올려 **화면에서의 발광량을 비슷하게** 맞춘다.
 */
export const GLOW_GAIN: Readonly<Record<string, number>> = {
  FIXTURE: 0.85,
  VM_LIGHT: 0.80,
  ESC_COMB: 0.55,
  LED_AMBER: 1.05,
  SH_GREEN: 1.25,
  SH_RED: 1.35,
  AD_PANEL: 1.90,
  AD_PANEL2: 1.55,
  AD_PANEL3: 1.45,
  CHG_SCR: 1.90,
}

/**
 * 글로우를 만들지 **않는** 자체발광 머티리얼.
 *
 * `TXT_WHITE` 는 사인 글자다. 두 가지 이유로 뺀다.
 *  1. 글자 획마다 섬이 하나씩 나와 판이 수백 장이 된다 (Z2 만 정점 14,806개).
 *  2. 흰 글자 둘레에 가산광을 깔면 획 사이가 메워져 **읽기 어려워진다.**
 *     이 게임에서 사인 가독성은 룩보다 우선이다.
 */
export const GLOW_EXCLUDE = new Set([
  'TXT_WHITE',
  // 가로 상가 간판. 발광이지만 **판이 크고 가로로 길다** — 글로우를 붙이면
  // 건물 저층부 전체가 흐릿하게 번져 초점이 안 맞은 것처럼 보인다(디렉터 지적).
  // 조명기구처럼 작고 밝은 것에만 글로우가 값을 한다.
  'BLD_SIGN_0', 'BLD_SIGN_1', 'BLD_SIGN_2', 'BLD_SIGN_3', 'BLD_SIGN_4',
])

// ─────────────────────────── 판 만들기 ───────────────────────────

const size = new Vector3()
const center = new Vector3()

/** 판의 여백(halo) — 부품 크기에 비례하되 위아래로 묶는다. */
const padOf = (minDim: number): number => Math.min(0.5, Math.max(0.09, minDim * 0.55))

/** 판 한 장이 덮는 최대 길이(m). 이보다 길면 토막 낸다 — 위 `push` 주석 참고. */
const SEG_MAX = 6

/**
 * 섬 하나의 AABB 를 글로우 판으로 바꾼다.
 *
 * 판의 방향은 **가장 얇은 축**을 법선으로 잡는다. 광고판(1.75×1.35×0.05)은 벽면 판이 되고
 * 천장 조명 상자(5.60×0.06×0.50)는 아래를 보는 가로 판이 된다 — 둘 다 원하는 결과다.
 * 단면이 거의 정사각인 **막대**(상가 사인 지주 0.04×0.80×0.04)는 한 방향 판만 두면
 * 옆에서 볼 때 사라지므로 직교 판을 하나 더 준다.
 */
const quadsFromBox = (box: Box3, r: number, g: number, b: number, out: GlowQuad[]): void => {
  box.getSize(size)
  box.getCenter(center)
  const d = [size.x, size.y, size.z] as const
  const ord = ([0, 1, 2] as const).slice().sort((p, q) => (d[p] as number) - (d[q] as number))
  const [sml, mid, big] = ord as unknown as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]
  const dSml = d[sml] as number
  const dMid = d[mid] as number
  const dBig = d[big] as number

  // 판때기 거부: 두 변이 모두 6 m 를 넘으면 부품이 아니라 잘못 뭉친 덩어리다.
  // (Z2 SH_RED 37.6×29.8 · Z4 FIXTURE 24×14 가 실제로 이렇게 들어온다.)
  if (dMid > 6 && dBig > 6) return
  // 부스러기와 두꺼운 고체는 발광판이 아니다
  if (dBig < 0.05) return
  if (dSml > 1.5) return

  /**
   * 판 하나를 낸다. 단, **긴 띠는 토막 낸다.**
   *
   * 천장 코브나 라인 조명은 존 전체를 잇는 한 덩어리라 판이 40 m 짜리 한 장이 된다.
   * 그러면 두 가지가 깨진다 —
   *  · 판 하나가 존을 가로질러 **바닥 개구부 위에도 걸린다**
   *    (지상 계단에서 아래층 조명이 흰 띠로 보이던 원인이 이것이다)
   *  · 소프트 폴오프가 40 m 에 한 번만 적용돼 빛이 길이 방향으로 안 잦아든다
   */
  const push = (ua: 0 | 1 | 2, va: 0 | 1 | 2): void => {
    const du = d[ua] as number
    const dv = d[va] as number
    const pad = padOf(Math.min(du, dv))
    const c = [center.x, center.y, center.z] as [number, number, number]
    const long = Math.max(du, dv)
    const segs = long > SEG_MAX ? Math.ceil(long / SEG_MAX) : 1
    const segAxis = du >= dv ? ua : va
    const segLen = long / segs
    for (let i = 0; i < segs; i++) {
      const p = c.slice() as [number, number, number]
      if (segs > 1) p[segAxis] = c[segAxis] - long / 2 + segLen * (i + 0.5)
      if (inNoGlow(p[0], p[1], p[2])) continue
      const w = du >= dv && segs > 1 ? segLen : du
      const h = dv > du && segs > 1 ? segLen : dv
      out.push({
        cx: p[0], cy: p[1], cz: p[2],
        ua, va, w: w + pad * 2, h: h + pad * 2, r, g, b,
      })
    }
  }

  // 가장 얇은 축(sml)이 법선 — 판은 나머지 두 축 위에 눕는다
  push(mid, big)

  // 막대 판정: 단면이 얇고(15 cm 미만) 거의 정사각일 때만. 얇은 **띠**(LED 1.65×0.14×0)는
  // 여기 걸리면 벽에서 수직으로 튀어나온 판이 생기므로 단면비 조건으로 걸러낸다.
  const isRod = dMid < 0.15 && dMid <= dBig * 0.18 && dSml >= dMid * 0.35
  // 직교 판 — 이번엔 mid 가 법선이므로 판은 sml·big 위에 눕는다
  if (isRod) push(sml, big)
}

/**
 * 글로우를 만들지 않는 **공간**.
 *
 * 바닥 개구부(지상 → 대합실 계단) 위에서는 아래층 천장 조명이 평소에 없는 각도로
 * 시야에 들어온다. 조명 자체는 개구부에서 한 뼘 물러나 있는데(`hq_fixups.py`),
 * 글로우 판은 소프트 폴오프라 그보다 넓게 퍼져 **계단 한가운데 흰 띠**로 보였다.
 *
 * 지오메트리를 더 자르면 대합실 쪽 조명이 끊긴다. 그래서 **판만** 뺀다 —
 * 대합실 안에서 보는 조명은 그대로고, 계단에서 내려다볼 때만 사라진다.
 *
 * 좌표는 `Z2_ceiling` 의 계단 구멍(x 2.0~14.9 · y 25.4~30.0)에 여유를 더한 값이다.
 */
const NO_GLOW: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.6, 24.4, 16.3, 31.0, -4.2, -1.8],
]

const inNoGlow = (x: number, y: number, z: number): boolean =>
  NO_GLOW.some(([x0, y0, x1, y1, z0, z1]) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1)

/** 섬 목록 → 판 목록. 머티리얼 색(hex)과 강도를 받아 선형 RGB 를 미리 곱해 둔다. */
export const glowQuadsFrom = (
  boxes: readonly Box3[], colorHex: number, gain: number, out: GlowQuad[],
): void => {
  const c = new Color(colorHex).multiplyScalar(gain)
  for (const box of boxes) quadsFromBox(box, c.r, c.g, c.b, out)
}

// ─────────────────────────── 머티리얼 ───────────────────────────

/**
 * 가산 글로우 머티리얼.
 *
 * `transparent:true` 가 필수다 — three 는 불투명 머티리얼에 `NoBlending` 을 걸어
 * 가산 블렌딩을 무시한다. `depthWrite:false` 로 서로를 가리지 않게 하고,
 * `depthTest:true` 는 그대로 둬서 **벽 뒤 발광이 벽을 통과하지 않게** 한다.
 */
const glowMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uStrength: { value: 0.62 },
      // 존 그룹은 95 m 밖에서 통째로 꺼진다(station.ts VISIBLE_RANGE).
      // 벽이 사라지면 깊이도 사라져 글로우만 허공에 남으므로 **그 안쪽에서** 완전히 없앤다.
      uFadeNear: { value: 42 },
      uFadeFar: { value: 78 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aGlow;
      uniform float uFadeNear;
      uniform float uFadeFar;
      varying vec2 vUv;
      varying vec3 vGlow;
      varying float vFade;
      void main() {
        vUv = uv;
        vGlow = aGlow;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec2 vUv;
      varying vec3 vGlow;
      varying float vFade;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        // 곱 폴오프 — 중심에서 1, 판 가장자리에서 0. 긴 판에서는 자연스럽게 길쭉해진다.
        float a = (1.0 - p.x * p.x) * (1.0 - p.y * p.y);
        a = pow(max(a, 0.0), 1.4) * vFade * uStrength;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(vGlow, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    /**
     * 판을 깊이만 살짝 앞으로 당긴다.
     *
     * 판의 중심은 감싸는 부품 AABB 의 중심이라, 두께 0인 부품(벽에 붙은 LED 띠·광고면)
     * 에서는 판이 그 면과 **정확히 같은 평면**에 놓인다. 가산 블렌딩이라 깊이를 쓰지는
     * 않지만 깊이 **테스트**는 하므로, 동률 구간에서 픽셀마다 통과/탈락이 갈려
     * 얼룩이 지고 카메라가 움직이면 그게 깜빡임이 된다.
     * 실측: 계단 중간 시점에서 글로우만 꺼도 뒤집히는 픽셀이 43,881 → 18,045 로 떨어졌다.
     *
     * 깊이를 안 쓰니 당겨도 잃는 게 없고, 4 단위는 30 m 에서 2.7 mm 라
     * "벽 뒤 발광이 벽을 통과하지 않는다"는 성질도 그대로다.
     */
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: DoubleSide,
    fog: false,
  })

// ─────────────────────────── 메시 만들기 ───────────────────────────

const UV = [0, 0, 1, 0, 0, 1, 1, 1] as const
const TRI = [0, 2, 1, 2, 3, 1] as const

/**
 * 판 목록을 **하나의** 메시로 굽는다. 존별로 나누지 않는 이유는 드로우 콜이다 —
 * 존 단위로 두면 시야에 잡히는 존 수만큼 콜이 붙는데, 이 맵은 Z2 지점에서 이미
 * 215콜(예산 230)이라 여유가 없다. 거리 페이드가 컬링 역할을 대신한다.
 */
export const buildGlowMesh = (quads: readonly GlowQuad[], name: string): Mesh | null => {
  if (quads.length === 0) return null
  const n = quads.length
  const pos = new Float32Array(n * 4 * 3)
  const uv = new Float32Array(n * 4 * 2)
  const col = new Float32Array(n * 4 * 3)
  const idx = new Uint32Array(n * 6)

  quads.forEach((q, i) => {
    // 판이 들고 온 축을 그대로 쓴다 — 되유추하지 않는다(위 GlowQuad 주석 참고)
    const { ua, va } = q
    const c = [q.cx, q.cy, q.cz]
    for (let k = 0; k < 4; k++) {
      const su = (UV[k * 2] as number) - 0.5
      const sv = (UV[k * 2 + 1] as number) - 0.5
      const o = (i * 4 + k) * 3
      pos[o] = c[0] as number
      pos[o + 1] = c[1] as number
      pos[o + 2] = c[2] as number
      pos[o + ua] = (c[ua] as number) + su * q.w
      pos[o + va] = (c[va] as number) + sv * q.h
      uv[(i * 4 + k) * 2] = UV[k * 2] as number
      uv[(i * 4 + k) * 2 + 1] = UV[k * 2 + 1] as number
      col[o] = q.r
      col[o + 1] = q.g
      col[o + 2] = q.b
    }
    for (let k = 0; k < 6; k++) idx[i * 6 + k] = i * 4 + (TRI[k] as number)
  })

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setAttribute('aGlow', new BufferAttribute(col, 3))
  geo.setIndex(new BufferAttribute(idx, 1))
  geo.computeBoundingSphere()

  const mesh = new Mesh(geo, glowMaterial())
  mesh.name = `glow:${name}`
  // 유리(renderOrder 2)보다 **먼저** 그린다. 안전문 너머 발광은 유리를 통해 비쳐야 맞다.
  mesh.renderOrder = 1
  // 맵 전체를 덮는 바운딩이라 프러스텀 컬링이 걸릴 일이 없다 — 계산만 낭비다
  mesh.frustumCulled = false
  return mesh
}

/**
 * 색이 매 프레임 바뀌는 글로우(게이트 사인 · 바닥램프 · 신호등)용.
 * 판 인덱스로 색만 갈아끼운다 — 지오메트리는 그대로다.
 */
export type DynamicGlow = Readonly<{
  mesh: Mesh
  setColor(quadIndex: number, color: Color): void
  flush(): void
}>

export const buildDynamicGlow = (quads: readonly GlowQuad[], name: string): DynamicGlow | null => {
  const mesh = buildGlowMesh(quads, name)
  if (!mesh) return null
  const attr = mesh.geometry.getAttribute('aGlow') as BufferAttribute
  return {
    mesh,
    setColor(quadIndex, color) {
      const base = quadIndex * 4
      for (let k = 0; k < 4; k++) attr.setXYZ(base + k, color.r, color.g, color.b)
    },
    flush() { attr.needsUpdate = true },
  }
}
