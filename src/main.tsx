import { createRoot } from 'react-dom/client'
import App from './App'
import KanbanWindowApp from './components/KanbanWindowApp'
import SessionWindowApp from './components/SessionWindowApp'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// React 挂载后淡出启动画面
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
const root = createRoot(rootEl)

// 检测窗口模式（?panel=…）：kanban=看板独立窗口 / session=会话独立窗口（对齐 Hermes newWindow）
const params = new URLSearchParams(window.location.search)
const panel = params.get('panel')

if (panel === 'kanban') {
  // 看板独立窗口：只加载 KanbanPanel，不加载主界面
  root.render(
    <ErrorBoundary>
      <KanbanWindowApp />
    </ErrorBoundary>
  )
} else if (panel === 'session') {
  // 会话独立窗口：只加载单会话视图（复用 useGridChat + AgentChatCard）
  root.render(
    <ErrorBoundary>
      <SessionWindowApp />
    </ErrorBoundary>
  )
} else {
  // 主窗口：完整应用
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}

// 淡出 splash（React 已接管 #root，动画结束后移除 DOM）
const splash = document.getElementById('splash')
if (splash) {
  splash.classList.add('fade-out')
  setTimeout(() => splash.remove(), 400)
}
