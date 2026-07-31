/**
 * 입력 → 불변 InputFrame.
 *
 * 시뮬레이션은 DOM을 모른다. 이 파일이 유일한 경계다 —
 * 덕분에 테스트에서 InputFrame 배열을 손으로 만들어 3분 플레이를 20ms에 재생할 수 있다.
 */

import { FPV } from '../data/tuning'
import { EMPTY_LOOK, pushLook, readLook, setLocked, type LookState } from './look'

export type InputFrame = Readonly<{
  /** −1..1 — 카메라 기준 우/좌 */
  moveX: number
  /** −1..1 — 카메라 기준 전/후 */
  moveY: number
  sprint: boolean
  interact: boolean
  /** 점프 (Space) */
  jump: boolean
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
  moveX: 0, moveY: 0, sprint: false, interact: false, jump: false,
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
  /** 시선 델타 필터 상태 — 스킵 원인별 처리는 core/look.ts 참고 */
  let look: LookState = EMPTY_LOOK

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (MOVE_KEYS.has(e.code)) e.preventDefault()
      return
    }
    held.add(e.code)
    // Space는 점프다. 타이틀 시작은 Enter만 받는다 — 겸용하면 시작 직후 한 번 뛴다.
    if (e.code === 'Enter') pressStart = true
    if (e.code === 'KeyR') pressRestart = true
    if (e.code === 'F3') { pressDebug = true; e.preventDefault() }
    if (e.code === 'KeyV') pressToggleView = true
    if (MOVE_KEYS.has(e.code)) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => { held.delete(e.code) }
  const onBlur = (): void => { held.clear(); dragging = false }

  /**
   * 포인터 락 요청.
   *
   * `unadjustedMovement: true` — **OS 마우스 가속을 끈다** (스킵 원인 4).
   * 가속이 켜져 있으면 같은 물리 거리를 움직여도 손 속도에 따라 회전량이 배로 달라져서,
   * 조금 빨리 움직인 순간 화면이 훌쩍 건너뛴 것처럼 보인다.
   * 표준 옵션이지만 미지원 브라우저는 Promise를 거부하거나 던지므로 폴백을 둔다.
   */
  const requestLock = (): void => {
    const el = target as HTMLElement & {
      requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void
    }
    if (!el.requestPointerLock) return
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true })
      if (r instanceof Promise) r.catch(() => { void el.requestPointerLock?.() })
    } catch {
      void el.requestPointerLock()
    }
  }

  const onPointerDown = (e: PointerEvent): void => {
    // 좌클릭 = 포인터 락 요청. 1인칭 시선의 유일한 진입점이다.
    if (e.button === 0 && document.pointerLockElement !== target) requestLock()
    if (e.button === 2) { dragging = true; target.setPointerCapture(e.pointerId) }
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      dragging = false
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    }
  }
  const onLockChange = (): void => {
    locked = document.pointerLockElement === target
    look = setLocked(look, locked, performance.now())
  }

  /**
   * 락 중 시선은 **mousemove**로 받는다.
   *
   * PointerEvent의 movementX/Y는 Chrome에서 오래 문제가 있었고(락 중 좌표계·배율),
   * 포인터 락 명세가 기준으로 삼는 이벤트는 mousemove다. 오빗 드래그만 pointermove에 남긴다.
   */
  const onMouseMove = (e: MouseEvent): void => {
    if (!locked) return
    look = pushLook(look, -e.movementX, -e.movementY, e.timeStamp)
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (locked || !dragging) return
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
  window.addEventListener('mousemove', onMouseMove)
  target.addEventListener('wheel', onWheel, { passive: false })
  target.addEventListener('contextmenu', onContext)

  const axis = (neg: readonly string[], pos: readonly string[]): number => {
    const n = neg.some((k) => held.has(k)) ? 1 : 0
    const p = pos.some((k) => held.has(k)) ? 1 : 0
    return p - n
  }

  return {
    sample(): InputFrame {
      // 이 프레임에 반영할 시선 델타를 꺼낸다. 넘치는 몫은 필터가 다음 프레임으로 이월한다.
      const r = readLook(look)
      look = r.state
      lookYaw += r.delta.dx * SENSITIVITY
      lookPitch += r.delta.dy * SENSITIVITY
      lookPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, lookPitch))

      const frame: InputFrame = {
        moveX: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
        moveY: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
        sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
        interact: held.has('KeyE'),
        jump: held.has('Space'),
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
      window.removeEventListener('mousemove', onMouseMove)
      target.removeEventListener('wheel', onWheel)
      target.removeEventListener('contextmenu', onContext)
    },
  }
}

/** 오빗 입력이 중립인가 — 프리셋 자동 복귀 판정용. */
export const orbitIsNeutral = (f: InputFrame): boolean =>
  Math.abs(f.orbitYaw) < 1e-4 && Math.abs(f.orbitPitch) < 1e-4
