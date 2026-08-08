/**
 * 상호작용 오버레이 — 프롬프트 · 진행링 · 사유 · 대화 선택 · QTE 게이지.
 *
 * HUD(`ui/hud.ts`)와 분리한 이유: HUD는 **상시** 표시되는 계기판이고 이쪽은 **순간** 표시되는
 * 상호작용 표면이다. 한 파일에 넣으면 60fps 갱신 대상과 이벤트성 갱신 대상이 섞여
 * "값이 바뀐 노드만 건드린다"는 규칙을 지키기 어려워진다.
 *
 * 판정은 하나도 여기 없다. 전부 `systems/interact.ts`·`systems/qte.ts` 가 정하고
 * 이 파일은 `state.act` / `state.qte` 를 **그리기만** 한다.
 */

import { byId, GIFT_STALL_ID, GRANDPA_ID } from '../data/interactables'
import { GIFT_CORRECT, GIFT_ITEMS, itemDef, SHOP_PRICE } from '../data/items'
import { QTE } from '../data/tuning'
import { branchesFor, hasItem } from '../systems/interact'
import type { GameState } from '../state/types'
// 스타일은 `css/dialog.css` 가 단일 원천이다 — UI 킷(/uikit.html)이 같은 파일을 읽는다.
// `?inline` 은 파일 내용을 문자열로 준다: 주입 방식(<style> 삽입)은 예전과 같다.
import CSS from './css/dialog.css?inline'
import SHOP_CSS from './css/shop.css?inline'

/** 슬롯 아이콘 PNG 위치 — `tools/items_icon_render.py` 가 굽는 자리와 같다(`ui/hud.ts` 와 동일 상수) */
const ICON_BASE = `${import.meta.env.BASE_URL}icons/items/`
/** 할아버지 초상화 — 스크린샷 렌더를 그대로 쓴다(`public/portraits/grandpa.png`) */
const GP_PORTRAIT = `${import.meta.env.BASE_URL}portraits/grandpa.png`

/** 대화 패널(`#gpstory`) 한 줄 — 화자와 대사. 대사는 상태에 따라 달라질 수 있어 함수도 받는다 */
type ConvLine = Readonly<{ speaker: 'gp' | 'player'; text: string | ((s: GameState) => string) }>

const convText = (line: ConvLine, s: GameState): string =>
  typeof line.text === 'function' ? line.text(s) : line.text

/**
 * [3] 말동무 해주기 — 클릭 없이 **3초마다 자동으로 넘어가는** 10줄(플레이어 5·할아버지 5,
 * 번갈아). 디렉터 지시 2026-08-08 — 이동은 아예 막히고(`systems/movement.ts`) ESC도
 * 안 먹는다(`systems/interact.ts` `cancellable`), 그러니 여기서 도중에 끊기는 경우가 없다 —
 * 10줄이 전부 보인 뒤에만 `complete()` 의 `case 'story'` 보상이 나간다.
 *
 * 8번째 줄(할아버지)이 실제 정보다 — `s.gates.workingIds[0]` 을 **직접** 읽는다.
 * `systems/gates.ts` 의 `hintedWorkingId` 는 `HINT_GRANDPA` 플래그로 잠겨 있는데, 그
 * 플래그는 이 10줄이 끝난 **뒤**에야 켜진다(`complete()`). 대화 그 자체가 공개의 순간이므로
 * 여기서는 게이팅 없이 같은 소스(`workingIds[0]`)를 바로 읽는다 — LED가 나중에 보여주는
 * 값과 반드시 같아야 하기 때문이다(다르면 "할아버지가 거짓말했다"는 버그로 읽힌다).
 */
const STORY_LINES: readonly ConvLine[] = [
  { speaker: 'player', text: '할아버지, 여기서 기차 기다리시는 거예요? 잠깐 말동무 좀 해드릴까 해서요.' },
  { speaker: 'gp', text: '허허, 젊은 사람이 별걸 다 신경 쓰는구먼. 앉게, 시간은 많으니.' },
  { speaker: 'player', text: '여기 자주 오세요?' },
  { speaker: 'gp', text: '매일이지. 집사람 먼저 보내고는 갈 데가 여기밖에 없더군.' },
  { speaker: 'player', text: '그러셨군요… 힘드셨겠어요.' },
  { speaker: 'gp', text: '힘들긴, 사람 구경하는 재미가 쏠쏠해. 자네처럼 바쁜 사람 보면 나도 젊어지는 것 같고.' },
  { speaker: 'player', text: '그래도 이 시간엔 위험하지 않으세요?' },
  {
    speaker: 'gp',
    text: (s) => {
      const id = s.gates.workingIds[0]
      return id !== undefined
        ? `아 참, 그러고 보니 — ${id}번 게이트는 멀쩡하니 거기로 들어가게.`
        : '아 참, 요즘은 게이트가 다들 말썽이라던데, 잘 보고 들어가게.'
    },
  },
  { speaker: 'player', text: '말씀해주셔서 감사해요. 다음엔 또 들를게요.' },
  { speaker: 'gp', text: '지금까지 나랑 대화해줘서 고맙네. 이건 답례라네.' },
]

/**
 * [2] 선물주기 — 플레이어가 먼저 제안하고 할아버지가 받는다(디렉터 지시 2026-08-08).
 * 정답(`GIFT_CORRECT`)이면 따뜻한 답례 대사 + 효자손, 오답이면 기존 거절 대사 그대로 —
 * 실제 성공/실패 판정은 여전히 `systems/interact.ts` 의 `case 'give'` 하나뿐이다.
 * 여기서는 **그 판정과 같은 조건**(`held === GIFT_CORRECT`)으로 어느 대사를 보여줄지만 고른다.
 */
const giveLines = (s: GameState): readonly ConvLine[] | null => {
  const held = GIFT_ITEMS.find((i) => hasItem(s, i))
  if (!held) return null
  const name = itemDef(held).name
  const reply = held === GIFT_CORRECT
    ? '허허 고맙다네, 이건 별거 아니지만 자네에게 주겠네.'
    : '이놈아, 내가 이런 걸 먹게 생겼냐?'
  return [
    { speaker: 'player', text: `할아버지, ${name} 하나 드실래요?` },
    { speaker: 'gp', text: reply },
  ]
}

export type Dialog = Readonly<{ sync(s: GameState): void; el: HTMLElement }>

/** 진행 중 상호작용의 표시 문안 */
const busyLabel = (s: GameState): string => {
  switch (s.act.busyKind) {
    case 'pickup': return '줍는 중'
    case 'buy': return '사는 중'
    case 'give': return '드리는 중'
    case 'story': return '이야기 듣는 중'
    case 'aside': return '"저기요…"'
    case 'inspect': return '살펴보는 중'
    default: return ''
  }
}

/** 조준 대상의 라벨 — 드랍은 테이블에 없으므로 아이템 이름으로 만든다 */
const targetLabel = (s: GameState): string => {
  const id = s.act.targetId
  if (!id) return ''
  const it = byId(id)
  if (it) return it.label
  const d = s.drops.find((x) => x.id === id)
  return d ? itemDef(d.item).name : ''
}

export const createDialog = (mount: HTMLElement): Dialog => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  const shopStyle = document.createElement('style')
  shopStyle.textContent = SHOP_CSS
  document.head.appendChild(shopStyle)

  const el = document.createElement('div')
  el.id = 'iact'
  /**
   * ⚠ `#qte` 는 **`#dlg` 의 형제**여야 한다.
   *
   * 예전엔 `#dlg` 를 닫는 `</div>` 가 빠져 있어 파서가 QTE 블록을 대화창 **안**에 넣었다.
   * 대화가 닫혀 있으면 `#dlg{display:none}` 이 통째로 먹으므로 게이지가 한 픽셀도 안 그려진다 —
   * 자판기 미니게임이 **보이지 않는 리듬 게임**이었다. DOM 에는 `#qte.on` 이 멀쩡히 있어서
   * E2E 의 존재 검사(`toHaveCount(1)`)는 통과했다. 그래서 지금은 **실제 가시성**을 잠근다.
   */
  el.innerHTML = `
    <div id="iprompt"><kbd>E</kbd><span id="iprompt-t"></span></div>
    <div id="iring"><b id="iring-t"></b></div>
    <div id="ireason"></div>
    <div id="dlg">
      <div class="actor-card">
        <div class="frame"><img src="${GP_PORTRAIT}" alt=""></div>
        <div class="tag" id="dlg-who"></div>
      </div>
      <div class="conv">
        <div class="bubble"><div class="kick">DIALOGUE</div><p id="dlg-line"></p></div>
        <div class="choices" id="dlg-ops"></div>
        <div class="esc">ESC 그냥 지나간다</div>
      </div>
    </div>
    <div id="gpstory">
      <div class="actor-card">
        <div class="frame"><img src="${GP_PORTRAIT}" alt=""></div>
        <div class="tag" id="gpstory-who"></div>
      </div>
      <div class="conv">
        <div class="bubble"><span class="who" id="gpstory-speaker"></span><p id="gpstory-line"></p></div>
        <div class="bar"><i id="gpstory-bar"></i></div>
        <div class="cap" id="gpstory-cap"></div>
      </div>
    </div>
    <div id="qte">
      <div class="cap">자판기 밑을 긁는다 — 가운데에서 <b>클릭</b></div>
      <div class="track"><div class="fill" id="qte-fill"></div>
        <div class="win" id="qte-win"></div><div class="mark" id="qte-mark"></div></div>
      <div class="row"><span class="dir" id="qte-dir">→</span>
        <div class="dots"><i id="qte-d0"></i><i id="qte-d1"></i><i id="qte-d2"></i></div>
        <span class="miss" id="qte-miss"></span></div>
    </div>
    <div id="shop">
      <div class="panel">
        <div class="head">
          <div class="title"><span class="tag">STORE</span><b>편의점 상점</b></div>
          <div class="ctrl">
            <div class="bal"><i></i><b id="shop-bal"></b></div>
            <button class="close" id="shop-close" type="button" aria-label="닫기">✕</button>
          </div>
        </div>
        <div class="body">
          <div class="list-wrap">
            <div class="list-head"><span>음료 및 간식</span><span id="shop-count"></span></div>
            <div class="list" id="shop-list"></div>
          </div>
          <div class="detail">
            <div class="preview"><img id="shop-prev-img" alt=""></div>
            <div class="desc">
              <p class="name" id="shop-name"></p>
              <p class="text" id="shop-text"></p>
            </div>
            <div class="foot">
              <div class="cost"><span>구매 가격</span><b id="shop-price"></b></div>
              <button class="buy" id="shop-buy" type="button">구매</button>
            </div>
          </div>
        </div>
      </div>
    </div>`
  mount.appendChild(el)

  const $ = <T extends HTMLElement>(id: string): T => el.querySelector<T>(`#${id}`) as T
  const prompt = $('iprompt')
  const promptT = $('iprompt-t')
  const ring = $('iring')
  const ringT = $('iring-t')
  const reason = $('ireason')
  const dlg = $('dlg')
  const dlgWho = $('dlg-who')
  const dlgLine = $('dlg-line')
  const dlgOps = $('dlg-ops')
  const gpstory = $('gpstory')
  const gpstoryWho = $('gpstory-who')
  const gpstorySpeaker = $('gpstory-speaker')
  const gpstoryLine = $('gpstory-line')
  const gpstoryBar = $('gpstory-bar')
  const gpstoryCap = $('gpstory-cap')
  const qte = $('qte')
  const qFill = $('qte-fill')
  const qWin = $('qte-win')
  const qMark = $('qte-mark')
  const qDir = $('qte-dir')
  const qMiss = $('qte-miss')
  const dots = [$('qte-d0'), $('qte-d1'), $('qte-d2')]

  let lastPrompt = ''
  let lastPromptCls = ''
  let lastReason = ''
  let lastDlg = ''
  let lastQte = false

  // 판정창 폭은 고정이다 — 한 번만 계산한다
  // 성공 구간 폭은 상수다 — 난이도가 올라도 **구간은 안 좁힌다**(빨라질 뿐)
  qWin.style.width = `${QTE.zoneHalf * 2 * 100}%`

  // ─────────────────── UI-19 편의점 상점 (`OBJ-19-GIFT` 의 그림 껍데기) ───────────────────
  const shop = $('shop')
  const shopList = $('shop-list')
  const shopBal = $('shop-bal')
  const shopCount = $('shop-count')
  const shopPrevImg = $<HTMLImageElement>('shop-prev-img')
  const shopName = $('shop-name')
  const shopText = $('shop-text')
  const shopPrice = $('shop-price')
  const shopBuy = $<HTMLButtonElement>('shop-buy')
  const shopClose = $('shop-close')

  /**
   * 카드 클릭·BUY 클릭을 **진짜 키 입력**으로 바꿔 보낸다.
   *
   * `#shop` 은 마우스로 눌러야 하는데 판정은 전부 `core/input.ts` 의 `Digit1~9` 원샷을
   * 읽는 `dialogPick`(`systems/interact.ts`) 하나뿐이다. 여기서 새 디스패치 경로를 파는
   * 대신 그 입력기 자체가 듣는 `window` `keydown`을 합성해 보낸다 — 판정·1회 한정
   * 플래그·오답 즉시실패(E-15) 로직이 물리 키와 완전히 같은 길을 타므로 갈라질 일이 없다.
   */
  const pressKey = (code: string): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code }))
  }

  /** 선택창 안 미리보기 커서 — 게임 상태가 아니라 **UI 로컬**이다(구매 전에는 아무 효과가 없다) */
  let shopSel = 0
  let shopOpenFor: string | null = null

  const renderDetail = (): void => {
    const id = GIFT_ITEMS[shopSel] ?? GIFT_ITEMS[0]
    if (!id) return
    const def = itemDef(id)
    shopPrevImg.src = `${ICON_BASE}${def.node}.png`
    shopName.textContent = def.name
    // 다섯 개 전부 같은 문구다(`itemDef` 의 `noTargetReason`) — 힌트는 바닥 양갱이 진다,
    // 여기서 설명이 갈리면 그 자체가 정답 힌트가 된다(`giftBranches` 와 같은 이유)
    shopText.textContent = def.noTargetReason
    shopPrice.textContent = `${(SHOP_PRICE[id] ?? 0).toLocaleString('ko-KR')}원`
    shopCards.forEach((c, i) => c.classList.toggle('sel', i === shopSel))
  }

  // 카드 5장은 세션 내내 그대로다(목록이 안 바뀐다) — 한 번만 짓는다
  GIFT_ITEMS.forEach((id, i) => {
    const def = itemDef(id)
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'card'
    card.innerHTML =
      `<div class="thumb"><img src="${ICON_BASE}${def.node}.png" alt=""></div>` +
      `<div class="info"><span class="name">${def.name}</span>` +
      `<span class="price">${(SHOP_PRICE[id] ?? 0).toLocaleString('ko-KR')}원</span></div>`
    card.addEventListener('click', () => {
      if (card.classList.contains('disabled')) return
      shopSel = i
      renderDetail()
    })
    shopList.appendChild(card)
  })
  const shopCards = Array.from(shopList.querySelectorAll<HTMLButtonElement>('.card'))
  renderDetail()

  shopBuy.addEventListener('click', () => pressKey(`Digit${shopSel + 1}`))
  shopClose.addEventListener('click', () => pressKey('Escape'))

  /**
   * 할아버지 3분기 — 행이 `dlgKey` 바뀔 때마다 새로 지어지므로(아래 `sync`) 위임으로 듣는다.
   * 물리 숫자키와 같은 길(`pressKey`)을 타므로 `dialogPick` 의 `enabled` 판정이 그대로 먹는다 —
   * 여기서 `.off` 를 다시 안 걸러도 된다.
   */
  dlgOps.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.gp-choice')
    if (!row?.dataset['key']) return
    pressKey(`Digit${row.dataset['key']}`)
  })

  return {
    el,
    sync(s) {
      const busy = s.act.busyId !== null && s.act.busyKind !== null
      const playing = s.phase === 'playing'
      /**
       * 할아버지와의 [2]선물주기·[3]말동무는 진행링 대신 `#gpstory` 가 대사를 흘려 보여준다.
       * 둘 다 `GRANDPA_ID` 만 쓰는 종류라 상대를 따로 확인 안 해도 된다.
       */
      const busyConv = busy && s.act.busyId === GRANDPA_ID &&
        (s.act.busyKind === 'story' || s.act.busyKind === 'give')

      // ── 프롬프트: 대상이 있고 아무것도 진행 중이 아닐 때만
      const showPrompt = playing && !busy && !s.qte.active && !s.act.dialogId && !!s.act.targetId
      const text = showPrompt ? targetLabel(s) : ''
      const cls = showPrompt ? (s.act.aimed ? 'on' : 'on near') : ''
      if (text !== lastPrompt) { promptT.textContent = text; lastPrompt = text }
      if (cls !== lastPromptCls) { prompt.className = cls; lastPromptCls = cls }

      // ── 진행링: 남은 비율을 conic-gradient 한 값으로
      if (busy && s.act.busyTotalMs > 0 && !busyConv) {
        const done = 1 - s.act.busyLeftMs / s.act.busyTotalMs
        ring.style.background =
          `conic-gradient(var(--gold) ${done.toFixed(3)}turn, rgba(255,255,255,.14) ${done.toFixed(3)}turn)`
        // 15초 대화는 남은 초를 같이 보여준다 — 안 보여주면 그냥 멈춘 것처럼 느껴진다
        ringT.textContent = s.act.busyTotalMs >= 3000
          ? `${busyLabel(s)}  ${Math.ceil(s.act.busyLeftMs / 1000)}s`
          : busyLabel(s)
        if (ring.className !== 'on') ring.className = 'on'
      } else if (ring.className !== '') {
        ring.className = ''
      }

      // ── 사유
      const rz = s.act.denyMs > 0 ? s.act.denyText : ''
      if (rz !== lastReason) {
        reason.textContent = rz
        reason.className = rz ? 'on' : ''
        lastReason = rz
      }

      // ── 대화 선택. 분기 데이터는 시스템과 **같은 함수**에서 온다
      // 편의점 매대(`GIFT_STALL_ID`)는 아래 `#shop` 이 대신 그리므로 여기서는 뺀다
      const isShop = s.act.dialogId === GIFT_STALL_ID
      const dlgKey = s.act.dialogId && !isShop ? `${s.act.dialogId}:${s.inventory.join(',')}` : ''
      if (dlgKey !== lastDlg) {
        if (dlgKey) {
          /**
           * 상대 이름을 대화 상대의 `label` 에서 읽는다 — 예전엔 `할아버지`가 마크업에
           * 박혀 있어 편의점 매대(`GIFT_STALL_ID`)가 두 번째 `talk` 대상이 되자
           * 매대에서 연 선택창에도 "할아버지"가 떴다. `byId` 가 `systems/interact.ts`
           * 의 상호작용 테이블과 같은 원천이므로 여기서 갈릴 일이 없다.
           */
          dlgWho.textContent = byId(s.act.dialogId!)?.label ?? ''
          // 인사말은 대사 판정과 무관한 연출 문구다 — 상대가 바뀔 일이 없으니(할아버지뿐) 고정
          dlgLine.textContent = '"이 시간에 여긴 어쩐 일인가?"'
          dlgOps.innerHTML = branchesFor(s, s.act.dialogId!)
            .map((b) => `<button type="button" class="gp-choice${b.enabled ? '' : ' off'}" data-key="${b.key}">` +
              `<span class="badge">0${b.key}</span><span class="label">${b.label}</span>` +
              `<span class="note">${b.note}</span></button>`)
            .join('')
        }
        dlg.className = dlgKey ? 'on' : ''
        lastDlg = dlgKey
      }

      // ── 선물주기·말동무 — `#iring` 대신 초상화+대사창에서 시간에 따라 대사를 넘긴다
      if (gpstory.className !== (busyConv ? 'on' : '')) gpstory.className = busyConv ? 'on' : ''
      if (busyConv) {
        gpstoryWho.textContent = byId(GRANDPA_ID)?.label ?? ''
        const lines = s.act.busyKind === 'give' ? giveLines(s) : STORY_LINES
        const total = s.act.busyTotalMs || 1
        const elapsed = Math.max(0, total - s.act.busyLeftMs)
        if (lines && lines.length > 0) {
          const segMs = total / lines.length
          const idx = Math.min(lines.length - 1, Math.floor(elapsed / segMs))
          const line = lines[idx] ?? lines[0]
          if (line) {
            gpstorySpeaker.textContent = line.speaker === 'gp' ? '할아버지' : '나'
            gpstorySpeaker.className = `who${line.speaker === 'player' ? ' player' : ''}`
            gpstoryLine.textContent = convText(line, s)
          }
        }
        gpstoryBar.style.transform = `scaleX(${Math.min(1, elapsed / total).toFixed(3)})`
        gpstoryCap.textContent = `${busyLabel(s)} · ${Math.ceil(s.act.busyLeftMs / 1000)}s`
      }

      // ── UI-19 편의점 상점
      if (isShop && shopOpenFor !== s.act.dialogId) {
        // 새로 연 세션 — 미리보기 커서를 첫 상품으로 되돌린다
        shopSel = 0
        renderDetail()
      }
      shopOpenFor = isShop ? s.act.dialogId : null
      if (shop.className !== (isShop ? 'on' : '')) shop.className = isShop ? 'on' : ''
      if (isShop) {
        shopBal.textContent = `${s.cardBalance.toLocaleString('ko-KR')}원`
        // 1회 한정 — 이미 골랐으면 카드·BUY 를 전부 잠근다(`giftBranches` 의 `enabled` 와 같은 조건)
        const bought = s.flags.includes('GIFT_BOUGHT')
        shopCount.textContent = `${GIFT_ITEMS.length} / ${GIFT_ITEMS.length} Items`
        shopCards.forEach((c) => c.classList.toggle('disabled', bought))
        shopBuy.disabled = bought
        shopBuy.textContent = bought ? '구매 완료' : '구매'
      }

      // ── QTE
      if (s.qte.active !== lastQte) { qte.className = s.qte.active ? 'on' : ''; lastQte = s.qte.active }
      if (s.qte.active) {
        // 마커 위치는 시뮬이 들고 있다 — 렌더는 그대로 옮겨 그리기만 한다
        qMark.style.left = `${(s.qte.pos * 100).toFixed(1)}%`
        /**
         * 채움은 **남은 제한시간**이다. 예전엔 스트로크 누적량이었는데 그건 점(dots)이
         * 이미 보여 준다 — 화면에 같은 정보를 두 번 그릴 이유가 없다.
         */
        const left = Math.max(0, 1 - s.qte.elapsedMs / QTE.timeoutMs)
        qFill.style.width = `${(left * 100).toFixed(1)}%`
        qDir.textContent = s.qte.dirSign > 0 ? '→' : '←'
        for (let i = 0; i < dots.length; i++) {
          const on = i < s.qte.strokes
          const d = dots[i]
          if (d && (d.className === 'hit') !== on) d.className = on ? 'hit' : ''
        }
        qMiss.textContent = s.qte.misses > 0 ? `실패 ${s.qte.misses}/${QTE.maxMisses}` : ''
      }
    },
  }
}
