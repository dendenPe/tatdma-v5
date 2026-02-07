import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Einfache Error Boundary Komponente, um weiße Bildschirme abzufangen
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-10 font-sans">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Etwas ist schiefgelaufen.</h1>
          <p className="mb-4 text-gray-700">Die Anwendung konnte nicht geladen werden. Fehler:</p>
          <pre className="bg-gray-100 p-4 rounded border border-gray-300 text-sm overflow-auto">
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => {
              localStorage.removeItem('tatdma_data'); 
              window.location.reload();
            }}
            className="mt-6 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            App zurücksetzen (Löscht lokale Daten & Reload)
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);