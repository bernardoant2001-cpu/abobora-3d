import * as THREE from 'three'
import type { Pt, Stencil } from './stencils'
import { createFlame } from './flame'
import { FX } from './world'

// mesmas medidas usadas em blender/scene.py
export const RADIUS = 1.25
const SQUASH = 0.8
const MASK_W = 2048
const MASK_H = 1024
const GUIDE_W = 1024
const GUIDE_H = 512
const WALL = 0.92

type P = [number, number]
export type Brush = 'carve' | 'shave' | 'restore'

// contorno em zigue-zague da tampa, em UV (v = 1 no topo); igual ao LID_GLSL abaixo
const lidEdge = (u: number) => 0.835 + 0.02 * Math.abs((((u * 14) % 1) + 1) % 1 - 0.5) * 2
const LID_GLSL = `
uniform float uLid;
float lidEdge( float u ) { return 0.835 + 0.02 * abs( fract( u * 14.0 ) - 0.5 ) * 2.0; }
float lidCut( vec2 uv ) { return uLid * smoothstep( lidEdge( uv.x ) - 0.003, lidEdge( uv.x ) + 0.003, uv.y ); }
`

/**
 * Máscara pintada em UV: branco = casca, preto = escavado.
 * Vira o alphaMap da casca e da parede interna.
 * A guia (outra textura) mostra o contorno do recorte reto antes de cortar.
 */
export class Carver {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  readonly guideTexture: THREE.CanvasTexture
  dirty = false
  guideDirty = false
  private ctx: CanvasRenderingContext2D
  private guide = document.createElement('canvas')
  private gctx: CanvasRenderingContext2D
  private snap = document.createElement('canvas')
  private snapCtx: CanvasRenderingContext2D
  private history: { t: number; x: number; y: number; data: ImageData }[] = []
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private last: P | null = null
  private poly: P[] = []
  private cut: CanvasGradient
  private patch: CanvasGradient
  private peel: CanvasGradient
  private probe = document.createElement('canvas')

  constructor() {
    this.canvas.width = this.snap.width = MASK_W
    this.canvas.height = this.snap.height = MASK_H
    this.guide.width = GUIDE_W
    this.guide.height = GUIDE_H
    this.ctx = this.canvas.getContext('2d')!
    this.gctx = this.guide.getContext('2d')!
    this.snapCtx = this.snap.getContext('2d', { willReadFrequently: true })!
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)
    this.gctx.fillStyle = '#000'
    this.gctx.fillRect(0, 0, GUIDE_W, GUIDE_H)

    this.cut = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.cut.addColorStop(0.55, 'rgba(0,0,0,1)')
    this.cut.addColorStop(1, 'rgba(0,0,0,0)')
    this.patch = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.patch.addColorStop(0.55, 'rgba(255,255,255,1)')
    this.patch.addColorStop(1, 'rgba(255,255,255,0)')
    // raspar só tira o vermelho (a casca fina); o verde continua dizendo que não está furado
    this.peel = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    this.peel.addColorStop(0, 'rgba(0,255,255,0.22)')
    this.peel.addColorStop(0.6, 'rgba(0,255,255,0.22)')
    this.peel.addColorStop(1, 'rgba(0,255,255,0)')
    this.probe.width = 64
    this.probe.height = 32

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.wrapS = THREE.RepeatWrapping
    this.guideTexture = new THREE.CanvasTexture(this.guide)
    this.guideTexture.wrapS = THREE.RepeatWrapping
  }

  get points() {
    return this.poly.length
  }

  begin() {
    this.snapCtx.drawImage(this.canvas, 0, 0)
    this.box = [Infinity, Infinity, -Infinity, -Infinity]
    this.last = null
  }

  end() {
    this.last = null
    const x = Math.max(0, Math.floor(this.box[0]))
    const y = Math.max(0, Math.floor(this.box[1]))
    const w = Math.min(MASK_W, Math.ceil(this.box[2])) - x
    const h = Math.min(MASK_H, Math.ceil(this.box[3])) - y
    if (w <= 0 || h <= 0) return
    this.history.push({ t: nextStep(), x, y, data: this.snapCtx.getImageData(x, y, w, h) })
    if (this.history.length > 40) this.history.shift()
  }

  /** momento da última ação desfazível (para o Desfazer escolher entre corte e pintura) */
  get lastStep() {
    return this.history.at(-1)?.t ?? 0
  }

  /** interrompe a interpolação quando o traço sai da abóbora */
  lift() {
    this.last = null
  }

  /** fração da casca que já foi furada (amostra reduzida, barata) */
  carvedFraction() {
    const g = this.probe.getContext('2d', { willReadFrequently: true })!
    g.drawImage(this.canvas, 0, 0, 64, 32)
    const d = g.getImageData(0, 0, 64, 32).data
    let n = 0
    for (let i = 1; i < d.length; i += 4) if (d[i] < 128) n++
    return n / (64 * 32)
  }

  paint(uv: THREE.Vector2, size: number, mode: Brush) {
    const x = uv.x * MASK_W
    const y = (1 - uv.y) * MASK_H
    const [kx, ky] = scale(uv.y)
    const rx = size * kx
    const ry = size * ky

    if (this.last && Math.abs(x - this.last[0]) < MASK_W / 2) {
      const [lx, ly] = this.last
      const steps = Math.ceil(Math.hypot((x - lx) / rx, (y - ly) / ry) / 0.2)
      for (let i = 1; i <= steps; i++) {
        this.stamp(lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps, rx, ry, mode)
      }
    } else {
      this.stamp(x, y, rx, ry, mode)
    }
    this.last = [x, y]
  }

  /** recorte reto: adiciona um canto; clicar de novo no primeiro canto fecha e corta */
  addPoint(uv: THREE.Vector2) {
    const p = this.toMask(uv)
    if (this.poly.length >= 3 && this.nearFirst(p, uv.y)) return this.cutPolygon()
    this.poly.push(p)
    this.drawGuide()
    return false
  }

  removePoint() {
    this.poly.pop()
    this.drawGuide()
  }

  cancelPolygon() {
    if (!this.poly.length) return
    this.poly = []
    this.drawGuide()
  }

  hover(uv: THREE.Vector2 | null) {
    if (this.poly.length) this.drawGuide(uv)
  }

  cutPolygon() {
    if (this.poly.length < 3) return false
    const pts = this.poly
    this.poly = []
    this.begin()
    const ctx = this.ctx
    ctx.filter = 'blur(3px)'
    ctx.fillStyle = '#000'
    for (const ox of [0, -MASK_W, MASK_W]) {
      ctx.beginPath()
      for (const [x, y] of pts) ctx.lineTo(x + ox, y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.filter = 'none'
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const wraps = Math.min(...xs) < 0 || Math.max(...xs) > MASK_W
    this.box = [
      wraps ? 0 : Math.min(...xs) - 10,
      Math.min(...ys) - 10,
      wraps ? MASK_W : Math.max(...xs) + 10,
      Math.max(...ys) + 10,
    ]
    this.end()
    this.dirty = true
    this.drawGuide()
    return true
  }

  undo() {
    const step = this.history.pop()
    if (!step) return
    this.ctx.putImageData(step.data, step.x, step.y)
    this.dirty = true
  }

  clear() {
    this.replace(() => {})
  }

  /** distância (em unidades de superfície) de `uv` até `center`: a = para a direita, b = para cima */
  surfaceOffset(center: THREE.Vector2, uv: THREE.Vector2): P {
    const [kx, ky] = scale(center.y)
    let du = uv.x - center.x
    du -= Math.round(du)
    return [(du * MASK_W) / kx, ((uv.y - center.y) * MASK_H) / ky]
  }

  /** forma pronta (pontos unitários, topo em +y) posicionada na casca: centro, raio e rotação */
  shapePoints(center: THREE.Vector2, r: number, angle: number, unit: Pt[]): P[] {
    const [kx, ky] = scale(center.y)
    const cx = center.x * MASK_W
    const cy = (1 - center.y) * MASK_H
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return unit.map(([x, y]) => [cx + (x * c - y * s) * r * kx, cy - (x * s + y * c) * r * ky])
  }

  /** contorno de prévia da forma na casca (null apaga) */
  previewShape(pts: P[] | null) {
    this.drawGuide()
    if (!pts) return
    const g = this.gctx
    const k = GUIDE_W / MASK_W
    g.lineJoin = 'round'
    g.strokeStyle = '#fff'
    g.lineWidth = 6
    for (const ox of [0, -MASK_W, MASK_W]) {
      g.setTransform(k, 0, 0, k, ox * k, 0)
      g.beginPath()
      for (const [x, y] of pts) g.lineTo(x, y)
      g.closePath()
      g.stroke()
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** aplica a forma: recorta (fura) ou só raspa a casca */
  stampShape(pts: P[], mode: 'carve' | 'shave') {
    this.begin()
    const ctx = this.ctx
    ctx.filter = 'blur(3px)'
    ctx.fillStyle = mode === 'carve' ? '#000' : 'rgba(0,255,255,0.8)'
    ctx.globalCompositeOperation = mode === 'carve' ? 'source-over' : 'multiply'
    for (const ox of [0, -MASK_W, MASK_W]) {
      ctx.beginPath()
      for (const [x, y] of pts) ctx.lineTo(x + ox, y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const wraps = Math.min(...xs) < 0 || Math.max(...xs) > MASK_W
    this.box = [wraps ? 0 : Math.min(...xs) - 10, Math.min(...ys) - 10, wraps ? MASK_W : Math.max(...xs) + 10, Math.max(...ys) + 10]
    this.end()
    this.dirty = true
    this.drawGuide()
  }

  /** desenho do corte em meia resolução (PNG), para enviar à exposição */
  exportMask() {
    const c = document.createElement('canvas')
    c.width = MASK_W / 2
    c.height = MASK_H / 2
    c.getContext('2d')!.drawImage(this.canvas, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  }

  /** cópia do desenho atual, para voltar depois de visitar a exposição */
  saveState() {
    const c = document.createElement('canvas')
    c.width = MASK_W
    c.height = MASK_H
    c.getContext('2d')!.drawImage(this.canvas, 0, 0)
    return c
  }

  restoreState(saved: CanvasImageSource) {
    this.cancelPolygon()
    this.ctx.drawImage(saved, 0, 0, MASK_W, MASK_H)
    this.dirty = true
  }

  stencil(s: Stencil) {
    this.replace((ctx) => {
      const path = (pts: Pt[], color: string) => {
        ctx.filter = 'blur(5px)'
        ctx.fillStyle = color
        ctx.beginPath()
        for (const p of pts) ctx.lineTo(...project(p))
        ctx.closePath()
        ctx.fill()
        ctx.filter = 'none'
      }
      s.draw({ carve: (p) => path(p, '#000'), keep: (p) => path(p, '#fff') })
    })
  }

  private toMask(uv: THREE.Vector2): P {
    let x = uv.x * MASK_W
    const first = this.poly[0]
    if (first && x - first[0] > MASK_W / 2) x -= MASK_W
    else if (first && first[0] - x > MASK_W / 2) x += MASK_W
    return [x, (1 - uv.y) * MASK_H]
  }

  private nearFirst(p: P, v: number) {
    const [kx, ky] = scale(v)
    const f = this.poly[0]
    return Math.hypot((p[0] - f[0]) / kx, (p[1] - f[1]) / ky) < 0.07
  }

  private drawGuide(cursor: THREE.Vector2 | null = null) {
    const g = this.gctx
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, GUIDE_W, GUIDE_H)
    this.guideDirty = true
    if (!this.poly.length) return

    const c = cursor ? this.toMask(cursor) : null
    const closing = !!c && this.poly.length >= 3 && this.nearFirst(c, cursor!.y)
    const k = GUIDE_W / MASK_W
    g.lineJoin = g.lineCap = 'round'
    for (const ox of [0, -MASK_W, MASK_W]) {
      g.setTransform(k, 0, 0, k, ox * k, 0)
      g.strokeStyle = '#fff'
      g.lineWidth = 5
      g.beginPath()
      for (const [x, y] of this.poly) g.lineTo(x, y)
      g.stroke()
      if (c) {
        g.globalAlpha = 0.55
        g.beginPath()
        g.moveTo(...this.poly[this.poly.length - 1])
        g.lineTo(...(closing ? this.poly[0] : c))
        g.stroke()
        g.globalAlpha = 1
      }
      g.fillStyle = '#fff'
      this.poly.forEach(([x, y], i) => {
        g.beginPath()
        g.arc(x, y, i === 0 ? (closing ? 20 : 13) : 9, 0, Math.PI * 2)
        g.fill()
      })
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
  }

  private replace(draw: (ctx: CanvasRenderingContext2D) => void) {
    this.cancelPolygon()
    this.begin()
    this.ctx.fillStyle = '#fff'
    this.ctx.fillRect(0, 0, MASK_W, MASK_H)
    draw(this.ctx)
    this.box = [0, 0, MASK_W, MASK_H]
    this.end()
    this.dirty = true
  }

  private stamp(x: number, y: number, rx: number, ry: number, mode: Brush) {
    const ctx = this.ctx
    ctx.fillStyle = mode === 'carve' ? this.cut : mode === 'shave' ? this.peel : this.patch
    ctx.globalCompositeOperation = mode === 'shave' ? 'multiply' : 'source-over'
    for (const ox of [0, -MASK_W, MASK_W]) {
      const cx = x + ox
      if (cx + rx < 0 || cx - rx > MASK_W) continue
      ctx.setTransform(rx, 0, 0, ry, cx, y)
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      this.box[0] = Math.min(this.box[0], cx - rx)
      this.box[1] = Math.min(this.box[1], y - ry)
      this.box[2] = Math.max(this.box[2], cx + rx)
      this.box[3] = Math.max(this.box[3], y + ry)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    this.dirty = true
  }
}

// contador compartilhado entre escultura e pintura, para desfazer na ordem certa
let steps = 0
export const nextStep = () => ++steps

/** pixels da máscara por unidade de superfície, na latitude dada pelo v */
export function scale(v: number): P {
  const theta = (1 - v) * Math.PI
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  return [
    MASK_W / (2 * Math.PI * RADIUS * Math.max(s, 0.15)),
    MASK_H / (Math.PI * RADIUS * Math.sqrt(c * c + SQUASH * SQUASH * s * s)),
  ]
}

/** coordenadas na superfície (comprimento de arco a partir do centro da frente) → pixel da máscara */
function project([a, b]: Pt): P {
  const theta = Math.PI / 2 - b / (RADIUS * SQUASH)
  const phi = a / (RADIUS * Math.sin(theta) * 0.97)
  return [MASK_W * (0.5 + phi / (Math.PI * 2)), (MASK_H * theta) / Math.PI]
}

const FLESH_SKIN = 'vec3( 1.0, 0.75, 0.35 )'

/** separa a tampa (topo em zigue-zague) e a faixa de polpa da borda dela */
function lidGeometry(geo: THREE.BufferGeometry) {
  const uv = geo.getAttribute('uv')
  const pos = geo.getAttribute('position')
  const index = geo.index!
  const keep: number[] = []
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    if (tri.every((k) => uv.getY(k) > lidEdge(uv.getX(k)) - 0.012)) keep.push(...tri)
  }
  const lid = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(geo.attributes)) lid.setAttribute(name, attr)
  lid.setIndex(keep)

  // arestas usadas por um só triângulo formam a borda; liga a casca de fora à de dentro
  const open = new Map<string, [number, number]>()
  for (let i = 0; i < keep.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = keep[i + e]
      const b = keep[i + ((e + 1) % 3)]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (open.has(key)) open.delete(key)
      else open.set(key, [a, b])
    }
  }
  const morphs = geo.morphAttributes.position ?? []
  const strip: number[] = []
  const deltas: number[][] = morphs.map(() => [])
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  // cada aresta vira 2 triângulos: externo (va, vb) ligado ao interno (va, vb) * WALL
  const ring = (v: THREE.Vector3, k: number) => [v, v, v.clone().multiplyScalar(WALL), v, v.clone().multiplyScalar(WALL), v.clone().multiplyScalar(WALL)][k]
  for (const [a, b] of open.values()) {
    va.fromBufferAttribute(pos, a)
    vb.fromBufferAttribute(pos, b)
    const order = [vb, va, va, vb, va, vb]
    order.forEach((v, k) => strip.push(...ring(v, k).toArray()))
    morphs.forEach((m, t) => {
      const da = new THREE.Vector3().fromBufferAttribute(m, a)
      const db = new THREE.Vector3().fromBufferAttribute(m, b)
      const dorder = [db, da, da, db, da, db]
      dorder.forEach((d, k) => deltas[t].push(...ring(d, k).toArray()))
    })
  }
  const rim = new THREE.BufferGeometry()
  rim.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3))
  rim.morphAttributes.position = deltas.map((d) => new THREE.Float32BufferAttribute(d, 3))
  rim.morphTargetsRelative = true
  lid.morphAttributes = geo.morphAttributes
  lid.morphTargetsRelative = geo.morphTargetsRelative
  rim.computeVertexNormals()
  // a tampa compartilha o atributo de posição da abóbora inteira: mede só os vértices dela
  const bottom = Math.min(...keep.map((k) => pos.getY(k)))
  return { lid, rim, bottom }
}

/** transforma a abóbora modelada no Blender numa lanterna esculpível */
export function createCarvedPumpkin(
  outer: THREE.Mesh,
  carver: Carver,
  glow: { value: number },
  paint: { texture: THREE.Texture; glowTexture: THREE.Texture },
  dark: { value: number },
) {
  const lidOpen = { value: 0 }
  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    alphaMap: carver.texture,
    alphaTest: 0.5,
  })
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.uniforms.uLid = lidOpen
    shader.uniforms.uGuide = { value: carver.guideTexture }
    shader.uniforms.uWall = { value: (1 - WALL) * RADIUS * 0.9 }
    shader.uniforms.uPaint = { value: paint.texture }
    shader.uniforms.uPaintGlow = { value: paint.glowTexture }
    shader.uniforms.uDark = dark
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uGlow;\nuniform float uWall;\nuniform float uDark;\nuniform sampler2D uGuide;\nuniform sampler2D uPaint;\nuniform sampler2D uPaintGlow;\n${LID_GLSL}`,
      )
      .replace(
        '#include <alphamap_pars_fragment>',
        `#include <alphamap_pars_fragment>
        float maskG( vec2 uv ) { return textureLod( alphaMap, uv, 0.0 ).g * ( 1.0 - lidCut( uv ) ); }`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `vec4 mk = texture2D( alphaMap, vAlphaMapUv );
        float carve = mk.g * ( 1.0 - lidCut( vAlphaMapUv ) );

        // parede do corte: dentro de um buraco, segue o raio da câmera pela espessura da casca;
        // se ele encontra casca intacta, aquele pixel mostra a parede de polpa naquela profundidade
        vec3 wp = - vViewPosition;
        vec3 wn = normalize( vNormal );
        vec3 dp1 = dFdx( wp );
        vec3 dp2 = dFdy( wp );
        vec2 duv1 = dFdx( vAlphaMapUv );
        vec2 duv2 = dFdy( vAlphaMapUv );
        duv1.x -= floor( duv1.x + 0.5 );
        duv2.x -= floor( duv2.x + 0.5 );
        vec3 dp2perp = cross( dp2, wn );
        vec3 dp1perp = cross( wn, dp1 );
        float det = dot( dp1, dp2perp );
        float wallHit = 0.0;
        float wallDepth = 0.0;
        if ( carve < 0.5 && abs( det ) > 1e-12 ) {
          vec3 gu = ( dp2perp * duv1.x + dp1perp * duv2.x ) / det;
          vec3 gv = ( dp2perp * duv1.y + dp1perp * duv2.y ) / det;
          vec3 ray = normalize( wp );
          float tmax = uWall / max( - dot( ray, wn ), 0.08 );
          vec3 slide = ( ray - wn * dot( ray, wn ) ) * tmax;
          vec2 reach = vec2( dot( gu, slide ), dot( gv, slide ) );
          float prev = 0.0;
          for ( int i = 1; i <= 24; i ++ ) {
            float f = float( i ) / 24.0;
            if ( maskG( vAlphaMapUv + reach * f ) >= 0.5 ) {
              float lo = prev;
              float hi = f;
              for ( int k = 0; k < 5; k ++ ) {
                float m = 0.5 * ( lo + hi );
                if ( maskG( vAlphaMapUv + reach * m ) >= 0.5 ) hi = m; else lo = m;
              }
              wallHit = 1.0;
              wallDepth = hi;
              break;
            }
            prev = f;
          }
        }
        diffuseColor.a *= max( carve, wallHit );

        float skinSide = 1.0 - wallHit;
        float rim = ( 1.0 - smoothstep( 0.5, 1.0, carve ) ) * skinSide;
        float ink = smoothstep( 0.5, 0.55, carve ) * ( 1.0 - smoothstep( 0.62, 0.72, carve ) ) * skinSide;
        // casca raspada: polpa fina que deixa a vela atravessar
        float shave = ( 1.0 - mk.r ) * skinSide * smoothstep( 0.85, 1.0, carve );
        float shaveLine = smoothstep( 0.2, 0.4, shave ) * ( 1.0 - smoothstep( 0.4, 0.6, shave ) );
        float guide = texture2D( uGuide, vAlphaMapUv ).r * skinSide;
        vec3 wallColor = mix( vec3( 1.0, 0.84, 0.55 ), vec3( 0.95, 0.55, 0.18 ), wallDepth );
        diffuseColor.rgb = mix( diffuseColor.rgb, ${FLESH_SKIN}, rim );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.6, 0.28 ), shave * 0.8 );
        diffuseColor.rgb *= 1.0 - shaveLine * 0.35;
        // pintura por cima da casca; a tinta que brilha no escuro é a de verde bem maior que azul
        vec4 pt = texture2D( uPaint, vAlphaMapUv );
        float paintA = pt.a * skinSide * ( 1.0 - rim );
        float paintGlow = texture2D( uPaintGlow, vAlphaMapUv ).a * paintA;
        diffuseColor.rgb = mix( diffuseColor.rgb, pt.rgb, paintA );
        shave *= 1.0 - paintA;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.01, 0.006, 0.002 ), ink );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.95, 0.8 ), guide );
        diffuseColor.rgb = mix( diffuseColor.rgb, wallColor * 0.65, wallHit );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 0.9, 0.5, 0.14 ) * rim * ( 1.0 - ink ) * uGlow * 0.7 + vec3( 1.0, 0.85, 0.55 ) * guide * 0.6;
        totalEmissiveRadiance += vec3( 0.85, 0.38, 0.08 ) * shave * uGlow * 0.3;
        totalEmissiveRadiance += wallColor * wallHit * ( 0.2 + 0.35 * wallDepth ) * uGlow;
        // brilho igualado pela luminância: verde-limão não estoura em branco e azul/roxo não somem
        float glowLum = dot( pt.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        // um tiquinho de cor própria: sob a luz quente, azul e roxo viravam cinza
        totalEmissiveRadiance += pt.rgb * paintA * 0.2 * ( 1.0 - 0.75 * uDark );
        totalEmissiveRadiance += pt.rgb * clamp( 0.3 / max( glowLum, 0.01 ), 0.45, 1.5 ) * paintGlow * ( 0.6 + 0.45 * uDark );`,
      )
  }

  // parede interna: frente = polpa (espessura do corte), verso = interior iluminado pela vela
  const flesh = new THREE.MeshStandardMaterial({
    color: '#d9661a',
    roughness: 0.9,
    side: THREE.DoubleSide,
    alphaMap: carver.texture,
    alphaTest: 0.5,
  })
  flesh.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow
    shader.uniforms.uLid = lidOpen
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGlow;\n${LID_GLSL}`)
      .replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g * ( 1.0 - lidCut( vAlphaMapUv ) );')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if ( gl_FrontFacing ) diffuseColor.rgb = vec3( 1.0, 0.78, 0.42 );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += ( gl_FrontFacing ? vec3( 0.3, 0.13, 0.03 ) : vec3( 0.75, 0.24, 0.03 ) * 0.3 ) * uGlow;`,
      )
  }

  // sombra da vela: os furos e o topo sem tampa deixam a luz passar
  const distance = new THREE.MeshDistanceMaterial({ alphaMap: carver.texture, alphaTest: 0.5 })
  distance.onBeforeCompile = (shader) => {
    shader.uniforms.uLid = lidOpen
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LID_GLSL}`)
      .replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g * ( 1.0 - lidCut( vAlphaMapUv ) );')
  }

  outer.material = skin
  outer.receiveShadow = false
  outer.customDistanceMaterial = distance
  const inner = new THREE.Mesh(outer.geometry, flesh)
  inner.scale.setScalar(WALL)
  inner.castShadow = true
  inner.customDistanceMaterial = distance

  const bottom = -(SQUASH - 0.2) * RADIUS * WALL
  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.09, 24),
    new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6, emissive: '#ffb060', emissiveIntensity: 0.4 }),
  )
  wax.position.y = bottom + 0.045
  const flame = createFlame(7, 0.2, FX)
  flame.group.position.y = bottom + 0.09

  const light = new THREE.PointLight('#ff9b3d', 5, 0, 2)
  light.position.y = bottom + 0.3
  light.castShadow = true
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.bias = -0.004
  light.shadow.normalBias = 0.02
  light.shadow.camera.near = 0.05
  light.shadow.camera.far = 9
  light.shadow.radius = 2.5

  // tampa: fica escondida (a casca inteira desenha o topo) até ser aberta
  const parts = lidGeometry(outer.geometry)
  const lid = new THREE.Group()
  const lidMeshes = [
    new THREE.Mesh(parts.lid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48 })),
    new THREE.Mesh(parts.lid, new THREE.MeshStandardMaterial({ color: '#e88a2c', roughness: 0.9, side: THREE.BackSide })),
    new THREE.Mesh(parts.rim, new THREE.MeshStandardMaterial({ color: '#ffd08a', roughness: 0.85, side: THREE.DoubleSide })),
  ]
  lidMeshes[1].scale.setScalar(WALL)
  for (const m of lidMeshes) {
    m.visible = false
    m.castShadow = true
  }
  lid.add(...lidMeshes)

  // talo, gavinha, folha e acessórios vivem num grupo que sobe/desce com o topo de cada formato
  const crown = new THREE.Group()
  lid.add(crown)
  for (const name of ['PumpkinStem', 'PumpkinVine', 'PumpkinLeaf']) {
    const o = outer.getObjectByName(name)
    if (o) crown.add(o)
  }
  const accessories = new Map<string, THREE.Object3D>()
  // chapéus: raio da copa onde a aba encosta na casca (mesmas medidas de blender/accessories.py)
  const HAT_RADIUS: Record<string, number> = { AccWitch: 0.56, AccTopHat: 0.4 }
  // altura visível de cada chapéu acima da aba (para a câmera enquadrar)
  const HAT_HEIGHT: Record<string, number> = { AccWitch: 1.25, AccTopHat: 1.05 }
  const hats: { o: THREE.Object3D; radius: number; baseY: number; seats: number[] }[] = []
  for (const name of ['AccWitch', 'AccTopHat', 'AccBow', 'AccHorns']) {
    const o = outer.getObjectByName(name)
    if (!o) continue
    o.visible = false
    o.traverse((c) => (c.castShadow = true))
    accessories.set(name, o)
    if (HAT_RADIUS[name]) {
      lid.add(o)
      hats.push({ o, radius: HAT_RADIUS[name], baseY: o.position.y, seats: [] })
    } else crown.add(o)
  }
  const decor = ['PumpkinVine', 'PumpkinLeaf'].map((n) => crown.getObjectByName(n)).filter(Boolean) as THREE.Object3D[]

  outer.add(inner, wax, flame.group, light, lid)

  // ---------- formatos (morph targets exportados do Blender) ----------
  const geo = outer.geometry
  const morphs = geo.morphAttributes.position ?? []
  const names = Object.keys(outer.morphTargetDictionary ?? {})
  const uv = geo.getAttribute('uv')
  const pos = geo.getAttribute('position')
  let pole = 0
  for (let i = 0; i < uv.count; i++) if (uv.getY(i) > uv.getY(pole)) pole = i
  const ring: number[] = []
  for (let i = 0; i < uv.count; i++) if (Math.abs(uv.getY(i) - 0.82) < 0.006) ring.push(i)
  const radiusOf = (i: number, m?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
    Math.hypot(pos.getX(i) + (m?.getX(i) ?? 0), pos.getZ(i) + (m?.getZ(i) ?? 0))
  const baseRing = ring.reduce((s, i) => s + radiusOf(i), 0) / ring.length
  // por formato: quanto o topo sobe, quanto a borda da tampa sobe e a largura do topo
  const shapeInfo = morphs.map((m) => ({
    lift: m.getY(pole),
    edge: ring.reduce((s, i) => s + m.getY(i), 0) / ring.length,
    width: ring.reduce((s, i) => s + radiusOf(i, m), 0) / ring.length / baseRing,
  }))
  // assento de cada chapéu em cada formato: ponto mais alto da casca sob a copa (já na escala do formato)
  const widths = [1, ...shapeInfo.map((i) => i.width)]
  for (const hat of hats) {
    hat.seats = [null, ...morphs].map((m, k) => {
      const r = hat.radius * widths[k]
      let top = -Infinity
      for (let i = 0; i < pos.count; i++) {
        const rho = radiusOf(i, m ?? undefined)
        if (rho > r - 0.06 && rho < r + 0.02) top = Math.max(top, pos.getY(i) + (m?.getY(i) ?? 0))
      }
      return top
    })
  }
  // caixas por formato (base + cada morph) para as sementes não entrarem na abóbora
  const boxes = [null, ...morphs].map((m) => {
    const b = new THREE.Box3()
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i += 7) {
      v.set(pos.getX(i) + (m?.getX(i) ?? 0), pos.getY(i) + (m?.getY(i) ?? 0), pos.getZ(i) + (m?.getZ(i) ?? 0))
      b.expandByPoint(v)
    }
    return b
  })
  const weights = morphs.map(() => 0)
  const targets = morphs.map(() => 0)
  const morphed = [outer, inner, lidMeshes[0], lidMeshes[1], lidMeshes[2]]
  let squish = -1
  let pop: { o: THREE.Object3D; t: number } | null = null

  // animação da tampa: sobe, faz um arco e pousa na mesa ao lado (e volta)
  const rest = new THREE.Vector3(-1.45, 0, -1.15)
  const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, -0.7, 0.05))
  const scratch = new THREE.Vector3()
  let anim: { t: number; p0: THREE.Vector3; q0: THREE.Quaternion; p1: THREE.Vector3; q1: THREE.Quaternion; opening: boolean } | null =
    null
  let open = false
  const mix = (f: (s: (typeof shapeInfo)[number]) => number) => shapeInfo.reduce((s, info, k) => s + weights[k] * f(info), 0)

  return {
    outer,
    flame,
    light,
    baseLight: light.position.clone(),
    shapes: ['Redonda', ...names],
    get lidOpen() {
      return open
    },
    /** troca o formato (o nome vem dos shape keys do Blender; 'Redonda' é a base) */
    setShape(name: string) {
      targets.fill(0)
      const k = names.indexOf(name)
      if (k >= 0) targets[k] = 1
      squish = 0
    },
    /** mostra um acessório (ou nenhum) */
    setAccessory(name: string | null) {
      accessories.forEach((o, n) => (o.visible = n === name))
      const hat = name === 'AccWitch' || name === 'AccTopHat'
      decor.forEach((o) => (o.visible = !hat))
      const o = name ? accessories.get(name) : undefined
      pop = o ? { o, t: 0 } : null
    },
    /** altura do ponto mais alto (abóbora + chapéu visível), em coordenadas do mundo */
    top() {
      const c = this.collider({ center: new THREE.Vector3(), radius: 0, height: 0 })
      let top = c.center.y + c.height
      if (!open) {
        for (const hat of hats) {
          if (!hat.o.visible) continue
          const name = [...accessories].find(([, o]) => o === hat.o)![0]
          top = Math.max(top, outer.position.y + hat.o.position.y + HAT_HEIGHT[name] * hat.o.scale.x)
        }
      }
      return top
    },
    /** elipsoide aproximado do formato atual, em coordenadas do mundo */
    collider(out: { center: THREE.Vector3; radius: number; height: number }) {
      const b = new THREE.Box3().copy(boxes[0])
      const lerpBox = (k: number, w: number) => {
        b.min.lerp(boxes[k + 1].min, w)
        b.max.lerp(boxes[k + 1].max, w)
      }
      weights.forEach((w, k) => w > 0 && lerpBox(k, w))
      b.getCenter(out.center)
      out.center.add(outer.position)
      out.radius = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2
      out.height = (b.max.y - b.min.y) / 2
      return out
    },
    toggleLid(scene: THREE.Scene) {
      if (anim) return
      const p0 = new THREE.Vector3()
      const q0 = new THREE.Quaternion()
      lid.matrixWorld.decompose(p0, q0, scratch)
      if (!open) {
        scene.attach(lid)
        lidOpen.value = 1
        for (const m of lidMeshes) m.visible = true
        const p1 = rest.clone()
        p1.y = -(parts.bottom + mix((s) => s.edge)) + 0.004
        anim = { t: 0, p0, q0, p1, q1: restQ.clone(), opening: true }
      } else {
        outer.updateMatrixWorld()
        const p1 = new THREE.Vector3()
        const q1 = new THREE.Quaternion()
        outer.matrixWorld.decompose(p1, q1, scratch)
        anim = { t: 0, p0, q0, p1, q1, opening: false }
      }
      open = !open
    },
    update(dt: number) {
      // formatos: aproxima os pesos do alvo e aplica em tudo que compartilha a malha
      const ease = 1 - Math.exp(-dt * 7)
      weights.forEach((w, k) => (weights[k] = w + (targets[k] - w) * ease))
      for (const m of morphed) if (m.morphTargetInfluences) weights.forEach((w, k) => (m.morphTargetInfluences![k] = w))
      let popScale = 1
      if (pop) {
        pop.t += dt
        const t = Math.min(1, pop.t / 0.45)
        popScale = 1 + Math.sin(t * Math.PI) * 0.25 * (1 - t) + (t < 0.2 ? t / 0.2 - 1 : 0)
        if (!hats.some((h) => h.o === pop!.o)) pop.o.scale.setScalar(popScale)
        if (t >= 1) {
          if (!hats.some((h) => h.o === pop!.o)) pop.o.scale.setScalar(1)
          pop = null
          popScale = 1
        }
      }
      crown.position.y = mix((s) => s.lift)
      const width = 1 + mix((s) => s.width - 1)
      crown.scale.set(width, 1, width)
      for (const hat of hats) {
        hat.o.position.y = hat.baseY + hat.seats[0] + weights.reduce((acc, w, k) => acc + w * (hat.seats[k + 1] - hat.seats[0]), 0)
        hat.o.scale.setScalar(width * (pop?.o === hat.o ? popScale : 1))
      }
      if (squish >= 0) {
        squish += dt
        const k = Math.max(0, 1 - squish / 0.7)
        const s = Math.sin(squish * 18) * 0.06 * k
        if (!anim) outer.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6)
        if (squish > 0.7) {
          squish = -1
          outer.scale.set(1, 1, 1)
        }
      }

      if (!anim) return
      anim.t = Math.min(1, anim.t + dt / 1.4)
      const k = anim.t < 0.5 ? 4 * anim.t ** 3 : 1 - (-2 * anim.t + 2) ** 3 / 2
      lid.position.lerpVectors(anim.p0, anim.p1, k)
      lid.position.y += Math.sin(Math.PI * k) * 0.8
      lid.quaternion.slerpQuaternions(anim.q0, anim.q1, k)
      if (anim.t < 1) return
      if (!anim.opening) {
        outer.attach(lid)
        lid.position.set(0, 0, 0)
        lid.quaternion.identity()
        lid.scale.set(1, 1, 1)
        lidOpen.value = 0
        for (const m of lidMeshes) m.visible = false
      }
      anim = null
    },
  }
}
