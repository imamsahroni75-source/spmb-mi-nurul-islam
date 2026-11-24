import {Component, type ErrorInfo, type ReactNode} from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application Error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-dvh w-full bg-[#EFEBE1] text-[#1C1917] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-stone-300 bg-white p-6 text-center shadow-md">
            <h1 className="font-serif text-xl font-semibold text-[#14532D]">
              Terjadi Gangguan Sistem
            </h1>
            <p className="mt-2 text-sm text-stone-600 leading-relaxed">
              Mohon maaf, layanan gagal memuat data. Silakan muat ulang halaman.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 min-h-[44px] px-5 py-2.5 rounded-xl bg-[#14532D] text-white text-sm font-medium hover:bg-[#166534] transition-colors"
            >
              Muat Ulang
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
