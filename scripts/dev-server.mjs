import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../src', import.meta.url)))
const port = Number(process.env.PORT || 5173)
const clients = new Set()

const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.woff2', 'font/woff2'],
])

function safePath(urlPath) {
  const relative = normalize(decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html')
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    return null
  }
  return target
}

function injectReload(body) {
  const script = `
<script>
(() => {
  const source = new EventSource("/__castboard_reload");
  source.addEventListener("reload", () => window.location.reload());
})();
</script>
`
  return body.includes('</body>') ? body.replace('</body>', `${script}\n</body>`) : body + script
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/__castboard_reload')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.url?.startsWith('/favicon.ico')) {
    res.writeHead(204)
    res.end()
    return
  }

  const target = safePath(req.url || '/')
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const type = types.get(extname(target)) || 'application/octet-stream'
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (target.endsWith('index.html')) {
    let body = ''
    const stream = createReadStream(target, 'utf8')
    stream.on('data', (chunk) => { body += chunk })
    stream.on('end', () => {
      res.writeHead(200, { 'Content-Type': type })
      res.end(injectReload(body))
    })
    stream.on('error', () => {
      res.writeHead(500)
      res.end('Read failed')
    })
    return
  }

  res.writeHead(200, { 'Content-Type': type })
  createReadStream(target).pipe(res)
})

async function watchTree(dir) {
  watch(dir, { recursive: true }, () => {
    for (const client of clients) {
      client.write('event: reload\ndata: reload\n\n')
    }
  })
  await readdir(dir)
}

await watchTree(root)
server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stopping dev server.`)
    process.exit(1)
  }
  throw error
})
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving at: http://0.0.0.0:${port}`)
})
