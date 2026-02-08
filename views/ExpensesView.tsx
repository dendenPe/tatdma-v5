
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
  Filter,
  Calendar,
  Receipt,
  Check
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

  // --- CRITICAL FIX: Data Ref to prevent stale closures in Async operations ---
  const latestDataRef = useRef(data);
  useEffect(() => {
      latestDataRef.current = data;
  }, [data]);

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

  // --- HELPER: Parse Items ---
  const parseItems = (text: string) => {
      return text.split('\n').map(s => {
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
  };

  const addExpense = () => {
      if (!newExpense.amount || !newExpense.merchant) return;
      
      const items = parseItems(editItemsText);

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
          isTaxRelevant: false,
          items: items // Add parsed items
      };

      const newYear = entry.date.split('-')[0];
      
      // Use Ref for safety
      const currentData = latestDataRef.current;
      const expensesForYear = currentData.dailyExpenses?.[newYear] || [];
      
      const newData = { ...currentData };
      if (!newData.dailyExpenses) newData.dailyExpenses = {};
      newData.dailyExpenses[newYear] = [...expensesForYear, entry];
      
      onUpdate(newData);
      setIsAdding(false);
      setNewExpense({ currency: 'CHF', category: 'Verpflegung', date: new Date().toISOString().split('T')[0] });
      setEditItemsText('');
  };

  const handleSmartScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsScanning(true);
      try {
          // 1. Analyze File
          const result = await GeminiService.analyzeDocument(file);
          
          if (result && result.dailyExpenseData && result.dailyExpenseData.isExpense) {
              const expData = result.dailyExpenseData;
              const date = result.date || new Date().toISOString().split('T')[0];
              const year = date.split('-')[0];
              
              // 2. Save Receipt Image
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

              // 3. CRITICAL UPDATE: Use latestDataRef to avoid stale closures
              const currentData = latestDataRef.current;
              const newData = { ...currentData };
              
              if (!newData.dailyExpenses) newData.dailyExpenses = {};
              // Create new array reference
              const currentYearList = newData.dailyExpenses[year] ? [...newData.dailyExpenses[year]] : [];
              currentYearList.push(entry);
              newData.dailyExpenses[year] = currentYearList;
              
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

      const currentData = latestDataRef.current;
      const newData = { ...currentData };
      
      let originalYear = currentYear;
      
      const newDateStr = editForm.date || new Date().toISOString().split('T')[0];
      const newYear = newDateStr.split('-')[0];

      // Parse items from textarea
      const updatedItems = parseItems(editItemsText);

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
      setEditItemsText('');
  };

  const deleteExpense = (id: string) => {
      if(confirm("Eintrag löschen?")) {
          const currentData = latestDataRef.current;
          const newData = { ...currentData };
          // Ensure we filter the array for the CURRENT YEAR view
          newData.dailyExpenses[currentYear] = (newData.dailyExpenses[currentYear] || []).filter(e => e.id !== id);
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
    <div 
        className="max-w-7xl mx-auto space-y-6 pb-24 overflow-x-hidden"
        style={{
            touchAction: 'pan-y', 
            overscrollBehaviorX: 'none'
        }}
    >
      {/* IOS SCROLL FIX INJECTION - STRICT MOBILE MODAL STYLING */}
      <style>{`
        /* Mobile Only Modal Fixes - Forces the modal to be rigidly fixed to bottom without wobble */
        @media (max-width: 640px) {
            .mobile-modal-fix {
                position: fixed !important;
                bottom: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 85vh !important;
                border-top-left-radius: 1.5rem !important;
                border-top-right-radius: 1.5rem !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important; /* Prevents container from scrolling */
                touch-action: none !important; /* Blocks all touch on container background */
                transform: translate3d(0,0,0);
                z-index: 50 !important;
            }
            
            .mobile-modal-scroll {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
                overscroll-behavior-y: contain; /* Traps scroll inside */
                overscroll-behavior-x: none;    /* Kills horizontal bounce */
                touch-action: pan-y;            /* Only allows vertical pan */
                width: 100%;
            }
        }

        /* Desktop Reset */
        @media (min-width: 640px) {
            .mobile-modal-fix {
                position: relative;
                width: auto;
                max-width: 28rem; /* sm:max-w-md */
                touch-action: auto;
            }
            .mobile-modal-scroll {
                overscroll-behavior: auto;
            }
        }
      `}</style>

      {/* HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 md:p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shrink-0">
                  <Wallet size={24} />
              </div>
              <div className="min-w-0">
                  <h2 className="text-xl font-black text-gray-800 tracking-tight truncate">Ausgaben</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{monthNames[currentMonth-1]} {currentYear}</p>
              </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <div className="flex items-center justify-between bg-gray-50 rounded-xl p-1 shrink-0 w-full md:w-auto">
                  <button onClick={() => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1)} className="p-2 hover:bg-white rounded-lg text-gray-400 transition-colors"><ChevronLeft size={16}/></button>
                  <div className="px-2 w-24 text-center font-black text-gray-700 text-sm">
                      {monthNames[currentMonth-1]}
                  </div>
                  <button onClick={() => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1)} className="p-2 hover:bg-white rounded-lg text-gray-400 transition-colors"><ChevronRight size={16}/></button>
              </div>
              
              <div className="grid grid-cols-2 gap-2 w-full md:w-auto md:flex">
                  <button 
                      onClick={() => scanInputRef.current?.click()} 
                      disabled={isScanning}
                      className="px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:shadow-lg transition-all"
                  >
                      {isScanning ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14} />}
                      AI Scan
                  </button>
                  <input type="file" ref={scanInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleSmartScan} />
                  <button onClick={() => { setIsAdding(true); setEditItemsText(''); }} className="px-3 py-2 bg-[#16325c] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-800 shadow-lg shadow-blue-900/10">
                      <Plus size={14} /> Neu
                  </button>
              </div>
          </div>
      </div>

      {/* MOBILE STATS COMPACT */}
      <div className="md:hidden bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between animate-in fade-in duration-300">
          <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                  {searchTerm ? `Summe "${searchTerm}"` : `Total ${monthNames[currentMonth-1]}`}
              </p>
              <h3 className={`text-2xl font-black ${searchTerm ? 'text-purple-600' : 'text-gray-800'}`}>
                  {(searchTerm ? searchTotalSpend : totalSpend).toLocaleString('de-CH', {minimumFractionDigits: 0})} 
                  <span className={`text-sm ${searchTerm ? 'text-purple-300' : 'text-gray-400'}`}> CHF</span>
              </h3>
          </div>
          {/* Show top category only if NOT searching */}
          {!searchTerm && catStats.length > 0 && (
              <div className="text-right">
                  <div className="inline-flex items-center gap-1 p-1.5 bg-orange-50 rounded-lg">
                      <ShoppingBag size={12} className="text-orange-500"/>
                      <span className="text-[10px] font-bold text-orange-600">{catStats[0].name}</span>
                  </div>
              </div>
          )}
          {searchTerm && (
              <div className="text-right">
                  <div className="inline-flex items-center gap-1 p-1.5 bg-purple-50 rounded-lg">
                      <Search size={12} className="text-purple-500"/>
                      <span className="text-[10px] font-bold text-purple-600">Treffer</span>
                  </div>
              </div>
          )}
      </div>

      {/* DASHBOARD STATS (DESKTOP) */}
      <div className="hidden md:block">
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
      </div>

      {/* TRANSACTION LIST CONTAINER */}
      <div className="space-y-4">
          {/* SEARCH BAR - MOBILE OPTIMIZED (FIXED FONT SIZE & WOBBLE) */}
          <div className="md:hidden">
              <div className="relative">
                  <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                  <input 
                      type="text" 
                      placeholder="Händler oder Produkt suchen..." 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                      // FIX: text-base prevents iOS Zoom. outline-none & transparent ring prevents layout shift
                      className="w-full pl-10 pr-4 py-3 bg-white border border-gray-100 rounded-2xl text-base font-medium shadow-sm outline-none focus:ring-0 focus:border-blue-300 transition-colors" 
                  />
              </div>
          </div>

          {/* DESKTOP TABLE (HIDDEN ON MOBILE) */}
          <div className="hidden md:block bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
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
                              const displayAmount = searchTerm ? matchTotal : e.amount;
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

          {/* MOBILE LIST (VISIBLE ONLY ON MOBILE) - Compact Cards */}
          <div className="md:hidden space-y-3">
              {filteredExpenses.map(e => {
                  const { matchTotal, matchedItems, isHeaderMatch } = getMatchData(e);
                  const displayAmount = searchTerm ? matchTotal : e.amount;
                  const highlightClass = searchTerm ? 'text-purple-600' : 'text-gray-800';
                  
                  return (
                      <div key={e.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-3">
                          <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                  <div className="flex flex-col items-center bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                                      <span className="text-[9px] font-bold text-gray-400 uppercase">{new Date(e.date).toLocaleDateString('de-DE', {month:'short'}).replace('.','')}</span>
                                      <span className="text-sm font-black text-gray-700">{new Date(e.date).getDate()}</span>
                                  </div>
                                  <div>
                                      <h4 className="font-bold text-gray-900 leading-tight">{e.merchant}</h4>
                                      <p className="text-[10px] text-gray-400">{e.category}</p>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <span className={`block font-black text-lg ${highlightClass}`}>
                                      {displayAmount.toFixed(2)} <span className="text-xs text-gray-400 font-bold">{e.currency}</span>
                                  </span>
                                  {e.items && e.items.length > 0 && !searchTerm && (
                                      <button onClick={() => toggleItems(e.id)} className="text-[10px] text-blue-500 font-bold flex items-center justify-end gap-1 mt-1">
                                          {expandedRows[e.id] ? 'Verbergen' : `${e.items.length} Artikel`} <ChevronDown size={10} className={`transform transition-transform ${expandedRows[e.id] ? 'rotate-180' : ''}`} />
                                      </button>
                                  )}
                                  {searchTerm && matchTotal > 0 && Math.abs(matchTotal - e.amount) > 0.01 && (
                                      <div className="text-[9px] text-gray-300 mt-0.5">
                                          von {e.amount.toFixed(2)} Total
                                      </div>
                                  )}
                              </div>
                          </div>

                          {(expandedRows[e.id] || searchTerm) && e.items && (
                              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1 border border-gray-100">
                                  {e.items.map((item, idx) => {
                                      const isObj = typeof item !== 'string';
                                      const name = isObj ? item.name : item;
                                      const price = isObj ? item.price : null;
                                      const isMatch = searchTerm && name.toLowerCase().includes(searchTerm.toLowerCase());
                                      if(searchTerm && !isMatch) return null;

                                      return (
                                          <div key={idx} className={`flex justify-between items-center border-b border-gray-200/50 pb-1 last:border-0 last:pb-0 ${isMatch ? 'text-purple-700 font-bold' : 'text-gray-600'}`}>
                                              <span>{name}</span>
                                              {price !== null && <span className="font-mono">{price.toFixed(2)}</span>}
                                          </div>
                                      );
                                  })}
                              </div>
                          )}

                          <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                              <div className="flex gap-2">
                                  {e.location && (
                                      <div className="flex items-center gap-1 text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
                                          <MapPin size={10} /> {e.location}
                                      </div>
                                  )}
                              </div>
                              <div className="flex items-center gap-3">
                                  {e.receiptId && (
                                      <button onClick={() => viewReceipt(e.receiptId)} className="text-blue-500 bg-blue-50 p-1.5 rounded-lg">
                                          <FileText size={16} />
                                      </button>
                                  )}
                                  <button onClick={() => startEditing(e)} className="text-gray-400 hover:text-blue-500 p-1.5">
                                      <Pencil size={16} />
                                  </button>
                                  <button onClick={() => deleteExpense(e.id)} className="text-gray-400 hover:text-red-500 p-1.5">
                                      <Trash2 size={16} />
                                  </button>
                              </div>
                          </div>
                      </div>
                  );
              })}
              {filteredExpenses.length === 0 && (
                  <div className="text-center py-10 text-gray-400 text-xs italic">Keine Ausgaben gefunden.</div>
              )}
          </div>
      </div>

      {/* ADD / EDIT MODAL - MOBILE OPTIMIZED (BOTTOM SHEET STABILITY) */}
      {(isAdding || editingId) && (
        <div 
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            style={{
              zIndex: 9999,
              /* Allow touch on backdrop but prevent body scroll bleed through */
              touchAction: 'none'
            }}
        >
            <div 
                className="absolute inset-0 bg-transparent"
                onClick={() => { setIsAdding(false); setEditingId(null); }}
            />

            <div 
                className="bg-white mobile-modal-fix sm:w-auto sm:max-w-md sm:h-auto sm:max-h-[90vh] shadow-2xl relative z-10 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
                    <h3 className="font-black text-gray-800">{editingId ? 'Eintrag Bearbeiten' : 'Neue Ausgabe'}</h3>
                    <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="p-2 hover:bg-gray-200 rounded-full text-gray-400">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-4 space-y-4 mobile-modal-scroll">
                    {/* Date */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Datum</label>
                        <input 
                            type="date" 
                            value={editingId ? (editForm.date || '') : (newExpense.date || '')}
                            onChange={(e) => editingId ? setEditForm({...editForm, date: e.target.value}) : setNewExpense({...newExpense, date: e.target.value})}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base font-bold outline-none focus:ring-2 focus:ring-blue-100 max-w-full"
                        />
                    </div>

                    {/* Merchant */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Händler / Empfänger</label>
                        <input 
                            type="text" 
                            placeholder="z.B. Coop, SBB..."
                            value={editingId ? (editForm.merchant || '') : (newExpense.merchant || '')}
                            onChange={(e) => editingId ? setEditForm({...editForm, merchant: e.target.value}) : setNewExpense({...newExpense, merchant: e.target.value})}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base font-bold outline-none focus:ring-2 focus:ring-blue-100 max-w-full"
                        />
                    </div>

                    {/* Amount & Currency */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Betrag</label>
                            <input 
                                type="number" 
                                placeholder="0.00"
                                value={editingId ? (editForm.amount || '') : (newExpense.amount || '')}
                                onChange={(e) => editingId ? setEditForm({...editForm, amount: parseFloat(e.target.value)}) : setNewExpense({...newExpense, amount: parseFloat(e.target.value)})}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base font-black outline-none focus:ring-2 focus:ring-blue-100 max-w-full"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Währung</label>
                            <select 
                                value={editingId ? (editForm.currency || 'CHF') : (newExpense.currency || 'CHF')}
                                onChange={(e) => editingId ? setEditForm({...editForm, currency: e.target.value}) : setNewExpense({...newExpense, currency: e.target.value})}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base font-bold outline-none focus:ring-2 focus:ring-blue-100 max-w-full"
                            >
                                <option value="CHF">CHF</option>
                                <option value="EUR">EUR</option>
                                <option value="USD">USD</option>
                            </select>
                        </div>
                    </div>

                    {/* Category */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Kategorie</label>
                        <div className="grid grid-cols-2 gap-2">
                            {EXPENSE_CATEGORIES.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => editingId ? setEditForm({...editForm, category: cat}) : setNewExpense({...newExpense, category: cat})}
                                    className={`px-3 py-2 rounded-lg text-xs font-bold text-left transition-all border flex items-center gap-2 ${
                                        (editingId ? editForm.category : newExpense.category) === cat 
                                        ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' 
                                        : 'bg-white border-gray-100 text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    <CategoryIcon cat={cat} size={14}/>
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Items Field - ALWAYS VISIBLE */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Positionen / Artikel (Format: "Name: Preis")</label>
                        <textarea
                            value={editItemsText}
                            onChange={(e) => setEditItemsText(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-blue-100 h-32 max-w-full"
                            placeholder="Milch: 1.90&#10;Brot: 3.50&#10;Oder einfach Notizen..."
                        />
                    </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3 shrink-0 pb-safe w-full">
                    <button 
                        onClick={() => { setIsAdding(false); setEditingId(null); }}
                        className="flex-1 py-3 text-gray-500 font-bold text-sm hover:bg-gray-200 rounded-xl transition-colors"
                    >
                        Abbrechen
                    </button>
                    <button 
                        onClick={editingId ? saveEdit : addExpense}
                        disabled={!editingId && (!newExpense.amount || !newExpense.merchant)}
                        className={`flex-1 py-3 bg-[#16325c] text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-900/10 flex items-center justify-center gap-2 transition-all ${(!editingId && (!newExpense.amount || !newExpense.merchant)) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-800'}`}
                    >
                        <Check size={18} /> Speichern
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default ExpensesView;
