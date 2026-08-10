/**
 * HUD — LED 전광판 · 타이머 · 잔액 · 스태미너 · 피드백.
 *
 * DOM으로 그린다. 60fps 루프에 리액트 리컨실리에이션을 끼울 이유가 없다.
 * 갱신은 "값이 바뀐 노드만" 건드린다.
 */

import { formatClock } from '../core/math'
import { itemDef } from '../data/items'
import { createMinimap } from './minimap'
import { FARE, SLOTS, SWAP_WINDOW_MS, TIMER_STAGES } from '../data/tuning'
import { ledText } from '../systems/gates'
import { lightIsGreen, lightRemainSec } from '../systems/tick'
import { CROSSWALK, FLOOR, ZONE_NAMES } from '../data/world'
import type { GameState } from '../state/types'
// 스타일은 `css/hud.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
// `?inline` 은 파일 내용을 문자열로 준다: 주입 방식(<style> 삽입)은 예전과 같다.
import CSS from './css/hud.css?inline'

/** 슬롯 아이콘 PNG 위치 — `tools/items_icon_render.py` 가 굽는 자리와 같아야 한다 */
const ICON_BASE = `${import.meta.env.BASE_URL}icons/items/`
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
  /** P2 관찰 모드 `Q` — 조준 대상의 상세를 크게 띄운다 */
  setObserve(on: boolean, title: string, body: string): void
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
      <div id="lockhint">화면을 클릭하면 시점이 잠깁니다 · <em>ESC 설정</em></div>
    </div>

    <div id="obs"><b></b><em></em></div>
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
  const obs = $('obs')
  const obsTitle = obs.querySelector('b') as HTMLElement
  const obsBody = obs.querySelector('em') as HTMLElement
  let lastObs = ''
  const vig = $('vig')
  const cross = $('cross')
  const sig = $('sig')
  const lockHint = $('lockhint')
  const invEl = $('hud-inv')
  // UI-06 — 잠긴 껍데기였던 컨테이너에 실제 지도를 넣는다 (P2)
  const minimap = createMinimap($('mini'))
  let firstPerson = true

  // 슬롯 노드는 처음 한 번만 만든다 — 매 프레임 innerHTML을 쓰면 60fps로 파서를 돌린다
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const d = document.createElement('div')
    d.className = 'slot'
    // 키캡 표기 — 10번은 `0` 이다(`Digit0`). 숫자열 순서를 그대로 읽는다
    // 아이콘은 빌드타임에 구운 3D 렌더 PNG(`tools/items_icon_render.py`) — 없는
    // 아이템은 onerror가 has-icon을 안 붙여서 글리프 이모지로 그대로 남는다
    d.innerHTML = `<b>${i === 9 ? 0 : i + 1}</b><span></span><img class="icon" alt="">`
    invEl.appendChild(d)
    const icon = d.querySelector('img') as HTMLImageElement
    icon.onload = () => d.classList.add('has-icon')
    icon.onerror = () => d.classList.remove('has-icon')
    return { box: d, glyph: d.querySelector('span') as HTMLElement, icon, last: '' }
  })
  /**
   * UI-14 교체 창 — 슬롯 줄 바로 위에 붙는 얇은 게이지 하나.
   * 모달 창을 띄우지 않는 이유는 `state/types.ts SwapState` 에 적혀 있다:
   * **P1 동작이 이미 일어난 뒤의 되돌림 창**이라 화면을 가릴 이유가 없다.
   */
  const swapBar = document.createElement('div')
  swapBar.className = 'swap'
  swapBar.innerHTML = `<i></i><em>1~${SLOTS === 10 ? '0' : SLOTS} 자리 바꾸기 · ESC 되돌리기</em>`
  invEl.parentElement?.insertBefore(swapBar, invEl)
  const swapFill = swapBar.querySelector('i') as HTMLElement
  let lastSwap = false

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
  let lastPlaying = true
  const shown = new Map<number, HTMLElement>()

  return {
    el,
    setCrosshair(on) { firstPerson = on; cross.className = on ? 'on' : '' },
    setObserve(on, title, body) {
      const key = on ? `${title}|${body}` : ''
      if (key === lastObs) return
      lastObs = key
      obs.className = on ? 'on' : ''
      obsTitle.textContent = title
      obsBody.textContent = body
    },
    sync(s, pointerLocked) {
      /**
       * 타이틀·엔딩에서는 HUD 를 통째로 숨긴다.
       *
       * 예전엔 두 화면이 HUD **위에** 겹쳐 떴다. 타이틀에 `3:00` 타이머·스태미너
       * `100%`·`소지품 0/10` 이 다 보이는데 셋 다 아직 시작도 안 한 판의 값이고,
       * 엔딩에서는 결과 카드와 같은 밝기로 겹쳐 어느 쪽을 읽어야 하는지 알 수 없었다.
       * (실측: `tests/e2e/__shots__/00-title.png` · `ending-e06.png`)
       *
       * 미니맵·디버그·상호작용 표시는 전부 이 루트 안이라 같이 따라간다.
       */
      const playing = s.phase === 'playing' || s.phase === 'boarding'
      if (playing !== lastPlaying) { el.className = playing ? '' : 'off'; lastPlaying = playing }
      /**
       * "화면을 클릭하면 시점이 잠깁니다" — **선택창이 열려 있는 동안은 거짓말이다.**
       * 그 동안은 `main.ts` 가 포인터 락을 막고 있어서(마우스로 선택지를 눌러야 하므로)
       * 클릭해도 안 잠긴다. 화면이 못 지킬 약속을 하고 있으면 안 된다.
       */
      lockHint.className =
        firstPerson && !pointerLocked && !s.act.dialogId &&
        (s.phase === 'playing' || s.phase === 'boarding') ? 'on' : ''
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

      minimap.sync(s)

      /**
       * ── 인벤 3슬롯. 착용 중이면 테두리가 녹색으로 바뀐다(슬롯은 유지).
       *
       * P1은 `item === 'I-06'` 로 마스크만 봤다. P2는 착용형이 3종이고
       * **어느 것이 착용형인지는 `items.ts` 가 안다** — 여기서 다시 열거하면
       * 아이템을 추가할 때 두 곳을 고쳐야 하고, 한 곳을 잊으면 조용히 안 켜진다.
       *
       * 교체 창이 열려 있으면 고를 수 있는 칸을 표시한다(UI-14).
       */
      const swapOn = s.swap.active
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        if (!slot) continue
        const item = s.inventory[i] ?? null
        const def = item ? itemDef(item) : null
        const worn = !!(def?.flag && s.flags.includes(def.flag))
        // 손에 든 칸 — 착용(`worn`)과 다른 축이다. 마스크는 쓰는 것이고 우산은 드는 것이다
        const inHand = s.hand.slot === i && s.hand.item !== null && s.hand.item === item
        const swappable = swapOn && i !== s.swap.newSlot
        const key = `${item ?? ''}|${worn ? 'w' : ''}|${inHand ? 'h' : ''}` +
          `|${swapOn ? (swappable ? 's' : 'n') : ''}`
        if (key === slot.last) continue
        slot.glyph.textContent = def ? def.glyph : ''
        // 아이콘 없는 아이템(커피·신문지·캐리어·지갑·EMP)은 onerror가
        // has-icon을 떼어내 위 glyph 텍스트가 그대로 보인다
        if (def) slot.icon.src = `${ICON_BASE}${def.node}.png`
        else { slot.icon.removeAttribute('src'); slot.box.classList.remove('has-icon') }
        slot.box.title = def ? (def.cost ? `${def.name} — ${def.cost}` : def.name) : ''
        // className을 통짜로 다시 쓰면 icon.onload 가 비동기로 붙인 has-icon이
        // 지워진다 — 개별 토글로 그 클래스만 건드리지 않는다
        slot.box.classList.toggle('has', !!item)
        slot.box.classList.toggle('worn', worn)
        slot.box.classList.toggle('inhand', inHand)
        slot.box.classList.toggle('swappable', swappable)
        slot.last = key
      }

      // ── UI-14 교체 창 — 0.9초 게이지. 안 누르면 P1 결과가 그대로 남는다
      if (swapOn !== lastSwap) {
        swapBar.className = swapOn ? 'swap on' : 'swap'
        lastSwap = swapOn
      }
      if (swapOn) swapFill.style.transform = `scaleX(${s.swap.leftMs / SWAP_WINDOW_MS})`

      /**
       * 헤더 카운터 — Figma 는 `4 / 8` 이었다. 우리는 **3슬롯 고정**이므로 분모가 3이다
       * (GDD §5.2 "슬롯 압박 자체가 선택을 만든다"). 칸을 늘리면 그 압박이 사라진다.
       */
      const held = s.inventory.filter(Boolean).length
      if (held !== lastInvCount) {
        invCount.textContent = `${held} / ${SLOTS}`
        lastInvCount = held
      }

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
