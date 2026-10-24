/**
 * room-mention-decorate — 群聊消息文本的 @提及 accent 内联渲染
 * （2026-10-24，对齐 Hermes `group-mention-text.tsx`）。
 *
 * Hermes 语义（`group-mention-text.tsx:4-11,31-68`）：
 * - 呈现是纯装饰：存储文本 / 复制 / prompt 一律不变；
 * - 染色判定与回合同一个解析器——"染不染色 = 路由认不认"；
 * - 形态 = accent 内联引用（**非 pill**）；code span 内的 @、未知 @word、
 *   邮箱保持原文。
 *
 * ELEVE 形态：markdown 走 StreamBlocks（innerHTML 管线，组件覆盖无注入点），
 * 故用 DOM 后处理（与 enhanceRichFences 同款模式）：TreeWalker 扫文本节点，
 * 跳过 code/pre/a/script/style 与已装饰 span；命中包
 * `<span data-mention={kind}>`。
 */

/** 与后端 `policy.rs::resolve_mentions` 同源的可路由词表：成员 handle +
 *  display_name（后端支持中文 display 匹配）+ everyone/all + user。 */
export type RoomMentionKind = 'agent' | 'broadcast' | 'human';

export interface RoomMentionMember {
  handle?: string;
  display_name?: string;
}

/** token（不含 @）→ 类别；未命中 = null（保持原文，对齐 Hermes 未知 @word） */
export function classifyRoomMention(
  token: string,
  members: readonly RoomMentionMember[],
): RoomMentionKind | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === 'everyone' || t === 'all') return 'broadcast';
  if (t === 'user') return 'human';
  for (const m of members) {
    const handle = String(m.handle || '').trim().toLowerCase();
    const display = String(m.display_name || '').trim().toLowerCase();
    if ((handle && t === handle) || (display && t === display)) return 'agent';
  }
  return null;
}

/** token 词表（CJK 扩展与 mentionTokenAt 同源；`.` 使邮箱第二段整体成一个
 *  未知 token——与 Hermes `/@([a-z0-9][a-z0-9._-]*)/gi` 的取舍一致，染不上色）。 */
const MENTION_TOKEN_RE = /@([\w一-龥.-]+)/gu;
/** acceptNode 探测专用（非全局——带 /g 的正则 test() 会推进 lastIndex，
 *  把 TreeWalker 过滤搞成隔行漏检）。 */
const MENTION_TEST_RE = /@([\w一-龥.-]+)/u;

export interface MentionSegment {
  text: string;
  kind?: RoomMentionKind;
}

/** 纯函数分段（可测）：命中词表的 @token 成段，其余原文连段。 */
export function splitMentionSegments(
  text: string,
  members: readonly RoomMentionMember[],
): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(MENTION_TOKEN_RE))) {
    const at = m.index ?? 0;
    const kind = classifyRoomMention(m[1], members);
    if (!kind) continue;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: `@${m[1]}`, kind });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const KIND_TITLE: Record<RoomMentionKind, string> = {
  agent: '房间内成员',
  broadcast: '全体成员',
  human: '指给用户（人）',
};

/** 装饰器跳过的祖先（code span/块、链接、脚本、已装饰节点保持原文/原状）。 */
const SKIP_SELECTOR = 'code, pre, a, script, style, [data-mention]';

/**
 * DOM 后处理：root 下所有文本节点的命中 @token 包 accent span。
 * 幂等（已装饰节点在 SKIP 集合内）；StreamBlocks 落定重渲染重建 innerHTML 后
 * 需重扫（调用方在无 deps 的 effect 里每次渲染后调用本函数即可）。
 */
export function decorateRoomMentions(
  root: HTMLElement,
  members: readonly RoomMentionMember[],
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      if (!el || el.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return MENTION_TEST_RE.test(node.nodeValue || '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  // 先收集再改：边遍历边改文本节点会让 walker 位置失效
  const hits: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    hits.push(n as Text);
    n = walker.nextNode();
  }
  for (const node of hits) {
    const segs = splitMentionSegments(node.nodeValue || '', members);
    if (!segs.some((s) => s.kind)) continue;
    const frag = document.createDocumentFragment();
    for (const seg of segs) {
      if (!seg.kind) {
        frag.appendChild(document.createTextNode(seg.text));
        continue;
      }
      const span = document.createElement('span');
      // accent 内联引用（非 pill），对齐 Hermes `<span class="ref font-medium">`
      span.className = 'text-primary font-medium';
      span.dataset.mention = seg.kind;
      span.title = KIND_TITLE[seg.kind];
      span.textContent = seg.text;
      frag.appendChild(span);
    }
    node.replaceWith(frag);
  }
}
