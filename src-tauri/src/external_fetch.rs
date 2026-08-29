// eleve-chat-desktop/src-tauri/src/external_fetch.rs
//!
//! Link 标题抓取（🔴 2026-08-29 对齐 Hermes hermesDesktop.fetchLinkTitle 主进程桥）
//!
//! 为什么在 Rust 抓：CORS 只约束浏览器环境内的 fetch——Hermes renderer 受同样
//! 约束，所以它从不直连外网，抓取放 Electron 主进程（Node.js，无 CORS）；
//! ELEVE 的等价物就是这里（reqwest，同为本地进程直发请求，无 CORS）。
//! 前端 lib/use-link-title.ts 的缓存/in-flight/订阅模式逐条对齐
//! Hermes lib/external-link.tsx，通道换成 Tauri invoke。

use regex::Regex;

/// 抓取网页 `<title>`。仅 http(s) 且非本地 host（对齐 Hermes isTitleFetchable）；
/// 5s 超时；body 只读前 256KB（`<title>` 一定在头部）；非 HTML 内容类型返回空。
/// 失败返回 Err（前端按 Hermes 语义降级为空串 → 显示 URL 末段）。
#[tauri::command]
pub async fn fetch_link_title(url: String) -> Result<String, String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http/https urls are fetchable".into());
    }
    if let Some(host) = parsed.host_str() {
        // 对齐 Hermes LOCAL_HOST_RE：本地 host 无抓取意义（dev server / 回环）
        if matches!(host.to_ascii_lowercase().as_str(), "localhost" | "0.0.0.0") || host == "127.0.0.1" || host == "[::1]" {
            return Err("local hosts are not fetchable".into());
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (compatible; EleveAgent/1.0; link-title)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(content_type.is_empty() || content_type.contains("text/html") || content_type.contains("xhtml")) {
        return Ok(String::new());
    }

    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    let head = String::from_utf8_lossy(&body[..body.len().min(262_144)]);

    // <title> 提取（含属性/跨行；(?is) 大小写不敏感 + . 匹配换行）
    let re = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").map_err(|e| e.to_string())?;
    let raw = re
        .captures(&head)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .unwrap_or_default();

    Ok(decode_basic_entities(raw.trim()))
}

// ═══════════════════════════════════════════════════════════════════════════
// Favicon 解析（🔴 2026-08-29 对齐 Hermes electron/favicon.ts "the thorough way"）
//
// `<origin>/favicon.ico` 只能回答约一半的网站；其余站点把图标声明在页面
// head（`<link rel="icon">`、apple-touch、SVG mask）或 web app manifest 里，
// 路径常是 CDN 上带 hash 的构建产物——猜不到。所以：读页面、收集全部声明
// 图标、按分排名，最后才回退 well-known 路径。
//
// 只问站点自己的图标。第三方图标服务虽能替 bot-wall 后面的 host 应答，
// 但问它就等于把用户在用的站点告诉第三方——读不到的站点保留占位字形。
// 这些在主进程做（同 Hermes）：renderer 受 CORS 约束读不了跨域 HTML。

use base64::Engine as _;
use std::collections::HashMap;
use tauri::Url;

/// 图标候选（Hermes IconCandidate：URL + 粗略像素边/可缩放合成分）
#[derive(Clone, Debug)]
struct IconCandidate {
    url: String,
    score: i32,
}

/// 分数表（Hermes 常量逐条对齐）：可缩放 > 任意尺寸 > 声明尺寸 > 未声明 > 猜测
const SCORE_SVG: i32 = 1024;
const SCORE_ANY: i32 = 512;
const SCORE_APPLE_TOUCH: i32 = 180;
const SCORE_UNSIZED: i32 = 96;
const SCORE_GUESS: i32 = 48;
const SCORE_CEILING: i32 = 512;

/// 有资格问图标的 host（Hermes isPublicHttpUrl 逐条对齐）：仅 http(s)，
/// 拒绝 loopback/RFC1918/链路本地/localhost/.local/.internal/无点 host——
/// 内网跑的是服务端点不是品牌，同时保证私有主机名不会被发给任何外部服务。
fn is_public_http_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    !(host == "localhost"
        || matches!(host.as_str(), "::1" | "[::1]")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || !host.contains('.')
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || is_172_private(&host))
}

/// 172.16-31.x.x（Hermes 正则 `/^172\.(1[6-9]|2\d|3[01])\./` 的等价实现）
fn is_172_private(host: &str) -> bool {
    let Some(rest) = host.strip_prefix("172.") else {
        return false;
    };
    let Some(second) = rest.split('.').next() else {
        return false;
    };
    second
        .parse::<u16>()
        .map(|n| (16..=31).contains(&n))
        .unwrap_or(false)
}

/// 相对 href → 绝对 http(s) URL（Hermes absolute：join 后只接受 http/https）
fn absolute(href: &str, base: &str) -> String {
    let Ok(base_url) = Url::parse(base) else {
        return String::new();
    };
    match base_url.join(href.trim()) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => u.to_string(),
        _ => String::new(),
    }
}

/// 标签属性提取（Hermes attr：双引号/单引号/无引号三态，大小写不敏感）
fn tag_attr(tag: &str, name: &str) -> String {
    let pattern = format!(r#"(?i)\b{}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#, name);
    Regex::new(&pattern)
        .ok()
        .and_then(|re| re.captures(tag))
        .and_then(|caps| {
            caps.iter()
                .skip(1)
                .find_map(|g| g.map(|m| m.as_str().to_string()))
        })
        .unwrap_or_default()
}

/// "180x180 32x32" → 180（取最大声明方形边）；"any" → 512（Hermes SCORE_ANY 合成分）
fn largest_declared_size(sizes: &str) -> i32 {
    let mut best = 0;
    for token in sizes.to_lowercase().split_whitespace() {
        if token == "any" {
            best = best.max(SCORE_ANY);
            continue;
        }
        if let Some(edge) = token.split('x').next().and_then(|v| v.parse::<i32>().ok()) {
            best = best.max(edge);
        }
    }
    best
}

/// rel/type/sizes → 分数（Hermes scoreFor：SVG 类可缩放封顶；声明尺寸截到
/// 512 上限；apple-touch 无尺寸 180；完全未声明 96）
fn score_for(rel: &str, type_: &str, sizes: &str) -> i32 {
    if type_.contains("svg") || rel.contains("mask-icon") {
        return SCORE_SVG;
    }
    let declared = largest_declared_size(sizes);
    if declared > 0 {
        return declared.min(SCORE_CEILING);
    }
    if rel.contains("apple-touch-icon") {
        SCORE_APPLE_TOUCH
    } else {
        SCORE_UNSIZED
    }
}

const LINK_TAG_RE: &str = r"(?i)<link\b[^>]*>";

/// 页面 `<link rel=...>` 声明的全部图标（Hermes iconCandidatesFromHtml：
/// `<base href>` 归一基址 + 六种 rel + 评分）
fn icon_candidates_from_html(html: &str, page_url: &str) -> Vec<IconCandidate> {
    let base_tag = Regex::new(r"(?i)<base\b[^>]*>")
        .ok()
        .and_then(|re| re.find(html))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let base_href = tag_attr(&base_tag, "href");
    let base = if base_href.is_empty() {
        page_url.to_string()
    } else {
        let joined = absolute(&base_href, page_url);
        if joined.is_empty() {
            page_url.to_string()
        } else {
            joined
        }
    };

    let Ok(link_re) = Regex::new(LINK_TAG_RE) else {
        return Vec::new();
    };
    let Ok(rel_re) = Regex::new(
        r"(?i)\b(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|fluid-icon|mask-icon)\b",
    ) else {
        return Vec::new();
    };

    let mut candidates = Vec::new();
    for m in link_re.find_iter(html) {
        let tag = m.as_str();
        let rel = tag_attr(tag, "rel").to_lowercase();
        if !rel_re.is_match(&rel) {
            continue;
        }
        let url = absolute(&tag_attr(tag, "href"), &base);
        if url.is_empty() {
            continue;
        }
        let type_ = tag_attr(tag, "type").to_lowercase();
        let sizes = tag_attr(tag, "sizes");
        candidates.push(IconCandidate {
            url,
            score: score_for(&rel, &type_, &sizes),
        });
    }
    candidates
}

/// 页面声明的 web app manifest URL（Hermes manifestUrlFromHtml）
fn manifest_url_from_html(html: &str, page_url: &str) -> String {
    let Ok(link_re) = Regex::new(LINK_TAG_RE) else {
        return String::new();
    };
    for m in link_re.find_iter(html) {
        let tag = m.as_str();
        let rel = tag_attr(tag, "rel");
        if Regex::new(r"(?i)\bmanifest\b").is_ok_and(|re| re.is_match(&rel)) {
            let url = absolute(&tag_attr(tag, "href"), page_url);
            if !url.is_empty() {
                return url;
            }
        }
    }
    String::new()
}

/// PWA manifest 图标（Hermes iconCandidatesFromManifest：192px/512px 是为
/// 独立立于主屏设计的，正是我们要的用途；JSON 解析失败返回空）
fn icon_candidates_from_manifest(raw: &str, manifest_url: &str) -> Vec<IconCandidate> {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(icons) = parsed.get("icons").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for icon in icons {
        let src = icon.get("src").and_then(|v| v.as_str()).unwrap_or("");
        let url = absolute(src, manifest_url);
        if url.is_empty() {
            continue;
        }
        let type_ = icon
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let sizes = icon.get("sizes").and_then(|v| v.as_str()).unwrap_or("");
        candidates.push(IconCandidate {
            url,
            score: score_for("", &type_, sizes),
        });
    }
    candidates
}

/// scheme://host[:port]（JS url.origin 等价：默认端口省略）
fn origin_of(url: &Url) -> String {
    match url.port() {
        Some(p) => format!("{}://{}:{}", url.scheme(), url.host_str().unwrap_or(""), p),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")),
    }
}

/// well-known 猜测路径（Hermes fallbackIconCandidates）：origin + apex 各四条
/// ——厂商常在 example.com 提供图标而 api.example.com 什么都没有
fn fallback_icon_candidates(page_url: &str) -> Vec<IconCandidate> {
    let Ok(url) = Url::parse(page_url) else {
        return Vec::new();
    };
    let labels: Vec<&str> = url.host_str().unwrap_or("").split('.').collect();
    let apex = if labels.len() > 2 {
        format!("{}://{}", url.scheme(), labels[labels.len() - 2..].join("."))
    } else {
        origin_of(&url)
    };
    let mut origins = vec![origin_of(&url), apex];
    origins.dedup();

    let mut out = Vec::new();
    for origin in origins {
        out.push(IconCandidate {
            url: format!("{origin}/apple-touch-icon.png"),
            score: SCORE_GUESS + 2,
        });
        out.push(IconCandidate {
            url: format!("{origin}/apple-touch-icon-precomposed.png"),
            score: SCORE_GUESS + 1,
        });
        out.push(IconCandidate {
            url: format!("{origin}/favicon.ico"),
            score: SCORE_GUESS,
        });
        out.push(IconCandidate {
            url: format!("{origin}/favicon.png"),
            score: SCORE_GUESS - 1,
        });
    }
    out
}

/// 同 URL 取最高分 → 按分降序 → 截断（Hermes rankCandidates：声明二十个
/// 图标的页面不能把一张卡变成二十个请求）
fn rank_candidates(candidates: Vec<IconCandidate>, limit: usize) -> Vec<IconCandidate> {
    let mut best: HashMap<String, i32> = HashMap::new();
    for c in candidates {
        best.entry(c.url)
            .and_modify(|s| *s = (*s).max(c.score))
            .or_insert(c.score);
    }
    let mut ranked: Vec<IconCandidate> = best
        .into_iter()
        .map(|(url, score)| IconCandidate { url, score })
        .collect();
    ranked.sort_by(|a, b| b.score.cmp(&a.score));
    ranked.truncate(limit);
    ranked
}

/// 魔数嗅探（Hermes sniffImageMime）：一堆服务器把图标按
/// application/octet-stream 发、把 HTML 错误页按 image/png 发
fn sniff_image_mime(bytes: &[u8]) -> String {
    let at = |offset: usize, sig: &[u8]| bytes.get(offset..offset + sig.len()) == Some(sig);
    if at(0, &[0x89, 0x50, 0x4e, 0x47]) {
        return "image/png".into();
    }
    if at(0, &[0xff, 0xd8, 0xff]) {
        return "image/jpeg".into();
    }
    if at(0, &[0x47, 0x49, 0x46, 0x38]) {
        return "image/gif".into();
    }
    if at(0, &[0x00, 0x00, 0x01, 0x00]) {
        return "image/x-icon".into();
    }
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return "image/webp".into();
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_lowercase();
    if head.contains("<svg") {
        "image/svg+xml".into()
    } else {
        String::new()
    }
}

/// 这些字节可信的 mime，不是图片返回空（Hermes imageMime：字节说了算，
/// 绝不信 header——被拦的请求常以 image/png 头回 200 的 HTML 挑战页，
/// 信 server 就等着渲染破图框）。<48 字节一律拒绝；
/// SVG 许可注释把 `<svg` 推出嗅探窗口时，仍信任 header 的 svg 声明。
fn image_mime(declared: &str, bytes: &[u8]) -> String {
    if bytes.len() < 48 {
        return String::new();
    }
    let sniffed = sniff_image_mime(bytes);
    if !sniffed.is_empty() {
        return sniffed;
    }
    if declared.to_lowercase().contains("svg") {
        "image/svg+xml".into()
    } else {
        String::new()
    }
}

/// 解析站点图标为 data URL（Hermes resolveFavicon 全阶梯）：读页面收集声明
/// 图标 + manifest 图标，最后回退 well-known 猜测；按分排名逐个取图，魔数
/// 验收后编 base64 data URL——data URL 而非链接，渲染端免二次网络往返、
/// 站点挂了图标仍在、一个缓存串覆盖所有展示面。
/// 不可得一律 Ok("")（前端缓存空串语义 = 已完整走完阶梯仍失败，不重试）。
#[tauri::command]
pub async fn fetch_favicon(url: String) -> Result<String, String> {
    if !is_public_http_url(&url) {
        return Ok(String::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (compatible; EleveAgent/1.0; favicon)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut candidates: Vec<IconCandidate> = Vec::new();

    // 1) 页面 HTML（icon <link> 声明必在 head，读前 256KB 足够）
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(body) = resp.bytes().await {
            let html = String::from_utf8_lossy(&body[..body.len().min(262_144)]).into_owned();
            candidates.extend(icon_candidates_from_html(&html, &url));

            let manifest_url = manifest_url_from_html(&html, &url);
            if !manifest_url.is_empty() {
                if let Ok(mresp) = client.get(&manifest_url).send().await {
                    if let Ok(mbody) = mresp.bytes().await {
                        let manifest =
                            String::from_utf8_lossy(&mbody[..mbody.len().min(262_144)]).into_owned();
                        candidates.extend(icon_candidates_from_manifest(&manifest, &manifest_url));
                    }
                }
            }
        }
    }

    // 2) well-known 猜测路径（声明一个没找到时兜底）
    candidates.extend(fallback_icon_candidates(&url));

    // 3) 按分逐个取图——读不到的站点保留占位字形（绝不问第三方图标服务）
    for candidate in rank_candidates(candidates, 6) {
        let Ok(resp) = client.get(&candidate.url).send().await else {
            continue;
        };
        let declared = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let Ok(bytes) = resp.bytes().await else {
            continue;
        };
        // 图标不是下载文件：1MB 封顶
        if bytes.len() > 1_048_576 {
            continue;
        }
        let mime = image_mime(&declared, &bytes);
        if !mime.is_empty() {
            return Ok(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            ));
        }
    }

    Ok(String::new())
}

/// 常见 HTML 实体 + 数字/十六进制字符引用解码（标题层够用；完整实体表不需要）
fn decode_basic_entities(input: &str) -> String {
    let mut out = input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    // &#NNN; / &#xHH;（循环两轮覆盖极少见的双编码）
    let num = Regex::new(r"&#(x[0-9a-fA-F]+|[0-9]+);").unwrap();
    for _ in 0..2 {
        out = num
            .replace_all(&out, |caps: &regex::Captures| {
                let g = &caps[1];
                if let Some(hex) = g.strip_prefix('x') {
                    u32::from_str_radix(hex, 16)
                        .ok()
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                        .unwrap_or_default()
                } else {
                    g.parse::<u32>()
                        .ok()
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                        .unwrap_or_default()
                }
            })
            .into_owned();
    }
    out
}
