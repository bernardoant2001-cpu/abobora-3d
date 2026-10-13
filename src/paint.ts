import * as THREE from 'three'
import { nextStep, scale } from './pumpkin'

// camada de pintura por cima da casca (mesmo UV da escultura, metade da resolução)
const W = 1024
const H = 512
const K = 0.5 // pixels desta camada por pixel da máscara de escultura

export type Ink = 'ink' | 'cream' | 'glow' | 'erase'

// a tinta que brilha no escuro é reconhecida no shader pela cor (verde bem maior que azul)
const COLORS: Record<Exclude<Ink, 'erase'>, [number, number, number]> = {
  ink: [14, 8, 4],
  cream: [240, 226, 190],
  glow: [190, 255, 120],
}

type Drip = { x: number; y: number; len: number; target: number; w: number; speed: number }

export class Painter {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  dirty = false
  private ctx: CanvasRenderingContext2D
  private snap = document.createElement('canvas')
  private snapCtx: CanvasRenderingContext2D
  private history: { t: number; x: number; y: number; data: ImageData }[] = []
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private last: [number, number] | null = null
  private drips: Drip[] = []
  private brushes = new Map<Ink, CanvasGradient>()
  private used = false

  constructor() {
    this.canvas.width = this.snap.width = W
    this.canvas.height = this.snap.height = H
    this.ctx = this.canvas.getContext('2d')!
    this.snapCtx = this.snap.getContext('2d', { willReadFrequently: true })!
    for (const ink of ['ink', 'cream', 'glow', 'erase'] as Ink[]) {
      const [r, g, b] = ink === 'erase' ? [0, 0, 0] : COLORS[ink]
      const grad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
      grad.addColorStop(0.62, `rgba(${r},${g},${b},1)`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      this.brushes.set(ink, grad)
    }
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.wrapS = THREE.RepeatWrapping
  }

  get lastStep() {
    return this.history.at(-1)?.t ?? 0
  }

  get hasPaint() {
    return this.used
  }

  begin() {
    this.snapCtx.clearRect(0, 0, W, H)
    this.snapCtx.drawImage(this.canvas, 0, 0)
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
    this.history.push({ t: nextStep(), x, y, data: this.snapCtx.getImageData(x, y, w, h) })
    if (this.history.length > 40) this.history.shift()
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

  /** escorre as gotas de tinta preta aos poucos, descendo pela casca */
  update(dt: number) {
    if (!this.drips.length) return
    const ctx = this.ctx
    ctx.strokeStyle = ctx.fillStyle = `rgb(${COLORS.ink.join(',')})`
    ctx.lineCap = 'round'
    for (const d of this.drips) {
      const slow = 1 - (d.len / d.target) * 0.8
      const grow = Math.min(d.target - d.len, d.speed * slow * dt)
      if (grow <= 0) continue
      ctx.lineWidth = d.w
      for (const ox of [0, -W, W]) {
        ctx.beginPath()
        ctx.moveTo(d.x + ox, d.y + d.len)
        ctx.lineTo(d.x + ox, d.y + d.len + grow)
        ctx.stroke()
      }
      d.len += grow
      if (d.target - d.len < 0.5) {
        for (const ox of [0, -W, W]) {
          ctx.beginPath()
          ctx.arc(d.x + ox, d.y + d.len, d.w * 0.8, 0, Math.PI * 2)
          ctx.fill()
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
    this.ctx.putImageData(step.data, step.x, step.y)
    this.dirty = true
  }

  clear() {
    if (!this.used) return
    this.begin()
    this.ctx.clearRect(0, 0, W, H)
    this.box = [0, 0, W, H]
    this.end()
    this.drips = []
    this.used = false
    this.dirty = true
  }

  /** pintura em PNG transparente para a exposição (null se não pintou nada) */
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
    return any ? this.canvas.toDataURL('image/png') : null
  }

  save() {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    c.getContext('2d')!.drawImage(this.canvas, 0, 0)
    return { canvas: c, used: this.used }
  }

  restore(saved: { canvas: CanvasImageSource; used: boolean } | null) {
    this.drips = []
    this.ctx.clearRect(0, 0, W, H)
    if (saved) this.ctx.drawImage(saved.canvas, 0, 0, W, H)
    this.used = !!saved?.used
    this.dirty = true
  }

  private stamp(x: number, y: number, rx: number, ry: number, ink: Ink) {
    const ctx = this.ctx
    ctx.fillStyle = this.brushes.get(ink)!
    ctx.globalCompositeOperation = ink === 'erase' ? 'destination-out' : 'source-over'
    for (const ox of [0, -W, W]) {
      const cx = x + ox
      if (cx + rx < 0 || cx - rx > W) continue
      ctx.setTransform(rx, 0, 0, ry, cx, y)
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      this.grow(cx - rx, y - ry, cx + rx, y + ry)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    if (ink !== 'erase') this.used = true
    // tinta preta escorre de vez em quando
    if (ink === 'ink' && this.drips.length < 24 && Math.random() < 0.09) {
      const d: Drip = {
        x: x + (Math.random() * 2 - 1) * rx * 0.5,
        y: y + ry * 0.35,
        len: 0,
        target: ry * (1.2 + Math.random() * 3.5),
        w: Math.max(2, rx * (0.16 + Math.random() * 0.14)),
        speed: 30 + Math.random() * 40,
      }
      this.drips.push(d)
      this.grow(d.x - d.w * 2, d.y, d.x + d.w * 2, d.y + d.target + d.w * 2)
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
