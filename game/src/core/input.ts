/**
 * 입력 → 불변 InputFrame.
 *
 * 시뮬레이션은 DOM을 모른다. 이 파일이 유일한 경계다 —
 * 덕분에 테스트에서 InputFrame 배열을 손으로 만들어 3분 플레이를 20ms에 재생할 수 있다.
 */

import { FPV } from '../data/tuning'

export type InputFrame = Readonly<{
  /** −1..1 — 카메라 기준 우/좌 */
  moveX: number
  /** −1..1 — 카메라 기준 전/후 */
  moveY: number
  sprint: boolean
  interact: boolean
  /** 1인칭 시선 (rad). 포인터 락 중 마우스 이동으로 누적된다 */
  lookYaw: number
  lookPitch: number
  /** 포인터가 잠겨 있는가 — 잠기지 않았으면 시선이 움직이지 않는다 */
  locked: boolean
  /** 우클릭 드래그 오빗 누적 (rad) — 3인칭 전용 */
  orbitYaw: number
  orbitPitch: number
  /** 휠 줌 배율 0.6..1.6 — 3인칭 전용 */
  zoom: number
  /** 원샷 — 소비되면 false로 돌아간다 */
  pressStart: boolean
  pressRestart: boolean
  pressDebug: boolean
  pressToggleView: boolean
}>

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveY: 0, sprint: false, interact: false,
  lookYaw: 0, lookPitch: 0, locked: false,
  orbitYaw: 0, orbitPitch: 0, zoom: 1,
  pressStart: false, pressRestart: false, pressDebug: false, pressToggleView: false,
}

const SENSITIVITY = FPV.sensitivity
const PITCH_LIMIT = FPV.pitchLimit

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space',
])

export type InputSource = {
  sample(): InputFrame
  dispose(): void
}

export const createInput = (target: HTMLElement): InputSource => {
  const held = new Set<string>()
  let orbitYaw = 0
  let orbitPitch = 0
  let zoom = 1
  let dragging = false
  let pressStart = false
  let pressRestart = false
  let pressDebug = false
  let pressToggleView = false
  let lookYaw = 0
  let lookPitch = 0
  let locked = false

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (MOVE_KEYS.has(e.code)) e.preventDefault()
      return
    }
    held.add(e.code)
    if (e.code === 'Enter' || e.code === 'Space') pressStart = true
    if (e.code === 'KeyR') pressRestart = true
    if (e.code === 'F3') { pressDebug = true; e.preventDefault() }
    if (e.code === 'KeyV') pressToggleView = true
    if (MOVE_KEYS.has(e.code)) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => { held.delete(e.code) }
  const onBlur = (): void => { held.clear(); dragging = false }

  const onPointerDown = (e: PointerEvent): void => {
    // 좌클릭 = 포인터 락 요청. 1인칭 시선의 유일한 진입점이다.
    if (e.button === 0 && document.pointerLockElement !== target) {
      void target.requestPointerLock?.()
    }
    if (e.button === 2) { dragging = true; target.setPointerCapture(e.pointerId) }
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      dragging = false
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    }
  }
  const onLockChange = (): void => { locked = document.pointerLockElement === target }

  const onPointerMove = (e: PointerEvent): void => {
    if (locked) {
      lookYaw -= e.movementX * SENSITIVITY
      lookPitch -= e.movementY * SENSITIVITY
      lookPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, lookPitch))
      return
    }
    if (!dragging) return
    orbitYaw -= e.movementX * 0.0042
    orbitPitch -= e.movementY * 0.0032
    orbitYaw = Math.max(-0.79, Math.min(0.79, orbitYaw))
    orbitPitch = Math.max(-0.42, Math.min(0.42, orbitPitch))
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    zoom = Math.max(0.6, Math.min(1.6, zoom * (e.deltaY > 0 ? 1.09 : 1 / 1.09)))
  }
  const onContext = (e: Event): void => { e.preventDefault() }

  document.addEventListener('pointerlockchange', onLockChange)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  target.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointermove', onPointerMove)
  target.addEventListener('wheel', onWheel, { passive: false })
  target.addEventListener('contextmenu', onContext)

  const axis = (neg: readonly string[], pos: readonly string[]): number => {
    const n = neg.some((k) => held.has(k)) ? 1 : 0
    const p = pos.some((k) => held.has(k)) ? 1 : 0
    return p - n
  }

  return {
    sample(): InputFrame {
      const frame: InputFrame = {
        moveX: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
        moveY: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
        sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
        interact: held.has('KeyE'),
        lookYaw, lookPitch, locked,
        orbitYaw, orbitPitch, zoom,
        pressStart, pressRestart, pressDebug, pressToggleView,
      }
      pressStart = false
      pressRestart = false
      pressDebug = false
      pressToggleView = false
      return frame
    },
    dispose(): void {
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      target.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('wheel', onWheel)
      target.removeEventListener('contextmenu', onContext)
    },
  }
}

/** 오빗 입력이 중립인가 — 프리셋 자동 복귀 판정용. */
export const orbitIsNeutral = (f: InputFrame): boolean =>
  Math.abs(f.orbitYaw) < 1e-4 && Math.abs(f.orbitPitch) < 1e-4
