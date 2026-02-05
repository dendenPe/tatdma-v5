
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, FileText, Image as ImageIcon, Upload, DollarSign } from 'lucide-react';
import { AppData, Trade, DayEntry } from '../types';
import { DBService } from '../services/dbService';
import { ImportService } from '../services/importService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
}

const TradingView: React.FC<Props> = ({ data, onUpdate }) => {
  const [currentDate] = useState(new Date().toISOString().split('T')[0]);
  const [entry, setEntry] = useState<DayEntry>({
    total: 0,
    note: '',
    trades: [],
    screenshots: [],
    fees: 0
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (data.trades[currentDate]) {
      setEntry(data.trades[currentDate]);
    }
  }, [currentDate, data.trades]);

  const addTrade = () => {
    setEntry({
      ...entry,
      trades: [...entry.trades, { pnl: 0, fee: 0, inst: 'ES', qty: 1, start: '', end: '', tag: '' }]
    });
  };

  const removeTrade = (index: number) => {
    const newTrades = entry.trades.filter((_, i) => i !== index);
    const newFees = newTrades.reduce((s, t) => s + (t.fee || 0), 0);
    const newTotal = newTrades.reduce((s, t) => s + (t.pnl || 0), 0) - newFees;
    
    setEntry({ ...entry, trades: newTrades, total: newTotal, fees: newFees });
  };

  const updateTrade = (index: number, field: keyof Trade, value: any) => {
    const newTrades = [...entry.trades];
    newTrades[index] = { ...newTrades[index], [field]: value };
    
    // Auto-recalc total if pnl or fee changed
    if (field === 'pnl' || field === 'fee') {
       const totalGross = newTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
       const totalFees = newTrades.reduce((sum, t) => sum + (Number(t.fee) || 0), 0);
       setEntry({ ...entry, trades: newTrades, total: totalGross - totalFees, fees: totalFees });
    } else {
       setEntry({ ...entry, trades: newTrades });
    }
  };

  const handleSave = () => {
    const newData = { ...data };
    newData.trades[currentDate] = entry;
    onUpdate(newData);
    setMessage('✓ Erfolgreich gespeichert!');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleTradeImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const importedDays = ImportService.parseIBKRTradesCSV(text);
      
      const newData = { ...data };
      let count = 0;
      let skipped = 0;
      
      // Merge imported days with Duplicate Check
      Object.entries(importedDays).forEach(([date, importedEntry]) => {
          if (!newData.trades[date]) {
              // Day doesn't exist yet, take everything
              newData.trades[date] = importedEntry;
              count += importedEntry.trades.length;
          } else {
              // Day exists, check for duplicates
              const existingDay = newData.trades[date];
              const uniqueNewTrades: Trade[] = [];
              let addedFees = 0;

              importedEntry.trades.forEach(newTrade => {
                  // Check if a VERY similar trade exists
                  const isDuplicate = existingDay.trades.some(existing => 
                      existing.inst === newTrade.inst &&
                      Math.abs(existing.pnl - newTrade.pnl) < 0.01 && // Float tolerance
                      existing.qty === newTrade.qty &&
                      existing.start === newTrade.start &&
                      existing.end === newTrade.end
                  );

                  if (!isDuplicate) {
                      uniqueNewTrades.push(newTrade);
                      addedFees += (newTrade.fee || 0);
                  } else {
                      skipped++;
                  }
              });

              if (uniqueNewTrades.length > 0) {
                  existingDay.trades = [...existingDay.trades, ...uniqueNewTrades];
                  existingDay.fees = (existingDay.fees || 0) + addedFees;
                  
                  // Recalculate Day Total (Gross PnL - Fees)
                  const grossPnL = existingDay.trades.reduce((s, t) => s + t.pnl, 0);
                  const totalFees = existingDay.fees || 0;
                  existingDay.total = grossPnL - totalFees;
                  
                  count += uniqueNewTrades.length;
              }
          }
      });

      onUpdate(newData);
      // Reload current view if today was affected
      if (importedDays[currentDate]) {
          setEntry(newData.trades[currentDate]);
      }
      
      let msg = `${count} neue Trades importiert.`;
      if (skipped > 0) msg += `\n(${skipped} Duplikate ignoriert)`;
      alert(msg);
      
      // Reset input
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-[#f8f9fa] border-b border-gray-100 p-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <FileText size={18} className="text-blue-500" />
                Journal Einträge
              </h3>
              <span className="text-xs text-gray-400 font-medium">{currentDate}</span>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Netto PnL (inkl. Gebühren) $</label>
                  <input 
                    type="number"
                    value={entry.total}
                    readOnly
                    style={{ colorScheme: 'light' }}
                    className={`w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xl font-bold focus:ring-2 focus:ring-blue-500 outline-none ${entry.total >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    placeholder="0.00"
                  />
                </div>
                <div className="w-1/3 space-y-1.5">
                   <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Gebühren $</label>
                   <div className="w-full px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-lg font-bold text-red-400 flex items-center gap-1">
                      <DollarSign size={14} />
                      {entry.fees?.toFixed(2) || '0.00'}
                   </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Einzel-Trades</label>
                  <div className="flex gap-2">
                    <label className="cursor-pointer text-gray-400 hover:text-blue-600 text-xs font-bold flex items-center gap-1 transition-colors">
                        <Upload size={14} /> CSV
                        <input type="file" className="hidden" accept=".csv" onChange={handleTradeImport} />
                    </label>
                    <button onClick={addTrade} className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1 transition-colors">
                        <Plus size={14} /> Trade hinzufügen
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-2 px-2 text-[9px] font-black text-gray-400 uppercase tracking-wider">
                     <div className="col-span-2">PnL (Gross)</div>
                     <div className="col-span-2">Fee</div>
                     <div className="col-span-2">Inst</div>
                     <div className="col-span-3 text-center">Zeit</div>
                     <div className="col-span-2"></div>
                  </div>
                  {entry.trades.map((trade, idx) => (
                    <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100 grid grid-cols-12 gap-2 items-center animate-in fade-in slide-in-from-top-1">
                      <div className="col-span-2">
                        <input 
                          type="number"
                          value={trade.pnl}
                          onChange={(e) => updateTrade(idx, 'pnl', parseFloat(e.target.value))}
                          style={{ colorScheme: 'light' }}
                          className={`w-full bg-white border border-gray-200 rounded p-2 text-sm font-bold shadow-sm focus:ring-1 focus:ring-blue-100 outline-none ${trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}
                          placeholder="PnL"
                        />
                      </div>
                      <div className="col-span-2">
                        <input 
                          type="number"
                          value={trade.fee || 0}
                          onChange={(e) => updateTrade(idx, 'fee', parseFloat(e.target.value))}
                          style={{ colorScheme: 'light' }}
                          className="w-full bg-white border border-gray-200 rounded p-2 text-xs font-medium text-red-400 shadow-sm focus:ring-1 focus:ring-red-100 outline-none"
                          placeholder="Fee"
                        />
                      </div>
                      <div className="col-span-2">
                        <input 
                          type="text"
                          value={trade.inst}
                          onChange={(e) => updateTrade(idx, 'inst', e.target.value)}
                          style={{ colorScheme: 'light' }}
                          className="w-full bg-white border border-gray-200 rounded p-2 text-xs font-bold uppercase text-blue-600 shadow-sm focus:ring-1 focus:ring-blue-100 outline-none"
                        />
                      </div>
                      <div className="col-span-3 flex gap-1">
                        <input 
                          type="time" 
                          value={trade.start} 
                          onChange={(e) => updateTrade(idx, 'start', e.target.value)}
                          style={{ colorScheme: 'light' }}
                          className="w-full bg-white border border-gray-200 rounded p-1 text-[10px] shadow-sm outline-none" 
                        />
                        <input 
                          type="time" 
                          value={trade.end} 
                          onChange={(e) => updateTrade(idx, 'end', e.target.value)}
                          style={{ colorScheme: 'light' }}
                          className="w-full bg-white border border-gray-200 rounded p-1 text-[10px] shadow-sm outline-none" 
                        />
                      </div>
                      <div className="col-span-3 flex justify-end">
                        <button onClick={() => removeTrade(idx)} className="text-gray-300 hover:text-red-500 p-2 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {entry.trades.length === 0 && (
                    <div className="text-center py-8 text-gray-400 italic text-sm">
                      Keine Trades für heute erfasst
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
             <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Tagesnotizen</label>
             <textarea 
               value={entry.note}
               onChange={(e) => setEntry({ ...entry, note: e.target.value })}
               rows={6}
               style={{ colorScheme: 'light' }}
               className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
               placeholder="Marktbedingungen, Strategie-Check, Gefühlszustand..."
             />
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <ImageIcon size={16} className="text-purple-500" />
              Screenshots
            </h4>
            <div className="space-y-3">
              <div className="aspect-square border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-all cursor-pointer bg-gray-50">
                <ImageIcon size={32} />
                <span className="text-[10px] mt-2 font-bold uppercase tracking-tight">Klicken zum Upload</span>
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">Maximal 5 Bilder pro Tag</p>
            </div>
          </div>

          <button 
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Save size={20} /> Speichern
          </button>
          
          {message && (
            <div className="p-3 bg-green-50 text-green-600 text-center rounded-lg text-xs font-bold animate-pulse">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TradingView;
