export type Pt = [number, number]

export interface Pen {
  carve(pts: Pt[]): void
  keep(pts: Pt[]): void
}

export interface Stencil {
  id: string
  name: string
  draw(pen: Pen): void
}

// unidades = comprimento de arco na superfície, (0,0) no centro da face
const mirror = (pts: Pt[]): Pt[] => pts.map(([a, b]) => [-a, b])

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 48): Pt[] {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    const x = Math.cos(t) * rx
    const y = Math.sin(t) * ry
    return [cx + x * c - y * s, cy + x * s + y * c]
  })
}

function mouth(w: number, top: (t: number) => number, bottom: (t: number) => number, n = 160): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) pts.push([(-1 + (2 * i) / n) * w, top(-1 + (2 * i) / n)])
  for (let i = n; i >= 0; i--) pts.push([(-1 + (2 * i) / n) * w, bottom(-1 + (2 * i) / n)])
  return pts
}

const box = (t: number, c: number, w: number) => (Math.abs(t - c) < w ? 1 : 0)
const spike = (t: number, c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w)
const saw = (x: number) => 1 - Math.abs(((x % 1) + 1) % 1 * 2 - 1)

export const STENCILS: Stencil[] = [
  {
    id: 'classica',
    name: 'Clássica',
    draw({ carve }) {
      const eye: Pt[] = [[-0.58, 0.12], [-0.14, 0.12], [-0.36, 0.48]]
      carve(eye)
      carve(mirror(eye))
      carve([[-0.1, -0.04], [0.1, -0.04], [0, 0.12]])
      carve(
        mouth(
          0.68,
          (t) => -0.2 + 0.14 * t * t - 0.11 * (box(t, -0.32, 0.09) + box(t, 0.32, 0.09)),
          (t) => -0.2 + 0.14 * t * t - 0.3 * (1 - t * t) + 0.11 * box(t, 0, 0.1),
        ),
      )
    },
  },
  {
    id: 'malvada',
    name: 'Malvada',
    draw({ carve }) {
      const eye: Pt[] = [[-0.62, 0.4], [-0.12, 0.2], [-0.46, 0.06]]
      carve(eye)
      carve(mirror(eye))
      carve([[-0.07, 0.03], [0.07, 0.03], [0, -0.07]])
      carve(
        mouth(
          0.72,
          (t) => -0.14 + 0.2 * t * t - 0.09 * saw((t + 1) * 4) * (1 - t ** 4),
          (t) => -0.14 + 0.2 * t * t - 0.36 * (1 - t * t) ** 0.8 + 0.09 * saw((t + 1) * 4 + 0.5) * (1 - t ** 4),
        ),
      )
    },
  },
  {
    id: 'fofa',
    name: 'Fofinha',
    draw({ carve, keep }) {
      carve(ellipse(-0.32, 0.24, 0.15, 0.19))
      carve(ellipse(0.32, 0.24, 0.15, 0.19))
      keep(ellipse(-0.27, 0.31, 0.05, 0.06))
      keep(ellipse(0.37, 0.31, 0.05, 0.06))
      carve(ellipse(0, 0.02, 0.06, 0.04))
      carve(
        mouth(
          0.36,
          (t) => -0.1 - 0.16 * (1 - t * t),
          (t) => -0.1 - 0.16 * (1 - t * t) - 0.1 * Math.sqrt(1 - t * t),
        ),
      )
    },
  },
  {
    id: 'vampiro',
    name: 'Vampiro',
    draw({ carve }) {
      carve(ellipse(-0.32, 0.22, 0.17, 0.09, -0.35))
      carve(ellipse(0.32, 0.22, 0.17, 0.09, 0.35))
      const brow: Pt[] = [[-0.56, 0.44], [-0.12, 0.33], [-0.12, 0.38], [-0.54, 0.5]]
      carve(brow)
      carve(mirror(brow))
      carve(
        mouth(
          0.6,
          (t) => -0.18 + 0.1 * t * t - 0.12 * (spike(t, -0.42, 0.12) + spike(t, 0.42, 0.12)),
          (t) => -0.18 + 0.1 * t * t - 0.2 * (1 - t * t) ** 0.7,
        ),
      )
    },
  },
]

export function thumbnail(s: Stencil, size = 88) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const k = size * 0.6
  const disc = g.createRadialGradient(size * 0.4, size * 0.35, 0, size / 2, size / 2, size / 2)
  disc.addColorStop(0, '#ff9a3a')
  disc.addColorStop(1, '#c2410c')
  const path = (pts: Pt[], color: string) => {
    g.fillStyle = color
    g.beginPath()
    for (const [a, b] of pts) g.lineTo(size / 2 + a * k, size * 0.5 - b * k)
    g.closePath()
    g.fill()
  }
  g.fillStyle = disc
  g.beginPath()
  g.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2)
  g.fill()
  g.shadowColor = '#ffcc66'
  g.shadowBlur = 6
  s.draw({ carve: (p) => path(p, '#ffe08a'), keep: (p) => path(p, '#e86a1c') })
  return c
}
