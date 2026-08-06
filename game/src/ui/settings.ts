/**
 * UI-15 설정 화면 (SCN-09) — Figma `node 15:4`.
 *
 * ESC 로 열리는 **일시정지 겸 설정** 패널이다. 두 역할을 한 화면에 둔 이유:
 * 3분 타이머가 도는 게임에서 "설정을 보는 동안 시간이 흘렀다"는 납득이 안 된다.
 * 그래서 여는 순간 멈추고, 멈췄다는 사실을 `PAUSED` 칩으로 화면에 적는다.
 *
 * ★ 이 모듈은 **값만 만들고 적용은 하지 않는다.** 볼륨·감도·해상도를 실제로 먹이는 건
 *   `main.ts` 다(오디오 버스·입력·렌더러는 전부 거기 있다). UI 가 직접 그것들을
 *   잡으면 UI 킷에서 패널만 띄우는 순간 정의되지 않은 객체를 만지게 된다.
 */

import CSS from './css/settings.css?inline'
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, SENS_MAX, SENS_MIN,
  type ResKey, type ScreenMode, type Settings,
} from '../core/settings'

/** 톱니 — 헤더 아이콘. 12각 톱니를 코드로 돌려 만든다(에셋 하나를 아끼려는 게 아니라, 각 수를 조정할 수 있다) */
const gearSvg = ((teeth = 12, ro = 10, ri = 7.6): string => {
  const pts: string[] = []
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? ro : ri
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`)
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linejoin="round"><polygon points="${pts.join(' ')}"/><circle cx="12" cy="12" r="3.4"/></svg>`
})()

const RES_LABEL: Readonly<Record<ResKey, string>> = {
  high: '100% (네이티브)', mid: '75%', low: '50%',
}
const SCREEN_LABEL: Readonly<Record<ScreenMode, string>> = {
  windowed: '창 모드', fullscreen: '전체 화면',
}

export type SettingsUi = Readonly<{
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** 현재 값 — `main.ts` 가 부팅 직후 한 번 읽어 초기 적용한다 */
  values(): Settings
  el: HTMLElement
}>

export type SettingsHooks = Readonly<{
  /** 값이 하나라도 바뀌면 부른다. 저장은 이 모듈이 이미 끝냈다 */
  onChange(s: Settings): void
  /** "홈으로 돌아가기" — 타이틀로 되돌린다 */
  onHome(): void
  /** 열림/닫힘 전이. `main.ts` 가 여기서 루프를 멈추고 되살린다 */
  onToggle?(open: boolean): void
}>

const pct = (v: number): string => `${Math.round(v * 100)}%`

export const createSettings = (mount: HTMLElement, hooks: SettingsHooks): SettingsUi => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'settings'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '설정')

  const opt = <T extends string>(map: Readonly<Record<T, string>>, cur: T): string =>
    (Object.keys(map) as T[])
      .map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${map[k]}</option>`)
      .join('')

  let cur: Settings = loadSettings()

  el.innerHTML = `
    <div class="panel">
      <div class="head">${gearSvg}<h2>설정</h2><span class="paused">PAUSED</span></div>

      <div class="sec">
        <h3>사운드</h3>
        <div class="row"><label for="set-master">마스터 볼륨</label>
          <input id="set-master" type="range" min="0" max="100" step="1">
          <span class="val" id="val-master"></span></div>
        <div class="row"><label for="set-bgm">배경음악</label>
          <input id="set-bgm" type="range" min="0" max="100" step="1">
          <span class="val" id="val-bgm"></span></div>
        <div class="row"><label for="set-sfx">효과음</label>
          <input id="set-sfx" type="range" min="0" max="100" step="1">
          <span class="val" id="val-sfx"></span></div>
      </div>

      <div class="sec">
        <h3>조작</h3>
        <div class="row"><label for="set-sens">마우스 감도</label>
          <input id="set-sens" type="range" min="${Math.round(SENS_MIN * 100)}"
            max="${Math.round(SENS_MAX * 100)}" step="5">
          <span class="val" id="val-sens"></span></div>
        <div class="row"><label id="lab-invert">마우스 반전</label>
          <span class="sw"><button id="set-invert" type="button" role="switch"
            aria-labelledby="lab-invert"></button></span>
          <span class="val" id="val-invert"></span></div>
      </div>

      <div class="sec">
        <h3>그래픽</h3>
        <div class="row"><label for="set-res">해상도</label>
          <select id="set-res">${opt(RES_LABEL, cur.res)}</select></div>
        <div class="row"><label for="set-screen">화면 모드</label>
          <select id="set-screen">${opt(SCREEN_LABEL, cur.screen)}</select></div>
      </div>

      <div class="foot">
        <button class="home" type="button" id="set-home">홈으로 돌아가기</button>
        <button class="close" type="button" id="set-close">닫기 (ESC)</button>
      </div>
    </div>`
  mount.appendChild(el)

  const $ = <T extends HTMLElement>(id: string): T => el.querySelector<T>(`#${id}`) as T
  const rMaster = $<HTMLInputElement>('set-master')
  const rBgm = $<HTMLInputElement>('set-bgm')
  const rSfx = $<HTMLInputElement>('set-sfx')
  const rSens = $<HTMLInputElement>('set-sens')
  const bInvert = $<HTMLButtonElement>('set-invert')
  const selRes = $<HTMLSelectElement>('set-res')
  const selScreen = $<HTMLSelectElement>('set-screen')

  /** 화면을 값에 맞춘다. 입력 이벤트가 아니라 **상태**가 화면을 정한다 */
  const paint = (): void => {
    rMaster.value = String(Math.round(cur.master * 100))
    rBgm.value = String(Math.round(cur.bgm * 100))
    rSfx.value = String(Math.round(cur.sfx * 100))
    rSens.value = String(Math.round(cur.sens * 100))
    $('val-master').textContent = pct(cur.master)
    $('val-bgm').textContent = pct(cur.bgm)
    $('val-sfx').textContent = pct(cur.sfx)
    $('val-sens').textContent = pct(cur.sens)
    bInvert.setAttribute('aria-checked', String(cur.invertY))
    $('val-invert').textContent = cur.invertY ? 'ON' : 'OFF'
    selRes.value = cur.res
    selScreen.value = cur.screen
  }

  const commit = (patch: Partial<Settings>): void => {
    cur = saveSettings({ ...cur, ...patch })
    paint()
    hooks.onChange(cur)
  }

  const bindRange = (input: HTMLInputElement, key: 'master' | 'bgm' | 'sfx' | 'sens'): void => {
    // `input` 이지 `change` 가 아니다 — 끄는 도중에 소리가 따라와야 값을 고를 수 있다
    input.addEventListener('input', () => { commit({ [key]: Number(input.value) / 100 } as Partial<Settings>) })
  }
  bindRange(rMaster, 'master')
  bindRange(rBgm, 'bgm')
  bindRange(rSfx, 'sfx')
  bindRange(rSens, 'sens')

  bInvert.addEventListener('click', () => { commit({ invertY: !cur.invertY }) })
  selRes.addEventListener('change', () => { commit({ res: selRes.value as ResKey }) })
  selScreen.addEventListener('change', () => { commit({ screen: selScreen.value as ScreenMode }) })

  let open = false
  const setOpen = (v: boolean): void => {
    if (open === v) return
    open = v
    el.className = v ? 'on' : ''
    if (v) paint()
    hooks.onToggle?.(v)
  }

  $('set-close').addEventListener('click', () => { setOpen(false) })
  $('set-home').addEventListener('click', () => { setOpen(false); hooks.onHome() })

  paint()

  return {
    el,
    open: () => { setOpen(true) },
    close: () => { setOpen(false) },
    toggle: () => { setOpen(!open) },
    isOpen: () => open,
    values: () => cur,
  }
}

export { DEFAULT_SETTINGS }
