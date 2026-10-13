"""
Modela a cena (sala, mesa, abóbora e objetos) e exporta public/models/scene.glb.

    blender -b --factory-startup --python blender/scene.py

As posições estão escritas no padrão do three.js (y para cima, +z em direção à câmera);
V() converte para o Blender (z para cima). Unidades iguais às do site: o tampo da mesa fica em y = 0.
"""
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, noise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'scene.glb')
BLEND = os.path.join(ROOT, 'blender', 'abobora.blend')

TAU = math.tau
FLOOR = -2.36
BACK = -5.0
WALL_TOP = 7.5
WIN = (-2.2, 2.2, 0.5, 3.9)
RADIUS, SQUASH, RIBS = 1.25, 0.8, 10
SEG_W, SEG_H = 192, 128

random.seed(7)


def V(x, y, z):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


def hex_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATS = {}


def mat(name, color='#ffffff', rough=0.8, metal=0.0, emit=None, strength=1.0, double=False):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_lin(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*hex_lin(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    m.use_backface_culling = not double
    MATS[name] = m
    return m


# ---------------------------------------------------------------- utilitários

def new_obj(name, bm, mats, parent=None, loc=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if parent:
        ob.parent = parent
    if loc is not None:
        ob.location = loc
    return ob


def link(name, me, loc, parent=None):
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if parent:
        ob.parent = parent
    ob.location = loc
    return ob


def empty(name, loc, parent=None):
    ob = bpy.data.objects.new(name, None)
    col.objects.link(ob)
    if parent:
        ob.parent = parent
    ob.location = loc
    return ob


def bevel(ob, width, segs=2):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    return ob


def cube_bm(w, h, d, bev=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    if bev:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bev, segments=segs, affect='EDGES')
    return bm


def box(name, w, h, d, c, m, bev=0.0, segs=2, parent=None):
    ob = new_obj(name, cube_bm(w, h, d), [m], parent, V(*c))
    if bev:
        bevel(ob, bev, segs)
    return ob


def lathe(name, prof, m, c=(0, 0, 0), segs=32, parent=None, smooth=True, caps=True):
    """perfil (raio, altura) de baixo para cima, girado em torno do eixo vertical"""
    bm = bmesh.new()
    rings = []
    for r, h in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            rings.append([bm.verts.new((r * math.cos(TAU * i / segs), r * math.sin(TAU * i / segs), h)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if caps and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [m], parent, V(*c), smooth)


def tube(name, pts, radius, m, segs=8, parent=None):
    """tubo ao longo de pontos (em coordenadas do three); radius(t) com t de 0 a 1"""
    bm = bmesh.new()
    tube_into(bm, [V(*p) for p in pts], radius, segs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [m], parent, None, True)


def tube_into(bm, pts, radius, segs=8):
    """mesmo tubo, escrito num bmesh existente (pontos já em coordenadas do Blender)"""
    rings = []
    for k, p in enumerate(pts):
        t = k / (len(pts) - 1)
        tan = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        n = tan.cross(Vector((0, 0, 1)))
        if n.length < 1e-4:
            n = tan.cross(Vector((1, 0, 0)))
        n.normalize()
        b = tan.cross(n)
        r = radius(t)
        rings.append([bm.verts.new(p + (n * math.cos(TAU * i / segs) + b * math.sin(TAU * i / segs)) * r) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def profile_mesh(name, pts, depth, m):
    """contorno 2D (x, y do three) extrudado na profundidade z; devolve a malha para ser reaproveitada"""
    bm = bmesh.new()
    front = [bm.verts.new(V(x, y, depth / 2)) for x, y in pts]
    back = [bm.verts.new(V(x, y, -depth / 2)) for x, y in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    return me


def gable(name, w, d, h, c, m, over=0.3, parent=None):
    """telhado de duas águas com a cumeeira ao longo de x"""
    bm = bmesh.new()
    W, D = w / 2 + over, d / 2 + over
    a = [bm.verts.new(V(x, -over * 0.6, z)) for x, z in ((-W, -D), (W, -D), (W, D), (-W, D))]
    r = [bm.verts.new(V(x, h, 0)) for x in (-W, W)]
    bm.faces.new((a[3], a[2], r[1], r[0]))
    bm.faces.new((a[0], r[0], r[1], a[1]))
    bm.faces.new((a[0], a[3], r[0]))
    bm.faces.new((a[1], r[1], a[2]))
    bm.faces.new((a[0], a[1], a[2], a[3]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [m], parent, V(*c))


def quad(name, w, h, c, m, parent=None):
    """plano virado para +z (para a câmera) com UV de 0 a 1"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new(V(x * w / 2, y * h / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = t
    return new_obj(name, bm, [m], parent, V(*c))


def world_uv(ob):
    """UV por projeção de caixa em coordenadas do mundo (1 unidade = 1 em UV) para texturas que repetem"""
    bpy.context.view_layer.update()
    mw = ob.matrix_world
    rot = mw.to_3x3()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = rot @ f.normal
        a = max(range(3), key=lambda k: abs(n[k]))
        for loop in f.loops:
            p = mw @ loop.vert.co
            loop[uv].uv = (p.x, p.y) if a == 2 else (p.y, p.z) if a == 0 else (p.x, p.z)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


# ---------------------------------------------------------------- materiais

SKIN = mat('PumpkinSkin', '#ffffff', 0.5)
STEM = mat('Stem', '#5f7326', 0.85)
STEM_CUT = mat('StemCut', '#c8b27a', 0.9)
LEAF = mat('Leaf', '#5c8a2b', 0.75, double=True)
VINE = mat('Vine', '#557a22', 0.7)
TABLE = mat('TableWood', '#ffffff', 0.78)
FLOOR_M = mat('Floor', '#ffffff', 0.85)
WALLPAPER = mat('Wallpaper', '#ffffff', 0.95)
DARK = mat('DarkWood', '#ffffff', 0.7)
WINDOW = mat('WindowWood', '#2b1c13', 0.7)
STONE = mat('Stone', '#ffffff', 0.95)
SOOT = mat('Soot', '#0d0706', 1.0)
IRON = mat('Iron', '#1b1b1e', 0.55, 0.8)
BARK = mat('Bark', '#3a2414', 0.95)
BRASS = mat('Brass', '#b08a3a', 0.35, 0.85)
WAX = mat('Wax', '#efe3c8', 0.55)
CURTAIN = mat('Curtain', '#5a1521', 0.95, double=True)
COBWEB = mat('Cobweb', '#ffffff', 1.0, double=True)
PAINTING = mat('Painting', '#ffffff', 0.9)
EMBERS = mat('Embers', '#ff5a14', 0.9, emit='#ff4a10', strength=3.0)
POTION = mat('Potion', '#3fa86a', 0.15, emit='#39ff88', strength=1.2)
JAR = mat('JarGlow', '#6b3fa8', 0.2, emit='#a35cff', strength=1.0)
CORK = mat('Cork', '#8a6a44', 0.9)
POSTER = mat('Poster', '#ffffff', 0.9)
INK_DRIP = mat('InkDrip', '#0b0603', 0.2)
INK_PUDDLE = mat('InkPuddle', '#0b0603', 0.12)
SHADE = mat('LampShade', '#2a2420', 0.45, 0.7, double=True)
BULB = mat('Bulb', '#fff2c8', 0.3, emit='#ffd98a', strength=6.0)
CORD = mat('Cord', '#141010', 0.8)


# ---------------------------------------------------------------- abóbora

def pumpkin_point(u, j):
    theta = j / SEG_H * math.pi
    phi = u * TAU
    s, h = math.sin(theta), math.cos(theta)
    ang = -math.pi / 2 + phi
    bx, by, bz = -math.cos(ang) * s, h, math.sin(ang) * s
    warp = phi + 0.035 * math.sin(3 * phi + 0.7)
    g = 1 - math.sqrt(abs(math.cos(RIBS * warp / 2)))
    bulge = 1 + 0.02 * math.sin(2 * phi + 1.0) + 0.012 * math.sin(3 * phi + 2.0)
    r = (1 - 0.1 * g) * (1 + 0.05 * max(0.0, -h)) * bulge
    r *= 1 + 0.012 * noise.noise(Vector((bx * 2.2, by * 2.2, bz * 2.2)))
    pole = math.exp(-(s * s) / 0.05)
    y = h * SQUASH - math.copysign(0.32 if h > 0 else 0.2, h) * pole
    lobe, groove, crown = (Vector(hex_lin(x)) for x in ('#ff8a1f', '#b9420d', '#8f4512'))
    c = lobe.lerp(groove, g ** 0.7).lerp(crown, math.exp(-(s * s) / 0.15) * (0.85 if h > 0 else 0.4))
    c *= 1 + 0.06 * noise.noise(Vector((bx * 5, by * 9, bz * 5)))
    return V(bx * r * RADIUS, y * RADIUS, bz * r * RADIUS), c


def pumpkin_mesh():
    """mesmo parâmetro de uma UV sphere: u dá a volta, v vai do topo (1) à base (0).
    A escultura do site pinta numa textura nesse UV."""
    bm = bmesh.new()
    color = bm.verts.layers.float_color.new('Color')
    uvl = bm.loops.layers.uv.new('UVMap')

    def vert(u, j):
        p, c = pumpkin_point(u, j)
        v = bm.verts.new(p)
        v[color] = (*c, 1.0)
        return v

    top = vert(0, 0)
    rows = [[vert(i / SEG_W, j) for i in range(SEG_W)] for j in range(1, SEG_H)]
    bottom = vert(0, SEG_H)

    def face(verts, uvs):
        f = bm.faces.new(verts)
        for loop, t in zip(f.loops, uvs):
            loop[uvl].uv = t

    # o exportador inverte o v (glTF tem origem em cima), então v = j / SEG_H aqui vira 1 - j / SEG_H no site
    for i in range(SEG_W):
        k = (i + 1) % SEG_W
        u0, u1 = i / SEG_W, (i + 1) / SEG_W
        face((top, rows[0][k], rows[0][i]), (((u0 + u1) / 2, 0), (u1, 1 / SEG_H), (u0, 1 / SEG_H)))
        for j in range(SEG_H - 2):
            a, b = rows[j], rows[j + 1]
            va, vb = (j + 1) / SEG_H, (j + 2) / SEG_H
            face((a[i], a[k], b[k], b[i]), ((u0, va), (u1, va), (u1, vb), (u0, vb)))
        last, vl = rows[-1], (SEG_H - 1) / SEG_H
        face((bottom, last[i], last[k]), (((u0 + u1) / 2, 1), (u0, vl), (u1, vl)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    min_y = min(v.co.z for v in bm.verts)
    me = bpy.data.meshes.new('PumpkinBody')
    bm.to_mesh(me)
    bm.free()
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    me.materials.append(SKIN)
    me.shade_smooth()
    return me, min_y


def stem_mesh():
    bm = bmesh.new()
    n, rows = 28, 14
    rings = []
    for k in range(rows + 1):
        t = k / rows
        y = 0.5 * t
        base = 0.12 + (0.07 - 0.12) * t
        flare = 1 + 0.9 * math.exp(-y * 18)
        ox = 0.55 * y * y
        ring = []
        for i in range(n):
            a = TAU * i / n
            r = base * flare * (1 + 0.12 * math.cos(7 * a + t * 1.4))
            ring.append(bm.verts.new(V(ox + r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    rim = rings[-1]
    center = sum((v.co for v in rim), Vector()) / n
    inner = [bm.verts.new(v.co.lerp(center, 0.18) - Vector((0, 0, 0.006))) for v in rim]
    cap = []
    for i in range(n):
        j = (i + 1) % n
        cap.append(bm.faces.new((rim[i], rim[j], inner[j], inner[i])))
    mid = bm.verts.new(center - Vector((0, 0, 0.018)))
    for i in range(n):
        cap.append(bm.faces.new((inner[i], inner[(i + 1) % n], mid)))
    for f in cap:
        f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('Stem')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(STEM)
    me.materials.append(STEM_CUT)
    me.shade_smooth()
    return me


def leaf_mesh(m, name='Leaf'):
    """folha deitada (para cima = +y), dobrada na nervura e com a ponta curvada"""
    bm = bmesh.new()
    rows, cols = 18, 8
    grid = []
    for k in range(rows + 1):
        t = k / rows
        w = 0.19 * math.sin(math.pi * t) ** 0.8 * (1 - 0.25 * t) + 0.004
        grid.append([
            bm.verts.new(V(i / cols * w, abs(i / cols) * w * 0.45 + 0.18 * t * t, -t * 0.42))
            for i in range(-cols, cols + 1)
        ])
    for a, b in zip(grid, grid[1:]):
        for i in range(2 * cols):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    me.shade_smooth()
    return me


body, min_y = pumpkin_mesh()
lift = -min_y
stem = stem_mesh()
top_y = (SQUASH - 0.32) * RADIUS

pumpkin = link('Pumpkin', body, V(0, lift, 0))
s = link('PumpkinStem', stem, V(0, top_y - 0.06, 0), pumpkin)
s.rotation_euler.z = 0.6

def surface_y(rho):
    """altura da casca no topo a uma distância horizontal rho do talo"""
    s = min(rho / (RADIUS * 0.97), 0.999)
    return (math.sqrt(1 - s * s) * SQUASH - 0.32 * math.exp(-(s * s) / 0.05)) * RADIUS


# a gavinha sai da base do talo e corre por cima da casca, sempre acima dela, enrolando no ar no fim
heading = Vector((math.cos(-0.35), 0, math.sin(-0.35)))
side = Vector((0, 1, 0)).cross(heading).normalized()
spiral = []
for i in range(121):
    t = i / 120
    rho = 0.1 + 0.62 * t
    r = 0.06 * (1 - 0.45 * t) * min(1, t * 5)
    lift = surface_y(rho) + 0.06 + r + 0.3 * t ** 2.5
    a = t * math.pi * 9
    p = heading * rho + Vector((0, lift, 0)) + side * math.cos(a) * r + Vector((0, math.sin(a) * r, 0))
    spiral.append(tuple(p))
tube('PumpkinVine', spiral, lambda t: 0.016 * (1 - 0.5 * t), VINE, 8, pumpkin)

lf = link('PumpkinLeaf', leaf_mesh(LEAF), V(-0.1, top_y + 0.03, 0.08), pumpkin)
lf.rotation_euler = (0.35, 0.15, 2.4)

for i, (x, z, sc, r) in enumerate([(2.25, -0.55, 0.34, 0.4), (2.85, 0.45, 0.24, 1.7), (-2.6, -0.9, 0.29, 2.6)]):
    p = link(f'PumpkinSmall.{i}', body, V(x, lift * sc, z))
    p.scale = (sc, sc, sc)
    p.rotation_euler.z = r
    link(f'PumpkinSmallStem.{i}', stem, V(0, top_y - 0.06, 0), p)


# ---------------------------------------------------------------- mesa

world_uv(box('TableTop', 7.2, 0.16, 5.0, (0, -0.08, 0.6), TABLE, bev=0.035, segs=3))
world_uv(box('TableApron', 6.6, 0.3, 4.4, (0, -0.31, 0.6), TABLE, bev=0.01))
leg_prof = [(0, 0), (0.08, 0), (0.1, 0.04), (0.07, 0.12), (0.075, 0.5), (0.11, 0.62), (0.06, 0.76),
            (0.085, 1.1), (0.06, 1.42), (0.1, 1.52), (0.12, 1.6), (0.12, 2.2), (0, 2.2)]
for x, z in ((-3.2, -1.5), (3.2, -1.5), (-3.2, 2.7), (3.2, 2.7)):
    world_uv(lathe('TableLeg', leg_prof, TABLE, (x, FLOOR, z), 24))

# velas com pingos de cera
drip = bmesh.new()
bmesh.ops.create_uvsphere(drip, u_segments=10, v_segments=8, radius=1)
drip_me = bpy.data.meshes.new('Drip')
drip.to_mesh(drip_me)
drip.free()
drip_me.materials.append(WAX)
drip_me.shade_smooth()

for i, (x, z, h) in enumerate([(-2.15, 0.75, 0.5), (-1.88, 1.0, 0.34), (-2.42, 1.05, 0.24)]):
    lathe(f'CandleDish.{i}', [(0, 0), (0.14, 0), (0.15, 0.015), (0.13, 0.03), (0.09, 0.035), (0, 0.035)], BRASS, (x, 0, z))
    lathe(f'Candle.{i}', [(0, 0.035), (0.078, 0.035), (0.075, h * 0.6), (0.074, h - 0.012), (0.066, h),
                          (0.03, h - 0.012), (0, h - 0.01)], WAX, (x, 0, z))
    for k in range(3):
        a = random.random() * TAU
        dd = link(f'CandleDrip.{i}', drip_me, V(x + math.cos(a) * 0.074, h - 0.05 - random.random() * 0.06, z + math.sin(a) * 0.074))
        dd.scale = (0.016, 0.016, 0.04 + random.random() * 0.03)
    empty(f'Flame.Table.{i}', V(x, h + 0.065, z))

# folhas secas na mesa
autumn = ['#c2410c', '#b45309', '#9a3412', '#d97706', '#7c2d12']
spots = [(-1.3, 1.25), (1.5, 1.1), (0.9, 1.55), (-0.6, 1.6), (2.5, -0.2), (-2.8, 0.2), (1.9, 0.6), (-1.6, -0.9)]
leaf_by_color = {}
for i, (x, z) in enumerate(spots):
    c = autumn[i % len(autumn)]
    if c not in leaf_by_color:
        leaf_by_color[c] = leaf_mesh(mat(f'LeafAutumn{len(leaf_by_color)}', c, 0.8, double=True), f'LeafAutumn{len(leaf_by_color)}')
    ob = link('TableLeaf', leaf_by_color[c], V(x, 0.005, z))
    ob.rotation_euler.z = random.random() * TAU
    sc = 0.7 + random.random() * 0.5
    ob.scale = (sc, sc, sc * 0.6)


# ---------------------------------------------------------------- sala

x0, x1, y0, y1 = WIN
for a, b, c, dd in ((-8, x0, FLOOR, WALL_TOP), (x1, 8, FLOOR, WALL_TOP), (x0, x1, y1, WALL_TOP), (x0, x1, FLOOR, y0)):
    world_uv(box('WallBack', b - a, dd - c, 0.3, ((a + b) / 2, (c + dd) / 2, BACK - 0.15), WALLPAPER))
for sx in (-1, 1):
    world_uv(box('WallSide', 0.3, WALL_TOP - FLOOR, 15, (sx * 8.15, (WALL_TOP + FLOOR) / 2, 2.5), WALLPAPER))
    world_uv(box('WainscotSide', 0.06, 1.91, 15, (sx * 7.97, FLOOR + 0.955, 2.5), DARK))
    box('ChairRailSide', 0.12, 0.1, 15, (sx * 7.94, FLOOR + 1.91, 2.5), DARK, bev=0.02)
world_uv(box('Floor', 16.6, 0.1, 15.3, (0, FLOOR - 0.05, 2.5), FLOOR_M))

world_uv(box('Wainscot', 16, 1.91, 0.06, (0, FLOOR + 0.955, BACK + 0.03), DARK))
panel = world_uv(new_obj('WainscotPanel', cube_bm(1.25, 1.2, 0.05, 0.022, 2), [DARK], loc=V(-7.2, FLOOR + 1.0, BACK + 0.07)))
for k in range(1, 10):
    link('WainscotPanel', panel.data, V(-7.2 + k * 1.6, FLOOR + 1.0, BACK + 0.07))
world_uv(box('ChairRail', 16, 0.1, 0.12, (0, FLOOR + 1.91, BACK + 0.06), DARK, bev=0.02))
world_uv(box('Baseboard', 16, 0.24, 0.1, (0, FLOOR + 0.12, BACK + 0.05), DARK, bev=0.015))

# janela
for sx, x in ((-1, x0), (1, x1)):
    box('WindowJamb', 0.16, y1 - y0 + 0.1, 0.42, (x - sx * 0.05, (y0 + y1) / 2, BACK - 0.11), WINDOW, bev=0.015)
    box('WindowCasing', 0.22, y1 - y0 + 0.42, 0.05, (x + sx * 0.12, (y0 + y1) / 2 + 0.12, BACK + 0.025), WINDOW, bev=0.012)
box('WindowHeader', x1 - x0 + 0.1, 0.16, 0.42, (0, y1 - 0.05, BACK - 0.11), WINDOW, bev=0.015)
box('WindowCasingTop', x1 - x0 + 0.7, 0.26, 0.06, (0, y1 + 0.16, BACK + 0.03), WINDOW, bev=0.015)
box('WindowSill', x1 - x0 + 0.75, 0.1, 0.62, (0, y0, BACK + 0.04), WINDOW, bev=0.025, segs=3)
box('WindowMullion', 0.07, y1 - y0, 0.09, (0, (y0 + y1) / 2, BACK - 0.12), WINDOW)
box('WindowTransom', x1 - x0, 0.07, 0.09, (0, 2.45, BACK - 0.12), WINDOW)
for x in (-1.1, 1.1):
    box('WindowMuntin', 0.035, y1 - y0, 0.06, (x, (y0 + y1) / 2, BACK - 0.12), WINDOW)


def curtain(side):
    bm = bmesh.new()
    nx, ny, width, height, top = 36, 34, 1.5, 6.6, 4.3
    outer = side * (x1 + 0.9)
    grid = []
    for j in range(ny + 1):
        t = j / ny
        y = top - t * height
        pinch = 1 - 0.55 * math.exp(-((y - 0.95) / 0.6) ** 2)
        row = []
        for i in range(nx + 1):
            s_ = i / nx
            x = outer - side * s_ * width * pinch
            z = BACK + 0.34 + 0.07 * math.sin(s_ * TAU * 4.5 + side) * (0.6 + 0.4 * pinch) + 0.1 * (1 - pinch)
            yy = y - (random.random() * 0.06 if j == ny else 0)
            row.append(bm.verts.new(V(x, yy, z)))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for i in range(nx):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    new_obj('Curtain', bm, [CURTAIN], smooth=True)
    box('CurtainTie', width * 0.45 + 0.08, 0.07, 0.24, (outer - side * width * 0.45 / 2, 0.95, BACK + 0.4), BRASS, bev=0.02)


curtain(-1)
curtain(1)
rod = lathe('CurtainRod', [(0, 0), (0.035, 0), (0.035, 7.7), (0, 7.7)], BRASS, (-3.85, 4.42, BACK + 0.36), 16)
rod.rotation_euler.y = math.pi / 2
for sx in (-1, 1):
    lathe('CurtainFinial', [(0, 0), (0.045, 0.01), (0.07, 0.06), (0.05, 0.11), (0.02, 0.14), (0, 0.16)], BRASS,
          (sx * 3.85, 4.42, BACK + 0.36), 20).rotation_euler.y = sx * math.pi / 2

# lareira
FX = -5.4
world_uv(box('Hearth', 3.3, 0.2, 1.2, (FX, FLOOR + 0.1, BACK + 0.6), STONE, bev=0.02))
for sx in (-1, 1):
    world_uv(box('FirePillar', 0.6, 2.3, 0.75, (FX + sx * 1.2, FLOOR + 1.35, BACK + 0.375), STONE, bev=0.03))
world_uv(box('FireLintel', 3.0, 0.55, 0.75, (FX, FLOOR + 2.775, BACK + 0.375), STONE, bev=0.03))
world_uv(box('Mantel', 3.6, 0.14, 0.95, (FX, 0.76, BACK + 0.47), DARK, bev=0.03, segs=3))
world_uv(box('MantelMolding', 3.3, 0.1, 0.85, (FX, 0.65, BACK + 0.43), DARK, bev=0.03, segs=2))
box('Firebox', 1.85, 2.3, 0.08, (FX, FLOOR + 1.35, BACK + 0.05), SOOT)
box('FireboxTop', 1.85, 0.05, 0.72, (FX, FLOOR + 2.48, BACK + 0.38), SOOT)
box('FireboxFloor', 1.85, 0.03, 0.72, (FX, FLOOR + 0.215, BACK + 0.38), SOOT)
for k in range(4):
    box('Grate', 1.3, 0.035, 0.035, (FX, FLOOR + 0.33, BACK + 0.25 + k * 0.12), IRON)
for sx in (-1, 1):
    box('GrateLeg', 0.04, 0.14, 0.45, (FX + sx * 0.6, FLOOR + 0.27, BACK + 0.43), IRON)
log_prof = [(0, 0), (0.09, 0), (0.105, 0.04), (0.1, 0.5), (0.108, 0.9), (0.095, 1.0), (0, 1.0)]
lg = lathe('Log', log_prof, BARK, (FX - 0.5, FLOOR + 0.43, BACK + 0.35), 12)
lg.rotation_euler.y = math.pi / 2
lg = lathe('Log', log_prof, BARK, (FX - 0.42, FLOOR + 0.43, BACK + 0.6), 12)
lg.rotation_euler = (0, math.pi / 2, -0.25)
lg = lathe('Log', log_prof, BARK, (FX - 0.3, FLOOR + 0.6, BACK + 0.47), 12)
lg.rotation_euler = (0, math.pi / 2 - 0.12, 0.15)
lg.scale = (0.9, 0.9, 0.75)
box('Embers', 1.15, 0.05, 0.42, (FX, FLOOR + 0.25, BACK + 0.45), EMBERS)
empty('Fire', V(FX, FLOOR + 0.55, BACK + 0.45))

# retrato acima da lareira
PX, PY, PW, PH = FX, 2.4, 1.45, 1.85
for sx in (-1, 1):
    box('PortraitFrame', 0.15, PH, 0.09, (PX + sx * (PW / 2 - 0.075), PY, BACK + 0.045), BRASS, bev=0.035, segs=3)
    box('PortraitFrame', PW, 0.15, 0.09, (PX, PY + sx * (PH / 2 - 0.075), BACK + 0.045), BRASS, bev=0.035, segs=3)
quad('Portrait', PW - 0.24, PH - 0.24, (PX, PY, BACK + 0.03), PAINTING)

for i, sx in enumerate((-1, 1)):
    x = FX + sx * 1.4
    lathe(f'Candlestick.{i}', [(0, 0), (0.09, 0), (0.09, 0.02), (0.045, 0.05), (0.025, 0.2), (0.045, 0.24),
                               (0.03, 0.28), (0.05, 0.3), (0, 0.3)], BRASS, (x, 0.83, BACK + 0.5), 20)
    lathe(f'MantelCandle.{i}', [(0, 0.3), (0.03, 0.3), (0.03, 0.56), (0.024, 0.58), (0, 0.575)], WAX, (x, 0.83, BACK + 0.5), 12)
    empty(f'Flame.Mantel.{i}', V(x, 0.83 + 0.61, BACK + 0.5))
lathe('PotionBottle', [(0, 0), (0.1, 0), (0.13, 0.07), (0.13, 0.13), (0.09, 0.2), (0.04, 0.23), (0.035, 0.32), (0, 0.32)],
      POTION, (FX + 0.62, 0.83, BACK + 0.55), 20)
lathe('PotionCork', [(0, 0.3), (0.04, 0.3), (0.045, 0.37), (0, 0.37)], CORK, (FX + 0.62, 0.83, BACK + 0.55), 12)
box('MantelBook', 0.55, 0.1, 0.38, (FX - 0.62, 0.88, BACK + 0.5), mat('BookPurple', '#3c2a57', 0.8), bev=0.01)
box('MantelBook', 0.48, 0.08, 0.34, (FX - 0.6, 0.97, BACK + 0.5), mat('BookGreen', '#2f4a3a', 0.8), bev=0.01)

# estante
BX = 5.5
for sx in (-1, 1):
    world_uv(box('ShelfSide', 0.1, 4.6, 0.62, (BX + sx * 1.05, FLOOR + 2.3, BACK + 0.31), DARK, bev=0.01))
box('ShelfBack', 2.1, 4.6, 0.04, (BX, FLOOR + 2.3, BACK + 0.02), SOOT)
world_uv(box('ShelfTop', 2.35, 0.12, 0.7, (BX, FLOOR + 4.6, BACK + 0.35), DARK, bev=0.02))
shelves = [FLOOR + 0.12, FLOOR + 1.15, FLOOR + 2.2, FLOOR + 3.3]
for y in shelves:
    world_uv(box('Shelf', 2.0, 0.06, 0.58, (BX, y, BACK + 0.31), DARK))

book_colors = ['#5b2333', '#2f4a3a', '#3c3357', '#7a5a2e', '#283a52']
book_meshes = []
for i, c in enumerate(book_colors):
    me = bpy.data.meshes.new(f'Book{i}')
    bm = cube_bm(1, 1, 1, 0.04, 1)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(f'Book{i}', c, 0.8))
    book_meshes.append(me)
for y in shelves[:3]:
    x = BX - 0.95
    while x < BX + 0.85:
        bw = random.uniform(0.06, 0.13)
        bh = random.uniform(0.55, 0.85)
        bd = random.uniform(0.38, 0.5)
        if random.random() < 0.07:
            x += 0.15
            continue
        ob = link('Book', random.choice(book_meshes), V(x + bw / 2, y + 0.03 + bh / 2, BACK + 0.06 + bd / 2))
        ob.scale = (bw, bd, bh)
        x += bw + 0.005
top_shelf = shelves[3] + 0.03
for i, (dx, m, h) in enumerate(((-0.6, JAR, 0.34), (-0.2, POTION, 0.26), (0.55, JAR, 0.22))):
    lathe(f'Jar.{i}', [(0, 0), (0.1, 0), (0.12, 0.04), (0.12, h * 0.8), (0.07, h * 0.9), (0.06, h), (0, h)], m,
          (BX + dx, top_shelf, BACK + 0.3), 20)
for k in range(3):
    ob = link('Book', book_meshes[k], V(BX + 0.2, top_shelf + 0.05 + k * 0.09, BACK + 0.3))
    ob.scale = (0.5 - k * 0.05, 0.36, 0.085)
    ob.rotation_euler.z = 0.1 * (k - 1)

# teias
quad('Cobweb', 0.85, 0.85, (x0 + 0.08 + 0.425, y1 - 0.13 - 0.425, BACK - 0.04), COBWEB)
quad('Cobweb', 0.7, 0.7, (BX - 1.0 + 0.35, FLOOR + 4.54 - 0.35, BACK + 0.5), COBWEB)

# cartaz de desenho animado antigo, tinta escorrendo e poças
quad('Poster', 1.0, 1.42, (3.78, 2.35, BACK + 0.012), POSTER)
quad('InkDrip', 0.55, 3.2, (-3.35, 2.6, BACK + 0.01), INK_DRIP)
quad('InkDrip', 3.4, 1.2, (0, y0 - 0.62, BACK + 0.11), INK_DRIP)
quad('InkDrip', 0.9, 2.4, (6.9, 3.0, BACK + 0.01), INK_DRIP)
for x, z, w, d in ((1.35, 1.35, 1.1, 0.8), (-0.95, -1.25, 0.7, 0.5), (-4.6, 3.2, 2.2, 1.4)):
    y = 0.004 if z < 3.1 else FLOOR + 0.002
    pd = quad('InkPuddle', w, d, (x, y, z), INK_PUDDLE)
    pd.rotation_euler.x = -math.pi / 2

# luminária pendente (o pivô fica no teto para ela balançar)
pivot = empty('LampPivot', V(0, WALL_TOP, -0.3))
tube('LampCord', [(0, 0, 0), (0, -(WALL_TOP - 3.62), 0)], lambda t: 0.012, CORD, 6, pivot)
lathe('LampShade', [(0.035, 0.42), (0.06, 0.4), (0.1, 0.33), (0.32, 0.08), (0.42, 0.0), (0.4, -0.01)], SHADE,
      (0, 3.2 - WALL_TOP, 0), 40, pivot, caps=False)
bulb = bmesh.new()
bmesh.ops.create_uvsphere(bulb, u_segments=16, v_segments=12, radius=0.09)
new_obj('LampBulb', bulb, [BULB], pivot, V(0, 3.24 - WALL_TOP, 0), True)
empty('Lamp', V(0, 3.18 - WALL_TOP, 0), pivot)


# ---------------------------------------------------------------- lá fora: colina, casa assombrada, cerca, lápides e árvores

GROUND = mat('OutsideGround', '#3a2c3a', 1.0)
HOUSE_WALL = mat('HouseWall', '#ffffff', 0.9)
HOUSE_ROOF = mat('HouseRoof', '#ffffff', 0.85)
HOUSE_TRIM = mat('HouseTrim', '#1e1612', 0.8)
LIT = mat('HouseWindowLit', '#ffd27a', 0.6, emit='#ffb347', strength=5.0)
FLICKER = mat('HouseWindowFlicker', '#ffd27a', 0.6, emit='#ffb347', strength=5.0)
DARK_WIN = mat('HouseWindowDark', '#0c0806', 0.4)
GRAVE = mat('Grave', '#7a7280', 0.95)


def ground_y(x, z):
    hill = 1.9 * math.exp(-((x + 2.4) ** 2 + (z + 35) ** 2) / 70)
    return (-2.9 + 0.035 * (-z - 6) + 0.45 * math.sin(x * 0.17 + 1.1) * math.cos(z * 0.11) + hill
            + 0.25 * noise.noise(Vector((x * 0.25, z * 0.25, 0.5))))


bm = bmesh.new()
nx, nz, gx0, gx1, gz0, gz1 = 64, 36, -32.0, 32.0, -5.4, -40.0
grid = [[bm.verts.new(V(gx0 + (gx1 - gx0) * i / nx, 0, gz0 + (gz1 - gz0) * k / nz)) for i in range(nx + 1)] for k in range(nz + 1)]
for row in grid:
    for v in row:
        x, z = v.co.x, -v.co.y
        v.co.z = ground_y(x, z)
for a, b in zip(grid, grid[1:]):
    for i in range(nx):
        bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
ground = new_obj('OutsideGround', bm, [GROUND], smooth=True)
if ground.data.polygons[0].normal.z < 0:
    ground.data.flip_normals()

# casa vitoriana (coordenadas locais: frente para +z, chão em y = 0)
HX, HZ, HS = -2.4, -35.0, 0.52
house = empty('HauntedHouse', V(HX, ground_y(HX, HZ) - 0.15, HZ))
house.rotation_euler.z = 0.35
house.scale = (HS, HS, HS)


def hbox(name, w, h, d, c, m, bev=0.04, rot=None):
    ob = box(name, w, h, d, c, m, bev=bev, segs=1, parent=house)
    if rot:
        ob.rotation_euler = rot
    return ob


def window(x, y, z, w, h, m, face=0.0, shutters=False):
    q = quad('HouseWindow', w, h, (x, y, z), m, house)
    q.rotation_euler.z = face
    if face:
        return
    for sx in (-1, 1):
        hbox('WindowTrim', 0.09, h + 0.18, 0.08, (x + sx * (w / 2 + 0.045), y, z), HOUSE_TRIM, 0.0)
    for sy in (-1, 1):
        hbox('WindowTrim', w + 0.27, 0.09, 0.1, (x, y + sy * (h / 2 + 0.045), z), HOUSE_TRIM, 0.0)
    hbox('WindowCross', 0.05, h, 0.05, (x, y, z + 0.02), HOUSE_TRIM, 0.0)
    hbox('WindowCross', w, 0.05, 0.05, (x, y + h * 0.1, z + 0.02), HOUSE_TRIM, 0.0)
    if shutters:
        hbox('Shutter', w * 0.5, h + 0.1, 0.06, (x - w * 0.8, y, z), HOUSE_TRIM, 0.01)
        hbox('Shutter', w * 0.5, h + 0.1, 0.06, (x + w * 0.85, y - 0.12, z + 0.05), HOUSE_TRIM, 0.01, (0, 0, -0.35))


hbox('HouseFoundation', 6.3, 0.6, 4.3, (0, 0.3, 0), STONE)
hbox('HouseFloor1', 6.0, 2.6, 4.0, (0, 1.9, 0), HOUSE_WALL)
hbox('HouseFloor2', 6.3, 2.4, 4.3, (0, 4.4, 0), HOUSE_WALL)
hbox('HouseBelt', 6.5, 0.14, 4.5, (0, 3.2, 0), HOUSE_TRIM, 0.02)
gable('HouseRoof', 6.3, 4.3, 2.9, (0, 5.6, 0), HOUSE_ROOF, 0.35, house)
hbox('Dormer', 1.6, 1.5, 1.6, (1.4, 6.1, 1.3), HOUSE_WALL)
dm = gable('DormerRoof', 1.6, 1.6, 0.9, (1.4, 6.85, 1.45), HOUSE_ROOF, 0.15, house)
dm.rotation_euler.z = math.pi / 2
hbox('Chimney', 0.7, 3.2, 0.7, (2.3, 7.4, -0.9), STONE, 0.03, (0.04, 0, 0.07))
hbox('ChimneyCap', 0.95, 0.18, 0.95, (2.43, 9.0, -0.83), STONE, 0.02, (0.04, 0, 0.07))

tower = empty('HouseTower', V(-3.3, 0, 1.5), house)
tower.rotation_euler.y = -0.05
lathe('TowerBody', [(0, 0.3), (1.1, 0.3), (1.1, 7.6), (0, 7.6)], HOUSE_WALL, (0, 0, 0), 8, tower, smooth=False).rotation_euler.z = math.pi / 8
lathe('TowerBelt', [(0, 5.35), (1.22, 5.35), (1.22, 5.55), (0, 5.55)], HOUSE_TRIM, (0, 0, 0), 8, tower, smooth=False).rotation_euler.z = math.pi / 8
lathe('TowerRoof', [(0, 7.45), (1.55, 7.45), (1.45, 7.7), (0, 11.2)], HOUSE_ROOF, (0, 0, 0), 8, tower, smooth=False).rotation_euler.z = math.pi / 8
lathe('TowerSpire', [(0, 11.1), (0.07, 11.1), (0.025, 12.3), (0, 12.3)], IRON, (0, 0, 0), 8, tower)
for y, m in ((3.0, LIT), (6.3, FLICKER)):
    q = quad('HouseWindow', 0.45, 1.0, (0, y, 1.03), m, tower)

hbox('Porch', 3.2, 0.22, 1.7, (0.6, 0.62, 2.85), HOUSE_TRIM, 0.02)
for x in (-0.85, 2.05):
    hbox('PorchPost', 0.13, 2.0, 0.13, (x, 1.7, 3.55), HOUSE_TRIM, 0.0)
hbox('PorchRoof', 3.5, 0.12, 2.0, (0.6, 2.75, 2.95), HOUSE_ROOF, 0.0, (0.28, 0, 0))
hbox('Door', 0.95, 1.7, 0.06, (0.6, 1.6, 2.02), DARK_WIN, 0.0)

window(-1.7, 1.9, 2.02, 0.8, 1.1, LIT, shutters=True)
window(2.3, 1.9, 2.02, 0.8, 1.1, DARK_WIN)
window(-1.4, 4.4, 2.17, 0.8, 1.1, DARK_WIN, shutters=True)
window(1.4, 4.4, 2.17, 0.8, 1.1, LIT)
window(1.4, 6.05, 2.11, 0.55, 0.65, FLICKER)
q = quad('HouseWindow', 0.8, 1.1, (-3.01, 1.9, -1.1), DARK_WIN, house)
q.rotation_euler.z = -math.pi / 2
q = quad('HouseWindow', 0.8, 1.1, (-3.16, 4.4, -1.1), LIT, house)
q.rotation_euler.z = -math.pi / 2

# cerca torta
picket = profile_mesh('Picket', [(-0.06, 0), (0.06, 0), (0.06, 0.95), (0, 1.1), (-0.06, 0.95)], 0.05, DARK)
for k in range(26):
    if k in (7, 15, 16):
        continue
    x = -7.6 + k * 0.32
    z = -29.0 + 0.15 * math.sin(k * 0.7)
    p = link('Picket', picket, V(x, ground_y(x, z) - 0.15, z))
    p.rotation_euler = (random.uniform(-0.12, 0.12), 0, random.uniform(-0.1, 0.1))
for y in (0.35, 0.8):
    rail = box('FenceRail', 8.4, 0.07, 0.05, (-3.6, ground_y(-3.6, -29.0) + y - 0.15, -29.06), DARK)
    rail.rotation_euler.y = 0.04

# lápides
arch = [(-0.3, 0), (0.3, 0), (0.3, 0.55)] + [(0.3 * math.cos(a), 0.55 + 0.3 * math.sin(a)) for a in [math.pi * i / 10 for i in range(1, 10)]] + [(-0.3, 0.55)]
stone_me = profile_mesh('Headstone', arch, 0.14, GRAVE)
for x, z, s, lean in ((1.9, -27.4, 1.0, 0.12), (2.8, -28.3, 0.85, -0.18), (3.7, -27.1, 1.1, 0.05), (4.6, -28.8, 0.8, 0.25)):
    g = link('Headstone', stone_me, V(x, ground_y(x, z) - 0.12, z))
    g.scale = (s, s, s)
    g.rotation_euler = (0, lean, random.uniform(-0.3, 0.3))
cross = box('GraveCross', 0.12, 1.1, 0.1, (2.3, ground_y(2.3, -29.6) + 0.4, -29.6), GRAVE)
cross.rotation_euler.y = -0.15
box('GraveCross', 0.55, 0.11, 0.1, (0, 0.25, 0), GRAVE, parent=cross)


def dead_tree(name, x, z, height, seed, lean=(0.0, 0.0)):
    rnd = random.Random(seed)
    bm = bmesh.new()

    def branch(p, d, length, r, depth):
        pts = [p.copy()]
        q, dd = p.copy(), d.copy()
        for _ in range(4):
            dd = (dd + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.1, 0.15)))).normalized()
            q = q + dd * (length / 4)
            pts.append(q.copy())
        tube_into(bm, pts, lambda t: r * (1 - 0.55 * t), 6 if depth > 2 else 4)
        if depth == 0:
            return
        for i in range(3 if rnd.random() < 0.35 else 2):
            nd = (dd + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 0.8))) * 0.85).normalized()
            start = pts[-1] if i == 0 else pts[rnd.randint(2, 3)]
            branch(start, nd, length * rnd.uniform(0.55, 0.75), r * 0.55, depth - 1)

    branch(V(x, ground_y(x, z) - 0.3, z), Vector((lean[0], lean[1], 1)).normalized(), height * 0.42, height * 0.045, 5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [BARK], smooth=True)


dead_tree('DeadTree', 5.9, -35.0, 7.0, 3, (0.15, 0.05))
dead_tree('DeadTree', -6.4, -26.5, 4.2, 8, (-0.2, 0.0))
dead_tree('DeadTree', 10.5, -30.0, 5.0, 12, (0.1, -0.1))
empty('BatsMoon', V(5.0, 6.2, -37))
empty('BatsTower', V(-3.6, 5.0, -33))

for ob in list(house.children_recursive):
    if ob.type == 'MESH' and ob.data.materials and ob.data.materials[0] in (HOUSE_WALL, HOUSE_ROOF, STONE):
        world_uv(ob)


# ---------------------------------------------------------------- exportar

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_vertex_color='ACTIVE',
    export_gpu_instances=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_texcoord_quantization=14,
    export_lights=False,
    export_cameras=False,
)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
