
import React, { useState, useRef, useEffect } from 'react';
import { 
  FileDown, 
  User, 
  Receipt, 
  Landmark, 
  Plus, 
  Trash2, 
  CreditCard, 
  Calculator,
  Briefcase,
  Wallet,
  Info,
  CheckCircle2,
  FileText,
  X,
  Save,
  FileUp,
  ShieldCheck,
  Baby,
  Heart,
  MapPin,
  ClipboardList,
  CalendarCheck,
  CalendarDays,
  Paperclip,
  TrendingUp,
  ArrowRight,
  Settings,
  ChevronRight,
  MessageSquare,
  Euro,
  Database,
  ScanLine,
  FileCode,
  Loader2,
  Sparkles,
  Calendar,
  FileSpreadsheet
} from 'lucide-react';
import { AppData, TaxExpense, BankBalance, SalaryEntry, ChildDetails, AlimonyDetails, CustomBankAccount } from '../types';
import { DBService } from '../services/dbService';
import { PdfGenService, PdfExportOptions } from '../services/pdfGenService';
import { DocumentService } from '../services/documentService';
import { XmlExportService } from '../services/xmlExportService';
import { GeminiService } from '../services/geminiService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  globalYear: string;
}

const TaxView: React.FC<Props> = ({ data, onUpdate, globalYear }) => {
  const [activeSubTab, setActiveSubTab] = useState<'personal' | 'expenses' | 'balances' | 'summary' | 'message'>('personal');
  const [selectedYear, setSelectedYear] = useState(globalYear);
  const [specialExpenseModalIdx, setSpecialExpenseModalIdx] = useState<number | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  
  // Sync with global year
  useEffect(() => {
    setSelectedYear(globalYear);
  }, [globalYear]);

  // PDF Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportOpts, setExportOpts] = useState<PdfExportOptions>({
    includePersonal: true,
    includeMessage: true,
    includeSalary: true,
    includeAssets: true,
    includeExpenses: true,
    includeTradingProof: false,
    includeReceipts: true
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const legacyImportRef = useRef<HTMLInputElement>(null);
  const smartScanInputRef = useRef<HTMLInputElement>(null);

  const updatePersonal = (field: string, value: string) => {
    onUpdate({
      ...data,
      tax: { ...data.tax, personal: { ...data.tax.personal, [field]: value } }
    });
  };

  const updateMessage = (msg: string) => {
    onUpdate({
      ...data,
      tax: { 
        ...data.tax, 
        messageToAuthorities: { ...(data.tax.messageToAuthorities || {}), [selectedYear]: msg } 
      }
    });
  };

  const handleGeneratePdf = async () => {
    setShowExportModal(false);
    await PdfGenService.generateTaxPDF(data, selectedYear, exportOpts);
  };
  
  const handleExportXml = () => {
      const xml = XmlExportService.generateTaxXML(data, selectedYear);
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eTax_Data_${selectedYear}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const handleExportSecuritiesCSV = () => {
      const csv = XmlExportService.generateSecuritiesCSV(data, selectedYear);
      if (!csv) {
          alert("Keine Portfolio-Daten für dieses Jahr gefunden.");
          return;
      }
      // Add BOM for Excel compatibility
      const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Wertschriften_${selectedYear}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  // --- SMART SCAN LOGIC (GEMINI AI) ---
  const handleSmartScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsScanning(true);
      try {
          // Verify Env Key is present (client side check)
          const apiKey = localStorage.getItem('tatdma_api_key');
          if (!apiKey) {
             throw new Error("API Key fehlt! Bitte in den Systemeinstellungen hinterlegen.");
          }

          const result = await GeminiService.analyzeReceipt(file);
          
          if (!result) throw new Error("Keine Daten erkannt.");

          // Create Expense Entry
          const newExpense: TaxExpense = {
              desc: result.description || file.name,
              amount: result.amount || 0,
              year: result.date ? result.date.split('-')[0] : selectedYear,
              cat: (result.category as any) || 'Sonstiges',
              currency: result.currency || 'CHF',
              rate: 1, // Default, updated if currency differs
              receipts: [],
              taxRelevant: true
          };

          // Currency Handling (Simple Logic)
          if (newExpense.currency === 'USD') newExpense.rate = data.tax.rateUSD || 0.85;
          if (newExpense.currency === 'EUR') newExpense.rate = data.tax.rateEUR || 0.94;

          // Save File to DB and link it
          const id = `receipt_${Date.now()}`;
          await DBService.saveFile(id, file);
          newExpense.receipts.push(id);

          // Update State
          onUpdate({
              ...data,
              tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] }
          });
          
          let alertMsg = `Gemini Smart Scan erfolgreich!\n\nBetrag: ${newExpense.amount} ${newExpense.currency}\nKategorie: ${newExpense.cat}`;
          if (result.isMonthlySummary) alertMsg += "\n(Hinweis: Monatliche Beträge wurden summiert)";
          
          alert(alertMsg);

      } catch (err: any) {
          console.error(err);
          alert("Fehler beim Smart Scan: " + err.message);
      } finally {
          setIsScanning(false);
          e.target.value = '';
      }
  };

  // --- LEGACY IMPORT LOGIC ---
  const handleLegacyJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const oldData = JSON.parse(text);

        if (!oldData.expenses && !oldData.personal) {
          alert("Das scheint keine gültige Steuer-Datei zu sein (Format nicht erkannt).");
          return;
        }

        const newData = { ...data };
        let importCount = 0;
        
        if (oldData.personal) newData.tax.personal = { ...newData.tax.personal, ...oldData.personal };

        if (oldData.balances) {
            Object.keys(oldData.balances).forEach(y => {
                if (!newData.tax.balances[y]) newData.tax.balances[y] = { ubs: 0, comdirect: 0, ibkr: 0 };
                const oldBal = oldData.balances[y];
                newData.tax.balances[y] = {
                    ...newData.tax.balances[y],
                    ubs: oldBal.ubs || 0,
                    comdirect: oldBal.comdirect || 0,
                    comdirectEUR: oldBal.comdirectEUR || 0,
                    ibkr: oldBal.ibkr || 0
                };
            });
        }

        if (oldData.remarks) {
            if (!newData.tax.messageToAuthorities) newData.tax.messageToAuthorities = {};
            newData.tax.messageToAuthorities[selectedYear] = oldData.remarks;
        }

        if (Array.isArray(oldData.expenses)) {
            const newExpenses: TaxExpense[] = [];
            oldData.expenses.forEach((exp: any) => {
                let newCat: any = exp.cat;
                if (exp.cat === 'Unterhalt') newCat = 'Alimente';
                if (exp.cat === 'Krankenkasse') newCat = 'Krankenkassenprämien';
                
                const newExp: TaxExpense = {
                    desc: exp.desc || '',
                    amount: parseFloat(exp.amount) || 0,
                    year: exp.year || selectedYear,
                    cat: newCat,
                    currency: exp.currency || 'CHF',
                    rate: exp.rate || 1,
                    taxRelevant: true,
                    receipts: []
                };

                if (exp.details) {
                    const d = exp.details;
                    const splitName = (fullName: string) => {
                        const parts = (fullName || '').split(' ');
                        return { vorname: parts[0] || '', nachname: parts.slice(1).join(' ') || '' };
                    };

                    if (d.childName) {
                        newExp.cat = 'Kindesunterhalt';
                        const childNames = splitName(d.childName);
                        const recNames = splitName(d.recName);
                        const dob = d.childDob ? d.childDob.split('T')[0] : '';

                        newExp.childDetails = {
                            vorname: childNames.vorname,
                            nachname: childNames.nachname,
                            geburtsdatum: dob,
                            schule_ausbildung: '',
                            konfession: 'andere',
                            haushalt: false,
                            empfaenger_vorname: recNames.vorname,
                            empfaenger_name: recNames.nachname,
                            empfaenger_plz_ort: d.recAddress || '', 
                            paymentFrequency: d.frequency === '12' ? 'fix' : 'individuell',
                            monthlyAmounts: Array.isArray(d.monthlyAmounts) && d.monthlyAmounts.length === 12 ? d.monthlyAmounts : Array(12).fill(d.baseAmount || 0),
                            currency: exp.currency || 'CHF'
                        };
                    } 
                    else if (d.recName || newCat === 'Alimente' || newCat === 'Unterhalt') {
                         newExp.cat = 'Alimente';
                         const recNames = splitName(d.recName || exp.desc);
                         newExp.alimonyDetails = {
                             empfaenger_vorname: recNames.vorname,
                             empfaenger_name: recNames.nachname,
                             empfaenger_plz_ort: d.recAddress || '',
                             getrennt_seit: '',
                             paymentFrequency: d.frequency === '12' ? 'fix' : 'individuell',
                             monthlyAmounts: Array.isArray(d.monthlyAmounts) && d.monthlyAmounts.length === 12 ? d.monthlyAmounts : Array(12).fill(d.baseAmount || 0),
                             currency: exp.currency || 'CHF'
                         };
                    }
                }
                newExpenses.push(newExp);
                importCount++;
            });
            newData.tax.expenses = [...newData.tax.expenses, ...newExpenses];
        }

        onUpdate(newData);
        alert(`Import erfolgreich!\n\nPersonalien aktualisiert.\n${importCount} Ausgaben importiert.`);
      } catch (err) {
        console.error(err);
        alert("Fehler beim Lesen der JSON Datei.");
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const addExpense = () => {
    const newExpense: TaxExpense = {
      desc: '', amount: 0, year: selectedYear, cat: 'Berufsauslagen', currency: 'CHF', rate: 1, receipts: [], taxRelevant: true
    };
    onUpdate({ ...data, tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] } });
  };

  const updateExpense = (index: number, field: keyof TaxExpense, value: any) => {
    const newExpenses = [...data.tax.expenses];
    if (field === 'cat' && (value === 'Alimente' || value === 'Kindesunterhalt')) {
       newExpenses[index] = { ...newExpenses[index], [field]: value, taxRelevant: true };
    } else {
       newExpenses[index] = { ...newExpenses[index], [field]: value };
    }
    
    // Update rate automatically if currency changes
    if (field === 'currency') {
      if (value === 'USD') newExpenses[index].rate = data.tax.rateUSD || 0.85;
      else if (value === 'EUR') newExpenses[index].rate = data.tax.rateEUR || 0.94;
      else newExpenses[index].rate = 1;
    }

    if (field === 'cat' && (value === 'Alimente' || value === 'Kindesunterhalt')) {
      if (value === 'Alimente' && !newExpenses[index].alimonyDetails) {
        newExpenses[index].alimonyDetails = { 
            empfaenger_name: '', empfaenger_vorname: '', empfaenger_plz_ort: '', 
            getrennt_seit: '', paymentFrequency: 'fix', monthlyAmounts: Array(12).fill(0), currency: 'CHF' 
        };
      } else if (value === 'Kindesunterhalt' && !newExpenses[index].childDetails) {
        newExpenses[index].childDetails = { 
            vorname: '', nachname: '', geburtsdatum: '', schule_ausbildung: '', konfession: 'andere', haushalt: true, 
            paymentFrequency: 'fix', monthlyAmounts: Array(12).fill(0), currency: 'CHF', 
            empfaenger_vorname: '', empfaenger_name: '', empfaenger_plz_ort: '' 
        };
      }
      setSpecialExpenseModalIdx(index);
    }
    onUpdate({ ...data, tax: { ...data.tax, expenses: newExpenses } });
  };

  const updateSpecialExpenseFull = (idx: number, updates: Partial<TaxExpense>) => {
    const newExpenses = [...data.tax.expenses];
    newExpenses[idx] = { ...newExpenses[idx], ...updates };
    onUpdate({ ...data, tax: { ...data.tax, expenses: newExpenses } });
  };

  const handleDetailChange = (idx: number, type: 'childDetails' | 'alimonyDetails', newDetails: any) => {
      let newDesc = data.tax.expenses[idx].desc;
      if (type === 'alimonyDetails') {
          const vorname = newDetails.empfaenger_vorname || '';
          const nachname = newDetails.empfaenger_name || '';
          if (vorname || nachname) newDesc = `Alimente an ${vorname} ${nachname}`.trim();
      } else if (type === 'childDetails') {
          const kind = newDetails.vorname || 'Kind';
          const vorname = newDetails.empfaenger_vorname || '';
          const nachname = newDetails.empfaenger_name || '';
          if (vorname || nachname) newDesc = `Unterhalt für ${kind} (an ${vorname} ${nachname})`.trim();
      }
      updateSpecialExpenseFull(idx, { [type]: newDetails, desc: newDesc });
  };

  // Handles updating the 12-month array
  const handleMonthlyAmountsChange = (idx: number, type: 'childDetails' | 'alimonyDetails', newMonthlyAmounts: number[]) => {
      const total = newMonthlyAmounts.reduce((a, b) => a + b, 0);
      const currentDetails = data.tax.expenses[idx][type];
      
      // Update the main expense amount AND the details array
      updateSpecialExpenseFull(idx, { 
          amount: total, 
          [type]: { ...currentDetails, monthlyAmounts: newMonthlyAmounts } 
      });
  };

  // Handles switching between Fix (x12) and Variable
  const toggleFrequency = (idx: number, type: 'childDetails' | 'alimonyDetails', mode: 'fix' | 'individuell') => {
      const currentDetails = data.tax.expenses[idx][type];
      if (!currentDetails) return;

      let newMonthly = [...currentDetails.monthlyAmounts];
      if (mode === 'fix') {
          // If switching to fix, take the first month or average as base? Let's take index 0
          const base = newMonthly[0] || 0;
          newMonthly = Array(12).fill(base);
      }
      
      const total = newMonthly.reduce((a, b) => a + b, 0);
      updateSpecialExpenseFull(idx, { 
          amount: total, 
          [type]: { ...currentDetails, paymentFrequency: mode, monthlyAmounts: newMonthly } 
      });
  };

  const handleFixAmountChange = (idx: number, type: 'childDetails' | 'alimonyDetails', amount: number) => {
      const currentDetails = data.tax.expenses[idx][type];
      const newMonthly = Array(12).fill(amount);
      updateSpecialExpenseFull(idx, {
          amount: amount * 12,
          [type]: { ...currentDetails, monthlyAmounts: newMonthly }
      });
  };

  const handleCurrencyChange = (idx: number, newCurrency: string) => {
      // Update Main Expense Currency + Details Currency
      const expense = data.tax.expenses[idx];
      let newRate = 1;
      if (newCurrency === 'USD') newRate = data.tax.rateUSD || 0.85;
      else if (newCurrency === 'EUR') newRate = data.tax.rateEUR || 0.94;

      const type = expense.cat === 'Kindesunterhalt' ? 'childDetails' : 'alimonyDetails';
      const details = expense[type as 'childDetails' | 'alimonyDetails'];

      updateSpecialExpenseFull(idx, { 
          currency: newCurrency, 
          rate: newRate,
          [type]: { ...details, currency: newCurrency }
      });
  };

  const removeExpense = (index: number) => {
    if (confirm("Diesen Eintrag wirklich löschen?")) {
        const newExpenses = data.tax.expenses.filter((_, i) => i !== index);
        onUpdate({ ...data, tax: { ...data.tax, expenses: newExpenses } });
    }
  };

  const handleReceiptUpload = async (index: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const id = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    await DBService.saveFile(id, file);
    const newExpenses = [...data.tax.expenses];
    newExpenses[index].receipts = [...(newExpenses[index].receipts || []), id];
    onUpdate({ ...data, tax: { ...data.tax, expenses: newExpenses } });
  };

  const getConvertedCHF = (exp: TaxExpense) => {
    // If rate is explicitly stored on expense, use it, otherwise use global default
    const rate = exp.rate || (exp.currency === 'USD' ? (data.tax.rateUSD || 0.85) : exp.currency === 'EUR' ? (data.tax.rateEUR || 0.94) : 1);
    return exp.amount * rate;
  };
  
  const getRateDisplay = (exp: TaxExpense) => {
     if (exp.currency === 'CHF') return 1;
     return exp.rate || (exp.currency === 'USD' ? (data.tax.rateUSD || 0.85) : (data.tax.rateEUR || 0.94));
  };

  const getIBKRCashCHF = () => {
    const portfolio = data.portfolios[data.currentPortfolioId];
    if (!portfolio || !portfolio.years[selectedYear]) return 0;
    const yearData = portfolio.years[selectedYear];
    const usdToChf = yearData.exchangeRates['USD_CHF'] || 0.88;
    const eurToUsd = yearData.exchangeRates['EUR_USD'] || 1.07;
    const cashList = Object.entries(yearData.cash || {});
    const totalUSD = cashList.reduce((sum, [curr, amt]) => {
      let valUSD = 0;
      if (curr === 'USD') valUSD = amt;
      else if (curr === 'CHF') valUSD = amt / usdToChf;
      else if (curr === 'EUR') valUSD = amt * eurToUsd;
      else {
        const dynamicRate = yearData.exchangeRates[`${curr}_USD`];
        valUSD = dynamicRate ? amt * dynamicRate : amt;
      }
      return sum + valUSD;
    }, 0);
    return totalUSD * usdToChf;
  };

  const ibkrCashCHF = getIBKRCashCHF();
  const currentYearBalance = data.tax.balances[selectedYear] || { ubs: 0, comdirect: 0, comdirectEUR: 0, ibkr: 0 };
  
  const getSalarySummary = () => {
    const yearSalary = Object.values(data.salary[selectedYear] || {}) as SalaryEntry[];
    return {
      brutto: yearSalary.reduce((s, e) => s + (Number(e.brutto) || 0), 0),
      qst: yearSalary.reduce((s, e) => s + (Number(e.quellensteuer) || 0), 0),
      netto: yearSalary.reduce((s, e) => s + (Number(e.netto) || 0), 0),
    };
  };

  const salSum = getSalarySummary();
  const yearExpenses = data.tax.expenses.filter(e => e.year === selectedYear);
  const totalRelevantExpenses = yearExpenses.filter(e => e.taxRelevant).reduce((s, e) => s + getConvertedCHF(e), 0);

  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const currentYearNum = new Date().getFullYear();
  const availableYears = Array.from({ length: Math.max(2026 - 2023 + 1, currentYearNum - 2023 + 2) }, (_, i) => (2023 + i).toString());

  // --- CUSTOM BANK ACCOUNT FUNCTIONS ---
  const addCustomAccount = () => {
      const newAcc: CustomBankAccount = { 
          id: `acc_${Date.now()}`, 
          name: 'Neue Bank', 
          amount: 0, 
          currency: 'CHF',
          includeInTaxReport: true
      };
      
      const newBalances = { ...data.tax.balances };
      if (!newBalances[selectedYear]) newBalances[selectedYear] = { ubs: 0, comdirect: 0, ibkr: 0, customAccounts: [] };
      if (!newBalances[selectedYear].customAccounts) newBalances[selectedYear].customAccounts = [];
      
      newBalances[selectedYear].customAccounts = [...(newBalances[selectedYear].customAccounts || []), newAcc];
      onUpdate({ ...data, tax: { ...data.tax, balances: newBalances } });
  };

  const updateCustomAccount = (id: string, field: keyof CustomBankAccount, value: any) => {
      const newBalances = { ...data.tax.balances };
      const accounts = newBalances[selectedYear]?.customAccounts || [];
      const updated = accounts.map(acc => acc.id === id ? { ...acc, [field]: value } : acc);
      newBalances[selectedYear].customAccounts = updated;
      onUpdate({ ...data, tax: { ...data.tax, balances: newBalances } });
  };

  const removeCustomAccount = (id: string) => {
      if(confirm("Bankkonto wirklich entfernen?")) {
          const newBalances = { ...data.tax.balances };
          const accounts = newBalances[selectedYear]?.customAccounts || [];
          newBalances[selectedYear].customAccounts = accounts.filter(acc => acc.id !== id);
          onUpdate({ ...data, tax: { ...data.tax, balances: newBalances } });
      }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* Sub Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex p-1 gap-1 flex-wrap">
          {[
            { id: 'personal', label: 'Persönlich', icon: User },
            { id: 'expenses', label: 'Abzüge', icon: Receipt },
            { id: 'balances', label: 'Vermögen', icon: Landmark },
            { id: 'message', label: 'Nachricht', icon: MessageSquare },
            { id: 'summary', label: 'Abschluss', icon: Calculator },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeSubTab === tab.id 
                ? 'bg-[#16325c] text-white shadow-lg' 
                : 'text-gray-400 hover:bg-gray-50'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 px-4">
          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Steuerjahr:</label>
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="text-xs font-black text-blue-600 outline-none bg-transparent cursor-pointer">
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {activeSubTab === 'message' && (
        <div className="animate-in fade-in duration-300">
           <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <div className="flex items-center gap-3 mb-2">
                 <div className="p-3 bg-amber-50 text-amber-600 rounded-xl"><MessageSquare size={20}/></div>
                 <div>
                    <h3 className="font-black text-gray-800 tracking-tight">Nachricht an das Steueramt</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Wird auf eine separate Seite im PDF gedruckt</p>
                 </div>
              </div>
              <textarea value={data.tax.messageToAuthorities?.[selectedYear] || ''} onChange={(e) => updateMessage(e.target.value)} placeholder="Sehr geehrte Damen und Herren..." className="w-full h-96 p-6 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-4 focus:ring-amber-50 text-sm leading-relaxed text-gray-700 resize-none font-medium"/>
           </div>
        </div>
      )}

      {/* Expenses Tab */}
      {activeSubTab === 'expenses' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between bg-white p-6 rounded-2xl border border-gray-100 shadow-sm gap-4">
            <div className="flex items-center gap-3">
               <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Receipt size={20}/></div>
               <div>
                  <h3 className="font-black text-gray-800 tracking-tight">Abzüge {selectedYear}</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Beruf, Vers. & Alimente</p>
               </div>
            </div>
            <div className="flex gap-2">
                {/* GEMINI SMART SCAN BUTTON */}
                <label className={`px-6 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:shadow-lg hover:scale-105 transition-all cursor-pointer ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
                    {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} 
                    Smart Scan (AI)
                    <input type="file" ref={smartScanInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleSmartScan} />
                </label>
                
                <button onClick={addExpense} className="px-6 py-3 bg-[#16325c] text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-800 transition-all shadow-xl shadow-blue-900/10">
                   <Plus size={16} /> Manuell
                </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
             <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[1000px]">
                    <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-4">Beschreibung</th>
                        <th className="px-6 py-4">Kategorie</th>
                        <th className="px-6 py-4 text-center">Relevant?</th>
                        <th className="px-6 py-4 text-right">Betrag</th>
                        <th className="px-6 py-4 text-center">Währ.</th>
                        <th className="px-6 py-4 text-right text-blue-600">Wert (CHF)</th>
                        <th className="px-6 py-4 text-center">Beleg</th>
                        <th className="px-6 py-4 text-right">Löschen</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                    {yearExpenses.map((exp, idx) => {
                        const realIdx = data.tax.expenses.indexOf(exp);
                        const isSpecial = exp.cat === 'Alimente' || exp.cat === 'Kindesunterhalt';
                        const isLockedRelevant = isSpecial;
                        const hasReceipts = (exp.receipts || []).length > 0;
                        const currentRate = getRateDisplay(exp);

                        return (
                            <tr key={realIdx} className={`hover:bg-gray-50/50 transition-colors ${!exp.taxRelevant ? 'opacity-50' : ''}`}>
                            <td className="px-6 py-4 flex items-center gap-2">
                                <input type="text" value={exp.desc} onChange={(e) => updateExpense(realIdx, 'desc', e.target.value)} className="w-full bg-transparent font-bold text-gray-800 outline-none text-sm placeholder-gray-300" placeholder="Belegname..." style={{ colorScheme: 'light' }}/>
                                {isSpecial && (
                                    <button onClick={() => setSpecialExpenseModalIdx(realIdx)} className="p-1.5 text-blue-500 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1">
                                        <Settings size={14} /> <span className="text-[10px] font-bold">Details</span>
                                    </button>
                                )}
                            </td>
                            <td className="px-6 py-4">
                                <select value={exp.cat} onChange={(e) => updateExpense(realIdx, 'cat', e.target.value)} className="bg-transparent text-[10px] font-black uppercase text-blue-600 outline-none cursor-pointer max-w-[150px]">
                                    <option value="Berufsauslagen">Berufsauslagen</option>
                                    <option value="Weiterbildung">Weiterbildung</option>
                                    <option value="Krankenkassenprämien">Krankenkassenprämien</option>
                                    <option value="Versicherung">Versicherung</option>
                                    <option value="Alimente">Alimente</option>
                                    <option value="Kindesunterhalt">Kindesunterhalt</option>
                                    <option value="Hardware/Büro">Hardware / Büro</option>
                                    <option value="Sonstiges">Sonstiges</option>
                                </select>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <input type="checkbox" checked={exp.taxRelevant} disabled={isLockedRelevant} onChange={(e) => updateExpense(realIdx, 'taxRelevant', e.target.checked)} className={`w-4 h-4 rounded text-blue-600 focus:ring-blue-500 ${isLockedRelevant ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}/>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <input type="number" value={exp.amount} onChange={(e) => updateExpense(realIdx, 'amount', parseFloat(e.target.value) || 0)} className="w-24 text-right bg-transparent font-black text-gray-800 outline-none" style={{ colorScheme: 'light' }}/>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <select 
                                    value={exp.currency} 
                                    onChange={(e) => updateExpense(realIdx, 'currency', e.target.value)}
                                    className="bg-transparent text-xs font-bold text-gray-600 outline-none cursor-pointer"
                                >
                                    <option value="CHF">CHF</option>
                                    <option value="EUR">EUR</option>
                                    <option value="USD">USD</option>
                                </select>
                                {exp.currency !== 'CHF' && (
                                    <div className="text-[9px] text-gray-400 mt-1 whitespace-nowrap">
                                        Kurs: {currentRate.toFixed(2)}
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-4 text-right">
                                <div className="font-black text-blue-600">{getConvertedCHF(exp).toLocaleString('de-CH', { minimumFractionDigits: 2 })}</div>
                                {exp.currency !== 'CHF' && (
                                    <div className="text-[9px] text-gray-400 mt-1">CHF</div>
                                )}
                            </td>
                            <td className="px-6 py-4 text-center">
                                <label className={`cursor-pointer transition-all ${hasReceipts ? 'text-green-500' : 'text-gray-400 hover:text-blue-500'}`}>
                                    <Paperclip size={18} />
                                    <input type="file" className="hidden" onChange={(e) => handleReceiptUpload(realIdx, e.target.files)} />
                                </label>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <button onClick={() => removeExpense(realIdx)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                            </td>
                            </tr>
                        );
                    })}
                    {yearExpenses.length === 0 && (
                        <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-300 font-bold italic text-xs uppercase">Keine Abzüge für {selectedYear} erfasst</td></tr>
                    )}
                    </tbody>
                </table>
             </div>
          </div>
        </div>
      )}

      {/* Special Expense Modal */}
      {specialExpenseModalIdx !== null && data.tax.expenses[specialExpenseModalIdx] && (
           <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
           <div className="bg-white w-[95vw] md:w-full max-w-5xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300 border border-gray-100 relative">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Baby size={24} /></div>
                    <div>
                        <h3 className="text-xl font-black text-gray-800">{data.tax.expenses[specialExpenseModalIdx].cat}</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Detaillierte Erfassung</p>
                    </div>
                </div>
                <button onClick={() => setSpecialExpenseModalIdx(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
              </div>
              
              <div className="flex-1 overflow-y-scroll p-4 md:p-8 space-y-8 bg-white overscroll-contain">
                 {/* CHILD SUPPORT FORM */}
                 {data.tax.expenses[specialExpenseModalIdx].cat === 'Kindesunterhalt' && data.tax.expenses[specialExpenseModalIdx].childDetails && (
                     <div className="space-y-8">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                             <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                                 <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Baby size={16}/> Kind & Ausbildung</h4>
                                 <div className="space-y-4">
                                     <div className="grid grid-cols-2 gap-4">
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Vorname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.vorname} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, vorname: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Nachname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.nachname} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, nachname: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                     </div>
                                     <div className="grid grid-cols-2 gap-4">
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Geburtsdatum</label><input type="date" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.geburtsdatum} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, geburtsdatum: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Ausbildungsende</label><input type="date" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.ausbildungsende || ''} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, ausbildungsende: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                     </div>
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Schule / Ausbildung</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.schule_ausbildung} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, schule_ausbildung: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                 </div>
                             </div>
                             <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                                 <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Wallet size={16}/> Zahlungsempfänger</h4>
                                 <div className="space-y-4">
                                     <div className="grid grid-cols-2 gap-4">
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Vorname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.empfaenger_vorname} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, empfaenger_vorname: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                         <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Nachname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.empfaenger_name} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, empfaenger_name: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                     </div>
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Adresse (PLZ/Ort)</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.empfaenger_plz_ort} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'childDetails', {...data.tax.expenses[specialExpenseModalIdx].childDetails, empfaenger_plz_ort: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                 </div>
                             </div>
                         </div>
                         {/* Payment Schedule */}
                         <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                             <div className="flex justify-between items-center mb-4">
                                 <h4 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2"><CalendarCheck size={16} className="text-blue-500"/> Zahlungsplan</h4>
                                 <div className="flex gap-2">
                                     <button onClick={() => toggleFrequency(specialExpenseModalIdx, 'childDetails', 'fix')} className={`px-3 py-1 rounded-lg text-xs font-bold ${data.tax.expenses[specialExpenseModalIdx].childDetails!.paymentFrequency === 'fix' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>Fix (x12)</button>
                                     <button onClick={() => toggleFrequency(specialExpenseModalIdx, 'childDetails', 'individuell')} className={`px-3 py-1 rounded-lg text-xs font-bold ${data.tax.expenses[specialExpenseModalIdx].childDetails!.paymentFrequency === 'individuell' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>Variabel</button>
                                 </div>
                             </div>
                             {data.tax.expenses[specialExpenseModalIdx].childDetails!.paymentFrequency === 'fix' ? (
                                 <div className="flex items-center gap-4">
                                     <div className="flex-1 space-y-1">
                                         <label className="text-[10px] font-bold text-gray-400 uppercase">Monatlicher Fixbetrag</label>
                                         <input type="number" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.monthlyAmounts[0]} onChange={(e) => handleFixAmountChange(specialExpenseModalIdx, 'childDetails', parseFloat(e.target.value) || 0)} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xl font-black outline-none focus:ring-4 focus:ring-blue-50"/>
                                     </div>
                                     <div className="flex-1 space-y-1">
                                         <label className="text-[10px] font-bold text-gray-400 uppercase">Währung</label>
                                         <select value={data.tax.expenses[specialExpenseModalIdx].currency} onChange={(e) => handleCurrencyChange(specialExpenseModalIdx, e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xl font-bold outline-none"><option value="CHF">CHF</option><option value="EUR">EUR</option><option value="USD">USD</option></select>
                                     </div>
                                     <div className="w-32 text-right">
                                         <span className="block text-2xl font-black text-blue-600">{data.tax.expenses[specialExpenseModalIdx].amount.toLocaleString()}</span>
                                         <span className="text-[10px] font-bold text-gray-400 uppercase">Total Jahr</span>
                                     </div>
                                 </div>
                             ) : (
                                 <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                                     {months.map((m, i) => (
                                         <div key={m} className="space-y-1">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase">{m}</label>
                                             <input type="number" value={data.tax.expenses[specialExpenseModalIdx].childDetails!.monthlyAmounts[i]} onChange={(e) => {
                                                 const newAmts = [...data.tax.expenses[specialExpenseModalIdx].childDetails!.monthlyAmounts];
                                                 newAmts[i] = parseFloat(e.target.value) || 0;
                                                 handleMonthlyAmountsChange(specialExpenseModalIdx, 'childDetails', newAmts);
                                             }} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-center outline-none focus:ring-2 focus:ring-blue-100"/>
                                         </div>
                                     ))}
                                 </div>
                             )}
                         </div>
                     </div>
                 )}

                 {/* ALIMONY FORM */}
                 {data.tax.expenses[specialExpenseModalIdx].cat === 'Alimente' && data.tax.expenses[specialExpenseModalIdx].alimonyDetails && (
                     <div className="space-y-8">
                         <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                             <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Heart size={16}/> Empfänger & Details</h4>
                             <div className="space-y-4">
                                 <div className="grid grid-cols-2 gap-4">
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Vorname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.empfaenger_vorname} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'alimonyDetails', {...data.tax.expenses[specialExpenseModalIdx].alimonyDetails, empfaenger_vorname: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Nachname</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.empfaenger_name} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'alimonyDetails', {...data.tax.expenses[specialExpenseModalIdx].alimonyDetails, empfaenger_name: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                 </div>
                                 <div className="grid grid-cols-2 gap-4">
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Adresse (PLZ/Ort)</label><input type="text" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.empfaenger_plz_ort} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'alimonyDetails', {...data.tax.expenses[specialExpenseModalIdx].alimonyDetails, empfaenger_plz_ort: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                     <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase">Getrennt seit</label><input type="date" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.getrennt_seit} onChange={(e) => handleDetailChange(specialExpenseModalIdx, 'alimonyDetails', {...data.tax.expenses[specialExpenseModalIdx].alimonyDetails, getrennt_seit: e.target.value})} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold outline-none"/></div>
                                 </div>
                             </div>
                         </div>
                         {/* Payment Schedule (Identical logic to child support but distinct type) */}
                         <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                             <div className="flex justify-between items-center mb-4">
                                 <h4 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2"><CalendarCheck size={16} className="text-blue-500"/> Zahlungsplan</h4>
                                 <div className="flex gap-2">
                                     <button onClick={() => toggleFrequency(specialExpenseModalIdx, 'alimonyDetails', 'fix')} className={`px-3 py-1 rounded-lg text-xs font-bold ${data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.paymentFrequency === 'fix' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>Fix (x12)</button>
                                     <button onClick={() => toggleFrequency(specialExpenseModalIdx, 'alimonyDetails', 'individuell')} className={`px-3 py-1 rounded-lg text-xs font-bold ${data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.paymentFrequency === 'individuell' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>Variabel</button>
                                 </div>
                             </div>
                             {data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.paymentFrequency === 'fix' ? (
                                 <div className="flex items-center gap-4">
                                     <div className="flex-1 space-y-1">
                                         <label className="text-[10px] font-bold text-gray-400 uppercase">Monatlicher Fixbetrag</label>
                                         <input type="number" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.monthlyAmounts[0]} onChange={(e) => handleFixAmountChange(specialExpenseModalIdx, 'alimonyDetails', parseFloat(e.target.value) || 0)} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xl font-black outline-none focus:ring-4 focus:ring-blue-50"/>
                                     </div>
                                     <div className="flex-1 space-y-1">
                                         <label className="text-[10px] font-bold text-gray-400 uppercase">Währung</label>
                                         <select value={data.tax.expenses[specialExpenseModalIdx].currency} onChange={(e) => handleCurrencyChange(specialExpenseModalIdx, e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xl font-bold outline-none"><option value="CHF">CHF</option><option value="EUR">EUR</option><option value="USD">USD</option></select>
                                     </div>
                                     <div className="w-32 text-right">
                                         <span className="block text-2xl font-black text-blue-600">{data.tax.expenses[specialExpenseModalIdx].amount.toLocaleString()}</span>
                                         <span className="text-[10px] font-bold text-gray-400 uppercase">Total Jahr</span>
                                     </div>
                                 </div>
                             ) : (
                                 <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                                     {months.map((m, i) => (
                                         <div key={m} className="space-y-1">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase">{m}</label>
                                             <input type="number" value={data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.monthlyAmounts[i]} onChange={(e) => {
                                                 const newAmts = [...data.tax.expenses[specialExpenseModalIdx].alimonyDetails!.monthlyAmounts];
                                                 newAmts[i] = parseFloat(e.target.value) || 0;
                                                 handleMonthlyAmountsChange(specialExpenseModalIdx, 'alimonyDetails', newAmts);
                                             }} className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-center outline-none focus:ring-2 focus:ring-blue-100"/>
                                         </div>
                                     ))}
                                 </div>
                             )}
                         </div>
                     </div>
                 )}
              </div>
              <div className="p-6 border-t border-gray-100 bg-white flex justify-end gap-4 shrink-0">
                 <button onClick={() => setSpecialExpenseModalIdx(null)} className="px-10 py-4 bg-[#16325c] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-blue-800 transition-all shadow-xl shadow-blue-900/20">
                     Speichern & Schliessen
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Summary Tab */}
      {activeSubTab === 'summary' && (
        <div className="space-y-8 animate-in fade-in duration-500">
           {/* ... Summary Content ... */}
           <div className="flex flex-wrap justify-end pt-8 border-t border-gray-200 gap-4">
              <button onClick={handleExportSecuritiesCSV} className="px-8 py-5 bg-green-50 text-green-700 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-green-100 transition-all flex items-center gap-2 border border-green-100"><FileSpreadsheet size={18} /> Wertschriften CSV</button>
              <button onClick={handleExportXml} className="px-8 py-5 bg-gray-100 text-gray-700 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-gray-200 transition-all flex items-center gap-2"><FileCode size={18} /> Steuerdaten XML</button>
              <button onClick={() => setShowExportModal(true)} className="px-12 py-5 bg-blue-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl shadow-2xl shadow-blue-500/30 hover:scale-105 transition-transform flex items-center gap-3"><FileDown size={20} /> PDF Report</button>
           </div>
        </div>
      )}

      {/* Personal Tab */}
      {activeSubTab === 'personal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-bold text-gray-700 uppercase tracking-tight text-xs flex items-center gap-2"><User size={16} className="text-blue-500" /> Steuerpflichtiger</h3>
            <div className="space-y-4">
               <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Name / Vorname</label><input type="text" value={data.tax.personal.name} onChange={(e) => updatePersonal('name', e.target.value)} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none"/></div>
               <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">PID-Nummer</label><input type="text" value={data.tax.personal.id} onChange={(e) => updatePersonal('id', e.target.value)} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none"/></div>
               <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Adresse</label><input type="text" value={data.tax.personal.address} onChange={(e) => updatePersonal('address', e.target.value)} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none"/></div>
               <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1 space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">PLZ</label><input type="text" value={data.tax.personal.zip} onChange={(e) => updatePersonal('zip', e.target.value)} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none"/></div>
                  <div className="col-span-2 space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Ort</label><input type="text" value={data.tax.personal.city} onChange={(e) => updatePersonal('city', e.target.value)} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none"/></div>
               </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
             <div className="flex justify-between items-center">
                 <h3 className="font-bold text-gray-700 uppercase tracking-tight text-xs flex items-center gap-2"><Database size={16} className="text-gray-500"/> Legacy Import</h3>
                 <label className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded cursor-pointer font-bold text-gray-500">
                    JSON Laden
                    <input type="file" ref={legacyImportRef} className="hidden" accept=".json" onChange={handleLegacyJsonImport} />
                 </label>
             </div>
             <p className="text-xs text-gray-400">Importiere alte Daten aus v2/v3 JSON Backups hier.</p>
          </div>
        </div>
      )}
      
      {/* BALANCES TAB - UPDATED WITH DYNAMIC ACCOUNTS */}
      {activeSubTab === 'balances' && (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Standard UBS */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
                    <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2"><Landmark size={16} className="text-blue-500" /><h3 className="font-bold text-gray-700 uppercase tracking-tight text-[10px]">UBS (Standard)</h3></div>
                    <button onClick={() => {
                        const newBalances = { ...data.tax.balances };
                        if (!newBalances[selectedYear]) newBalances[selectedYear] = { ubs: 0, comdirect: 0, ibkr: 0 };
                        newBalances[selectedYear].ubs = 0;
                        onUpdate({...data, tax: {...data.tax, balances: newBalances}});
                    }} className="text-gray-300 hover:text-red-500 transition-colors" title="Wert löschen (Reset)"><Trash2 size={14}/></button>
                    </div>
                    <div className="p-6">
                    <input type="number" value={currentYearBalance.ubs || 0} onChange={(e) => {
                        const newBalances = { ...data.tax.balances };
                        if (!newBalances[selectedYear]) newBalances[selectedYear] = { ubs: 0, comdirect: 0, ibkr: 0 };
                        newBalances[selectedYear].ubs = parseFloat(e.target.value) || 0;
                        onUpdate({...data, tax: {...data.tax, balances: newBalances}});
                    }} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-lg font-black text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"/>
                    </div>
                </div>
                
                {/* Standard Comdirect */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
                    <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2"><CreditCard size={16} className="text-blue-500" /><h3 className="font-bold text-gray-700 uppercase tracking-tight text-[10px]">Comdirect (Standard)</h3></div>
                    <button onClick={() => {
                        const newBalances = { ...data.tax.balances };
                        if (!newBalances[selectedYear]) newBalances[selectedYear] = { ubs: 0, comdirect: 0, ibkr: 0 };
                        newBalances[selectedYear].comdirectEUR = 0;
                        onUpdate({...data, tax: {...data.tax, balances: newBalances}});
                    }} className="text-gray-300 hover:text-red-500 transition-colors" title="Wert löschen (Reset)"><Trash2 size={14}/></button>
                    </div>
                    <div className="p-6 space-y-3">
                    <div className="flex items-center gap-2">
                        <Euro size={16} className="text-gray-400" />
                        <input type="number" value={currentYearBalance.comdirectEUR || 0} onChange={(e) => {
                            const newBalances = { ...data.tax.balances };
                            if (!newBalances[selectedYear]) newBalances[selectedYear] = { ubs: 0, comdirect: 0, ibkr: 0 };
                            newBalances[selectedYear].comdirectEUR = parseFloat(e.target.value) || 0;
                            onUpdate({...data, tax: {...data.tax, balances: newBalances}});
                        }} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-lg font-black text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"/>
                    </div>
                    <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">In CHF:</span>
                        <span className="font-black text-blue-600">{((currentYearBalance.comdirectEUR || 0) * (data.tax.rateEUR || 0.94)).toLocaleString('de-CH', { minimumFractionDigits: 2 })}</span>
                    </div>
                    </div>
                </div>

                {/* Auto IBKR */}
                <div className="bg-[#16325c] rounded-2xl shadow-xl overflow-hidden text-white">
                    <div className="p-4 bg-white/10 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2"><Wallet size={16} className="text-blue-300" /><h3 className="font-bold text-blue-100 uppercase tracking-tight text-[10px]">IBKR Cash (Auto)</h3></div>
                    </div>
                    <div className="p-6">
                    <div className="text-2xl font-black">{ibkrCashCHF.toLocaleString('de-CH', { minimumFractionDigits: 2 })} <span className="text-xs opacity-50">CHF</span></div>
                    <p className="text-[9px] text-blue-300/60 mt-1 italic font-bold">Synchronisiert von Wertpapiere-Tab</p>
                    </div>
                </div>
            </div>

            {/* CUSTOM ACCOUNTS SECTION */}
            <div className="pt-6 border-t border-gray-200">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Weitere Bankbeziehungen</h4>
                    <button onClick={addCustomAccount} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-2">
                        <Plus size={14}/> Konto hinzufügen
                    </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {(currentYearBalance.customAccounts || []).map((acc) => (
                        <div key={acc.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden group hover:border-blue-300 transition-colors">
                            <div className="p-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                                <input 
                                    type="text" 
                                    value={acc.name} 
                                    onChange={(e) => updateCustomAccount(acc.id, 'name', e.target.value)} 
                                    className="bg-transparent font-bold text-xs text-gray-700 uppercase tracking-tight outline-none w-full"
                                    placeholder="Bank Name"
                                />
                                <button onClick={() => removeCustomAccount(acc.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                                    <Trash2 size={14}/>
                                </button>
                            </div>
                            <div className="p-4 space-y-2">
                                <div className="flex gap-2">
                                    <input 
                                        type="number" 
                                        value={acc.amount} 
                                        onChange={(e) => updateCustomAccount(acc.id, 'amount', parseFloat(e.target.value) || 0)} 
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg font-black text-gray-800 outline-none focus:ring-2 focus:ring-blue-50"
                                        placeholder="0.00"
                                    />
                                    <select 
                                        value={acc.currency} 
                                        onChange={(e) => updateCustomAccount(acc.id, 'currency', e.target.value)}
                                        className="bg-gray-50 border border-gray-200 rounded-lg px-2 text-xs font-bold outline-none cursor-pointer"
                                    >
                                        <option value="CHF">CHF</option>
                                        <option value="EUR">EUR</option>
                                        <option value="USD">USD</option>
                                    </select>
                                </div>
                                <div className="flex justify-between items-center">
                                    {acc.currency !== 'CHF' ? (
                                        <p className="text-[9px] text-gray-400 font-bold">
                                            ~ {(acc.amount * (acc.currency === 'USD' ? (data.tax.rateUSD || 0.85) : (data.tax.rateEUR || 0.94))).toFixed(2)} CHF
                                        </p>
                                    ) : <div></div>}
                                    
                                    <div className="flex items-center gap-1.5" title="Auf Steuerreport (PDF) anzeigen?">
                                        <input 
                                            type="checkbox" 
                                            checked={acc.includeInTaxReport !== false} 
                                            onChange={(e) => updateCustomAccount(acc.id, 'includeInTaxReport', e.target.checked)}
                                            className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                        />
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Report</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {(currentYearBalance.customAccounts || []).length === 0 && (
                        <div className="col-span-1 md:col-span-3 p-8 border-2 border-dashed border-gray-100 rounded-2xl flex flex-col items-center justify-center text-gray-300 gap-2">
                            <Landmark size={24} className="opacity-20"/>
                            <p className="text-xs font-bold uppercase">Keine weiteren Konten</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* EXPORT OPTIONS MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <FileDown size={18} className="text-blue-600"/>
                PDF Report Optionen
              </h3>
              <button onClick={() => setShowExportModal(false)}><X size={20} className="text-gray-400 hover:text-gray-600"/></button>
            </div>
            <div className="p-6 space-y-3">
              {Object.entries({
                  includePersonal: 'Deckblatt & Personalien',
                  includeMessage: 'Nachricht an Behörde',
                  includeSalary: 'Lohnausweis Zusammenzug',
                  includeAssets: 'Wertschriften & Vermögen',
                  includeExpenses: 'Berufskosten & Abzüge',
                  includeTradingProof: 'Trading Journal (Nachweis)',
                  includeReceipts: 'Belege & Bilder Anhang'
              }).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                    <input 
                      type="checkbox" 
                      checked={exportOpts[key as keyof PdfExportOptions]} 
                      onChange={(e) => setExportOpts({...exportOpts, [key as keyof PdfExportOptions]: e.target.checked})}
                      className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                  </label>
              ))}
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button 
                onClick={handleGeneratePdf}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 shadow-lg flex items-center gap-2"
              >
                <FileDown size={16} /> Generieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaxView;
