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
  /** P2 — 엔딩 도감 토글 (`C`) */
  pressCollection: boolean
  /** P2 — 전역 음소거 토글 (`M`) */
  pressMute: boolean
  /** P2 — 관찰 모드 홀드 (`Q`). 원샷이 아니라 **누르고 있는 동안** 이다 */
  observe: boolean

  // ── P1 ──
  /**
   * 상호작용 원샷 (`E` 또는 **락 중** 좌클릭).
   *
   * `interact`(홀드)를 그대로 쓰면 60Hz로 상호작용이 재발한다. P0에서 이 필드를
   * 읽는 곳이 아무 데도 없었던 덕에 드러나지 않았을 뿐이다.
   */
  pressInteract: boolean
  /**
   * 슬롯 원샷 — 0 = 없음, 1~10. 대화 중에는 **1~3 만** 선택지 번호로 전용된다.
   * `Digit1`~`Digit9` 가 1~9, `Digit0` 이 10번이다(키캡 순서 그대로).
   */
  pressSlot: number
  /** 취소 원샷 (`ESC`). ESC는 포인터 락도 같이 푼다 — 의도된 동작이다 */
  pressCancel: boolean
}>

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveY: 0, sprint: false, interact: false, jump: false,
  lookYaw: 0, lookPitch: 0, locked: false,
  orbitYaw: 0, orbitPitch: 0, zoom: 1,
  pressStart: false, pressRestart: false, pressDebug: false, pressToggleView: false,
  pressCollection: false, pressMute: false, observe: false,
  pressInteract: false, pressSlot: 0, pressCancel: false,
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
  /** 설정 반영 — 감도 배율(1 이 기본)과 상하 반전 */
  setLook(o: { sens: number; invertY: boolean }): void
  /**
   * 대화 중(붕어빵 아저씨 등 마우스로 고르는 화면)엔 `false` —
   * 포인터 락 **재진입**을 막는다. `false`로 걸린 채 이미 락돼 있으면 그 자리에서 즉시 푼다.
   * 이게 없으면 대화창(작은 패널) 밖 화면을 클릭하는 순간 다시 락이 걸려
   * (`onPointerDown` 의 "락 안 걸려 있으면 좌클릭 = 재진입" 규칙) 마우스가 도로 시선 회전이 된다.
   */
  setPointerLockAllowed(allowed: boolean): void
  /**
   * 1인칭 시선 누적값을 되돌린다 — 기본은 역 방향(yaw 0 · pitch 0).
   *
   * `lookYaw`/`lookPitch` 는 이 클로저에서만 산다. 재시작은 `GameState` 만 새로
   * 만들 뿐 이 값은 그대로 두므로, 인트로가 다시 끝나 조작권을 넘기는 순간
   * 직전 판에서 보던 방향이 그대로 남아 있었다 — 그걸 여기서 끊는다.
   */
  resetLook(yaw?: number, pitch?: number): void
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
  let pressCollection = false
  let pressMute = false
  let lookYaw = 0
  let lookPitch = 0
  let locked = false
  let pressInteract = false
  let pressSlot = 0
  let pressCancel = false
  /** `setPointerLockAllowed` 참고 — 기본은 항상 허용 */
  let lockAllowed = true
  /** 프레임 누적 원본 x 델타 — QTE 전용. 시선 필터(core/look)를 우회한다 */
  /** 시선 델타 필터 상태 — 스킵 원인별 처리는 core/look.ts 참고 */
  let look: LookState = EMPTY_LOOK
  /** 설정의 감도 배율·상하 반전. 기본값에서는 예전과 완전히 같은 시선이다 */
  let sensScale = 1
  let pitchSign = -1

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
    if (e.code === 'KeyC') pressCollection = true
    if (e.code === 'KeyM') pressMute = true
    // P1 — 상호작용·슬롯·취소. `KeyE`/`Digit1~3` 는 브라우저 기본 동작이 없어 preventDefault 불필요
    if (e.code === 'KeyE') pressInteract = true
    // Digit1~9 → 1~9, Digit0 → 10. 슬롯 수를 넘는 입력은 소비처가 무시한다
    const digit = /^Digit(\d)$/.exec(e.code)
    if (digit) pressSlot = digit[1] === '0' ? 10 : Number(digit[1])
    if (e.code === 'Escape') pressCancel = true
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
    // 대화 중(`lockAllowed=false`)엔 재진입을 안 한다 — 패널 밖을 클릭해도 조용히 무시된다.
    if (e.button === 0 && document.pointerLockElement !== target) {
      if (lockAllowed) requestLock()
    }
    // **락이 이미 걸린 뒤의** 좌클릭은 상호작용이다 (GDD §7.1 "E / 좌클릭").
    // 락 진입 클릭과 겹치지 않는다 — 진입은 위 분기가 먹는다.
    else if (e.button === 0) pressInteract = true
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
    // QTE 는 원본 델타를 쓴다. 시선 필터는 스파이크를 다음 프레임으로 이월하는데,
    // 긁기 판정에는 그 이월이 곧 "방향이 늦게 뒤집히는" 오판이 된다.
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
    setLook(o) {
      sensScale = Math.min(3, Math.max(0.25, o.sens))
      pitchSign = o.invertY ? 1 : -1
    },
    setPointerLockAllowed(allowed) {
      lockAllowed = allowed
      if (!allowed && document.pointerLockElement === target) document.exitPointerLock()
    },
    resetLook(yaw = 0, pitch = 0) {
      lookYaw = yaw
      lookPitch = pitch
    },
    sample(): InputFrame {
      // 이 프레임에 반영할 시선 델타를 꺼낸다. 넘치는 몫은 필터가 다음 프레임으로 이월한다.
      const r = readLook(look)
      look = r.state
      lookYaw += r.delta.dx * SENSITIVITY * sensScale
      // `pitchSign` 은 기본 -1 이다. `pushLook` 이 이미 부호를 한 번 뒤집어 놓았고
      // 그 조합이 "마우스를 밀면 위를 본다"였다 — 반전 설정은 이 부호만 바꾼다
      lookPitch += r.delta.dy * SENSITIVITY * sensScale * -pitchSign
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
        pressCollection, pressMute, observe: held.has('KeyQ'),
        pressInteract, pressSlot, pressCancel,
      }
      pressStart = false
      pressRestart = false
      pressDebug = false
      pressToggleView = false
      pressCollection = false
      pressMute = false
      pressInteract = false
      pressSlot = 0
      pressCancel = false
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
