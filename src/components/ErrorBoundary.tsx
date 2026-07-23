import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack?: string } | null;
}

/**
 * React ErrorBoundary — 捕获子组件渲染错误，防止白屏
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo } as any);
    console.error('[ErrorBoundary] Render crash:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message || String(this.state.error);
      const stack = this.state.errorInfo?.componentStack || this.state.error?.stack || '';

      return (
        <div style={{
          padding: '40px 24px',
          maxWidth: '600px',
          margin: '80px auto',
          background: '#1a1a2e',
          borderRadius: '12px',
          color: '#e0e0e0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}>
          <h2 style={{ color: 'var(--ui-red, #ff6b6b)', marginBottom: '12px' }}>渲染错误</h2>
          <p style={{ marginBottom: '16px', opacity: 0.8 }}>
            页面遇到了一个渲染错误。你可以尝试恢复或刷新页面。
          </p>
          <div style={{
            background: '#0d0d1a',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#ff6b6b',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '200px',
            overflow: 'auto',
          }}>
            {errMsg}
            {stack && '\n\nComponent Stack:\n' + stack}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 20px',
                background: '#4a9eff',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              尝试恢复
            </button>
            <button
              onClick={this.handleHardReload}
              style={{
                padding: '8px 20px',
                background: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
