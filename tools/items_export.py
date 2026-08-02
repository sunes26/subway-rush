"""items.blend → assets/items.glb.

실행:  blender -b assets/items.blend --python tools/items_export.py -- <out.glb>

캐릭터용 lib/exporting.py 를 쓰지 않는 이유
  그쪽은 리그 하나 · NLA 트랙 · 클립 집합 대조를 전제로 한다. ITM 소품은
  뼈도 클립도 없는 정적 메시라 그 검사가 전부 헛돈다. 대신 여기서 볼 것은
  '메시 개수 · 머티리얼이 살아남았는가' 둘뿐이라 짧게 끝난다.

익스포트 뒤 반드시 재임포트로 확인한다 — 익스포트 성공 메시지는 검증이 아니다.
"""
import bpy
import json
import os
import sys

GLB = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
if not GLB:
    raise RuntimeError("output .glb path required after --")
REPORT = os.environ.get("ITEMS_REPORT", "/tmp/items_export_report.json")

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError("no mesh objects in %s" % bpy.data.filepath)
want = sorted(o.name for o in meshes)
mats = sorted({m.name for o in meshes for m in o.data.materials if m})

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True,
                          export_apply=False, export_animations=False,
                          export_yup=True, export_image_format='NONE')

# ---- 재임포트 검증 -----------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
# glTF 임포터는 파일에 없는 'Icosphere'·'Cube' 플레이스홀더를 만든다.
got = [o for o in bpy.data.objects
       if o.type == 'MESH' and o.name not in {"Icosphere", "Cube"}]
got_names = sorted(o.name for o in got)
got_mats = sorted({m.name for o in got for m in o.data.materials if m})

fails = []
if got_names != want:
    fails.append("mesh set mismatch: %s != %s" % (got_names, want))
if not set(mats).issubset(set(got_mats)):
    fails.append("materials lost: %s" % sorted(set(mats) - set(got_mats)))
for o in got:
    if not o.data.polygons:
        fails.append("%s has no faces" % o.name)

R = {"glb": os.path.abspath(GLB), "bytes": os.path.getsize(GLB),
     "meshes": {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in got},
     "materials": got_mats, "fail": fails, "ok": not fails}
with open(REPORT, "w") as fh:
    json.dump(R, fh, indent=1, ensure_ascii=False)
print("ITEMS_EXPORT", "OK" if R["ok"] else "FAIL",
      "%d bytes" % R["bytes"], json.dumps(R["meshes"], ensure_ascii=False))
for m in fails:
    print("  FAIL", m)
if fails:
    raise SystemExit(1)
