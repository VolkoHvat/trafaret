import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(path.join(root, relative), 'utf8')
const checks = []
const pass = (name, detail) => checks.push({ name, status: 'PASS', detail })
const fail = (name, detail) => checks.push({ name, status: 'FAIL', detail })
const review = (name, detail) => checks.push({ name, status: 'NOT_TESTED', detail })

const manifest = read('android/app/src/main/AndroidManifest.xml')
const gradle = read('android/app/build.gradle')
const variables = read('android/variables.gradle')
const capacitor = read('capacitor.config.ts')
const filePaths = read('android/app/src/main/res/xml/file_paths.xml')
const generatedConfig = read('android/app/src/main/assets/capacitor.config.json')

if (/android.permission.(READ|WRITE)_EXTERNAL_STORAGE/.test(manifest)) {
  fail('scoped-storage', 'legacy external-storage permission is declared')
} else {
  pass('scoped-storage', 'no legacy external-storage permission is declared')
}

const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"\s*\/>/g)].map(match => match[1])
if (permissions.every(permission => permission === 'android.permission.INTERNET')) {
  pass('permissions', `declared permissions: ${permissions.join(', ') || 'none'}`)
} else {
  fail('permissions', `unexpected permissions: ${permissions.join(', ')}`)
}

if (/android:exported="true"/.test(manifest) && /android.intent.action.MAIN/.test(manifest) && /android.intent.category.LAUNCHER/.test(manifest)) {
  pass('launcher', 'single exported launcher activity is declared')
} else {
  fail('launcher', 'launcher activity declaration is incomplete')
}

if (/android:exported="false"/.test(manifest) && /android:grantUriPermissions="true"/.test(manifest) && /android\.support\.FILE_PROVIDER_PATHS/.test(manifest)) {
  pass('share-provider', 'FileProvider is private and grants URI permissions explicitly')
} else {
  fail('share-provider', 'FileProvider contract is incomplete')
}

if (/<cache-path\s+name="[^"]+"\s+path="\."\s*\/>/.test(filePaths) && /<files-path\s+name="[^"]+"\s+path="\."\s*\/>/.test(filePaths) && !/external|root-path|external-path/.test(filePaths)) {
  pass('share-storage-scope', 'shareable files are limited to app cache/files paths')
} else {
  fail('share-storage-scope', 'FileProvider exposes an unsafe or unsupported path')
}

const appId = capacitor.match(/appId:\s*'([^']+)'/)?.[1]
const applicationId = gradle.match(/applicationId\s+"([^"]+)"/)?.[1]
const generatedAppId = generatedConfig.match(/"appId"\s*:\s*"([^"]+)"/)?.[1]
if (appId && appId === applicationId && appId === generatedAppId) {
  pass('application-id', `source and synced Android application id: ${appId}`)
} else {
  fail('application-id', `ids differ: capacitor=${appId ?? 'missing'}, gradle=${applicationId ?? 'missing'}, synced=${generatedAppId ?? 'missing'}`)
}

const minSdk = variables.match(/minSdkVersion\s*=\s*(\d+)/)?.[1]
const targetSdk = variables.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1]
if (minSdk === '24' && targetSdk === '36' && /compileSdkVersion\s*=\s*36/.test(variables)) {
  pass('sdk-levels', 'minSdk 24, compileSdk 36, targetSdk 36')
} else {
  fail('sdk-levels', `unexpected SDK levels: min=${minSdk ?? 'missing'}, target=${targetSdk ?? 'missing'}`)
}

if (/allowMixedContent:\s*false/.test(capacitor) && /android:allowBackup="false"/.test(manifest) && /android:fullBackupContent="false"/.test(manifest)) {
  pass('offline-and-backup', 'mixed content and Android backup are disabled')
} else {
  fail('offline-and-backup', 'offline or backup hardening is incomplete')
}

if (existsSync(path.join(root, 'android/gradlew.bat'))) {
  pass('gradle-wrapper', 'Gradle wrapper entrypoint exists')
} else {
  fail('gradle-wrapper', 'android/gradlew.bat is missing')
}

review('android-sdk', 'Android SDK, emulator/device, and a real APK build are not tested by this static audit')
review('media-capture', 'camera/gallery behavior and Android permission prompts require a physical or emulated device')
review('share-intent', 'receiving and sending Android share intents require a physical or emulated device')

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
const adbPath = process.platform === 'win32' ? path.join(sdkRoot, 'platform-tools', 'adb.exe') : path.join(sdkRoot, 'platform-tools', 'adb')
if (existsSync(adbPath)) {
  pass('android-tools', `adb exists at ${path.relative(root, adbPath)}`)
} else {
  review('android-tools', `adb not found at ${adbPath}`)
}

for (const check of checks) console.log(`${check.status} ${check.name}: ${check.detail}`)
const failures = checks.filter(check => check.status === 'FAIL')
console.log(`SUMMARY PASS=${checks.filter(check => check.status === 'PASS').length} FAIL=${failures.length} NOT_TESTED=${checks.filter(check => check.status === 'NOT_TESTED').length}`)
process.exitCode = failures.length ? 1 : 0
