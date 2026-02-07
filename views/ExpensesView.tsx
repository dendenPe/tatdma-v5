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
  ChevronLeft,
  ShoppingBasket,
  Pencil,
  Save,
  Filter
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
  
  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ExpenseEntry>>({});
  const [editItemsText, setEditItemsText] = useState(''); // Textarea for items editing

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

  // --- HELPER: GET MATCH DATA ---
  // Returns the total value of items matching the search term within a single receipt
  const getMatchData = (e: ExpenseEntry) => {
      if (!searchTerm) return { matchTotal: 0, matchedItems: [] };
      
      const term = searchTerm.toLowerCase();
      let matchTotal = 0;
      const matchedItems: {name: string, price: number}[] = [];

      // Check merchant/description matches (Full Receipt Match)
      const isHeaderMatch = e.merchant.toLowerCase().includes(term) || (e.description && e.description.toLowerCase().includes(term));
      
      if (e.items && e.items.length > 0) {
          e.items.forEach(item => {
              const name = typeof item === 'string' ? item : item.name;
              const price = typeof item === 'string' ? 0 : item.price; // Legacy strings have 0 price effectively for this calc
              
              if (name.toLowerCase().includes(term)) {
                  matchTotal += price;
                  matchedItems.push({ name, price });
              }
          });
      }

      // If header matches but NO specific items matched (or no items exist), 
      // treat the WHOLE receipt as the match value
      if (isHeaderMatch && matchedItems.length === 0) {
          matchTotal = e.amount;
      }

      return { matchTotal, matchedItems, isHeaderMatch };
  };

  // Derived Data
  const allExpenses = data.dailyExpenses?.[currentYear] || [];
  
  const filteredExpenses = allExpenses.filter(e => {
      const d = new Date(e.date);
      const matchesMonth = d.getMonth() + 1 === currentMonth;
      
      if (!searchTerm) return matchesMonth;

      const term = searchTerm.toLowerCase();
      const matchesSearch = 
          e.merchant.toLowerCase().includes(term) || 
          e.description?.toLowerCase().includes(term) ||
          e.items?.some(item => {
              const name = typeof item === 'string' ? item : item.name;
              return name.toLowerCase().includes(term);
          });
          
      return matchesMonth && matchesSearch;
  }).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Statistics
  const totalSpend = filteredExpenses.reduce((sum, e) => sum + (e.amount * e.rate), 0);
  
  // Specific Search Stats
  const searchTotalSpend = searchTerm ? filteredExpenses.reduce((sum, e) => {
      const { matchTotal } = getMatchData(e);
      // Convert matchTotal (which is in original currency) to CHF
      return sum + (matchTotal * e.rate);
  }, 0) : 0;
  
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
                  items: expData.items // EXTRACTED ITEMS (Supports Objects)
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

  // --- EDIT FUNCTIONS ---
  const startEditing = (entry: ExpenseEntry) => {
      setEditingId(entry.id);
      setEditForm({ ...entry });
      // Convert items array to string for textarea
      const text = entry.items ? entry.items.map(item => {
          if (typeof item === 'string') return item;
          return `${item.name}: ${item.price.toFixed(2)}`;
      }).join('\n') : '';
      
      setEditItemsText(text);
  };

  const saveEdit = () => {
      if (!editForm.id || !editingId) return;

      const newData = { ...data };
      
      let originalYear = currentYear;
      
      const newDateStr = editForm.date || new Date().toISOString().split('T')[0];
      const newYear = newDateStr.split('-')[0];

      // Parse items from textarea (Supports "Name: Price")
      const updatedItems = editItemsText.split('\n').map(s => {
          const trimS = s.trim();
          if (!trimS) return null;
          
          if (trimS.includes(':')) {
              const parts = trimS.split(':');
              const price = parseFloat(parts.pop() || '0');
              const name = parts.join(':').trim();
              if (name && !isNaN(price)) {
                  return { name, price };
              }
          }
          return trimS;
      }).filter(s => s !== null) as any[];

      const updatedEntry: ExpenseEntry = {
          ...editForm as ExpenseEntry,
          date: newDateStr,
          items: updatedItems,
          rate: editForm.currency === 'USD' ? (data.tax.rateUSD || 0.85) : 
                (editForm.currency === 'EUR' ? (data.tax.rateEUR || 0.94) : 1)
      };

      const oldYearExpenses = newData.dailyExpenses[originalYear] || [];
      const filteredOld = oldYearExpenses.filter(e => e.id !== editingId);
      
      if (originalYear === newYear) {
          const updatedList = oldYearExpenses.map(e => e.id === editingId ? updatedEntry : e);
          newData.dailyExpenses[originalYear] = updatedList;
      } else {
          newData.dailyExpenses[originalYear] = filteredOld;
          if (!newData.dailyExpenses[newYear]) newData.dailyExpenses[newYear] = [];
          newData.dailyExpenses[newYear].push(updatedEntry);
          alert(`Eintrag wurde in das Jahr ${newYear} verschoben.`);
      }

      onUpdate(newData);
      setEditingId(null);
      setEditForm({});
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
              const isHeic = blob.type === 'image/heic' || blob.type === 'image/heif' || (!blob.type && blob.size > 0);
              if (isHeic) {
                  try {
                      const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
                      const jpgBlob = Array.isArray(result) ? result[0] : result;
                      setViewingReceiptSrc(URL.createObjectURL(jpgBlob));
                  } catch (convErr) {
                      setViewingReceiptSrc(URL.createObjectURL(blob));
                      setReceiptError("Vorschau evtl. eingeschränkt (HEIC Format). Bitte 'Download' nutzen.");
                  }
              } else {
                  setViewingReceiptSrc(URL.createObjectURL(blob));
              }
          } catch (e) {
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
    <div className="max-w-7xl mx-auto space-y-6 pb-24 overflow-x-hidden">
      {/* HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shrink-0">
                  <Wallet size={24} />
              </div>
              <div className="min-w-0">
                  <h2 className="text-xl font-black text-gray-800 tracking-tight truncate">Ausgaben Journal</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{monthNames[currentMonth-1]} {currentYear}</p>
              </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center bg-gray-50 rounded-xl p-1 shrink-0">
                  <button onClick={() => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1)} className="p-2 hover:bg-white rounded-lg text-gray-400 transition-colors"><ChevronLeft size={16}/></button>
                  <div className="px-2 w-24 text-center font-black text-gray-700 text-sm">
                      {monthNames[currentMonth-1]}
                  </div>
                  <button onClick={() => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1)} className="p-2 hover:bg-white rounded-lg text-gray-400 transition-colors"><ChevronRight size={16}/></button>
              </div>
              <div className="hidden md:block w-px h-8 bg-gray-100 mx-1 shrink-0"></div>
              <div className="flex gap-2 flex-1 md:flex-none min-w-[200px]">
                  <button 
                      onClick={() => scanInputRef.current?.click()} 
                      disabled={isScanning}
                      className="flex-1 md:flex-none px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:shadow-lg transition-all whitespace-nowrap"
                  >
                      {isScanning ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14} />}
                      Scan
                  </button>
                  <input type="file" ref={scanInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleSmartScan} />
                  <button onClick={() => setIsAdding(true)} className="flex-1 md:flex-none px-3 py-2 bg-[#16325c] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-800 shadow-lg shadow-blue-900/10 whitespace-nowrap">
                      <Plus size={14} /> Neu
                  </button>
              </div>
          </div>
      </div>

      {/* DASHBOARD STATS (ADAPTIVE SEARCH SUMMARY) */}
      {searchTerm ? (
          <div className="bg-white p-6 rounded-3xl border border-blue-100 shadow-lg shadow-blue-900/5 animate-in slide-in-from-top-2">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                      <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                          <Search size={24} />
                      </div>
                      <div>
                          <p className="text-[10px] uppercase font-bold text-purple-400 tracking-widest">Gefilterte Ausgaben für</p>
                          <h3 className="text-2xl font-black text-gray-800">"{searchTerm}"</h3>
                      </div>
                  </div>
                  <div className="text-right">
                      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Total {monthNames[currentMonth-1]}</p>
                      <h3 className="text-3xl font-black text-purple-600">
                          {searchTotalSpend.toLocaleString('de-CH', {minimumFractionDigits: 2})} <span className="text-sm text-purple-300">CHF</span>
                      </h3>
                      <p className="text-xs font-bold text-gray-400 mt-1">{filteredExpenses.length} Einkäufe gefunden</p>
                  </div>
              </div>
          </div>
      ) : (
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
      )}

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
                          <th className="px-6 py-4">Händler / {searchTerm ? 'Treffer' : 'Kontext'}</th>
                          <th className="px-6 py-4">Kategorie</th>
                          <th className="px-6 py-4">Ort</th>
                          <th className="px-6 py-4 text-right">
                              {searchTerm ? 'Item-Preis' : 'Betrag'}
                          </th>
                          <th className="px-4 py-4 text-center">Beleg</th>
                          <th className="px-4 py-4 text-right">Aktionen</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                      {filteredExpenses.map(e => {
                          const { matchTotal, matchedItems, isHeaderMatch } = getMatchData(e);
                          
                          // Display Logic: Show item price if searching, else show full receipt
                          const displayAmount = searchTerm ? matchTotal : e.amount;
                          const displayLabel = searchTerm && matchTotal > 0 ? 'Item' : 'Total';
                          const highlightClass = searchTerm ? 'text-purple-600' : 'text-gray-800';

                          return (
                          <React.Fragment key={e.id}>
                              <tr className="hover:bg-gray-50/50 transition-colors group">
                                  <td className="px-6 py-4 text-xs font-bold text-gray-500 whitespace-nowrap align-top">
                                      {new Date(e.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                                  </td>
                                  <td className="px-6 py-4 align-top">
                                      <div className="flex items-start justify-between">
                                          <div>
                                              <div className="font-bold text-gray-800 text-sm">{e.merchant}</div>
                                              {/* Show Matches directly here if searching */}
                                              {searchTerm && matchedItems.length > 0 ? (
                                                  <div className="mt-1 space-y-0.5">
                                                      {matchedItems.map((item, i) => (
                                                          <div key={i} className="flex items-center gap-1 text-[10px]">
                                                              <span className="bg-purple-100 text-purple-700 px-1.5 rounded font-bold">{item.name}</span>
                                                              <span className="text-gray-400">{item.price.toFixed(2)}</span>
                                                          </div>
                                                      ))}
                                                  </div>
                                              ) : (
                                                  e.description && e.description !== e.merchant && <div className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[200px]">{e.description}</div>
                                              )}
                                          </div>
                                          {e.items && e.items.length > 0 && !searchTerm && (
                                              <button onClick={() => toggleItems(e.id)} className={`ml-2 p-1 rounded-full hover:bg-gray-200 transition-colors ${expandedRows[e.id] ? 'bg-blue-50 text-blue-600' : 'text-gray-400'}`}>
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
                                      <div className={`font-black text-sm ${highlightClass}`}>
                                          {displayAmount.toFixed(2)} <span className="text-[10px] text-gray-400">{e.currency}</span>
                                      </div>
                                      
                                      {/* Context: Show Full Receipt Total if searching specific items */}
                                      {searchTerm && matchTotal > 0 && Math.abs(matchTotal - e.amount) > 0.01 && (
                                          <div className="text-[9px] text-gray-300 mt-0.5">
                                              von {e.amount.toFixed(2)} Total
                                          </div>
                                      )}
                                      
                                      {e.currency !== 'CHF' && <div className="text-[9px] text-gray-400">~ {(displayAmount * e.rate).toFixed(2)} CHF</div>}
                                  </td>
                                  <td className="px-4 py-4 text-center align-top">
                                      {e.receiptId && (
                                          <button onClick={() => viewReceipt(e.receiptId)} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                                              <FileText size={14} />
                                          </button>
                                      )}
                                  </td>
                                  <td className="px-4 py-4 text-right align-top">
                                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => startEditing(e)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Bearbeiten">
                                              <Pencil size={14} />
                                          </button>
                                          <button onClick={() => deleteExpense(e.id)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Löschen">
                                              <Trash2 size={14} />
                                          </button>
                                      </div>
                                  </td>
                              </tr>
                              
                              {expandedRows[e.id] && e.items && !searchTerm && (
                                  <tr className="bg-gray-50/50 animate-in slide-in-from-top-1 fade-in duration-200">
                                      <td colSpan={2}></td>
                                      <td colSpan={5} className="px-6 py-2 pb-4">
                                          <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm max-w-md">
                                              <div className="flex items-center gap-2 mb-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1">
                                                  <ShoppingBasket size={12}/> Einkaufskorb ({e.items.length})
                                              </div>
                                              <ul className="text-xs text-gray-600 space-y-1">
                                                  {e.items.map((item, idx) => {
                                                      const isObj = typeof item !== 'string';
                                                      const name = isObj ? item.name : item;
                                                      const price = isObj ? item.price : null;
                                                      return (
                                                          <li key={idx} className="flex justify-between items-center py-0.5 border-b border-gray-50 last:border-none">
                                                              <div className="flex items-center gap-2">
                                                                  <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                                                                  <span>{name}</span>
                                                              </div>
                                                              {price !== null && (
                                                                  <span className="font-mono font-bold text-gray-400">{price.toFixed(2)}</span>
                                                              )}
                                                          </li>
                                                      );
                                                  })}
                                              </ul>
                                          </div>
                                      </td>
                                  </tr>
                              )}
                          </React.Fragment>
                      )})}
                      {filteredExpenses.length === 0 && (
                          <tr>
                              <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-xs italic">Keine Ausgaben in diesem Monat gefunden.</td>
                          </tr>
                      )}
                  </tbody>
                  {/* SUMMARY FOOTER FOR SEARCH */}
                  {searchTerm && filteredExpenses.length > 0 && (
                      <tfoot className="bg-purple-50 border-t-2 border-purple-100">
                          <tr>
                              <td colSpan={4} className="px-6 py-4 text-right font-black text-purple-800 text-xs uppercase tracking-widest">
                                  Total "{searchTerm}" ({monthNames[currentMonth-1]})
                              </td>
                              <td className="px-6 py-4 text-right font-black text-purple-700 text-sm">
                                  {searchTotalSpend.toLocaleString('de-CH', {minimumFractionDigits: 2})} CHF
                              </td>
                              <td colSpan={2}></td>
                          </tr>
                      </tfoot>
                  )}
              </table>
          </div>
      </div>
    </div>
  );
};

export default ExpensesView;