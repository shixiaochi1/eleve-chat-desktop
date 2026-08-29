/**
 * preview-act-engine — Agent 驱动预览页面（🔴 2026-08-29 对齐 Hermes preview-act
 * 引擎 + drive_preview_tool.py 语义）
 *
 * 在预览子 webview 内注入执行（Tauri `preview_webview_eval_js`），提供：
 * - elements 清点：可见可交互元素 → ref（`btn-sign-in` / `inp-email` 形态）+
 *   role/label/value 清单；打 `data-eleve-ref` 标记 + css 路径指纹持久化
 * - ref 解析：标记优先 → 路径指纹 → 文本兜底（页面重渲染后 ref 仍holds =
 *   rebound，无需 Agent 干预）；仅导航使 refs 失效（stale）
 * - 动作：click / hover / type（native setter + input/change，React 兼容）/
 *   press / scroll / strobe（批量高亮）/ back / forward / reload
 * - delta 应答：added 全量 / changed 仅动过的字段 / removed / same 计数——
 *   首次返回全量 inventory，之后 Agent 只收变化
 *
 * 平台差异：Hermes 用 Electron sendInputEvent（真实 Chromium 输入）；wry 无
 * 跨平台输入注入 API → 用页面内合成 DOM 事件（dispatchEvent）替代，hover
 * 菜单/表单校验均可见。
 */

/** 动作 payload → 引擎 JS（页面内 IIFE，返回 JSON 字符串） */
export function buildPreviewActJs(payload: Record<string, unknown>): string {
  return `
var P = ${JSON.stringify(payload)};
var S = window.__eleveAct || (window.__eleveAct = { refs: {}, inv: null, url: null });
var NAV = location.href;
var STALE = S.url !== null && S.url !== NAV;
S.url = NAV;

function vis(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}
function interactive(el) {
  var t = el.tagName;
  if (t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'SUMMARY') return true;
  if (el.isContentEditable) return true;
  var r = el.getAttribute('role');
  if (r === 'button' || r === 'link' || r === 'checkbox' || r === 'radio' || r === 'tab' || r === 'menuitem' || r === 'option' || r === 'switch') return true;
  return !!(el.onclick || el.getAttribute('tabindex'));
}
function roleOf(el) {
  var r = el.getAttribute('role');
  if (r) return r;
  var t = el.tagName.toLowerCase();
  if (t === 'a') return 'link';
  if (t === 'input') {
    var it = el.type;
    if (it === 'checkbox') return 'checkbox';
    if (it === 'radio') return 'radio';
    if (it === 'submit' || it === 'button') return 'button';
    return 'textbox';
  }
  if (t === 'textarea' || el.isContentEditable) return 'textbox';
  if (t === 'select') return 'combobox';
  if (t === 'summary') return 'summary';
  return 'button';
}
function labelOf(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    var t = (el.labels && el.labels[0]) ? el.labels[0].innerText.trim() : '';
    return t || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.type || '';
  }
  return (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
}
function refPrefix(r) {
  var m = { link: 'lnk', textbox: 'inp', checkbox: 'chk', radio: 'rad', combobox: 'sel', summary: 'sum' };
  return m[r] || 'btn';
}
function kebab(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x';
}
function cssPath(el) {
  var parts = [];
  var node = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    var sel = node.tagName.toLowerCase();
    var p = node.parentElement;
    if (p) {
      var sibs = Array.prototype.filter.call(p.children, function (c) { return c.tagName === node.tagName; });
      if (sibs.length > 1) sel += ':nth-child(' + (Array.prototype.indexOf.call(p.children, node) + 1) + ')';
    }
    parts.unshift(sel);
    node = p;
  }
  return parts.join('>');
}
function findByPath(p) {
  try { return document.querySelector(p); } catch (e) { return null; }
}
function scan() {
  var nodes = document.querySelectorAll('button,a,input,textarea,select,summary,[role],[onclick],[contenteditable]');
  var out = [];
  nodes.forEach(function (el) {
    if (!interactive(el) || !vis(el)) return;
    var role = roleOf(el);
    var label = labelOf(el);
    var ref = refPrefix(role) + '-' + kebab(label);
    var base = ref, n = 2;
    while (out.some(function (o) { return o.ref === ref; })) { ref = base + '-' + (n++); }
    var entry = {
      ref: ref, role: role, label: label, tag: el.tagName.toLowerCase(),
      value: el.value !== undefined ? String(el.value).slice(0, 80) : '',
      disabled: !!el.disabled,
      path: cssPath(el)
    };
    if (el.tagName === 'A' && el.href) entry.href = el.href.slice(0, 120);
    out.push(entry);
  });
  return out.slice(0, P.max || 120);
}
function mark(inv) {
  S.refs = {};
  inv.forEach(function (o) {
    S.refs[o.ref] = o;
    var el = findByPath(o.path);
    if (el) el.setAttribute('data-eleve-ref', o.ref);
  });
}
function findEl(ref) {
  if (!ref) return null;
  var safe = ref.replace(/"/g, '\\\\"');
  var byMark = document.querySelector('[data-eleve-ref="' + safe + '"]');
  if (byMark && vis(byMark)) return byMark;
  var d = S.refs[ref];
  if (!d) return null;
  var el = findByPath(d.path);
  if (el && vis(el)) { el.setAttribute('data-eleve-ref', ref); return el; }
  var cand = Array.prototype.filter.call(document.querySelectorAll(d.tag || '*'), function (x) {
    return labelOf(x) === d.label && vis(x);
  })[0];
  if (cand) { cand.setAttribute('data-eleve-ref', ref); return cand; }
  return null;
}
function fire(el, type, opts) {
  el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, view: window }, opts || {})));
}
function doClick(el) {
  el.scrollIntoView({ block: 'center' });
  var r = el.getBoundingClientRect();
  var o = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  fire(el, 'pointerover', o); fire(el, 'mouseover', o); fire(el, 'mousemove', o);
  fire(el, 'mousedown', o);
  if (el.focus) el.focus();
  fire(el, 'mouseup', o); fire(el, 'click', o);
}
function doHover(el) {
  el.scrollIntoView({ block: 'center' });
  var r = el.getBoundingClientRect();
  var o = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  fire(el, 'pointerover', o); fire(el, 'mouseover', o); fire(el, 'mousemove', o);
  el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({ bubbles: false, cancelable: true, view: window }, o)));
}
function doType(el, text, submit) {
  el.scrollIntoView({ block: 'center' });
  el.focus();
  var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    var f = el.form;
    if (f && typeof f.requestSubmit === 'function') f.requestSubmit();
    else if (f) f.submit();
  }
}
function doPress(key) {
  var el = document.activeElement || document.body;
  var o = { key: key, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', o));
  el.dispatchEvent(new KeyboardEvent('keyup', o));
}
function doScroll(el, amount, to) {
  if (!el) {
    if (to === 'top') window.scrollTo(0, 0);
    else if (to === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
    else window.scrollBy(0, (amount === undefined || amount === null) ? Math.round(window.innerHeight * 0.85) : amount);
    return;
  }
  if (to === 'top') el.scrollTop = 0;
  else if (to === 'bottom') el.scrollTop = el.scrollHeight;
  else el.scrollTop += (amount === undefined || amount === null) ? Math.round(el.clientHeight * 0.85) : amount;
}
function delta(next) {
  var prev = S.inv || [];
  var prevMap = {}; prev.forEach(function (o) { prevMap[o.ref] = o; });
  var nextMap = {}; next.forEach(function (o) { nextMap[o.ref] = o; });
  var d = { added: [], changed: [], removed: [], rebound: [], same: 0 };
  next.forEach(function (o) {
    var p = prevMap[o.ref];
    if (!p) { d.added.push(o); return; }
    var keys = [];
    ['label', 'value', 'disabled'].forEach(function (k) {
      if (String(p[k]) !== String(o[k])) keys.push(k);
    });
    if (keys.length) { var ch = { ref: o.ref }; keys.forEach(function (k) { ch[k] = o[k]; }); d.changed.push(ch); }
    else d.same++;
  });
  prev.forEach(function (o) { if (!nextMap[o.ref]) d.removed.push(o.ref); });
  return d;
}
function rescan() {
  var inv2 = scan();
  mark(inv2);
  var d = delta(inv2);
  S.inv = inv2;
  return d;
}
function strobe() {
  var key = document.createElement('style');
  key.textContent = '@keyframes eleveStrobe{0%,100%{outline:0 solid transparent}50%{outline:2px solid #f59e0b}}';
  var cls = document.createElement('style');
  cls.textContent = '[data-eleve-ref]{animation:eleveStrobe .5s ease 2}';
  document.head.appendChild(key);
  document.head.appendChild(cls);
  setTimeout(function () { key.remove(); cls.remove(); }, 1200);
}

// ── 持久标注层（🔴 2026-08-29 对齐 Hermes annotate overlay：annotation 绑定
//    元素而非坐标——随滚动/重排跟随，元素从 DOM 消失即消失；导航 = 新文档 =
//    全部清除，无需 Agent 逐个 take down）──
S.pins = S.pins || {};
var overlayLayer = null;
function ensureOverlayLayer() {
  if (overlayLayer) return overlayLayer;
  overlayLayer = document.createElement('div');
  overlayLayer.id = 'eleve-act-overlay';
  overlayLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  document.body.appendChild(overlayLayer);
  var sync = function () {
    Object.keys(S.pins).forEach(function (ref) {
      var p = S.pins[ref];
      if (!p.el || !p.el.isConnected) { removePin(ref); return; }
      var r = p.el.getBoundingClientRect();
      p.box.style.left = r.x + 'px';
      p.box.style.top = r.y + 'px';
      p.box.style.width = r.width + 'px';
      p.box.style.height = r.height + 'px';
    });
  };
  window.addEventListener('scroll', sync, true);
  window.addEventListener('resize', sync);
  setInterval(sync, 800); // 重排兜底（低频轮询；MutationObserver 更重，v1 从简）
  return overlayLayer;
}
function addPin(ref, label, el) {
  var target = el || findEl(ref) || (P.selector ? document.querySelector(P.selector) : null);
  if (!target) return false;
  removePin(ref);
  var layer = ensureOverlayLayer();
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;border:2px solid #f59e0b;border-radius:3px;background:rgba(245,158,11,0.08);pointer-events:none;';
  var lab = document.createElement('div');
  lab.style.cssText = 'position:absolute;left:0;top:-18px;max-width:240px;padding:1px 6px;font:600 11px/16px system-ui,sans-serif;color:#111;background:#f59e0b;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  lab.textContent = label || ref;
  box.appendChild(lab);
  layer.appendChild(box);
  var r = target.getBoundingClientRect();
  box.style.left = r.x + 'px';
  box.style.top = r.y + 'px';
  box.style.width = r.width + 'px';
  box.style.height = r.height + 'px';
  S.pins[ref] = { el: target, box: box };
  return true;
}
function removePin(ref) {
  var p = S.pins[ref];
  if (!p) return false;
  p.box.remove();
  delete S.pins[ref];
  return true;
}
function clearPins() {
  var n = 0;
  Object.keys(S.pins).forEach(function (ref) {
    if (removePin(ref)) n += 1;
  });
  return n;
}
function holdAll() {
  clearPins();
  var inv = scan();
  mark(inv);
  S.inv = inv;
  inv.forEach(function (o) { addPin(o.ref, o.label); });
  return Object.keys(S.pins).length;
}

var result = { ok: true, url: NAV, title: document.title || '' };
var act = P.action;

if (STALE) {
  // 导航使全部 refs 失效（对齐 Hermes：only a navigation retires them）——
  // 强制全量清单 + stale 标记，Agent 需按新 refs 重新行动
  var invStale = scan();
  mark(invStale);
  S.inv = invStale;
  result.stale = true;
  result.elements = invStale;
  result.delta = { added: invStale, changed: [], removed: [], rebound: [], same: 0 };
} else if (act === 'elements') {
  var inv = scan();
  mark(inv);
  S.inv = inv;
  result.elements = inv;
  result.delta = delta(inv);
} else if (act === 'click' || act === 'hover') {
  var el = findEl(P.ref) || (P.selector ? document.querySelector(P.selector) : null);
  if (!el) { result.ok = false; result.error = 'element not found: ' + (P.ref || P.selector); }
  else {
    if (P.ref) el.setAttribute('data-eleve-ref', P.ref);
    if (act === 'click') doClick(el); else doHover(el);
    result.delta = rescan();
  }
} else if (act === 'type') {
  var el = findEl(P.ref) || (P.selector ? document.querySelector(P.selector) : null);
  if (!el) { result.ok = false; result.error = 'element not found: ' + (P.ref || P.selector); }
  else {
    if (P.ref) el.setAttribute('data-eleve-ref', P.ref);
    doType(el, P.text === undefined ? '' : String(P.text), !!P.submit);
    result.delta = rescan();
  }
} else if (act === 'press') {
  doPress(P.key || 'Enter');
  result.delta = rescan();
} else if (act === 'scroll') {
  var el = P.ref ? findEl(P.ref) : null;
  if (P.ref && !el) { result.ok = false; result.error = 'element not found: ' + P.ref; }
  else { doScroll(el, P.amount, P.to); result.delta = rescan(); }
} else if (act === 'strobe') {
  if (!S.inv || S.inv.length === 0) { var inv = scan(); mark(inv); S.inv = inv; }
  strobe();
  result.note = 'highlight burst played';
} else if (act === 'back') {
  history.back();
  result.note = 'navigating back';
} else if (act === 'forward') {
  history.forward();
  result.note = 'navigating forward';
} else if (act === 'reload') {
  result.note = 'reloading';
  setTimeout(function () { location.reload(); }, 0);
} else if (act === 'pin') {
  // 🔴 2026-08-29 对齐 Hermes annotate_preview（WIRE: add→pin）：持久标注单个元素
  var added = addPin(P.ref || '', P.text || '');
  if (!added) {
    result.ok = false;
    result.error = 'element not found: ' + (P.ref || P.selector);
  } else {
    result.count = Object.keys(S.pins).length;
  }
} else if (act === 'hold') {
  // 对齐 Hermes hold：冻结整个可见字段——每个可交互元素都画框命名
  result.count = holdAll();
} else if (act === 'unpin') {
  // 对齐 Hermes WIRE（remove/clear→unpin）：带 ref 摘一个，无 ref 清全部
  if (P.ref) {
    result.removed = removePin(P.ref);
    if (!result.removed) result.note = 'no such annotation: ' + P.ref;
  } else {
    result.cleared = clearPins();
  }
} else {
  result.ok = false;
  result.error = 'unknown action: ' + act;
}

return JSON.stringify(result);
`.trim();
}
