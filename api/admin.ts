import { del, list, rename } from '@vercel/blob'
import { timingSafeEqual } from 'node:crypto'
import { readEntries, sameSiteJson, type Entry } from './gallery.js'

// GET  /api/admin?status=pending|approved → lista para moderar
// POST /api/admin { action: 'approve' | 'reject' | 'remove', id } → aprova, recusa ou tira da exposição
// Sempre com o cabeçalho Authorization: Bearer <ADMIN_TOKEN>

// tentativas erradas por IP: depois de 10 em 15 minutos, recusa tudo até esfriar
const failures = new Map<string, number[]>()

function authorized(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconhecido'
  const now = Date.now()
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < 15 * 60_000)
  if (recent.length >= 10) return false
  const expected = process.env.ADMIN_TOKEN
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const ok = !!expected && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  if (!ok) failures.set(ip, [...recent, now])
  return ok
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

async function find(prefix: string, id: string) {
  const { blobs } = await list({ prefix: `${prefix}${id}.json`, limit: 1 })
  return blobs[0]
}

async function removeAll(entryBlobUrl: string, id: string) {
  const [media, likes] = await Promise.all([list({ prefix: `media/${id}-`, limit: 10 }), list({ prefix: `likes/${id}/`, limit: 1000 })])
  await del([entryBlobUrl, ...media.blobs.map((b) => b.url), ...likes.blobs.map((b) => b.url)])
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: 'Senha inválida.' }, 401)
  const status = new URL(request.url).searchParams.get('status') === 'approved' ? 'approved/' : 'pending/'
  const entries: Entry[] = await readEntries(status, 500)
  return json(entries)
}

export async function POST(request: Request) {
  if (!sameSiteJson(request)) return json({ error: 'Requisição inválida.' }, 403)
  if (!authorized(request)) return json({ error: 'Senha inválida.' }, 401)
  const { action, id } = (await request.json().catch(() => ({}))) as { action?: string; id?: string }
  if (typeof id !== 'string' || !/^[a-f0-9]{20}$/.test(id)) return json({ error: 'ID inválido.' }, 400)

  if (action === 'approve') {
    const blob = await find('pending/', id)
    if (!blob) return json({ error: 'Não encontrada na fila.' }, 404)
    await rename(blob.url, `approved/${id}.json`, { access: 'public', addRandomSuffix: false, contentType: 'application/json' })
    return json({ ok: true })
  }
  if (action === 'reject' || action === 'remove') {
    const blob = await find(action === 'reject' ? 'pending/' : 'approved/', id)
    if (!blob) return json({ error: 'Não encontrada.' }, 404)
    await removeAll(blob.url, id)
    return json({ ok: true })
  }
  return json({ error: 'Ação inválida.' }, 400)
}
