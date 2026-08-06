/**
 * 에셋 반입 — `npm run assets`.
 *
 * P0에서는 손으로 복사했고, "왜 캐릭터가 안 나오지"의 원인이 **두 번** 이것이었다.
 * 스크립트로 못 박는다. 원본은 리포 루트 `assets/`, 배포 경로는 `game/public/models/`.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dst = resolve(import.meta.dirname, '../public/models')

const FILES = [
  ['assets/mc_character_rigged.glb', 'mc_character_rigged.glb'],
  ['assets/gp_character_rigged.glb', 'npc/gp_character_rigged.glb'],
  ['assets/cp_character_rigged.glb', 'npc/cp_character_rigged.glb'],
  /**
   * P2 방해요소 액터 4종. **리그는 진작 만들어져 있었는데 반입이 안 돼 있었다** —
   * 판정만 돌고 몸이 없어서 "도 아십니까 아주머니가 구현 안 된 것 같다"는 지적이 나왔다.
   * 목적별 클립까지 다 있다: AJ_Spot/Approach/Talk · ZP_Walk/Bump · SS_Walk/Chase.
   */
  ['assets/aj_character_rigged.glb', 'npc/aj_character_rigged.glb'],
  ['assets/ajp_character_rigged.glb', 'npc/ajp_character_rigged.glb'],
  ['assets/zp_character_rigged.glb', 'npc/zp_character_rigged.glb'],
  ['assets/ss_character_rigged.glb', 'npc/ss_character_rigged.glb'],
  ['assets/items.glb', 'items.glb'],
]

let n = 0
for (const [from, to] of FILES) {
  const src = resolve(root, from)
  if (!existsSync(src)) { console.error(`[assets] 원본 없음: ${from}`); continue }
  const out = resolve(dst, to)
  mkdirSync(dirname(out), { recursive: true })
  copyFileSync(src, out)
  console.log(`[assets] ${basename(from)} → models/${to}`)
  n++
}
console.log(`[assets] ${n}/${FILES.length} 복사 완료`)
