import { list, put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'

// GET  /api/gallery → abóboras aprovadas (mais recentes primeiro), com o número de curtidas
// GET  /api/gallery?id=… → uma abóbora aprovada (usada pelo link próprio /a/<id>)
// POST /api/gallery → envia uma abóbora; ela entra direto na exposição (dá pra tirar em /admin.html)

const SHAPES = ['Redonda', 'Alta', 'Achatada', 'Cabaca']
const ACCESSORIES = ['AccWitch', 'AccTopHat', 'AccBow', 'AccHorns']
const MAX_MASK = 700_000
const MAX_THUMB = 260_000
const MAX_PAINT = 800_000
const MAX_PER_HOUR = 60
const MAX_BODY = 2_500_000

export type Entry = {
  id: string
  name: string
  shape: string
  accessory: string | null
  createdAt: string
  mask: string
  thumb: string
  /** camada de pintura (PNG transparente), quando a pessoa pintou */
  paint?: string
  likes?: number
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

export const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconhecido'

// limite simples por instância; o teto por hora no POST segura enxurrada vinda de vários lugares
const recent = new Map<string, number[]>()
export function rateLimited(key: string, max = 5, windowMs = 10 * 60_000) {
  const now = Date.now()
  const hits = (recent.get(key) ?? []).filter((t) => now - t < windowMs)
  hits.push(now)
  recent.set(key, hits)
  return hits.length > max
}

export const isId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{20}$/.test(id)

/** curtidas por abóbora: cada voto é um arquivo vazio likes/<id>/<voto> */
export async function likeCounts(onlyId?: string) {
  const counts = new Map<string, number>()
  let cursor: string | undefined
  do {
    const page = await list({ prefix: onlyId ? `likes/${onlyId}/` : 'likes/', limit: 1000, cursor })
    for (const b of page.blobs) {
      const id = b.pathname.split('/')[1]
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return counts
}

export async function readEntry(prefix: string, id: string): Promise<Entry | null> {
  if (!isId(id)) return null
  const { blobs } = await list({ prefix: `${prefix}${id}.json`, limit: 1 })
  if (!blobs[0]) return null
  return fetch(blobs[0].url, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Entry>) : null))
    .catch(() => null)
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

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

export async function GET(request: Request) {
  const cache = { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' }
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    const [entry, counts] = await Promise.all([readEntry('approved/', id), likeCounts(isId(id) ? id : undefined)])
    if (!entry) return json({ error: 'Essa abóbora não está na exposição.' }, 404)
    return json({ ...entry, likes: counts.get(entry.id) ?? 0 }, 200, cache)
  }
  const [entries, counts] = await Promise.all([readEntries('approved/'), likeCounts()])
  return json(entries.map((e) => ({ ...e, likes: counts.get(e.id) ?? 0 })), 200, cache)
}

export async function POST(request: Request) {
  const ip = clientIp(request)
  if (!sameSiteJson(request)) return json({ error: 'Envio inválido.' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Envio grande demais.' }, 413)
  if (rateLimited(`send:${ip}`)) return json({ error: 'Muitos envios seguidos. Tenta de novo daqui a pouco.' }, 429)

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
  const paint = body.paint == null ? null : decode(body.paint, 'image/png', [0x89, 0x50, 0x4e, 0x47], MAX_PAINT)
  if (body.paint != null && !paint) return json({ error: 'Envio inválido.' }, 400)

  // sem aprovação manual: se chegar abóbora demais de uma vez, segura até a próxima hora
  // ponytail: olha só as 1000 primeiras da lista; passando disso, guardar a contagem por hora num blob próprio
  const { blobs: recent } = await list({ prefix: 'approved/', limit: 1000 })
  const hourAgo = Date.now() - 3600_000
  if (recent.filter((b) => +new Date(b.uploadedAt) > hourAgo).length >= MAX_PER_HOUR)
    return json({ error: 'A exposição recebeu muitas abóboras agora. Tenta de novo daqui a pouco.' }, 503)

  const id = randomBytes(10).toString('hex')
  const opts = { access: 'public' as const, addRandomSuffix: false }
  const [maskBlob, thumbBlob, paintBlob] = await Promise.all([
    put(`media/${id}-mask.png`, mask, { ...opts, contentType: 'image/png' }),
    put(`media/${id}-thumb.jpg`, thumb, { ...opts, contentType: 'image/jpeg' }),
    paint ? put(`media/${id}-paint.png`, paint, { ...opts, contentType: 'image/png' }) : null,
  ])
  const entry: Entry = { id, name, shape, accessory, createdAt: new Date().toISOString(), mask: maskBlob.url, thumb: thumbBlob.url }
  if (paintBlob) entry.paint = paintBlob.url
  await put(`approved/${id}.json`, JSON.stringify(entry), { ...opts, contentType: 'application/json', cacheControlMaxAge: 60 })
  await notify(entry, new URL(request.url).origin)
  return json({ ok: true, id, entry }, 201)
}

/** avisa no celular (app ntfy, tópico secreto em NTFY_TOPIC) que entrou abóbora nova na exposição; nunca derruba o envio */
async function notify(entry: Entry, origin: string) {
  const topic = process.env.NTFY_TOPIC
  if (!topic) return
  await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title: 'Abóbora nova na exposição 🎃',
      message: `${entry.name} colocou uma abóbora na exposição. Toque para revisar.`,
      click: `${origin}/admin.html`,
      attach: entry.thumb,
      filename: 'abobora.jpg',
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}
