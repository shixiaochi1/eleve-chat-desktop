import { createRoot } from 'react-dom/client'
import App from './App'
import KanbanWindowApp from './components/KanbanWindowApp'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// React 挂载后淡出启动画面
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
const root = createRoot(rootEl)

// 检测是否为看板独立窗口（?panel=kanban）
const isKanbanWindow = new URLSearchParams(window.location.search).get('panel') === 'kanban'

if (isKanbanWindow) {
  // 看板独立窗口：只加载 KanbanPanel，不加载主界面
  root.render(
    <ErrorBoundary>
      <KanbanWindowApp />
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
