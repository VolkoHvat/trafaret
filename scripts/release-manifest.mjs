import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_NAME = 'scripts/release-manifest.mjs'
const DEFAULT_DENY = [
  /^\.git(?:\/|$)/,
  /^\.secrets(?:\/|$)/,
  /^\.tools(?:\/|$)/,
  /^node_modules(?:\/|$)/,
  /^dist\/\.vite(?:\/|$)/,
  /(?:^|\/)(?:coverage|\.cache|\.tmp)(?:\/|$)/,
  /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|keystore))$/i,
]

const SOURCE_PREFIXES = [
  '.github/',
  'desktop/src/',
  'desktop/tsconfig.json',
  'docs/FIELD_BETA.md',
  'public/',
  'scripts/',
  'src/',
  'AGENTS.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'QUALITY.md',
  'README.md',
  'capacitor.config.ts',
  'eslint.config.js',
  'index.html',
  'package-lock.json',
  'package.json',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
]

function normalize(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '')
}

function isDenied(relativePath) {
  return DEFAULT_DENY.some((pattern) => pattern.test(relativePath))
}

function isAllowlisted(relativePath, mode) {
  if (mode === 'web') return true
  return SOURCE_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix))
}

async function walk(directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRelative = normalize(path.join(relative, entry.name))
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), entryRelative))
    else if (entry.isFile()) result.push(entryRelative)
  }
  return result
}

async function sha256(filePath) {
  const content = await fs.readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export async function createManifest({ root, mode = 'source', version = 'unversioned' }) {
  const absoluteRoot = path.resolve(root)
  const candidates = await walk(absoluteRoot)
  const excluded = []
  const files = []
  for (const relativePath of candidates) {
    if (isDenied(relativePath)) {
      excluded.push({ path: relativePath, reason: 'denylist' })
      continue
    }
    if (!isAllowlisted(relativePath, mode)) {
      excluded.push({ path: relativePath, reason: 'not-allowlisted' })
      continue
    }
    const absolutePath = path.join(absoluteRoot, relativePath)
    const stat = await fs.stat(absolutePath)
    files.push({ path: relativePath, bytes: stat.size, sha256: await sha256(absolutePath) })
  }
  return {
    format: 'trafaret-release-manifest/v1',
    version,
    mode,
    generatedBy: SCRIPT_NAME,
    files,
    excluded,
    totals: {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      excluded: excluded.length,
    },
  }
}

export async function verifyManifest({ root, manifest }) {
  const actual = await createManifest({ root, mode: manifest.mode, version: manifest.version })
  const expected = manifest.files.map(({ path: filePath, bytes, sha256: digest }) => ({ path: filePath, bytes, sha256: digest }))
  const mismatches = []
  for (const file of actual.files) {
    const known = expected.find((candidate) => candidate.path === file.path)
    if (!known) mismatches.push({ path: file.path, reason: 'unexpected-file' })
    else if (known.bytes !== file.bytes || known.sha256 !== file.sha256) mismatches.push({ path: file.path, reason: 'changed' })
  }
  for (const file of expected) {
    if (!actual.files.some((candidate) => candidate.path === file.path)) mismatches.push({ path: file.path, reason: 'missing-file' })
  }
  return { ok: mismatches.length === 0, mismatches, actual }
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

async function main(args) {
  const command = args[0] ?? 'create'
  if (command === 'verify') {
    const manifestPath = argumentValue(args, '--manifest')
    const root = argumentValue(args, '--root', '.')
    if (!manifestPath) throw new Error('verify requires --manifest <path>')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    const result = await verifyManifest({ root, manifest })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
    return
  }
  const root = argumentValue(args, '--root', '.')
  const output = argumentValue(args, '--output')
  const mode = argumentValue(args, '--mode', 'source')
  const version = argumentValue(args, '--version', 'unversioned')
  if (!['source', 'web'].includes(mode)) throw new Error('--mode must be source or web')
  const manifest = await createManifest({ root, mode, version })
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  if (output) await fs.writeFile(output, serialized)
  else process.stdout.write(serialized)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
