import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[SIGMA ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg   = this.state.error?.message || 'Unknown error';
    const stack = this.state.error?.stack?.split('\n').slice(0, 6).join('\n') || '';

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Terjadi Kesalahan</h1>
          <p className="text-gray-500 text-sm mb-4">
            Halaman mengalami error. Screenshot dan kirim ke developer.
          </p>
          <div className="bg-red-50 rounded-xl p-4 text-left mb-6">
            <p className="text-red-700 text-xs font-mono break-all">{msg}</p>
            {stack && (
              <pre className="text-red-400 text-[10px] mt-2 whitespace-pre-wrap break-all">
                {stack}
              </pre>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="btn-primary">
              🔄 Reload Halaman
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-secondary">
              🏠 Ke Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
