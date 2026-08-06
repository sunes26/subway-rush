/**
 * 존 앰비언스 — 필터링된 브라운 노이즈 루프 (`docs/P2-SPEC.md` §7).
 *
 * `sfx.ts` 와 분리한 이유는 하나다: **지속음이라 수명 관리가 다르다.**
 * 효과음은 쏘고 잊으면 되지만 앰비언스는 하나의 소스를 계속 돌리면서
 * 필터 주파수만 크로스페이드한다. 존이 바뀔 때마다 소스를 갈면 그 순간 끊긴다.
 *
 * 에셋 0바이트 방침 유지 — 4초 브라운 노이즈 버퍼를 절차 생성해서 반복한다.
 */

export type Ambience = Readonly<{
  /**
   * `sfx` 의 살아 있는 컨텍스트와 마스터 게인을 **빌려서** 시작한다.
   *
   * 자기 컨텍스트를 새로 만들면 사용자 제스처 밖에서 생성돼 `suspended` 로 멈춘 채
   * 영원히 안 깨어난다 — P2 최초 구현이 그랬고, 앰비언스가 한 번도 안 들렸다.
   * 빌려 쓰면 음소거도 마스터 한 곳에서 끝난다.
   */
  start(ctx: AudioContext | null, bus: GainNode | null): void
  /** 목표 대역으로 서서히 옮긴다. 존 전환마다 부른다 */
  setZone(hz: number): void
  setMuted(muted: boolean): void
  stop(): void
  running(): boolean
}>

const NOOP: Ambience = {
  start: () => {}, setZone: () => {}, setMuted: () => {}, stop: () => {}, running: () => false,
}

const LOOP_SEC = 4
/** 마스터(0.34) 아래에서의 상대 레벨. 0.045 는 사실상 안 들렸다 */
const LEVEL = 0.34
/** 크로스페이드 시정수(초) — 존 경계를 넘나들어도 펄럭이지 않을 만큼 길게 */
const GLIDE = 0.55

export const createAmbience = (): Ambience => {
  if (typeof window === 'undefined') return NOOP

  let ctx: AudioContext | null = null
  let src: AudioBufferSourceNode | null = null
  let filter: BiquadFilterNode | null = null
  let gain: GainNode | null = null
  let muted = false

  /** 브라운 노이즈 — 백색보다 저역이 강해 "공간"으로 들린다 */
  const buildBuffer = (c: AudioContext): AudioBuffer => {
    const n = Math.floor(c.sampleRate * LOOP_SEC)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const d = buf.getChannelData(0)
    // 결정적 노이즈 — `sfx.ts` 와 같은 취향(Math.random 을 안 쓴다)
    let seed = 0x51ed2701
    let last = 0
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const white = (seed / 0xffffffff) * 2 - 1
      last = (last + 0.02 * white) / 1.02
      d[i] = last * 3.2
    }
    // 루프 이음매 — 마지막 0.1초를 첫 샘플로 페이드해 "툭" 을 없앤다
    const tail = Math.floor(c.sampleRate * 0.1)
    for (let i = 0; i < tail; i++) {
      const k = i / tail
      d[n - tail + i] = (d[n - tail + i] ?? 0) * (1 - k) + (d[i] ?? 0) * k
    }
    return buf
  }

  return {
    running: () => src !== null,

    start(sharedCtx, bus) {
      if (src || !sharedCtx) return
      try {
        ctx = sharedCtx
        // 제스처 밖에서 만들어졌으면 아직 자고 있다 — 깨워야 소리가 난다
        if (ctx.state === 'suspended') void ctx.resume()
        gain = ctx.createGain()
        gain.gain.value = muted ? 0 : LEVEL
        filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 520
        filter.Q.value = 0.6
        src = ctx.createBufferSource()
        src.buffer = buildBuffer(ctx)
        src.loop = true
        src.connect(filter)
        filter.connect(gain)
        // 마스터 버스에 물린다 — 음소거가 한 스위치로 끝난다
        gain.connect(bus ?? ctx.destination)
        src.start()
      } catch {
        // 오디오가 실패해도 게임은 돈다 (`sfx.ts` 헤더와 같은 태도)
        src = null
      }
    },

    setZone(hz) {
      if (!ctx || !filter) return
      filter.frequency.setTargetAtTime(hz, ctx.currentTime, GLIDE)
    },

    setMuted(m) {
      muted = m
      if (!ctx || !gain) return
      gain.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05)
    },

    stop() {
      try { src?.stop() } catch { /* 이미 멈춘 소스 */ }
      src = null
    },
  }
}
