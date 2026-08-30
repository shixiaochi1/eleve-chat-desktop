/**
 * pngAnnotated — 标注图 PNG tEXt 标记 + Hermes 式缩放兜底
 *
 * 🔴 2026-08-31 对齐 Hermes：
 * - 标记 chunk（keyword = "eleve-annotated"）与后端 png_is_annotated（vision.rs）配对，
 *   是编辑协议（重绘铁律模板 + 比例锁定）的触发命脉——JPEG 无 tEXt，标注图必须 PNG
 * - 压缩哲学对齐 Hermes"原图优先、超限才缩"（conversation_compression.py L4838）：
 *   长边档位 = _EMBED_MAX_DIMENSION 1568（Anthropic 官方推荐）；字节目标 4MB
 *   （Anthropic 5MB 留余量，L4871-4875）；PNG 重编码可能变大（LANCZOS 噪声非单调，
 *   L4918-4925）→ 结果比原图还大则视为"缩不动"放弃
 */

/** Hermes _EMBED_MAX_DIMENSION（vision_tools.py L719，Anthropic 推荐长边） */
export const ANNOTATED_MAX_DIMENSION = 1568
/** Hermes image-shrink 字节目标（conversation_compression.py L4875，5MB 留余量） */
export const ATTACH_TARGET_BYTES = 4 * 1024 * 1024

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = 0xedb88320 ^ (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const buildAnnotatedChunk = (): Uint8Array => {
  const enc = new TextEncoder()
  const kw = enc.encode('eleve-annotated')
  const val = enc.encode('1')
  const data = new Uint8Array(kw.length + 1 + val.length)
  data.set(kw)
  data[kw.length] = 0
  data.set(val, kw.length + 1)
  const chunk = new Uint8Array(12 + data.length)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, data.length)
  chunk.set(enc.encode('tEXt'), 4)
  chunk.set(data, 8)
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

/** PNG data URL 嵌入 tEXt "eleve-annotated=1"（插在 IHDR 之后 33B 处）。非 PNG 原样返回。 */
export const insertPngAnnotatedText = (dataUrl: string): string => {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return dataUrl // 非 PNG 回退
    const chunk = buildAnnotatedChunk()
    const at = 33 // 签名 8 + IHDR 25
    const merged = new Uint8Array(bytes.length + chunk.length)
    merged.set(bytes.subarray(0, at), 0)
    merged.set(chunk, at)
    merged.set(bytes.subarray(at), at + chunk.length)
    let s = ''
    for (let i = 0; i < merged.length; i++) s += String.fromCharCode(merged[i])
    return `data:image/png;base64,${btoa(s)}`
  } catch {
    return dataUrl
  }
}

/** 检测 PNG data URL 是否带 "eleve-annotated" tEXt 标记（遍历 chunk）。非 PNG → false。 */
export const pngHasAnnotatedMarker = (dataUrl: string): boolean => {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return false
    const dv = new DataView(bytes.buffer)
    const enc = new TextDecoder()
    let off = 8
    while (off + 12 <= bytes.length) {
      const len = dv.getUint32(off)
      const type = enc.decode(bytes.subarray(off + 4, off + 8))
      if (type === 'tEXt') {
        const data = bytes.subarray(off + 8, off + 8 + len)
        const kw = new TextEncoder().encode('eleve-annotated\x00')
        if (data.length >= kw.length && kw.every((b, i) => data[i] === b)) return true
      }
      if (type === 'IDAT' || type === 'IEND') break
      off += 12 + len
    }
    return false
  } catch {
    return false
  }
}

/** 加载 data URL → Image（解码失败 reject） */
const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = dataUrl
  })

/**
 * Hermes 式 attach 失败缩放兜底（对齐 try_shrink_image_parts_in_messages L4838）。
 *
 * 门控：图长边 ≤1568 且 base64 ≤4MB → 返回 null（缩了也不会过，不浪费重试）；
 * 缩放 = 长边压到 1568 → PNG；带 eleve-annotated 标记的图重新嵌标记（canvas
 * 重编码会丢 tEXt）；结果比原图还大（PNG 非单调坑）或仍超 4MB → null 放弃。
 */
export const shrinkDataUrlForAttach = async (dataUrl: string): Promise<string | null> => {
  try {
    const isPng = dataUrl.startsWith('data:image/png')
    const hasMarker = isPng && pngHasAnnotatedMarker(dataUrl)
    const img = await loadImage(dataUrl)
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight)
    if (
      maxSide <= ANNOTATED_MAX_DIMENSION &&
      dataUrl.length <= ATTACH_TARGET_BYTES * (4 / 3)
    ) {
      return null // 尺寸与字节都在限内——失败与大小无关，缩了也白缩
    }
    const scale = Math.min(1, ANNOTATED_MAX_DIMENSION / maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    let out = canvas.toDataURL('image/png')
    if (hasMarker) out = insertPngAnnotatedText(out) // 标记是协议命脉，重编码后补回
    // Hermes 非单调守卫：缩完反而更大 → 放弃；仍超字节目标 → 放弃
    if (out.length >= dataUrl.length || out.length > ATTACH_TARGET_BYTES * (4 / 3)) {
      return null
    }
    return out
  } catch {
    return null
  }
}
