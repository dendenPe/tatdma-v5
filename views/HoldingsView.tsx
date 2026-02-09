
import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  Briefcase, 
  Globe, 
  Plus, 
  Wallet, 
  X,
  Info,
  TrendingUp,
  AlertCircle,
  Pencil,
  Check,
  History,
  Trash2,
  Sparkles,
  Loader2
} from 'lucide-react';
import { AppData, PortfolioYear, Portfolio, PortfolioPosition } from '../types';
import { ImportService } from '../services/importService';
import { GeminiService } from '../services/geminiService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  globalYear: string;
}

const HoldingsView: React.FC<Props> = ({ data, onUpdate, globalYear }) => {
  const [currentYear, setCurrentYear] = useState(globalYear);
  const [showRates, setShowRates] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [isAddingPortfolio, setIsAddingPortfolio] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Renaming State
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Position Editing State
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editPosForm, setEditPosForm] = useState<Partial<PortfolioPosition>>({});

  const smartImportRef = useRef<HTMLInputElement>(null);

  // Sync with global year when it changes
  useEffect(() => {
    setCurrentYear(globalYear);
  }, [globalYear]);

  const currentPortfolio = data.portfolios[data.currentPortfolioId] || Object.values(data.portfolios)[0];
  const yearData: PortfolioYear = currentPortfolio.years[currentYear] || {
    positions: {},
    cash: { 'USD': 0, 'CHF': 0, 'EUR': 0 },
    summary: { totalValue: 0, unrealized: 0, realized: 0, dividends: 0, tax: 0 },
    lastUpdate: '',
    exchangeRates: { 'USD_CHF': 0.88, 'EUR_CHF': 0.94, 'EUR_USD': 1.07 }
  };

  const addPortfolio = () => {
    if (!newPortfolioName.trim()) return;
    const id = `portfolio_${Date.now()}`;
    const newPortfolio: Portfolio = {
      name: newPortfolioName,
      years: {}
    };
    const newData = {
      ...data,
      portfolios: { ...data.portfolios, [id]: newPortfolio },
      currentPortfolioId: id
    };
    onUpdate(newData);
    setNewPortfolioName('');
    setIsAddingPortfolio(false);
  };

  const startRename = () => {
    setRenameValue(currentPortfolio.name);
    setIsRenaming(true);
  };

  const saveRename = () => {
    if (renameValue.trim()) {
      const newData = { ...data };
      newData.portfolios[data.currentPortfolioId].name = renameValue.trim();
      onUpdate(newData);
    }
    setIsRenaming(false);
  };

  // --- EDIT POSITION LOGIC ---
  const startEditingPosition = (pos: PortfolioPosition) => {
      setEditingSymbol(pos.symbol);
      setEditPosForm({ ...pos });
  };

  const savePositionEdit = () => {
      if (!editingSymbol) return;
      
      const newData = { ...data };
      const portfolio = newData.portfolios[data.currentPortfolioId];
      
      if (portfolio && portfolio.years[currentYear]) {
          // 1. Update the position
          portfolio.years[currentYear].positions[editingSymbol] = { 
              ...portfolio.years[currentYear].positions[editingSymbol], 
              ...editPosForm as PortfolioPosition 
          };

          // 2. Recalculate Summary
          let newTotalVal = 0;
          let newUnreal = 0;
          let newRealized = 0; // Sum up realized from positions
          
          Object.values(portfolio.years[currentYear].positions).forEach(p => {
              if (p.qty !== 0) { // Active positions only for Total Value
                  newTotalVal += p.val;
                  newUnreal += p.unReal;
              }
              newRealized += p.real;
          });

          // Update Summary
          portfolio.years[currentYear].summary.totalValue = newTotalVal;
          portfolio.years[currentYear].summary.unrealized = newUnreal;
          portfolio.years[currentYear].summary.realized = newRealized;

          onUpdate(newData);
          setEditingSymbol(null);
          setEditPosForm({});
      }
  };

  // --- DELETE FUNCTION (FIXED RECALCULATION) ---
  const removePosition = (symbol: string) => {
    if (!confirm(`Position "${symbol}" wirklich löschen?`)) return;
    
    const newData = { ...data };
    const portfolio = newData.portfolios[data.currentPortfolioId];
    if (portfolio && portfolio.years[currentYear]) {
        // 1. Delete the position
        delete portfolio.years[currentYear].positions[symbol];
        
        // 2. Full Recalculation of Summary from remaining positions
        let newTotalVal = 0;
        let newUnreal = 0;
        let newRealized = 0;
        
        Object.values(portfolio.years[currentYear].positions).forEach(p => {
             if (p.qty !== 0) {
                 newTotalVal += p.val;
                 newUnreal += p.unReal;
             }
             newRealized += p.real;
        });
        
        portfolio.years[currentYear].summary.totalValue = newTotalVal;
        portfolio.years[currentYear].summary.unrealized = newUnreal;
        portfolio.years[currentYear].summary.realized = newRealized;
        
        onUpdate(newData);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      
      const newData = { ...data };
      const portfolio = newData.portfolios[data.currentPortfolioId];
      
      // Determine best starting rates:
      let baseRates: Record<string, number> = { 'USD_CHF': 0.88, 'EUR_CHF': 0.94, 'EUR_USD': 1.07 };
      
      if (portfolio.years[currentYear]) {
          baseRates = { ...portfolio.years[currentYear].exchangeRates };
      } else {
          const prevYear = (parseInt(currentYear) - 1).toString();
          if (portfolio.years[prevYear]) {
              baseRates = { ...portfolio.years[prevYear].exchangeRates };
          }
      }

      if (!portfolio.years[currentYear]) {
          portfolio.years[currentYear] = { ...yearData, exchangeRates: baseRates };
      }
      
      const targetYear = portfolio.years[currentYear];
      const parsedData = ImportService.parseIBKRPortfolioCSV(text, baseRates);
      
      targetYear.positions = parsedData.positions;
      targetYear.cash = parsedData.cash;
      targetYear.summary = parsedData.summary;
      targetYear.lastUpdate = parsedData.lastUpdate;
      targetYear.exchangeRates = parsedData.exchangeRates; 
      
      onUpdate(newData);
      alert(`Import erfolgreich!\n\n${Object.keys(parsedData.positions).length} Positionen.\nDividenden: ${parsedData.summary.dividends.toFixed(2)} USD\nTax: ${parsedData.summary.tax.toFixed(2)} USD`);
    };
    reader.readAsText(file);
  };

  const handleSmartImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setIsScanning(true);
      try {
          const result = await GeminiService.analyzePortfolioCSV(file);
          
          if (result) {
              const newData = { ...data };
              const portfolio = newData.portfolios[data.currentPortfolioId];
              
              if (!portfolio.years[currentYear]) {
                  portfolio.years[currentYear] = { 
                      positions: {}, 
                      cash: {}, 
                      summary: { totalValue: 0, unrealized: 0, realized: 0, dividends: 0, tax: 0 }, 
                      lastUpdate: '', 
                      exchangeRates: {} 
                  };
              }
              
              const targetYear = portfolio.years[currentYear];
              
              targetYear.positions = result.positions;
              targetYear.cash = result.cash;
              targetYear.summary = result.summary;
              targetYear.exchangeRates = { ...targetYear.exchangeRates, ...result.exchangeRates };
              targetYear.lastUpdate = result.lastUpdate;

              onUpdate(newData);
              alert("Smart AI Import erfolgreich!\nDaten wurden aktualisiert.");
          } else {
              alert("Die KI konnte keine Portfolio-Daten extrahieren.");
          }
      } catch (err: any) {
          alert("Fehler beim Smart Import: " + err.message);
      } finally {
          setIsScanning(false);
          e.target.value = '';
      }
  };

  const updateRate = (pair: string, val: number) => {
    const newData = { ...data };
    if (!newData.portfolios[data.currentPortfolioId].years[currentYear]) {
        newData.portfolios[data.currentPortfolioId].years[currentYear] = { ...yearData };
    }
    newData.portfolios[data.currentPortfolioId].years[currentYear].exchangeRates[pair] = val;
    onUpdate(newData);
  };

  const usdToChf = yearData.exchangeRates['USD_CHF'] || 0.88;
  const eurToUsd = yearData.exchangeRates['EUR_USD'] || 1.07;

  const getValUSD = (curr: string, amt: number): number => {
      if (curr === 'USD') return amt;
      if (yearData.exchangeRates[`${curr}_USD`]) return amt * yearData.exchangeRates[`${curr}_USD`];
      if (curr === 'CHF') return amt / usdToChf; 
      if (curr === 'EUR') return amt * eurToUsd;
      return 0; 
  };

  const cashList = Object.entries(yearData.cash || {}).filter(([_, amt]) => amt !== 0);
  const cashTotalUSD = cashList.reduce((sum, [curr, amt]) => sum + getValUSD(curr, amt), 0);
  const cashTotalCHF = cashTotalUSD * usdToChf;
  const totalLiquidationValueUSD = yearData.summary.totalValue + cashTotalUSD;

  const allPositions = Object.values(yearData.positions);
  const activePositions = allPositions.filter(p => p.qty !== 0).sort((a, b) => getValUSD(b.currency, b.val) - getValUSD(a.currency, a.val));
  const realizedPositions = allPositions.filter(p => p.real !== 0).sort((a, b) => b.real - a.real);

  const rateKeys = Object.keys(yearData.exchangeRates).sort();
  if (!rateKeys.includes('USD_CHF')) rateKeys.unshift('USD_CHF');

  const currentYearNum = new Date().getFullYear();
  const availableYears = Array.from({ length: Math.max(2026 - 2023 + 1, currentYearNum - 2023 + 2) }, (_, i) => (2023 + i).toString());

  const netDivUSD = (yearData.summary.dividends || 0) - (yearData.summary.tax || 0);

  // --- MOBILE CARD COMPONENTS ---
  const MobilePositionCard = ({ pos }: { pos: any }) => {
    const valUSD = getValUSD(pos.currency, pos.val);
    const unRealUSD = getValUSD(pos.currency, pos.unReal);
    
    return (
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 group">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-black text-gray-800 text-lg">{pos.symbol}</h4>
            <span className="text-xs font-bold text-gray-400 uppercase bg-gray-100 px-1.5 py-0.5 rounded">{pos.currency}</span>
          </div>
          <div className="flex flex-col items-end">
             <div className={`text-right ${unRealUSD >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span className="block text-sm font-black">{unRealUSD >= 0 ? '+' : ''}{unRealUSD.toLocaleString('de-CH', {maximumFractionDigits:0})} $</span>
                <span className="text-[10px] uppercase font-bold opacity-60">Unreal. PnL</span>
             </div>
             <div className="flex gap-2 mt-2">
                 <button onClick={() => startEditingPosition(pos)} className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                    <Pencil size={16} />
                 </button>
                 <button onClick={() => removePosition(pos.symbol)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={16} />
                 </button>
             </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-50">
           <div>
             <span className="text-[10px] text-gray-400 font-bold uppercase block">Menge</span>
             <span className="text-sm font-bold text-gray-700">{pos.qty}</span>
           </div>
           <div className="text-right">
             <span className="text-[10px] text-gray-400 font-bold uppercase block">Marktwert</span>
             <span className="text-sm font-bold text-blue-600">{valUSD.toLocaleString('de-CH', {minimumFractionDigits: 0})} $</span>
           </div>
           <div>
             <span className="text-[10px] text-gray-400 font-bold uppercase block">Avg Cost</span>
             <span className="text-xs font-bold text-gray-500">{pos.cost.toFixed(2)}</span>
           </div>
           <div className="text-right">
             <span className="text-[10px] text-gray-400 font-bold uppercase block">Close</span>
             <span className="text-xs font-bold text-gray-800">{pos.close.toFixed(2)}</span>
           </div>
        </div>
      </div>
    );
  };

  const MobileClosedCard = ({ pos }: { pos: any }) => {
      const realUSD = pos.real; 
      const realCHF = realUSD * usdToChf;
      return (
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group">
           <div>
              <h4 className="font-black text-gray-800 text-sm">{pos.symbol}</h4>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Realisierter PnL</span>
              {pos.qty !== 0 && <span className="ml-2 text-[9px] bg-blue-100 text-blue-600 px-1 rounded font-bold">Teilverkauf</span>}
           </div>
           <div className="flex items-center gap-3">
               <div className={`text-right ${realUSD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span className="block font-black text-sm">{realUSD >= 0 ? '+' : ''}{realUSD.toLocaleString('de-CH', {minimumFractionDigits: 2})} $</span>
                  <span className="text-[10px] font-bold opacity-60">~ {realCHF.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF</span>
               </div>
               {pos.qty === 0 && (
                   <button onClick={() => removePosition(pos.symbol)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={16} />
                   </button>
               )}
           </div>
        </div>
      );
  };

  const MobileCashCard = ({ curr, amt, valCHF }: { curr: string, amt: number, valCHF: number }) => (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
       <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
            {curr}
          </div>
          <div>
            <p className="font-bold text-gray-800">{amt.toLocaleString('de-CH')}</p>
            <p className="text-[10px] text-gray-400 uppercase font-bold">Saldo</p>
          </div>
       </div>
       <div className="text-right">
         <p className="font-black text-green-600">{valCHF.toLocaleString('de-CH', {maximumFractionDigits: 0})}</p>
         <p className="text-[10px] text-gray-400 uppercase font-bold">CHF Wert</p>
       </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 lg:space-y-8 pb-32">
      {/* Header Section */}
      <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 p-6 lg:p-8 space-y-6 lg:space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="w-12 h-12 lg:w-16 lg:h-16 rounded-3xl bg-[#16325c] text-white flex items-center justify-center shadow-2xl shadow-blue-900/20 shrink-0">
              <Briefcase size={24} className="lg:hidden" />
              <Briefcase size={32} className="hidden lg:block" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 lg:gap-3 flex-wrap">
                {isRenaming ? (
                    <div className="flex items-center gap-2 w-full">
                        <input 
                            type="text" 
                            value={renameValue} 
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="text-xl lg:text-2xl font-black text-gray-800 bg-gray-50 border-b-2 border-blue-50 outline-none w-full p-1"
                            autoFocus
                        />
                        <button onClick={saveRename} className="p-2 bg-green-50 text-green-600 rounded-lg"><Check size={20}/></button>
                        <button onClick={() => setIsRenaming(false)} className="p-2 bg-gray-50 text-gray-400 rounded-lg"><X size={20}/></button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 w-full lg:w-auto">
                        <select 
                        value={data.currentPortfolioId}
                        onChange={(e) => onUpdate({...data, currentPortfolioId: e.target.value})}
                        className="text-xl lg:text-3xl font-black text-gray-800 tracking-tight bg-transparent outline-none cursor-pointer border-b-4 border-transparent hover:border-blue-500 transition-all pr-4 truncate max-w-[200px] lg:max-w-none"
                        >
                        {Object.entries(data.portfolios).map(([id, p]) => (
                            <option key={id} value={id}>{p.name}</option>
                        ))}
                        </select>
                        <button onClick={startRename} className="p-1 lg:p-2 text-gray-300 hover:text-blue-500 shrink-0" title="Portfolio umbenennen">
                            <Pencil size={16} />
                        </button>
                    </div>
                )}
                
                <button 
                  onClick={() => setIsAddingPortfolio(!isAddingPortfolio)}
                  className={`p-2 lg:p-3 rounded-2xl transition-all shrink-0 ${isAddingPortfolio ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600 hover:scale-110 shadow-lg shadow-blue-900/5'}`}
                >
                  {isAddingPortfolio ? <X size={18} /> : <Plus size={20} className="lg:w-6 lg:h-6" />}
                </button>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[9px] lg:text-[10px] bg-blue-600 text-white px-2 py-0.5 lg:px-3 lg:py-1 rounded-full font-black uppercase tracking-widest">Aktiv</span>
                <span className="text-[9px] lg:text-[10px] text-gray-400 font-bold uppercase tracking-widest">Jahr:</span>
                <select 
                  value={currentYear} 
                  onChange={(e) => setCurrentYear(e.target.value)}
                  className="text-[10px] lg:text-xs font-black text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded transition-colors bg-transparent outline-none cursor-pointer"
                >
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 lg:gap-4">
            <button 
              onClick={() => setShowRates(!showRates)}
              className={`px-4 py-3 lg:px-6 lg:py-3 rounded-2xl text-[10px] lg:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all border ${
                  showRates ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50'
              }`}
            >
              <Globe size={16} /> FX Kurse
            </button>
            
            {/* STANDARD IMPORT */}
            <label className="bg-[#16325c] hover:bg-blue-900 text-white px-6 py-3 lg:px-8 lg:py-4 rounded-2xl font-black text-[10px] lg:text-xs uppercase tracking-widest flex items-center justify-center gap-3 cursor-pointer transition-all shadow-2xl shadow-blue-900/30">
              <Upload size={18} /> IBKR Import (.csv)
              <input type="file" className="hidden" accept=".csv" onChange={handleImport} />
            </label>

            {/* SMART AI IMPORT */}
            <button 
                onClick={() => smartImportRef.current?.click()}
                disabled={isScanning}
                className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 lg:px-8 lg:py-4 rounded-2xl font-black text-[10px] lg:text-xs uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg hover:scale-105 active:scale-95"
                title="KI-basierter Import für schwierige CSVs"
            >
                {isScanning ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} 
                Smart Import
                <input type="file" ref={smartImportRef} className="hidden" accept=".csv,.txt" onChange={handleSmartImport} />
            </button>
          </div>
        </div>

        {isAddingPortfolio && (
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 p-4 lg:p-6 bg-gray-50 rounded-[28px] border border-gray-100">
            <input 
              type="text" 
              placeholder="Name für neues Portfolio..." 
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              className="flex-1 px-6 py-3 lg:py-4 rounded-2xl border border-gray-200 outline-none focus:ring-4 focus:ring-blue-100 text-sm font-bold"
            />
            <button 
              onClick={addPortfolio}
              className="px-10 py-3 lg:py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 shadow-xl"
            >
              Erstellen
            </button>
          </div>
        )}
      </div>

      {showRates && (
        <div className="bg-white rounded-[32px] border border-blue-100 p-6 lg:p-8 shadow-xl shadow-blue-900/5 animate-in slide-in-from-top-2 overflow-x-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-8 min-w-[300px]">
                {rateKeys.map(key => {
                    const val = yearData.exchangeRates[key];
                    const [from, to] = key.split('_');
                    return (
                        <div key={key} className={`space-y-2 lg:space-y-3 ${val === 0 ? 'animate-pulse' : ''}`}>
                            <label className={`text-[9px] lg:text-[10px] font-black uppercase tracking-widest flex items-center justify-between ${val === 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                <span>{from} ➔ {to}</span>
                                {val === 0 && <AlertCircle size={12}/>}
                            </label>
                            <input 
                                type="number" step="0.0001"
                                value={val || ''}
                                placeholder="0.0000"
                                onChange={(e) => updateRate(key, parseFloat(e.target.value) || 0)}
                                className={`w-full border rounded-xl lg:rounded-2xl px-3 py-2 lg:px-6 lg:py-4 text-sm lg:text-lg font-black outline-none focus:ring-4 ${
                                    val === 0 
                                    ? 'bg-red-50 border-red-200 text-red-600 focus:ring-red-100' 
                                    : 'bg-gray-50 border-gray-100 text-blue-900 focus:ring-blue-50'
                                }`}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
        {/* Marktwert */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
           <div>
               <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Marktwert (USD)</span>
               <p className="text-2xl font-black text-gray-800 mt-1">{yearData.summary.totalValue.toLocaleString('de-CH', { minimumFractionDigits: 0 })}</p>
           </div>
           <div className="pt-3 border-t border-gray-50">
             <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Total inkl. Cash</span>
             <p className="text-xl font-black text-blue-600">{totalLiquidationValueUSD.toLocaleString('de-CH', { minimumFractionDigits: 0 })} <span className="text-xs text-blue-300">USD</span></p>
           </div>
        </div>

        {/* Realisiert */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
           <div>
               <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Realisiert</span>
               <p className={`text-2xl font-black mt-1 ${yearData.summary.realized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {yearData.summary.realized >= 0 ? '+' : ''}{yearData.summary.realized.toLocaleString('de-CH', { minimumFractionDigits: 0 })}
               </p>
           </div>
           <div className="text-[10px] text-gray-300 font-bold uppercase pt-3 border-t border-gray-50">Abgeschlossen</div>
        </div>

        {/* Unrealisiert */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
           <div>
               <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Unrealisiert</span>
               <p className={`text-2xl font-black mt-1 ${yearData.summary.unrealized >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {yearData.summary.unrealized >= 0 ? '+' : ''}{yearData.summary.unrealized.toLocaleString('de-CH', { minimumFractionDigits: 0 })}
               </p>
           </div>
           <div className="text-[10px] text-gray-300 font-bold uppercase pt-3 border-t border-gray-50">Laufend</div>
        </div>

        {/* Dividends & Tax Card */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
           <div>
               <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                   Dividenden (Netto)
               </span>
               <p className="text-2xl font-black text-green-600 mt-1">
                  {netDivUSD.toLocaleString('de-CH', { minimumFractionDigits: 2 })}
               </p>
           </div>
           <div className="pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
               <div>
                   <span className="text-[9px] font-bold text-gray-400 uppercase block">Brutto</span>
                   <span className="text-xs font-bold text-gray-600">{yearData.summary.dividends.toFixed(0)}</span>
               </div>
               <div className="text-right">
                   <span className="text-[9px] font-bold text-gray-400 uppercase block">Quellensteuer</span>
                   <span className="text-xs font-bold text-red-500">-{yearData.summary.tax.toFixed(0)}</span>
               </div>
           </div>
        </div>

        {/* Cash */}
        <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 shadow-sm flex flex-col justify-between h-full">
           <div>
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Cash</span>
               <p className="text-2xl font-black text-indigo-600 mt-1">{cashTotalUSD.toLocaleString('de-CH', { minimumFractionDigits: 0 })} <span className="text-sm opacity-60">USD</span></p>
           </div>
           <div className="text-[10px] text-indigo-400 font-bold uppercase pt-3 border-t border-indigo-100">~ {cashTotalCHF.toLocaleString('de-CH', {maximumFractionDigits:0})} CHF</div>
        </div>
      </div>

      {/* ACTIVE POSITIONS SECTION */}
      <div className="space-y-4">
          <div className="flex items-center gap-3 px-2">
             <TrendingUp className="text-blue-500" size={20} />
             <h4 className="text-sm lg:text-lg font-black text-gray-800 uppercase tracking-tight">Aktien-Positionen</h4>
          </div>
          
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white rounded-[32px] border border-gray-100 shadow-xl overflow-hidden">
             <table className="w-full text-left">
                <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-100">
                   <tr>
                      <th className="px-8 py-5">Symbol / Asset</th>
                      <th className="px-8 py-5 text-right">Menge</th>
                      <th className="px-8 py-5 text-right">Kaufkurs (Avg)</th>
                      <th className="px-8 py-5 text-right">Schlusskurs</th>
                      <th className="px-8 py-5 text-right text-blue-600">Marktwert (USD)</th>
                      <th className="px-8 py-5 text-right">Unreal. PnL</th>
                      <th className="px-4 py-5 w-20 text-center">Aktionen</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                   {activePositions.map((pos) => {
                      const valUSD = getValUSD(pos.currency, pos.val);
                      const unRealUSD = getValUSD(pos.currency, pos.unReal);
                      
                      return (
                      <tr key={pos.symbol} className="hover:bg-gray-50/80 transition-colors group">
                         <td className="px-8 py-5">
                            <div className="flex flex-col">
                               <span className="font-black text-gray-800">{pos.symbol}</span>
                               <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{pos.currency}</span>
                            </div>
                         </td>
                         <td className="px-8 py-5 text-right font-bold text-gray-600">{pos.qty.toLocaleString('de-CH')}</td>
                         <td className="px-8 py-5 text-right text-gray-400 text-xs">
                            {pos.cost.toLocaleString('de-CH', { minimumFractionDigits: 2 })} <span className="opacity-50">{pos.currency}</span>
                         </td>
                         <td className="px-8 py-5 text-right font-black text-gray-800">
                            {pos.close.toLocaleString('de-CH', { minimumFractionDigits: 2 })} <span className="text-[9px] text-gray-400 uppercase font-bold">{pos.currency}</span>
                         </td>
                         <td className="px-8 py-5 text-right font-black text-blue-600">{valUSD.toLocaleString('de-CH', { minimumFractionDigits: 2 })}</td>
                         <td className={`px-8 py-5 text-right font-black ${unRealUSD >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {unRealUSD >= 0 ? '+' : ''}{unRealUSD.toLocaleString('de-CH', { minimumFractionDigits: 2 })}
                         </td>
                         <td className="px-4 py-5 text-right">
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onClick={() => startEditingPosition(pos)} className="text-gray-300 hover:text-blue-500 p-2" title="Bearbeiten">
                                    <Pencil size={16} />
                                </button>
                                <button onClick={() => removePosition(pos.symbol)} className="text-gray-300 hover:text-red-500 p-2" title="Entfernen">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                         </td>
                      </tr>
                   );})}
                   {activePositions.length === 0 && (
                     <tr><td colSpan={7} className="px-8 py-20 text-center text-gray-300 font-bold italic uppercase text-xs">Keine aktiven Positionen im Jahr {currentYear}</td></tr>
                   )}
                </tbody>
             </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden space-y-3">
            {activePositions.map(pos => <MobilePositionCard key={pos.symbol} pos={pos} />)}
            {activePositions.length === 0 && (
               <div className="p-8 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200 text-xs font-bold">Keine Positionen</div>
            )}
          </div>
      </div>

      {/* REALIZED / CLOSED POSITIONS SECTION */}
      {realizedPositions.length > 0 && (
        <div className="space-y-4">
            <div className="flex items-center gap-3 px-2">
               <History className="text-gray-400" size={20} />
               <h4 className="text-sm lg:text-lg font-black text-gray-600 uppercase tracking-tight">Realisierte PnL (Verkäufe)</h4>
            </div>
            
            {/* Desktop Table */}
            <div className="hidden lg:block bg-white rounded-[32px] border border-gray-100 shadow-xl overflow-hidden">
               <table className="w-full text-left">
                  <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-100">
                     <tr>
                        <th className="px-8 py-5">Symbol / Asset</th>
                        <th className="px-8 py-5 text-right">Aktueller Bestand</th>
                        <th className="px-8 py-5 text-right">Realisiert (USD)</th>
                        <th className="px-8 py-5 text-right">Realisiert (CHF)</th>
                        <th className="px-4 py-5 w-10"></th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                     {realizedPositions.map((pos) => {
                        const realUSD = pos.real;
                        const realCHF = realUSD * usdToChf;
                        
                        return (
                        <tr key={`closed-${pos.symbol}`} className="hover:bg-gray-50/80 transition-colors group">
                           <td className="px-8 py-5">
                              <span className="font-black text-gray-600">{pos.symbol}</span>
                           </td>
                           <td className="px-8 py-5 text-right font-bold text-gray-400">
                               {pos.qty === 0 ? '0 (Geschlossen)' : `${pos.qty} (Offen)`}
                           </td>
                           <td className={`px-8 py-5 text-right font-black ${realUSD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {realUSD >= 0 ? '+' : ''}{realUSD.toLocaleString('de-CH', { minimumFractionDigits: 2 })}
                           </td>
                           <td className={`px-8 py-5 text-right font-bold ${realCHF >= 0 ? 'text-green-600/70' : 'text-red-600/70'}`}>
                              {realCHF >= 0 ? '+' : ''}{realCHF.toLocaleString('de-CH', { minimumFractionDigits: 2 })}
                           </td>
                           <td className="px-4 py-5 text-right">
                               {pos.qty === 0 && (
                                   <button onClick={() => removePosition(pos.symbol)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-2" title="Entfernen">
                                       <Trash2 size={16} />
                                   </button>
                               )}
                           </td>
                        </tr>
                     );})}
                  </tbody>
               </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden space-y-3">
              {realizedPositions.map(pos => <MobileClosedCard key={`closed-${pos.symbol}`} pos={pos} />)}
            </div>
        </div>
      )}

      {/* CASH TABLE / CARDS */}
      <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
                <Wallet className="text-indigo-500" size={20} />
                <h4 className="text-sm lg:text-lg font-black text-gray-800 uppercase tracking-tight">Cash Bestände</h4>
             </div>
             <div className="px-3 py-1 bg-[#16325c] rounded-xl text-white font-black text-xs lg:text-xl">
                {cashTotalCHF.toLocaleString('de-CH', { maximumFractionDigits: 0 })} <span className="text-[9px] opacity-60">CHF</span>
             </div>
          </div>
          
          {/* Desktop */}
          <div className="hidden lg:block bg-white rounded-[32px] border border-gray-100 shadow-xl overflow-hidden">
             <table className="w-full text-left">
                <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-100">
                   <tr>
                      <th className="px-8 py-5">Währung</th>
                      <th className="px-8 py-5 text-right">Original Betrag</th>
                      <th className="px-8 py-5 text-right">Kurs (➔ USD)</th>
                      <th className="px-8 py-5 text-right">Wert in USD</th>
                      <th className="px-8 py-5 text-right text-green-600">Wert in CHF</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                   {cashList.map(([curr, amt]) => {
                      const valUSD = getValUSD(curr, amt);
                      const valCHF = valUSD * usdToChf;
                      return (
                        <tr key={curr} className="hover:bg-gray-50/80 transition-colors">
                           <td className="px-8 py-5 font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">{curr}</td>
                           <td className={`px-8 py-5 text-right font-bold ${amt < 0 ? 'text-red-500' : 'text-gray-700'}`}>{amt.toLocaleString('de-CH', { minimumFractionDigits: 2 })}</td>
                           <td className="px-8 py-5 text-right text-[10px] font-black text-gray-300">{(amt !== 0 ? valUSD/amt : 0).toFixed(4)}</td>
                           <td className={`px-8 py-5 text-right font-black ${valUSD < 0 ? 'text-red-500' : 'text-gray-800'}`}>{valUSD.toLocaleString('de-CH', { minimumFractionDigits: 2 })}</td>
                           <td className={`px-8 py-5 text-right font-black ${valCHF < 0 ? 'text-red-600' : 'text-green-600'}`}>{valCHF.toLocaleString('de-CH', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                   })}
                </tbody>
             </table>
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-3">
             {cashList.map(([curr, amt]) => {
                const valUSD = getValUSD(curr, amt);
                const valCHF = valUSD * usdToChf;
                return <MobileCashCard key={curr} curr={curr} amt={amt} valCHF={valCHF} />;
             })}
          </div>
      </div>

      <div className="bg-blue-50 p-4 lg:p-6 rounded-2xl lg:rounded-3xl border border-blue-100 flex items-start gap-4 text-xs">
         <Info className="text-blue-500 shrink-0 mt-0.5" size={18} />
         <p className="text-blue-600 leading-relaxed font-bold">
            Die Summe der Cash-Bestände aus dem aktiven Portfolio wird automatisch in den Steuer-Tab übernommen.
         </p>
      </div>

      {/* EDIT POSITION MODAL */}
      {editingSymbol && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
                      <h3 className="font-black text-xl text-gray-800 flex items-center gap-2">
                          <Pencil size={20} className="text-blue-600"/> Position Bearbeiten
                      </h3>
                      <button onClick={() => setEditingSymbol(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20}/></button>
                  </div>
                  
                  <div className="space-y-4">
                      <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex justify-between items-center">
                          <span className="text-xs font-bold text-blue-400 uppercase">Symbol</span>
                          <span className="font-black text-xl text-blue-700">{editPosForm.symbol}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Menge</label>
                              <input 
                                  type="number" 
                                  value={editPosForm.qty || ''} 
                                  onChange={(e) => setEditPosForm({...editPosForm, qty: parseFloat(e.target.value)})} 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              />
                          </div>
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Währung</label>
                              <select 
                                  value={editPosForm.currency || 'USD'} 
                                  onChange={(e) => setEditPosForm({...editPosForm, currency: e.target.value})} 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none"
                              >
                                  <option value="USD">USD</option>
                                  <option value="EUR">EUR</option>
                                  <option value="CHF">CHF</option>
                                  <option value="SEK">SEK</option>
                                  <option value="NOK">NOK</option>
                                  <option value="GBP">GBP</option>
                              </select>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Kaufkurs (Avg)</label>
                              <input 
                                  type="number" 
                                  value={editPosForm.cost || ''} 
                                  onChange={(e) => setEditPosForm({...editPosForm, cost: parseFloat(e.target.value)})} 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              />
                          </div>
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Schlusskurs</label>
                              <input 
                                  type="number" 
                                  value={editPosForm.close || ''} 
                                  onChange={(e) => setEditPosForm({...editPosForm, close: parseFloat(e.target.value)})} 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              />
                          </div>
                      </div>

                      <div className="space-y-1 pt-2 border-t border-dashed border-gray-200">
                          <label className="text-[10px] font-black text-purple-500 uppercase flex items-center justify-between">
                              Marktwert (in Basis-Währung USD)
                              <span className="text-[9px] text-gray-300">Manuelle Korrektur</span>
                          </label>
                          <input 
                              type="number" 
                              value={editPosForm.val || ''} 
                              onChange={(e) => setEditPosForm({...editPosForm, val: parseFloat(e.target.value)})} 
                              className="w-full bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-lg font-black text-purple-700 outline-none focus:ring-2 focus:ring-purple-200"
                          />
                          <p className="text-[9px] text-gray-400 italic">Hier korrigieren, falls Währungsumrechnung falsch war.</p>
                      </div>

                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Unrealisiert PnL (USD)</label>
                          <input 
                              type="number" 
                              value={editPosForm.unReal || ''} 
                              onChange={(e) => setEditPosForm({...editPosForm, unReal: parseFloat(e.target.value)})} 
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100"
                          />
                      </div>
                  </div>

                  <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
                      <button onClick={() => setEditingSymbol(null)} className="flex-1 py-3 text-gray-500 font-bold text-sm hover:bg-gray-100 rounded-xl transition-colors">Abbrechen</button>
                      <button onClick={savePositionEdit} className="flex-1 py-3 bg-[#16325c] text-white font-bold text-sm rounded-xl shadow-lg hover:bg-blue-800 transition-all flex items-center justify-center gap-2">
                          <Check size={18}/> Speichern
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default HoldingsView;
