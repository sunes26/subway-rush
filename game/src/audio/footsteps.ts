/**
 * 발소리 — **녹음 샘플**(`public/audio/footsteps.mp3`, 5.04s · 128kbps · 80KB).
 *
 * ── 에셋 0바이트 방침의 유일한 예외다
 * `sfx.ts` 헤더가 못 박은 원칙(*"사인파와 노이즈 버스트로 끝난다"*)을 여기서만 깬다.
 * 이유는 절차 생성이 실패한 지점이 정확히 여기이기 때문이다: 노이즈 버스트 한 방은
 * "툭" 이지 **발소리**가 아니다. 걸음은 뒤꿈치–발볼 두 번의 접촉과 옷·짐 소리가 겹친
 * 복합음이고, 그걸 사인파로 만들려면 스프라이트를 만드는 것보다 코드가 길어진다.
 * 디렉터가 지정한 소스(ElevenLabs, 도심 자갈길 보행)를 그대로 쓴다.
 *
 * ── 트리거가 아니라 게이팅이다
 * 이 파일은 **단발 발소리가 아니라 연속 보행 루프**다(5초, 여러 걸음이 이어진다).
 * 걸음마다 재생하면 위상이 어긋나 뭉갠다. 대신 **이동 중에만 루프를 열어 둔다** —
 * 게인을 0↔1 로 여닫고, 뛰면 `playbackRate` 를 올린다.
 * 그래서 보폭 주기(`cues.ts STEP_*_MS`)는 이제 재생을 몰지 않는다(폴백 경로만 쓴다).
 *
 * ── 실내/실외
 * 원본은 자갈길 + 도심 소음이라 지상(Z1)에 맞는다. 지하는 **저역 통과로 눌러**
 * 벽에 막힌 소리로 만든다. 리버브를 걸지 않는 이유: 컨볼버 하나가 IR 에셋을 또 부른다.
 */

export type Footsteps = Readonly<{
  /** `sfx` 의 살아 있는 컨텍스트를 빌려 로드·디코드한다. 실패하면 조용히 포기 */
  load(ctx: AudioContext | null, bus: GainNode | null, baseUrl: string): Promise<void>
  /**
   * 매 프레임. `on` 이 곧 게이트다.
   * @param cutoffHz 존별 저역 통과 — 지상은 넓게, 지하는 좁게
   */
  set(on: boolean, sprinting: boolean, cutoffHz: number): void
  /** 샘플이 준비됐는가 — false 면 호출부가 절차 생성 폴백을 쓴다 */
  ready(): boolean
  stop(): void
}>

const NOOP: Footsteps = {
  load: async () => {}, set: () => {}, ready: () => false, stop: () => {},
}

/** 루프 레벨 — 마스터(0.34) 아래에서의 상대값 */
const LEVEL = 0.85
/** 게이트 여닫는 시정수(초). 짧으면 딸깍이고 길면 멈춘 뒤에도 걷는 소리가 난다 */
const GATE = 0.06
/** 뛸 때 재생 속도 — 걷기 5.0 → 스프린트 8.3 m/s 의 비(1.66)를 그대로 쓰면 다람쥐가 된다 */
const RATE_SPRINT = 1.32

export const createFootsteps = (): Footsteps => {
  if (typeof window === 'undefined') return NOOP

  let ctx: AudioContext | null = null
  let src: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  let lp: BiquadFilterNode | null = null
  let hp: BiquadFilterNode | null = null
  let lastCut = -1
  let lastRate = -1
  let open = false

  return {
    ready: () => src !== null,

    async load(sharedCtx, bus, baseUrl) {
      if (src || !sharedCtx) return
      try {
        const res = await fetch(`${baseUrl}audio/footsteps.mp3`)
        if (!res.ok) return
        const buf = await sharedCtx.decodeAudioData(await res.arrayBuffer())
        ctx = sharedCtx
        gain = ctx.createGain()
        gain.gain.value = 0
        // 저역 쓰레기(에어컨 럼블)를 먼저 자른다 — 안 자르면 실내에서 웅웅거린다
        hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 170
        lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 6000
        lp.Q.value = 0.7
        src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.connect(hp)
        hp.connect(lp)
        lp.connect(gain)
        gain.connect(bus ?? ctx.destination)
        src.start()
      } catch {
        // 네트워크·디코드 실패 — 호출부가 절차 생성 발소리로 돌아간다
        src = null
      }
    },

    set(on, sprinting, cutoffHz) {
      if (!ctx || !gain || !src || !lp) return
      if (on !== open) {
        gain.gain.setTargetAtTime(on ? LEVEL : 0, ctx.currentTime, GATE)
        open = on
      }
      const rate = sprinting ? RATE_SPRINT : 1
      if (rate !== lastRate) {
        src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.08)
        lastRate = rate
      }
      if (cutoffHz !== lastCut) {
        // 존 전환에서 뚝 끊기지 않게 민다 — 앰비언스와 같은 태도
        lp.frequency.setTargetAtTime(cutoffHz, ctx.currentTime, 0.25)
        lastCut = cutoffHz
      }
    },

    stop() {
      try { src?.stop() } catch { /* 이미 멈춘 소스 */ }
      src = null
      open = false
    },
  }
}
