/**
 * §31 — B → C → D 구간을 **프레임 단위**로 잰다.
 *
 * 영상이 움직이면 한 프레임짜리 사고는 눈으로 못 잡는다. 화면을 읽어
 * **평균 밝기**를 숫자로 뽑고, 같은 프레임에서 카메라·주인공·버스 상태를 함께
 * 기록한다. 판정은 사람이 아니라 아래 단정들이 한다.
 */
import { expect, test, type Page } from '@playwright/test'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 90_000 })
  await page.waitForTimeout(900)
}

type Row = {
  t: number; lum: number; cam: [number, number, number]
  actor: [number, number, number]; vis: boolean; busOn: number
}

test('B→C→D 프레임 검사 — 흰 플래시·순간이동·버스 소실', async ({ page }) => {
  test.setTimeout(600_000)
  await boot(page)

  const rows: Row[] = []
  // 휴대폰 끝(2.6s) → 하차 → 질주 시작(4.6s). 30fps 기준 33ms 간격
  for (let t = 2600; t <= 4600; t += 33) {
    await page.evaluate((ms) => window.__game!.seekIntro(ms), t)
    await page.waitForTimeout(120)
    /**
     * 밝기는 **렌더 직후** 엔진이 직접 읽는다(`main.ts` 참고). 캔버스를
     * `drawImage` 로 퍼 오면 `preserveDrawingBuffer` 가 꺼져 있어 전부 0 이 나온다 —
     * 실제로 그렇게 재다가 화이트아웃 검사가 통째로 무효였다.
     */
    await page.evaluate(() => window.__game!.wantLuma())
    await page.waitForFunction(() => window.__game!.luma() >= 0, null, { timeout: 20_000 })
    rows.push(await page.evaluate((ms) => {
      const p = window.__game!.introProbe()
      return { t: ms, lum: window.__game!.luma(), cam: p.cam, actor: p.actor,
        vis: p.visible, busOn: p.busOn }
    }, t))
  }

  const at = (t: number): Row => rows.find((r) => r.t >= t)!
  const fmt = (r: Row): string =>
    `${r.t}ms L${r.lum.toFixed(0)} cam(${r.cam[0].toFixed(1)},${r.cam[2].toFixed(1)}) ` +
    `actor(${r.actor[0].toFixed(1)},${r.actor[1].toFixed(1)}) vis=${r.vis} bus=${r.busOn}`
  console.log(rows.filter((r) => r.t >= 3690 && r.t <= 4000).map(fmt).join('\n'))

  /**
   * ① **한 프레임짜리 밝기 스파이크**가 없다 — 그것이 "화면이 번쩍했다"의 정체다.
   *
   * ⚠ 앞뒤 차이(|Δ|)로 재면 안 된다. 흰 캐릭터가 화면 중앙을 지나가기만 해도
   *   107 → 155 → 115 같은 **완만한 언덕**이 생기는데, 그건 주인공이 문에서
   *   내려서는 정상적인 움직임이다(3.8s 구간). 실제로 그렇게 쟀다가 정상 프레임을
   *   결함으로 잡았다.
   *
   *   플래시는 **양쪽 이웃보다 혼자 밝은** 프레임이다. 램프는 항상 두 이웃 사이에
   *   놓이므로 이 식이 0 이하가 된다.
   *
   * 컷(2.8s·4.1s)은 장면이 통째로 바뀌므로 건너뛴다.
   */
  const CUTS = [2800, 4100]
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1]!, b = rows[i]!, c = rows[i + 1]!
    if (CUTS.some((x) => b.t > x - 90 && b.t < x + 90)) continue
    const spike = b.lum - Math.max(a.lum, c.lum)
    expect(spike, `${b.t}ms 한 프레임 플래시\n${fmt(a)}\n${fmt(b)}\n${fmt(c)}`).toBeLessThan(10)
  }
  // ② 완전 흰 화면이 없다
  for (const r of rows) expect(r.lum, `${r.t}ms 화이트아웃`).toBeLessThan(215)

  /**
   * ③ 주인공이 순간이동하지 않는다. 컷을 사이에 두고도 **월드 좌표는 이어진다** —
   *    카메라만 바뀌지 사람은 그대로 걸어 나온다.
   */
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!, b = rows[i]!
    const d = Math.hypot(b.actor[0] - a.actor[0], b.actor[1] - a.actor[1])
    expect(d, `${b.t}ms 주인공 순간이동 (${d.toFixed(2)}m)`).toBeLessThan(0.25)
  }

  // ④ 버스는 정차 이후 계속 켜져 있다 — 하차부터 게임까지 같은 개체다
  for (const r of rows) {
    if (r.t < 2900) continue
    expect(r.busOn, `${r.t}ms 버스 외피가 꺼졌다`).toBe(4)
  }

  // ⑤ 하차 순서 — 문이 열린 뒤에 주인공이 밖(y>22)으로 나온다
  expect(at(2900).actor[1], '2.9s 에는 아직 버스 안').toBeLessThan(21.7)
  expect(at(4090).actor[1], '4.1s 에는 인도 위').toBeGreaterThan(22.2)
})
