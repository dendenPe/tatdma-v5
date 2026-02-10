
import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  TrendingUp, 
  Clock, 
  X, 
  Plus, 
  FileText, 
  ImageIcon, 
  Save,
  BarChart4,
  Trash2,
  Timer,
  Paperclip,
  Image as ImageIconAlt,
  Wallet,
  Calendar,
  List
} from 'lucide-react';
import { AppData, DayEntry, Trade } from '../types';
import { DBService } from '../services/dbService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LineChart, Line } from 'recharts';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  targetDate?: Date | null;
}

const CalendarView: React.FC<Props> = ({ data, onUpdate, targetDate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [screenshotPreviews, setScreenshotPreviews] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month'); // VIEW MODE
  
  const widgetRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
      if (targetDate) {
          setCurrentDate(new Date(targetDate));
      }
  }, [targetDate]);

  useEffect(() => {
    if (widgetRef.current) {
      widgetRef.current.innerHTML = '';
      const script = document.createElement('script');
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = JSON.stringify({
        "colorTheme": "light",
        "isTransparent": false,
        "width": "100%",
        "height": "100%",
        "locale": "de_DE",
        "importanceFilter": "1",
        "countryFilter": "us"
      });
      widgetRef.current.appendChild(script);
    }
  }, [currentDate]);

  useEffect(() => {
    if (selectedDay) {
      const entry = data.trades[selectedDay];
      if (entry?.screenshots) {
        entry.screenshots.forEach(async (id) => {
          if (!screenshotPreviews[id]) {
            const blob = await DBService.getFile(id);
            if (blob) {
              const url = URL.createObjectURL(blob);
              setScreenshotPreviews(prev => ({ ...prev, [id]: url }));
            }
          }
        });
      }
    } else {
      Object.values(screenshotPreviews).forEach(url => URL.revokeObjectURL(url));
      setScreenshotPreviews({});
    }
  }, [selectedDay, data.trades]);

  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startDay = firstDayOfMonth.getDay() === 0 ? 6 : firstDayOfMonth.getDay() - 1;
  const daysInMonth = lastDayOfMonth.getDate();

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const changeWeek = (offset: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (offset * 7));
    setCurrentDate(newDate);
  };

  const getDayPnL = (day: number) => {
    const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return data.trades[key]?.total || 0;
  };

  const monthStats = () => {
    let total = 0;
    let fees = 0;
    let wins = 0;
    let count = 0;
    let equityCurve: { day: number, value: number }[] = [];
    let runningTotal = 0;
    
    for (let i = 1; i <= daysInMonth; i++) {
      const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const entry = data.trades[key];
      
      if (entry) {
          if (entry.total !== 0) {
              total += entry.total;
              runningTotal += entry.total;
              if (entry.total > 0) wins++;
              count++;
          }
          if (entry.fees) {
              fees += entry.fees;
          }
      }
      // Add point for curve if changed
      if (count > 0 && entry?.total !== 0) equityCurve.push({ day: i, value: runningTotal });
    }
    return { total, fees, wr: count > 0 ? (wins / count * 100).toFixed(0) : '0', count, equityCurve };
  };

  const stats = monthStats();
  const selectedEntry = selectedDay ? data.trades[selectedDay] || { total: 0, note: '', trades: [], screenshots: [], fees: 0 } : null;

  // --- RECALCULATION HELPER ---
  const recalculateEntry = (entry: DayEntry): DayEntry => {
      const gross = entry.trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
      const fees = entry.trades.reduce((sum, t) => sum + (Number(t.fee) || 0), 0);
      return { ...entry, fees, total: gross - fees };
  };

  const handleUpdateTrade = (idx: number, field: keyof Trade, val: any) => {
    if (!selectedDay || !selectedEntry) return;
    const newEntry = { ...selectedEntry };
    newEntry.trades = [...newEntry.trades];
    newEntry.trades[idx] = { ...newEntry.trades[idx], [field]: val };
    
    const updatedEntry = recalculateEntry(newEntry);
    
    const newData = { ...data };
    newData.trades[selectedDay] = updatedEntry;
    onUpdate(newData);
  };

  const addTrade = () => {
    if (!selectedDay || !selectedEntry) return;
    const newTrade: Trade = {
      inst: 'ES', qty: 1, pnl: 0, fee: 0, start: '09:30', end: '10:00', tag: '', strategy: 'Long-Cont.'
    };
    const newEntry = { ...selectedEntry, trades: [...selectedEntry.trades, newTrade] };
    const newData = { ...data };
    newData.trades[selectedDay] = recalculateEntry(newEntry);
    onUpdate(newData);
  };

  const removeTrade = (idx: number) => {
    if (!selectedDay || !selectedEntry) return;
    const newEntry = { ...selectedEntry };
    newEntry.trades = newEntry.trades.filter((_, i) => i !== idx);
    const newData = { ...data };
    newData.trades[selectedDay] = recalculateEntry(newEntry);
    onUpdate(newData);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !selectedDay || !selectedEntry) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await DBService.saveFile(id, file);

    const newUrl = URL.createObjectURL(file);
    setScreenshotPreviews(prev => ({ ...prev, [id]: newUrl }));

    const updatedEntry = {
      ...selectedEntry,
      screenshots: [...(selectedEntry.screenshots || []), id]
    };
    
    const newData = { ...data };
    newData.trades[selectedDay] = updatedEntry;
    onUpdate(newData);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) {
      handleFileUpload(e.clipboardData.files);
    }
  };

  const removeScreenshot = (id: string) => {
    if (!selectedDay || !selectedEntry) return;
    const updatedScreenshots = selectedEntry.screenshots.filter(sid => sid !== id);
    const updatedEntry = { ...selectedEntry, screenshots: updatedScreenshots };
    
    const newData = { ...data };
    newData.trades[selectedDay] = updatedEntry;
    onUpdate(newData);
  };

  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    let diff = (eH * 60 + eM) - (sH * 60 + sM);
    if (diff < 0) diff += 1440;
    return diff;
  };

  const getWaterfallData = () => {
    if (!selectedEntry) return [];
    let cumulative = 0;
    return selectedEntry.trades.map((t, i) => {
      const netPnl = (Number(t.pnl) || 0) - (Number(t.fee) || 0);
      const start = cumulative;
      cumulative += netPnl;
      return {
        name: `${t.inst} #${i + 1}`,
        pnl: netPnl,
        display: [start, cumulative],
        color: netPnl >= 0 ? '#10b981' : '#ef4444'
      };
    });
  };

  const waterfallData = getWaterfallData();
  const chartWidth = Math.min(waterfallData.length * 60 + 100, 500);

  // WEEKLY VIEW LOGIC
  const currentWeekStart = new Date(currentDate);
  const day = currentWeekStart.getDay();
  const diff = currentWeekStart.getDate() - day + (day === 0 ? -6 : 1); 
  currentWeekStart.setDate(diff); // Monday of current week
  
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekStart.getDate() + 6); // Sunday

  const renderGrid = () => {
      if (viewMode === 'month') {
          return (
            <div className="grid grid-cols-7 gap-1 lg:gap-2">
                {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
                    <div key={d} className="py-2 text-center text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{d}</div>
                ))}
                {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`} className="aspect-square bg-gray-50/30 rounded-xl lg:rounded-2xl" />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dayStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const pnl = getDayPnL(day);
                    const isWeekend = (startDay + i) % 7 >= 5;
                    
                    // Streak Check (Simple)
                    const prevDayStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day-1).padStart(2, '0')}`;
                    const prevPnL = data.trades[prevDayStr]?.total || 0;
                    const isStreak = (pnl > 0 && prevPnL > 0) || (pnl < 0 && prevPnL < 0);

                    return (
                    <div 
                        key={day} 
                        onClick={() => setSelectedDay(dayStr)}
                        className={`aspect-square relative p-1 lg:p-2 rounded-xl lg:rounded-2xl border flex flex-col items-center justify-center transition-all cursor-pointer group active:scale-95 ${
                        pnl !== 0 
                        ? (pnl >= 0 ? 'bg-white border-green-500 shadow-sm shadow-green-100' : 'bg-white border-red-500 shadow-sm shadow-red-100') 
                        : (isWeekend ? 'bg-gray-100/50 border-transparent' : 'bg-white border-gray-100 hover:border-blue-300')
                        } ${isStreak ? (pnl >= 0 ? 'ring-2 ring-green-100' : 'ring-2 ring-red-100') : ''}`}
                    >
                        <span className={`text-[10px] lg:text-xs font-black absolute top-1 left-2 ${pnl !== 0 ? 'text-gray-400' : 'text-gray-300'}`}>{day}</span>
                        {pnl !== 0 && <span className={`text-[10px] lg:text-sm font-black ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{pnl > 0 ? '+' : ''}{Math.round(pnl)}</span>}
                    </div>
                    );
                })}
            </div>
          );
      } else {
          // Weekly View
          const weekDays = Array.from({length: 7}, (_, i) => {
              const d = new Date(currentWeekStart);
              d.setDate(d.getDate() + i);
              return d;
          });

          return (
              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                  {weekDays.map(d => {
                      const dayStr = d.toISOString().split('T')[0];
                      const entry = data.trades[dayStr];
                      const pnl = entry?.total || 0;
                      return (
                          <div key={dayStr} onClick={() => setSelectedDay(dayStr)} className={`h-32 md:h-64 rounded-2xl border p-4 flex flex-col cursor-pointer transition-all hover:scale-[1.02] ${pnl !== 0 ? (pnl >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-white border-gray-100'}`}>
                              <div className="flex justify-between items-center mb-2">
                                  <span className="font-black text-gray-400 text-xs uppercase">{d.toLocaleDateString('de-DE', { weekday: 'short' })}</span>
                                  <span className="font-bold text-gray-300 text-xs">{d.getDate()}.</span>
                              </div>
                              <div className="flex-1 flex items-center justify-center">
                                  {pnl !== 0 ? (
                                      <span className={`text-xl font-black ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{pnl > 0 ? '+' : ''}{pnl.toFixed(0)}</span>
                                  ) : <span className="text-gray-200 font-bold text-sm">-</span>}
                              </div>
                              {entry?.trades && entry.trades.length > 0 && (
                                  <div className="text-[10px] text-center text-gray-400 font-bold">{entry.trades.length} Trades</div>
                              )}
                          </div>
                      );
                  })}
              </div>
          );
      }
  };

  const headerTitle = viewMode === 'month'
      ? currentDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      : `${currentWeekStart.getDate()}. - ${currentWeekEnd.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`;

  return (
    <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8 pb-32">
      <div className="flex-1 space-y-6">
        {/* HEADER STATS & NAV */}
        <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm gap-4">
          <div className="flex items-center gap-4 w-full justify-between sm:justify-start sm:w-auto">
            <button onClick={() => viewMode === 'month' ? changeMonth(-1) : changeWeek(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-xl font-black text-gray-800 min-w-[200px] text-center tracking-tight">
              {headerTitle}
            </h3>
            <button onClick={() => viewMode === 'month' ? changeMonth(1) : changeWeek(1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronRight size={20} />
            </button>
          </div>
          
          <div className="flex items-center gap-2">
              <button onClick={() => setViewMode('month')} className={`p-2 rounded-lg ${viewMode === 'month' ? 'bg-blue-100 text-blue-600' : 'bg-gray-50 text-gray-400'}`}><Calendar size={16}/></button>
              <button onClick={() => setViewMode('week')} className={`p-2 rounded-lg ${viewMode === 'week' ? 'bg-blue-100 text-blue-600' : 'bg-gray-50 text-gray-400'}`}><List size={16}/></button>
          </div>

          <div className="flex gap-2 w-full sm:w-auto justify-center flex-wrap">
            <div className="flex-1 sm:flex-none px-4 py-2 bg-green-50 rounded-xl border border-green-100 flex items-center justify-center gap-2">
              <TrendingUp size={16} className="text-green-500" />
              <span className={`text-sm font-black ${stats.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {stats.total >= 0 ? '+' : ''}{stats.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} $
              </span>
            </div>
            
            <div className="flex-1 sm:flex-none px-4 py-2 bg-red-50 rounded-xl border border-red-100 flex items-center justify-center gap-2" title="Monatliche Kommissionen">
              <Wallet size={16} className="text-red-500" />
              <span className="text-sm font-black text-red-600">
                -{stats.fees.toLocaleString('en-US', { minimumFractionDigits: 2 })} $
              </span>
            </div>

            <div className="flex-1 sm:flex-none px-4 py-2 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-center gap-2">
              <Clock size={16} className="text-blue-500" />
              <span className="text-sm font-black text-blue-700">{stats.wr}% Win</span>
            </div>
          </div>
        </div>

        {/* CALENDAR GRID */}
        {renderGrid()}

        {/* MINI EQUITY CURVE */}
        {viewMode === 'month' && stats.equityCurve.length > 1 && (
            <div className="h-24 w-full bg-white rounded-xl border border-gray-100 p-2 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.equityCurve}>
                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <ReferenceLine y={0} stroke="#e5e7eb" />
                        <Tooltip labelFormatter={(val) => `Tag ${val}`} formatter={(val: number) => val.toFixed(2)} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        )}
      </div>

      <div className="w-full lg:w-[380px] space-y-6 h-[500px] lg:h-[700px]">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden h-full flex flex-col">
            <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex items-center gap-2">
                <BarChart4 size={18} className="text-blue-500" />
                <h4 className="text-xs font-black text-gray-700 uppercase tracking-widest">Wirtschaftskalender</h4>
            </div>
            <div ref={widgetRef} className="flex-1 w-full" />
        </div>
      </div>

      {selectedDay && selectedEntry && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-2 lg:p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200 touch-none"
          onPaste={handlePaste}
        >
          <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[90vh] lg:h-auto lg:max-h-[95vh] animate-in zoom-in-95 duration-200">
            <div className="p-4 lg:p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 lg:w-12 lg:h-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg ${ (selectedEntry.total || 0) >= 0 ? 'bg-green-500' : 'bg-red-500'}`}>
                  {selectedDay.split('-')[2]}
                </div>
                <div>
                  <h3 className="text-lg lg:text-xl font-black text-gray-800 tracking-tight">Tagesansicht</h3>
                  <div className="flex gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      <span>PnL: {selectedEntry.total.toFixed(2)} $</span>
                      <span>•</span>
                      <span>Fees: {selectedEntry.fees?.toFixed(2)} $</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="p-2 hover:bg-gray-200 rounded-xl transition-colors text-gray-400"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 lg:space-y-8" style={{ overscrollBehavior: 'none' }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2"><TrendingUp size={14} className="text-blue-500" /> Netto PnL Verlauf (Fees inkl.)</h4>
                  <div className="h-[250px] lg:h-[300px] bg-gray-50 rounded-2xl p-4 border border-gray-100 flex items-center justify-center overflow-hidden">
                    <div className="w-full h-full flex justify-center items-center">
                       {waterfallData.length > 0 ? (
                           <div style={{ width: `${chartWidth}px`, maxWidth: '100%' }} className="h-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={waterfallData} barSize={24} barCategoryGap={8}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                  <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                                  <YAxis fontSize={10} axisLine={false} tickLine={false} />
                                  <Tooltip 
                                    cursor={{fill: 'rgba(0,0,0,0.02)'}}
                                    content={({ active, payload }) => {
                                      if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                          <div className="bg-white p-3 rounded-xl shadow-xl border border-gray-100">
                                            <p className="text-[10px] font-black text-gray-400 uppercase mb-1">{data.name}</p>
                                            <p className={`text-sm font-black ${data.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                              {data.pnl >= 0 ? '+' : ''}{data.pnl.toFixed(2)} $ (Netto)
                                            </p>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  />
                                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                                  <Bar dataKey="display" radius={[2, 2, 2, 2]}>
                                    {waterfallData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                           </div>
                       ) : (
                           <div className="text-gray-300 text-xs font-bold uppercase tracking-wider flex flex-col items-center gap-2">
                               <BarChart4 size={24} className="opacity-20" />
                               Keine Trades vorhanden
                           </div>
                       )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2"><Plus size={14} className="text-blue-500" /> Trades verwalten</h4>
                    <button onClick={addTrade} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 hover:bg-blue-700 transition-colors">
                      <Plus size={12} /> Add Trade
                    </button>
                  </div>
                  <div className="space-y-3">
                    {selectedEntry.trades.map((t, idx) => (
                      <div key={idx} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          {/* Left Group: Inst + Qty */}
                          <div className="flex items-center gap-2">
                              <input type="text" value={t.inst} onChange={(e) => handleUpdateTrade(idx, 'inst', e.target.value)} className="w-16 sm:w-20 font-black text-blue-600 outline-none uppercase text-sm" />
                              <div className="flex items-center gap-1 bg-gray-50 rounded p-1">
                                 <input type="number" value={t.qty} onChange={(e) => handleUpdateTrade(idx, 'qty', parseInt(e.target.value))} className="w-10 sm:w-12 text-center text-xs font-bold bg-transparent outline-none" />
                                 <span className="text-[10px] font-bold text-gray-300 uppercase">Qty</span>
                              </div>
                          </div>
                          
                          {/* Right Group: Fee, PnL, Delete */}
                          <div className="flex items-center gap-2 sm:gap-4 flex-1 justify-end">
                              {/* Fee */}
                              <div className="flex items-center gap-1">
                                 <span className="hidden sm:inline text-[10px] font-bold text-gray-300 uppercase">Fee:</span>
                                 <input type="number" value={t.fee || 0} onChange={(e) => handleUpdateTrade(idx, 'fee', parseFloat(e.target.value))} className="w-12 text-right text-xs font-bold text-red-400 bg-red-50 rounded p-1 outline-none" />
                              </div>

                              <input 
                                type="number" 
                                value={t.pnl} 
                                onChange={(e) => handleUpdateTrade(idx, 'pnl', parseFloat(e.target.value))} 
                                className={`w-20 sm:w-28 text-right font-black outline-none bg-transparent ${t.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`} 
                              />
                              <button onClick={() => removeTrade(idx)} className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={16} /></button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-100">
                             <Clock size={14} className="text-gray-400" />
                             <input type="time" value={t.start} onChange={(e) => handleUpdateTrade(idx, 'start', e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full" />
                             <span className="text-gray-300">➔</span>
                             <input type="time" value={t.end} onChange={(e) => handleUpdateTrade(idx, 'end', e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-full" />
                          </div>
                          <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-100">
                             <Timer size={14} className="text-blue-400" />
                             <span className="text-[10px] font-black text-blue-600">{calculateDuration(t.start, t.end)} min</span>
                          </div>
                        </div>
                        <select 
                          value={t.strategy} 
                          onChange={(e) => handleUpdateTrade(idx, 'strategy', e.target.value)}
                          className="w-full bg-blue-50 text-blue-700 text-[10px] font-black uppercase p-2 rounded-xl border border-blue-100 outline-none cursor-pointer"
                        >
                          <option value="Long-Reversal">Long-Reversal</option>
                          <option value="Short-Reversal">Short-Reversal</option>
                          <option value="Long-Cont.">Long-Cont.</option>
                          <option value="Short-Cont.">Short-Cont.</option>
                          <option value="Day-Trade">Day-Trade</option>
                          <option value="Long-Agg.">Long-Agg.</option>
                          <option value="Short-Agg.">Short-Agg.</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="space-y-4">
                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Inhalte & Belege</h5>
                    <div className="grid grid-cols-2 gap-4">
                       <button className="p-4 bg-amber-50 hover:bg-amber-100 rounded-2xl border border-amber-100 flex flex-col items-center justify-center gap-3 transition-all">
                         <FileText size={24} className="text-amber-600" />
                         <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Notiz</span>
                       </button>

                       <button 
                         onClick={() => fileInputRef.current?.click()}
                         className="p-4 bg-purple-50 hover:bg-purple-100 rounded-2xl border border-purple-100 flex flex-col items-center justify-center gap-3 transition-all group"
                       >
                         <input 
                           type="file" 
                           ref={fileInputRef} 
                           className="hidden" 
                           accept="image/*" 
                           onChange={(e) => handleFileUpload(e.target.files)} 
                         />
                         <ImageIcon size={24} className="text-purple-600 group-hover:scale-110 transition-transform" />
                         <span className="text-[10px] font-black uppercase tracking-widest text-purple-700">Screenshot</span>
                       </button>
                    </div>

                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleFileUpload(e.dataTransfer.files);
                      }}
                      className="border-2 border-dashed border-gray-100 rounded-3xl p-8 flex flex-col items-center justify-center bg-gray-50/50 text-gray-300 hover:border-purple-200 hover:text-purple-400 transition-all cursor-default"
                    >
                       <ImageIconAlt size={32} strokeWidth={1} />
                       <p className="text-[10px] font-bold uppercase tracking-widest mt-4">Drag & Drop hierher</p>
                       <p className="text-[9px] mt-1 italic opacity-60">oder Paste mit CMD+V</p>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                      Screenshots Gallerie
                      <span className="text-gray-300 font-bold">{selectedEntry.screenshots?.length || 0} / 10</span>
                    </h5>
                    <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto overflow-x-visible p-2">
                       {selectedEntry.screenshots?.map((id) => (
                         <div key={id} className="relative aspect-video rounded-xl bg-gray-100 group shadow-sm border border-gray-100">
                           <img 
                             src={screenshotPreviews[id] || ''} 
                             alt="Screenshot" 
                             className="w-full h-full object-cover rounded-xl transition-all duration-300 ease-out group-hover:scale-[1.8] group-hover:z-50 group-hover:shadow-2xl group-hover:relative cursor-zoom-in origin-center"
                             title="Doppelklick zum Öffnen"
                             onDoubleClick={() => {
                                 const url = screenshotPreviews[id];
                                 if(url) window.open(url, '_blank');
                             }}
                           />
                           
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               removeScreenshot(id);
                             }}
                             className="absolute top-1 right-1 p-1.5 bg-red-500 text-white rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 hover:scale-110"
                             title="Löschen"
                           >
                             <Trash2 size={14} />
                           </button>
                         </div>
                       ))}
                       {(!selectedEntry.screenshots || selectedEntry.screenshots.length === 0) && (
                         <div className="col-span-2 py-12 flex flex-col items-center justify-center bg-gray-50/30 rounded-2xl border border-gray-100 border-dashed">
                           <Paperclip size={24} className="text-gray-200" />
                           <p className="text-[10px] font-bold text-gray-300 uppercase mt-2">Keine Anhänge</p>
                         </div>
                       )}
                    </div>
                 </div>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Tagesnotizen</h5>
                <textarea 
                   value={selectedEntry.note} 
                   onChange={(e) => {
                     const newData = { ...data };
                     newData.trades[selectedDay!] = { ...selectedEntry!, note: e.target.value };
                     onUpdate(newData);
                   }}
                   rows={4}
                   className="w-full bg-transparent outline-none text-xs text-gray-600 leading-relaxed italic resize-none"
                   placeholder="Journaliere deine Trading-Psychologie..."
                />
              </div>
            </div>

            <div className="p-4 lg:p-6 border-t border-gray-100 bg-white flex justify-end gap-3 shrink-0">
              <button onClick={() => setSelectedDay(null)} className="px-6 py-3 text-xs font-black text-gray-500 hover:bg-gray-100 rounded-xl transition-colors uppercase tracking-widest">Schliessen</button>
              <button onClick={() => setSelectedDay(null)} className="px-8 py-3 bg-[#16325c] text-white text-xs font-black rounded-xl shadow-xl shadow-blue-900/10 hover:bg-blue-800 transition-all uppercase tracking-widest flex items-center gap-2"><Save size={16} /> Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
