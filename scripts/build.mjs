import { cp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = resolve(root, 'src')
const dist = resolve(root, 'dist')
const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const { CASTBOARD_VERSION } = await import(new URL('../src/version.js', import.meta.url))

if (packageMetadata.version !== CASTBOARD_VERSION) {
  throw new Error(`CastBoard version mismatch: package.json=${packageMetadata.version}, src/version.js=${CASTBOARD_VERSION}`)
}

await rm(dist, { recursive: true, force: true })
await cp(source, dist, { recursive: true })
await rm(resolve(dist, 'plugins', 'dev'), { recursive: true, force: true })
await rm(resolve(dist, 'fonts', 'SourceHanSansSC-VF.ttf.woff2'), { force: true })
