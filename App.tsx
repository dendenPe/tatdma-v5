
import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Calendar as CalendarIcon, 
  Briefcase, 
  Receipt, 
  BarChart3, 
  Settings, 
  Wallet,
  ShieldCheck,
  ShieldAlert,
  CalendarDays,
  Menu, 
  X,
  StickyNote,
  PieChart,
  PanelLeftClose,
  PanelLeftOpen,
  Key,
  CreditCard // New Icon for Expenses Tab
} from 'lucide-react';
import { AppData, APP_VERSION } from './types';
import { VaultService } from './services/vaultService';
import TradingView from './views/TradingView';
import CalendarView from './views/CalendarView';
import HoldingsView from './views/HoldingsView';
import SalaryView from './views/SalaryView';
import TaxView from './views/TaxView';
import StatisticsView from './views/StatisticsView';
import SystemView from './views/SystemView';
import NotesView from './views/NotesView';
import DashboardView from './views/DashboardView';
import ExpensesView from './views/ExpensesView'; // IMPORT

const INITIAL_DATA: AppData = {
  trades: {},
  salary: {},
  salaryCertificates: {}, // NEW
  tax: {
    personal: { name: '', address: '', zip: '', city: '', id: '' },
    expenses: [],
    balances: {}
  },
  portfolios: {
    'portfolio_1': { name: 'Hauptportfolio', years: {} }
  },
  currentPortfolioId: 'portfolio_1',
  notes: {},
  categoryRules: {},
  dailyExpenses: {}, // INIT NEW FIELD
  recurringExpenses: [] // INIT NEW FIELD
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard'); // Default to Dashboard
  const [data, setData] = useState<AppData>(INITIAL_DATA);
  const [vaultStatus, setVaultStatus] = useState<'none' | 'connected' | 'locked'>('none');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Navigation State for Stats -> Calendar jump
  const [calendarTargetDate, setCalendarTargetDate] = useState<Date | null>(null);
  
  // API Key State
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  const [globalYear, setGlobalYear] = useState(new Date().getFullYear().toString());
  // Fix: Use ReturnType<typeof setTimeout> instead of NodeJS.Timeout to be environment agnostic
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check for API Key on mount
    const storedKey = localStorage.getItem('tatdma_api_key');
    if (!storedKey) {
        setShowKeyModal(true);
    }

    const saved = localStorage.getItem('tatdma_data');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setData(prev => ({
          ...prev,
          ...parsed,
          trades: parsed.trades || prev.trades,
          salary: parsed.salary || prev.salary,
          salaryCertificates: parsed.salaryCertificates || prev.salaryCertificates || {}, // MERGE NEW
          tax: { ...prev.tax, ...(parsed.tax || {}) },
          portfolios: parsed.portfolios || prev.portfolios,
          notes: parsed.notes || prev.notes,
          categoryRules: parsed.categoryRules || prev.categoryRules,
          dailyExpenses: parsed.dailyExpenses || prev.dailyExpenses || {}, // Merge new field
          recurringExpenses: parsed.recurringExpenses || prev.recurringExpenses || [] // Merge new field
        }));
      } catch (e) {
        console.error("Data corruption detected", e);
      }
    }

    VaultService.init().then(connected => {
      if (connected) setVaultStatus('connected');
      else VaultService.isConnected() ? setVaultStatus('locked') : setVaultStatus('none');
    });
  }, []);

  const saveToLocalStorage = (newData: AppData) => {
    setData(newData);
    localStorage.setItem('tatdma_data', JSON.stringify(newData));
    
    if (vaultStatus === 'connected') {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setAutoSaveStatus('saving');
      
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const jsonBlob = new Blob([JSON.stringify(newData, null, 2)], { type: 'application/json' });
          await VaultService.writeFile('tatdma_autosave.json', jsonBlob);
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
        } catch (e) {
          console.error("Auto-Backup failed", e);
          setAutoSaveStatus('idle');
        }
      }, 2000);
    }
  };

  const saveApiKey = () => {
      if(apiKeyInput.trim()) {
          localStorage.setItem('tatdma_api_key', apiKeyInput.trim());
          setShowKeyModal(false);
          // Optional: Reload to ensure services pick it up fresh if needed, but localStorage is sync
          window.location.reload(); 
      }
  };

  // Helper to jump from Stats to Calendar
  const handleNavigateToCalendar = (dateStr: string) => {
      setCalendarTargetDate(new Date(dateStr));
      setActiveTab('calendar');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={data} onUpdate={saveToLocalStorage} onNavigate={setActiveTab} />;
      case 'trading': return <TradingView data={data} onUpdate={saveToLocalStorage} />;
      case 'calendar': return <CalendarView data={data} onUpdate={saveToLocalStorage} targetDate={calendarTargetDate} />;
      case 'holdings': return <HoldingsView data={data} onUpdate={saveToLocalStorage} globalYear={globalYear} />;
      case 'salary': return <SalaryView data={data} onUpdate={saveToLocalStorage} globalYear={globalYear} />;
      case 'tax': return <TaxView data={data} onUpdate={saveToLocalStorage} globalYear={globalYear} />;
      case 'expenses': return <ExpensesView data={data} onUpdate={saveToLocalStorage} globalYear={globalYear} />; // NEW
      case 'notes': return <NotesView data={data} onUpdate={saveToLocalStorage} />;
      case 'stats': return <StatisticsView data={data} onNavigateToCalendar={handleNavigateToCalendar} />;
      case 'system': return <SystemView data={data} onUpdate={saveToLocalStorage} />;
      default: return <DashboardView data={data} onUpdate={saveToLocalStorage} onNavigate={setActiveTab} />;
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Cockpit', icon: PieChart },
    { id: 'expenses', label: 'Ausgaben', icon: CreditCard }, // NEW TAB
    { id: 'trading', label: 'Trading', icon: LayoutDashboard },
    { id: 'calendar', label: 'Kalender', icon: CalendarIcon },
    { id: 'holdings', label: 'Wertpapiere', icon: Wallet },
    { id: 'salary', label: 'Lohn/Gehalt', icon: Briefcase },
    { id: 'tax', label: 'Steuern', icon: Receipt },
    { id: 'notes', label: 'Notes & Docs', icon: StickyNote },
    { id: 'stats', label: 'Statistik', icon: BarChart3 },
    { id: 'system', label: 'System', icon: Settings },
  ];

  const currentYearNum = new Date().getFullYear();
  const availableYears = Array.from({ length: Math.max(2026 - 2023 + 1, currentYearNum - 2023 + 2) }, (_, i) => (2023 + i).toString());
  const showGlobalYearSelector = ['holdings', 'salary', 'tax', 'expenses'].includes(activeTab); // Added expenses

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-gray-900 font-sans relative">
      
      {/* API KEY MODAL */}
      {showKeyModal && (
          <div className="fixed inset-0 z-[100] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full animate-in zoom-in-95 duration-200">
                  <div className="flex flex-col items-center text-center space-y-4">
                      <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                          <Key size={32} />
                      </div>
                      <h3 className="text-2xl font-black text-gray-800">Google Gemini API Key</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">
                          Damit die AI-Funktionen (Dokumenten-Scan, Auto-Kategorisierung) funktionieren, wird dein persönlicher API Key benötigt.
                          <br/><br/>
                          <strong>Sicherheit:</strong> Der Key wird nur lokal in deinem Browser gespeichert und niemals an einen Server (außer Google) gesendet.
                      </p>
                      <input 
                        type="password" 
                        placeholder="AIzaSy..." 
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                      <button 
                        onClick={saveApiKey}
                        disabled={apiKeyInput.length < 10}
                        className={`w-full py-4 rounded-xl font-bold text-white transition-all ${apiKeyInput.length < 10 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-lg'}`}
                      >
                          Speichern & Starten
                      </button>
                      <p className="text-[10px] text-gray-400">
                          Keinen Key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Hier kostenlos erstellen</a>.
                      </p>
                  </div>
              </div>
          </div>
      )}

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 
        ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'} 
        w-64 bg-[#16325c] flex-shrink-0 flex flex-col transition-all duration-300 ease-in-out shadow-2xl lg:shadow-none
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Header */}
        <div className={`p-4 pt-[calc(1rem+env(safe-area-inset-top))] flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!sidebarCollapsed && (
             <div className="animate-in fade-in duration-200">
                <h1 className="text-white text-xl font-bold flex items-center gap-2 whitespace-nowrap">
                  TaTDMA <span className="text-[10px] bg-blue-500 px-1.5 py-0.5 rounded uppercase font-medium">{APP_VERSION}</span>
                </h1>
                <p className="text-blue-200 text-xs mt-1 opacity-70 whitespace-nowrap">Trade, Tax & Docs</p>
             </div>
          )}
          
          {/* Mobile Close Button */}
          <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden text-white/70 hover:text-white">
            <X size={24} />
          </button>

          {/* Desktop Collapse Toggle */}
          <button 
             onClick={() => setSidebarCollapsed(!sidebarCollapsed)} 
             className={`hidden lg:block text-blue-200 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10 ${sidebarCollapsed ? 'mx-auto' : ''}`}
             title={sidebarCollapsed ? "Menü ausklappen" : "Menü einklappen"}
          >
             {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 mt-4 px-3 space-y-1 overflow-y-auto custom-scrollbar overflow-x-hidden">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              title={sidebarCollapsed ? item.label : ''}
              className={`w-full flex items-center rounded-lg transition-all duration-200 group relative
                ${sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'}
                ${activeTab === item.id 
                ? 'bg-white/10 text-white font-semibold' 
                : 'text-blue-100 hover:bg-white/5 opacity-80 hover:opacity-100'
              }`}
            >
              <item.icon size={20} className={`shrink-0 transition-transform ${sidebarCollapsed && activeTab === item.id ? 'scale-110' : ''}`} />
              
              {!sidebarCollapsed && (
                 <span className="whitespace-nowrap animate-in fade-in duration-200">{item.label}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer / Vault Status */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-white/10 space-y-2">
          {!sidebarCollapsed && vaultStatus === 'connected' && (
             <div className="flex items-center justify-between text-[10px] text-blue-200 px-1 animate-in fade-in">
                <span>Auto-Backup (JSON):</span>
                <span className={`flex items-center gap-1 font-bold ${
                   autoSaveStatus === 'saving' ? 'text-yellow-300' : 
                   autoSaveStatus === 'saved' ? 'text-green-400' : 'text-gray-400'
                }`}>
                   {autoSaveStatus === 'saving' ? '...' : autoSaveStatus === 'saved' ? 'OK' : 'Bereit'}
                </span>
             </div>
          )}

          <button 
            onClick={async () => {
              if (vaultStatus === 'locked') {
                const ok = await VaultService.requestPermission();
                if (ok) setVaultStatus('connected');
              } else if (vaultStatus === 'none') {
                const ok = await VaultService.connect();
                if (ok) setVaultStatus('connected');
              }
            }}
            title={sidebarCollapsed ? (vaultStatus === 'connected' ? 'Vault Aktiv' : 'Kein Vault') : ''}
            className={`w-full flex items-center rounded-lg text-xs font-medium transition-all duration-200
              ${sidebarCollapsed ? 'justify-center p-3' : 'justify-between p-3'}
              ${vaultStatus === 'connected' ? 'bg-green-500/20 text-green-400' :
              vaultStatus === 'locked' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-gray-400'
            }`}
          >
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2'}`}>
              {vaultStatus === 'connected' ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
              {!sidebarCollapsed && <span>{vaultStatus === 'connected' ? 'Vault Aktiv' : vaultStatus === 'locked' ? 'Freigeben' : 'Kein Vault'}</span>}
            </div>
            {!sidebarCollapsed && <div className={`w-2 h-2 rounded-full ${vaultStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-gray-50 h-full transition-all duration-300">
        <header className="bg-white border-b border-gray-200 flex-shrink-0 z-10 sticky top-0 shadow-sm lg:shadow-none pt-[env(safe-area-inset-top)]">
          <div className="h-16 flex items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-3">
               <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  <Menu size={24} />
               </button>
               <h2 className="text-lg font-bold text-gray-700 capitalize truncate max-w-[150px] md:max-w-none">
                 {navItems.find(i => i.id === activeTab)?.label}
               </h2>
            </div>
            
            <div className="flex items-center gap-2 md:gap-6">
               {showGlobalYearSelector && (
                 <div className="flex items-center gap-2 bg-blue-50 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-blue-100 animate-in fade-in duration-300">
                   <CalendarDays size={16} className="text-blue-500 hidden md:block"/>
                   <span className="text-xs font-bold text-gray-500 uppercase tracking-wide hidden md:block">Jahr:</span>
                   <select 
                     value={globalYear}
                     onChange={(e) => setGlobalYear(e.target.value)}
                     className="bg-transparent font-black text-blue-700 text-sm outline-none cursor-pointer"
                   >
                     {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                   </select>
                 </div>
               )}
               
               <span className="text-xs text-gray-400 font-mono hidden md:block">
                 {new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
               </span>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-4 md:p-8 overscroll-contain pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {renderContent()}
        </section>
      </main>
    </div>
  );
};

export default App;
