/**
 * HUD — LED 전광판 · 타이머 · 잔액 · 스태미너 · 피드백.
 *
 * DOM으로 그린다. 60fps 루프에 리액트 리컨실리에이션을 끼울 이유가 없다.
 * 갱신은 "값이 바뀐 노드만" 건드린다.
 */

import { formatClock } from '../core/math'
import { itemDef } from '../data/items'
import { FARE, SLOTS, TIMER_STAGES } from '../data/tuning'
import { ledText } from '../systems/gates'
import { lightIsGreen, lightRemainSec } from '../systems/tick'
import { CROSSWALK, FLOOR, ZONE_NAMES } from '../data/world'
import type { GameState } from '../state/types'
// 스타일은 `css/hud.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
// `?inline` 은 파일 내용을 문자열로 준다: 주입 방식(<style> 삽입)은 예전과 같다.
import CSS from './css/hud.css?inline'
/**
 * Figma `game-hud-ui` 에서 내보낸 아이콘 **원본 그대로**를 인라인한다.
 * `?raw` 라서 파일이 곧 에셋이고, 다시 그리거나 대체하지 않는다.
 * (게이지 링은 값이 매 프레임 바뀌므로 정적 SVG 로 표현할 수 없다 — `hud.css` 의 conic-gradient)
 */
import iconBackpack from './icons/backpack.svg?raw'
import iconCoin from './icons/coin.svg?raw'

/**
 * 신호 표시를 띄우는 범위.
 *
 * 차단벽은 횡단보도 서쪽 연석(x −31.3)에만 서므로 서쪽 접근로가 본체다.
 * 건너는 **도중**에도 남은 시간을 봐야 하니 횡단보도 끝(xMax)까지 이어 둔다.
 * 6.5 m 는 걷기 속도(5 m/s)로 1.3초 — 벽에 닿기 전에 읽을 시간이 나온다.
 */
const SIGNAL_BAND = {
  xMin: CROSSWALK.xMin - 6.5, xMax: CROSSWALK.xMax,
  yMin: CROSSWALK.yMin - 1.0, yMax: CROSSWALK.yMax + 1.0,
} as const

const nearCrossing = (x: number, y: number, z: number): boolean =>
  Math.abs(z - FLOOR.L0) < 1.2 &&
  x > SIGNAL_BAND.xMin && x < SIGNAL_BAND.xMax &&
  y > SIGNAL_BAND.yMin && y < SIGNAL_BAND.yMax

const stage = (ms: number): '' | 'warn' | 'hot' | 'crit' =>
  ms > TIMER_STAGES.calm ? '' : ms > TIMER_STAGES.warn ? 'warn' : ms > TIMER_STAGES.hot ? 'hot' : 'crit'

export type Hud = Readonly<{
  sync(s: GameState, pointerLocked: boolean): void
  setCrosshair(on: boolean): void
  el: HTMLElement
}>

export const createHud = (mount: HTMLElement): Hud => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const el = document.createElement('div')
  el.id = 'hud'
  /**
   * 레이아웃 출처: Figma `game-hud-ui` (node 4:4).
   * 예전 하단 4칸 `foot` 바는 없앴다 — Zone 은 미니맵 배너로, 잔액은 우하단 배지로,
   * 스태미너는 좌상단 원형으로, 소지품은 하단 중앙 패널로 흩어졌다.
   */
  el.innerHTML = `
    <div class="bar hud-panel">
      <div class="marquee"><span id="hud-led"></span></div>
      <div class="clock" id="hud-clock"><small>열차 도착</small><b id="hud-time">3:00</b></div>
    </div>

    <div id="stam-w">
      <div id="stam-ring"><div id="stam-g"></div><div id="stam-n">100%</div></div>
      <div id="stam-l">스태미너</div>
    </div>

    <div id="mini" class="hud-panel locked">
      <div id="mini-r">
        <div id="mini-lock"><b>미니맵 잠김</b>노선도를 구해야<br>지도를 볼 수 있다</div>
        <div id="mini-z">—</div>
      </div>
    </div>
    <div id="coord">—</div>

    <div id="cons"><i id="cons-i"></i><u></u></div>
    <div id="inv-p" class="hud-panel">
      <div id="inv-h">
        <div class="t">${iconBackpack}<span>소지품</span></div>
        <div class="c" id="inv-c">0 / ${SLOTS}</div>
      </div>
      <div class="inv" id="hud-inv"></div>
    </div>

    <div id="rb">
      <div id="bal-b" class="hud-panel">
        ${iconCoin}<span class="k">잔액</span><span class="v" id="hud-bal">—</span>
      </div>
      <div id="lockhint">화면을 클릭하면 시점이 잠깁니다 · <em>ESC 해제</em></div>
    </div>

    <div id="fx"></div>
    <div id="vig"></div>
    <div id="cross"><i></i><i></i><i></i><i></i></div>
    <div id="sig"></div>`
  mount.appendChild(el)

  const $ = <T extends HTMLElement>(id: string): T => el.querySelector<T>(`#${id}`) as T
  const led = $('hud-led')
  const clock = $('hud-clock')
  const time = $('hud-time')
  const zoneEl = $('mini-z')
  const balEl = $('hud-bal')
  const stamWrap = $('stam-w')
  const stamRing = $('stam-g')
  const stamNum = $('stam-n')
  const invCount = $('inv-c')
  const coordEl = $('coord')
  const fxBox = $('fx')
  const vig = $('vig')
  const cross = $('cross')
  const sig = $('sig')
  const lockHint = $('lockhint')
  const invEl = $('hud-inv')
  const consEl = $('cons')
  const consFill = $('cons-i')
  let firstPerson = true

  // 슬롯 노드는 처음 한 번만 만든다 — 매 프레임 innerHTML을 쓰면 60fps로 파서를 돌린다
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const d = document.createElement('div')
    d.className = 'slot'
    d.innerHTML = `<b>${i + 1}</b><span></span>`
    invEl.appendChild(d)
    return { box: d, glyph: d.querySelector('span') as HTMLElement, last: '' }
  })
  let lastCons = -99
  let consLitUntil = 0

  let lastLed = ''
  let lastTime = ''
  let lastStage = 'x'
  let lastZone = ''
  let lastBal = -1
  let lastStam = -1
  let lastInvCount = -1
  let lastLow = false
  let lastLocked = false
  let lastCoord = ''
  let lastSig = ''
  const shown = new Map<number, HTMLElement>()

  return {
    el,
    setCrosshair(on) { firstPerson = on; cross.className = on ? 'on' : '' },
    sync(s, pointerLocked) {
      lockHint.className =
        firstPerson && !pointerLocked && (s.phase === 'playing' || s.phase === 'boarding') ? 'on' : ''
      cross.className = firstPerson && pointerLocked ? 'on' : ''
      const ledMsg = ledText(s)
      if (ledMsg !== lastLed) { led.textContent = ledMsg; lastLed = ledMsg }

      // 자유 탐색이면 시계가 안 줄어든다. 표시가 없으면 **버그로 오해한다.**
      const t = s.freeplay ? '∞' : formatClock(s.timeLeftMs)
      if (t !== lastTime) { time.textContent = t; lastTime = t }
      const st = s.freeplay ? '' : stage(s.timeLeftMs)
      if (st !== lastStage) { clock.className = `clock ${st}`; lastStage = st }

      // 좌표는 매 프레임 바뀌므로 **소수 한 자리로 끊어** 문자열이 같으면 DOM 을 안 건드린다.
      // 안 그러면 60 fps 로 textContent 를 쓰게 된다.
      const p = s.player.pos
      const co = `<b>x</b> ${p.x.toFixed(1)}  <b>y</b> ${p.y.toFixed(1)}  <b>z</b> ${p.z.toFixed(1)}`
      if (co !== lastCoord) { coordEl.innerHTML = co; lastCoord = co }

      // 횡단보도 신호 — 위 `#sig` 주석 참조. 적신호는 금지가 아니라 위험 경고다.
      // 남은 시간은 올림해서 "0초"가 화면에 뜨는 구간을 없앤다.
      const green = lightIsGreen(s)
      const sigMsg = nearCrossing(p.x, p.y, p.z) && s.phase === 'playing'
        ? `${green ? '보행 신호' : '적신호 · 차 주의'}  ${Math.ceil(lightRemainSec(s))}초`
        : ''
      if (sigMsg !== lastSig) {
        sig.textContent = sigMsg
        sig.className = sigMsg ? `on ${green ? 'go' : 'stop'}` : ''
        lastSig = sigMsg
      }

      const zn = `${s.zone} · ${ZONE_NAMES[s.zone]}`
      if (zn !== lastZone) { zoneEl.textContent = zn; lastZone = zn }

      if (s.cardBalance !== lastBal) {
        balEl.textContent = `${s.cardBalance.toLocaleString('ko-KR')}원`
        lastBal = s.cardBalance
      }
      // GDD §7.2 — 잔액이 요금 미만이면 적색 + 미세 진동. 개찰구 도착 **전에** 알린다
      const low = s.cardBalance < FARE && !s.gates.passed
      if (low !== lastLow) { balEl.className = low ? 'v low' : 'v'; lastLow = low }

      // 원형 게이지 — 각도는 CSS 변수 하나로만 넘긴다. 링을 그리는 일은 CSS 몫이다
      const stam = Math.round(s.player.stamina)
      if (stam !== lastStam) {
        stamRing.style.setProperty('--stam', String(stam / 100))
        stamNum.textContent = `${stam}%`
        lastStam = stam
      }
      if (s.player.sprintLocked !== lastLocked) {
        stamWrap.className = s.player.sprintLocked ? 'locked' : ''
        lastLocked = s.player.sprintLocked
      }

      vig.style.opacity = s.timeLeftMs <= TIMER_STAGES.hot && s.phase === 'playing' ? '1' : '0'

      // ── 인벤 3슬롯. 마스크는 착용 중이면 테두리가 녹색으로 바뀐다(슬롯은 유지)
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        if (!slot) continue
        const item = s.inventory[i] ?? null
        const worn = item === 'I-06' && s.flags.includes('MASK_ON')
        const key = `${item ?? ''}|${worn ? 'w' : ''}`
        if (key === slot.last) continue
        slot.glyph.textContent = item ? itemDef(item).glyph : ''
        slot.box.title = item ? itemDef(item).name : ''
        slot.box.className = item ? (worn ? 'slot has worn' : 'slot has') : 'slot'
        slot.last = key
      }

      /**
       * 헤더 카운터 — Figma 는 `4 / 8` 이었다. 우리는 **3슬롯 고정**이므로 분모가 3이다
       * (GDD §5.2 "슬롯 압박 자체가 선택을 만든다"). 칸을 늘리면 그 압박이 사라진다.
       */
      const held = s.inventory.filter(Boolean).length
      if (held !== lastInvCount) {
        invCount.textContent = `${held} / ${SLOTS}`
        lastInvCount = held
      }

      // ── 양심 게이지. 0을 중심으로 좌(적)·우(녹)로 자란다. **숫자는 없다**
      const c = s.scores.conscience
      if (c !== lastCons) {
        const half = Math.min(1, Math.abs(c) / 5) * 50
        consFill.style.left = c < 0 ? `${50 - half}%` : '50%'
        consFill.style.width = `${half}%`
        consFill.style.background = c < 0 ? 'var(--crit)' : 'var(--line2)'
        // 처음 값(0)에는 반짝이지 않는다 — 아무 일도 없었는데 시선을 끌 이유가 없다
        if (lastCons !== -99) consLitUntil = performance.now() + 600
        lastCons = c
      }
      const lit = performance.now() < consLitUntil
      const consCls = lit ? 'lit' : ''
      if (consEl.className !== consCls) consEl.className = consCls

      // 피드백 — 새 항목만 추가, 만료된 것만 제거
      const live = new Set(s.fx.map((f) => f.id))
      for (const [id, node] of shown) {
        if (!live.has(id)) { node.remove(); shown.delete(id) }
      }
      for (const f of s.fx) {
        if (shown.has(f.id) || f.kind === 'shake' || !f.text) continue
        const d = document.createElement('div')
        d.className = f.kind
        d.textContent = f.text
        fxBox.appendChild(d)
        shown.set(f.id, d)
      }
    },
  }
}
