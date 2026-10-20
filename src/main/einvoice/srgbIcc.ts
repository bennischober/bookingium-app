// A minimal sRGB ICC profile (version 2.1, display class), built in code so
// no profile file has to be shipped. PDF/A needs it as the destination
// profile of the output intent because Chromium paints in DeviceRGB.
// Colorants are the sRGB primaries adapted to D50 (Bradford); the tone
// curves sample the exact sRGB transfer function.

const encoder = new TextEncoder()

function s15Fixed16(value: number): number {
  return Math.round(value * 65536)
}

class Writer {
  private bytes: number[] = []

  get length(): number {
    return this.bytes.length
  }

  uint8(value: number): this {
    this.bytes.push(value & 0xff)
    return this
  }

  uint16(value: number): this {
    return this.uint8(value >>> 8).uint8(value)
  }

  uint32(value: number): this {
    return this.uint16(value >>> 16).uint16(value)
  }

  int32(value: number): this {
    return this.uint32(value >>> 0)
  }

  ascii(text: string): this {
    encoder.encode(text).forEach((byte) => this.uint8(byte))
    return this
  }

  zeros(count: number): this {
    for (let index = 0; index < count; index++) this.uint8(0)
    return this
  }

  pad4(): this {
    while (this.bytes.length % 4 !== 0) this.uint8(0)
    return this
  }

  append(other: Writer): this {
    this.bytes.push(...other.bytes)
    return this
  }

  setUint32(offset: number, value: number): void {
    this.bytes[offset] = (value >>> 24) & 0xff
    this.bytes[offset + 1] = (value >>> 16) & 0xff
    this.bytes[offset + 2] = (value >>> 8) & 0xff
    this.bytes[offset + 3] = value & 0xff
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function xyzTag(x: number, y: number, z: number): Writer {
  return new Writer()
    .ascii('XYZ ')
    .zeros(4)
    .int32(s15Fixed16(x))
    .int32(s15Fixed16(y))
    .int32(s15Fixed16(z))
}

function textTag(text: string): Writer {
  return new Writer().ascii('text').zeros(4).ascii(text).uint8(0)
}

function descriptionTag(text: string): Writer {
  return new Writer()
    .ascii('desc')
    .zeros(4)
    .uint32(text.length + 1)
    .ascii(text)
    .uint8(0)
    .zeros(4 + 4) // Unicode language code and count
    .zeros(2 + 1 + 67) // ScriptCode code, count and fixed-size string
}

/** sRGB transfer function (IEC 61966-2-1), linear light from encoded value */
function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function curveTag(samples: number): Writer {
  const writer = new Writer().ascii('curv').zeros(4).uint32(samples)
  for (let index = 0; index < samples; index++) {
    writer.uint16(Math.round(srgbToLinear(index / (samples - 1)) * 65535))
  }
  return writer
}

export const SRGB_PROFILE_NAME = 'sRGB IEC61966-2.1'

let cached: Uint8Array | null = null

export function srgbIccProfile(): Uint8Array {
  if (cached) return cached

  const curve = curveTag(1024)
  const tags: Array<[string, Writer]> = [
    ['desc', descriptionTag(SRGB_PROFILE_NAME)],
    ['cprt', textTag('No copyright, use freely')],
    ['wtpt', xyzTag(0.9505, 1.0, 1.089)],
    ['rXYZ', xyzTag(0.4361, 0.2225, 0.0139)],
    ['gXYZ', xyzTag(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyzTag(0.1431, 0.0606, 0.7141)],
    ['rTRC', curve],
    ['gTRC', curve],
    ['bTRC', curve]
  ]

  const header = new Writer()
    .uint32(0) // size, set below
    .zeros(4) // preferred CMM
    .uint32(0x02100000) // version 2.1
    .ascii('mntr')
    .ascii('RGB ')
    .ascii('XYZ ')
    .uint16(2026)
    .uint16(1)
    .uint16(1)
    .zeros(6) // time
    .ascii('acsp')
    .zeros(4 + 4 + 4 + 4 + 8) // platform, flags, manufacturer, model, attributes
    .uint32(0) // perceptual rendering intent
    .int32(s15Fixed16(0.9642)) // PCS illuminant D50
    .int32(s15Fixed16(1.0))
    .int32(s15Fixed16(0.8249))
    .zeros(4 + 16 + 28) // creator, profile id, reserved

  // Tag table, then the tag data (curves shared by the three channels)
  const tableSize = 4 + tags.length * 12
  const data = new Writer()
  const offsets = new Map<Writer, number>()
  const table = new Writer().uint32(tags.length)
  for (const [signature, tag] of tags) {
    let offset = offsets.get(tag)
    if (offset === undefined) {
      data.pad4()
      offset = header.length + tableSize + data.length
      offsets.set(tag, offset)
      data.append(tag)
    }
    table.ascii(signature).uint32(offset).uint32(tag.length)
  }

  const profile = header.append(table).append(data).pad4()
  profile.setUint32(0, profile.length)
  cached = profile.toUint8Array()
  return cached
}
