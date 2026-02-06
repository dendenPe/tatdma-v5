
import React, { useState, useEffect, useRef } from 'react';
import { 
  Wallet, 
  Plus, 
  Trash2, 
  Search, 
  MapPin, 
  DollarSign, 
  PieChart as PieIcon,
  ShoppingBag,
  Coffee,
  Car,
  Home,
  HeartPulse,
  Globe,
  FileText,
  Eye,
  Sparkles,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  ShoppingBasket
} from 'lucide-react';
// @ts-ignore
import heic2any from 'heic2any';
import { AppData, ExpenseEntry, EXPENSE_CATEGORIES, ExpenseCategory } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, CartesianGrid } from 'recharts';
import { DBService } from '../services/dbService';
import { GeminiService } from '../services/geminiService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  globalYear: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#6366f1', '#14b8a6', '#9ca3af'];

const CategoryIcon = ({ cat, size=16 }: { cat: string, size?: number }) => {
    switch(cat) {
        case 'Verpflegung': return <Coffee size={size} />;
        case 'Mobilität': return <Car size={size} />;
        case 'Haushalt': return <Home size={size} />;
        case 'Freizeit': return <Globe size={size} />;
        case 'Shopping': return <ShoppingBag size={size} />;
        case 'Gesundheit': return <HeartPulse size={size} />;
        case 'Wohnen': return <Home size={size} />;
        case 'Reisen': return <Globe size={size} />;
        default: return <Wallet size={size} />;
    }
};

const ExpensesView: React.FC<Props> = ({ data, onUpdate, globalYear }) => {
  const [currentYear, setCurrentYear] = useState(globalYear);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1); // 1-12
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  
  // Expanded Rows State (for Items)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  
  // Modal for Viewing Receipt
  const [viewingReceiptBlob, setViewingReceiptBlob] = useState<Blob | null>(null);
  const [viewingReceiptSrc, setViewingReceiptSrc] = useState<string | null>(null);
  const [isConvertingReceipt, setIsConvertingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  
  const scanInputRef = useRef<HTMLInputElement>(null);
  
  // New Expense State
  const [newExpense, setNewExpense] = useState<Partial<ExpenseEntry>>({
      currency: 'CHF',
      category: 'Verpflegung',
      date: new Date().toISOString().split('T')[0]
  });

  // Sync Global Year
  useEffect(() => {
      setCurrentYear(globalYear);
  }, [globalYear]);

  // Derived Data
  const allExpenses = data.dailyExpenses?.[currentYear] || [];
  
  const filteredExpenses = allExpenses.filter(e => {
      const d = new Date(e.date);
      const matchesMonth = d.getMonth() + 1 === currentMonth;
      const matchesSearch = !searchTerm || 
          e.merchant.toLowerCase().includes(searchTerm.toLowerCase()) || 
          e.description?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesMonth && matchesSearch;
  }).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Statistics
  const totalSpend = filteredExpenses.reduce((sum, e) => sum + (e.amount * e.rate), 0);
  
  const catStats = EXPENSE_CATEGORIES.map(cat => {
      const sum = filteredExpenses.filter(e => e.category === cat).reduce((s, e) => s + (e.amount * e.rate), 0);
      return { name: cat, value: sum };
  }).filter(c => c.value > 0).sort((a,b) => b.value - a.value);

  // Daily Histogram Data
  const dailyData = Array.from({length: 31}, (_, i) => {
      const day = i + 1;
      const sum = filteredExpenses.filter(e => new Date(e.date).getDate() === day).reduce((s, e) => s + (e.amount * e.rate), 0);
      return { day: day.toString(), value: sum };
  });

  const addExpense = () => {
      if (!newExpense.amount || !newExpense.merchant) return;
      
      const entry: ExpenseEntry = {
          id: `exp_${Date.now()}`,
          date: newExpense.date || new Date().toISOString().split('T')[0],
          merchant: newExpense.merchant,
          description: newExpense.description || '',
          amount: parseFloat(newExpense.amount as any),
          currency: newExpense.currency || 'CHF',
          rate: newExpense.currency === 'USD' ? (data.tax.rateUSD || 0.85) : (newExpense.currency === 'EUR' ? (data.tax.rateEUR || 0.94) : 1),
          category: newExpense.category as ExpenseCategory,
          location: newExpense.location,
          isTaxRelevant: false
      };

      const newYear = entry.date.split('-')[0];
      const expensesForYear = data.dailyExpenses?.[newYear] || [];
      
      const newData = { ...data };
      if (!newData.dailyExpenses) newData.dailyExpenses = {};
      newData.dailyExpenses[newYear] = [...expensesForYear, entry];
      
      onUpdate(newData);
      setIsAdding(false);
      setNewExpense({ currency: 'CHF', category: 'Verpflegung', date: new Date().toISOString().split('T')[0] });
  };

  const handleSmartScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsScanning(true);
      try {
          const result = await GeminiService.analyzeDocument(file);
          if (result && result.dailyExpenseData && result.dailyExpenseData.isExpense) {
              const expData = result.dailyExpenseData;
              const date = result.date || new Date().toISOString().split('T')[0];
              const year = date.split('-')[0];
              
              // Save Receipt Image
              const receiptId = `receipt_scan_${Date.now()}`;
              await DBService.saveFile(receiptId, file);

              const entry: ExpenseEntry = {
                  id: `exp_${Date.now()}`,
                  date: date,
                  merchant: expData.merchant || 'Unbekannt',
                  description: result.title || '',
                  amount: expData.amount || 0,
                  currency: expData.currency || 'CHF',
                  rate: 1, // Logic needed for rates
                  category: (expData.expenseCategory as any) || 'Sonstiges',
                  location: expData.location,
                  isTaxRelevant: result.isTaxRelevant,
                  receiptId: receiptId,
                  items: expData.items // EXTRACTED ITEMS
              };

              const newData = { ...data };
              if (!newData.dailyExpenses) newData.dailyExpenses = {};
              if (!newData.dailyExpenses[year]) newData.dailyExpenses[year] = [];
              newData.dailyExpenses[year].push(entry);
              
              onUpdate(newData);
              alert(`Erfasst: ${entry.merchant} - ${entry.amount} ${entry.currency}`);
              
              // Ensure we are viewing the correct year/month
              setCurrentYear(year);
              const m = parseInt(date.split('-')[1]);
              if (!isNaN(m)) setCurrentMonth(m);

          } else {
              alert("Konnte keine Ausgabendaten erkennen. Versuche es manuell.");
          }
      } catch (err: any) {
          alert("Fehler beim Scan: " + err.message);
      } finally {
          setIsScanning(false);
          e.target.value = '';
      }
  };

  const deleteExpense = (id: string) => {
      if(confirm("Eintrag löschen?")) {
          const newData = { ...data };
          newData.dailyExpenses[currentYear] = allExpenses.filter(e => e.id !== id);
          onUpdate(newData);
      }
  };

  const toggleItems = (id: string) => {
      setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const viewReceipt = async (id?: string) => {
      if(!id) return;
      setViewingReceiptBlob(null);
      setViewingReceiptSrc(null);
      setReceiptError(null);
      setIsConvertingReceipt(true);

      const blob = await DBService.getFile(id);
      if(blob) {
          setViewingReceiptBlob(blob);
          
          try {
              // Check if HEIC
              const isHeic = blob.type === 'image/heic' || blob.type === 'image/heif' || (!blob.type && blob.size > 0);
              
              if (isHeic) {
                  try {
                      // Attempt conversion
                      const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
                      const jpgBlob = Array.isArray(result) ? result[0] : result;
                      setViewingReceiptSrc(URL.createObjectURL(jpgBlob));
                  } catch (convErr) {
                      console.error("HEIC Conversion Failed", convErr);
                      // Fallback: Try native
                      setViewingReceiptSrc(URL.createObjectURL(blob));
                      setReceiptError("Vorschau evtl. eingeschränkt (HEIC Format). Bitte 'Download' nutzen.");
                  }
              } else {
                  setViewingReceiptSrc(URL.createObjectURL(blob));
              }
          } catch (e) {
              console.error("Image loading failed", e);
              setReceiptError("Fehler beim Laden des Bildes.");
          } finally {
              setIsConvertingReceipt(false);
          }
      } else {
          alert("Beleg nicht gefunden.");
          setIsConvertingReceipt(false);
      }
  };

  const closeReceiptModal = () => {
      if (viewingReceiptSrc) URL.revokeObjectURL(viewingReceiptSrc);
      setViewingReceiptBlob(null);
      setViewingReceiptSrc(null);
      setReceiptError(null);
  };

  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24">
      {/* HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <Wallet size={24} />
              </div>
              <div>
                  <h2 className="text-xl font-black text-gray-800 tracking-tight">Ausgaben Journal</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{monthNames[currentMonth-1]} {currentYear}</p>
              </div>
          </div>
          
          <div className="flex items-center gap-2">
              <button onClick={() => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><span className="text-lg">←</span></button>
              <div className="bg-gray-50 px-4 py-2 rounded-xl font-black text-gray-700 w-32 text-center text-sm">
                  {monthNames[currentMonth-1]}
              </div>
              <button onClick={() => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><span className="text-lg">→</span></button>
              
              <div className="w-px h-8 bg-gray-100 mx-2"></div>
              
              {/* SMART SCAN BUTTON */}
              <button 
                  onClick={() => scanInputRef.current?.click()} 
                  disabled={isScanning}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-xs flex items-center gap-2 hover:shadow-lg transition-all"
              >
                  {isScanning ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16} />}
                  Smart Scan
              </button>
              <input type="file" ref={scanInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleSmartScan} />

              <button onClick={() => setIsAdding(true)} className="px-4 py-2 bg-[#16325c] text-white rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-blue-800 shadow-lg shadow-blue-900/10">
                  <Plus size={16} /> Manuell
              </button>
          </div>
      </div>

      {/* RECEIPT PREVIEW MODAL */}
      {viewingReceiptBlob && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-in fade-in" onClick={closeReceiptModal}>
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
                  <button onClick={closeReceiptModal} className="absolute top-2 right-2 p-2 bg-white/50 hover:bg-white rounded-full text-gray-800 shadow-sm z-10"><X size={20} /></button>
                  
                  <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-50 p-4 min-h-[300px]">
                      {isConvertingReceipt ? (
                          <div className="flex flex-col items-center gap-3 text-gray-400">
                              <Loader2 size={32} className="animate-spin text-blue-500" />
                              <span className="text-xs font-bold uppercase tracking-widest">Lade Bild...</span>
                          </div>
                      ) : viewingReceiptBlob.type === 'application/pdf' ? (
                          <iframe src={viewingReceiptSrc || ''} className="w-full h-[80vh]" title="PDF Preview"></iframe>
                      ) : (
                          <div className="relative">
                              <img src={viewingReceiptSrc || ''} alt="Receipt" className="max-w-full max-h-[80vh] object-contain shadow-lg rounded-lg" />
                              {receiptError && (
                                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-100 text-red-600 px-3 py-1 rounded-lg text-xs font-bold shadow-md">
                                      {receiptError}
                                  </div>
                              )}
                          </div>
                      )}
                  </div>
                  
                  <div className="p-4 bg-white border-t border-gray-100 flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-400 uppercase">{viewingReceiptBlob.type || 'Unbekanntes Format'} - {(viewingReceiptBlob.size / 1024).toFixed(0)} KB</span>
                      <a href={viewingReceiptSrc || '#'} download="receipt_download" className="text-blue-600 text-xs font-bold hover:underline flex items-center gap-1"><FileText size={14}/> Original Download</a>
                  </div>
              </div>
          </div>
      )}

      {/* Adding Modal */}
      {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-lg space-y-4 animate-in zoom-in-95">
                  <h3 className="font-black text-lg text-gray-800">Neue Ausgabe erfassen</h3>
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Händler / Empfänger</label>
                          <input type="text" value={newExpense.merchant} onChange={(e) => setNewExpense({...newExpense, merchant: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100" placeholder="z.B. Coop" autoFocus />
                      </div>
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Betrag</label>
                          <div className="flex gap-2">
                              <input type="number" value={newExpense.amount} onChange={(e) => setNewExpense({...newExpense, amount: e.target.value as any})} className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100" placeholder="0.00" />
                              <select value={newExpense.currency} onChange={(e) => setNewExpense({...newExpense, currency: e.target.value})} className="bg-gray-100 rounded-xl px-2 text-xs font-bold outline-none">
                                  <option value="CHF">CHF</option>
                                  <option value="EUR">EUR</option>
                                  <option value="USD">USD</option>
                              </select>
                          </div>
                      </div>
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Kategorie</label>
                          <select value={newExpense.category} onChange={(e) => setNewExpense({...newExpense, category: e.target.value as any})} className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none">
                              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                      </div>
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Datum</label>
                          <input type="date" value={newExpense.date} onChange={(e) => setNewExpense({...newExpense, date: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium outline-none" />
                      </div>
                      <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Ort (Optional)</label>
                          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                              <MapPin size={14} className="text-gray-400"/>
                              <input type="text" value={newExpense.location || ''} onChange={(e) => setNewExpense({...newExpense, location: e.target.value})} className="bg-transparent w-full text-sm font-medium outline-none" placeholder="z.B. Zürich" />
                          </div>
                      </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setIsAdding(false)} className="flex-1 py-3 text-gray-500 font-bold text-sm hover:bg-gray-100 rounded-xl transition-colors">Abbrechen</button>
                      <button onClick={addExpense} className="flex-1 py-3 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition-colors shadow-lg">Speichern</button>
                  </div>
              </div>
          </div>
      )}

      {/* Dashboard Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Stat */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between">
              <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-1">Ausgaben Total</p>
                  <h3 className="text-3xl font-black text-gray-800">{totalSpend.toLocaleString('de-CH', {minimumFractionDigits: 2})} <span className="text-sm text-gray-400">CHF</span></h3>
              </div>
              <div className="mt-6">
                  {catStats.length > 0 && (
                      <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                          <div className="p-2 bg-white rounded-lg text-orange-500 shadow-sm"><ShoppingBag size={16}/></div>
                          <div>
                              <p className="text-[10px] font-bold text-orange-400 uppercase">Top Kategorie</p>
                              <p className="text-sm font-black text-orange-700">{catStats[0].name} ({Math.round(catStats[0].value/totalSpend*100)}%)</p>
                          </div>
                      </div>
                  )}
              </div>
          </div>

          {/* Charts */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest w-full text-left mb-2">Verteilung</h4>
              <div className="w-full h-32">
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie data={catStats} innerRadius={35} outerRadius={50} paddingAngle={2} dataKey="value">
                              {catStats.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(val: number) => val.toFixed(2) + ' CHF'} />
                      </PieChart>
                  </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {catStats.slice(0,3).map((c, i) => (
                      <div key={c.name} className="flex items-center gap-1 text-[10px] font-bold text-gray-500">
                          <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[i]}}></div> {c.name}
                      </div>
                  ))}
              </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest w-full text-left mb-2">Tagesverlauf</h4>
              <div className="w-full h-32">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis dataKey="day" hide />
                          <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '8px', border: 'none', fontSize: '10px'}} />
                          <Bar dataKey="value" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>
      </div>

      {/* Transaction List */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-sm pl-2">Transaktionen</h3>
              <div className="relative w-48">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" placeholder="Suche..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-1 focus:ring-blue-100" />
              </div>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                      <tr>
                          <th className="px-6 py-4">Datum</th>
                          <th className="px-6 py-4">Händler / Kontext</th>
                          <th className="px-6 py-4">Kategorie</th>
                          <th className="px-6 py-4">Ort</th>
                          <th className="px-6 py-4 text-right">Betrag</th>
                          <th className="px-4 py-4 text-center">Beleg</th>
                          <th className="px-4 py-4"></th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                      {filteredExpenses.map(e => (
                          <React.Fragment key={e.id}>
                              <tr className="hover:bg-gray-50/50 transition-colors group">
                                  <td className="px-6 py-4 text-xs font-bold text-gray-500 whitespace-nowrap align-top">
                                      {new Date(e.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                                  </td>
                                  <td className="px-6 py-4 align-top">
                                      <div className="flex items-start justify-between">
                                          <div>
                                              <div className="font-bold text-gray-800 text-sm">{e.merchant}</div>
                                              {e.description && e.description !== e.merchant && <div className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[200px]">{e.description}</div>}
                                          </div>
                                          {/* ITEMS TOGGLE BUTTON */}
                                          {e.items && e.items.length > 0 && (
                                              <button 
                                                  onClick={() => toggleItems(e.id)} 
                                                  className={`ml-2 p-1 rounded-full hover:bg-gray-200 transition-colors ${expandedRows[e.id] ? 'bg-blue-50 text-blue-600' : 'text-gray-400'}`}
                                                  title={`${e.items.length} Artikel anzeigen`}
                                              >
                                                  {expandedRows[e.id] ? <ChevronDown size={14} /> : <ShoppingBasket size={14} />}
                                              </button>
                                          )}
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 align-top">
                                      <div className="flex items-center gap-2">
                                          <div className={`p-1.5 rounded-lg bg-gray-100 text-gray-500`}><CategoryIcon cat={e.category} size={14} /></div>
                                          <span className="text-xs font-medium text-gray-600">{e.category}</span>
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-gray-500 font-medium align-top">
                                      {e.location || '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right align-top">
                                      <div className="font-black text-gray-800 text-sm">{e.amount.toFixed(2)} <span className="text-[10px] text-gray-400">{e.currency}</span></div>
                                      {e.currency !== 'CHF' && <div className="text-[9px] text-gray-400">~ {(e.amount * e.rate).toFixed(2)} CHF</div>}
                                  </td>
                                  <td className="px-4 py-4 text-center align-top">
                                      {e.receiptId && (
                                          <button onClick={() => viewReceipt(e.receiptId)} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                                              <FileText size={14} />
                                          </button>
                                      )}
                                  </td>
                                  <td className="px-4 py-4 text-right align-top">
                                      <button onClick={() => deleteExpense(e.id)} className="p-1.5 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                          <Trash2 size={14} />
                                      </button>
                                  </td>
                              </tr>
                              
                              {/* EXPANDED ITEMS LIST ROW */}
                              {expandedRows[e.id] && e.items && (
                                  <tr className="bg-gray-50/50 animate-in slide-in-from-top-1 fade-in duration-200">
                                      <td colSpan={2}></td>
                                      <td colSpan={5} className="px-6 py-2 pb-4">
                                          <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm max-w-md">
                                              <div className="flex items-center gap-2 mb-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1">
                                                  <ShoppingBasket size={12}/> Einkaufskorb ({e.items.length})
                                              </div>
                                              <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4 marker:text-blue-300">
                                                  {e.items.map((item, idx) => (
                                                      <li key={idx}>{item}</li>
                                                  ))}
                                              </ul>
                                          </div>
                                      </td>
                                  </tr>
                              )}
                          </React.Fragment>
                      ))}
                      {filteredExpenses.length === 0 && (
                          <tr>
                              <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-xs italic">Keine Ausgaben in diesem Monat gefunden.</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};

export default ExpensesView;
