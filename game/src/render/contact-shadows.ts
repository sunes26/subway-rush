/**
 * 접촉 그림자 — 바닥에 닿는 부품의 밑동을 어둡게 깔아 물체를 **바닥에 붙인다.**
 *
 * ── 왜 런타임 AO(SSAO/GTAO/SAO)가 아닌가
 * three 0.180 에 패스는 들어 있지만 이 씬에는 세 가지가 걸린다.
 *  1. 합성이 **머티리얼 마스크가 없는 전체 화면 곱셈**이다. `TXT_WHITE`·`AD_PANEL`·`FIXTURE`
 *     같은 자체발광 사인이 같이 어두워진다 — 발광 띠 위 흰 글자를 회색으로 만들지 않으려고
 *     일부러 `toneMapped:false` basic 으로 그리는 건데 AO 가 그걸 되돌린다.
 *  2. 노멀 G버퍼를 위해 `scene.overrideMaterial` 로 **씬을 한 번 더 그린다.**
 *     최악 지점 Z2 가 215콜/394k → 약 430콜/788k 가 되어 perf.spec 예산(230/42만)이 즉시 깨진다.
 *  3. `overrideMaterial` 은 `transparent` 를 버리므로 안전문 유리가 불투명 깊이를 써
 *     그 너머 열차에 AO 가 얹힌다. 안전문 너머를 보는 건 이 게임에서 정보다.
 *
 * ── 왜 정점 색 베이크가 아닌가
 * 건축 표면(바닥 13,806 + 벽 12,577 + 천장 14,171 = 40,555 m²)의 정점이 2,236개,
 * 밀도 0.055/m² 다. 0.3 m 짜리 접촉 그림자가 읽히려면 0.25 m 격자 세분이 필요한데
 * 그건 삼각형 130만 — 현재 씬 전체(42.5만)의 3배다. 게다가 일부에만 COLOR_0 를 구우면
 * `mergeGeometries` 가 애트리뷰트 집합 불일치로 **null 을 반환**하고
 * station.ts 의 `if (!merged) continue` 가 그 머티리얼 버킷을 통째로 지운다.
 *
 * ── 그래서 데칼이다
 * 부품의 접지 발자국만큼 바닥에 부드러운 판을 깐다. 판은 발자국 **바깥**으로만 번지므로
 * (안쪽은 부품 자신이 가린다) 구석을 넓게 어둡게 만들지 않는다 —
 * 180초 안에 사인을 읽어야 하는 게임에서 그건 그대로 손해다.
 * 맵 전체를 한 메시로 구워 **드로우 콜 1개**.
 */

import {
  BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, type Box3,
} from 'three'
import { FLOOR } from '../data/world'

/** 접지로 인정하는 바닥 높이 (three 좌표계의 y). data/world.ts FLOOR 와 같은 값이다. */
const FLOOR_YS = [FLOOR.L0, FLOOR.B1, FLOOR.B2] as const
/** 바닥에서 이만큼 안에 밑면이 있으면 "닿았다"고 본다 */
const GROUND_EPS = 0.25
/** 이보다 납작하면 부품이 아니라 바닥 마감·데칼이다 */
const MIN_HEIGHT = 0.25
/** 발자국 넓이 하한(m²) — 이하는 부스러기 */
const MIN_FOOT = 0.02
/** 발자국 넓이 상한(m²) — 이상은 잘못 뭉친 덩어리 */
const MAX_FOOT = 60
/** 두 변이 모두 이보다 크면 부품이 아니라 판때기다 (벽 밑동 0.4×30.8 은 통과시켜야 한다) */
const SLAB_DIM = 6
/** 바닥 위 높이 — 줄눈 데칼(0.015)보다 낮게 둬서 그림자가 줄눈을 덮지 않는다 */
const LIFT = 0.008

export type ShadowQuad = Readonly<{
  cx: number; cy: number; cz: number
  /** 판 전체 크기 (발자국 + 번짐) */
  w: number; d: number
  /** 발자국이 판에서 차지하는 비율 (0..1) — 이 안쪽은 알파가 최대다 */
  iu: number; iv: number
}>

const size = new Vector3()
const center = new Vector3()

/**
 * 섬 분해를 돌리기 전 **메시 단위**로 후보를 거른다.
 * 벽·바닥·천장 본체까지 union-find 를 돌리면 로드 시간만 먹고 나오는 건 없다.
 */
export const mayGround = (box: Box3): boolean =>
  box.max.y - box.min.y >= MIN_HEIGHT
  && FLOOR_YS.some((y) => Math.abs(box.min.y - y) <= GROUND_EPS)

/** 번짐 폭 — 작은 물건은 좁고 진하게, 큰 물건도 0.45 m 를 넘기지 않는다 */
const spreadOf = (minDim: number): number => Math.min(0.45, Math.max(0.14, minDim * 0.35))

/**
 * 섬 하나의 AABB 를 접촉 그림자 판으로 바꾼다. 조건에 안 맞으면 아무것도 하지 않는다.
 *
 * ⚠ 반드시 **섬 단위**여야 한다. 오브젝트 bbox 로 하면 Z2 의 기둥 4개짜리 조인 오브젝트가
 * 37×11 m 검은 판 한 장이 되어 콩코스 바닥을 덮는다.
 */
export const shadowQuadFrom = (box: Box3, out: ShadowQuad[]): void => {
  box.getSize(size)
  box.getCenter(center)
  if (size.y < MIN_HEIGHT) return
  if (size.x > SLAB_DIM && size.z > SLAB_DIM) return

  const foot = size.x * size.z
  if (foot < MIN_FOOT || foot > MAX_FOOT) return

  const floorY = FLOOR_YS.find((y) => Math.abs(box.min.y - y) <= GROUND_EPS)
  if (floorY === undefined) return

  const sp = spreadOf(Math.min(size.x, size.z))
  const w = size.x + sp * 2
  const d = size.z + sp * 2
  out.push({
    cx: center.x, cy: floorY + LIFT, cz: center.z,
    w, d, iu: size.x / w, iv: size.z / d,
  })
}

/**
 * 접촉 그림자 머티리얼.
 *
 * 알파 블렌딩으로 어둡게 깐다. `depthWrite:false` 로 서로를 가리지 않게 하고
 * 폴리곤 오프셋은 DECAL_MATERIALS 관례를 그대로 따른다(station.ts 참고).
 */
const shadowMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      // 지하는 형광등이 균일해 실제로도 접촉 그림자가 **좁고 진하다**.
      // 구석을 넓게 어둡게 만들면 보기엔 좋아도 사인 가독성이 깎인다.
      uStrength: { value: 0.34 },
      // 존 그룹은 95 m 밖에서 꺼진다 — 바닥이 사라지기 전에 그림자가 먼저 없어져야 한다
      uFadeNear: { value: 40 },
      uFadeFar: { value: 75 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aInner;
      uniform float uFadeNear;
      uniform float uFadeFar;
      varying vec2 vUv;
      varying vec2 vInner;
      varying float vFade;
      void main() {
        vUv = uv;
        vInner = aInner;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(uFadeNear, uFadeFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec2 vUv;
      varying vec2 vInner;
      varying float vFade;
      void main() {
        // 발자국 안쪽은 거리 0 (부품 자신이 가린다), 바깥으로만 번진다
        vec2 p = abs(vUv * 2.0 - 1.0);
        vec2 q = max(p - vInner, 0.0) / max(1.0 - vInner, vec2(1e-4));
        float a = uStrength * pow(1.0 - min(length(q), 1.0), 1.6) * vFade;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // 깊이 층 1 — 바닥(0)보다 앞, 줄눈·점자블록 데칼(2)보다 뒤.
    // 지오메트리도 그렇게 쌓여 있다(LIFT 0.008 < 줄눈 0.015). station.ts DEPTH_LAYER 참고.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: false,
  })

const UV = [0, 0, 1, 0, 0, 1, 1, 1] as const
const TRI = [0, 2, 1, 2, 3, 1] as const

/** 판 목록을 바닥에 눕힌 하나의 메시로 굽는다. */
export const buildContactShadows = (quads: readonly ShadowQuad[]): Mesh | null => {
  if (quads.length === 0) return null
  const n = quads.length
  const pos = new Float32Array(n * 4 * 3)
  const uv = new Float32Array(n * 4 * 2)
  const inner = new Float32Array(n * 4 * 2)
  const idx = new Uint32Array(n * 6)

  quads.forEach((q, i) => {
    for (let k = 0; k < 4; k++) {
      const su = (UV[k * 2] as number) - 0.5
      const sv = (UV[k * 2 + 1] as number) - 0.5
      const o = (i * 4 + k) * 3
      pos[o] = q.cx + su * q.w
      pos[o + 1] = q.cy
      pos[o + 2] = q.cz + sv * q.d
      const t = (i * 4 + k) * 2
      uv[t] = UV[k * 2] as number
      uv[t + 1] = UV[k * 2 + 1] as number
      inner[t] = q.iu
      inner[t + 1] = q.iv
    }
    for (let k = 0; k < 6; k++) idx[i * 6 + k] = i * 4 + (TRI[k] as number)
  })

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setAttribute('aInner', new BufferAttribute(inner, 2))
  geo.setIndex(new BufferAttribute(idx, 1))
  geo.computeBoundingSphere()

  const mesh = new Mesh(geo, shadowMaterial())
  mesh.name = 'contact-shadows'
  // 유리(2)·글로우(1)보다 먼저. 바닥 바로 위에 깔리는 데칼이다
  mesh.renderOrder = 0
  mesh.frustumCulled = false
  return mesh
}
