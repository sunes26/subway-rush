/**
 * 툰 셰이딩 + 아웃라인.
 *
 * GDD §7.3 — "플랫 벡터 + 두꺼운 아웃라인, 한국 웹툰 톤".
 * 3D지만 PBR을 쓰지 않는다. 3단 그라디언트 램프로 명암을 계단식으로 끊는다.
 */

import {
  BackSide, Color, DataTexture, DoubleSide, MeshBasicMaterial, MeshToonMaterial,
  NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType,
  type Material, type Texture,
} from 'three'

/**
 * 3단 램프 — 4×1 텍스처. NearestFilter로 계단을 살린다.
 *
 * 최저 단계는 88(0.35)이었다. 그 값이면 광원 반대쪽 면이 베이스 컬러의 35 %까지
 * 떨어져, 계단 핸드레일처럼 **가는 부재의 옆면이 거의 검게** 나온다.
 * 계단을 아래에서 올려다보면 오른쪽 난간만 검은 막대로 보여 "공중에 뭔가 떠 있다"로
 * 읽혔다 — 실측해 보니 지오메트리는 좌우 대칭이었고 명암만 그랬다.
 * 실사 지하철 사진에서 실내 음영은 이만큼 죽지 않는다. 최저·중간을 올려 대비를 낮춘다.
 */
export const makeToonRamp = (): DataTexture => {
  const data = new Uint8Array([124, 172, 218, 255])
  const tex = new DataTexture(data, data.length, 1, RedFormat, UnsignedByteType)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

const RAMP = makeToonRamp()

const cache = new Map<string, MeshToonMaterial>()

export type ToonOpts = {
  transparent?: boolean
  opacity?: number
  side?: 'double'
  /**
   * 깊이 층 — 클수록 앞. 0 이면 오프셋을 아예 안 건다.
   *
   * 이 씬에는 **완전히 겹친 면**이 많다(줄눈·점자블록·노선띠 같은 데칼뿐 아니라
   * 인도 슬래브 절단면 ↔ 계단실 옆벽처럼 구조체끼리도 겹친다).
   * 겹친 면은 깊이 버퍼가 못 가른다 — 삼각 분할이 서로 달라 픽셀마다 ULP 단위로
   * 깊이가 갈리고, 카메라가 움직이면 그 얼룩이 프레임마다 뒤집혀 **점멸한다.**
   * 층을 다르게 주면 폴리곤 오프셋이 그 동률을 깨서 앞뒤가 고정된다.
   * 어느 층에 무엇이 들어가는지는 `render/station.ts` 의 `DEPTH_LAYER` 가 정한다.
   */
  depthLayer?: number
  /**
   * Blender 에서 구운 라이트맵 아틀라스 (존당 한 장).
   *
   * 게임에는 그림자도 GI 도 없다 — 툰 셰이딩은 면 법선만 보고 밝기 단계를 정하므로
   * 조명 웅덩이도, 구석 어두움도, 물체가 바닥에 닿는 느낌도 나오지 않는다.
   * 그 셋을 오프라인에서 구워 곱한다. 런타임 비용은 텍스처 샘플 한 번뿐이다.
   *
   * `MeshToonMaterial` 이 이미 `lightMap` 을 지원하므로 GLSL 은 손대지 않는다.
   */
  lightMap?: Texture | null
}

/**
 * 라이트맵 강도.
 *
 * three 의 툰 경로는 `irradiance += lightMapTexel × intensity` 뒤에
 * `RE_IndirectDiffuse_Toon` 이 `BRDF_Lambert`(= 1/π)를 곱한다.
 * 그래서 **π 를 넣어야 텍셀 1.0 이 베이스 컬러 1.0 배**가 된다.
 * 1.0 을 넣으면 전체가 1/π(약 32 %)로 어두워진다.
 */
export const LIGHTMAP_INTENSITY = Math.PI

/**
 * 깊이 층 → 폴리곤 오프셋.
 *
 * 값은 **작게** 둔다. 겹친 면을 가르는 데 필요한 건 크기가 아니라 서로 다름이고
 * (1 단위면 래스터라이저의 ULP 잡음보다 충분히 크다), 넓히면 멀리 있는 얇은 사인이
 * 벽 뒤로 밀린다 — near 0.08 · far 260 에서 1 단위는 40 m 지점에서 약 1.2 mm 다.
 */
export const depthOffset = (layer: number): Partial<{
  polygonOffset: boolean; polygonOffsetFactor: number; polygonOffsetUnits: number
}> => (layer === 0
  ? {}
  : { polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer })

export const toonMat = (color: number, opts: ToonOpts = {}): MeshToonMaterial => {
  // ⚠ 캐시 키에 라이트맵을 반드시 넣는다. 색만으로 키를 만들면 존들이 같은 인스턴스를
  //   공유해 **마지막으로 로드된 존의 아틀라스가 전 존에 적용된다.**
  const k = `${color}|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}|${opts.side ?? ''}`
    + `|${opts.depthLayer ?? 0}|${opts.lightMap?.uuid ?? ''}`
  const hit = cache.get(k)
  if (hit) return hit
  const m = new MeshToonMaterial({
    color: new Color(color),
    gradientMap: RAMP,
    ...(opts.transparent ? { transparent: true, opacity: opts.opacity ?? 0.5 } : {}),
    ...(opts.side === 'double' ? { side: DoubleSide } : {}),
    ...depthOffset(opts.depthLayer ?? 0),
    ...(opts.lightMap
      ? { lightMap: opts.lightMap, lightMapIntensity: LIGHTMAP_INTENSITY }
      : {}),
  })
  cache.set(k, m)
  return m
}

/** 발광 표시등 (게이트 램프 · LED). 조명 영향 없이 순색으로 튀어야 정보가 읽힌다. */
export const emissiveMat = (color: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: new Color(color), toneMapped: false })

/**
 * 아웃라인 — 후면 폴리곤 확장.
 * 동일 지오메트리를 BackSide로 한 번 더 그리되 정점을 법선 방향으로 밀어낸다.
 * 포스트프로세싱 대비: 패스 추가 0, 해상도 독립, 인스턴싱과 그대로 호환.
 */
export const outlineMat = (thickness = 0.045, ink = 0x0b0b0a): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uInk: { value: new Color(ink) } },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() {
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // 거리에 비례해 두께를 키워 화면상 굵기를 균일하게 유지
        mv.xyz += n * uThickness * (-mv.z) * 0.06;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() { gl_FragColor = vec4(uInk, 1.0); }`,
    side: BackSide,
    depthWrite: true,
  })

export const disposeMaterial = (m: Material | Material[]): void => {
  if (Array.isArray(m)) m.forEach((x) => x.dispose())
  else m.dispose()
}
