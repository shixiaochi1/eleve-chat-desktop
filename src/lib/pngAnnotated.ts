/**
 * pngAnnotated — 标注图 PNG tEXt 标记（与后端 png_is_annotated 配对）
 *
 * 标记 chunk（keyword = "eleve-annotated"）是编辑协议（重绘铁律模板 + 比例锁定）
 * 的触发命脉：JPEG 无 tEXt，标注图必须 PNG；canvas 重编码会丢 chunk，任何
 * 中途重编码都必须调 insertPngAnnotatedText 补回。
 *
 * 🔴 2026-08-31 注意：图片缩放兜底**不在前端做**——后端 conversation_loop.rs
 * 已有 Hermes 对齐实现（shrink_image_parts_in_messages，LLM 层 4MB/2048）。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** PNG data URL 嵌入 tEXt "eleve-annotated=1"（插在 IHDR 之后 33B 处）。非 PNG 原样返回。 */
export const insertPngAnnotatedText = (dataUrl: string): string => {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return dataUrl // 非 PNG 回退
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
