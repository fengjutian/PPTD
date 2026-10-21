import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error?: Error;
}

/** Keeps a render failure from leaving the desktop shell as a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Do not log document text; only the failure location is needed to diagnose.
    console.error("PPTD render failure", error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <h1>界面遇到未处理错误</h1>
        <p>当前文稿仍在本地内存中。请先尝试重新加载；如果问题重复出现，请保存诊断信息。</p>
        <pre>{this.state.error.message}</pre>
        <div>
          <button type="button" className="primary-action" onClick={() => window.location.reload()}>
            重新加载
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() =>
              void navigator.clipboard?.writeText(this.state.error?.stack ?? this.state.error?.message ?? "")
            }
          >
            复制诊断信息
          </button>
        </div>
      </main>
    );
  }
}
