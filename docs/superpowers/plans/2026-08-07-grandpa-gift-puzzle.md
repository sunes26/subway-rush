# 할아버지 선물 선택 퍼즐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Z2 편의점에서 선물 5종 중 하나를 고르고, 양갱만 정답이며, 오답·피격은 즉시 엔딩으로 끝나게 한다.

**Architecture:** 아이템 4종과 엔딩 2종을 데이터에 추가하고, 기존 `grandpaBranches` 대화 패턴을 매대용 5지로 복제한다. 즉시 종료는 `{ t: 'END', endingId }`를 시스템에서 직접 발행해 `resolveEnding`을 우회한다. 추격은 신규가 아니라 `systems/chase.ts` 개편이다.

**Tech Stack:** TypeScript · Vite · Vitest · three.js. 순수 함수 리듀서 + 시스템이 `Action[]`을 반환하는 구조.

## Global Constraints

- 불변성 — 상태를 제자리에서 고치지 않는다. 리듀서는 항상 새 객체를 만든다
- 시스템은 상태를 직접 바꾸지 않고 `Action[]`을 반환한다
- 테스트 먼저 (RED → GREEN → 커밋)
- 톤 가드레일 — 피 없음 · 데미지 수치 없음 · 슬랩스틱 · 훈계 금지 (`chase.ts:8-9`)
- 실패 엔딩 힌트는 조롱 금지 (`endings.ts:18`, GDD §11)
- 작업 디렉터리는 `game/`. 모든 명령은 거기서 실행한다
- 브랜치 `feat/grandpa-gift-puzzle` (스펙 커밋 `3666094` 위에 쌓는다)
- ⚠ **검증 명령이 커밋된 산출물을 더럽힌다.** `npm run build`(= `verify` 안)는
  커밋된 `game/dist/` 를 다시 굽고, `npm run test:e2e` 는 커밋된 스크린샷
  베이스라인 ~100장을 다시 쓴다. 검증 뒤 `git status` 로 확인하고, 의도한 파일만
  `git add` 한다. 나머지는 `git checkout --` 로 되돌린다.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/state/types.ts` | `ItemId`·`FlagId`·`EndingId` 유니온 | 수정 |
| `src/data/items.ts` | 아이템 정의 | 수정 |
| `src/data/endings.ts` | 엔딩 정의 | 수정 |
| `src/data/interactables.ts` | 상호작용 지점 · `InteractKind` | 수정 |
| `src/data/tuning.ts` | `CHASE` 상수 | 수정 |
| `src/systems/interact.ts` | 분기 함수 · `dialogPick` | 수정 |
| `src/systems/chase.ts` | 추격 로직 | 수정 |
| `src/render/props.ts` | `PLACEHOLDER_ITEMS` | 수정 |
| `src/ui/dialog.ts` | 대화창 렌더 | 수정 |
| `tests/unit/gift.test.ts` | 선물 퍼즐 유닛 | **생성** |
| `tests/unit/items.test.ts` | `SLOT_ITEMS` 개수 | 수정 |

---

### Task 1: 아이템 5종

**Files:**
- Modify: `src/state/types.ts:21-23` (`ItemId` 유니온)
- Modify: `src/data/items.ts` (`DEFS` 배열의 `I-12` 항목 + 신규 4종)
- Modify: `src/render/props.ts:60-72` (`PLACEHOLDER_ITEMS`·`PLACEHOLDER_LOOK`)
- Test: `tests/unit/items.test.ts:57`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `ItemId` 값 `'I-15' | 'I-16' | 'I-17' | 'I-18'`. `src/data/items.ts`에서 `export const GIFT_ITEMS: readonly ItemId[]` — Task 3·5가 쓴다

- [ ] **Step 1: 실패하는 테스트를 고친다**

`tests/unit/items.test.ts:57`을 바꾼다.

```ts
    expect(SLOT_ITEMS.length).toBe(15)
```

`tests/unit/items.test.ts` 맨 아래에 추가한다.

```ts
describe('편의점 선물 5종', () => {
  it('5종이 전부 정의돼 있고 노드 이름이 GLB 와 맞는다', () => {
    expect(GIFT_ITEMS).toEqual(['I-12', 'I-15', 'I-16', 'I-17', 'I-18'])
    expect(GIFT_ITEMS.map((i) => itemDef(i).node)).toEqual([
      'ITM12_Yanggaeng', 'ITM12_BananaMilk', 'ITM12_Chocolate',
      'ITM12_Soda', 'ITM12_SnackBag',
    ])
  })

  it('정답만 OBS-14 를 무효화한다', () => {
    expect(itemDef('I-12').negates).toEqual(['OBS-14'])
    for (const id of ['I-15', 'I-16', 'I-17', 'I-18'] as const) {
      expect(itemDef(id).negates ?? []).toEqual([])
    }
  })

  it('정답은 더 이상 자리표시자가 아니다', () => {
    expect(PLACEHOLDER_ITEMS.has('I-12')).toBe(false)
  })
})
```

임포트를 파일 상단에 더한다.

```ts
import { GIFT_ITEMS, itemDef } from '../../src/data/items'
import { PLACEHOLDER_ITEMS } from '../../src/render/props'
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- items`
Expected: FAIL — `GIFT_ITEMS` is not exported / `SLOT_ITEMS.length` 11 ≠ 15

- [ ] **Step 3: `ItemId` 유니온을 넓힌다**

`src/state/types.ts:21-23`을 바꾼다.

```ts
export type ItemId =
  | 'I-01' | 'I-02' | 'I-04' | 'I-05' | 'I-06' | 'I-07' | 'I-08'
  | 'I-09' | 'I-10' | 'I-11' | 'I-12' | 'I-13' | 'I-14' | 'I-15'
  | 'I-16' | 'I-17' | 'I-18'
```

- [ ] **Step 4: `I-12` 를 양갱으로 고치고 오답 4종을 더한다**

`src/data/items.ts`의 `I-12` 항목을 통째로 바꾼다.

```ts
  {
    id: 'I-12',
    name: '양갱',
    node: 'ITM12_Yanggaeng',
    slot: true,
    consumable: true,
    use: 'use',
    negates: ['OBS-14'],
    glyph: '🍡',
    noTargetReason: '드릴 사람이 없다',
  },
  /**
   * 오답 4종 — 편의점 매대의 나머지. **`negates` 를 비워 둔다.**
   * 오답으로도 추격이 막히면 퍼즐이 성립하지 않는다.
   * 바나나우유·초콜릿은 "헷갈리는 오답", 탄산음료·새우깡은 "명확한 오답"이다
   * (`docs/OBJECT-MANIFEST.md:184-187`).
   */
  {
    id: 'I-15',
    name: '바나나우유',
    node: 'ITM12_BananaMilk',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🥛',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-16',
    name: '초콜릿',
    node: 'ITM12_Chocolate',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍫',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-17',
    name: '탄산음료',
    node: 'ITM12_Soda',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🥤',
    noTargetReason: '드릴 사람이 없다',
  },
  {
    id: 'I-18',
    name: '새우깡',
    node: 'ITM12_SnackBag',
    slot: true,
    consumable: true,
    use: 'use',
    glyph: '🍤',
    noTargetReason: '드릴 사람이 없다',
  },
```

`src/data/items.ts` 파일 끝(`SLOT_ITEMS` 정의 아래)에 더한다.

```ts
/**
 * 편의점 선물 후보 — **첫 항목이 정답이다.**
 * 순서가 매대 선택창의 키 순서(`1`~`5`)와 같아야 한다.
 */
export const GIFT_ITEMS: readonly ItemId[] = ['I-12', 'I-15', 'I-16', 'I-17', 'I-18']

/** 정답 — 할아버지가 받는 유일한 선물 */
export const GIFT_CORRECT: ItemId = 'I-12'
```

- [ ] **Step 5: 자리표시자에서 `I-12` 를 뺀다**

`src/render/props.ts:60-61`을 바꾼다.

```ts
const PLACEHOLDER_ITEMS: ReadonlySet<ItemId> =
  new Set<ItemId>(['I-02', 'I-05', 'I-07', 'I-08', 'I-10', 'I-11', 'I-14'])
```

`src/render/props.ts:71-72`의 `I-12` 항목 두 줄(주석 포함)을 지운다.

```ts
  // 붕어빵 — P1 은 효자손 메시를 빌려 썼다. 자리표시자가 **덜 틀리다**
  'I-12': { c: 0xc98a3c, w: 0.16, h: 0.05, d: 0.08 },
```

`PLACEHOLDER_ITEMS`를 테스트에서 읽어야 하므로 `export` 를 붙인다.

```ts
export const PLACEHOLDER_ITEMS: ReadonlySet<ItemId> =
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test -- items`
Expected: PASS

Run: `npm run typecheck`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/state/types.ts src/data/items.ts src/render/props.ts tests/unit/items.test.ts
git commit -m "feat: 편의점 선물 5종 아이템 — 정답 양갱 + 오답 4종"
```

---

### Task 2: 엔딩 2종

**Files:**
- Modify: `src/state/types.ts` (`EndingId` 유니온)
- Modify: `src/data/endings.ts` (`ENDINGS` 배열)
- Test: `tests/unit/gift.test.ts` (**생성**)

**Interfaces:**
- Consumes: 없음
- Produces: `EndingId` 값 `'E-15'`(오답 증정)·`'E-16'`(단소 2대째). Task 5·6이 `{ t: 'END', endingId }`로 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts`를 만든다.

```ts
import { describe, expect, it } from 'vitest'
import { ENDINGS } from '../../src/data/endings'
import { start } from './_pilot'

describe('선물 퍼즐 엔딩', () => {
  it('E-15 · E-16 이 등록돼 있다', () => {
    const ids = ENDINGS.map((e) => e.id)
    expect(ids).toContain('E-15')
    expect(ids).toContain('E-16')
    expect(ENDINGS.length).toBe(16)
  })

  /**
   * 강제 엔딩은 `resolveEnding` 을 타지 않는다. `when` 이 참이 될 수 있으면
   * 열차 출발 경로에서 엉뚱하게 뽑힌다 — 그래서 항상 거짓이어야 한다.
   */
  it('강제 엔딩의 when 은 어떤 상태에서도 거짓이다', () => {
    const forced = ENDINGS.filter((e) => e.id === 'E-15' || e.id === 'E-16')
    const s = start(1)
    for (const e of forced) {
      expect(e.when(s)).toBe(false)
      expect(e.when({ ...s, boarded: true, timeLeftMs: 0 })).toBe(false)
    }
  })
})
```

상태는 `tests/unit/_pilot.ts` 의 `start(seed, patch)` 로 만든다 — 기존 유닛이 전부 그
헬퍼를 쓴다(`initialState` 를 직접 부르지 않는다).

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `ENDINGS.length` 14 ≠ 16

- [ ] **Step 3: `EndingId` 를 넓힌다**

`src/state/types.ts` 의 `EndingId` 유니온에 `'E-15' | 'E-16'` 을 더한다.

- [ ] **Step 4: 엔딩 2종을 더한다**

`src/data/endings.ts` 의 `ENDINGS` 배열에서 **`E-07`(priority 5) 과 fallback `E-06`(priority 0) 사이에** 넣는다.

⚠ 배열은 **priority 내림차순으로 정렬돼 있어야 하고**(`tests/unit/ending14.test.ts:88`)
priority 는 **유일해야 한다**(`tests/unit/ending6.test.ts:81`). 강제 엔딩은 `when` 이
항상 거짓이라 priority 가 선택에 쓰이지 않으므로, fallback 바로 위 최하위를 준다.
`85` 는 이미 `E-12` 가 쓰고 있어 충돌한다.

```ts
  /**
   * 강제 엔딩 2종 — `when` 이 **항상 거짓**이다.
   *
   * `resolveEnding` 은 열차 출발 경로에서만 쓰인다(`systems/tick.ts:124-128`).
   * 이 둘은 시스템이 `{ t: 'END', endingId }` 로 직접 발행하므로 조건식이 필요 없고,
   * 참이 될 수 있으면 오히려 열차 출발 시 오검출된다.
   */
  {
    id: 'E-15',
    priority: 4,
    title: '이걸 누가 먹어',
    line: '"이놈아, 내가 이런 걸 먹게 생겼냐?"',
    hint: '벤치 근처 바닥을 살펴보면 뭘 드셨는지 알 수 있다.',
    tone: 'fail',
    when: () => false,
  },
  {
    id: 'E-16',
    priority: 3,
    title: '딱!',
    line: '눈앞이 하얘졌다.',
    hint: '단소는 두 대까지다. 개찰구를 넘으면 멈추신다.',
    tone: 'fail',
    when: () => false,
  },
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

- [ ] **Step 6: 엔딩 개수를 세던 기존 유닛을 고친다**

`ENDINGS.length` 를 14 로 박아 둔 곳이 둘 있다. 16 으로 고친다.

- `tests/unit/ending6.test.ts:54`
- `tests/unit/ending14.test.ts` (같은 단언이 있으면)

Run: `npm test`
Expected: 전체 통과

- [ ] **Step 7: 커밋**

```bash
git add src/state/types.ts src/data/endings.ts tests/unit/gift.test.ts        tests/unit/ending6.test.ts tests/unit/ending14.test.ts
git commit -m "feat: 엔딩 2종 — 오답 증정(E-15) · 단소 피격(E-16)"
```

---

### Task 3: 매대 분기와 `GIFT_BOUGHT`

**Files:**
- Modify: `src/state/types.ts` (`FlagId` 유니온)
- Modify: `src/data/interactables.ts` (`INTERACTABLES` 배열 + `GIFT_STALL_ID`)
- Modify: `src/systems/interact.ts` (`giftBranches` 신규)
- Test: `tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 1의 `GIFT_ITEMS`
- Produces: `src/data/interactables.ts` 에서 `export const GIFT_STALL_ID = 'OBJ-19-GIFT'`. `src/systems/interact.ts` 에서 `export const giftBranches = (s: GameState): readonly Branch[]`. Task 4가 둘 다 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts` 에 더한다.

```ts
import { giftBranches } from '../../src/systems/interact'
import { GIFT_STALL_ID } from '../../src/data/interactables'

describe('편의점 매대', () => {
  it('5지 선택이고 순서가 GIFT_ITEMS 와 같다', () => {
    const b = giftBranches(start(1))
    expect(b.map((x) => x.key)).toEqual([1, 2, 3, 4, 5])
    expect(b.map((x) => x.label)).toEqual([
      '양갱', '바나나우유', '초콜릿', '탄산음료', '새우깡',
    ])
  })

  /** note 가 서로 다르면 그 자체가 정답 힌트가 된다 — 전부 비어 있어야 한다 */
  it('구매 전에는 전부 고를 수 있고 note 가 비어 있다', () => {
    const b = giftBranches(start(1))
    expect(b.every((x) => x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '')).toBe(true)
  })

  it('한 번 사면 전부 잠긴다', () => {
    const s = start(1)
    const bought = { ...s, flags: [...s.flags, 'GIFT_BOUGHT' as const] }
    const b = giftBranches(bought)
    expect(b.every((x) => !x.enabled)).toBe(true)
    expect(b.every((x) => x.note === '이미 골랐다')).toBe(true)
  })

  it('매대가 편의점 슬랩 위에 있다', () => {
    const it0 = INTERACTABLES.find((i) => i.id === GIFT_STALL_ID)
    expect(it0).toBeDefined()
    expect(it0?.kind).toBe('talk')
    // 슬랩(Z2-NE)은 y=25.4 에서 시작하고 파사드는 y=25.7 이다
    expect(it0!.y).toBeGreaterThan(25.4)
    expect(it0!.y).toBeLessThan(25.7)
  })
})
```

`INTERACTABLES` 임포트를 더한다.

```ts
import { GIFT_STALL_ID, INTERACTABLES } from '../../src/data/interactables'
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `giftBranches` is not exported

- [ ] **Step 3: `FlagId` 에 `GIFT_BOUGHT` 를 더한다**

`src/state/types.ts` 의 `FlagId` 유니온에 넣는다.

```ts
  | 'GIFT_BOUGHT'        // 편의점 선물 구매 — 1회 한정. 되돌리기 없음
```

- [ ] **Step 4: 매대를 배치한다**

`src/data/interactables.ts` 의 `OBJ-19-MASK` 항목 **바로 아래**에 더한다.

```ts
  {
    /**
     * 편의점 선물 매대 — 마스크와 같은 파사드 규칙(y 는 슬랩 25.4 와 유리벽 25.7 사이).
     * 마스크(x=24.0)에서 동쪽으로 2m 떨어뜨려 상호작용 반경(1.5m)이 겹치지 않게 한다.
     */
    id: GIFT_STALL_ID,
    kind: 'talk',
    x: 26.0, y: 25.55, z: FLOOR.B1,
    label: '편의점 매대',
    once: false,
  },
```

`GRANDPA_ID` 선언 근처에 더한다.

```ts
export const GIFT_STALL_ID = 'OBJ-19-GIFT'
```

- [ ] **Step 5: `giftBranches` 를 쓴다**

`src/systems/interact.ts` 의 `grandpaBranches` 아래에 더한다.

```ts
/**
 * 편의점 선물 5지 — **note 를 전부 비운다.**
 *
 * 다른 분기는 note 로 비용·이득을 알려주지만(`'+1.5s'`) 여기서는 그것이 곧
 * 정답 힌트가 된다. 값이 서로 다르면 "비싼 게 정답" 같은 추론이 생긴다.
 * 힌트는 바닥 양갱(`OBJ-19-HINT*`)이 진다.
 */
export const giftBranches = (s: GameState): readonly Branch[] => {
  const bought = s.flags.includes('GIFT_BOUGHT')
  return GIFT_ITEMS.map((id, i) => ({
    key: (i + 1) as Branch['key'],
    label: itemDef(id).name,
    enabled: !bought,
    note: bought ? '이미 골랐다' : '',
  }))
}
```

임포트에 `GIFT_ITEMS` 를 더한다.

```ts
import { GIFT_ITEMS, itemDef } from '../data/items'
```

`Branch` 타입의 `key` 를 넓힌다.

```ts
export type Branch = Readonly<{
  key: 1 | 2 | 3 | 4 | 5; label: string; enabled: boolean; note: string
}>
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/state/types.ts src/data/interactables.ts src/systems/interact.ts tests/unit/gift.test.ts
git commit -m "feat: 편의점 매대 5지 선택 분기 + GIFT_BOUGHT 1회 한정"
```

---

### Task 4: 대화창 라우팅과 구매 처리

**Files:**
- Modify: `src/systems/interact.ts` (`dialogPick`·`branchesFor` 신규 · 입력 범위)
- Modify: `src/ui/dialog.ts:133`
- Test: `tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 3의 `giftBranches`·`GIFT_STALL_ID`, Task 1의 `GIFT_ITEMS`
- Produces: `src/systems/interact.ts` 에서 `export const branchesFor = (s: GameState, dialogId: string): readonly Branch[]`. `ui/dialog.ts` 가 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts` 에 더한다.

```ts
import { branchesFor } from '../../src/systems/interact'
import { GRANDPA_ID } from '../../src/data/interactables'

describe('대화창 라우팅', () => {
  it('대화 상대에 따라 분기가 갈린다', () => {
    const s = start(1)
    expect(branchesFor(s, GIFT_STALL_ID).length).toBe(5)
    expect(branchesFor(s, GRANDPA_ID).length).toBe(3)
  })

  it('모르는 상대면 빈 배열 — 화면에 아무것도 안 뜬다', () => {
    expect(branchesFor(start(1), 'OBJ-NOPE')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `branchesFor` is not exported

- [ ] **Step 3: `branchesFor` 를 쓰고 구매를 처리한다**

`src/systems/interact.ts` 의 `giftBranches` 아래에 더한다.

```ts
/** 대화 상대 → 분기표. UI 와 시스템이 **같은 함수**를 읽는다 */
export const branchesFor = (s: GameState, dialogId: string): readonly Branch[] =>
  dialogId === GRANDPA_ID ? grandpaBranches(s)
    : dialogId === GIFT_STALL_ID ? giftBranches(s)
      : []

/** 선물 구매 — 1회 한정. 되돌리기가 없으므로 여기서 플래그를 못 박는다 */
const buyGift = (s: GameState, key: Branch['key']): Action[] => {
  const item = GIFT_ITEMS[key - 1]
  if (!item) return []
  return [
    { t: 'DIALOG', id: null },
    { t: 'PICKUP', item, slot: -1, dropId: null },
    { t: 'FLAG', id: 'GIFT_BOUGHT', on: true },
    { t: 'FX', kind: 'toast', text: `${itemDef(item).name}을(를) 샀다`, lifeMs: 1800, value: 0 },
  ]
}
```

`dialogPick` 를 대화 상대별로 가른다.

```ts
const dialogPick = (s: GameState, key: Branch['key']): Action[] => {
  const id = s.act.dialogId
  if (!id) return []
  const b = branchesFor(s, id).find((x) => x.key === key)
  if (!b) return []
  if (!b.enabled) return [{ t: 'ACT_DENY', text: b.note }]
  if (id === GIFT_STALL_ID) return buyGift(s, key)
  if (key === 1) return steal()
  const kind: InteractKind = key === 2 ? 'give' : 'story'
  return [
    { t: 'DIALOG', id: null },
    { t: 'ACT_BEGIN', id: GRANDPA_ID, kind, totalMs: durationOf(kind) },
  ]
}
```

`interact.ts:482` 의 입력 범위를 5까지 넓힌다.

```ts
    if (f.pressSlot >= 1 && f.pressSlot <= 5) {
      return [...out, ...dialogPick(s, f.pressSlot as Branch['key'])]
    }
```

- [ ] **Step 4: 대화창이 라우팅을 쓰게 한다**

`src/ui/dialog.ts:133` 을 바꾼다.

```ts
          dlgOps.innerHTML = branchesFor(s, s.act.dialogId!)
```

`src/ui/dialog.ts:15` 의 임포트를 바꾼다.

```ts
import { branchesFor } from '../systems/interact'
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

Run: `npm run typecheck`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/systems/interact.ts src/ui/dialog.ts tests/unit/gift.test.ts
git commit -m "feat: 대화창을 상대별로 라우팅 — 매대 구매 처리"
```

---

### Task 5: 증정 분기 — 정답과 오답

**Files:**
- Modify: `src/systems/interact.ts` (`grandpaBranches` key 2 · 증정 완료 처리)
- Test: `tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 1의 `GIFT_ITEMS`·`GIFT_CORRECT`, Task 2의 `'E-15'`
- Produces: 없음 (동작 변경)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts` 에 더한다.

완료 처리(`complete`)는 비공개 함수다. 액션 배열을 직접 볼 수 없으므로 기존 유닛과
같은 방식으로 **입력을 태워 상태를 검증한다**(`tests/unit/items.test.ts` 의 `grab` 참고).

```ts
import { INTERACT, SLOTS } from '../../src/data/tuning'
import { FLOOR } from '../../src/data/world'
import type { GameState, ItemId } from '../../src/state/types'
import { put, start, tap, wait, yawTo } from './_pilot'

/** 선물 하나를 들고 할아버지 앞 1.1m 에 선다 */
const withGift = (item: ItemId): GameState => {
  const inv: (ItemId | null)[] = Array.from({ length: SLOTS }, () => null)
  inv[0] = item
  const s = start(7, { phase: 'playing', inventory: inv })
  return put(s, 42, 14.9 - 1.1, FLOOR.B1)
}

/** 대화를 열고 [2] 선물을 드린다 → 완료까지 기다린다 */
const giveIt = (item: ItemId): GameState => {
  const s0 = withGift(item)
  const yaw = yawTo(s0, 42, 14.9)
  const opened = tap(s0, { pressInteract: true }, yaw)
  const picked = tap(opened, { pressSlot: 2 }, yaw)
  return wait(picked, INTERACT.buyMs + 200, yaw)
}

describe('선물 증정', () => {
  it('양갱이면 효자손을 얻고 게임이 계속된다', () => {
    const s = giveIt('I-12')
    expect(s.inventory).toContain('I-01')
    expect(s.phase).toBe('playing')
    expect(s.endingId).toBe(null)
    // 양심 +1 은 E-12 히든 엔딩 조건이다 — 개편에서 빠뜨리기 쉬운 자리
    expect(s.scores.conscience).toBeGreaterThan(0)
  })

  it('오답 4종은 전부 E-15 로 끝난다', () => {
    for (const id of ['I-15', 'I-16', 'I-17', 'I-18'] as const) {
      const s = giveIt(id)
      expect(s.phase).toBe('ended')
      expect(s.endingId).toBe('E-15')
      expect(s.inventory).not.toContain('I-01')
    }
  })

  it('선물이 없으면 증정 분기가 잠긴다', () => {
    const b = grandpaBranches(start(7)).find((x) => x.key === 2)!
    expect(b.enabled).toBe(false)
    expect(b.note).toBe('선물이 없다')
  })

  it('선물이 있으면 열린다', () => {
    const b = grandpaBranches(withGift('I-17')).find((x) => x.key === 2)!
    expect(b.enabled).toBe(true)
  })
})
```

경로는 `src/state/types.ts:284` 에서 확인했다 —
`scores: Readonly<{ conscience: number; style: number; knowledge: number }>`.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — 증정 분기가 아직 `hasItem(s, 'I-12')` 만 본다

- [ ] **Step 3: 증정 분기를 고친다**

`src/systems/interact.ts` 의 `grandpaBranches` key 2 항목을 바꾼다.

```ts
  {
    key: 2,
    label: '선물을 드린다',
    enabled: GIFT_ITEMS.some((i) => hasItem(s, i)),
    note: GIFT_ITEMS.some((i) => hasItem(s, i)) ? '+1.5s' : '선물이 없다',
  },
```

- [ ] **Step 4: 증정 완료를 정답/오답으로 가른다**

`src/systems/interact.ts:200-213` 의 `case 'give':` 블록을 **통째로** 아래로 바꾼다.

⚠ **기존 블록의 부수효과를 하나도 빠뜨리지 마라.** 원본은 `ITEM_SPEND` ·
`ITEM_USED` · `PICKUP I-01` · **`CONSCIENCE +1`** · `FLAG GRANDPA_HELPED` ·
`ACT_CONSUME` 여섯 개를 낸다. 특히 `CONSCIENCE +1` 은 E-12 히든 엔딩의 조건이고
(`endings.ts` E-12), 빠뜨려도 테스트가 안 잡히므로 **조용히 망가진다.**

```ts
    /**
     * [2] 선물 — **양갱만** 효자손으로 이어진다. 양심 +1.
     *
     * 구매가 1회 한정(`GIFT_BOUGHT`)이라 소지한 선물은 항상 최대 하나다.
     * 어느 것을 드릴지 다시 고를 필요가 없어 인벤토리의 첫 선물이 곧 답이다.
     */
    case 'give': {
      const held = GIFT_ITEMS.find((i) => slotOf(s, i) >= 0)
      if (held === undefined) return [{ t: 'ACT_DENY', text: '선물이 필요하다' }]
      const slot = slotOf(s, held)
      if (held !== GIFT_CORRECT) {
        return [
          { t: 'ITEM_SPEND', slot },
          { t: 'FX', kind: 'toast', text: '"이놈아, 내가 이런 걸 먹게 생겼냐?"', lifeMs: 2600, value: 0 },
          { t: 'END', endingId: 'E-15' },
        ]
      }
      return [
        { t: 'ITEM_SPEND', slot },
        { t: 'ITEM_USED', item: held },
        { t: 'PICKUP', item: 'I-01', slot: -1, dropId: null },
        { t: 'CONSCIENCE', delta: 1 },
        { t: 'FLAG', id: 'GRANDPA_HELPED', on: true },
        { t: 'ACT_CONSUME', id: GRANDPA_ID },
        { t: 'FX', kind: 'toast', text: '"고맙네, 젊은이."', lifeMs: 2200, value: 0 },
      ]
    }
```

임포트에 `GIFT_CORRECT` 를 더한다.

```ts
import { GIFT_CORRECT, GIFT_ITEMS, itemDef } from '../data/items'
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/systems/interact.ts tests/unit/gift.test.ts
git commit -m "feat: 선물 증정 — 양갱만 효자손, 오답은 E-15"
```

---

### Task 6: 추격 개편

**Files:**
- Modify: `src/data/tuning.ts:324-346` (`CHASE`)
- Modify: `src/systems/chase.ts:1-10, 116-143`
- Test: `tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 2의 `'E-16'`
- Produces: 없음 (동작 변경)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts` 에 더한다.

```ts
import { CHASE } from '../../src/data/tuning'
import { chaseSystem } from '../../src/systems/chase'

describe('추격 개편', () => {
  it('10초로 줄었고 회수 개념이 사라졌다', () => {
    expect(CHASE.durationMs).toBe(10_000)
    expect('seizeHits' in CHASE).toBe(false)
  })

  it('2대째에 E-16 으로 끝난다', () => {
    const s = start(1)
    const hit1 = {
      ...s, phase: 'playing' as const,
      chase: { ...s.chase, active: true, phase: 'chase' as const, hitCount: 1, remainingMs: 5000 },
    }
    const hit2 = { ...hit1, chase: { ...hit1.chase, hitCount: 2 } }
    expect(chaseSystem(hit1, { dtMs: 16 }).some((a) => a.t === 'END')).toBe(false)
    expect(chaseSystem(hit2, { dtMs: 16 })
      .some((a) => a.t === 'END' && a.endingId === 'E-16')).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `durationMs` 30000 ≠ 10000

- [ ] **Step 3: 튜닝을 고친다**

`src/data/tuning.ts` 의 `CHASE` 에서 바꾼다.

```ts
  /** 추격 지속. Z3 진입 시 즉시 해제되므로 개찰구가 명확한 안전지대가 된다 */
  durationMs: 10_000,
```

`seizeHits: 5` 와 `seizeMs: 2000` 두 항목을 주석과 함께 지운다.

- [ ] **Step 4: 추격 로직을 고친다**

`src/systems/chase.ts:116-125` 의 `seize` 페이즈 블록을 통째로 지운다.

`src/systems/chase.ts:143` 을 바꾼다.

```ts
  /**
   * 2대째 — 쓰러진다. **1대는 경고다**(감속 0.2 + "딱!").
   * `swingCooldownMs`(1.5s)가 연타 즉사를 막으므로 한 번 맞고도 도망칠 창이 있다.
   */
  if (c.hitCount >= 2) {
    return [
      { t: 'FX', kind: 'toast', text: '눈앞이 하얘졌다', lifeMs: 2000, value: 0 },
      { t: 'END', endingId: 'E-16' },
    ]
  }
```

`src/systems/chase.ts:140` 의 타임아웃 문구를 바꾼다.

```ts
      { t: 'FX', kind: 'toast', text: '"늙었더니 몸이 내맘 같지 않구먼"', lifeMs: 2600, value: 0 },
```

`src/systems/chase.ts:1-10` 의 머리 주석을 새 의도로 다시 쓴다.

```ts
/**
 * O-14 단소 추격 🎋 — GDD §4.1.
 *
 * 절도 루트는 **도박**이다. 10초를 버티면 효자손을 그대로 챙기고, 두 대 맞으면
 * 그 자리에서 런이 끝난다. 예전에는 5대 누적으로 효자손을 회수당하는 "산수로 손해"
 * 구조였는데, 즉사로 바꾸면서 성격이 달라졌다 — 시간 손해가 아니라 판돈이다.
 *
 * 도망은 성립한다: 스프린트 8.3 대 할아버지 5.0, 벤치(x=42)에서 개찰구(x=56)까지 14m,
 * 스태미너 100/초당 22 ≈ 4.5초면 37m 를 달린다.
 *
 * 톤 가드레일: 폭력이 아니라 슬랩스틱이다. 피 없음 · 데미지 수치 없음 · 3등신 SD ·
 * 타격음은 "딱!" 목탁 계열 · 대사는 훈계가 아니라 잔소리.
 */
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

Run: `npm test`
Expected: 전체 통과. `seize` 를 참조하던 기존 테스트가 있으면 여기서 드러난다 — 있으면 새 동작에 맞게 고친다

- [ ] **Step 6: 커밋**

```bash
git add src/data/tuning.ts src/systems/chase.ts tests/unit/gift.test.ts
git commit -m "feat: 추격 10초 · 2대째 즉사(E-16) — 회수 단계 제거"
```

---

### Task 7: 바닥 양갱 힌트

**Files:**
- Modify: `src/data/interactables.ts` (`InteractKind` · `INTERACTABLES` 3개)
- Modify: `src/systems/interact.ts:24, 30` (`CANCEL_ON_MOVE`·`durationOf`)
- Test: `tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `InteractKind` 값 `'inspect'`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/gift.test.ts` 에 더한다.

```ts
describe('바닥 양갱 힌트', () => {
  const hints = () => INTERACTABLES.filter((i) => i.kind === 'inspect')

  /** "포장이 여럿"이라는 문구가 화면과 맞아야 한다 — 하나면 우연으로 읽힌다 */
  it('벤치 근처에 3개가 있다', () => {
    expect(hints().length).toBe(3)
    for (const h of hints()) {
      expect(Math.hypot(h.x - 42, h.y - 14.9)).toBeLessThan(4)
    }
  })

  it('벤치 솔리드와 겹치지 않는다', () => {
    // ACT-02-BENCH = rect[40.8, 14.6, 43.2, 15.4]
    for (const h of hints()) {
      const inside = h.x >= 40.8 && h.x <= 43.2 && h.y >= 14.6 && h.y <= 15.4
      expect(inside).toBe(false)
    }
  })

  it('획득되지 않고 몇 번이고 볼 수 있다', () => {
    for (const h of hints()) {
      expect(h.gives).toBeUndefined()
      expect(h.once).toBe(false)
    }
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `inspect` 종류가 없어 0개

- [ ] **Step 3: `inspect` 종류를 더한다**

`src/data/interactables.ts` 의 `InteractKind` 유니온에 더한다.

```ts
  | 'inspect'   // 살펴본다 0.8s · 이동 가능 · 획득 없음
```

`src/systems/interact.ts:30` 의 `durationOf` 에 더한다.

```ts
    case 'inspect': return 800
```

`CANCEL_ON_MOVE` 에는 **넣지 않는다** — `pickup` 과 같은 취급이다(이동해도 안 끊긴다).

- [ ] **Step 4: 힌트 3개를 배치한다**

`src/data/interactables.ts` 의 할아버지 항목 아래에 더한다.

```ts
  /**
   * 바닥 양갱 3개 — **정답 힌트다.**
   *
   * 벤치(42, 14.9) 남쪽 통행 구역에 흩는다. 벤치 솔리드
   * `ACT-02-BENCH` = rect[40.8, 14.6, 43.2, 15.4] 밖이어야 하므로 y 를 14.6 아래로 둔다.
   * 서로 0.6m 이상 떨어뜨려 상호작용이 서로를 가리지 않게 한다.
   *
   * 하나가 아니라 셋인 이유는 문구가 "포장이 여럿"이기 때문이다 —
   * 하나만 두면 화면과 말이 어긋나고 우연으로 읽힌다.
   */
  {
    id: 'OBJ-19-HINT1', kind: 'inspect',
    x: 41.4, y: 13.9, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
  {
    id: 'OBJ-19-HINT2', kind: 'inspect',
    x: 42.6, y: 13.6, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
  {
    id: 'OBJ-19-HINT3', kind: 'inspect',
    x: 43.3, y: 14.2, z: FLOOR.B1, label: '빈 양갱 포장', once: false,
  },
```

- [ ] **Step 5: 문구를 붙인다**

`src/systems/interact.ts:155` 의 `complete` 안 `switch (kind)` 에, `case 'give':`
바로 앞에 더한다.

```ts
    /**
     * 바닥 양갱 — **읽기만 한다.** `gives` 가 없으므로 인벤토리에 아무것도 안 들어간다.
     * `ACT_CONSUME` 도 내지 않는다 — 몇 번이고 다시 볼 수 있어야 힌트 구실을 한다.
     */
    case 'inspect':
      return [{
        t: 'FX', kind: 'toast',
        text: '누군가가 먹고 바닥에 버려놨다. 포장이 여럿인 걸 보면 누군가의 최애 간식인 모양이다.',
        lifeMs: 4000, value: 0,
      }]
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

- [ ] **Step 7: 좌표를 씬에서 실측한다**

Run: `npm run dev`

브라우저에서 벤치로 가 세 개가 바닥 위에 있고 벤치·통행에 안 걸리는지 본다.
겹치면 좌표를 고치고 Step 6을 다시 돌린다.

- [ ] **Step 8: 커밋**

```bash
git add src/data/interactables.ts src/systems/interact.ts tests/unit/gift.test.ts
git commit -m "feat: 바닥 양갱 힌트 3개 — inspect 상호작용"
```

---

### Task 8: 전체 검증과 문서 갱신

**Files:**
- Modify: `docs/GDD-subway-rush.md:264`
- Modify: `docs/OBJECT-MANIFEST.md:166`

**Interfaces:**
- Consumes: Task 1~7 전부
- Produces: 없음

- [ ] **Step 1: 전체 게이트를 돌린다**

Run: `npm run verify`
Expected: typecheck 통과 · 전체 테스트 통과 · build 통과

⚠ **`verify` 는 E2E 를 안 돌린다** — `typecheck && test && build` 뿐이고
Playwright 는 `test:e2e` 로 따로 있다(`package.json:14,17`). 엔딩 개수처럼
화면에 드러나는 수치는 `tests/e2e/p2.spec.ts` 가 하드코딩하고 있어
vitest 만으로는 회귀가 안 잡힌다. 반드시 둘 다 돌린다.

Run: `npm run test:e2e`
Expected: 전체 통과

실패하면 고치고 다시 돌린다. 특히 `seize`·`I-12`·`Branch['key']` 를 참조하던
기존 테스트가 여기서 드러난다.

- [ ] **Step 2: 엔딩 개수를 적은 자리를 찾는다**

Run: `grep -rn "14종\|엔딩 14" docs/ game/src/`

나온 자리를 전부 16종으로 고친다.

- [ ] **Step 3: GDD 를 고친다**

`docs/GDD-subway-rush.md:264` 를 확정 동작으로 바꾼다.

```markdown
| I-12 | **할아버지 선물** (후보 5종 중 1) | 소모 | Z2 편의점 (1회 한정 구매) | 양갱만 정답 → 효자손. 오답 4종은 E-15 로 즉시 종료 |
```

- [ ] **Step 4: OBJECT-MANIFEST 를 고친다**

`docs/OBJECT-MANIFEST.md:166` 을 같은 내용으로 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add docs/
git commit -m "docs: 선물 퍼즐 확정 동작 반영 — 엔딩 16종"
```

- [ ] **Step 6: PR 을 연다**

```bash
git push -u origin feat/grandpa-gift-puzzle
```

PR 본문에 스펙 링크(`docs/superpowers/specs/2026-08-07-grandpa-gift-puzzle-design.md`)와
`npm run verify` 결과를 넣는다.

---

## 검증 요약

| 항목 | 확인 방법 |
|---|---|
| 아이템 5종 · 노드 이름 | `npm test -- items` |
| 엔딩 16종 · `when` 항상 거짓 | `npm test -- gift` |
| 매대 1회 한정 · note 누출 없음 | `npm test -- gift` |
| 오답 4종 → E-15 | `npm test -- gift` |
| 2대째 → E-16 · 10초 | `npm test -- gift` |
| 힌트 3개 · 획득 불가 · 벤치 비겹침 | `npm test -- gift` + 씬 실측 |
| 전체 | `npm run verify` |

---

### Task 9: ACT-12 편의점 점원

> **범위 변경.** 스펙 §8은 "점원 모델이 없다(`GDD:22`)"는 이유로 이 작업을 범위 밖에 뒀다.
> 그 근거가 낡았다 — 모델이 커밋 `7cfe88b` 로 들어왔다(클립 4종: `CL_Idle`·`CL_Walk`·
> `CL_Talk`·`CL_Sell`). 디렉터가 이번 범위에 포함하기로 결정했다.

**Files:**
- Modify: `game/tools/copy-assets.mjs` (`FILES` 배열)
- Modify: `game/src/render/actors.ts` (`YAW_FIX` · `loadActors` · 배치)
- Test: `game/tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 3의 `GIFT_STALL_ID`
- Produces: 없음 (렌더 전용)

- [ ] **Step 1: 에셋을 반입 목록에 넣는다**

`game/tools/copy-assets.mjs` 의 `FILES` 배열에 더한다.

```js
  ['assets/cl_character_rigged.glb', 'npc/cl_character_rigged.glb'],
```

Run: `npm run assets`
Expected: `9/9 복사 완료`, `game/public/models/npc/cl_character_rigged.glb` 생성

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`game/tests/unit/gift.test.ts` 에 더한다.

```ts
import { CLERK_POS } from '../../src/render/actors'

describe('ACT-12 편의점 점원', () => {
  /**
   * 점포는 통짜 솔리드다 — `OBJ-19-CVS` = rect[21.5, 25.7, 26.5, 30.0].
   * 점원은 그 **안쪽**에 서야 유리 너머로 보인다. 파사드(y=25.7) 바깥에 두면
   * 매대 앞 통로에 사람이 서 있는 그림이 된다.
   */
  it('점원이 점포 솔리드 안에 선다', () => {
    expect(CLERK_POS.x).toBeGreaterThan(21.5)
    expect(CLERK_POS.x).toBeLessThan(26.5)
    expect(CLERK_POS.y).toBeGreaterThan(25.7)
    expect(CLERK_POS.y).toBeLessThan(30.0)
  })

  /** 매대(x=26.0) 정면이어야 말을 거는 그림이 된다 — x 로 1.5m 안 */
  it('매대 정면에 선다', () => {
    expect(Math.abs(CLERK_POS.x - 26.0)).toBeLessThan(1.5)
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `CLERK_POS` is not exported

- [ ] **Step 4: 점원을 배치한다**

`game/src/render/actors.ts` 에서:

`YAW_FIX` 에 `cl: 0` 을 더한다. **0 이 맞는지는 Step 6 에서 눈으로 확인하고 고친다** —
리그마다 전방축이 다르다.

배치 상수를 더한다. 좌표 근거를 주석에 남긴다.

```ts
/**
 * ACT-12 편의점 점원 — 카운터 뒤 고정.
 *
 * `OBJ-19-CVS` = rect[21.5, 25.7, 26.5, 30.0] 는 **통짜 솔리드**다(P0에 입장이 없다).
 * 점원을 파사드(y=25.7) 바깥에 두면 매대 앞 통로에 사람이 서 있는 그림이 되므로
 * 안쪽 0.7m 에 둔다. x 는 매대(`OBJ-19-GIFT` x=26.0) 정면에 맞춘다.
 *
 * 고정 액터라 충돌을 올리지 않는다 — 플레이어는 어차피 점포 솔리드에 막힌다.
 */
export const CLERK_POS = { x: 25.8, y: 26.4, z: FLOOR.B1 } as const
```

`loadActors` 의 `Promise.all` 에 더한다.

```ts
    loadOr(`${dir}cl_character_rigged.glb`, 'CL', YAW_FIX.cl),
```

구조분해와 `root.add(...)` 에 `cl` 을 더하고, `CLERK_POS` 에 세운 뒤 `CL_Idle` 을 재생한다.
기존 정적 NPC(`gp`)가 자세를 잡는 방식을 그대로 따른다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

Run: `npm run typecheck`
Expected: 에러 없음

- [ ] **Step 6: 눈으로 확인한다**

Run: `npm run dev`

편의점 앞으로 가서 확인한다:
1. 점원이 유리 너머에 보이는가
2. **플레이어(매대 앞)를 보고 있는가** — 등을 보이면 `YAW_FIX.cl` 을 `Math.PI` 로 고친다
3. 바닥을 뚫거나 떠 있지 않은가
4. `CL_Idle` 이 도는가 (T 포즈로 굳어 있으면 클립 이름을 확인한다)

고칠 것이 있으면 고치고 Step 5 를 다시 돌린다.

- [ ] **Step 7: 커밋**

⚠ `npm run assets` 가 `game/public/` 을, 빌드가 `game/dist/` 를 바꾼다.
`git status` 를 보고 의도한 파일만 담는다.

```bash
git add game/tools/copy-assets.mjs game/src/render/actors.ts \
        game/public/models/npc/cl_character_rigged.glb game/tests/unit/gift.test.ts
git commit -m "feat: ACT-12 편의점 점원 배치 — 카운터 뒤 CL_Idle"
```

---

### Task 10: OBJ-03 붕어빵 노점 — 퍼즐 우회로 차단

> **스펙 정정.** 스펙 §8은 `OBJ-03` 을 "상호작용 없는 배경 소품으로 유지"라며 범위 밖에 뒀다.
> 문서(v0.3)는 그렇게 정해 뒀지만 **코드가 안 따라갔다** — `OBJ-03` 은 여전히
> `kind: 'buy'`, `gives: 'I-12'`, `cost: 500`, `once: false` 인 판매대다.
>
> `I-12` 를 양갱으로 재정의한 순간 이것이 두 가지를 망가뜨렸다.
> **첫째,** Z1 붕어빵 노점이 양갱을 판다. **둘째,** 플레이어가 Z1 에서 정답을
> 500원에 직접 사서 편의점 5지 퍼즐을 통째로 건너뛴다 — 이 기능의 존재 이유가 사라진다.
>
> `I-12` 의 의미를 바꾼 것이 원인이므로 범위 안이다.

**Files:**
- Modify: `game/src/data/interactables.ts` (`OBJ-03` 항목)
- Test: `game/tests/unit/gift.test.ts`

**Interfaces:**
- Consumes: Task 1의 `GIFT_ITEMS`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`game/tests/unit/gift.test.ts` 에 더한다.

```ts
describe('퍼즐 우회로 차단', () => {
  /**
   * 선물은 **편의점에서만** 얻는다. 다른 곳에서 선물 5종 중 하나라도 살 수 있으면
   * 5지 선택이 의미를 잃는다 — 정답만 골라 사면 그만이기 때문이다.
   */
  it('편의점 매대 말고는 선물을 주는 상호작용이 없다', () => {
    const givers = INTERACTABLES.filter(
      (i) => i.gives !== undefined && GIFT_ITEMS.includes(i.gives),
    )
    expect(givers.map((i) => i.id)).toEqual([])
  })
})
```

임포트에 `GIFT_ITEMS` 를 더한다.

```ts
import { GIFT_ITEMS } from '../../src/data/items'
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- gift`
Expected: FAIL — `['OBJ-03']` 이 나온다

- [ ] **Step 3: 노점의 상호작용을 걷어낸다**

`game/src/data/interactables.ts` 의 `OBJ-03` 항목을 **통째로 지운다.**

솔리드 `OBJ-03-CART`(`data/world.ts`)는 **그대로 둔다** — 배경 소품으로 남는 것이
문서 v0.3 의 결정이다(`docs/OBJECT-MANIFEST.md`). 지운 자리에 근거를 남긴다.

```ts
  // ───────────── Z1 (L0) ─────────────
  /**
   * 붕어빵 노점(`OBJ-03-CART`)은 **상호작용이 없다** — 배경 소품이다(v0.3).
   *
   * P1 에서는 여기서 `I-12`(붕어빵)를 500원에 팔았다. `I-12` 가 양갱이 되면서
   * 두 가지가 깨졌다: 붕어빵 노점이 양갱을 팔고, Z1 에서 정답을 직접 사면
   * 편의점 5지 선택이 통째로 무의미해진다. 판매대를 걷어내고 수레만 남긴다.
   */
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test -- gift`
Expected: PASS

Run: `npm test`
Expected: 전체 통과. `OBJ-03` 을 경유하던 경로 테스트가 있으면 여기서 드러난다

Run: `npm run typecheck`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add game/src/data/interactables.ts game/tests/unit/gift.test.ts
git commit -m "fix: 붕어빵 노점 판매 제거 — Z1 에서 정답을 직접 사던 우회로"
```
