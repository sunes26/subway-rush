"""패스 — 반대 방면 승강장의 행선 문안을 「신촌 방면」으로 고친다.

반대 방면(디렉터 지시)은 본편 승강장을 Blender 에서 통째로 복제해 `B_` 접두사를
붙여 만들었다. 형상은 그걸로 맞았지만 **문안까지 같이 복제됐다** — 신촌행 승강장의
매달림 역명판이 "← 합정 · 신도림 방면"이라고 말하고, LED 도 "신도림 방면"이라고 쓴다.
게임의 안내방송(`systems/train.ts` 반대편)과 개찰구 분기 사인(`hq_signs` z3fork-b)은
이미 「신촌 방면」이라고 말하므로, 세계가 같은 자리에서 서로 다른 말을 하고 있었다.

**화살표는 문안과 같이 뒤집어야 한다.** 합정·신도림은 동(+x), 신촌은 서(−x)다
(`build_station_signs.py` 의 인접역 규약). 화살표의 좌우는 보는 사람 기준이라 판의
면마다 뒤집히는데, 원본 문안이 이미 그 규칙대로 쓰여 있으니 **각 면의 부호만 뒤집으면**
된다 — `_-1` 면(관측자가 −y 를 봄, 왼쪽이 +x)에서 서쪽은 오른쪽이고, `_1` 면에서는 왼쪽.

`B_` 이름은 어떤 마감 패스도 다시 만들지 않는다(`hq_fixups.pids()` 는 `Z5_pids_txt_`
로 시작하는 것만 훑고, 매달림 역명판 빌더는 애초에 일회성이었다). 그래서 이 파스가
문안의 유일한 기록이다 — 멱등하게, 이름으로 찾아 body 만 덮어쓴다.

대상 (전부 FONT)
  · `B_Z5_hang_dir{0..3}_{±1}`      매달림 역명판 하단 방향줄  (8)
  · `B_Z5_pids_txt_{x}_{N,S}`       승강장 LED 전광판          (8)
  · `B_z4b_txtW`                    하강부 매달림 방향 사인    (1)
"""

from __future__ import annotations

import bpy

# 매달림 역명판 — 면 부호별 문안. 원본은 `_-1` 이 "← 합정 · 신도림 방면"(동쪽=왼쪽)이다.
HANG = {"-1": "신촌 방면 →", "1": "← 신촌 방면"}

# LED 전광판 — 원본은 `_N` 이 "◀ 신도림 방면"(동쪽=왼쪽)이다.
PIDS = {"N": "▶ 신촌 방면", "S": "◀ 신촌 방면"}

# 하강부 사인 — 화살표는 별도 메시(직진 ↑)이고 통행 방향이라 그대로 둔다.
DESCENT = {"B_z4b_txtW": "신촌 방면"}


def _body(obj: bpy.types.Object, text: str) -> bool:
    """B_ 오브젝트의 문안을 덮어쓴다. **커브 데이터를 먼저 끊는다.**

    복제가 링크 복제였다 — `B_Z5_hang_dir0_-1` 과 `Z5_hang_dir0_-1` 이 같은 TextCurve
    데이터블록을 가리킨다. 그대로 body 를 쓰면 본편 승강장 문안까지 「신촌 방면」이 된다
    (실제로 한 번 그렇게 나갔다). 반대로 `hq_fixups.pids()` 가 본편 LED 를 다시 쓸 때
    반대 방면까지 「신도림 방면」으로 되돌려 놓는 경로이기도 하다 — 양쪽 다 여기서 끊긴다.
    """
    if obj.type != "FONT":
        raise RuntimeError(f"{obj.name}: FONT 가 아니다 ({obj.type})")
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    if obj.data.body == text:
        return False
    obj.data.body = text
    return True


def build() -> None:
    n = 0
    for obj in bpy.data.objects:
        name = obj.name
        if not name.startswith("B_"):
            continue

        if name.startswith("B_Z5_hang_dir"):
            n += _body(obj, HANG[name.rsplit("_", 1)[1]])
        elif name.startswith("B_Z5_pids_txt_"):
            n += _body(obj, PIDS[name.rsplit("_", 1)[1]])
        elif name in DESCENT:
            n += _body(obj, DESCENT[name])

    print(f"[hq_opp_direction] 반대 방면 행선 문안 {n}개 → 신촌 방면")


build()
