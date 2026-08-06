/**
 * 장식 프롭 — **주울 수 없는** 소품.
 *
 * 습득물(`interactables.ts`)과 굳이 나눈 이유: 판정에 안 들어간다. 조준 대상도,
 * 아웃라인 대상도, `act.consumed` 대상도 아니다. 같은 표에 섞으면 "왜 이 우산은
 * 안 주워지지"가 생기고, 그걸 막으려고 습득 로직에 예외를 다는 순간 표가 거짓말을 한다.
 *
 * ★ 좌표는 **역 GLB 에서 읽어온 값**이다. 눈으로 맞추지 않았다 —
 *   `Z2_CONCOURSE.glb` 의 `Z2_OBJ16_umb0..5` 노드 위치가 곧 꽂이의 슬롯이다.
 *   그 노드들은 발광 재질(SH_GREEN)로 만들어져 형광 막대로 보였고, `render/station.ts`
 *   가 그 여섯을 빼 버린다. 여기 있는 것들이 **그 자리를 대신 채운다.**
 */

import { FLOOR } from './world'
import type { ItemId } from '../state/types'

export type Decor = Readonly<{
  id: string
  /** 어떤 아이템 메시를 빌려 쓰는가 (`data/items.ts` 의 `node`) */
  item: ItemId
  x: number
  y: number
  /** 밑면이 놓이는 높이 */
  z: number
  /** 세우는 방향(rad). 같은 각으로 여럿 두면 복제한 티가 난다 */
  yaw: number
}>

/**
 * 우산꽂이 `OBJ-16-UMBRELLA` (38, 5) 의 네 귀퉁이 슬롯.
 *
 * 가운데 두 슬롯(38, 4.92 · 38, 5.08)은 **비워 둔다** — 습득 가능한 우산 `OBJ-16` 이
 * (38, 5.0) 에 서 있다. 채우면 주울 수 있는 것과 없는 것이 겹쳐 보인다.
 *
 * 좌표는 GLB 슬롯에서 **안쪽으로 12cm** 당겼다(37.70→37.82). 원래 값은 통 모서리
 * (반폭 0.4 → 37.60~38.40)에 붙어 있어 우산이 통에 **기대 선** 것처럼 보였다.
 *
 * 높이 0.40 m: 꽂이 통은 바닥(−6.00)에서 rim −5.44 까지 0.56 m 다. 밑면을 0.40 에 두면
 * 접이우산(0.29 m × 1.6 = 0.46 m)의 윗동 0.3 m 가 rim 위로 나온다 — 꽂혀 있는 것으로 읽힌다.
 */
export const DECOR: readonly Decor[] = [
  { id: 'DEC-UMB-0', item: 'I-09', x: 37.82, y: 4.93, z: FLOOR.B1 + 0.40, yaw: -0.62 },
  { id: 'DEC-UMB-1', item: 'I-09', x: 38.18, y: 4.93, z: FLOOR.B1 + 0.40, yaw: 0.41 },
  { id: 'DEC-UMB-2', item: 'I-09', x: 37.82, y: 5.07, z: FLOOR.B1 + 0.40, yaw: 2.10 },
  { id: 'DEC-UMB-3', item: 'I-09', x: 38.18, y: 5.07, z: FLOOR.B1 + 0.40, yaw: -2.44 },
]
