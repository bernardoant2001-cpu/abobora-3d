import * as THREE from 'three'
import { nextStep, scale } from './pumpkin'

// camada de pintura por cima da casca (mesmo UV da escultura, metade da resolução):
// uma textura com a cor e outra só com onde a tinta brilha no escuro
const W = 1024
const H = 512
const K = 0.5 // pixels desta camada por pixel da máscara de escultura

/** tinta atual: cor em hex, se brilha no escuro, quão rala ela é (0 = grossa, 1 = rala) ou borracha */
export type Ink = { color: string; glow: boolean; flow: number } | 'erase'

type Drip = {
  x: number
  y: number
  len: number
  target: number
  w: number
  speed: number
  color: string
  glow: boolean
  /** deslocamento lateral atual e a "onda" do balanço */
  dx: number
  phase: number
  wobble: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class Painter {
  readonly canvas = document.createElement('canvas')
  readonly glowCanvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  readonly glowTexture: THREE.CanvasTexture
  dirty = false
  private ctx: CanvasRenderingContext2D
  private gctx: CanvasRenderingContext2D
  private snap = document.createElement('canvas')
  private snapGlow = document.createElement('canvas')
  private history: { t: number; x: number; y: number; color: ImageData; glow: ImageData }[] = []
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private last: [number, number] | null = null
  private drips: Drip[] = []
  private brushes = new Map<string, CanvasGradient>()
  private used = false

  constructor() {
    for (const c of [this.canvas, this.glowCanvas, this.snap, this.snapGlow]) {
      c.width = W
      c.height = H
    }
    this.ctx = this.canvas.getContext('2d')!
    this.gctx = this.glowCanvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.wrapS = THREE.RepeatWrapping
    this.glowTexture = new THREE.CanvasTexture(this.glowCanvas)
    this.glowTexture.wrapS = THREE.RepeatWrapping
  }

  get lastStep() {
    return this.history.at(-1)?.t ?? 0
  }

  get hasPaint() {
    return this.used
  }

  begin() {
    const s = this.snap.getContext('2d', { willReadFrequently: true })!
    const g = this.snapGlow.getContext('2d', { willReadFrequently: true })!
    s.clearRect(0, 0, W, H)
    s.drawImage(this.canvas, 0, 0)
    g.clearRect(0, 0, W, H)
    g.drawImage(this.glowCanvas, 0, 0)
    this.box = [Infinity, Infinity, -Infinity, -Infinity]
    this.last = null
  }

  end() {
    this.last = null
    const x = Math.max(0, Math.floor(this.box[0]))
    const y = Math.max(0, Math.floor(this.box[1]))
    const w = Math.min(W, Math.ceil(this.box[2])) - x
    const h = Math.min(H, Math.ceil(this.box[3])) - y
    if (w <= 0 || h <= 0) return
    this.history.push({
      t: nextStep(),
      x,
      y,
      color: this.snap.getContext('2d')!.getImageData(x, y, w, h),
      glow: this.snapGlow.getContext('2d')!.getImageData(x, y, w, h),
    })
    if (this.history.length > 30) this.history.shift()
  }

  lift() {
    this.last = null
  }

  paint(uv: THREE.Vector2, size: number, ink: Ink) {
    const x = uv.x * W
    const y = (1 - uv.y) * H
    const [kx, ky] = scale(uv.y)
    const rx = size * kx * K * 0.8
    const ry = size * ky * K * 0.8
    if (this.last && Math.abs(x - this.last[0]) < W / 2) {
      const [lx, ly] = this.last
      const steps = Math.ceil(Math.hypot((x - lx) / rx, (y - ly) / ry) / 0.25)
      for (let i = 1; i <= steps; i++) this.stamp(lx + ((x - lx) * i) / steps, ly + ((y - ly) * i) / steps, rx, ry, ink)
    } else this.stamp(x, y, rx, ry, ink)
    this.last = [x, y]
  }

  /** escorre as gotas aos poucos, descendo pela casca: começam rápidas, freiam, balançam e terminam numa bolinha */
  update(dt: number) {
    if (!this.drips.length) return
    for (const c of [this.ctx, this.gctx]) c.lineCap = 'round'
    for (const d of this.drips) {
      const slow = 1 - (d.len / d.target) * 0.8
      const grow = Math.min(d.target - d.len, d.speed * slow * dt)
      if (grow <= 0) continue
      // afina conforme desce, como a tinta que vai acabando
      const width = d.w * (1 - 0.35 * (d.len / d.target))
      const nx = d.wobble * d.w * Math.sin(d.phase + (d.len + grow) * 0.12)
      const layers: [CanvasRenderingContext2D, string][] = [[this.ctx, d.color]]
      if (d.glow) layers.push([this.gctx, '#fff'])
      for (const [c, color] of layers) {
        c.strokeStyle = c.fillStyle = color
        c.lineWidth = width
        for (const ox of [0, -W, W]) {
          c.beginPath()
          c.moveTo(d.x + d.dx + ox, d.y + d.len)
          c.lineTo(d.x + nx + ox, d.y + d.len + grow)
          c.stroke()
        }
      }
      d.dx = nx
      d.len += grow
      if (d.target - d.len < 0.5) {
        for (const [c] of layers) {
          for (const ox of [0, -W, W]) {
            c.beginPath()
            c.ellipse(d.x + d.dx + ox, d.y + d.len, d.w * 0.75, d.w * 0.95, 0, 0, Math.PI * 2)
            c.fill()
          }
        }
        d.len = d.target
      }
    }
    this.drips = this.drips.filter((d) => d.len < d.target)
    this.dirty = true
  }

  undo() {
    const step = this.history.pop()
    if (!step) return
    this.drips = []
    this.ctx.putImageData(step.color, step.x, step.y)
    this.gctx.putImageData(step.glow, step.x, step.y)
    this.dirty = true
  }

  clear() {
    if (!this.used) return
    this.begin()
    this.ctx.clearRect(0, 0, W, H)
    this.gctx.clearRect(0, 0, W, H)
    this.box = [0, 0, W, H]
    this.end()
    this.drips = []
    this.used = false
    this.dirty = true
  }

  /** pintura em PNG para a exposição: cor em cima, brilho embaixo (null se não pintou nada) */
  export() {
    if (!this.used) return null
    const probe = document.createElement('canvas')
    probe.width = 64
    probe.height = 32
    const g = probe.getContext('2d', { willReadFrequently: true })!
    g.drawImage(this.canvas, 0, 0, 64, 32)
    const d = g.getImageData(0, 0, 64, 32).data
    let any = false
    for (let i = 3; i < d.length && !any; i += 4) any = d[i] > 8
    if (!any) return null
    const out = document.createElement('canvas')
    out.width = W
    out.height = H * 2
    const o = out.getContext('2d')!
    o.drawImage(this.canvas, 0, 0)
    o.drawImage(this.glowCanvas, 0, H)
    return out.toDataURL('image/png')
  }

  save() {
    const color = document.createElement('canvas')
    const glow = document.createElement('canvas')
    color.width = glow.width = W
    color.height = glow.height = H
    color.getContext('2d')!.drawImage(this.canvas, 0, 0)
    glow.getContext('2d')!.drawImage(this.glowCanvas, 0, 0)
    return { color, glow, used: this.used }
  }

  restore(saved: { color: CanvasImageSource; glow?: CanvasImageSource; used: boolean } | null) {
    this.drips = []
    this.ctx.clearRect(0, 0, W, H)
    this.gctx.clearRect(0, 0, W, H)
    if (saved) {
      this.ctx.drawImage(saved.color, 0, 0, W, H)
      if (saved.glow) this.gctx.drawImage(saved.glow, 0, 0, W, H)
    }
    this.used = !!saved?.used
    this.dirty = true
  }

  /** pintura vinda da exposição: imagem com a cor em cima e o brilho embaixo */
  restoreImage(img: HTMLImageElement) {
    this.drips = []
    this.ctx.clearRect(0, 0, W, H)
    this.gctx.clearRect(0, 0, W, H)
    const half = img.naturalHeight > img.naturalWidth * 0.75
    const h = half ? img.naturalHeight / 2 : img.naturalHeight
    this.ctx.drawImage(img, 0, 0, img.naturalWidth, h, 0, 0, W, H)
    if (half) this.gctx.drawImage(img, 0, h, img.naturalWidth, h, 0, 0, W, H)
    this.used = true
    this.dirty = true
  }

  private brush(color: string) {
    let grad = this.brushes.get(color)
    if (grad) return grad
    // direto do hex: THREE.Color passaria para linear e a textura (sRGB) escureceria de novo
    const n = parseInt(color.slice(1), 16)
    const rgb = `${n >> 16},${(n >> 8) & 255},${n & 255}`
    grad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    grad.addColorStop(0, `rgba(${rgb},1)`)
    grad.addColorStop(0.62, `rgba(${rgb},1)`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    this.brushes.set(color, grad)
    return grad
  }

  private stamp(x: number, y: number, rx: number, ry: number, ink: Ink) {
    const erase = ink === 'erase'
    const ops: [CanvasRenderingContext2D, string | CanvasGradient, GlobalCompositeOperation][] = erase
      ? [
          [this.ctx, this.brush('#000000'), 'destination-out'],
          [this.gctx, this.brush('#000000'), 'destination-out'],
        ]
      : [
          [this.ctx, this.brush(ink.color), 'source-over'],
          // tinta comum por cima de tinta brilhante apaga o brilho dali
          [this.gctx, this.brush(ink.glow ? '#ffffff' : '#000000'), ink.glow ? 'source-over' : 'destination-out'],
        ]
    for (const [c, fill, op] of ops) {
      c.fillStyle = fill
      c.globalCompositeOperation = op
      for (const ox of [0, -W, W]) {
        const cx = x + ox
        if (cx + rx < 0 || cx - rx > W) continue
        c.setTransform(rx, 0, 0, ry, cx, y)
        c.beginPath()
        c.arc(0, 0, 1, 0, Math.PI * 2)
        c.fill()
        this.grow(cx - rx, y - ry, cx + rx, y + ry)
      }
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.globalCompositeOperation = 'source-over'
    }
    if (erase) return void (this.dirty = true)
    this.used = true

    // toda tinta escorre de vez em quando; a rala corre rápido e longe, a grossa devagar e curta
    const f = ink.flow
    if (this.drips.length < 30 && Math.random() < lerp(0.07, 0.09, f)) {
      const d: Drip = {
        x: x + (Math.random() * 2 - 1) * rx * 0.5,
        y: y + ry * 0.35,
        len: 0,
        target: ry * lerp(0.7, 1.2, f) * (1 + Math.random() * lerp(2, 3.9, f) / lerp(0.7, 1.2, f)),
        w: Math.max(2, rx * lerp(0.3, 0.17, f) * (1 + Math.random() * 0.6)),
        speed: lerp(12, 30, f) + Math.random() * lerp(18, 40, f),
        color: ink.color,
        glow: ink.glow,
        dx: 0,
        phase: Math.random() * Math.PI * 2,
        wobble: lerp(0.2, 0.5, f),
      }
      this.drips.push(d)
      const side = d.w * (2 + d.wobble)
      this.grow(d.x - side, d.y, d.x + side, d.y + d.target + d.w * 2)
    }
    this.dirty = true
  }

  private grow(x0: number, y0: number, x1: number, y1: number) {
    this.box[0] = Math.min(this.box[0], x0)
    this.box[1] = Math.min(this.box[1], y0)
    this.box[2] = Math.max(this.box[2], x1)
    this.box[3] = Math.max(this.box[3], y1)
  }
}
