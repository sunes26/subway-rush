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
  /** 존에 따라 안개·배경색을 바꾼다 — 지상은 하늘, 지하는 형광등 */
  setMood(zone: ZoneId, dt: number): void
  dispose(): void
}>

/**
 * 존별 분위기. 지하는 "어둡다"가 아니라 **형광등이 균일하게 깔린 밝은 공간**이다.
 * 실제 역사는 밝다 — 어둡게 하면 분위기가 아니라 그냥 안 보인다.
 */
const MOOD: Record<ZoneId, { bg: number; fog: number; density: number; sun: number; amb: number }> = {
  Z1: { bg: 0xbfd8e8, fog: 0xd4e5f0, density: 0.0045, sun: 1.15, amb: 0.34 },
  Z2: { bg: 0x1b1d22, fog: 0x555a63, density: 0.0125, sun: 1.00, amb: 0.55 },
  Z3: { bg: 0x1b1d22, fog: 0x5a606a, density: 0.0135, sun: 1.06, amb: 0.58 },
  Z4: { bg: 0x16181c, fog: 0x4a4f58, density: 0.0150, sun: 0.94, amb: 0.52 },
  Z5: { bg: 0x101216, fog: 0x424750, density: 0.0110, sun: 1.00, amb: 0.50 },
}

export const createStage = (canvas: HTMLCanvasElement): Stage => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  const scene = new Scene()
  scene.background = new Color(MOOD.Z1.bg)
  scene.fog = new Fog(MOOD.Z1.fog, 30, 150)

  const camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far)
  camera.position.set(-70, 14, -10)

  const sun = new DirectionalLight(0xffffff, 1.05)
  sun.position.set(-40, 60, 30)
  scene.add(sun)

  const hemi = new HemisphereLight(PALETTE.fluor, 0x2b2b30, 0.62)
  hemi.position.set(0, 40, 0)
  scene.add(hemi)

  const amb = new AmbientLight(0xffffff, 0.34)
  scene.add(amb)

  // 지하 천장 형광등을 흉내내는 보조광 — 그림자 없는 균일한 상단광
  const fluor = new DirectionalLight(PALETTE.fluor, 0.42)
  fluor.position.set(0.2, 1, 0.35)
  scene.add(fluor)

  // 목표값 — setMood가 부드럽게 수렴시킨다
  let bg = new Color(MOOD.Z1.bg)
  let fogC = new Color(MOOD.Z1.fog)
  let near = 30
  let far = 150
  let sunI = MOOD.Z1.sun
  let ambI = MOOD.Z1.amb

  /**
   * 매 프레임 호출한다. resize 이벤트에 의존하지 않는 이유:
   * 캔버스가 0×0인 상태로 부팅되거나(패널이 아직 안 열림) 컨테이너만 바뀌는 경우
   * window의 resize가 아예 안 온다. 크기 비교는 공짜다.
   */
  const resize = (): void => {
    const w = Math.max(1, Math.round((canvas.clientWidth || innerWidth) * 1))
    const h = Math.max(1, Math.round((canvas.clientHeight || innerHeight) * 1))
    const dpr = Math.min(devicePixelRatio, 2)
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
      amb.intensity = ambI
      hemi.intensity = zone === 'Z1' ? 0.62 : 0.86
      ;(scene.background as Color).copy(bg)
      const f = scene.fog as Fog
      f.color.copy(fogC)
      f.near = near
      f.far = far
      sun.intensity = sunI
      // 지하에서는 태양을 천장 형광등처럼 위에서 내린다
      const underground = zone !== 'Z1'
      sun.position.set(underground ? 0 : -40, underground ? FLOOR.B1 + 40 : 60, underground ? 6 : 30)
    },
    dispose() {
      renderer.dispose()
    },
  }
}
