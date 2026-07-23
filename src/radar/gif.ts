const GIF_WIDTH_LIMIT = 960
const GIF_HEIGHT_LIMIT = 720
export const LATEST_FRAME_HOLD_MS = 900

function pushWord(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff)
}

function pushText(bytes: number[], value: string): void {
  for (const character of value) bytes.push(character.charCodeAt(0))
}

function buildRgb332Palette(): Uint8Array {
  const palette = new Uint8Array(256 * 3)
  for (let index = 0; index < 256; index += 1) {
    const red = (index >> 5) & 0x07
    const green = (index >> 2) & 0x07
    const blue = index & 0x03
    palette[index * 3] = Math.round(red * 255 / 7)
    palette[index * 3 + 1] = Math.round(green * 255 / 7)
    palette[index * 3 + 2] = Math.round(blue * 255 / 3)
  }
  return palette
}

function quantize(image: ImageData): Uint8Array {
  const indices = new Uint8Array(image.data.length / 4)
  for (let source = 0, target = 0; source < image.data.length; source += 4, target += 1) {
    const red = image.data[source] >> 5
    const green = image.data[source + 1] >> 5
    const blue = image.data[source + 2] >> 6
    indices[target] = (red << 5) | (green << 2) | blue
  }
  return indices
}

function lzwEncode(indices: Uint8Array): Uint8Array {
  const minimumCodeSize = 8
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  const chunkSize = 128
  const output: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  const writeCode = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += minimumCodeSize + 1
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }

  // Emit literal pixels in short, independently cleared chunks. The decoder
  // can build a small dictionary, but the stream never crosses a code-size
  // boundary, which keeps browser decoders consistent and the file smaller
  // than clearing after every single pixel.
  for (let offset = 0; offset < indices.length; offset += chunkSize) {
    writeCode(clearCode)
    const end = Math.min(indices.length, offset + chunkSize)
    for (let index = offset; index < end; index += 1) writeCode(indices[index])
  }
  writeCode(endCode)
  if (bitCount > 0) output.push(bitBuffer & 0xff)
  return Uint8Array.from(output)
}

function pushSubBlocks(bytes: number[], payload: Uint8Array): void {
  for (let offset = 0; offset < payload.length; offset += 255) {
    const size = Math.min(255, payload.length - offset)
    bytes.push(size)
    for (let index = 0; index < size; index += 1) bytes.push(payload[offset + index])
  }
  bytes.push(0)
}

function frameDelayCentiseconds(fps: number): number {
  return Math.max(1, Math.round(100 / Math.max(0.5, fps)))
}

export function encodeGif(frames: ImageData[], fps: number, latestHoldMs = LATEST_FRAME_HOLD_MS): Blob {
  if (!frames.length) throw new Error('No map frames were captured for GIF export')
  const width = frames[0].width
  const height = frames[0].height
  if (!width || !height || frames.some((frame) => frame.width !== width || frame.height !== height)) {
    throw new Error('Captured map frames do not share one size')
  }

  const bytes: number[] = []
  const palette = buildRgb332Palette()
  pushText(bytes, 'GIF89a')
  pushWord(bytes, width)
  pushWord(bytes, height)
  bytes.push(0xf7, 0, 0)
  palette.forEach((value) => bytes.push(value))
  bytes.push(0x21, 0xff, 0x0b)
  pushText(bytes, 'NETSCAPE2.0')
  bytes.push(3, 1, 0, 0, 0)

  const standardDelay = frameDelayCentiseconds(fps)
  const latestDelay = standardDelay + Math.max(0, Math.round(latestHoldMs / 10))
  frames.forEach((frame, index) => {
    const delay = index === frames.length - 1 ? latestDelay : standardDelay
    bytes.push(0x21, 0xf9, 4, 0x08)
    pushWord(bytes, delay)
    bytes.push(0, 0)
    bytes.push(0x2c, 0, 0, 0, 0)
    pushWord(bytes, width)
    pushWord(bytes, height)
    bytes.push(0)
    bytes.push(8)
    pushSubBlocks(bytes, lzwEncode(quantize(frame)))
  })
  bytes.push(0x3b)
  return new Blob([Uint8Array.from(bytes)], { type: 'image/gif' })
}

export { GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT }
