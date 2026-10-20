// Turns build/icon.svg into the app icons (dev only, never part of the app
// package):
//   pnpm icons
// Runs inside Electron, which rasterises the SVG at each exact size on a
// canvas, then packs the PNGs into the containers by hand:
//   build/icon.ico   Windows (exe, installer, taskbar): 16–256 px PNG entries
//   build/icon.icns  macOS: inset onto Apple's icon grid (824 of 1024 px)
//   build/icon.png   Linux, 512 px
//   resources/icon.png  window icon at runtime, 512 px
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'), 'utf-8')
// Apple's grid leaves a margin around the icon body: 512 / 824 * 1024 = 636
const svgMac = svg.replace('viewBox="0 0 512 512"', 'viewBox="-62 -62 636 636"')

/** PNG of the SVG at size x size, rendered in the page */
async function render(win, source, size) {
  const url = 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64')
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = ${size}
        canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = ${JSON.stringify(url)}
    })`)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/** ICO with PNG entries (Windows Vista and later) */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((entry) => entry.png)])
}

/** ICNS with PNG entries, each under its OSType */
function icns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024]
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<body></body>')

  const icoEntries = []
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    icoEntries.push({ size, png: await render(win, svg, size) })
  }
  writeFileSync(join(root, 'build/icon.ico'), ico(icoEntries))

  const macPngs = {}
  for (const size of new Set(ICNS_TYPES.map(([, size]) => size))) {
    macPngs[size] = await render(win, svgMac, size)
  }
  writeFileSync(
    join(root, 'build/icon.icns'),
    icns(ICNS_TYPES.map(([type, size]) => ({ type, png: macPngs[size] })))
  )

  const png512 = await render(win, svg, 512)
  writeFileSync(join(root, 'build/icon.png'), png512)
  writeFileSync(join(root, 'resources/icon.png'), png512)
  console.log('Icons written to build/ and resources/')
  app.quit()
})
