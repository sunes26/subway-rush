/**
 * BGM — **녹음 트랙 5종**(`public/audio/*.mp3`). 판의 국면마다 한 곡씩이다.
 *
 *   title   타이틀 안내판           `title.mp3`        178s
 *   intro   버스 → 하차 애니메이션   `intro.mp3`         9.8s
 *   play    본편 3분                `play.mp3`         231s
 *   happy   탄 판 · 히든            `ending-happy.mp3`  96s
 *   bad     못 탄 판 · 즉사          `ending-bad.mp3`   116s
 *
 * ── **본편 곡만 낮게 깐다**(디렉터 지시)
 * 조작권이 넘어온 3분에는 앰비언스·발소리·심박이 이미 겹쳐 있다. 음악을 같은 크기로
 * 얹으면 남은 시간을 알리는 심박(`sfx.heartbeat`)이 묻히고, 그건 연출이 아니라 **정보**다.
 * 그래서 `play` 만 `GAIN` 으로 눌러 깐다 — 지우는 대신 아래에 둔다.
 *
 * ── `sfx.ts` 의 WebAudio 그래프에 물리지 않는다
 * 나머지 소리는 전부 `AudioContext` 위에 있는데 이것만 `HTMLAudioElement` 다.
 * 이유는 **울려야 하는 시점**이다:
 *   · WebAudio 컨텍스트는 첫 사용자 제스처에서 깨어난다(`main.ts handleMeta`).
 *     그런데 타이틀에서의 첫 제스처는 대개 `ENTER` — 게임을 시작하는 그 키다.
 *     컨텍스트에 물려 두면 음악이 나오는 순간이 곧 꺼지는 순간이 된다.
 *   · 트랙 하나가 3MB 다. `decodeAudioData` 로 통째로 펴면 PCM 30MB 가 상주하고,
 *     그게 네 곡이다. 엘리먼트는 스트리밍이라 받는 대로 흐른다.
 * 대가로 마스터 버스를 못 쓴다 → 볼륨·음소거를 `main.ts` 가 직접 먹여 준다.
 *
 * ── 엘리먼트는 **처음 요청받을 때** 만든다
 * 넷을 미리 만들면 타이틀에서 10MB 를 함께 받는다. 인트로·엔딩 트랙은 그 국면에
 * 처음 닿을 때 생기고, 그때는 이미 사용자가 `ENTER` 를 눌렀으므로 자동재생도 열려 있다.
 *
 * ★ 오디오가 실패해도 게임은 돈다(`sfx.ts` 헤더와 같은 태도).
 */

/** 국면 이름이 아니라 **곡** 이름이다 — 어떤 엔딩이 어느 곡인지는 `audio/cues.ts` 가 정한다 */
export type BgmTrack = 'title' | 'intro' | 'play' | 'happy' | 'bad'

const FILES: Readonly<Record<BgmTrack, string>> = {
  title: 'title.mp3',
  intro: 'intro.mp3',
  play: 'play.mp3',
  happy: 'ending-happy.mp3',
  bad: 'ending-bad.mp3',
}

/**
 * 곡별 상대 음량. **`play` 만 낮다** — 본편은 음악이 주인공이 아니라 배경이고,
 * 그 위의 심박·안내방송·호루라기가 정보를 나른다. 나머지 넷은 그 국면에서
 * 음악이 곧 연출이라 그대로 둔다.
 */
const GAIN: Readonly<Record<BgmTrack, number>> = {
  // 0.34 → 0.374 (디렉터 지시 2026-08-10: 그때의 10% 만큼 올린다)
  title: 1, intro: 1, play: 0.374, happy: 1, bad: 1,
}

export type Bgm = Readonly<{
  /**
   * 지금 흘러야 할 곡. `null` 이면 아무것도 안 흐른다.
   * **매 프레임 불러도 된다** — 값이 그대로면 아무 일도 하지 않는다.
   * 바뀌면 이전 곡은 페이드아웃하고 새 곡이 페이드인한다(둘이 잠깐 겹친다).
   */
  setTrack(t: BgmTrack | null): void
  /** 설정의 마스터 × 배경음 (0~1). 이 값에 `LEVEL` 이 곱해진다 */
  setVolume(v: number): void
  setMuted(m: boolean): void
  /** 지금 실제로 흐르고 있는 곡 (E2E — 자동재생이 막혔으면 `null`) */
  playing(): BgmTrack | null
  /** 즉시 정지 — 페이드 없음 */
  stop(): void
}>

const NOOP: Bgm = {
  setTrack: () => {}, setVolume: () => {}, setMuted: () => {},
  playing: () => null, stop: () => {},
}

/**
 * 트랙 레벨. 설정 슬라이더가 1 일 때의 최종 음량이다.
 * 1.0 으로 두면 절차 생성 효과음(마스터 0.34)보다 훨씬 커서 음악 구간만 시끄러워진다.
 */
const LEVEL = 0.5
/** 페이드 시정수 — 들어올 때는 여유 있게, 나갈 때는 다음 곡을 막지 않을 만큼 짧게 */
const FADE_IN_MS = 1200
const FADE_OUT_MS = 600
const STEP_MS = 50

/** 한 곡의 재생 상태. 엘리먼트와 **우리가 아는 게인**을 함께 들고 있다 */
type Voice = { el: HTMLAudioElement; vol: number }

export const createBgm = (baseUrl: string): Bgm => {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return NOOP

  const voices = new Map<BgmTrack, Voice>()
  /** 흘러야 할 곡 */
  let want: BgmTrack | null = null
  /** 설정 볼륨(마스터 × 배경음) */
  let scale = 1
  let muted = false
  let timer = 0
  let armed = false

  const voiceOf = (t: BgmTrack): Voice | null => {
    const had = voices.get(t)
    if (had) return had
    try {
      const el = new Audio(`${baseUrl}audio/${FILES[t]}`)
      el.loop = true
      el.preload = 'auto'
      el.volume = 0
      const v: Voice = { el, vol: 0 }
      voices.set(t, v)
      return v
    } catch {
      return null
    }
  }

  const targetOf = (t: BgmTrack): number =>
    (t === want && !muted ? LEVEL * scale * GAIN[t] : 0)

  /**
   * 자동재생이 막혔을 때의 두 번째 기회. 아무 클릭·키에서 다시 시도하고,
   * 성공하면 스스로 걷힌다 — 계속 붙어 있으면 판이 끝날 때까지 매 입력을 듣는다.
   */
  const disarm = (): void => {
    if (!armed) return
    armed = false
    window.removeEventListener('pointerdown', retry)
    window.removeEventListener('keydown', retry)
  }
  const arm = (): void => {
    if (armed) return
    armed = true
    window.addEventListener('pointerdown', retry)
    window.addEventListener('keydown', retry)
  }
  function retry(): void { if (want) start(want) }

  const start = (t: BgmTrack): void => {
    const v = voiceOf(t)
    if (!v) return
    void v.el.play().then(disarm).catch(arm)
  }

  const tick = (): void => {
    let settled = true
    for (const [t, v] of voices) {
      const to = targetOf(t)
      if (v.vol !== to) {
        const rate = STEP_MS / (to > v.vol ? FADE_IN_MS : FADE_OUT_MS)
        v.vol = to > v.vol ? Math.min(to, v.vol + rate) : Math.max(to, v.vol - rate)
        // 브라우저가 범위를 벗어난 값에 예외를 던진다 — 부동소수 오차까지 잘라 둔다
        v.el.volume = Math.min(1, Math.max(0, v.vol))
      }
      if (v.vol !== to) { settled = false; continue }
      // 도착 — 자기 차례가 아닌 곡은 실제로 멈추고 처음으로 되감는다.
      // 음소거는 **멈추지 않는다**(곡 위치를 잃으면 음소거가 곧 되감기가 된다).
      if (t !== want && !v.el.paused) { v.el.pause(); v.el.currentTime = 0 }
    }
    if (!settled) return
    window.clearInterval(timer)
    timer = 0
  }

  const pump = (): void => {
    if (timer !== 0) return
    timer = window.setInterval(tick, STEP_MS)
  }

  return {
    playing() {
      if (!want) return null
      const v = voices.get(want)
      return v && !v.el.paused ? want : null
    },

    setTrack(t) {
      if (t === want) return
      want = t
      if (t) start(t)
      pump()
    },

    setVolume(v) {
      scale = Math.min(1, Math.max(0, v))
      pump()
    },

    setMuted(m) {
      if (m === muted) return
      muted = m
      pump()
    },

    stop() {
      want = null
      for (const v of voices.values()) {
        v.vol = 0
        v.el.volume = 0
        v.el.pause()
        v.el.currentTime = 0
      }
      disarm()
      if (timer !== 0) { window.clearInterval(timer); timer = 0 }
    },
  }
}
