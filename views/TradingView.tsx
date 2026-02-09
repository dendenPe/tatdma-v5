
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Save, FileText, Image as ImageIcon, Upload, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { AppData, Trade, DayEntry } from '../types';
import { DBService } from '../services/dbService';
import { ImportService } from '../services/importService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
}

const TradingView: React.FC<Props> = ({ data, onUpdate }) => {
  // Initialize with today, but allow navigation
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [entry, setEntry] = useState<DayEntry>({
    total: 0,
    note: '',
    trades: [],
    screenshots: [],
    fees: 0
  });
  const [message, setMessage] = useState('');
  const [screenshotPreviews, setScreenshotPreviews] = useState<Record<string, string>>({});
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load data whenever currentDate or data changes
  useEffect(() => {
    if (data.trades[currentDate]) {
      setEntry(data.trades[currentDate]);
    } else {
      // Reset to empty if no data for this day
      setEntry({
        total: 0,
        note: '',
        trades: [],
        screenshots: [],
        fees: 0
      });
    }
  }, [currentDate, data.trades]);

  // Load Screenshot Previews
  useEffect(() => {
    // Cleanup old URLs
    Object.values(screenshotPreviews).forEach(url => URL.revokeObjectURL(url));
    setScreenshotPreviews({});

    if (entry.screenshots && entry.screenshots.length > 0) {
        entry.screenshots.forEach(async (id) => {
            const blob = await DBService.getFile(id);
            if (blob) {
                setScreenshotPreviews(prev => ({ ...prev, [id]: URL.createObjectURL(blob) }));
            }
        });
    }
  }, [entry.screenshots]);

  const changeDate = (days: number) => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + days);
    setCurrentDate(date.toISOString().split('T')[0]);
  };

  const addTrade = () => {
    setEntry({
      ...entry,
      trades: [...entry.trades, { pnl: 0, fee: 0, inst: 'ES', qty: 1, start: '', end: '', tag: '' }]
    });
  };

  const removeTrade = (index: number) => {
    const newTrades = entry.trades.filter((_, i) => i !== index);
    const newFees = newTrades.reduce((s, t) => s + (t.fee || 0), 0);
    const newTotalGross = newTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
    
    // Recalculate Net Total (Gross - Fees)
    setEntry({ ...entry, trades: newTrades, total: newTotalGross - newFees, fees: newFees });
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

  const handleFileUpload = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      
      const newIds: string[] = [];
      const newPreviews: Record<string, string> = {};

      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.type.startsWith('image/')) continue;

          const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await DBService.saveFile(id, file);
          
          newIds.push(id);
          newPreviews[id] = URL.createObjectURL(file);
      }

      if (newIds.length > 0) {
          setScreenshotPreviews(prev => ({ ...prev, ...newPreviews }));
          setEntry(prev => ({ ...prev, screenshots: [...(prev.screenshots || []), ...newIds] }));
          setMessage('Bild hinzugefügt (Speichern nicht vergessen!)');
          setTimeout(() => setMessage(''), 2000);
      }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length > 0) {
          handleFileUpload(e.clipboardData.files);
      }
  };

  const removeScreenshot = (id: string) => {
      const newScreenshots = (entry.screenshots || []).filter(s => s !== id);
      setEntry({ ...entry, screenshots: newScreenshots });
      
      // Cleanup preview URL
      if (screenshotPreviews[id]) {
          URL.revokeObjectURL(screenshotPreviews[id]);
          const newPreviews = { ...screenshotPreviews };
          delete newPreviews[id];
          setScreenshotPreviews(newPreviews);
      }
  };

  const handleSave = () => {
    const newData = { ...data };
    // Only save if there is content to avoid empty entries in DB
    if (entry.trades.length > 0 || entry.note.trim() || entry.total !== 0 || (entry.screenshots && entry.screenshots.length > 0)) {
        newData.trades[currentDate] = entry;
    } else {
        newData.trades[currentDate] = entry;
    }
    onUpdate(newData);
    setMessage('✓ Gespeichert');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleTradeImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const importedDays = ImportService.parseTradesCSV(text);
      
      const newData = { ...data };
      let count = 0;
      
      Object.entries(importedDays).forEach(([date, importedEntry]) => {
          if (!newData.trades[date]) {
              newData.trades[date] = importedEntry;
              count += importedEntry.trades.length;
          } else {
              const existingDay = newData.trades[date];
              if (importedEntry.note) existingDay.note = importedEntry.note;
              
              const hasAggregatedImports = importedEntry.trades.some(t => t.strategy?.includes('Agg'));
              
              if (hasAggregatedImports) {
                  const manualTrades = existingDay.trades.filter(t => !t.strategy?.includes('Agg'));
                  existingDay.trades = [...manualTrades, ...importedEntry.trades];
                  count += importedEntry.trades.length;
              } else {
                  const uniqueNewTrades: Trade[] = [];
                  importedEntry.trades.forEach(newTrade => {
                      const isDuplicate = existingDay.trades.some(existing => 
                          existing.inst === newTrade.inst &&
                          Math.abs(existing.pnl - newTrade.pnl) < 0.01 && 
                          existing.start === newTrade.start
                      );
                      if (!isDuplicate) {
                          uniqueNewTrades.push(newTrade);
                      }
                  });
                  if (uniqueNewTrades.length > 0) {
                      existingDay.trades = [...existingDay.trades, ...uniqueNewTrades];
                      count += uniqueNewTrades.length;
                  }
              }

              const recalcGross = existingDay.trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
              const recalcFees = existingDay.trades.reduce((s, t) => s + (Number(t.fee) || 0), 0);
              
              existingDay.fees = recalcFees;
              existingDay.total = recalcGross - recalcFees; 
          }
      });

      onUpdate(newData);
      if (importedDays[currentDate] || newData.trades[currentDate]) {
          setEntry(newData.trades[currentDate]);
      }
      alert(`${count} Trades importiert / aktualisiert.`);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // Helper for Date Display
  const dateObj = new Date(currentDate);
  const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });
  const dayDisplay = dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Calculated Gross for Display
  const grossTotal = (entry.total || 0) + (entry.fees || 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6" onPaste={handlePaste}>
      {/* HEADER WITH NAVIGATION */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
         <div className="flex items-center gap-4">
            <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                <ChevronLeft size={24} />
            </button>
            <div className="flex flex-col items-center">
                <h2 className="text-xl font-black text-gray-800 tracking-tight">{dayDisplay}</h2>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{dayName}</span>
            </div>
            <button onClick={() => changeDate(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                <ChevronRight size={24} />
            </button>
         </div>
         
         <div className="flex items-center gap-3">
             <div className="relative">
                 <input 
                   type="date" 
                   value={currentDate} 
                   onChange={(e) => setCurrentDate(e.target.value)} 
                   className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                 />
                 <button className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg text-xs font-bold border border-gray-200 transition-all">
                    <CalendarIcon size={16} /> Springe zu Datum
                 </button>
             </div>
             
             {/* Jump to Today Button */}
             {currentDate !== new Date().toISOString().split('T')[0] && (
                 <button 
                    onClick={() => setCurrentDate(new Date().toISOString().split('T')[0])}
                    className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold border border-blue-100 hover:bg-blue-100 transition-all"
                 >
                    Heute
                 </button>
             )}
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-[#f8f9fa] border-b border-gray-100 p-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <FileText size={18} className="text-blue-500" />
                Journal Einträge
              </h3>
              {entry.trades.length > 0 && (
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-bold">{entry.trades.length} Trades</span>
              )}
            </div>
            
            <div className="p-6 space-y-4">
              
              {/* NEW BREAKDOWN SUMMARY CARD */}
              <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2 rounded-xl border border-gray-200">
                  <div className="text-center p-2 border-r border-gray-200">
                      <p className="text-[9px] font-bold text-gray-400 uppercase">Brutto PnL</p>
                      <p className={`text-sm font-black ${grossTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {grossTotal.toFixed(2)}
                      </p>
                  </div>
                  <div className="text-center p-2 border-r border-gray-200">
                      <p className="text-[9px] font-bold text-gray-400 uppercase">Kommissionen</p>
                      <p className="text-sm font-black text-red-500">
                          -{(entry.fees || 0).toFixed(2)}
                      </p>
                  </div>
                  <div className="text-center p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                      <p className="text-[9px] font-bold text-blue-500 uppercase">Netto PnL</p>
                      <p className={`text-lg font-black ${entry.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {entry.total.toFixed(2)} $
                      </p>
                  </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Einzel-Trades</label>
                  <div className="flex gap-2">
                    <label className="cursor-pointer text-gray-400 hover:text-blue-600 text-xs font-bold flex items-center gap-1 transition-colors">
                        <Upload size={14} /> CSV Import
                        <input type="file" className="hidden" accept=".csv" onChange={handleTradeImport} />
                    </label>
                    <button onClick={addTrade} className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1 transition-colors">
                        <Plus size={14} /> Neu
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
                      Keine Trades an diesem Tag
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
              {/* Clickable Upload Area */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-all cursor-pointer bg-gray-50 active:scale-95"
              >
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    multiple
                    onChange={(e) => handleFileUpload(e.target.files)} 
                />
                <ImageIcon size={32} />
                <span className="text-[10px] mt-2 font-bold uppercase tracking-tight">Klicken zum Upload</span>
                <span className="text-[9px] font-medium opacity-50 mt-1">oder Paste (Ctrl+V)</span>
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">Maximal 5 Bilder pro Tag</p>
              
              {/* Thumbnail Gallery */}
              {entry.screenshots && entry.screenshots.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-4">
                      {entry.screenshots.map((id) => (
                          <div key={id} className="relative group aspect-video rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-100">
                              <img src={screenshotPreviews[id]} alt="Screenshot" className="w-full h-full object-cover" />
                              <button 
                                  onClick={(e) => { e.stopPropagation(); removeScreenshot(id); }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                  <Trash2 size={12} />
                              </button>
                          </div>
                      ))}
                  </div>
              )}
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
