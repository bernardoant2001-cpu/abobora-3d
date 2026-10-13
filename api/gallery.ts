import { list, put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'

// GET  /api/gallery → abóboras aprovadas (mais recentes primeiro)
// POST /api/gallery → envia uma abóbora; ela entra na fila e só aparece depois de aprovada em /admin.html

const SHAPES = ['Redonda', 'Alta', 'Achatada', 'Cabaca']
const ACCESSORIES = ['AccWitch', 'AccTopHat', 'AccBow', 'AccHorns']
const MAX_MASK = 700_000
const MAX_THUMB = 260_000
const MAX_PENDING = 150
const MAX_BODY = 1_400_000

export type Entry = {
  id: string
  name: string
  shape: string
  accessory: string | null
  createdAt: string
  mask: string
  thumb: string
}

// palavras longas bloqueiam em qualquer parte do nome; curtas só como palavra inteira (evita barrar "Lucas", "Cunha"...)
const BLOCK_ANYWHERE = [
  'porra', 'caralh', 'buceta', 'boceta', 'xoxota', 'piroca', 'arromb', 'vagabund', 'cacete', 'merda', 'bosta',
  'puta', 'viado', 'retardad', 'macaco', 'estupr', 'pedofil', 'hitler', 'nazis', 'fuck', 'shit', 'bitch',
  'cunt', 'nigg', 'fagg', 'whore', 'slut', 'porn',
]
const BLOCK_WORD = ['cu', 'fdp', 'pqp', 'vsf', 'tnc', 'puto', 'rola', 'pinto', 'xota', 'foda', 'corno', 'bicha', 'dick', 'sex', 'rape', 'nazi', 'kkk']

function cleanName(raw: unknown) {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (name.length < 1 || name.length > 24) return null
  if (!/^[\p{L}\p{N} .'_-]+$/u.test(name)) return null
  const plain = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
  const squashed = plain.replace(/[^a-z]/g, '')
  if (BLOCK_ANYWHERE.some((w) => squashed.includes(w))) return null
  const words = plain.split(/[^a-z]+/)
  if (BLOCK_WORD.some((w) => words.includes(w))) return null
  return name
}

function decode(dataUrl: unknown, mime: string, magic: number[], max: number) {
  const prefix = `data:${mime};base64,`
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return null
  const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  if (buf.length < 100 || buf.length > max) return null
  if (!magic.every((b, i) => buf[i] === b)) return null
  return buf
}

/**
 * Só aceita JSON vindo do próprio site: o Content-Type obriga o navegador a pedir permissão (preflight)
 * para chamadas de outros sites, e a origem, quando enviada, precisa ser a mesma do servidor.
 */
export function sameSiteJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

// limite simples por instância; a fila de aprovação é a proteção de verdade
const recent = new Map<string, number[]>()
function rateLimited(ip: string) {
  const now = Date.now()
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000)
  hits.push(now)
  recent.set(ip, hits)
  return hits.length > 5
}

export async function readEntries(prefix: string, limit = 200): Promise<Entry[]> {
  const { blobs } = await list({ prefix, limit: 1000 })
  const newest = blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)).slice(0, limit)
  const entries = await Promise.all(
    newest.map((b) =>
      fetch(b.url, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<Entry>) : null))
        .catch(() => null),
    ),
  )
  return entries.filter((e): e is Entry => !!e)
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

export async function GET() {
  const entries = await readEntries('approved/')
  return json(entries, 200, { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' })
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconhecido'
  if (!sameSiteJson(request)) return json({ error: 'Envio inválido.' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Envio grande demais.' }, 413)
  if (rateLimited(ip)) return json({ error: 'Muitos envios seguidos. Tenta de novo daqui a pouco.' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Envio inválido.' }, 400)
  }
  // campo invisível: só robôs preenchem
  if (body.website) return json({ ok: true })

  const name = cleanName(body.name)
  if (!name) return json({ error: 'Esse nome não pode ser usado. Use até 24 letras, números ou espaços.' }, 400)
  const shape = SHAPES.includes(body.shape as string) ? (body.shape as string) : null
  const accessory = body.accessory == null ? null : ACCESSORIES.includes(body.accessory as string) ? (body.accessory as string) : undefined
  if (!shape || accessory === undefined) return json({ error: 'Envio inválido.' }, 400)
  const mask = decode(body.mask, 'image/png', [0x89, 0x50, 0x4e, 0x47], MAX_MASK)
  const thumb = decode(body.thumb, 'image/jpeg', [0xff, 0xd8, 0xff], MAX_THUMB)
  if (!mask || !thumb) return json({ error: 'Envio inválido.' }, 400)

  const { blobs: pending } = await list({ prefix: 'pending/', limit: MAX_PENDING + 1 })
  if (pending.length > MAX_PENDING) return json({ error: 'A fila da exposição está cheia. Tenta de novo mais tarde.' }, 503)

  const id = randomBytes(10).toString('hex')
  const opts = { access: 'public' as const, addRandomSuffix: false }
  const [maskBlob, thumbBlob] = await Promise.all([
    put(`media/${id}-mask.png`, mask, { ...opts, contentType: 'image/png' }),
    put(`media/${id}-thumb.jpg`, thumb, { ...opts, contentType: 'image/jpeg' }),
  ])
  const entry: Entry = { id, name, shape, accessory, createdAt: new Date().toISOString(), mask: maskBlob.url, thumb: thumbBlob.url }
  await put(`pending/${id}.json`, JSON.stringify(entry), { ...opts, contentType: 'application/json', cacheControlMaxAge: 60 })
  return json({ ok: true }, 201)
}
