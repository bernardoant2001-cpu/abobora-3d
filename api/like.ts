import { del, head, put } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { clientIp, isId, json, likeCounts, rateLimited, readEntry, sameSiteJson } from './gallery.js'

// POST /api/like { id, on } → curte (on: true) ou descurte uma abóbora da exposição
// Um voto por pessoa e abóbora: o voto é um hash do IP + navegador com um segredo do servidor,
// então não dá para descobrir o IP de ninguém a partir dele.

function voter(request: Request) {
  const secret = process.env.ADMIN_TOKEN ?? 'abobora'
  const ua = request.headers.get('user-agent') ?? ''
  return createHash('sha256').update(`${secret}|${clientIp(request)}|${ua}`).digest('hex').slice(0, 24)
}

export async function POST(request: Request) {
  if (!sameSiteJson(request)) return json({ error: 'Requisição inválida.' }, 403)
  if (rateLimited(`like:${clientIp(request)}`, 40)) return json({ error: 'Calma aí, muitas curtidas seguidas.' }, 429)
  const { id, on } = (await request.json().catch(() => ({}))) as { id?: unknown; on?: unknown }
  if (!isId(id) || typeof on !== 'boolean') return json({ error: 'Requisição inválida.' }, 400)
  if (!(await readEntry('approved/', id))) return json({ error: 'Essa abóbora não está na exposição.' }, 404)

  const path = `likes/${id}/${voter(request)}`
  const exists = await head(path).then(() => true).catch(() => false)
  if (on && !exists) await put(path, '1', { access: 'public', addRandomSuffix: false, contentType: 'text/plain' })
  if (!on && exists) await del(path)
  const counts = await likeCounts(id)
  return json({ ok: true, likes: counts.get(id) ?? 0, liked: on })
}
