import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const [apk, marker] = process.argv.slice(2)
assert.ok(apk?.endsWith('.apk'), 'Usage: node pigment-android.mjs LOCAL.apk [exact DOM attribute, e.g. data-pigment-mix]')
if (marker) assert.match(marker, /^data-[a-z0-9-]+$/)
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
const adb = (...args) => execFileSync(path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['-d', ...args], { encoding: 'utf8', timeout: 15000 }).trim()
const shell = cmd => adb('shell', cmd)
const pkg = 'ru.trafaret.studio'
const manufacturer = shell('getprop ro.product.manufacturer'), model = shell('getprop ro.product.model')
assert.equal(manufacturer.toUpperCase(), 'HONOR')
const version = shell(`dumpsys package ${pkg} | toybox grep -E 'versionCode=|versionName='`)
const pid = shell(`pidof ${pkg} || true`)
const webview = shell("dumpsys webviewupdate | toybox grep 'Current WebView package'")
const installed = shell(`pm path ${pkg}`).match(/^package:(\/data\/app\/[A-Za-z0-9_=/~.+-]+\/base\.apk)$/)?.[1]
assert.ok(installed, 'Expected a single installed base.apk')
const hash = b => createHash('sha256').update(b).digest('hex')
const deviceHash = shell(`sha256sum '${installed}'`).split(/\s/)[0]
const localHash = hash(readFileSync(apk))
console.log({ manufacturer, model, version, pid: pid || null, webview, deviceHash, localHash })
assert.equal(deviceHash, localHash, 'Local APK is not the installed base.apk')
const asset = name => execFileSync('unzip', ['-p', path.resolve(apk), `assets/public/${name}`], { maxBuffer: 64 * 1024 * 1024 })
const index = asset('index.html')
const main = index.toString().match(/<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/(assets\/[\w.-]+\.js)"/)?.[1]
assert.ok(main, 'Expected an offline JS entry in assets/public/index.html')
console.log({ indexSha256: hash(index), main, mainSha256: hash(asset(main)) })
const focused = shell(`dumpsys window | toybox grep -c 'mCurrentFocus=.*ru[.]trafaret[.]studio/' || true`) !== '0'
const socket = /^\d+$/.test(pid) && shell(`toybox grep -c '@webview_devtools_remote_${pid}$' /proc/net/unix || true`) === '1'
console.log({ focused, socket })
if (socket && marker) {
  const port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 })
    try {
      const page = browser.contexts().flatMap(c => c.pages()).find(p => new URL(p.url()).origin === 'https://localhost')
      if (page) console.log({ marker, presentInCurrentDOM: await page.locator(`[${marker}]`).count() > 0 })
      else console.log('NOT_TESTED: no loaded app origin')
    } finally { await browser.close() }
  } finally { adb('forward', '--remove', `tcp:${port}`) }
} else console.log('NOT_TESTED: live marker (no inspectable app socket or no marker specified)')
console.log('NOT_TESTED: mixing behavior; this audit never interacts with the document')
