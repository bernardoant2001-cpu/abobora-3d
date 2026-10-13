import { readEntry } from './gallery.js'

// GET /a/<id> (reescrito para /api/share?id=<id>): o mesmo site, mas com a prévia de compartilhamento
// (título e imagem) daquela abóbora, para o link ficar bonito no WhatsApp, LinkedIn etc.

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function setMeta(html: string, attr: 'property' | 'name', key: string, value: string) {
  const tag = `<meta ${attr}="${key}" content="${escape(value)}" />`
  const re = new RegExp(`<meta ${attr}="${key}"[^>]*>`)
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  const [page, entry] = await Promise.all([
    fetch(new URL('/index.html', url.origin)).then((r) => r.text()),
    readEntry('approved/', id),
  ])
  if (!entry) return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

  const title = `Abóbora de ${entry.name}`
  const description = `Veja a abóbora que ${entry.name} esculpiu e esculpa a sua também.`
  let html = page.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)} · Abóbora</title>`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', `${url.origin}/a/${entry.id}`)
  html = setMeta(html, 'property', 'og:image', entry.thumb)
  html = setMeta(html, 'property', 'og:image:width', '480')
  html = setMeta(html, 'property', 'og:image:height', '600')
  html = setMeta(html, 'property', 'og:image:alt', `Abóbora esculpida por ${entry.name}`)
  html = setMeta(html, 'name', 'twitter:card', 'summary')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}
