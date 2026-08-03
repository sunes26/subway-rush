"""메시 편집 헬퍼 — 셸 재단·복제 오프셋·마감.

의상과 소품은 대부분 '이미 웨이트가 실린 본체를 부분 복제해 법선으로
부풀리는' 방식으로 만든다. 정점 그룹이 그대로 따라오므로 재바인딩이
필요 없다 — 이 프로젝트에서 가장 잘 깨지는 단계를 통째로 건너뛴다.
"""
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def bisect(bm, co, no, verts_filter=None):
    """평면으로 잘라 normal 반대쪽을 버린다.

    **순서 주의: 부풀린 '뒤에' 잘라야 한다.** 자른 뒤 법선으로 밀면
    밑단 정점마다 법선의 수직 성분이 달라 애써 평면으로 자른 단면이
    다시 울퉁불퉁해진다.
    """
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    if verts_filter is not None:
        vs = {v for v in bm.verts if verts_filter(v)}
        geom = list(vs) + [e for e in bm.edges if all(v in vs for v in e.verts)] \
            + [f for f in bm.faces if all(v in vs for v in f.verts)]
        if not geom:
            raise RuntimeError("bisect: empty geometry subset")
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no,
                           clear_inner=True, clear_outer=False)
    bm.verts.ensure_lookup_table()


def boundary_loops(bm):
    """열린 경계(면이 하나뿐인 에지)를 연결 성분별로 묶어 돌려준다."""
    adj = {}
    for e in bm.edges:
        if len(e.link_faces) == 1:
            a, b = e.verts
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
    seen, out = set(), []
    for k in adj:
        if k in seen:
            continue
        stack, comp = [k], set()
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            seen.add(n)
            stack.extend(adj[n] - comp)
        out.append(comp)
    return out


def dup_offset(bm, pred, dist):
    """면을 골라 복제하고 법선 방향으로 밀어 융기를 만든다.

    강체 블록을 얹는 것보다 이쪽이 낫다 — 블롭 어깨처럼 곡률이 급한 곳에
    상자를 얹으면 전부 '걸쳐 놓은 막대'로 보인다. 다만 **면 선택을 좁게**
    잡아야 한다. `normal.z > 0.42` 로는 옆구리·목까지 딸려 온다(0.62 로 해결).
    """
    src = [f for f in bm.faces if pred(f)]
    if len(src) < 4:
        raise RuntimeError("dup_offset: too few faces (%d)" % len(src))
    geom = list(src)
    seen = set()
    for f in src:
        for e in f.edges:
            if e.index not in seen:
                seen.add(e.index)
                geom.append(e)
    seen_v = set()
    for f in src:
        for v in f.verts:
            if v.index not in seen_v:
                seen_v.add(v.index)
                geom.append(v)
    res = bmesh.ops.duplicate(bm, geom=geom)     # geom 은 중복이 없어야 한다
    new_faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
    new_verts = {g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)}
    for v in new_verts:
        v.co += v.normal * dist
    return new_faces


def open_edge_count(mesh_data):
    bm = bmesh.new()
    bm.from_mesh(mesh_data)
    n = len([e for e in bm.edges if len(e.link_faces) != 2])
    bm.free()
    return n


def close_holes(bm, where=""):
    """열린 경계를 막아 닫힌 솔리드로 만든다.

    잘라 만든 소품은 열린 경계가 남기 쉽다. ACT-06 넥필로우(에지 20개)와
    ACT-08 모자 챙(면 6 / 에지 16)이 그래서 '잘린 파이프'·'머리를 감는
    고리'로 보였다. **눈으로는 폭 문제로 오진하기 쉬우니 세어서 잡는다.**

    원통을 반으로 자를 거면 `end_fill_type='TRIFAN'` 으로 만들어라 —
    NGON 뚜껑은 정점 하나만 지워져도 면 전체가 사라진다.
    """
    bnd = [e for e in bm.edges if len(e.link_faces) == 1]
    if bnd:
        bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    bnd = [e for e in bm.edges if len(e.link_faces) == 1]
    if bnd:
        bmesh.ops.contextual_create(bm, geom=bnd)
    left = [e for e in bm.edges if len(e.link_faces) != 2]
    if left:
        raise RuntimeError("%s still an open shell: %d boundary edges"
                           % (where or "mesh", len(left)))


def push_out_of_body(bm, body_obj, clear=0.004):
    """셸 정점이 본체 안으로 들어간 곳을 전부 바깥으로 밀어낸다.

    어깨를 평면으로 누르거나 가로로 넓히는 편집은 국소적으로 셸을 본체
    안쪽으로 끌어당긴다. 그러면 어깨 위에 맨살이 삼각형으로 뚫고 나온다.
    **어느 편집이 원인인지 쫓는 것보다 '셸은 항상 본체 바깥' 을 마지막에
    강제하는 편이 확실하다.**
    """
    tris = []
    for p in body_obj.data.polygons:
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    bvh = BVHTree.FromPolygons(
        [tuple(body_obj.matrix_world @ v.co) for v in body_obj.data.vertices],
        tris, all_triangles=True)
    pushed, worst = 0, 0.0
    for v in bm.verts:
        loc, nrm, _idx, _d = bvh.find_nearest(v.co)
        if loc is None:
            continue
        signed = (v.co - loc).dot(nrm)
        if signed < clear:
            worst = max(worst, clear - signed)
            v.co = loc + nrm * clear
            pushed += 1
    bm.normal_update()
    if pushed > len(bm.verts) * 0.5:
        raise RuntimeError("push_out_of_body touched %d/%d verts — shell inside out?"
                           % (pushed, len(bm.verts)))
    return pushed, worst


def box(name, cen, dim, mat, bevel=0.0022, keep_origin=True):
    """상자 하나. **원점을 상자 중심에 남긴다.**

    `transform_apply(location=True)` 를 부르면 원점이 월드 (0,0,0) 으로 가고,
    그 뒤 회전을 적용하면 파츠가 월드 원점을 축으로 돌아 날아간다.
    소품 조립은 반드시 로컬 원점에서 하고 마지막에 통째로 옮긴다.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=cen)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.scale = dim
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=not keep_origin, rotation=True, scale=True)
    if max(abs(a - b) for a, b in zip(o.dimensions, dim)) > 1e-5:
        raise RuntimeError("%s dimensions off: %s (primitive_cube_add(size=1.0) 는 "
                           "1.0 을 채우므로 반값이 아니라 전체 치수를 넣어야 한다)"
                           % (name, [round(v, 4) for v in o.dimensions]))
    if bevel > 0.0:
        bv = o.modifiers.new("Round", 'BEVEL')
        bv.width = bevel
        bv.segments = 2
        bv.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=bv.name)
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o
