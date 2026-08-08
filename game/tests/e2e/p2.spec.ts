/**
 * P2 E2E — 유닛이 못 잡는 층: 도감 DOM · localStorage 영속 · 교체 창 UI · 시드 무작위.
 *
 * 체크리스트: S14-1 · S15-5 · S18-4/5 · **S18-G(P2 게이트)**
 */

import { expect, test, type Page } from '@playwright/test'
import { SLOTS } from '../../src/data/tuning'

const SAVE_KEY = 'subway-rush.save.v1'

const collectConsole = (page: Page): string[] => {
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
  return errs
}

const boot = async (page: Page, query = '?seed=7'): Promise<string[]> => {
  const errs = collectConsole(page)
  await page.goto(`/${query}`)
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 60_000 },
  )
  await page.waitForTimeout(600)
  return errs
}

test.describe('S18-4/5 엔딩 도감', () => {
  test('C 를 누르면 16칸이 열리고 미해금은 ??? 다', async ({ page }) => {
    const errs = await boot(page)
    await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY)

    await page.keyboard.press('KeyC')
    await page.waitForTimeout(250)

    const cells = page.locator('#collection .cell')
    await expect(cells).toHaveCount(16)
    await expect(page.locator('#collection .cell.locked')).toHaveCount(16)
    await expect(page.locator('#collection .sub')).toContainText('0 / 16')
    // 조건식이 노출되면 안 된다 — 도감이 체크리스트가 되면 수집이 아니라 심부름이다
    const text = await page.locator('#collection').innerText()
    expect(text).not.toContain('>=')
    expect(text).not.toContain('conscience')

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.locator('#collection.on')).toHaveCount(0)
    expect(errs, errs.join('\n')).toEqual([])
  })

  test('엔딩에 도달하면 기록되고 새로고침 후에도 남는다', async ({ page }) => {
    await boot(page)
    await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY)

    // 탑승 + 잔여 40초 → E-02
    await page.evaluate(() => {
      const g = window.__game!
      g.set({ phase: 'ended', endingId: 'E-02', boarded: true, timeLeftMs: 40_000 })
    })
    /**
     * ⚠ 벽시계 400ms 로 기다렸더니 **전체 스위트에서만** 간헐 실패했다. 기록은 프레임
     * 루프가 하는데 소프트웨어 래스터에서 한 프레임이 수백 ms 다 — 부하가 걸리면
     * 그 사이 프레임이 한 번도 안 돈다. 기다릴 것은 시간이 아니라 **저장소의 값**이다.
     */
    await page.waitForFunction(
      (k) => (localStorage.getItem(k) ?? '').includes('E-02'), SAVE_KEY, { timeout: 20_000 })
    const saved = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)
    expect(saved, '엔딩이 저장돼야 한다').toContain('E-02')

    // 새로고침 — 도감이 그 칸을 기억한다
    await boot(page)
    await page.keyboard.press('KeyC')
    await page.waitForTimeout(250)
    await expect(page.locator('#collection .cell.got')).toHaveCount(1)
    await expect(page.locator('#collection .sub')).toContainText('1 / 16')
  })

  test('같은 엔딩 화면이 떠 있어도 횟수가 한 번만 는다', async ({ page }) => {
    await boot(page)
    await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY)
    await page.evaluate(() => {
      const g = window.__game!
      g.set({ phase: 'ended', endingId: 'E-01', boarded: true, timeLeftMs: 9000 })
    })
    await page.waitForTimeout(1200)             // 70프레임 이상 머문다
    const seen = await page.evaluate((k) => {
      const raw = localStorage.getItem(k)
      return raw ? (JSON.parse(raw).endings['E-01']?.seen ?? 0) : 0
    }, SAVE_KEY)
    expect(seen, '매 프레임 기록되면 안 된다').toBe(1)
  })
})

test.describe('S15-5 교체 창 (UI-14)', () => {
  test('가득 찬 채 습득하면 게이지가 뜨고 0.9초 뒤 사라진다', async ({ page }) => {
    await boot(page)
    /**
     * **슬롯 수만큼** 채운다. 예전엔 3개를 박아 뒀는데 P2 에서 `SLOTS` 가 10 이 되면서
     * "가득 찬 채 습득"이 성립하지 않았다 — 빈 칸이 남으니 교체 창이 안 뜬다.
     * 숫자를 다시 박지 않고 `SLOTS` 에서 만든다.
     * (⚠ `evaluate` 안에서는 바깥 변수를 못 읽는다 — **인자로** 넘긴다)
     */
    const FILL = ['I-12', 'I-06', 'I-09', 'I-01', 'I-03', 'I-05', 'I-07', 'I-08', 'I-10', 'I-11']
    await page.evaluate((full) => {
      const g = window.__game!
      const st = g.state()
      g.set({
        phase: 'playing',
        inventory: full,
        // 노선도는 P2 에서 **Z2 남쪽 벽**(42.5, 0.06)으로 옮겨졌다 — 옛 좌표(26, 14.2)에는
        // 이제 아무것도 없어서 습득 자체가 안 일어났다(전체 스위트 실패의 진짜 원인)
        player: { ...st.player, pos: { x: 42.5, y: 1.7, z: -6 }, vel: { x: 0, y: 0 } },
      })
      g.look(-Math.PI / 2, -0.1)
    }, Array.from({ length: SLOTS }, (_, i) => FILL[i % FILL.length]) as unknown as never)
    await page.waitForTimeout(150)
    await page.keyboard.press('KeyE')

    /**
     * ⚠ 벽시계로 기다리면 안 된다. 소프트웨어 래스터(SwiftShader)에서는 프레임이 길고
     * `MAX_STEPS_PER_FRAME` 이 시뮬을 5스텝으로 자르므로 **시뮬 시간이 실시간의 1/5 이하**로
     * 흐른다(실측: 1.6초 벽시계에 시뮬 0.2초). 상태를 직접 기다린다.
     */
    await page.waitForFunction(() => window.__game!.state().swap.active, null, { timeout: 30_000 })
    await expect(page.locator('#hud .swap.on')).toHaveCount(1)

    await page.waitForFunction(() => !window.__game!.state().swap.active, null, { timeout: 30_000 })
    await expect(page.locator('#hud .swap.on')).toHaveCount(0)
    const inv = await page.evaluate(() => window.__game!.state().inventory)
    expect(inv[0], '아무것도 안 누르면 P1 규칙 그대로다').toBe('I-13')
  })
})

test.describe('S14-1 · S18-G 시드', () => {
  test('?seed= 없이 두 번 열면 서로 다른 시드가 나온다', async ({ page }) => {
    await boot(page, '')
    const a = await page.evaluate(() => window.__game!.state().seed)
    await boot(page, '')
    const b = await page.evaluate(() => window.__game!.state().seed)
    expect(a).not.toBe(b)
  })

  test('P2 게이트 — 시드 3개의 방해요소 세트가 서로 다르다', async ({ page }) => {
    const sets: string[] = []
    for (const seed of [11, 22, 33]) {
      await boot(page, `?seed=${seed}`)
      const s = await page.evaluate(() => {
        const st = window.__game!.state()
        return { obs: st.obstacles.join(','), q: st.queues.join(',') }
      })
      sets.push(`${s.obs}|${s.q}`)
    }
    expect(new Set(sets).size, sets.join('\n')).toBe(3)
  })
})

test.describe('S19-1/2 사운드가 실제로 울린다', () => {
  /**
   * **"사운드 추가한 거 맞아? 소리가 안 나는데"** 에서 나온 회귀 테스트.
   *
   * 그때 절차 생성음은 울리고 있었다 — 마스터 0.22 × 발소리 0.16 = 진폭 **0.035** 라
   * 사실상 안 들렸을 뿐이다. 앰비언스는 **별도 AudioContext** 를 만들어 `suspended` 로
   * 멈춰 있었고 그건 진짜 무음이었다. 볼륨은 숫자로 못 재므로 **재생 여부**를 잠근다.
   */
  test('발소리 샘플이 로드되고 M 으로 음소거된다', async ({ page }) => {
    await boot(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__game!.sfxReady(), null, { timeout: 20_000 })
    // 녹음 샘플(public/audio/footsteps.mp3) 이 디코드된다
    await page.waitForFunction(() => window.__game!.stepsReady(), null, { timeout: 30_000 })

    /**
     * ⚠ `press` 직후에 단정하면 안 된다. 소프트웨어 래스터에서는 rAF 한 프레임이
     * 수백 ms 라 입력이 아직 `input.sample()` 을 안 지났다. **상태를 기다린다.**
     */
    await page.keyboard.press('KeyM')
    await page.waitForFunction(() => window.__game!.sfxMuted(), null, { timeout: 30_000 })
    await page.keyboard.press('KeyM')
    await page.waitForFunction(() => !window.__game!.sfxMuted(), null, { timeout: 30_000 })
  })

  test('사건음이 실제로 재생 시도된다 (슬롯 클릭)', async ({ page }) => {
    await boot(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__game!.sfxReady(), null, { timeout: 20_000 })
    const before = await page.evaluate(() => window.__game!.sfxPlays())
    await page.keyboard.press('Digit1')
    await page.waitForFunction((n) => window.__game!.sfxPlays() > n, before, { timeout: 30_000 })
    expect(await page.evaluate(() => window.__game!.sfxPlays())).toBeGreaterThan(before)
  })
})

test.describe('P2 방해요소 액터가 화면에 있다', () => {
  /**
   * **"도 아십니까 아주머니가 구현 안 된 것 같다"** 에서 나온 회귀 테스트.
   *
   * 리그(aj/ajp/zp/ss)는 진작 만들어져 있었는데 `copy-assets` 목록에 없어 반입이 안 됐고,
   * 그래서 판정만 돌고 **몸이 없었다.** 보이지 않는 방해요소는 GDD §11 이 금지한
   * *단서 없는 랜덤 처형*이다 — 피할 대상이 화면에 있어야 피한다.
   */
  const rigNames = (page: import('@playwright/test').Page): Promise<string[]> =>
    page.evaluate(() => {
      const names: string[] = []
      const sc = (window as unknown as { __scene: { traverse: (f: (o: unknown) => void) => void } }).__scene
      sc.traverse((o) => {
        const oo = o as { name?: string; visible?: boolean }
        if ((oo.name || '').startsWith('npc:')) names.push(`${oo.name}:${oo.visible ? 'on' : 'off'}`)
      })
      return names
    })

  test('시드 10 — 아주머니·전단지·역무원 리그가 씬에 올라온다', async ({ page }) => {
    const errs = await boot(page, '?seed=10')
    const names = await rigNames(page)
    for (const key of ['aj_char', 'ajp', 'zp', 'ss']) {
      expect(names.some((n) => n.includes(key)), `${key} 리그 없음: ${names.join(', ')}`).toBe(true)
    }
    expect(errs.filter((e) => e.includes('[actors]')), errs.join(' | ')).toEqual([])
  })

  test('비활성 방해요소는 몸도 없다 — 세계가 활성 목록에 대해 거짓말하지 않는다', async ({ page }) => {
    await boot(page, '?seed=10')       // OBS-08(좀비폰족) 이 빠진 시드
    const active = await page.evaluate(() => window.__game!.state().obstacles)
    expect(active).not.toContain('OBS-08')
    // 플레이어를 좀비 경로 한가운데로 옮겨도 보이면 안 된다
    await page.evaluate(() => {
      const g = window.__game!
      const st = g.state()
      g.set({ phase: 'playing', player: { ...st.player, pos: { x: 20, y: 14, z: -6 } } })
    })
    await page.waitForTimeout(1200)
    const names = await rigNames(page)
    const zp = names.find((n) => n.includes('zp'))
    expect(zp, `zp 상태: ${zp}`).toContain(':off')
  })
})

test.describe('리그 전방축 — 네 방향', () => {
  /**
   * **"할아버지가 뒤로 걷는다"** 의 진범을 잠근다.
   *
   * `place()` 공식이 `-facing + π/2` 였다. three 의 로컬 +Z → 월드 `(sin θ, −cos θ)` 규약과
   * 합쳐지면 그건 회전이 아니라 **북축 대칭 반사**다. 남·북은 반사의 **고정점**이라
   * 멀쩡해 보이고 **동·서만 180° 뒤집힌다.** 남북으로만 검증하면 절대 안 잡힌다 —
   * 실제로 두 번 놓쳤고, 세 번째에 디렉터가 동쪽으로 달리는 화면을 주고서야 잡혔다.
   *
   * 그래서 이 테스트는 **네 방향을 전부** 본다.
   */
  const forwardOf = ([root]: [string]) => {
    const w = window as unknown as { __scene: { traverse: (f: (o: unknown) => void) => void } }
    let obj: unknown = null
    w.__scene.traverse((o) => {
      const oo = o as { name?: string }
      if (!obj && (oo.name || '').startsWith(root)) obj = o
    })
    if (!obj) return null
    const n = obj as { updateWorldMatrix: (a: boolean, b: boolean) => void
                       matrixWorld: { elements: number[] } }
    n.updateWorldMatrix(true, false)
    const e = n.matrixWorld.elements
    const k = Math.hypot(e[8] ?? 0, e[10] ?? 0) || 1
    // three(x, y, z) → 월드(x, −z)
    return { x: (e[8] ?? 0) / k, y: -((e[10] ?? 0) / k) }
  }

  test('할아버지가 동·서·남·북 어디를 보든 몸이 그쪽을 향한다', async ({ page }) => {
    await boot(page, '?seed=7&obs=all')
    for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await page.evaluate((facing) => {
        const g = window.__game!
        const st = g.state()
        g.set({
          phase: 'ended', endingId: 'E-06', flags: ['GRANDPA_ANGRY'],
          player: { ...st.player, pos: { x: 23.1, y: 14.2, z: -6 }, vel: { x: 0, y: 0 } },
          chase: { ...st.chase, active: true, phase: 'chase', phaseMs: 400, remainingMs: 20_000,
            pos: { x: 26.5, y: 14.2 }, facing, hitCount: 0, swingCooldownMs: 0, stuckMs: 0 },
        })
      }, f)
      await page.waitForTimeout(700)
      const got = await page.evaluate(forwardOf, ['npc:gp'] as never)
      const dot = got ? got.x * Math.cos(f) + got.y * Math.sin(f) : -1
      expect(dot, `facing=${f.toFixed(2)} 에서 몸이 반대다 (dot=${dot.toFixed(2)})`)
        .toBeGreaterThan(0.95)
    }
  })
})

test.describe('자판기 QTE — 타이밍 바 (P2 개편)', () => {
  /**
   * P1의 좌↔우 드래그를 걷어내고 **왕복 마커 + 중앙 클릭**으로 바꿨다.
   * 유닛이 규칙을 잠그고, 여기서는 **실제 키보드/클릭이 붙는지**와 게이지가 그려지는지를 본다.
   */
  const openQte = async (page: import('@playwright/test').Page): Promise<void> => {
    await page.evaluate(() => {
      const g = window.__game!
      const st = g.state()
      g.set({
        phase: 'playing', inventory: ['I-01', null, null],
        player: { ...st.player, pos: { x: 13.03, y: 2.9, z: -6 }, vel: { x: 0, y: 0 } },
      })
      g.look(Math.PI / 2)
    })
    await page.waitForTimeout(200)
    // 1번 슬롯 — 첫 누름은 손에 쥔다, 두 번째 누름이 QTE 를 연다 (쥔 상태에서만 열린다)
    await page.keyboard.press('Digit1')
    await page.waitForTimeout(100)
    await page.keyboard.press('Digit1')
    await page.waitForFunction(() => window.__game!.state().qte.active, null, { timeout: 20_000 })
  }

  test('마커가 왕복하고 게이지가 화면에 뜬다', async ({ page }) => {
    await boot(page)
    await openQte(page)
    await expect(page.locator('#qte.on')).toHaveCount(1)
    /**
     * ⚠ **존재가 아니라 가시성**을 본다.
     *
     * `toHaveCount(1)` 만 있던 동안 `#qte` 가 `#dlg`(닫혀 있으면 `display:none`) 안에 들어가
     * 있었고, 게이지는 **한 픽셀도 안 그려지는데 테스트는 초록**이었다. 리듬 게임에서 창이
     * 안 보이면 판정이 운이 된다 — 눈에 보이는지를 잠근다.
     */
    await expect(page.locator('#qte')).toBeVisible()
    const box = await page.locator('#qte').boundingBox()
    expect(box?.width ?? 0, 'QTE 게이지가 화면에 실제 면적을 가져야 한다').toBeGreaterThan(200)
    expect(box?.height ?? 0).toBeGreaterThan(40)
    // 성공 구간 폭이 튜닝값 그대로 그려진다
    const w = await page.locator('#qte-win').evaluate((el) => (el as HTMLElement).style.width)
    expect(w).toBe('14%')
    // 마커가 실제로 움직인다
    const a = await page.evaluate(() => window.__game!.state().qte.pos)
    await page.waitForFunction((p0) => Math.abs(window.__game!.state().qte.pos - p0) > 0.1,
      a, { timeout: 20_000 })
  })

  test('중앙에서 누르면 성공 · 끝에서 누르면 미스', async ({ page }) => {
    await boot(page)
    await openQte(page)

    /**
     * 마커를 중앙에 **세워 두고** 누른다.
     *
     * ⚠ 예전엔 `pos` 만 0.5 로 놓고 눌렀다. 전체 스위트를 돌리면 그 사이에 프레임이
     *   여러 번 지나가고(한 프레임에 최대 5스텝) 마커가 구간 0.07 밖으로 나가 **간헐 실패**했다.
     *   `speedMul` 을 같이 죽여 표류 자체를 없앤다 — 검증 대상은 "가운데서 누르면 성공"이지
     *   "누르기까지 몇 프레임 걸렸나"가 아니다.
     */
    await page.evaluate(() => {
      const g = window.__game!
      const st = g.state()
      g.set({ qte: { ...st.qte, pos: 0.5, dirSign: 1, speedMul: 0.02 } })
    })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__game!.state().qte.strokes >= 1, null, { timeout: 20_000 })

    await page.evaluate(() => {
      const g = window.__game!
      const st = g.state()
      g.set({ qte: { ...st.qte, pos: 0.02, dirSign: -1, speedMul: 0.02 } })
    })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__game!.state().qte.misses >= 1, null, { timeout: 20_000 })
  })
})

/**
 * S22 설정 화면 (UI-15 · Figma node 15:4)
 *
 * 유닛이 못 잡는 층만 본다: ESC 우선순위 · **일시정지가 실제로 시간을 멈추는가** · 영속.
 */
test.describe('S22 ESC 설정', () => {
  const SET_KEY = 'subway-rush.settings.v1'

  test('ESC 로 열리고 열려 있는 동안 3분 타이머가 멈춘다', async ({ page }) => {
    const errs = await boot(page)
    await page.keyboard.press('Enter')                   // 타이틀 → 플레이
    await page.waitForFunction(() => window.__game!.state().phase === 'playing')
    await page.waitForTimeout(400)

    await page.keyboard.press('Escape')
    await expect(page.locator('#settings.on')).toHaveCount(1)
    await expect(page.locator('#settings .paused')).toHaveText('PAUSED')

    const t1 = await page.evaluate(() => window.__game!.state().timeLeftMs)
    await page.waitForTimeout(700)
    const t2 = await page.evaluate(() => window.__game!.state().timeLeftMs)
    expect(t2, '설정이 열린 동안 시간이 흘렀다 — 그러면 설정을 보는 것이 벌이 된다').toBe(t1)

    await page.keyboard.press('Escape')
    await expect(page.locator('#settings.on')).toHaveCount(0)
    await page.waitForFunction((t) => window.__game!.state().timeLeftMs < t, t1)
    expect(errs, errs.join('\n')).toEqual([])
  })

  test('값은 저장되고 새로고침 후에도 남는다', async ({ page }) => {
    await boot(page)
    await page.evaluate((k) => localStorage.removeItem(k), SET_KEY)

    await page.keyboard.press('Escape')
    await page.locator('#set-master').fill('40')
    await page.locator('#set-master').dispatchEvent('input')
    await page.locator('#set-invert').click()
    await page.locator('#set-res').selectOption('mid')

    await expect(page.locator('#val-master')).toHaveText('40%')
    await expect(page.locator('#val-invert')).toHaveText('ON')

    const saved = await page.evaluate((k) => localStorage.getItem(k), SET_KEY)
    expect(saved).toContain('"invertY":true')

    await boot(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('#val-master')).toHaveText('40%')
    await expect(page.locator('#set-res')).toHaveValue('mid')
  })

  test('대화 중 ESC 는 설정이 아니라 대화를 닫는다', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const g = window.__game!
      g.set({ phase: 'playing', act: { ...g.state().act, dialogId: 'ACT-02-GP' } })
    })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    // ESC 를 이미 쓰는 곳이 있으면 설정은 안 가져간다
    await expect(page.locator('#settings.on')).toHaveCount(0)
  })

  test('소지품이 10칸이고 마지막 칸 키캡이 0 이다', async ({ page }) => {
    await boot(page)
    await expect(page.locator('#hud-inv .slot')).toHaveCount(10)
    await expect(page.locator('#hud-inv .slot').nth(9).locator('b')).toHaveText('0')
    await expect(page.locator('#inv-c')).toHaveText('0 / 10')
  })
})

/**
 * S22-4 우산꽂이 · 벽 노선도 (디렉터 지시 2026-08-06)
 *
 * 유닛은 표만 본다. 여기서는 **씬에 실제로 뭐가 서 있는지**를 본다.
 */
test.describe('S22-4 우산꽂이 · 벽 노선도', () => {
  test('형광 자리표시자는 사라지고 진짜 우산이 꽂혀 있다', async ({ page }) => {
    const errs = await boot(page)
    const scene = await page.evaluate(() => {
      const names: string[] = []
      let pickup = 0
      let decorParts = 0
      ;(window as unknown as {
        __scene: { traverse(f: (o: { name?: string; children?: unknown[] }) => void): void }
      }).__scene.traverse((o) => {
        if (!o.name) return
        if (o.name.startsWith('Z2_OBJ16_umb')) names.push(o.name)
        if (o.name === 'prop:I-09') pickup++
        if (o.name === 'decor') decorParts = o.children?.length ?? 0
      })
      return { names, pickup, decorParts }
    })
    // GLB 의 발광 막대 6개는 `render/station.ts NODE_DROP` 이 뺀다
    expect(scene.names, '형광 막대가 아직 씬에 있다').toEqual([])
    // 습득 우산 1자루 + 장식은 **머티리얼별로 병합**돼 있다(자루 수가 아니라 재질 수가 나온다)
    expect(scene.pickup).toBe(1)
    expect(scene.decorParts, '장식 우산이 하나도 안 세워졌다').toBeGreaterThan(0)
    expect(errs, errs.join('\n')).toEqual([])
  })

  test('벽 노선도를 E 로 주우면 미니맵이 열린다', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const g = window.__game!
      // 벽(y=0) 남쪽을 보고 1.6m 앞에 선다 — 조준·사거리 둘 다 들어온다
      g.set({ phase: 'playing', player: { ...g.state().player, pos: { x: 42.5, y: 1.7, z: -6 } } })
      g.look(-Math.PI / 2, -0.1)
    })
    await page.waitForFunction(() => window.__game!.state().act.targetId === 'OBJ-15-MAP',
      null, { timeout: 20_000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__game!.state().inventory.includes('I-13'),
      null, { timeout: 20_000 })
    // 노선도를 얻으면 잠겨 있던 미니맵이 열린다 (UI-06)
    await expect(page.locator('#mini.locked')).toHaveCount(0)
  })
})
