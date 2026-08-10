/**
 * BGM — 어느 곡이 언제 흐르는가 (`src/audio/bgm.ts` · `main.ts bgmTrackOf`).
 *
 * 이것만 `HTMLAudioElement` 라 나머지 오디오(WebAudio)와 검증 방법이 다르다.
 * 브라우저를 띄우지 않고 잠글 수 있는 것은 **상태 기계**다: 언제 play 를 부르는가,
 * 자동재생이 거절당하면 어떻게 되는가, 곡이 바뀔 때 이전 곡은 정말 멈추는가.
 * (실제 소리는 E2E 가 `__game.bgmPlaying()` 으로 본다.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBgm } from '../../src/audio/bgm'
import { bgmTrackOf } from '../../src/audio/cues'
import { ENDINGS, endingOf } from '../../src/data/endings'
import type { GameState } from '../../src/state/types'
import { start } from './_pilot'

type Listener = () => void

class FakeAudio {
  loop = false
  preload = ''
  volume = 1
  paused = true
  currentTime = 0
  playCalls = 0
  /** play() 를 거절한다 — 브라우저 자동재생 차단을 흉내 낸다 */
  blocked = false
  constructor(public src: string) {
    // 엘리먼트는 필요할 때 생기고 **곧바로** play 를 부른다. 그래서 차단은
    // 생성 시점에 이미 서 있어야 한다 — 만든 뒤에 켜면 첫 시도를 놓친다.
    this.blocked = FakeAudio.blockNew
    FakeAudio.made.push(this)
  }
  static made: FakeAudio[] = []
  /** 앞으로 만들어질 엘리먼트를 전부 막는다 */
  static blockNew = false
  static of(file: string): FakeAudio | undefined {
    return FakeAudio.made.find((a) => a.src.endsWith(file))
  }
  play(): Promise<void> {
    this.playCalls++
    if (this.blocked) return Promise.reject(new Error('NotAllowedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void { this.paused = true }
}

const g = globalThis as unknown as Record<string, unknown>
let listeners: Map<string, Set<Listener>>

/** 창에 붙은 리스너를 직접 때린다 — 자동재생 재시도 경로의 유일한 입구다 */
const fire = (type: string): void => { for (const f of listeners.get(type) ?? []) f() }

beforeEach(() => {
  vi.useFakeTimers()
  listeners = new Map()
  FakeAudio.made = []
  FakeAudio.blockNew = false
  g['Audio'] = FakeAudio
  g['window'] = {
    addEventListener: (t: string, f: Listener) => {
      const set = listeners.get(t) ?? new Set<Listener>()
      set.add(f)
      listeners.set(t, set)
    },
    removeEventListener: (t: string, f: Listener) => { listeners.get(t)?.delete(f) },
    // 페이크 타이머가 갈아 끼운 전역을 **호출 시점에** 읽는다
    setInterval: (f: () => void, ms: number) => setInterval(f, ms),
    clearInterval: (id: number) => { clearInterval(id) },
  }
})

afterEach(() => {
  delete g['window']
  delete g['Audio']
  vi.useRealTimers()
})

describe('BGM — 트랙 전환', () => {
  it('베이스 URL 아래 곡 파일을 루프로 문다', () => {
    const bgm = createBgm('/sub/')
    bgm.setTrack('title')
    const el = FakeAudio.of('audio/title.mp3')
    expect(el?.src).toBe('/sub/audio/title.mp3')
    expect(el?.loop).toBe(true)
  })

  it('요청받기 전에는 엘리먼트를 만들지 않는다 — 타이틀에서 네 곡을 받지 않는다', () => {
    const bgm = createBgm('/')
    bgm.setTrack('title')
    expect(FakeAudio.made).toHaveLength(1)
    bgm.setTrack('intro')
    expect(FakeAudio.made).toHaveLength(2)
  })

  it('켜면 재생하고 볼륨이 올라간다 — 즉시 최대가 아니라 페이드다', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('title')
    await vi.advanceTimersByTimeAsync(50)
    const el = FakeAudio.of('title.mp3')
    expect(el?.playCalls).toBe(1)
    expect(el?.paused).toBe(false)
    expect(el?.volume).toBeGreaterThan(0)
    expect(el?.volume).toBeLessThan(0.2)
    await vi.advanceTimersByTimeAsync(1200)
    expect(el?.volume).toBeCloseTo(0.5, 3)
  })

  it('곡이 바뀌면 이전 곡은 페이드아웃 뒤 **멈추고 되감긴다**', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('title')
    await vi.advanceTimersByTimeAsync(1200)
    const prev = FakeAudio.of('title.mp3')
    if (prev) prev.currentTime = 12
    bgm.setTrack('intro')
    // 겹치는 구간 — 새 곡은 벌써 흐르고 이전 곡은 아직 안 끊겼다
    await vi.advanceTimersByTimeAsync(100)
    expect(FakeAudio.of('intro.mp3')?.paused).toBe(false)
    expect(prev?.paused).toBe(false)
    await vi.advanceTimersByTimeAsync(1200)
    expect(prev?.volume).toBe(0)
    expect(prev?.paused).toBe(true)
    expect(prev?.currentTime).toBe(0)
    expect(FakeAudio.of('intro.mp3')?.volume).toBeCloseTo(0.5, 3)
  })

  it('null 이면 다 멈춘다', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('intro')
    await vi.advanceTimersByTimeAsync(1200)
    bgm.setTrack(null)
    await vi.advanceTimersByTimeAsync(700)
    expect(FakeAudio.of('intro.mp3')?.paused).toBe(true)
    expect(bgm.playing()).toBe(null)
  })

  it('본편 곡만 낮게 깔린다 — 그 위에 심박이 있어야 한다', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('play')
    await vi.advanceTimersByTimeAsync(1200)
    const play = FakeAudio.of('play.mp3')?.volume ?? 0
    bgm.setTrack('title')
    await vi.advanceTimersByTimeAsync(1200)
    const title = FakeAudio.of('title.mp3')?.volume ?? 0
    expect(play).toBeGreaterThan(0)
    expect(play).toBeLessThan(title / 2)
  })

  it('음소거는 소리만 죽인다 — 멈추지 않아 곡 위치를 잃지 않는다', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('happy')
    await vi.advanceTimersByTimeAsync(1200)
    bgm.setMuted(true)
    await vi.advanceTimersByTimeAsync(1000)
    const el = FakeAudio.of('ending-happy.mp3')
    expect(el?.volume).toBe(0)
    expect(el?.paused).toBe(false)
    bgm.setMuted(false)
    await vi.advanceTimersByTimeAsync(1200)
    expect(el?.volume).toBeCloseTo(0.5, 3)
  })

  it('설정 볼륨이 곱해진다 — 0 이면 무음이다', async () => {
    const bgm = createBgm('/')
    bgm.setVolume(0.4)
    bgm.setTrack('bad')
    await vi.advanceTimersByTimeAsync(1200)
    expect(FakeAudio.of('ending-bad.mp3')?.volume).toBeCloseTo(0.2, 3)
  })

  it('자동재생이 막히면 첫 입력에서 다시 시도한다', async () => {
    FakeAudio.blockNew = true
    const bgm = createBgm('/')
    bgm.setTrack('title')
    const el = FakeAudio.of('title.mp3')
    await vi.advanceTimersByTimeAsync(50)
    // 생성 직후 한 번 시도했고 거절당했다
    expect(el?.paused, '거절당했으니 아직 안 흐른다').toBe(true)
    const before = el?.playCalls ?? 0
    if (el) el.blocked = false
    fire('keydown')
    await vi.advanceTimersByTimeAsync(50)
    expect(el?.playCalls).toBe(before + 1)
    expect(el?.paused).toBe(false)
    // 성공했으면 리스너는 스스로 걷힌다 — 판이 끝날 때까지 매 입력을 듣지 않는다
    expect(listeners.get('keydown')?.size ?? 0).toBe(0)
  })

  it('꺼진 뒤에는 입력이 와도 재생하지 않는다', async () => {
    FakeAudio.blockNew = true
    const bgm = createBgm('/')
    bgm.setTrack('title')
    const el = FakeAudio.of('title.mp3')
    await vi.advanceTimersByTimeAsync(50)
    bgm.setTrack(null)
    if (el) el.blocked = false
    fire('pointerdown')
    await vi.advanceTimersByTimeAsync(50)
    expect(el?.paused).toBe(true)
  })

  it('매 프레임 같은 값을 먹여도 play 를 다시 부르지 않는다', async () => {
    const bgm = createBgm('/')
    for (let i = 0; i < 60; i++) bgm.setTrack('title')
    await vi.advanceTimersByTimeAsync(1200)
    expect(FakeAudio.of('title.mp3')?.playCalls).toBe(1)
  })

  it('stop 은 페이드 없이 즉시 끊는다', async () => {
    const bgm = createBgm('/')
    bgm.setTrack('title')
    await vi.advanceTimersByTimeAsync(1200)
    bgm.stop()
    expect(FakeAudio.of('title.mp3')?.volume).toBe(0)
    expect(FakeAudio.of('title.mp3')?.paused).toBe(true)
    expect(bgm.playing()).toBe(null)
  })
})

/** 곡 선택은 순수 함수라 그대로 부른다 — `main.ts` 가 쓰는 바로 그 함수다 */
const trackOf = bgmTrackOf

describe('BGM — 국면별 곡', () => {
  it('국면마다 곡이 하나씩 — 탑승 중에도 본편 곡이 이어진다', () => {
    expect(trackOf(start(7, { phase: 'title' }))).toBe('title')
    expect(trackOf(start(7, { phase: 'intro' }))).toBe('intro')
    expect(trackOf(start(7, { phase: 'playing' }))).toBe('play')
    expect(trackOf(start(7, { phase: 'boarding' }))).toBe('play')
  })

  it('성공 엔딩은 해피, 실패 엔딩은 배드', () => {
    const ended = (id: string): GameState =>
      start(7, { phase: 'ended', endingId: id as GameState['endingId'] })
    expect(trackOf(ended('E-01'))).toBe('happy')
    expect(trackOf(ended('E-06'))).toBe('bad')
    expect(trackOf(ended('E-09'))).toBe('bad')
  })

  it('히든 4종은 전부 성취 계열이라 해피가 흐른다', () => {
    const hidden = ENDINGS.filter((e) => e.tone === 'hidden')
    expect(hidden.length).toBeGreaterThan(0)
    for (const e of hidden) {
      const s = start(7, { phase: 'ended', endingId: e.id })
      expect(trackOf(s), `${e.id} ${e.title}`).toBe('happy')
    }
  })

  it('강제 엔딩(E-15·E-16)도 발행된 id 를 따른다 — 재계산이 이기면 곡이 어긋난다', () => {
    for (const id of ['E-15', 'E-16'] as const) {
      const s = start(7, { phase: 'ended', endingId: id })
      expect(endingOf(s).id).toBe(id)
      expect(trackOf(s)).toBe('bad')
    }
  })
})
