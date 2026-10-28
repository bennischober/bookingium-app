// The e-invoice reference validators, one command away (dev/CI only, never
// part of the app package):
//   node scripts/einvoice-tools.mjs setup     download + install, print env
//   node scripts/einvoice-tools.mjs check     both checks on the PDFs already there
//   node scripts/einvoice-tools.mjs validate  setup, build, e2e, both checks
// CI runs these as separate steps (.github/workflows/ci.yml): setup also
// writes the env to $GITHUB_ENV there, and check fails when a suite skipped.
// Pinned versions land in the gitignored .tools/ folder; every download is
// checked against the SHA-256 below and skipped when already there. Both
// validators are Java programs, so Java 11+ must be on the PATH.
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { inflateRawSync } from 'zlib'

const root = resolve(import.meta.dirname, '..')
const tools = join(root, '.tools')
const downloads = join(tools, 'downloads')
const isWindows = process.platform === 'win32'

const KOSIT_VALIDATOR = {
  name: 'validator-1.6.3-standalone.jar',
  url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar',
  // Same as GitHub's digest for the release asset
  sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9',
  size: '10.6 MB'
}
const XRECHNUNG_CONFIG = {
  name: 'xrechnung-3.0.2-validator-configuration-2026-08-31.zip',
  url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip',
  sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8',
  size: '0.5 MB'
}
const VERAPDF_INSTALLER = {
  name: 'verapdf-greenfield-1.30.3-installer.zip',
  url: 'https://software.verapdf.org/rel/1.30/verapdf-greenfield-1.30.3-installer.zip',
  // veraPDF publishes no checksum, only a PGP signature (.asc); this hash is
  // of the file whose signature checked out with the veraPDF key
  // 13DD 102B 4DD6 9354 D12D E5A8 3184 8632 78B1 7FE7
  sha256: 'b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59',
  size: '33 MB',
  installer: 'verapdf-greenfield-1.30.3/verapdf-izpack-installer-1.30.3.jar'
}

const kositJar = join(tools, 'kosit', KOSIT_VALIDATOR.name)
const kositConfig = join(tools, 'kosit', 'xrechnung-config-2026-08-31')
const verapdfHome = join(tools, 'verapdf-1.30.3')
const verapdf = join(verapdfHome, isWindows ? 'verapdf.bat' : 'verapdf')

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Java on the PATH, version 11 or newer (the KoSIT validator needs 11) */
function checkJava() {
  // stdio 'pipe' throughout: Java CLIs fail on Windows ("Unzulässige
  // Funktion") when they inherit a stdin that is not a pipe
  const run = spawnSync('java', ['-version'], { encoding: 'utf-8', stdio: 'pipe' })
  const match = run.error ? null : /version "(\d+)(?:\.(\d+))?/.exec(run.stderr + run.stdout)
  if (!match) {
    fail(
      'Java not found. The e-invoice validators (KoSIT, veraPDF) are Java programs:\n' +
        '  install Java 11 or newer (e.g. Eclipse Temurin, https://adoptium.net)\n' +
        '  and make sure `java -version` works in this terminal.'
    )
  }
  // "1.8.0_402" is Java 8, "11.0.19" Java 11, "21" Java 21
  const major = Number(match[1] === '1' ? match[2] : match[1])
  if (major < 11) {
    fail(`Java ${major} found, the e-invoice validators need Java 11 or newer.`)
  }
}

/** Downloads into .tools/downloads unless a file with the right hash is there */
async function download({ name, url, sha256, size }) {
  const file = join(downloads, name)
  if (existsSync(file) && sha256Of(file) === sha256) return file

  mkdirSync(downloads, { recursive: true })
  console.log(`Downloading ${name} (${size}) …`)
  const response = await fetch(url)
  if (!response.ok) fail(`Download failed: ${url} (${response.status})`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== sha256) {
    fail(`Checksum mismatch for ${name}:\n  expected ${sha256}\n  got      ${actual}`)
  }
  writeFileSync(file, data)
  return file
}

/** Minimal unzip (stored/deflated entries, no ZIP64): enough for these two archives */
function unzip(file, dest) {
  const zip = readFileSync(file)
  let eocd = zip.length - 22
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) fail(`Not a zip file: ${file}`)

  const base = resolve(dest)
  let entry = zip.readUInt32LE(eocd + 16)
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = zip.readUInt16LE(entry + 10)
    const compressedSize = zip.readUInt32LE(entry + 20)
    const nameLength = zip.readUInt16LE(entry + 28)
    const local = zip.readUInt32LE(entry + 42)
    const name = zip.toString('utf-8', entry + 46, entry + 46 + nameLength)
    entry += 46 + nameLength + zip.readUInt16LE(entry + 30) + zip.readUInt16LE(entry + 32)

    const target = resolve(base, name)
    if (!target.startsWith(base + sep)) fail(`Unsafe path in ${file}: ${name}`)
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      continue
    }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + compressedSize)
    if (method !== 0 && method !== 8) fail(`Unsupported compression in ${file}: ${name}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, method === 8 ? inflateRawSync(data) : data)
  }
}

/** Unzips into a temp folder first, so an interrupted run never looks done */
function unzipTo(file, dest) {
  const temp = `${dest}.partial`
  rmSync(temp, { recursive: true, force: true })
  unzip(file, temp)
  return temp
}

async function ensureKosit() {
  if (!existsSync(kositJar) || sha256Of(kositJar) !== KOSIT_VALIDATOR.sha256) {
    const file = await download(KOSIT_VALIDATOR)
    mkdirSync(dirname(kositJar), { recursive: true })
    renameSync(file, kositJar)
  }
  if (!existsSync(join(kositConfig, 'scenarios.xml'))) {
    const temp = unzipTo(await download(XRECHNUNG_CONFIG), kositConfig)
    if (!existsSync(join(temp, 'scenarios.xml')))
      fail('XRechnung configuration without scenarios.xml')
    renameSync(temp, kositConfig)
  }
}

async function ensureVerapdf() {
  if (existsSync(verapdf)) return
  const unpacked = unzipTo(await download(VERAPDF_INSTALLER), join(downloads, 'verapdf'))
  const temp = `${verapdfHome}.partial`
  rmSync(temp, { recursive: true, force: true })
  // Headless izpack install: the CLI only (the "GUI" pack holds the
  // command-line launchers on Windows, the *nix scripts pack elsewhere)
  const autoInstall = join(unpacked, 'auto-install.xml')
  writeFileSync(
    autoInstall,
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>${temp.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="${!isWindows}"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
`,
    'utf-8'
  )
  console.log('Installing veraPDF …')
  const install = spawnSync(
    'java',
    ['-jar', join(unpacked, VERAPDF_INSTALLER.installer), autoInstall],
    { encoding: 'utf-8', stdio: 'pipe' }
  )
  const launcher = join(temp, isWindows ? 'verapdf.bat' : 'verapdf')
  if (install.status !== 0 || !existsSync(launcher)) {
    fail(`veraPDF install failed:\n${install.stdout ?? ''}${install.stderr ?? ''}`)
  }
  if (!isWindows) chmodSync(launcher, 0o755)
  renameSync(temp, verapdfHome)
  rmSync(unpacked, { recursive: true, force: true })
}

async function setup() {
  checkJava()
  await ensureKosit()
  await ensureVerapdf()
  return { KOSIT_VALIDATOR: kositJar, KOSIT_CONFIG: kositConfig, VERAPDF: verapdf }
}

/** One project command (constant strings, so a shell is fine) */
function step(title, command, env = process.env) {
  console.log(`\n▶ ${title}`)
  const run = spawnSync(command, { cwd: root, env, shell: true, stdio: 'inherit' })
  if (run.status !== 0) fail(`${title} failed (${command})`)
}

const pdfDir = join(root, 'tests/e2e/__screenshots__')
const pdfs = () =>
  existsSync(pdfDir) ? readdirSync(pdfDir).filter((f) => /^einvoice-.*\.pdf$/.test(f)) : []

/** Both validator suites on the PDFs the e2e test wrote; a skipped suite fails */
function check(env) {
  if (pdfs().length === 0) fail(`The e2e test wrote no einvoice-*.pdf into ${pdfDir}`)

  // Both tests skip themselves when something is missing: count what ran
  const report = join(tools, 'vitest-einvoice.json')
  rmSync(report, { force: true })
  step(
    'KoSIT (XML) and veraPDF (PDF/A-3b)',
    'pnpm exec vitest run tests/einvoice.kosit.test.ts tests/einvoice.verapdf.test.ts' +
      ' --reporter=default --reporter=json --outputFile.json=.tools/vitest-einvoice.json',
    env
  )
  const result = JSON.parse(readFileSync(report, 'utf-8'))
  if (result.numPassedTests !== 2 || result.numTotalTests !== 2) {
    fail(
      `Expected both validator tests to run and pass, got ${result.numPassedTests} passed of ${result.numTotalTests}.`
    )
  }
  console.log(`\n✔ KoSIT and veraPDF accept the e-invoices (${pdfs().length} PDFs checked).`)
}

async function validate() {
  const env = { ...process.env, ...(await setup()) }
  step('Build', 'pnpm build')

  // Old PDFs must not pass for new ones: the e2e test writes them fresh
  for (const file of pdfs()) rmSync(join(pdfDir, file))
  step('E-invoice e2e (writes the PDFs)', 'pnpm exec playwright test tests/e2e/einvoice.spec.ts')
  check(env)
}

const command = process.argv[2] ?? 'validate'
if (command === 'setup') {
  const env = await setup()
  console.log('\nValidators ready. To run the tests by hand:')
  for (const [key, value] of Object.entries(env)) {
    console.log(isWindows ? `  $env:${key} = "${value}"` : `  export ${key}="${value}"`)
  }
  // GitHub Actions: the job's later steps see these variables
  if (process.env.GITHUB_ENV) {
    appendFileSync(
      process.env.GITHUB_ENV,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    )
  }
} else if (command === 'check') {
  check({ ...process.env, ...(await setup()) })
} else if (command === 'validate') {
  await validate()
} else {
  fail(`Unknown command "${command}" (setup | check | validate)`)
}
