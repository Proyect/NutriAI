import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorInfo: any | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    let errorInfo = null;
    try {
      errorInfo = JSON.parse(error.message);
    } catch (e) {
      errorInfo = { error: error.message };
    }
    return { hasError: true, errorInfo };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-xl border border-stone-200 text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-serif italic font-bold">¡Ups! Algo salió mal</h2>
              <p className="text-stone-500 text-sm">
                {this.state.errorInfo?.error || "Ha ocurrido un error inesperado en la aplicación."}
              </p>
            </div>
            
            {this.state.errorInfo?.path && (
              <div className="bg-stone-50 p-4 rounded-2xl text-left">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Detalles Técnicos</div>
                <div className="text-xs font-mono text-stone-600 break-all">
                  Ruta: {this.state.errorInfo.path}<br/>
                  Op: {this.state.errorInfo.operationType}
                </div>
              </div>
            )}

            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-stone-800 transition-all"
            >
              <RefreshCcw size={20} />
              Reintentar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
