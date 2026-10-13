import type { Pt } from './stencils'

// formas prontas: contornos de raio ~1 com o "topo" apontando para +y (é ele que segue o arrasto)
export type Shape = { id: string; name: string; pts: Pt[] }

const ring = (n: number, r: (i: number, t: number) => number, start = Math.PI / 2): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const t = start + (i / n) * Math.PI * 2
    const k = r(i, t)
    return [Math.cos(t) * k, Math.sin(t) * k]
  })

const arc = (cx: number, cy: number, r: number, from: number, to: number, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = ((from + ((to - from) * i) / n) * Math.PI) / 180
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]
  })

const mirror = (right: Pt[]): Pt[] => [...right, ...right.slice(0, -1).reverse().slice(0, -1).map(([x, y]): Pt => [-x, y])]

const heart = (): Pt[] => {
  const pts = Array.from({ length: 64 }, (_, i): Pt => {
    const t = (i / 64) * Math.PI * 2
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]
  })
  return pts.map(([x, y]) => [x / 16.5, (y + 2.5) / 15])
}

export const SHAPES: Shape[] = [
  { id: 'circulo', name: 'Círculo', pts: ring(48, () => 1) },
  { id: 'triangulo', name: 'Triângulo', pts: [[0, 1.05], [0.95, -0.6], [-0.95, -0.6]] },
  { id: 'losango', name: 'Losango', pts: [[0, 1.05], [0.65, 0], [0, -1.05], [-0.65, 0]] },
  { id: 'estrela', name: 'Estrela', pts: ring(10, (i) => (i % 2 ? 0.45 : 1.08)) },
  { id: 'coracao', name: 'Coração', pts: heart() },
  { id: 'lua', name: 'Lua', pts: [...arc(0, 0, 1, 50, 310, 30), ...arc(0.5, 0, 0.85, 280, 80, 26)] },
  {
    id: 'raio',
    name: 'Raio',
    pts: [[-0.2, 1.05], [0.48, 1.05], [0.1, 0.25], [0.58, 0.25], [-0.38, -1.05], [-0.05, -0.1], [-0.52, -0.1]],
  },
  {
    id: 'morcego',
    name: 'Morcego',
    pts: mirror([
      [0, 0.2], [0.11, 0.46], [0.17, 0.2], [0.42, 0.34], [0.76, 0.44], [1.05, 0.12], [0.9, -0.06],
      [0.78, 0.0], [0.66, -0.22], [0.52, -0.12], [0.38, -0.34], [0.2, -0.22], [0.1, -0.44], [0, -0.52],
    ]),
  },
]

/** ícone SVG da forma (os mesmos pontos usados no corte) */
export function shapeIcon(s: Shape) {
  const d = s.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(12 + x * 9).toFixed(2)} ${(12 - y * 9).toFixed(2)}`).join('') + 'Z'
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor" stroke="none"/></svg>`
}
