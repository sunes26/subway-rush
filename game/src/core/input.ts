/**
 * 입력 → 불변 InputFrame.
 *
 * 시뮬레이션은 DOM을 모른다. 이 파일이 유일한 경계다 —
 * 덕분에 테스트에서 InputFrame 배열을 손으로 만들어 3분 플레이를 20ms에 재생할 수 있다.
 */

export type InputFrame = Readonly<{
  /** −1..1 — 카메라 기준 우/좌 */
  moveX: number
  /** −1..1 — 카메라 기준 전/후 */
  moveY: number
  sprint: boolean
  interact: boolean
  /** 우클릭 드래그 오빗 누적 (rad) */
  orbitYaw: number
  orbitPitch: number
  /** 휠 줌 배율 0.6..1.6 */
  zoom: number
  /** 원샷 — 소비되면 false로 돌아간다 */
  pressStart: boolean
  pressRestart: boolean
  pressDebug: boolean
}>

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveY: 0, sprint: false, interact: false,
  orbitYaw: 0, orbitPitch: 0, zoom: 1,
  pressStart: false, pressRestart: false, pressDebug: false,
}

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

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (MOVE_KEYS.has(e.code)) e.preventDefault()
      return
    }
    held.add(e.code)
    if (e.code === 'Enter' || e.code === 'Space') pressStart = true
    if (e.code === 'KeyR') pressRestart = true
    if (e.code === 'F3') { pressDebug = true; e.preventDefault() }
    if (MOVE_KEYS.has(e.code)) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => { held.delete(e.code) }
  const onBlur = (): void => { held.clear(); dragging = false }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) { dragging = true; target.setPointerCapture(e.pointerId) }
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      dragging = false
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    }
  }
  const onPointerMove = (e: PointerEvent): void => {
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
        orbitYaw, orbitPitch, zoom,
        pressStart, pressRestart, pressDebug,
      }
      pressStart = false
      pressRestart = false
      pressDebug = false
      return frame
    },
    dispose(): void {
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
