/**
 * completion-error — legacy 错误文本启发式（对齐 Hermes use-message-stream/utils.ts L74-88）
 *
 * Gateway/provider 失败有时以 message.complete 的 text 形式到达（200 响应但内容是
 * 错误串），而非结构化 error 帧。匹配则按 inline assistant 错误处理（标 error 气泡 +
 * 剥文本），与结构化 failure（C-1）同一呈现路径。
 */
const COMPLETION_ERROR_PATTERNS = [
  /^API call failed after \d+ retries:/i,
  /^HTTP\s+\d{3}\b/i,
  /^(Provider|Gateway)\s+error:/i,
]

export function completionErrorText(finalText: string): string | null {
  const text = finalText.trim()
  return text && COMPLETION_ERROR_PATTERNS.some((re) => re.test(text)) ? text : null
}
