"""패스 — **버스 북측에 문 개구부를 뚫는다.**

■ 왜 필요한가

`Z1_OBJ01_bus.001` 은 길가에 세워 둔 배경 소품으로 만들어져 **문 구멍이 없다.**
그래서 인트로의 하차 연출이 편법을 써 왔다 — 실내가 만든 문짝을 차체 **바깥면에**
0.02m 띄워 붙여 "문처럼" 보이게 한 것이다. 정면에서 보면 차체에 판을 덧댄 것으로
읽히고, 그 앞을 지나는 주인공은 차체 옆면에 붙어 보인다.

여기서 외피에 실제 구멍을 뚫어, 문짝을 그 안에 넣을 수 있게 한다.

■ 기존 `hq_punch_openings.py` 를 그대로 못 쓴다

저쪽은 **면 중심이 상자 안이면 삭제**한다. 천장은 1.2m 격자라 그 방식으로 충분했다.
버스는 다르다 — 문 베이 구간(x −59.6~−58.2 · z 0.35~2.43)의 북쪽 면이 **18개뿐**이고
(BUS_BODY 11 · BUS_GLASS 4 · BUS_TRIM 3) 하나하나가 베이 밖까지 걸쳐 있다.
중심 판정으로 지우면 구멍이 베이보다 훨씬 크게 난다.

그래서 **먼저 자른다.** 베이의 네 경계면으로 `bisect_plane` 을 걸어 그 자리에
엣지를 만들고, 그 다음에 안쪽 면만 지운다. 그러면 구멍이 정확히 베이 크기다.

■ 뚫으면 관통한다 — 안쪽 벽을 같이 세운다

이 메시는 **정점 공유가 없는 삼각형 수프**이고 두께가 없는 단일 셸이다. 구멍만
뚫으면 반대쪽 면의 뒷면이 컬링돼 **버스를 통과해 배경이 보인다.** 인트로 중에는
실내가 그 자리를 채우지만, 플레이 중에는 실내가 꺼져 있어 그대로 드러난다.

그래서 개구부 안쪽에 **얕은 함몰(door pocket)** 을 세운다 — 어두운 판 셋(안쪽 벽 ·
위 · 아래)이면 밖에서 "문이 열린 안쪽"으로 읽히고 관통이 사라진다.
"""

from __future__ import annotations

import bmesh
import bpy
from mathutils import Vector

BUS = "Z1_OBJ01_bus.001"

# 문 베이 — `game/src/render/bus-interior.ts` 의 `DOOR` 와 **같은 값**이어야 한다.
# 실측 멀리언 −59.6 · −58.2 사이 한 칸이다(새 구멍을 뚫는 게 아니라 있는 칸을 쓴다).
X0, X1 = -59.60, -58.20
# 아래는 발판 높이, 위는 측면 유리 상단(`BUS.winTop`).
Z0, Z1 = 0.35, 2.43
# 북쪽 절반만 — 남측 옆판은 안 건드린다
Y_MIN = 21.00
# 함몰 깊이 — 이만큼 안쪽에 어두운 벽을 세운다
POCKET = 0.28


def _bisect(bm: bmesh.types.BMesh, mw, co, no) -> None:
    """월드 좌표 평면으로 자른다 — 오브젝트가 2.1457 배 스케일이라 로컬로 옮겨야 한다"""
    mwi = mw.inverted()
    lco = mwi @ Vector(co)
    lno = (mwi.to_3x3() @ Vector(no)).normalized()
    bmesh.ops.bisect_plane(
        bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=lco, plane_no=lno, clear_inner=False, clear_outer=False,
    )


def punch() -> tuple[int, int]:
    o = bpy.data.objects[BUS]
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)

    # ① 베이 경계 네 면으로 자른다 (x 둘 · z 둘)
    for x in (X0, X1):
        _bisect(bm, mw, (x, 20.4, 1.4), (1, 0, 0))
    for z in (Z0, Z1):
        _bisect(bm, mw, (-59.0, 20.4, z), (0, 0, 1))

    # ② 베이 안쪽 · 북쪽 면만 지운다
    bm.faces.ensure_lookup_table()
    doomed = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if X0 - 1e-4 <= c.x <= X1 + 1e-4 and Z0 - 1e-4 <= c.z <= Z1 + 1e-4 and c.y > Y_MIN:
            doomed.append(f)
    n_del = len(doomed)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")

    # ③ 함몰(door pocket) — 뒷벽 · 위 · 아래 · 좌 · 우 다섯 면
    #
    #    ⚠ **새 재질을 만들지 않는다.** 재질이 하나 늘면 `station.ts` 의 병합 버킷이
    #      하나 늘어 존 드로우콜이 +1 이 된다(`perf.spec` 이 230 을 잠가 뒀다).
    #      `BUS_TRIM`(스커트·바퀴, 어두운 색)을 그대로 쓴다 — 문 안쪽 그늘로 읽힌다.
    trim = next((i for i, m in enumerate(o.data.materials) if m and m.name == "BUS_TRIM"), 0)
    mwi = mw.inverted()
    yo, yi = 21.58, 21.58 - POCKET          # 옆판 · 함몰 뒷벽

    made: list[tuple[bmesh.types.BMFace, Vector]] = []

    def quad(pts: list[tuple[float, float, float]], want: tuple[float, float, float]) -> None:
        """
        ★ 법선 방향을 **감기 순서에 맡기지 않고 확인해서 맞춘다.**

        처음엔 `recalc_face_normals` 로 정리했다. 그런데 이 다섯 면은 닫힌 부피가
        아니라 **열린 함몰**이라 "바깥"이 정의되지 않는다 — 전부 안쪽을 향했고,
        단면 재질이라 밖에서 컬링돼 **안 보였다.** 레이캐스트로 확인했더니 문 베이가
        그대로 관통해 12m 뒤 건물을 맞혔다.

        그래서 원하는 방향을 인자로 받아 어긋나면 뒤집는다. 애매함이 남지 않는다.
        """
        vs = [bm.verts.new(mwi @ Vector(p)) for p in pts]
        f = bm.faces.new(vs)
        f.material_index = trim
        made.append((f, Vector(want)))

    # 뒷벽 — 밖(북)에서 정면으로 보인다
    quad([(X0, yi, Z0), (X1, yi, Z0), (X1, yi, Z1), (X0, yi, Z1)], (0, 1, 0))
    # 아래(위를 향한다) · 위(아래를 향한다)
    quad([(X0, yi, Z0), (X0, yo, Z0), (X1, yo, Z0), (X1, yi, Z0)], (0, 0, 1))
    quad([(X0, yi, Z1), (X1, yi, Z1), (X1, yo, Z1), (X0, yo, Z1)], (0, 0, -1))
    # 좌 · 우 문틀 — 서로 마주 본다
    quad([(X0, yi, Z0), (X0, yi, Z1), (X0, yo, Z1), (X0, yo, Z0)], (1, 0, 0))
    quad([(X1, yi, Z0), (X1, yo, Z0), (X1, yo, Z1), (X1, yi, Z1)], (-1, 0, 0))

    # ★ **법선은 여기서 확인한다 — 면을 만든 직후가 아니다.**
    #
    # 처음엔 `bm.faces.new(...)` 바로 뒤에서 `f.normal` 을 읽어 방향을 비교했다.
    # 그 시점 법선은 **아직 계산되지 않아 0 벡터**라 `dot(want) < 0` 이 늘 거짓이었고,
    # 뒤집기가 **한 번도 실행되지 않았다.** 다섯 면이 전부 안쪽을 향한 채 나갔고,
    # 단면 재질이라 밖에서 컬링돼 문 베이가 그대로 관통했다(레이가 12m 뒤 건물을 맞혔다).
    #
    # 계산을 한 번 돌린 **뒤에** 비교한다. `f.normal` 을 언제 읽는지가 곧 값이다.
    bm.normal_update()
    flipped = 0
    for f, want in made:
        if (mw.to_3x3() @ f.normal).normalized().dot(want) < 0:
            f.normal_flip()
            flipped += 1
    print(f"  함몰 {len(made)}면 중 {flipped}면 뒤집음")

    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return n_del, len(o.data.polygons)


if __name__ in ("__hq__", "__main__"):
    n_del, n_poly = punch()
    print(f"버스 문 개구부: {n_del}면 삭제 · 함몰 5면 추가 · polys {n_poly}")
