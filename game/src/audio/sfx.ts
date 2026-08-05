/**
 * SFX — WebAudio **절차 생성**. 에셋 0바이트.
 *
 * GDD §7.3은 *"사운드가 고증의 절반이다"* 라고 쓴다. P2에 사운드 전체가 잡혀 있지만,
 * 네 소리(개찰구 삑 · 동전 짤랑 · 단소 딱 · 문 경고)는 **사인파와 노이즈 버스트로 끝난다.**
 * 스프라이트 에셋을 만들면 번들 예산(gzip 900KB)을 건드리고, 그 대가로 얻는 것이
 * "더 진짜 같은 삑" 하나뿐이다. 3분 게임에서 그 교환은 손해다.
 *
 * ★ 시뮬은 오디오를 모른다. 리듀서가 낸 FX/상태 변화를 **렌더 루프가 읽어** 재생한다.
 *   그래서 헤드리스 테스트가 오디오 없이 그대로 돌고, 오디오가 실패해도 게임이 돈다.
 */

export type Sfx = Readonly<{
  /** 첫 사용자 입력에서 부른다 — 브라우저 자동재생 정책 */
  unlock(): void
  gate(): void
  coin(): void
  danso(): void
  doorWarn(): void
  /** 재생 가능한 상태인가 (E2E 확인용) */
  ready(): boolean
}>

/** 브라우저가 WebAudio를 안 주거나 막으면 조용히 아무것도 안 한다 */
const NOOP: Sfx = {
  unlock: () => {},
  gate: () => {},
  coin: () => {},
  danso: () => {},
  doorWarn: () => {},
  ready: () => false,
}

type Ctx = AudioContext & { __master?: GainNode }

export const createSfx = (): Sfx => {
  const AC: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
  if (!AC) return NOOP

  let ctx: Ctx | null = null
  let master: GainNode | null = null

  const ensure = (): boolean => {
    if (ctx) {
      // 사용자 제스처 전에 만들어졌으면 suspended 다 — 매번 깨워 준다
      if (ctx.state === 'suspended') void ctx.resume()
      return true
    }
    try {
      ctx = new AC() as Ctx
      master = ctx.createGain()
      // 효과음이 배경보다 튀지 않게. 지하철 안내음 톤을 생각하면 이 정도가 상한이다
      master.gain.value = 0.22
      master.connect(ctx.destination)
      return true
    } catch {
      ctx = null
      return false
    }
  }

  /** 감쇠 엔벨로프 하나로 대부분의 소리가 된다 */
  const blip = (
    freq: number, ms: number,
    opts: { type?: OscillatorType; gain?: number; delayMs?: number; endFreq?: number } = {},
  ): void => {
    if (!ctx || !master) return
    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + ms / 1000)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.8, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + ms / 1000)
    osc.connect(g)
    g.connect(master)
    osc.start(t0)
    osc.stop(t0 + ms / 1000 + 0.02)
  }

  /** 짧은 노이즈 버스트 — 목탁 계열 타격음의 몸통 */
  const noise = (ms: number, gain = 0.5, hz = 1800): void => {
    if (!ctx || !master) return
    const n = Math.max(1, Math.floor((ctx.sampleRate * ms) / 1000))
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    // 결정적 노이즈 — Math.random 을 시뮬에서 금지했으니 여기서도 안 쓴다(취향의 일관성)
    let seed = 0x2f6e2b1
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      d[i] = ((seed / 0xffffffff) * 2 - 1) * (1 - i / n)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(bp)
    bp.connect(g)
    g.connect(master)
    src.start()
  }

  return {
    unlock() { ensure() },
    ready: () => ctx !== null && ctx.state === 'running',

    /** 개찰구 "삑" — 실제 단말기의 1kHz 대역. 오마주지 인용이 아니다 */
    gate() {
      if (!ensure()) return
      blip(1046, 90, { gain: 0.75 })
    },

    /** 동전 "짤랑" — 배음 3개를 살짝 어긋나게 겹쳐 금속을 만든다 */
    coin() {
      if (!ensure()) return
      blip(2400, 60, { type: 'triangle', gain: 0.5 })
      blip(3100, 45, { type: 'triangle', gain: 0.35, delayMs: 18 })
      blip(4200, 35, { type: 'triangle', gain: 0.22, delayMs: 34 })
    },

    /** 단소 "딱!" — 목탁 계열. 둔기음 금지 (GDD §4.1 톤 가드레일) */
    danso() {
      if (!ensure()) return
      noise(14, 0.6, 2100)
      blip(880, 70, { type: 'triangle', gain: 0.45, endFreq: 520 })
    },

    /** 문 닫힘 경고 — 660Hz 3연타. 실제 안내음의 리듬만 빌린다 */
    doorWarn() {
      if (!ensure()) return
      for (let i = 0; i < 3; i++) blip(660, 190, { gain: 0.55, delayMs: i * 400 })
    },
  }
}
