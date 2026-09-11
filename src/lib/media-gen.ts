/**
 * 群聊「房间图生成」——网关生图能力的**唯一前端入口**。
 *
 * 对齐 Hermes `plugins/hermes-bots/group-chat-parts.tsx:65-96` 的 Generate：
 * - **没有 prompt 输入框**：prompt 由房间名 + 成员构造（`buildRoomImagePrompt`）
 * - `aspect_ratio: 'square'`
 * - 返回图交给调用方归一化（`normalizeSquareImage(256)`），与上传路径同一口径
 * - **有能力探测**（Hermes `avatar-image.ts:82` 用 `image.generate` 传 `{available}`
 *   探网关是否具备生图能力，据此决定按钮是否可用）
 *
 * 🔴 round-100 取证纠正（此前判断是错的）：我在 round-97/98 的遗留里写过
 * "需 `image.generate` 类 RPC；凭空造 RPC = 加接口债"——**不需要造任何接口**：
 * - 生图是**平台能力**（不归 bot 插件），网关已有 L2 无会话旁路的 HTTP 面：
 *   `handlers/media_gen.rs:4` 注释原文"生成管线 HTTP 端点，直调 eleve-tools-native
 *   provider registry"。端点 = `POST /v1/images/generations`
 *   （`api_server.rs:4396`）+ 探测 `GET /v1/images/providers`（`:4409`，每项带
 *   `available`）+ 轮询 `GET /v1/images/tasks/:id`（`:4405`）。
 * - 前端也早已有 HTTP base（`utils/bridge.ts` `getHttpBase()`）。
 * - 该路由组**无鉴权守卫**（仅 security-headers 中间件），本机调用无需 token。
 *
 * 所以本模块只做「拼请求 + 解析 + 转 data URL」，**复用**既有的
 * `resolveToEditableDataUrl`（任意 src → data URL；它已处理 `/media/*` 相对路径
 * 拼 gateway base 与 CORS）——不另写一份媒体解析。
 */
import { getHttpBase, discoverPort, isDesktop, isHttpBaseSet } from '../utils/bridge';
import { resolveToEditableDataUrl } from '../utils/media';

/** 生成失败（`code` = 网关错误码，缺省 `unknown`）。 */
export class ImageGenError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImageGenError';
    this.code = code;
  }
}

/**
 * 房间图生成用的 prompt —— 与 Hermes 逐字同构（`group-chat-parts.tsx:68-77`）：
 *
 * ```
 * `Group chat icon for an AI agent team called "${who}". `
 * + 'Friendly minimal emblem, bold flat vector style, solid color background, centered, no text.'
 * ```
 * `who` = 房间名 + （有成员时）` — a team of A, B`。
 *
 * 有意保留英文（不翻译）：prompt 是喂模型的，Hermes 原文即英文；换中文会改变
 * 出图风格与构图稳定性，"逐字同构"才是对齐。
 */
export function buildRoomImagePrompt(name: string, memberHandles: string[] = []): string {
  const members = memberHandles.map((h) => String(h || '').trim()).filter(Boolean);
  const who = [String(name || '').trim(), members.length ? `a team of ${members.join(', ')}` : '']
    .filter(Boolean)
    .join(' — ');
  return (
    `Group chat icon for an AI agent team called "${who || 'a bot team'}". ` +
    'Friendly minimal emblem, bold flat vector style, solid color background, centered, no text.'
  );
}

/** 网关错误体（OpenAI 风格：`{error:{message,type,code?}}`）→ 可读中文。 */
export function describeGenError(status: number, body: unknown): string {
  const detail = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  const code = typeof detail?.code === 'string' ? detail.code : '';
  const message = typeof detail?.message === 'string' ? detail.message : '';
  switch (code) {
    case 'provider_unavailable':
      // 网关原文："No image generation provider available (no API key configured?)"
      return '还没有可用的生图渠道——请先在设置里配置一个生图模型';
    case 'provider_not_registered':
      return message || '配置的生图渠道未注册（网关未加载该 provider）';
    default:
      return message || `生图请求失败（HTTP ${status}）`;
  }
}

/** 惰性确保 HTTP base 已发现（桌面端首次 HTTP 调用前必须先 discoverPort）。 */
async function ensureHttpBase(): Promise<string> {
  if (isDesktop() && !isHttpBaseSet()) {
    await discoverPort();
  }
  return getHttpBase().replace(/\/+$/, '');
}

/**
 * 探测后端是否具备生图能力（对齐 Hermes `{available}` probe 语义）。
 * 任一 provider 报告 `available` 即可用；网络失败/无 provider → false
 * （按钮据此禁用，**给出明确理由**，而不是让用户点了等超时才报错）。
 */
export async function probeImageGen(): Promise<boolean> {
  try {
    const base = await ensureHttpBase();
    const resp = await fetch(`${base}/v1/images/providers`);
    if (!resp.ok) return false;
    const body = (await resp.json()) as { providers?: Array<{ available?: boolean }> };
    return Array.isArray(body?.providers) && body.providers.some((p) => p?.available === true);
  } catch {
    return false;
  }
}

/**
 * 生成一张图并返回 **data URL**（未归一化——归一化是房间图契约，由调用方做）。
 *
 * 响应形如 `{data:[{url}], provider, model_id, upscaled}`，`url` 可能是
 * `/media/images/<hash>` 相对路径（网关本地化）或远程 URL —— 两者都交给
 * `resolveToEditableDataUrl` 处理（它已覆盖这两种 + 本地文件路径）。
 */
export async function generateRoomImage(prompt: string): Promise<string> {
  const base = await ensureHttpBase();
  const resp = await fetch(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, aspect_ratio: 'square', n: 1 }),
  });

  if (!resp.ok) {
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      /* 非 JSON 错误体：只用 HTTP 状态描述 */
    }
    throw new ImageGenError(
      (body as { error?: { code?: string } } | null)?.error?.code ?? 'http_error',
      describeGenError(resp.status, body),
    );
  }

  const body = (await resp.json()) as { data?: Array<{ url?: string }> };
  const raw = body?.data?.[0]?.url;
  if (!raw) {
    throw new ImageGenError('empty_response', '生图返回为空（网关未给出图片地址）');
  }

  const dataUrl = await resolveToEditableDataUrl(raw);
  if (!dataUrl) {
    throw new ImageGenError('fetch_failed', '图片已生成，但下载失败（网关不可达？）');
  }
  return dataUrl;
}
