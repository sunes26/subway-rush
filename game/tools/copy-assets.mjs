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
