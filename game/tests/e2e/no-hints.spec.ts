/**
 * 결과 화면은 **해답을 보여주지 않는다.**
 *
 * 이 게임의 재미 한 축은 *실패 → 스스로 해석 → 다시 플레이 → 다른 선택* 이다.
 * 결과 화면이 다음 판의 정답을 적으면 두 번째 판이 심부름이 된다.
 *
 * 한 번 실제로 그랬다 — `e.hint` 와 `e.reason` 을 결과값으로 그대로 띄우고 있어서
 * E-16 은 `개찰구를 넘으면 멈추신다`(탈출 경로)를, E-05 는 히든 엔딩 획득 조건
 * **전체**를 화면에 적고 있었다. 사람 눈으로는 잘 안 걸리는 종류의 유출이라
 * 문자열로 잠근다.
 */
import { test, expect } from '@playwright/test'
/** 결과 화면에 절대 나오면 안 되는 조각들 — 공략·조건·임계값 */
const BANNED = ['살펴보면','넘으면','알 수 있다','자동으로 낸다','깨닫는다','두 번째로 맞으면',
  '아이템','무피격','유실물 반납','밀친','세 사람','모든 조건','남을 도','기분은','괜찮다']
/**
 * ⚠ `e12` 를 뺐다 — upstream 문구 「가끔은, 늦어도 괜찮다.」 가 위로 어휘 목록의
 *   "괜찮다" 에 걸린다. 엔딩 문구는 upstream 것을 쓰기로 정해졌으므로 문구를 고치는
 *   대신 여기에 적어 둔다. **금지 목록은 그대로 둔다** — 나머지 엔딩은 계속 이
 *   가드를 지나야 하고, 저 한 줄을 고치기로 하면 이 줄만 되살리면 된다.
 *   (`tests/unit/ending-tone.test.ts` 에도 같은 예외가 있다)
 */
const CASES: Array<[string, Record<string, unknown>]> = [
  ['e03', { phase:'ended', endingId:'E-03', boarded:true, boardedDoorX:112, timeLeftMs:47_000, elapsedMs:133_000 }],
  ['e04', { phase:'ended', endingId:'E-04', boarded:true, boardedDoorX:null, timeLeftMs:900, elapsedMs:179_100 }],
  ['e06', { phase:'ended', endingId:'E-06', boarded:false, timeLeftMs:0, elapsedMs:180_000 }],
  ['e09', { phase:'ended', endingId:'E-09', boarded:false, timeLeftMs:52_000, elapsedMs:128_000 }],
  ['e11', { phase:'ended', endingId:'E-11', boarded:false, timeLeftMs:38_000, elapsedMs:142_000,
    tally:{ coinsEarned:0, itemsUsed:[], secrets:[], pushes:3, crowdMs:60_000, staminaMin:30 } }],
  ['e16', { phase:'ended', endingId:'E-16', boarded:false, timeLeftMs:61_000, elapsedMs:119_000 }],
  ['e05', { phase:'ended', endingId:'E-05', boarded:true, timeLeftMs:72_000, elapsedMs:108_000,
    scores:{ style:8, knowledge:11 },
    tally:{ coinsEarned:0, itemsUsed:['I-01','I-06','I-09','I-12'], secrets:['a'], pushes:0, crowdMs:20_000, staminaMin:80 } }],
  ['e14', { phase:'ended', endingId:'E-14', boarded:true, timeLeftMs:24_000, elapsedMs:156_000,
    tally:{ coinsEarned:3500, itemsUsed:[], secrets:[], pushes:0, crowdMs:30_000, staminaMin:55 } }],
]
test('no walkthrough hints on result screens', async ({ page }) => {
  await page.goto('/?seed=42')
  await page.waitForFunction(() => !!(window as any).__game, null, { timeout: 20_000 })
  await page.waitForFunction(() => (document.getElementById('load') as HTMLElement|null)?.style.display === 'none', null, { timeout: 20_000 })
  await page.waitForFunction(() => (document.getElementById('screen') as HTMLElement).innerHTML.length > 0, null, { timeout: 20_000 })
  await page.waitForTimeout(1300)
  for (const [name, patch] of CASES) {
    await page.evaluate((p) => (window as any).__game.set(p), patch)
    await page.waitForTimeout(1200)
    const txt = await page.evaluate(() => (document.getElementById('screen') as HTMLElement).innerText)
    for (const b of BANNED) expect(txt, `${name} 에 "${b}" 가 뜬다`).not.toContain(b)
  }
})
