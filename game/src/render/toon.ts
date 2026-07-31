/**
 * 툰 셰이딩 + 아웃라인.
 *
 * GDD §7.3 — "플랫 벡터 + 두꺼운 아웃라인, 한국 웹툰 톤".
 * 3D지만 PBR을 쓰지 않는다. 3단 그라디언트 램프로 명암을 계단식으로 끊는다.
 */

import {
  BackSide, Color, DataTexture, DoubleSide, MeshBasicMaterial, MeshToonMaterial,
  NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType, type Material,
} from 'three'

/** 3단 램프 — 4×1 텍스처. NearestFilter로 계단을 살린다. */
export const makeToonRamp = (): DataTexture => {
  const data = new Uint8Array([88, 150, 214, 255])
  const tex = new DataTexture(data, data.length, 1, RedFormat, UnsignedByteType)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

const RAMP = makeToonRamp()

const cache = new Map<string, MeshToonMaterial>()

export const toonMat = (color: number, opts: { transparent?: boolean; opacity?: number; side?: 'double' } = {}): MeshToonMaterial => {
  const k = `${color}|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}|${opts.side ?? ''}`
  const hit = cache.get(k)
  if (hit) return hit
  const m = new MeshToonMaterial({
    color: new Color(color),
    gradientMap: RAMP,
    ...(opts.transparent ? { transparent: true, opacity: opts.opacity ?? 0.5 } : {}),
    ...(opts.side === 'double' ? { side: DoubleSide } : {}),
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
