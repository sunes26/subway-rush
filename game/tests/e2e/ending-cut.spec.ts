/**
 * 엔딩 컷 — **실제 플레이로** 잡는다.
 *
 * `seekOutro` 로 시각을 못 박아 찍는 방법도 있고 그쪽이 훨씬 싸다. 그런데 그건
 * 컷 함수가 내는 그림만 확인할 뿐, **판이 실제로 그 컷에 도달하는지**는 말해 주지
 * 않는다 — E-12 가 도달 불가인 채로 유닛 테스트를 통과하고 있었던 것과 같은 종류의
 * 사각이다. 그래서 여기서는 아무것도 못 박지 않는다:
 *
 *   실제 키 입력으로 시작 → 실제 열차 스케줄로 문이 열림 → 걸어 들어가 `BOARD`
 *   → `tick` 이 `END` 발행 → `main.ts` 가 컷을 켬 → 5.2초를 **실시간으로** 흘려보냄
 *
 * ⚠ 앞 2.5분(도보·자판기·개찰구)만 건너뛴다. 열차가 오기 직전 승강장에 세우는 것이
 *   전부이고, 그 뒤로는 손대지 않는다 — 탑승 판정도 종료 판정도 컷 시작도 전부
 *   실제 코드가 낸다.
 */

import { expect, test, type Page } from '@playwright/test'
import { TRAIN } from '../../src/data/tuning'
import { DOOR_XS, FLOOR, Y_OFFSET_OPP } from '../../src/data/world'
import { anchorXOf, OUTRO_MS, SHOT } from '../../src/render/outro'

const DIR = 'tests/e2e/__shots__/ending'

const boot = async (page: Page): Promise<void> => {
  await page.goto('/?seed=7')
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30_000 })
  await page.waitForFunction(
    () => (document.getElementById('load') as HTMLElement | null)?.style.display === 'none',
    null, { timeout: 240_000 })
  await page.waitForTimeout(600)
}

/** 실제 키로 시작하고 인트로를 건너뛴다 — 게임이 쓰는 그 경로 그대로다 */
const startPlaying = async (page: Page): Promise<void> => {
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game!.state().phase === 'intro', null, { timeout: 30_000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game!.state().phase === 'playing', null, { timeout: 30_000 })
}

/**
 * 열차가 문을 여는 순간의 승강장에 세운다.
 *
 * ⚠ **시계를 미는 것까지가 건너뛰는 전부다.** 소프트웨어 래스터(swiftshader)에서는
 *   한 프레임이 수백 ms 라, 프레임당 시뮬이 `MAX_STEPS_PER_FRAME` 만큼밖에 못
 *   전진한다 — 실측으로 10초 동안 시뮬은 0.2초 흘렀다. 3분을 실시간으로 흘리는 것은
 *   이 환경에서 원리적으로 불가능하고, 기존 인트로 스펙들이 `seekIntro` 로 시각을
 *   못 박는 이유도 같다.
 *
 *   대신 **판정은 하나도 안 건드린다**: 문이 열리는지, 걸어 들어가 탑승이 성립하는지,
 *   열차가 떠나 엔딩이 나는지, 컷이 켜지는지는 전부 실제 코드가 낸다.
 *
 * @param opp 반대 방면 승강장이면 참
 * @param at  승강장에 설 때의 `elapsedMs`. 이 값이 곧 **얼마나 아슬아슬하게 타는가**다
 */
const toPlatform = async (
  page: Page, opp: boolean, at: number, doorX = DOOR_XS[8] as number,
): Promise<void> => {
  await page.evaluate(({ doorX: dx, floorB2, yOff, at: t }) => {
    const g = window.__game!
    const s = g.state()
    g.set({
      elapsedMs: t,
      timeLeftMs: 180_000 - t,
      player: { ...s.player, pos: { x: dx, y: 10.4 + yOff, z: floorB2 } },
    })
  }, {
    doorX,
    floorB2: FLOOR.B2,
    yOff: opp ? Y_OFFSET_OPP : 0,
    at,
  })
}

/** 문이 완전히 열린 직후 — 여유 있게 걸어 들어가는 판 */
const EASY_AT = TRAIN.stopMs + 1_300
/** 닫히기 1.2초 전에 도착 — 걸어 들어가는 사이 문이 닫히기 시작한다 */
const TIGHT_AT = TRAIN.closeStartMs - 1_200

/** 문이 열릴 때까지 기다렸다가 **실제 이동 입력**으로 걸어 들어간다 */
const walkIn = async (page: Page, opp: boolean): Promise<void> => {
  await page.waitForFunction(
    (o) => {
      const t = o ? window.__game!.state().train2 : window.__game!.state().train
      return (t.state === 'open' || t.state === 'closing') && t.doorProgress > 0.3
    },
    opp, { timeout: 40_000 })
  // 월드 +y 로 걷는다 — 시선이 동쪽(yaw 0)일 때 그 방향은 A 다
  await page.keyboard.down('a')
  await page.waitForFunction(() => window.__game!.state().boarded, null, { timeout: 120_000 })
  await page.keyboard.up('a')

  /**
   * 탑승 뒤 출발까지도 3초(문 닫힘 1.2 + 대기 0.8 + 출발 2)를 시뮬이 흘려야 한다.
   * 그 3초가 여기서는 수십 초라 시계만 출발 직전으로 민다 — **종료 판정은 그대로
   * `tick` 이 낸다**(`train.state === 'departed'` 를 보고 `END` 를 발행).
   */
  await page.evaluate(() => {
    const g = window.__game!
    /**
     * 출발까지 3초를 시뮬이 흘려야 하는데 여기서는 그게 수십 초다. **탄 순간 기준**
     * 으로 밀어 준다 — 절대값(181_900)으로 밀면 어떤 판이든 잔여가 0 이 되어
     * 결과판이 늘 `0:00` 을 찍는다(실측). `withBoarding` 이 보는 것도 이 차이다.
     */
    const b = g.state().boardedAtMs ?? 0
    const at = b + 3_100
    g.set({ elapsedMs: at, timeLeftMs: 180_000 - at })
  })
}

/**
 * 컷의 각 박자를 찍는다.
 *
 * ★ **찍을 때만 컷 시계를 고정한다**(`seekOutro`). 컷 자체는 실제 플레이가 켠
 *   것이고 여기서 다시 켜지 않는다 — 다만 이 환경에서는 스크린샷 한 장에 수십 초가
 *   걸려서(소프트웨어 래스터 + ReadPixels 스톨), 벽시계로 흐르게 두면 첫 장을 찍기도
 *   전에 5.2초가 끝난다. 실측으로 그랬다: 첫 장이 이미 결과판이었다.
 *   `render/intro.ts` 의 `seekIntro` 와 같은 이유·같은 수법이다.
 */
const shots = async (page: Page, tag: string, kind: 'success' | 'jit' | 'wrongway'): Promise<void> => {
  const marks: readonly [string, number][] = [
    ['1-body', 600],
    ['2-turn', SHOT.turn - 200],
    ['3-outside', SHOT.turn + 900],
    ['4-end', OUTRO_MS - 400],
  ]
  for (const [name, at] of marks) {
    await page.evaluate(([k, t]) => window.__game!.seekOutro(k as 'success', t as number),
      [kind, at] as [string, number])
    // 고정한 시각이 실제로 그려질 때까지 몇 프레임 흘린다
    await page.evaluate(() => new Promise<void>((res) => {
      let n = 0
      const step = (): void => { if (++n >= 4) res(); else requestAnimationFrame(step) }
      requestAnimationFrame(step)
    }))
    await page.screenshot({ path: `${DIR}/${tag}-${name}.png` })
  }
}

const runCut = async (
  page: Page, opp: boolean, tag: string, at = EASY_AT, doorX = DOOR_XS[8] as number,
): Promise<string> => {
  await page.setViewportSize({ width: 960, height: 540 })
  await boot(page)
  await startPlaying(page)
  await toPlatform(page, opp, at, doorX)
  await walkIn(page, opp)

  // 탑승 → 출발 → 종료까지도 실제 시계로 기다린다(`TRAIN.boardDwellMs` + 2초)
  await page.waitForFunction(() => window.__game!.state().phase === 'ended', null, { timeout: 30_000 })
  const id = await page.evaluate(() => window.__game!.state().endingId!)
  await shots(page, tag, opp ? 'wrongway' : id === 'E-04' ? 'jit' : 'success')
  // 컷이 끝나면 결과판이 뜬다 — 그것까지가 한 판이다
  await page.evaluate(() => window.__game!.seekOutro('success', 99_999))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${DIR}/${tag}-5-board.png` })
  return id
}

test.describe('엔딩 컷 — 실제 플레이', () => {
  test.setTimeout(600_000)

  test('여유 있게 타면 성공 컷이 돌고 결과판으로 넘어간다', async ({ page }) => {
    const id = await runCut(page, false, 'success')
    // 문이 열리자마자 탔으므로 「문틈 낑김」이 아니어야 한다
    expect(id).not.toBe('E-04')
    expect(id).not.toBe('E-08')
  })

  test('반대 방면에 타면 WRONG WAY 컷이 돈다', async ({ page }) => {
    const id = await runCut(page, true, 'wrongway')
    expect(id).toBe('E-08')
  })

  /**
   * 세 컷 중 유일하게 한 번도 안 찍혀 본 것이었다. 닫히기 1.2초 전에 승강장에 서면
   * 걸어 들어가는 사이 문이 닫히기 시작하고, `boardedCloseInMs` 가 임계값 아래로 떨어진다.
   *
   */
  test('닫히는 문으로 들어가면 JUST IN TIME 컷이 돈다', async ({ page }) => {
    const id = await runCut(page, false, 'jit', TIGHT_AT)
    expect(id).toBe('E-04')
  })
})

/**
 * 문별 앵커 — **이 스펙이 비어 있어서 버그가 세 번 살아남았다.**
 *
 * 위 세 테스트는 전부 `DOOR_XS[8]`(객차 오프셋 +2) 하나만 밟는다. 그런데 객차에는
 * 문이 넷(+2·+6·+10·+14) 있고, 옛 앵커 공식(`문 + 2m`)은 **+14 문에서만** 사람을
 * 차량 연결부에 세웠다 — 32개 문 중 8개다. 통과하는 테스트만 보고 "고쳤다"고 세 번
 * 보고한 뒤에야 잡혔다.
 *
 * 그래서 여기서는 **그림을 안 찍고 자로 잰다.** 컷이 도는 중에 인물이 설 자리에서
 * 창 쪽으로 레이를 쏘아, 그 자리가 진짜 객실 구간인지 확인한다:
 *
 *   제대로 된 자리 → 좌석 1.42m · 창 1.51m · 차체 1.53m
 *   연결부         → **아무것도 없음.** 16m 밖 역 벽까지 관통한다(실측)
 */
test.describe('어느 문으로 타도 같은 자리에 선다', () => {
  test.setTimeout(600_000)

  /** 한 객차(k=2)의 문 넷. 왼쪽 끝 · 가운데 둘 · 오른쪽 끝 */
  const DOORS = [
    ['왼쪽(+2)', DOOR_XS[8] as number],
    ['중앙-1(+6)', DOOR_XS[9] as number],
    ['중앙-2(+10)', DOOR_XS[10] as number],
    ['오른쪽(+14)', DOOR_XS[11] as number],
  ] as const

  for (const [label, doorX] of DOORS) {
    for (const opp of [false, true]) {
      const dir = opp ? 'WRONG WAY' : 'SUCCESS'
      test(`${label} 문 → ${dir} — 벽·연결부에 안 낀다`, async ({ page }) => {
        await runCut(page, opp, `door-${doorX}${opp ? '-opp' : ''}`, EASY_AT, doorX)

        /**
         * ⚠ **앵커를 여기서 계산한다.** 한때 `state.player.pos.x` 를 읽었는데 그건
         *   **탄 자리**(문 앞)다 — 컷은 상태를 안 건드리고 렌더에만 앵커를 쓴다.
         *   그래서 옛 공식으로 되돌려도 이 테스트가 통과했다(실측). 문 앞에는 늘
         *   객실 구조가 있으니 당연히 통과한다. 재야 할 곳은 **사람이 서게 될 x** 다.
         */
        const st = await page.evaluate(() => {
          const s = window.__game!.state()
          return {
            doorX: s.boardedDoorX!,
            trainX: (s.boardedTrain2 ? s.train2 : s.train).x,
          }
        })
        const anchorX = anchorXOf(st.doorX, st.trainX)

        const probe = await page.evaluate(({ yOff, floorB2, ax }) => {
          const g = window.__game!
          const tick = (): Promise<void> => new Promise((res) => {
            let n = 0
            const step = (): void => { if (++n >= 3) res(); else requestAnimationFrame(step) }
            requestAnimationFrame(step)
          })
          const out: Record<string, { name: string; dist: number }[]> = {}
          // 통로 한가운데에서 창(북)으로 — 좌석 높이와 창 높이 두 번
          return (async () => {
            for (const h of [0.5, 1.6]) {
              g.freeCam([ax, 13.95 + yOff, floorB2 + h], [ax, 18.95 + yOff, floorB2 + h])
              await tick()
              out[`h${h}`] = g.pick(0, 0).slice(0, 3)
            }
            return out
          })()
        }, { yOff: opp ? Y_OFFSET_OPP : 0, floorB2: FLOOR.B2, ax: anchorX })

        for (const [where, hits] of Object.entries(probe)) {
          /**
           * 객실 안이면 3m 안에 차체가 있다. 연결부라면 첫 히트가 16m 밖 역
           * 구조물이므로 이 한 줄이 그대로 걸린다.
           */
          const near = hits.filter((h) => h.dist < 3)
          expect(near.length, `${label} ${where}: 3m 안이 비었다 — ${JSON.stringify(hits)}`)
            .toBeGreaterThan(0)
          expect(near.some((h) => /TR_(SEAT|WINDOW|BODY|DOOR|INNER)/.test(h.name)),
            `${label} ${where}: 객실 구조가 없다 — ${JSON.stringify(hits)}`).toBe(true)
        }
      })
    }
  }
})

/**
 * 두 번째 판 — **엔딩 연출이 남으면 안 된다.**
 *
 * 무대·광원·붉은 기·카메라 화각은 전부 컷이 켠 것이라, 끄는 것을 한 군데라도
 * 빠뜨리면 다음 판에 그대로 묻어난다. 특히 WRONG WAY 뒤 성공 판에 붉은 빛이
 * 남는 것이 최악이다 — 다시하기를 눌렀는데 아직 지옥에 있는 것으로 보인다.
 */
test.describe('엔딩 뒤 정리', () => {
  test.setTimeout(600_000)

  test('WRONG WAY 로 끝낸 뒤 다시하기하면 아무것도 안 남는다', async ({ page }) => {
    await runCut(page, true, 'reset-before')

    // `restart()` 는 `initialState` 로 되돌린다 — 즉 **타이틀**이지 바로 플레이가 아니다
    await page.keyboard.press('r')
    await page.waitForFunction(() => window.__game!.state().phase === 'title', null,
      { timeout: 30_000 })

    const left = await page.evaluate(() => {
      let stage = 'none'
      let lights = ''
      ;(window as any).__scene.traverse((o: any) => {
        if (o.name !== 'ending-stage') return
        stage = `visible=${o.visible}`
        lights = o.children
          .filter((c: any) => c.isLight)
          .map((c: any) => c.intensity.toFixed(3)).join(',')
      })
      /**
       * 실내 감광이 되돌아왔는가 — 컷이 `setIndirect` 로 씬 광원 5개를 한꺼번에
       * 낮춘다. 안 되돌리면 **다음 판의 역 전체가 어둡다.**
       */
      /**
       * 치웠던 전경이 돌아왔는가 — 컷이 기둥·차문·창틀·차체 셸을 통째로 숨긴다.
       * 안 되돌리면 **다음 판의 열차가 껍데기만 남는다.**
       */
      let hiddenLeft = 0
      ;(window as any).__scene.traverse((o: any) => {
        if (/^merged:(B_)?TR_(INNER|DOOR|WINDOW|BODY)$/.test(o.name) && !o.visible) hiddenLeft++
      })
      let amb = -1
      ;(window as any).__scene.traverse((o: any) => {
        if (o.isAmbientLight) amb = o.intensity
      })
      const veil = document.querySelector('#outro .veil') as HTMLElement | null
      const outro = document.getElementById('outro')
      return {
        stage,
        lights,
        veil: veil ? veil.style.opacity : 'no-el',
        outroCls: outro?.className ?? 'no-el',
        board: document.getElementById('screen')?.innerHTML.length ?? -1,
        fov: (window as any).__camera.fov,
        amb, hiddenLeft,
      }
    })

    expect(left.stage, '무대가 꺼져 있어야 한다').toBe('visible=false')
    expect(left.lights, '광원이 0 이어야 한다').toMatch(/^0\.000(,0\.000)*$/)
    expect(left.veil, '붉은 기가 걷혀 있어야 한다').toMatch(/^(0|)$/)
    expect(left.outroCls, '오버레이가 꺼져 있어야 한다').toBe('')
    // 타이틀로 돌아왔으므로 결과판이 아니라 **타이틀 판**이 떠 있어야 한다
    expect(left.board, '타이틀이 떠 있어야 한다').toBeGreaterThan(0)
    // 컷은 화각을 46~55 로 몰았다. 조작권이 돌아오면 1인칭 화각으로 돌아와야 한다
    expect(left.fov, '화각이 복원돼야 한다').toBeGreaterThan(60)
    // WRONG WAY 는 간접광을 0.28 배까지 내린다. 복원 안 되면 역이 어두운 채로 남는다
    expect(left.amb, '간접광이 복원돼야 한다').toBeGreaterThan(0.1)
    expect(left.hiddenLeft, '치웠던 기둥·차문이 돌아와야 한다').toBe(0)
  })
})
