/**
 * 关于面板 — Eleve Agent 智能体介绍
 */
export default function AboutPanel() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col items-center gap-1 py-4">
        <img src="/eleve_logo.png" alt="Eleve" className="w-12 h-12 rounded-lg" />
        <h2 className="text-base font-semibold text-foreground">Eleve Agent</h2>
        <span className="text-xs text-muted-foreground/60">全栈 Rust AI 智能体平台 · v0.1.0</span>
      </div>

      <div className="text-xs text-muted-foreground/80 leading-relaxed">
        <p>
          Eleve 是新一代 AI 智能体平台，专为图形界面操作系统而生。
          全平台兼容 Windows / macOS / Linux，双击即用，零繁琐依赖与配置。
        </p>
      </div>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-1.5">架构优势</h3>
        <ul className="space-y-1 text-xs text-muted-foreground/80">
          <li>Rust 全量编写 — 内核到网关纯 Rust 实现，极致性能与内存安全</li>
          <li>Mixture of Agents — 多模型并行推理聚合，OpenRouter 驱动调度</li>
          <li>Smart Routing — 主模型路由 + 经济模型路由 + Auxiliary LLM Pool 自动降级</li>
          <li>TUI + CLI 双界面 — 控制台终端与命令行接口，完美集成各类应用</li>
          <li>Tauri v2 原生桌面 — GUI 图形窗口，启动快、资源占用极低</li>
          <li>跨平台一致 — Windows / macOS / Linux 同一套代码，无平台差异</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-1.5">工具能力</h3>
        <ul className="space-y-1 text-xs text-muted-foreground/80">
          <li>内置工具 — 终端 / 网络 / 数据库 + Rust 浏览器自动化（导航 · 点击 · 输入 · 滚动 · 截图 · 视觉 · 控制台）</li>
          <li>MCP 集成 — 标准模型上下文协议，无缝接入第三方工具与服务</li>
          <li>WASM 插件 — WebAssembly 沙箱扩展，安全运行社区插件</li>
          <li>技能系统 — 50+ 内置技能，完美融合现有 AI 生态，支持热加载</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-1.5">智能体编排</h3>
        <ul className="space-y-1 text-xs text-muted-foreground/80">
          <li>自主推理 — 深度思考 + 思维链，多步规划与自主纠错</li>
          <li>自主迭代 — 内建自学习机制，可自主进化、持续提升能力</li>
          <li>双层记忆 — L1 redb 热数据快速访问 + L2 SQLite 持久化 FTS5 全文检索</li>
          <li>多智能体编排 — Orchestrator + ChildGuard + Blackboard 黑板系统</li>
          <li>子 Agent 调度 — 并行委派子 Agent，协作完成复杂多步骤任务</li>
          <li>定时调度 — Cron 引擎，自动化任务编排与结果推送</li>
          <li>会话持久 — SQLite 存储，跨重启上下文记忆不丢失</li>
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-foreground mb-1.5">部署与集成</h3>
        <ul className="space-y-1 text-xs text-muted-foreground/80">
          <li>双击即用 — 单二进制文件，无需 Python / Node 等运行时</li>
          <li>多模型接入 — OpenAI / Anthropic / Gemini / 国产模型统一接口</li>
          <li>多平台接入 — 微信 / Telegram / Discord / 企业微信即时通讯集成</li>
          <li>API 兼容 — OpenAI 标准接口，无缝对接现有工具链</li>
        </ul>
      </section>

      <div className="text-center text-xs text-muted-foreground/50 pt-2 border-t border-border">
        <p>Rust · Tauri · React · 全栈自研</p>
        <p>Eleve Team — 让 AI 真正为你工作</p>
      </div>
    </div>
  );
}
