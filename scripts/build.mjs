import { cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const src = resolve(root, 'src')
const dist = resolve(root, 'dist')

await rm(dist, { recursive: true, force: true })
await cp(src, dist, { recursive: true })
