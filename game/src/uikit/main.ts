/**
 * UI 킷 — 게임의 실제 UI 코드를 상태만 바꿔 가며 보는 작업대.
 *
 * ★ 이 페이지는 UI를 **다시 만들지 않는다.** `createHud` · `createDialog` 를 그대로 부르고,
 *   스타일도 게임과 같은 파일(`src/ui/css/*.css`)을 쓴다. 그래서 여기서 다듬은 결과가
 *   곧 게임의 결과다 — 이식 단계가 없다.
 *
 * 왜 카드 격자가 아니라 상태 선택기인가: UI 스타일이 `#id` 선택자로 짜여 있어서
 * 한 페이지에 두 인스턴스를 올리면 id 가 충돌한다. 게임 코드를 킷 편의를 위해
 * 고치는 것은 순서가 거꾸로다 — 대신 한 번에 한 상태를 **크게** 본다.
 * 디자인 판단에도 그게 낫다.
 */

import { createDialog } from '../ui/dialog'
import { createHud } from '../ui/hud'
import { GROUPS, PRESETS, type Preset } from './presets'

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel) as T

const stage = $('#stage')
const stageUi = $('#stage-ui')
const list = $('#list')
const note = $('#note')
const playBtn = $('#btn-play')

const hud = createHud(stageUi)
const dialog = createDialog(stageUi)
// 킷은 1인칭 조준점을 켜 둔다 — 프롬프트가 조준점 기준으로 배치되므로 같이 봐야 한다
hud.setCrosshair(true)

/**
 * 배경 — UI 는 배경 위에서 읽혀야 한다.
 *
 * E2E 가 남긴 실제 게임 스크린샷을 그대로 쓴다. 단색 위에서만 확인하면
 * "대합실 형광등 아래에서 흰 글자가 날아가는" 종류의 문제를 못 잡는다.
 */
const BACKDROPS: Readonly<Record<string, string>> = {
  dark: '',
  grid: '',
  concourse: new URL('../../tests/e2e/__shots__/p1/02-hud-inventory.png', import.meta.url).href,
  vending: new URL('../../tests/e2e/__shots__/p1/04-qte-vending.png', import.meta.url).href,
  chase: new URL('../../tests/e2e/__shots__/p1/05-chase-danso.png', import.meta.url).href,
}

let current: Preset = PRESETS[0] as Preset
let playing = true
let t0 = performance.now()

const setBackdrop = (key: string): void => {
  const url = BACKDROPS[key] ?? ''
  stage.style.backgroundImage = url ? `url("${url}")` : 'none'
  stage.className = key === 'grid' ? 'grid' : ''
  for (const b of document.querySelectorAll<HTMLElement>('#bar [data-bg]')) {
    b.classList.toggle('on', b.dataset['bg'] === key)
  }
}

/** 무대는 논리 1280×720 고정. 화면이 좁으면 배율만 줄인다 — 레이아웃은 안 건드린다 */
const setZoom = (key: string): void => {
  const wrap = $('#wrap')
  const fit = Math.min((wrap.clientWidth - 44) / 1280, (wrap.clientHeight - 44) / 720, 1)
  const z = key === 'fit' ? fit : Number(key)
  stage.style.transform = `scale(${z})`
  for (const b of document.querySelectorAll<HTMLElement>('#bar [data-zoom]')) {
    b.classList.toggle('on', b.dataset['zoom'] === key)
  }
}

const select = (p: Preset): void => {
  current = p
  t0 = performance.now()
  note.textContent = p.note
  for (const b of list.querySelectorAll<HTMLElement>('button')) {
    b.classList.toggle('on', b.dataset['id'] === p.id)
  }
  // URL 에 남긴다 — 특정 상태를 링크로 주고받을 수 있어야 리뷰가 된다
  history.replaceState(null, '', `?p=${p.id}`)
}

// ── 사이드바
for (const g of GROUPS) {
  const h = document.createElement('div')
  h.className = 'grp'
  h.textContent = g
  list.appendChild(h)
  for (const p of PRESETS.filter((x) => x.group === g)) {
    const b = document.createElement('button')
    b.dataset['id'] = p.id
    b.innerHTML = `${p.label}<small>${p.id}</small>`
    b.addEventListener('click', () => select(p))
    list.appendChild(b)
  }
}

for (const b of document.querySelectorAll<HTMLElement>('#bar [data-bg]')) {
  b.addEventListener('click', () => setBackdrop(b.dataset['bg'] as string))
}
for (const b of document.querySelectorAll<HTMLElement>('#bar [data-zoom]')) {
  b.addEventListener('click', () => setZoom(b.dataset['zoom'] as string))
}
playBtn.addEventListener('click', () => {
  playing = !playing
  playBtn.textContent = playing ? '애니 정지' : '애니 재생'
  playBtn.classList.toggle('on', !playing)
  if (playing) t0 = performance.now()
})

/** ←/→ 로 상태를 훑는다. 디자인 검토는 연속으로 넘겨 보는 게 빠르다 */
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const i = PRESETS.findIndex((p) => p.id === current.id)
  const next = (i + (e.key === 'ArrowDown' ? 1 : PRESETS.length - 1)) % PRESETS.length
  select(PRESETS[next] as Preset)
})

// ── 루프. 게임과 달리 시뮬은 없다 — 프리셋이 만든 상태를 그대로 그린다
let frozen = 0
const loop = (now: number): void => {
  requestAnimationFrame(loop)
  if (playing) frozen = (now - t0) / 1000
  const s = current.state(frozen)
  // 두 번째 인자는 "포인터가 잠겼는가" — 킷에서는 항상 잠긴 것으로 본다.
  // 안 그러면 "화면을 클릭하면…" 안내가 상시 떠서 화면을 가린다.
  hud.sync(s, true)
  dialog.sync(s)
}

setBackdrop('concourse')
setZoom('fit')
window.addEventListener('resize', () => {
  const on = document.querySelector<HTMLElement>('#bar [data-zoom].on')
  setZoom(on?.dataset['zoom'] ?? 'fit')
})

// `?p=` 로 들어온 상태를 복원한다
const wanted = new URLSearchParams(location.search).get('p')
select(PRESETS.find((p) => p.id === wanted) ?? (PRESETS[0] as Preset))
requestAnimationFrame(loop)
