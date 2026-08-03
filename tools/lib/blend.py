"""Blender 기본 헬퍼. 세 벌에 똑같이 복제돼 있던 것들.

여기 있는 함수는 전부 **못 찾으면 즉시 예외를 던진다.** None 으로 진행하면
이름을 바꿨을 때 조용히 빈 결과가 나온다 — 이 프로젝트에서 실제로 겪었다.
"""
import bpy


def need_obj(name):
    o = bpy.data.objects.get(name)
    if o is None:
        raise RuntimeError("Required object not found: %s (have %s)"
                           % (name, sorted(x.name for x in bpy.data.objects)))
    return o


def need_action(name):
    a = bpy.data.actions.get(name)
    if a is None:
        raise RuntimeError("Required action not found: %s (have %s)"
                           % (name, sorted(x.name for x in bpy.data.actions)))
    return a


def need_mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        raise RuntimeError("Required material not found: %s (have %s)"
                           % (name, sorted(x.name for x in bpy.data.materials)))
    return m


def set_active(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def principled(mat):
    if not mat.node_tree:
        raise RuntimeError("material %s has no node tree" % mat.name)
    n = next((x for x in mat.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
    if n is None:
        raise RuntimeError("material %s has no Principled BSDF" % mat.name)
    return n


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def new_mat(name, hexcol, rough, emit=0.0, metallic=0.0):
    """새 머티리얼. 같은 이름이 이미 있으면 실패한다 — 조용히 덮어쓰지 않는다.

    emit > 0 은 프리뷰 렌더 전용이다. glTF 는 이 발광을 싣지 않으므로
    엔진에서 이미시브를 따로 지정해야 한다 (ZP_ScreenGlow · SS_Arc).
    """
    if name in bpy.data.materials:
        raise RuntimeError("material already exists: %s" % name)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = hex_lin(hexcol) + (1.0,)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emit > 0.0:
        b.inputs["Emission Color"].default_value = hex_lin(hexcol) + (1.0,)
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = hex_lin(hexcol) + (1.0,)
    return m


def action_fcurves(a):
    """Blender 5.x 는 Action.fcurves 가 없다(슬롯 액션).

    4.2 기준 코드를 그대로 옮겨 오면 AttributeError 가 난다.
    """
    fcs = getattr(a, "fcurves", None)
    if fcs is not None:
        return list(fcs)
    res = []
    for layer in a.layers:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                res.extend(cb.fcurves)
    return res


def require_fps(fps=30):
    sc = bpy.context.scene
    if sc.render.fps != fps:
        raise RuntimeError("scene fps is %d, expected %d" % (sc.render.fps, fps))
    return sc
