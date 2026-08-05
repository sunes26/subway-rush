/**
 * 밸런스 스윕 리포트 생성 — `npm run sweep`.
 *
 * 시드 200개 × 루트 3종을 헤드리스로 완주시켜 `docs/P1-BALANCE.md` 를 만든다.
 * 유닛 스위트(`sweep.test.ts`)는 시드 24개만 본다 — 스위트가 분 단위로 늘어나면
 * 아무도 안 돌리고, 안 돌리는 테스트는 없는 테스트다. 전량은 이 스크립트의 몫이다.
 *
 * GDD §8.1의 지시("승률이 너무 높으면 제한시간 180 → 170을 먼저 조정")를
 * **이 리포트를 보고** 판단한다.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FARE, TOTAL_TIME_MS } from '../src/data/tuning'
import { start } from '../tests/unit/_pilot'
import { asMarkdown, summarize, sweep, type SweepRow } from '../tests/unit/_sweep'

const N = Number(process.argv[2] ?? 200)
const SEEDS = Array.from({ length: N }, (_, i) => i * 3 + 1)

const started = process.hrtime.bigint()
const rows: SweepRow[] = sweep(SEEDS)
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

/** 시작 잔액 분포 — GDD §8.3 의 60% 미달 의도가 실제로 성립하는지 */
const balanceTable = (): string => {
  const bins = new Map<number, number>()
  for (const seed of SEEDS) {
    const b = start(seed).cardBalance
    bins.set(b, (bins.get(b) ?? 0) + 1)
  }
  const keys = [...bins.keys()].sort((a, b) => a - b)
  const head = '| 시작 잔액 | 시드 수 | 비율 | 요금 대비 |\n|---:|---:|---:|---|'
  const body = keys.map((k) => {
    const n = bins.get(k) ?? 0
    return `| ${k.toLocaleString('ko-KR')}원 | ${n} | ${((n / SEEDS.length) * 100).toFixed(1)}% | ` +
      `${k < FARE ? '**미달 — 체인 강제**' : '통과 가능'} |`
  }).join('\n')
  const short = SEEDS.filter((s) => start(s).cardBalance < FARE).length
  return `${head}\n${body}\n\n요금 미달 시드 **${((short / SEEDS.length) * 100).toFixed(1)}%** ` +
    `(GDD §8.3 목표 60%)\n`
}

/** 루트별 소요 분포 — 평균만 보면 꼬리를 놓친다 */
const percentiles = (route: Parameters<typeof summarize>[1]): string => {
  const secs = rows.filter((r) => r.route === route && r.reached).map((r) => r.sec).sort((a, b) => a - b)
  if (secs.length === 0) return `| ${route} | — | — | — | — |`
  const at = (p: number): number => secs[Math.min(secs.length - 1, Math.floor(secs.length * p))] ?? 0
  const over = secs.filter((v) => v > TOTAL_TIME_MS / 1000).length
  return `| ${route} | ${at(0.1).toFixed(1)}s | ${at(0.5).toFixed(1)}s | ${at(0.9).toFixed(1)}s | ` +
    `${over} / ${secs.length} |`
}

const endingTable = (): string => {
  const bins = new Map<string, number>()
  for (const r of rows) bins.set(r.ending, (bins.get(r.ending) ?? 0) + 1)
  return [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `| ${id} | ${n} | ${((n / rows.length) * 100).toFixed(1)}% |`)
    .join('\n')
}

const md = `# 지하철 러쉬 — P1 밸런스 스윕 리포트

> **자동 생성 문서.** \`npm run sweep\` 이 덮어쓴다. 손으로 고치지 말 것.
> 시드 ${N}개 × 루트 3종 = ${rows.length}회 완주 시뮬 · 소요 ${(elapsedMs / 1000).toFixed(1)}s

## 1. 루트 요약

${asMarkdown(rows)}

## 2. 소요 시간 분포 (승강장 도달까지)

| 루트 | p10 | 중앙값 | p90 | 180s 초과 |
|---|---:|---:|---:|---:|
${(['A-steal', 'C-talk', 'N-skip'] as const).map(percentiles).join('\n')}

> 여기서 재는 것은 **승강장 도달**까지다. 탑승 판정은 열차 스케줄(168~181s)에 묶여 있어
> 도달이 빠를수록 문 앞에서 기다리는 시간이 길어진다 — 그게 E-02/E-03의 조건이다.

## 3. 시작 잔액 분포

${balanceTable()}

## 4. 도달 시점 엔딩 분포

| 엔딩 | 건수 | 비율 |
|---|---:|---:|
${endingTable()}

> 탑승 **전** 시점의 판정이므로 성공 계열은 나오지 않는다. 절도 루트가 전부 E-10에
> 걸리는 것이 정상이다 — 양심 −3 하나로 도달하고, 그게 GDD §6.2 의 의도다.

## 5. 판정

- 소프트락: ${rows.filter((r) => !r.passed).length}건
- [A] 훔치기 평균 ${summarize(rows, 'A-steal').avgSec.toFixed(1)}s · 양심 ${summarize(rows, 'A-steal').avgConscience.toFixed(2)}
- [C] 말 걸기 평균 ${summarize(rows, 'C-talk').avgSec.toFixed(1)}s · 양심 ${summarize(rows, 'C-talk').avgConscience.toFixed(2)}
- [N] 무자원 평균 ${summarize(rows, 'N-skip').avgSec.toFixed(1)}s

자동조종은 단소를 **피하지 않는다**(맞으면서 걷는다). 사람이 스프린트로 회피하면 [A]는
더 빨라지고, 대신 스태미너를 잃는다. 이 표는 그래서 **하한선**이다 — GDD §8.1.1의
"실질 총비용 47~65s(회피 실력 의존)" 중 실력이 0인 쪽에 가깝다.
`

const out = resolve(import.meta.dirname, '../../docs/P1-BALANCE.md')
writeFileSync(out, md, 'utf8')
console.log(`[sweep] ${rows.length} runs · ${(elapsedMs / 1000).toFixed(1)}s → ${out}`)
console.log(asMarkdown(rows))
