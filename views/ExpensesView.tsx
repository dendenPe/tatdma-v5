
import React, { useState, useEffect, useRef } from 'react';
import { 
  Wallet, 
  Plus, 
  Trash2, 
  Search, 
  ShoppingBag, 
  Coffee, 
  Car, 
  Home, 
  HeartPulse, 
  Globe, 
  FileText, 
  Sparkles, 
  Loader2, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Pencil, 
  Save, 
  Check, 
  Share2, 
  RefreshCw, 
  History, 
  ListFilter,
  PieChart as PieChartIcon,
  Target,
  Split,
  ArrowRight,
  FileSpreadsheet
} from 'lucide-react';
// @ts-ignore
import heic2any from 'heic2any';
import { AppData, ExpenseEntry, EXPENSE_CATEGORIES, ExpenseCategory, RecurringExpense } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, CartesianGrid } from 'recharts';
import { DBService } from '../services/dbService';
import { GeminiService } from '../services/geminiService';
import { DocumentService } from '../services/documentService';
import { VaultService } from '../services/vaultService';

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
  
  // Recurring Expenses State
  const [isEditingRecurring, setIsEditingRecurring] = useState<string | 'NEW' | null>(null);
  const [recurringForm, setRecurringForm] = useState<Partial<RecurringExpense>>({ history: [] });
  
  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ExpenseEntry>>({});
  const [editItemsText, setEditItemsText] = useState(''); // Textarea for items editing

  // Split State
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitParts, setSplitParts] = useState<{amount: number, category: ExpenseCategory}[]>([{amount: 0, category: 'Sonstiges'}, {amount: 0, category: 'Sonstiges'}]);

  // Budget State
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState<Record<string, number>>(data.budgets || {});

  // Modal for Viewing Receipt
  const [viewingReceiptBlob, setViewingReceiptBlob] = useState<Blob | null>(null);
  const [viewingReceiptSrc, setViewingReceiptSrc] = useState<string | null>(null);
  const [isConvertingReceipt, setIsConvertingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null); 
  
  const scanInputRef = useRef<HTMLInputElement>(null);
  
  // New Expense State
  const [newExpense, setNewExpense] = useState<Partial<ExpenseEntry>>({
      currency: 'CHF',
      category: 'Verpflegung',
      date: new Date().toISOString().split('T')[0]
  });

  // Temporary State for Adding History Item
  const [tempHistAmount, setTempHistAmount] = useState('');
  const [tempHistCurrency, setTempHistCurrency] = useState('CHF');
  const [tempHistDate, setTempHistDate] = useState('');

  const latestDataRef = useRef(data);
  useEffect(() => {
      latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
      setCurrentYear(globalYear);
  }, [globalYear]);

  useEffect(() => {
      if(data.budgets) setBudgetForm(data.budgets);
  }, [data.budgets]);

  // --- HELPER: GET EXCHANGE RATE ---
  const getExchangeRate = (currency: string, year: string): number => {
      if (currency === 'CHF') return 1;
      const portfolio = data.portfolios[data.currentPortfolioId] || Object.values(data.portfolios)[0];
      if (portfolio && portfolio.years[year] && portfolio.years[year].exchangeRates) {
          const pair = `${currency}_CHF`; 
          const rate = portfolio.years[year].exchangeRates[pair];
          if (rate && rate > 0) return rate;
      }
      if (currency === 'USD') return data.tax.rateUSD || 0.85;
      if (currency === 'EUR') return data.tax.rateEUR || 0.94;
      return 1;
  };

  // --- HELPER: GET ACTIVE RECURRING EXPENSE PRICE ---
  const getRecurringAmountForMonth = (rec: RecurringExpense, yearStr: string, month: number): { amount: number, currency: string, rate: number } | null => {
      if (rec.frequency === 'Q') {
          const startMonth = rec.paymentMonth || 1; 
          const m0 = month - 1;
          const s0 = startMonth - 1;
          const diff = m0 - s0;
          if (diff < 0 || diff % 3 !== 0) return null; 
      } else if (rec.frequency === 'Y') {
          if (month !== (rec.paymentMonth || 1)) return null;
      }

      const targetDate = new Date(parseInt(yearStr), month - 1, 1); 
      const sortedHistory = [...(rec.history || [])].sort((a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime());
      const activePrice = sortedHistory.find(h => new Date(h.validFrom) <= targetDate);
      
      if (!activePrice) return null; 

      const rate = getExchangeRate(activePrice.currency, yearStr);
      return { amount: activePrice.amount, currency: activePrice.currency, rate };
  };

  // --- RECURRING DATA PROCESSING ---
  const recurringExpensesList = data.recurringExpenses || [];
  
  const recurringTotalCHF = recurringExpensesList.reduce((sum, rec) => {
      const active = getRecurringAmountForMonth(rec, currentYear, currentMonth);
      if (active) return sum + (active.amount * active.rate);
      return sum;
  }, 0);

  // --- MAIN EXPENSE DATA ---
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

  // Search Logic & Matching
  const getMatchData = (e: ExpenseEntry) => {
      if (!searchTerm) return { matchTotal: 0, matchedItems: [] };
      const term = searchTerm.toLowerCase();
      let matchTotal = 0;
      const matchedItems: {name: string, price: number}[] = [];
      const isHeaderMatch = e.merchant.toLowerCase().includes(term) || (e.description && e.description.toLowerCase().includes(term));
      
      if (e.items && e.items.length > 0) {
          e.items.forEach(item => {
              const name = typeof item === 'string' ? item : item.name;
              const price = typeof item === 'string' ? 0 : item.price;
              if (name.toLowerCase().includes(term)) {
                  matchTotal += price;
                  matchedItems.push({ name, price });
              }
          });
      }
      
      if (isHeaderMatch && matchedItems.length === 0) {
          matchTotal = e.amount;
      }
      
      return { matchTotal, matchedItems, isHeaderMatch };
  };

  const dailySpendCHF = filteredExpenses.reduce((sum, e) => {
      if (searchTerm) {
          const { matchTotal } = getMatchData(e);
          return sum + (matchTotal * e.rate);
      }
      return sum + (e.amount * e.rate);
  }, 0);

  const searchTotalSpend = searchTerm ? filteredExpenses.reduce((sum, e) => {
      const { matchTotal } = getMatchData(e);
      return sum + (matchTotal * e.rate);
  }, 0) : 0;

  const totalSpendCHF = searchTerm ? searchTotalSpend : (dailySpendCHF + recurringTotalCHF);

  // Charts Data Preparation & Budget Calculation
  const catStats = EXPENSE_CATEGORIES.map(cat => {
      const dailySum = filteredExpenses.filter(e => e.category === cat).reduce((s, e) => s + (e.amount * e.rate), 0);
      const recurringSum = recurringExpensesList.filter(r => r.category === cat).reduce((s, r) => {
          const active = getRecurringAmountForMonth(r, currentYear, currentMonth);
          return s + (active ? active.amount * active.rate : 0);
      }, 0);
      const total = dailySum + recurringSum;
      const budget = data.budgets?.[cat] || 0;
      return { 
          name: cat, 
          value: total, 
          budget: budget,
          percent: budget > 0 ? (total / budget) * 100 : 0
      };
  }).sort((a,b) => b.value - a.value); 

  const pieData = catStats.filter(c => c.value > 0);

  // --- CSV EXPORT ---
  const handleExportCSV = () => {
      const header = "Datum;Händler;Kategorie;Beschreibung;Betrag;Währung;CHF_Wert;SteuerRelevant\n";
      const rows = allExpenses.map(e => {
          const chfVal = (e.amount * e.rate).toFixed(2);
          return `${e.date};${e.merchant.replace(/;/g, ',')};${e.category};${e.description?.replace(/;/g, ',') || ''};${e.amount};${e.currency};${chfVal};${e.isTaxRelevant ? 'Ja' : 'Nein'}`;
      });
      const csvContent = header + rows.join('\n');
      const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Ausgaben_${currentYear}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  // --- ACTIONS ---
  const saveRecurring = () => {
      const name = recurringForm.name;
      const category = recurringForm.category || 'Verpflegung';
      const frequency = recurringForm.frequency || 'M';

      if (!name) { alert("Bitte einen Namen für das Abo eingeben."); return; }

      let finalHistory = [...(recurringForm.history || [])];
      if (tempHistAmount && tempHistDate) {
          finalHistory.push({ amount: parseFloat(tempHistAmount), currency: tempHistCurrency, validFrom: tempHistDate });
      }

      if (finalHistory.length === 0) { alert("Bitte mindestens einen Preis (Historie) hinzufügen."); return; }

      const newData = { ...data };
      const list = newData.recurringExpenses || [];

      if (isEditingRecurring === 'NEW') {
          const newRec: RecurringExpense = {
              id: `rec_${Date.now()}`,
              name: name,
              category: category,
              frequency: frequency,
              paymentMonth: recurringForm.paymentMonth,
              history: finalHistory
          };
          newData.recurringExpenses = [...list, newRec];
      } else {
          const idx = list.findIndex(r => r.id === isEditingRecurring);
          if (idx !== -1) {
              list[idx] = { ...list[idx], name, category, frequency, paymentMonth: recurringForm.paymentMonth, history: finalHistory };
              newData.recurringExpenses = list;
          }
      }
      onUpdate(newData);
      setIsEditingRecurring(null);
      setRecurringForm({ history: [] });
      setTempHistAmount(''); setTempHistDate('');
  };

  const deleteRecurring = (id: string) => {
      if(confirm("Abo wirklich löschen?")) {
          const newData = { ...data };
          newData.recurringExpenses = (newData.recurringExpenses || []).filter(r => r.id !== id);
          onUpdate(newData);
      }
  };

  const addPriceHistory = (amount: number, currency: string, date: string) => {
      if (!amount || !date) return;
      const newHist = [...(recurringForm.history || [])];
      newHist.push({ amount, currency, validFrom: date });
      setRecurringForm({ ...recurringForm, history: newHist });
  };

  const removeHistoryItem = (idx: number) => {
      const newHist = [...(recurringForm.history || [])];
      newHist.splice(idx, 1);
      setRecurringForm({ ...recurringForm, history: newHist });
  };

  const parseItems = (text: string) => {
      return text.split('\n').map(s => {
          const trimS = s.trim();
          if (!trimS) return null;
          if (trimS.includes(':')) {
              const parts = trimS.split(':');
              const price = parseFloat(parts.pop() || '0');
              const name = parts.join(':').trim();
              if (name && !isNaN(price)) return { name, price };
          }
          return trimS;
      }).filter(s => s !== null) as any[];
  };

  // --- AUTO-RULE MATCHER ---
  const applyAutoRules = (merchant: string): ExpenseCategory | null => {
      if (!data.categoryRules) return null;
      const lowerMerchant = merchant.toLowerCase();
      
      for (const [cat, keywords] of Object.entries(data.categoryRules)) {
          if (keywords && keywords.some(k => lowerMerchant.includes(k.toLowerCase()))) {
              return cat as ExpenseCategory;
          }
      }
      return null;
  };

  const handleMerchantChange = (val: string, isEdit: boolean) => {
      if (isEdit) {
          setEditForm({ ...editForm, merchant: val });
          // Only auto-set if category not manually set or default
          const autoCat = applyAutoRules(val);
          if (autoCat && editForm.category === 'Sonstiges') {
              setEditForm(prev => ({ ...prev, category: autoCat }));
          }
      } else {
          setNewExpense({ ...newExpense, merchant: val });
          const autoCat = applyAutoRules(val);
          if (autoCat) {
              setNewExpense(prev => ({ ...prev, category: autoCat }));
          }
      }
  };

  const addExpense = () => {
      if (!newExpense.amount || !newExpense.merchant) return;
      const items = parseItems(editItemsText);
      const uniqueId = `exp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newDateStr = newExpense.date || new Date().toISOString().split('T')[0];
      const newYear = newDateStr.split('-')[0];
      const rate = getExchangeRate(newExpense.currency || 'CHF', newYear);

      const entry: ExpenseEntry = {
          id: uniqueId,
          date: newDateStr,
          merchant: newExpense.merchant,
          description: newExpense.description || '',
          amount: parseFloat(newExpense.amount as any),
          currency: newExpense.currency || 'CHF',
          rate: rate,
          category: newExpense.category as ExpenseCategory,
          location: newExpense.location,
          isTaxRelevant: false,
          items: items
      };
      
      const currentData = latestDataRef.current;
      const allExpensesMap = { ...(currentData.dailyExpenses || {}) };
      const currentYearList = allExpensesMap[newYear] ? [...allExpensesMap[newYear]] : [];
      allExpensesMap[newYear] = [...currentYearList, entry];
      onUpdate({ ...currentData, dailyExpenses: allExpensesMap });
      
      setIsAdding(false);
      setNewExpense({ currency: 'CHF', category: 'Verpflegung', date: new Date().toISOString().split('T')[0] });
      setEditItemsText('');
  };

  const handleSmartScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      
      setIsScanning(true);
      const currentData = latestDataRef.current;
      const allExpensesMap = { ...(currentData.dailyExpenses || {}) };
      
      try {
          for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const result = await GeminiService.analyzeDocument(file);
              
              if (result && result.dailyExpenseData && result.dailyExpenseData.isExpense) {
                  const expData = result.dailyExpenseData;
                  const date = result.date || new Date().toISOString().split('T')[0];
                  const year = date.split('-')[0];
                  const receiptId = `receipt_scan_${Date.now()}_${i}`;
                  await DBService.saveFile(receiptId, file);
                  
                  const uniqueId = `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                  const rate = getExchangeRate(expData.currency || 'CHF', year);
                  
                  // Use AI category, but check Auto-Rules as override
                  let category = (expData.expenseCategory as any) || 'Sonstiges';
                  const ruleCat = applyAutoRules(expData.merchant || '');
                  if (ruleCat) category = ruleCat;

                  const entry: ExpenseEntry = {
                      id: uniqueId, date: date, merchant: expData.merchant || 'Unbekannt', description: result.title || '',
                      amount: expData.amount || 0, currency: expData.currency || 'CHF', rate: rate,
                      category: category, location: expData.location,
                      isTaxRelevant: result.isTaxRelevant, receiptId: receiptId, items: expData.items
                  };
                  
                  const currentYearList = allExpensesMap[year] ? [...allExpensesMap[year]] : [];
                  allExpensesMap[year] = [...currentYearList, entry];
                  
                  if (currentYear !== year) setCurrentYear(year);
                  const m = parseInt(date.split('-')[1]);
                  if (!isNaN(m)) setCurrentMonth(m);
              }
          }
          
          onUpdate({ ...currentData, dailyExpenses: allExpensesMap });
          alert(`${files.length} Belege verarbeitet!`);

      } catch (err: any) { alert("Fehler beim Scan: " + err.message); } 
      finally { setIsScanning(false); e.target.value = ''; }
  };

  const startEditing = (entry: ExpenseEntry) => {
      setEditingId(entry.id);
      setEditForm({ ...entry });
      const text = entry.items ? entry.items.map(item => {
          if (typeof item === 'string') return item;
          return `${item.name}: ${item.price.toFixed(2)}`;
      }).join('\n') : '';
      setEditItemsText(text);
      setIsSplitting(false);
  };

  const saveEdit = () => {
      if (!editForm.id || !editingId) return;
      const currentData = latestDataRef.current;
      const allExpensesMap = { ...(currentData.dailyExpenses || {}) };
      let originalYear = currentYear;
      
      // Find original year
      for (const y of Object.keys(allExpensesMap)) { 
          if (allExpensesMap[y].find(e => e.id === editingId)) { originalYear = y; break; } 
      }

      // Handle Split Saving
      if (isSplitting) {
          const totalSplit = splitParts.reduce((s, p) => s + p.amount, 0);
          if (Math.abs(totalSplit - (editForm.amount || 0)) > 0.05) {
              alert(`Summe der Teile (${totalSplit}) entspricht nicht dem Gesamtbetrag (${editForm.amount})!`);
              return;
          }

          const baseEntry = { ...editForm };
          const newEntries: ExpenseEntry[] = splitParts.map((part, idx) => ({
              ...(baseEntry as ExpenseEntry),
              id: `${baseEntry.id}_${idx}`, // New IDs
              amount: part.amount,
              category: part.category,
              description: `${baseEntry.description} (Teil ${idx+1})`
          }));

          // Remove old, add new
          const oldList = allExpensesMap[originalYear] || [];
          const listWithoutOriginal = oldList.filter(e => e.id !== editingId);
          allExpensesMap[originalYear] = [...listWithoutOriginal, ...newEntries];

      } else {
          // Standard Save
          const newDateStr = editForm.date || new Date().toISOString().split('T')[0];
          const newYear = newDateStr.split('-')[0];
          const updatedItems = parseItems(editItemsText);
          const rate = getExchangeRate(editForm.currency || 'CHF', newYear);
          const updatedEntry: ExpenseEntry = { ...editForm as ExpenseEntry, date: newDateStr, items: updatedItems, rate: rate };
          
          const oldList = allExpensesMap[originalYear] || [];
          allExpensesMap[originalYear] = oldList.filter(e => e.id !== editingId); // Remove from old location
          
          const targetList = allExpensesMap[newYear] || [];
          targetList.push(updatedEntry);
          allExpensesMap[newYear] = targetList;
      }

      onUpdate({ ...currentData, dailyExpenses: allExpensesMap });
      setEditingId(null); setEditForm({}); setEditItemsText(''); setIsSplitting(false);
  };

  const initSplit = () => {
      setIsSplitting(true);
      const half = (editForm.amount || 0) / 2;
      setSplitParts([
          { amount: half, category: editForm.category || 'Sonstiges' },
          { amount: (editForm.amount || 0) - half, category: 'Sonstiges' }
      ]);
  };

  const updateSplit = (idx: number, field: 'amount'|'category', val: any) => {
      const newParts = [...splitParts];
      newParts[idx] = { ...newParts[idx], [field]: val };
      setSplitParts(newParts);
  };

  const addSplitPart = () => {
      setSplitParts([...splitParts, { amount: 0, category: 'Sonstiges' }]);
  };

  const deleteExpense = (id: string) => {
      if(confirm("Eintrag löschen?")) {
          const currentData = latestDataRef.current;
          const allExpensesMap = { ...(currentData.dailyExpenses || {}) };
          const list = allExpensesMap[currentYear] || [];
          allExpensesMap[currentYear] = list.filter(e => e.id !== id);
          onUpdate({ ...currentData, dailyExpenses: allExpensesMap });
      }
  };

  const saveBudgets = () => {
      onUpdate({ ...data, budgets: budgetForm });
      setIsBudgetModalOpen(false);
  };

  const viewReceipt = async (entry: ExpenseEntry) => {
      if(!entry.receiptId) return;
      setViewingReceiptBlob(null); setViewingReceiptSrc(null); setStatusMessage("Lade Beleg..."); setReceiptError(null); setIsConvertingReceipt(true);
      try {
          let blob = await DBService.getFile(entry.receiptId);
          if (!blob) {
              const notes = data.notes || {};
              const linkedNote = Object.values(notes).find((n: any) => n.expenseId === entry.id);
              if (linkedNote && linkedNote.filePath && VaultService.isConnected()) blob = await DocumentService.getFileFromVault(linkedNote.filePath);
          }
          if(blob) {
              setViewingReceiptBlob(blob);
              try {
                  const isHeic = blob.type === 'image/heic' || (!blob.type && blob.size > 0 && !blob.type.includes('image/'));
                  if (isHeic) {
                      const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
                      const jpgBlob = Array.isArray(result) ? result[0] : result;
                      setViewingReceiptSrc(URL.createObjectURL(jpgBlob));
                  } else { setViewingReceiptSrc(URL.createObjectURL(blob)); }
                  setStatusMessage(null);
              } catch (e) { setReceiptError("Fehler beim Anzeigen."); setStatusMessage(null); }
          } else { setReceiptError("Datei nicht gefunden."); setStatusMessage(null); }
      } catch (err: any) { setReceiptError("Fehler: " + err.message); setStatusMessage(null); }
  };

  const closeReceiptModal = () => { if (viewingReceiptSrc) URL.revokeObjectURL(viewingReceiptSrc); setViewingReceiptBlob(null); setViewingReceiptSrc(null); setReceiptError(null); setStatusMessage(null); setIsConvertingReceipt(false); };
  const handleShare = async () => { if (!viewingReceiptSrc || !viewingReceiptBlob) return; try { const file = new File([viewingReceiptBlob], `beleg.jpg`, { type: viewingReceiptBlob.type || 'image/jpeg' }); if (navigator.share) await navigator.share({ files: [file], title: 'Beleg' }); else alert("Teilen nicht unterstützt."); } catch (e) {} };

  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24 overflow-x-hidden" style={{ touchAction: 'manipulation' }}>
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-4 md:p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl shrink-0"><Wallet size={24} /></div>
              <div className="min-w-0">
                  <h2 className="text-xl font-black text-gray-800 dark:text-white tracking-tight truncate">Ausgaben</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{monthNames[currentMonth-1]} {currentYear}</p>
              </div>
          </div>
          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-xl p-1 shrink-0 w-full md:w-auto">
                  <button onClick={() => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1)} className="p-2 hover:bg-white dark:hover:bg-gray-600 rounded-lg text-gray-400"><ChevronLeft size={16}/></button>
                  <div className="px-2 w-24 text-center font-black text-gray-700 dark:text-white text-sm">{monthNames[currentMonth-1]}</div>
                  <button onClick={() => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1)} className="p-2 hover:bg-white dark:hover:bg-gray-600 rounded-lg text-gray-400"><ChevronRight size={16}/></button>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full md:w-auto md:flex">
                  <button onClick={handleExportCSV} className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-600 transition-all shadow-sm"><FileSpreadsheet size={14} /> CSV</button>
                  <button onClick={() => setIsBudgetModalOpen(true)} className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-600 transition-all shadow-sm"><Target size={14} /> Budget</button>
                  <button onClick={() => scanInputRef.current?.click()} disabled={isScanning} className="px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:shadow-lg transition-all">{isScanning ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14} />} AI Scan</button>
                  <input type="file" ref={scanInputRef} className="hidden" multiple accept="image/*,application/pdf" onChange={handleSmartScan} />
                  <button onClick={() => { setIsAdding(true); setEditItemsText(''); }} className="px-3 py-2 bg-[#16325c] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-800 shadow-lg shadow-blue-900/10"><Plus size={14} /> Neu</button>
              </div>
          </div>
      </div>

      {/* MOBILE TOTAL */}
      <div className="md:hidden bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between animate-in fade-in duration-300">
          <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">{searchTerm ? `Summe "${searchTerm}"` : `Total ${monthNames[currentMonth-1]}`}</p>
              <h3 className={`text-2xl font-black ${searchTerm ? 'text-purple-600' : 'text-gray-800 dark:text-white'}`}>{totalSpendCHF.toLocaleString('de-CH', {minimumFractionDigits: 2})} <span className={`text-sm ${searchTerm ? 'text-purple-300' : 'text-gray-400'}`}> CHF</span></h3>
          </div>
      </div>

      {/* MAIN GRID LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* MAIN CONTENT AREA (Charts & Daily List) */}
          <div className="lg:col-span-3 space-y-6">
              
              {/* DESKTOP STATS */}
              {searchTerm ? (
                  <div className="hidden md:flex bg-purple-50 dark:bg-purple-900/20 p-6 rounded-3xl border border-purple-100 dark:border-purple-800 shadow-sm items-center justify-between animate-in fade-in">
                      <div>
                          <p className="text-[10px] uppercase font-bold text-purple-400 tracking-widest mb-1">Suchergebnis "{searchTerm}"</p>
                          <h3 className="text-3xl font-black text-purple-700 dark:text-purple-300">{searchTotalSpend.toLocaleString('de-CH', {minimumFractionDigits: 2})} <span className="text-sm text-purple-400">CHF</span></h3>
                          <p className="text-[10px] text-purple-400 mt-1 font-bold">Summe aller gefundenen Positionen</p>
                      </div>
                      <div className="p-4 bg-white dark:bg-gray-800 text-purple-500 rounded-2xl shadow-sm"><Search size={32}/></div>
                  </div>
              ) : (
                  <div className="hidden md:grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                          <div>
                              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-1">Ausgaben Total</p>
                              <h3 className="text-3xl font-black text-gray-800 dark:text-white">{totalSpendCHF.toLocaleString('de-CH', {minimumFractionDigits: 2})} <span className="text-sm text-gray-400">CHF</span></h3>
                              {recurringTotalCHF > 0 && <p className="text-[10px] text-gray-400 mt-1 font-bold">davon {recurringTotalCHF.toLocaleString('de-CH',{maximumFractionDigits:0})} CHF fix (Abos)</p>}
                          </div>
                      </div>
                      
                      {/* CATEGORY & BUDGET LIST */}
                      <div className="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col col-span-2 overflow-y-auto max-h-48 custom-scrollbar">
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">Budget & Verteilung</h4>
                          <div className="space-y-3">
                              {catStats.map((stat, idx) => (
                                  <div key={stat.name} className="flex items-center gap-3 text-xs">
                                      <div className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor: COLORS[idx % COLORS.length]}} />
                                      <div className="flex-1">
                                          <div className="flex justify-between mb-1">
                                              <span className="font-bold text-gray-700 dark:text-gray-300">{stat.name}</span>
                                              <div className="flex gap-1">
                                                  <span className="font-black text-gray-800 dark:text-white">{stat.value.toFixed(0)}</span>
                                                  {stat.budget > 0 && <span className="text-gray-400">/ {stat.budget}</span>}
                                              </div>
                                          </div>
                                          {stat.budget > 0 && (
                                              <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                                  <div 
                                                      className={`h-full rounded-full transition-all ${stat.percent > 100 ? 'bg-red-500' : stat.percent > 75 ? 'bg-yellow-400' : 'bg-green-500'}`} 
                                                      style={{width: `${Math.min(stat.percent, 100)}%`}} 
                                                  />
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              )}

              {/* TRANSACTIONS LIST */}
              <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden min-h-[400px]">
                  <div className="p-4 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between">
                      <h3 className="font-bold text-gray-800 dark:text-white text-sm pl-2 flex items-center gap-2">
                          {searchTerm && <ListFilter size={16} className="text-purple-500" />}
                          {searchTerm ? 'Suchergebnisse' : 'Einzeltransaktionen'}
                      </h3>
                      <div className="relative w-48 hidden md:block">
                          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                          <input type="text" placeholder="Suche..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-xl text-base md:text-xs font-bold outline-none focus:ring-1 focus:ring-blue-100 dark:text-white" />
                      </div>
                  </div>
                  
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left">
                          <thead className="bg-gray-50 dark:bg-gray-700 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                              <tr>
                                  <th className="px-6 py-4">Datum</th>
                                  <th className="px-6 py-4">Händler / Details</th>
                                  <th className="px-6 py-4">Kategorie</th>
                                  <th className="px-6 py-4 text-right">Betrag</th>
                                  <th className="px-4 py-4 text-center">Beleg</th>
                                  <th className="px-4 py-4 text-right">Aktionen</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                              {filteredExpenses.map(e => {
                                  const { matchTotal, matchedItems } = getMatchData(e);
                                  const displayAmount = searchTerm ? matchTotal : e.amount;
                                  const isPartial = searchTerm && matchTotal < e.amount && matchTotal > 0;

                                  return (
                                      <tr key={e.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
                                          <td className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400">{new Date(e.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
                                          <td className="px-6 py-4">
                                              <div className="font-bold text-gray-800 dark:text-white text-sm">{e.merchant}</div>
                                              {/* Show found items clearly */}
                                              {isPartial && matchedItems.length > 0 ? (
                                                  <div className="flex flex-wrap gap-1 mt-1">
                                                      {matchedItems.map((item, i) => (
                                                          <span key={i} className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium border border-purple-200">
                                                              {item.name}
                                                          </span>
                                                      ))}
                                                  </div>
                                              ) : (
                                                  e.items && e.items.length > 0 && <div className="text-[10px] text-gray-400">{e.items.length} Positionen</div>
                                              )}
                                          </td>
                                          <td className="px-6 py-4"><span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{e.category}</span></td>
                                          <td className="px-6 py-4 text-right">
                                              <div className={`font-black text-sm ${isPartial ? 'text-purple-600' : 'text-gray-800 dark:text-white'}`}>
                                                  {displayAmount.toFixed(2)} <span className="text-[10px] text-gray-400">{e.currency}</span>
                                              </div>
                                              {isPartial && <div className="text-[9px] text-purple-400 font-bold">Teilsumme</div>}
                                              {e.currency !== 'CHF' && !isPartial && <div className="text-[9px] font-bold text-blue-600">{(displayAmount * e.rate).toFixed(2)} CHF</div>}
                                          </td>
                                          <td className="px-4 py-4 text-center">{e.receiptId && <button onClick={() => viewReceipt(e)} className="p-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-lg"><FileText size={14}/></button>}</td>
                                          <td className="px-4 py-4 text-right">
                                              <button onClick={() => startEditing(e)} className="p-1.5 text-gray-400 hover:text-blue-500"><Pencil size={14}/></button>
                                              <button onClick={() => deleteExpense(e.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14}/></button>
                                          </td>
                                      </tr>
                                  );
                              })}
                              {filteredExpenses.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-xs italic">Keine Ausgaben.</td></tr>}
                          </tbody>
                          {/* TABLE FOOTER FOR SEARCH OR GENERAL TOTAL */}
                          {(searchTerm || filteredExpenses.length > 0) && (
                              <tfoot>
                                  <tr className={`border-t border-purple-100 dark:border-gray-600 ${searchTerm ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-700'}`}>
                                      <td colSpan={3} className={`px-6 py-4 text-right text-xs font-black uppercase tracking-widest ${searchTerm ? 'text-purple-400' : 'text-gray-400'}`}>
                                          {searchTerm ? 'Summe Suchergebnisse' : 'Summe Transaktionen'}
                                      </td>
                                      <td className={`px-6 py-4 text-right text-sm font-black ${searchTerm ? 'text-purple-700 dark:text-purple-300' : 'text-gray-800 dark:text-white'}`}>
                                          {(searchTerm ? searchTotalSpend : dailySpendCHF).toFixed(2)} CHF
                                      </td>
                                      <td colSpan={2}></td>
                                  </tr>
                              </tfoot>
                          )}
                      </table>
                  </div>

                  {/* Mobile List */}
                  <div className="md:hidden p-4 space-y-3">
                      <div className="relative mb-4">
                          <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                          <input type="text" placeholder="Suchen..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-xl text-base md:text-sm font-medium outline-none dark:text-white" />
                      </div>
                      {filteredExpenses.map(e => {
                          const { matchTotal, matchedItems } = getMatchData(e);
                          const displayAmount = searchTerm ? matchTotal : e.amount;
                          const isPartial = searchTerm && matchTotal < e.amount && matchTotal > 0;

                          return (
                          <div key={e.id} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col gap-3">
                              <div className="flex justify-between items-start">
                                  <div>
                                      <h4 className="font-bold text-gray-900 dark:text-white">{e.merchant}</h4>
                                      <p className="text-[10px] text-gray-400">{e.category}</p>
                                      {isPartial && matchedItems.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mt-1">
                                              {matchedItems.map((item, i) => (
                                                  <span key={i} className="text-[9px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100">
                                                      {item.name}
                                                  </span>
                                              ))}
                                          </div>
                                      )}
                                  </div>
                                  <div className="text-right">
                                      <span className={`block font-black text-lg ${isPartial ? 'text-purple-600' : 'text-gray-800 dark:text-white'}`}>
                                          {displayAmount.toFixed(2)} <span className="text-xs text-gray-400">{e.currency}</span>
                                      </span>
                                      {isPartial && <span className="text-[9px] text-purple-400 font-bold block">Teilsumme</span>}
                                      {!isPartial && e.currency !== 'CHF' && <span className="block text-[10px] font-bold text-blue-600">{(e.amount * e.rate).toFixed(2)} CHF</span>}
                                  </div>
                              </div>
                              <div className="flex justify-between items-center pt-2 border-t border-gray-50 dark:border-gray-700">
                                  <div className="text-xs text-gray-400">{new Date(e.date).toLocaleDateString()}</div>
                                  <div className="flex gap-2">
                                      <button onClick={() => startEditing(e)} className="p-1.5 bg-gray-50 dark:bg-gray-700 rounded text-gray-500"><Pencil size={14}/></button>
                                      <button onClick={() => deleteExpense(e.id)} className="p-1.5 bg-gray-50 dark:bg-gray-700 rounded text-gray-500"><Trash2 size={14}/></button>
                                  </div>
                              </div>
                          </div>
                      )})}
                      
                      {/* Mobile Footer Total */}
                      {searchTerm && filteredExpenses.length > 0 && (
                          <div className="mt-4 bg-purple-50 p-4 rounded-2xl border border-purple-100 flex justify-between items-center shadow-sm">
                              <span className="text-xs font-black text-purple-400 uppercase tracking-widest">Summe</span>
                              <span className="text-xl font-black text-purple-700">{searchTotalSpend.toFixed(2)} CHF</span>
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {/* RECURRING EXPENSES SIDEBAR */}
          <div className="lg:col-span-1 space-y-4">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-50 dark:border-gray-700">
                      <h3 className="font-black text-gray-800 dark:text-white text-sm flex items-center gap-2"><RefreshCw size={16} className="text-purple-500"/> Abos / Fix</h3>
                      <button onClick={() => { setIsEditingRecurring('NEW'); setRecurringForm({ history: [] }); }} className="p-1.5 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors"><Plus size={16}/></button>
                  </div>
                  
                  <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                      {recurringExpensesList.length === 0 && <div className="text-center py-8 text-gray-400 text-xs italic">Keine Abos erfasst.</div>}
                      {recurringExpensesList.map(rec => {
                          const active = getRecurringAmountForMonth(rec, currentYear, currentMonth);
                          return (
                              <div key={rec.id} onClick={() => { setIsEditingRecurring(rec.id); setRecurringForm({...rec}); }} className={`p-3 rounded-xl border cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-all group ${active ? 'border-purple-200 bg-purple-50/30 dark:bg-purple-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                                  <div className="flex justify-between items-center mb-1">
                                      <span className="font-bold text-gray-700 dark:text-gray-300 text-sm truncate max-w-[120px]">{rec.name}</span>
                                      <span className={`text-[9px] px-1.5 rounded font-black ${rec.frequency === 'M' ? 'bg-blue-100 text-blue-600' : rec.frequency === 'Q' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>{rec.frequency}</span>
                                  </div>
                                  <div className="flex justify-between items-end">
                                      <div className="text-[10px] text-gray-400">{rec.category}</div>
                                      {active ? (
                                          <div className="text-right">
                                              <span className="block font-black text-sm text-purple-700 dark:text-purple-400">{active.amount} {active.currency}</span>
                                              {active.currency !== 'CHF' && <span className="text-[9px] text-gray-400">~ {(active.amount * active.rate).toFixed(0)} CHF</span>}
                                          </div>
                                      ) : (
                                          <span className="text-[9px] text-gray-300 italic">In {monthNames[currentMonth-1].substr(0,3)} inaktiv</span>
                                      )}
                                  </div>
                              </div>
                          );
                      })}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-gray-500">Total Fix ({monthNames[currentMonth-1]})</span>
                          <span className="font-black text-gray-800 dark:text-white">{recurringTotalCHF.toFixed(2)} CHF</span>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* RECURRING EXPENSE EDIT MODAL */}
      {isEditingRecurring && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 relative max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
                      <h3 className="font-black text-xl text-gray-800">{isEditingRecurring === 'NEW' ? 'Neues Abo / Fixkosten' : 'Abo Bearbeiten'}</h3>
                      <button onClick={() => setIsEditingRecurring(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20}/></button>
                  </div>
                  
                  <div className="space-y-4">
                      {/* ... existing form fields ... */}
                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Name</label>
                              <input type="text" value={recurringForm.name || ''} onChange={(e) => setRecurringForm({...recurringForm, name: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-100" placeholder="z.B. Netflix" />
                          </div>
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Kategorie</label>
                              <select value={recurringForm.category || 'Verpflegung'} onChange={(e) => setRecurringForm({...recurringForm, category: e.target.value as any})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none">
                                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase">Frequenz</label>
                              <select value={recurringForm.frequency || 'M'} onChange={(e) => setRecurringForm({...recurringForm, frequency: e.target.value as any})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none">
                                  <option value="M">Monatlich</option>
                                  <option value="Q">Quartalsweise</option>
                                  <option value="Y">Jährlich</option>
                              </select>
                          </div>
                          {(recurringForm.frequency === 'Q' || recurringForm.frequency === 'Y') && (
                              <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase">{recurringForm.frequency === 'Y' ? 'Zahlmonat' : 'Startmonat'}</label>
                                  <select value={recurringForm.paymentMonth || 1} onChange={(e) => setRecurringForm({...recurringForm, paymentMonth: parseInt(e.target.value)})} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none">
                                      {monthNames.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                                  </select>
                              </div>
                          )}
                      </div>

                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                          <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><History size={12}/> Preis-Historie (Gültig ab)</h4>
                          
                          <div className="space-y-2 mb-4 max-h-32 overflow-y-auto">
                              {recurringForm.history?.sort((a,b) => b.validFrom.localeCompare(a.validFrom)).map((h, i) => (
                                  <div key={i} className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-100 shadow-sm text-xs">
                                      <span className="font-mono text-gray-500">{new Date(h.validFrom).toLocaleDateString()}</span>
                                      <span className="font-bold text-gray-800">{h.amount} {h.currency}</span>
                                      <button onClick={() => removeHistoryItem(i)} className="text-red-400 hover:text-red-600"><Trash2 size={12}/></button>
                                  </div>
                              ))}
                              {(!recurringForm.history || recurringForm.history.length === 0) && <div className="text-xs text-gray-400 italic text-center">Noch keine Preise definiert.</div>}
                          </div>

                          <div className="flex gap-2 items-end border-t border-gray-200 pt-3">
                              <div className="space-y-1 flex-1">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase">Betrag</label>
                                  <input type="number" value={tempHistAmount} onChange={(e) => setTempHistAmount(e.target.value)} className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm font-bold" placeholder="0.00"/>
                              </div>
                              <div className="space-y-1 w-20">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase">Währ.</label>
                                  <select value={tempHistCurrency} onChange={(e) => setTempHistCurrency(e.target.value)} className="w-full px-1 py-1.5 rounded border border-gray-300 text-sm font-bold"><option value="CHF">CHF</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
                              </div>
                              <div className="space-y-1 flex-1">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase">Gültig ab</label>
                                  <input type="date" value={tempHistDate} onChange={(e) => setTempHistDate(e.target.value)} className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm"/>
                              </div>
                              <button 
                                  onClick={() => {
                                      if(tempHistAmount && tempHistDate) {
                                          addPriceHistory(parseFloat(tempHistAmount), tempHistCurrency, tempHistDate);
                                          setTempHistAmount(''); setTempHistDate('');
                                      }
                                  }}
                                  disabled={!tempHistAmount || !tempHistDate}
                                  className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed h-[34px]"
                              >
                                  <Plus size={16} />
                              </button>
                          </div>
                      </div>
                  </div>

                  <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
                      {isEditingRecurring !== 'NEW' && (
                          <button onClick={() => deleteRecurring(isEditingRecurring as string)} className="p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100"><Trash2 size={18}/></button>
                      )}
                      <div className="flex-1"></div>
                      <button onClick={() => setIsEditingRecurring(null)} className="px-6 py-3 text-gray-500 font-bold text-sm hover:bg-gray-100 rounded-xl">Abbrechen</button>
                      <button onClick={saveRecurring} className="px-8 py-3 bg-[#16325c] text-white font-bold text-sm rounded-xl shadow-lg hover:bg-blue-800 transition-all flex items-center gap-2"><Check size={18}/> Speichern</button>
                  </div>
              </div>
          </div>
      )}

      {/* ... Other Modals ... */}
      
    </div>
  );
};

export default ExpensesView;
