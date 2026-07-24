import { GIFEncoder, applyPalette, quantize } from 'gifenc'

const GIF_WIDTH_LIMIT = 1200
const GIF_HEIGHT_LIMIT = 900
const MAX_PALETTE_SAMPLE_PIXELS = 750_000
const PALETTE_ANCHOR_REPETITIONS = 48
export const LATEST_FRAME_HOLD_MS = 900

const PALETTE_ANCHORS: Array<[number, number, number]> = [
  [16, 42, 67],
  [129, 222, 208],
  [237, 245, 243],
  [36, 55, 70],
  [229, 237, 244],
  [247, 248, 247],
  [32, 42, 49],
  [127, 139, 148],
  [247, 222, 255],
  [145, 55, 190],
  [222, 49, 164],
  [188, 29, 67],
  [239, 47, 43],
  [255, 116, 30],
  [255, 191, 29],
  [225, 228, 28],
  [116, 226, 35],
  [20, 225, 67],
  [0, 184, 76],
  [25, 112, 70],
  [143, 152, 149],
  [194, 200, 199],
  [45, 187, 96],
  [69, 174, 240],
  [232, 82, 177],
  [241, 70, 93],
  [244, 163, 64],
  [92, 196, 127],
  [213, 174, 54],
]

function paletteSamples(frames: ImageData[]): Uint8Array {
  const totalPixels = frames.reduce((total, frame) => total + frame.width * frame.height, 0)
  const stride = Math.max(1, Math.ceil(totalPixels / MAX_PALETTE_SAMPLE_PIXELS))
  const sampledPixels = frames.reduce((total, frame, frameIndex) => {
    const pixels = frame.width * frame.height
    const offset = (frameIndex * 131) % stride
    return total + Math.max(0, Math.ceil((pixels - offset) / stride))
  }, 0)
  const anchorPixels = PALETTE_ANCHORS.length * PALETTE_ANCHOR_REPETITIONS
  const samples = new Uint8Array((sampledPixels + anchorPixels) * 4)
  let target = 0

  frames.forEach((frame, frameIndex) => {
    const pixels = frame.width * frame.height
    const offset = (frameIndex * 131) % stride
    for (let pixel = offset; pixel < pixels; pixel += stride) {
      const source = pixel * 4
      samples[target] = frame.data[source]
      samples[target + 1] = frame.data[source + 1]
      samples[target + 2] = frame.data[source + 2]
      samples[target + 3] = 255
      target += 4
    }
  })

  PALETTE_ANCHORS.forEach(([red, green, blue]) => {
    for (let repeat = 0; repeat < PALETTE_ANCHOR_REPETITIONS; repeat += 1) {
      samples[target] = red
      samples[target + 1] = green
      samples[target + 2] = blue
      samples[target + 3] = 255
      target += 4
    }
  })
  return target === samples.length ? samples : samples.subarray(0, target)
}

function frameDelayMilliseconds(fps: number): number {
  return Math.max(10, Math.round(1_000 / Math.max(0.5, fps)))
}

export function encodeGif(frames: ImageData[], fps: number, latestHoldMs = LATEST_FRAME_HOLD_MS): Blob {
  if (!frames.length) throw new Error('No map frames were captured for GIF export')
  const width = frames[0].width
  const height = frames[0].height
  if (!width || !height || frames.some((frame) => frame.width !== width || frame.height !== height)) {
    throw new Error('Captured map frames do not share one size')
  }

  const palette = quantize(paletteSamples(frames), 256, { format: 'rgb565' })
  const gif = GIFEncoder()
  const standardDelay = frameDelayMilliseconds(fps)
  frames.forEach((frame, index) => {
    const delay = index === frames.length - 1 ? standardDelay + latestHoldMs : standardDelay
    const indexed = applyPalette(frame.data, palette, 'rgb565')
    gif.writeFrame(indexed, width, height, {
      palette: index === 0 ? palette : undefined,
      delay,
      repeat: 0,
    })
  })
  gif.finish()
  const encoded = gif.bytes()
  const output = new Uint8Array(encoded.length)
  output.set(encoded)
  return new Blob([output.buffer], { type: 'image/gif' })
}

export { GIF_HEIGHT_LIMIT, GIF_WIDTH_LIMIT }
