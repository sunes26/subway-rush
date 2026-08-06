import {
  ACESFilmicToneMapping, AmbientLight, Color, DirectionalLight, Fog,
  HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three'
import { CAMERA, PALETTE } from '../data/tuning'
import { FLOOR } from '../data/world'
import type { ZoneId } from '../state/types'

export type Stage = Readonly<{
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  resize(): void
  /** 렌더 배율 0.25~1 — 설정의 해상도 항목 */
  setResScale(v: number): void
  /** 존에 따라 안개·배경색을 바꾼다 — 지상은 하늘, 지하는 형광등 */
  setMood(zone: ZoneId, dt: number): void
  /**
   * 간접광 성분의 배율.
   *
   * 라이트맵은 Blender 에서 `DIFFUSE` **직접 + 간접**을 구운 것이다. 즉 여기 있는
   * 앰비언트·반구광·바닥반사가 하는 일을 이미 담고 있다. 둘을 그대로 더하면
   * 이중 계산이 되어 역 전체가 하얗게 날아간다 — 실제로 처음 붙였을 때 그랬다.
   *
   * three 의 `lightMap` 은 **순수 가산**이다 — 어둡게 만들지 못하고 더하기만 한다.
   * 그래서 라이트맵이 명암을 만들려면 그것이 조명의 **주된 몫**이어야 한다.
   * 방향광을 그대로 두면 라이트맵이 얹히는 만큼 통째로 밝아질 뿐이다
   * (0.22 로 간접만 줄였을 때 실제로 그랬다 — 하얗게 붙은 채 그대로였다).
   *
   * 그렇다고 전부 0 으로 두면 툰 램프가 법선을 못 읽어 형태가 납작해진다.
   * 방향광은 **형태를 읽을 만큼만** 남기고, 방향 없는 성분은 거의 지운다.
   *
   * 라이트맵이 없는 빌드(사이드카 없이 익스포트)에서는 1.0 그대로 — 예전 룩이 나온다.
   */
  setIndirect(scale: number): void
  dispose(): void
}>

/**
 * 존별 분위기. 지하는 "어둡다"가 아니라 **형광등이 균일하게 깔린 밝은 공간**이다.
 * 실제 역사는 밝다 — 어둡게 하면 분위기가 아니라 그냥 안 보인다.
 */
const MOOD: Record<ZoneId, { bg: number; fog: number; density: number; sun: number; amb: number }> = {
  Z1: { bg: 0xa8c6db, fog: 0xb9d2e2, density: 0.0050, sun: 0.92, amb: 0.16 },
  Z2: { bg: 0x14161a, fog: 0x33383f, density: 0.0130, sun: 0.62, amb: 0.20 },
  Z3: { bg: 0x14161a, fog: 0x363b43, density: 0.0140, sun: 0.66, amb: 0.22 },
  Z4: { bg: 0x111317, fog: 0x2b2f36, density: 0.0155, sun: 0.58, amb: 0.19 },
  Z5: { bg: 0x0d0f13, fog: 0x24282f, density: 0.0115, sun: 0.62, amb: 0.18 },
}

export const createStage = (canvas: HTMLCanvasElement): Stage => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.88
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  const scene = new Scene()
  scene.background = new Color(MOOD.Z1.bg)
  scene.fog = new Fog(MOOD.Z1.fog, 30, 150)

  const camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far)
  camera.position.set(-70, 14, -10)

  const sun = new DirectionalLight(0xfff6e6, 0.92)
  sun.position.set(-40, 60, 30)
  scene.add(sun)

  const hemi = new HemisphereLight(PALETTE.fluor, 0x23242a, 0.34)
  hemi.position.set(0, 40, 0)
  scene.add(hemi)

  const amb = new AmbientLight(0xffffff, 0.16)
  scene.add(amb)

  // 지하 천장 형광등을 흉내내는 보조광 — 그림자 없는 균일한 상단광
  const fluor = new DirectionalLight(PALETTE.fluor, 0.24)
  fluor.position.set(0.2, 1, 0.35)
  scene.add(fluor)

  /**
   * 바닥 반사광 — **아래에서 위로** 쏘는 유일한 광원.
   *
   * 다른 광원이 전부 위에서 내려오기 때문에 아래를 향한 면(천장·계단 밑면·차양)이
   * 실내에서 가장 어두운 면으로 나왔다. 실제 역은 정반대다 — 밝은 화강석 바닥이
   * 빛을 되쏘아 천장이 가장 밝다. 지상(Z1)은 반사면이 아스팔트라 훨씬 약하게 준다.
   */
  const bounce = new DirectionalLight(PALETTE.fluor, 0.30)
  bounce.position.set(-0.15, -1, -0.25)
  scene.add(bounce)

  // 목표값 — setMood가 부드럽게 수렴시킨다
  let bg = new Color(MOOD.Z1.bg)
  let fogC = new Color(MOOD.Z1.fog)
  let near = 30
  let far = 150
  let sunI = MOOD.Z1.sun
  let ambI = MOOD.Z1.amb
  let indirect = 1

  /**
   * 매 프레임 호출한다. resize 이벤트에 의존하지 않는 이유:
   * 캔버스가 0×0인 상태로 부팅되거나(패널이 아직 안 열림) 컨테이너만 바뀌는 경우
   * window의 resize가 아예 안 온다. 크기 비교는 공짜다.
   */
  /**
   * 렌더 배율(설정의 "해상도"). 1 이 네이티브다.
   * CSS 크기는 그대로 두고 **버퍼만** 줄인다 — UI 는 선명한 채로 3D 만 가벼워진다.
   */
  let resScale = 1

  const resize = (): void => {
    const w = Math.max(1, Math.round((canvas.clientWidth || innerWidth) * 1))
    const h = Math.max(1, Math.round((canvas.clientHeight || innerHeight) * 1))
    const dpr = Math.min(devicePixelRatio, 2) * resScale
    if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    setResScale(v: number) {
      const next = Math.min(1, Math.max(0.25, v))
      if (next === resScale) return
      resScale = next
      // `resize()` 는 크기가 같으면 일찍 빠져나간다. 배율만 바뀐 경우를 태우려면
      // 캔버스 버퍼를 무효화해 비교를 실패시켜야 한다
      canvas.width = 0
      resize()
    },
    setMood(zone, dt) {
      const m = MOOD[zone]
      // density → near/far 로 환산 (Fog는 선형이라 컨트롤이 예측 가능하다)
      const targetFar = 1 / m.density
      const targetNear = targetFar * 0.18
      const k = 1 - Math.exp(-dt / 0.5)
      bg = bg.lerp(new Color(m.bg), k)
      fogC = fogC.lerp(new Color(m.fog), k)
      near += (targetNear - near) * k
      far += (targetFar - far) * k
      sunI += (m.sun - sunI) * k
      ambI += (m.amb - ambI) * k
      amb.intensity = ambI * indirect
      hemi.intensity = (zone === 'Z1' ? 0.42 : 0.5) * indirect
      ;(scene.background as Color).copy(bg)
      const f = scene.fog as Fog
      f.color.copy(fogC)
      f.near = near
      f.far = far
      // 방향광은 간접보다 덜 줄인다 — 형태(툰 램프)는 이쪽이 만든다
      sun.intensity = sunI * (0.30 + 0.70 * indirect)
      // 지하에서는 태양을 천장 형광등처럼 위에서 내린다
      const underground = zone !== 'Z1'
      sun.position.set(underground ? 0 : -40, underground ? FLOOR.B1 + 40 : 60, underground ? 6 : 30)
      // 지상은 아스팔트라 반사가 약하고, 지하는 밝은 화강석이라 강하다
      bounce.intensity = (underground ? 0.34 : 0.12) * indirect
      // 형광 보조광은 절반만 줄인다 — 완전히 빼면 아래를 향한 면이 다시 죽는다
      fluor.intensity = 0.24 * (0.30 + 0.70 * indirect)
    },
    setIndirect(scale) {
      indirect = scale
    },
    dispose() {
      renderer.dispose()
    },
  }
}
