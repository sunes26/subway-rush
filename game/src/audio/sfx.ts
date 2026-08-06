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
  // ── P2 ──
  /** 발소리 1보. 존별 대역이 다르다(콘크리트/타일/보도) */
  step(kind: StepKind): void
  /** 안내방송 차임 — 열차 접근·문 닫힘 */
  announce(): void
  /** 심박 1회. 잔여 30s 미만에서만 부른다 */
  heartbeat(intensity: number): void
  /** 역무원 호루라기 */
  whistle(): void
  /** UI 틱 — 슬롯·대화·도감 */
  click(): void
  /** 전역 음소거 토글. 반환값은 **토글 후** 상태 */
  toggleMute(): boolean
  muted(): boolean
  /** 재생 횟수 — E2E 가 "실제로 울렸는가"를 보는 유일한 방법이다 */
  plays(): number
  /** 재생 가능한 상태인가 (E2E 확인용) */
  ready(): boolean
  /**
   * 살아 있는 AudioContext — **앰비언스가 이걸 빌려 쓴다.**
   * 컨텍스트를 따로 만들면 그쪽은 사용자 제스처 밖에서 생성돼 `suspended` 로 멈춘 채
   * 영원히 안 깨어난다(실측: 앰비언스가 한 번도 안 들렸다).
   */
  context(): AudioContext | null
  /** 효과음 버스 — 발소리가 여기 물린다. 설정의 "효과음" 슬라이더가 여기를 잡는다 */
  bus(): GainNode | null
  /** 배경음 버스 — 앰비언스가 여기 물린다. 설정의 "배경음악" 슬라이더가 여기를 잡는다 */
  musicBus(): GainNode | null
  /**
   * 설정 볼륨 반영. 셋 다 0~1 이고 **전부 1 이면 예전과 완전히 같은 소리**다
   * (기본값이 소리를 바꾸면 그건 설정이 아니라 리믹스다).
   */
  setVolumes(v: { master: number; bgm: number; sfx: number }): void
}>

/** 바닥 재질 — 대역이 다르다. 지하 타일은 밝고 지상 보도는 둔하다 */
export type StepKind = 'tile' | 'pavement' | 'stairs'

/** 브라우저가 WebAudio를 안 주거나 막으면 조용히 아무것도 안 한다 */
const NOOP: Sfx = {
  unlock: () => {},
  gate: () => {},
  coin: () => {},
  danso: () => {},
  doorWarn: () => {},
  step: () => {},
  announce: () => {},
  heartbeat: () => {},
  whistle: () => {},
  click: () => {},
  toggleMute: () => false,
  muted: () => false,
  plays: () => 0,
  ready: () => false,
  context: () => null,
  bus: () => null,
  musicBus: () => null,
  setVolumes: () => {},
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
  /**
   * 마스터 아래 두 갈래.
   *
   * 설정이 "배경음악"과 "효과음"을 따로 준다 — 한 버스에 다 물려 있으면 나눌 수가 없다.
   * 둘 다 기본 게인 1 이라 **분기 자체는 소리를 바꾸지 않는다**(게인 1 은 항등이다).
   */
  let sfxBus: GainNode | null = null
  let bgmBus: GainNode | null = null
  let isMuted = false
  let playCount = 0
  /** 설정의 마스터 슬라이더(0~1). `LEVEL` 에 곱해진다 */
  let masterScale = 1

  /**
   * 마스터 볼륨.
   *
   * P1 은 0.22 였다. 그때는 소리가 **네 개뿐이고 전부 사건음**(개찰구·동전·단소·문경고)이라
   * 각자 게인 0.5~0.8 을 썼다 — 실제 진폭 0.11~0.18. P2 가 넣은 발소리·심박·앰비언스는
   * 상시음이라 게인을 낮게 잡았고(0.16), 그 결과 진폭 **0.035** 로 사실상 안 들렸다.
   * 마스터를 올리고 상시음 게인도 같이 올린다 — 둘 중 하나만 올리면 사건음이 찢어진다.
   */
  const LEVEL = 0.34

  const ensure = (): boolean => {
    if (ctx) {
      // 사용자 제스처 전에 만들어졌으면 suspended 다 — 매번 깨워 준다
      if (ctx.state === 'suspended') void ctx.resume()
      return true
    }
    try {
      ctx = new AC() as Ctx
      master = ctx.createGain()
      master.gain.value = isMuted ? 0 : LEVEL * masterScale
      master.connect(ctx.destination)
      sfxBus = ctx.createGain()
      bgmBus = ctx.createGain()
      sfxBus.connect(master)
      bgmBus.connect(master)
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
    if (!ctx || !sfxBus) return
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
    g.connect(sfxBus)
    osc.start(t0)
    osc.stop(t0 + ms / 1000 + 0.02)
  }

  /** 짧은 노이즈 버스트 — 목탁 계열 타격음의 몸통 */
  const noise = (ms: number, gain = 0.5, hz = 1800): void => {
    if (!ctx || !sfxBus) return
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
    g.connect(sfxBus)
    src.start()
  }

  /** 소리 하나가 실제로 나갔다 — E2E 계수기 */
  const count = (): void => { if (!isMuted) playCount++ }

  return {
    unlock() { ensure() },
    ready: () => ctx !== null && ctx.state === 'running',
    context: () => ctx,
    bus: () => sfxBus,
    musicBus: () => bgmBus,
    muted: () => isMuted,

    setVolumes(v) {
      masterScale = Math.min(1, Math.max(0, v.master))
      if (!ctx) return
      const t = ctx.currentTime
      // 즉시 대입이 아니라 짧은 램프다 — 슬라이더를 끌면 프레임마다 값이 오는데
      // 그때마다 계단으로 꺾으면 "지직" 하는 클릭 노이즈가 난다
      master?.gain.setTargetAtTime(isMuted ? 0 : LEVEL * masterScale, t, 0.02)
      sfxBus?.gain.setTargetAtTime(Math.min(1, Math.max(0, v.sfx)), t, 0.02)
      bgmBus?.gain.setTargetAtTime(Math.min(1, Math.max(0, v.bgm)), t, 0.02)
    },
    plays: () => playCount,

    /**
     * 전역 음소거 — **마스터 게인 하나만 건드린다.**
     * 개별 소스를 멈추지 않는 이유: 이미 예약된 스케줄을 취소하려면 노드를 추적해야 하고,
     * 그건 절차 생성의 이점(상태 없음)을 통째로 버리는 일이다.
     */
    toggleMute() {
      isMuted = !isMuted
      if (master && ctx) master.gain.setTargetAtTime(isMuted ? 0 : LEVEL * masterScale, ctx.currentTime, 0.02)
      return isMuted
    },

    /** 개찰구 "삑" — 실제 단말기의 1kHz 대역. 오마주지 인용이 아니다 */
    gate() {
      if (!ensure()) return
      count()
      blip(1046, 90, { gain: 0.52 })
    },

    /** 동전 "짤랑" — 배음 3개를 살짝 어긋나게 겹쳐 금속을 만든다 */
    coin() {
      if (!ensure()) return
      count()
      blip(2400, 60, { type: 'triangle', gain: 0.36 })
      blip(3100, 45, { type: 'triangle', gain: 0.35, delayMs: 18 })
      blip(4200, 35, { type: 'triangle', gain: 0.22, delayMs: 34 })
    },

    /** 단소 "딱!" — 목탁 계열. 둔기음 금지 (GDD §4.1 톤 가드레일) */
    danso() {
      if (!ensure()) return
      count()
      noise(14, 0.6, 2100)
      blip(880, 70, { type: 'triangle', gain: 0.45, endFreq: 520 })
    },

    /** 문 닫힘 경고 — 660Hz 3연타. 실제 안내음의 리듬만 빌린다 */
    doorWarn() {
      if (!ensure()) return
      count()
      for (let i = 0; i < 3; i++) blip(660, 190, { gain: 0.40, delayMs: i * 400 })
    },

    /**
     * 발소리 — 노이즈 버스트 하나. **재질은 대역과 길이로만 구분한다.**
     * 지하 타일은 밝고 짧게, 보도는 둔하고 길게, 계단은 그 중간에 금속 성분을 얹는다.
     */
    step(kind) {
      if (!ensure()) return
      count()
      if (kind === 'tile') noise(26, 0.44, 1250)
      else if (kind === 'pavement') noise(34, 0.38, 620)
      else { noise(22, 0.42, 1500); blip(2100, 26, { type: 'triangle', gain: 0.18 }) }
    },

    /**
     * 안내방송 차임 — 도-미-솔 **하강** 3음.
     * 실제 안내음의 *리듬만* 빌린다(개찰구 삑과 같은 태도: 오마주지 인용이 아니다).
     */
    announce() {
      if (!ensure()) return
      count()
      const notes = [784, 659, 523]
      notes.forEach((f, i) => blip(f, 340, { type: 'sine', gain: 0.66, delayMs: i * 230 }))
    },

    /**
     * 심박 — 저역 2연타(쿵-쿵). **잔여 30초 미만에서만** 호출된다(`main.ts`).
     * 3분 내내 울리면 긴박이 아니라 피로다.
     */
    heartbeat(intensity) {
      if (!ensure()) return
      count()
      const g = 0.62 * Math.max(0.35, Math.min(1, intensity))
      blip(62, 130, { type: 'sine', gain: g, endFreq: 44 })
      blip(58, 110, { type: 'sine', gain: g * 0.7, endFreq: 42, delayMs: 165 })
    },

    /** 호루라기 — 사각파 트릴. 역무원 적발의 0.8초 유예를 **들리게** 만든다 */
    whistle() {
      if (!ensure()) return
      count()
      for (let i = 0; i < 4; i++) {
        blip(2400, 70, { type: 'square', gain: 0.5, delayMs: i * 85, endFreq: 2650 })
      }
    },

    /** UI 틱 — 짧고 건조하게. 이게 길면 슬롯을 연타할 때 소리가 뭉친다 */
    click() {
      if (!ensure()) return
      count()
      blip(1600, 26, { type: 'triangle', gain: 0.34 })
    },
  }
}
