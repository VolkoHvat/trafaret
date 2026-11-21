#!/usr/bin/env node
// Static Windows packaging audit. It never builds, publishes, or reads credentials.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(repo, 'package.json')
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const mainPath = path.join(repo, 'desktop', 'src', 'main.ts')
const preloadPath = path.join(repo, 'desktop', 'src', 'preload.ts')
const mainSource = readFileSync(mainPath, 'utf8')
const preloadSource = readFileSync(preloadPath, 'utf8')

const checks = []
function check(id, status, detail) {
  checks.push({ id, status, detail })
}
function has(value, pattern) {
  return pattern.test(value)
}

const build = packageJson.build ?? {}
const win = build.win ?? {}
const nsis = build.nsis ?? {}
const files = Array.isArray(build.files) ? build.files : []

check('package-main', packageJson.main === 'desktop/dist/main.js' ? 'PASS' : 'FAIL', `main=${String(packageJson.main)}`)
check('desktop-build-script', typeof packageJson.scripts?.['desktop:build'] === 'string' ? 'PASS' : 'FAIL', 'desktop:build script is declared')
check('desktop-dist-script', typeof packageJson.scripts?.['desktop:dist'] === 'string' ? 'PASS' : 'FAIL', 'desktop:dist script is declared')
check('windows-target', Array.isArray(win.target) && win.target.includes('nsis') ? 'PASS' : 'FAIL', `targets=${JSON.stringify(win.target ?? null)}`)
check('windows-arch', win.arch === undefined || (Array.isArray(win.arch) && win.arch.includes('x64')) || win.arch === 'x64' ? 'PASS' : 'REVIEW', `arch=${JSON.stringify(win.arch ?? 'electron-builder default')}`)
check('installer-artifact', typeof win.artifactName === 'string' && /\.exe$/i.test(win.artifactName) ? 'PASS' : 'FAIL', `artifactName=${String(win.artifactName)}`)
check('installer-icon', typeof win.icon === 'string' && existsSync(path.join(repo, win.icon)) ? 'PASS' : 'FAIL', `icon=${String(win.icon)}`)
check('nsis-user-install', nsis.oneClick === false && nsis.perMachine === false ? 'PASS' : 'REVIEW', `oneClick=${String(nsis.oneClick)}, perMachine=${String(nsis.perMachine)}`)
check('packaged-files-allowlist', files.length > 0 && files.every(file => typeof file === 'string' && !file.startsWith('!') && !file.includes('..')) ? 'PASS' : 'FAIL', `files=${JSON.stringify(files)}`)
check('packaged-runtime-entrypoints', files.includes('desktop/dist/**') && files.includes('dist/**') ? 'PASS' : 'FAIL', 'desktop and web runtime directories are included')
check('preload-cjs-output', /--format=cjs/.test(packageJson.scripts?.['desktop:build'] ?? '') && /preload\.cjs/.test(packageJson.scripts?.['desktop:build'] ?? '') ? 'PASS' : 'FAIL', 'preload is bundled as CommonJS')
check('renderer-security-source', has(mainSource, /nodeIntegration:\s*false/) && has(mainSource, /contextIsolation:\s*true/) && has(mainSource, /sandbox:\s*true/) ? 'PASS' : 'FAIL', 'main window security flags are explicit')
check('navigation-guard', has(mainSource, /setWindowOpenHandler/) && has(mainSource, /will-navigate/) && has(mainSource, /isAllowedNavigation/) ? 'PASS' : 'FAIL', 'navigation and popup handlers are installed')
check('preload-bridge', has(preloadSource, /contextBridge\.exposeInMainWorld\('trafaretNative'/) && !has(preloadSource, /nodeIntegration/) ? 'PASS' : 'FAIL', 'preload exposes a constrained context bridge')
check('runtime-secrets', !/(clientSecret|private[_-]?key|BEGIN [A-Z ]+PRIVATE KEY|token\s*[:=]\s*['"])/i.test(mainSource + preloadSource) ? 'PASS' : 'REVIEW', 'desktop sources contain no embedded secret material')

const output = typeof build.directories?.output === 'string' ? build.directories.output : null
const outputPortable = output === null || (!path.win32.parse(output).root && !path.posix.isAbsolute(output))
check('output-directory-portability', outputPortable ? 'PASS' : 'REVIEW', output ? `output=${output}` : 'electron-builder default output')
check('icon-file-type', existsSync(path.join(repo, 'build', 'icon.ico')) && statSync(path.join(repo, 'build', 'icon.ico')).isFile() ? 'PASS' : 'FAIL', 'Windows icon exists')

const fail = checks.filter(item => item.status === 'FAIL')
const review = checks.filter(item => item.status === 'REVIEW')
const report = {
  kind: 'trafaret-windows-exe-audit',
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  buildRun: false,
  checks,
  summary: { pass: fail.length === 0, fail: fail.length, review: review.length, total: checks.length },
  limitations: [
    'Installer, portable executable, signing, SmartScreen, and clean-machine installation are NOT_TESTED by this static audit.',
    'Physical Windows 11 pen/touch and GPU behavior require scripts/electron-audit.mjs on Windows hardware.',
  ],
}

const out = process.argv[2]
if (out) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  writeFileSync(path.resolve(out), JSON.stringify(report, null, 2))
}
for (const item of checks) console.log(`[windows-exe-audit] ${item.status} ${item.id}: ${item.detail}`)
console.log(`[windows-exe-audit] buildRun=false pass=${report.summary.pass} fail=${report.summary.fail} review=${report.summary.review}`)
process.exit(report.summary.pass ? 0 : 1)
