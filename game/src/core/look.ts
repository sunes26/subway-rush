/**
 * 1인칭 시선 델타 누산기 — 마우스 "스킵" 제거.
 *
 * 포인터 락 시선이 간헐적으로 순간이동하는 원인은 하나가 아니라 넷이었다.
 * DOM에서 떼어낸 순수 함수로 두고 각각을 개별 테스트한다.
 *
 *  1. **락 직후 누적 델타** — Chrome은 포인터 락이 걸리는 순간 커서가 화면 중앙으로
 *     워프하면서 그 이동량을 첫 `mousemove`에 그대로 실어 보낸다. 화면이 통째로 홱 돈다.
 *     → 락 성립 후 SETTLE_MS 동안은 델타를 버린다.
 *
 *  2. **단발 스파이크** — 창 포커스 전환·OS 커서 워프·드라이버 폴링 누락이 한 이벤트에
 *     수백 px을 몰아준다. 실제 손목 스냅도 크지만 **연속적**이라 직전 이벤트와 비슷하다.
 *     → 직전 델타 대비 배율과 절대값을 같이 본다. 처음 보는 큰 값 하나만 버린다.
 *
 *  3. **프레임 히치 몰아치기** — GC·텍스처 업로드로 한 프레임이 100ms 걸리면 그동안의
 *     마우스 이동이 전부 한 샘플에 실려 시선이 훌쩍 건너뛴다.
 *     → **최근 도착 속도의 몇 배**를 넘는 몫만 다음 프레임으로 이월한다. 총량이 보존되므로
 *       감도가 줄지 않고, 이상치가 두세 프레임에 나뉘어 들어간다.
 *
 *     ⚠ 상시 평활화(프레임당 도착량 균등화)는 **일부러 넣지 않았다.** 그건 rAF와
 *       폴링 위상이 어긋나 생기는 0/2배 교대까지 잡아 주지만, 대가로 모든 조준에
 *       한 프레임씩 지연이 붙는다. 사용자가 말한 건 "간혹" 튄다는 것 — 상시 현상이 아니다.
 *       상시 필터로 상시 비용을 치를 이유가 없다.
 *
 *  4. **OS 마우스 가속** — 같은 물리 이동이 속도에 따라 다른 회전량이 된다. 이건 필터가
 *     아니라 요청 옵션(`unadjustedMovement`)으로 끈다. → input.ts 참고.
 */

/** 락 성립 후 이 시간 동안의 델타는 버린다(ms). */
export const SETTLE_MS = 80

/** 한 이벤트가 이보다 크면 무조건 스파이크로 본다(px). 1000Hz 마우스도 여기까진 안 온다. */
export const SPIKE_ABS = 260

/** 직전 이벤트 대비 이 배율을 넘으면 스파이크 후보(px 하한 SPIKE_SOFT과 AND). */
export const SPIKE_RATIO = 6

/** 배율 판정의 하한 — 미세 이동(1px→7px)까지 스파이크로 잡으면 안 된다. */
export const SPIKE_SOFT = 90

/**
 * 방출 상한 = 최근 도착 속도 × 이 값.
 *
 * ⚠ 상한의 기준은 **직전까지 실제로 내보낸 양**이다. 도착량으로 두면 안 된다 —
 *   히치 프레임의 300px이 그대로 EMA에 들어가 다음 프레임 상한을 252까지 올렸다.
 *   이상치를 막으려고 만든 상한이 이상치에 끌려가면 의미가 없다.
 *   방출량은 이미 상한에 걸려 있으므로 프레임당 최대 3배씩만 자란다 — 히치 한 방이
 *   서너 프레임에 걸쳐 완만하게 빠진다.
 *   (반대로 상한 자체가 없는 "직전 방출량 그대로" 방식은 전량 방출 → 상한 상승 →
 *    계속 전량 방출로 자기를 무력화한다. 그것도 짜 보고 확인했다.)
 *
 * 3배는 이상치만 걸러내는 값이다. 평범한 가감속(직전의 2배 이내)은 그냥 통과한다.
 */
export const RELEASE_GAIN = 3.0

/** 방출 속도 EMA 계수. 클수록 최근 프레임에 민감. */
export const RELEASE_ALPHA = 0.25

/**
 * 속도 이력이 이 값(px/frame) 아래로 떨어지면 **0으로 리셋**해 상한을 없앤다.
 *
 * 없으면 손을 뗀 뒤 이력이 0.003 같은 값으로 남아 다음 이동을 상한 0.01로 목 조른다.
 * 4px/frame(≈0.5°/frame)은 "사실상 멈춰 있다"로 봐도 되는 선이고,
 * 12px/frame에서 감쇠로 여기까지 오는 데 다섯 프레임(≈83ms)이 걸린다.
 */
export const RATE_FLOOR = 4

export type LookState = Readonly<{
  /** 아직 화면에 반영되지 않은 누적 델타(px) */
  pendingX: number
  pendingY: number
  /** 프레임당 방출량 EMA(px, 절대값) — 방출 상한의 기준 */
  rateX: number
  rateY: number
  /** 직전 이벤트의 크기(px) — 스파이크 비교 기준 */
  lastMag: number
  /** 락이 성립한 시각(ms). null이면 잠기지 않음 */
  lockedAtMs: number | null
}>

export const EMPTY_LOOK: LookState = {
  pendingX: 0, pendingY: 0,
  rateX: 0, rateY: 0,
  lastMag: 0, lockedAtMs: null,
}

/** 락 상태 전이. 락이 걸릴 때 잔여 델타를 버린다 — 이전 세션의 이동이 새 세션에 새면 안 된다. */
export const setLocked = (_s: LookState, locked: boolean, nowMs: number): LookState =>
  locked ? { ...EMPTY_LOOK, lockedAtMs: nowMs } : { ...EMPTY_LOOK, lockedAtMs: null }

/** 이 이벤트가 스파이크인가 (원인 2). */
export const isSpike = (dx: number, dy: number, lastMag: number): boolean => {
  const mag = Math.hypot(dx, dy)
  if (mag >= SPIKE_ABS) return true
  return mag >= SPIKE_SOFT && lastMag > 0 && mag > lastMag * SPIKE_RATIO
}

/** 마우스 이벤트 하나를 누적한다. */
export const pushLook = (s: LookState, dx: number, dy: number, nowMs: number): LookState => {
  if (s.lockedAtMs === null) return s
  // 원인 1 — 락 직후 워프 델타
  if (nowMs - s.lockedAtMs < SETTLE_MS) return s
  // 원인 2 — 단발 스파이크. 버리더라도 lastMag는 갱신한다.
  // 갱신하지 않으면 진짜 빠른 대이동이 이어질 때 두 번째 이벤트까지 스파이크로 몰린다.
  const mag = Math.hypot(dx, dy)
  if (isSpike(dx, dy, s.lastMag)) return { ...s, lastMag: mag }
  return { ...s, pendingX: s.pendingX + dx, pendingY: s.pendingY + dy, lastMag: mag }
}

export type LookDelta = Readonly<{ dx: number; dy: number }>

/**
 * 프레임에서 소비할 델타를 꺼낸다 (원인 3).
 *
 * 상한은 **직전 프레임까지의** 도착 속도 × RELEASE_GAIN이다.
 * 이력이 없으면(정지 상태) 상한이 없다 — 멈춰 있다가 확 돌릴 때 늦으면 조준감이 죽는다.
 */
export const readLook = (s: LookState): { state: LookState; delta: LookDelta } => {
  const clampAxis = (pending: number, rate: number): number => {
    const cap = rate * RELEASE_GAIN
    if (cap <= 0) return pending
    return Math.sign(pending) * Math.min(Math.abs(pending), cap)
  }
  const dx = clampAxis(s.pendingX, s.rateX)
  const dy = clampAxis(s.pendingY, s.rateY)

  /**
   * 이력이 0인 상태에서 처음 움직이면 EMA를 **즉시 그 값으로 채운다**.
   * 25%씩 차오르길 기다리면 워밍업 두세 프레임 동안 상한이 도착량보다 낮아
   * 평범한 등속 이동조차 잘린다 (등속 12px/frame이 3.45px로 나왔다).
   */
  const ema = (rate: number, out: number): number => {
    const next = rate === 0 ? Math.abs(out) : rate + (Math.abs(out) - rate) * RELEASE_ALPHA
    return next < RATE_FLOOR ? 0 : next
  }

  return {
    state: {
      ...s,
      pendingX: s.pendingX - dx,
      pendingY: s.pendingY - dy,
      rateX: ema(s.rateX, dx),
      rateY: ema(s.rateY, dy),
    },
    delta: { dx, dy },
  }
}
