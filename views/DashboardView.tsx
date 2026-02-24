
import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, 
  Wallet, 
  Landmark, 
  PiggyBank, 
  ArrowUpRight,
  PieChart as PieIcon,
  Activity,
  CreditCard,
  Target,
  Plus,
  X,
  Check,
  Pencil,
  Trash2,
  CalendarCheck
} from 'lucide-react';
import { AppData, PortfolioYear, SavingsGoal } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  onNavigate: (tab: string) => void;
}

const DashboardView: React.FC<Props> = ({ data, onUpdate, onNavigate }) => {
  const currentYear = new Date().getFullYear().toString();

  // GOAL STATE
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState<Partial<SavingsGoal>>({});

  // 1. Calculate Net Worth (AGGREGATED FROM ALL PORTFOLIOS)
  // We use useMemo to efficiently sum up values from ALL portfolios
  const { totalSecuritiesCHF, totalIBKRCashCHF } = useMemo(() => {
      let sec = 0;
      let cash = 0;

      Object.values(data.portfolios).forEach(portfolio => {
          const portYearData = portfolio.years[currentYear];
          if (!portYearData) return;

          const rates = portYearData.exchangeRates || {};
          const usdToChf = rates['USD_CHF'] || 0.88;
          const eurToUsd = rates['EUR_USD'] || 1.07;

          // 1. Securities (Market Value is in USD Base)
          const valUSD = portYearData.summary?.totalValue || 0;
          sec += valUSD * usdToChf;

          // 2. Cash (Convert all to CHF)
          if (portYearData.cash) {
              Object.entries(portYearData.cash).forEach(([curr, amt]) => {
                  let valUSD = 0;
                  if (curr === 'USD') valUSD = amt;
                  else if (curr === 'CHF') valUSD = amt / usdToChf;
                  else if (curr === 'EUR') valUSD = amt * eurToUsd;
                  else valUSD = amt * (rates[`${curr}_USD`] || 0);
                  
                  cash += valUSD * usdToChf;
              });
          }
      });

      return { totalSecuritiesCHF: sec, totalIBKRCashCHF: cash };
  }, [data.portfolios, currentYear]);
  
  // Bank Balances Calculation (Manual Accounts)
  const balances = data.tax.balances[currentYear] || { ubs: 0, comdirect: 0, ibkr: 0 };
  let bankTotal = (balances.ubs || 0) + (balances.comdirect || 0) + ((balances.comdirectEUR || 0) * (data.tax.rateEUR || 0.94));
  
  // Add Custom Accounts
  if (balances.customAccounts) {
      balances.customAccounts.forEach(acc => {
          let val = acc.amount;
          if (acc.currency === 'USD') val = acc.amount * (data.tax.rateUSD || 0.85);
          else if (acc.currency === 'EUR') val = acc.amount * (data.tax.rateEUR || 0.94);
          bankTotal += val;
      });
  }
  
  // Real Total Assets (All Portfolios Securities + All Portfolios Cash + External Banks)
  const realTotalAssets = totalSecuritiesCHF + totalIBKRCashCHF + bankTotal;

  // 2. Income Calculation
  const salaryData = Object.values(data.salary[currentYear] || {});
  const totalNetIncome = salaryData.reduce((acc, entry) => acc + (entry.auszahlung || 0), 0);
  const totalGrossIncome = salaryData.reduce((acc, entry) => acc + (entry.brutto || 0), 0);

  // 3. EXPENSES CALCULATION (YTD)
  const today = new Date();
  const currentMonthIndex = today.getMonth(); // 0-11

  // A. Daily Expenses Sum
  const dailyExpList = data.dailyExpenses[currentYear] || [];
  const dailyExpTotal = dailyExpList.reduce((sum, exp) => sum + (exp.amount * exp.rate), 0);

  // B. Recurring Expenses Sum & FORECAST
  let recurringExpTotal = 0;
  let remainingYearFixCosts = 0;

  // Helper to get exchange rate for recurring expenses
  const getExchangeRate = (currency: string, year: string): number => {
      if (currency === 'CHF') return 1;
      if (currency === 'USD') return data.tax.rateUSD || 0.85;
      if (currency === 'EUR') return data.tax.rateEUR || 0.94;
      return 1;
  };

  // Helper for Recurring Amount
  const getRecurringAmountForMonth = (rec: any, yearStr: string, month: number) => {
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
      const sortedHistory = [...(rec.history || [])].sort((a:any, b:any) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime());
      const activePrice = sortedHistory.find((h:any) => new Date(h.validFrom) <= targetDate);
      
      if (!activePrice) return null; 

      const rate = getExchangeRate(activePrice.currency, yearStr);
      return { amount: activePrice.amount, currency: activePrice.currency, rate };
  };

  if (data.recurringExpenses) {
      for(let m = 0; m < 12; m++) {
          data.recurringExpenses.forEach(rec => {
             let isActive = false;
             if (rec.frequency === 'M') isActive = true;
             else if (rec.frequency === 'Q') {
                 const startM = rec.paymentMonth || 1;
                 const diff = m - (startM - 1);
                 if (diff >= 0 && diff % 3 === 0) isActive = true;
             }
             else if (rec.frequency === 'Y') {
                 if (m + 1 === (rec.paymentMonth || 1)) isActive = true;
             }

             if(isActive) {
                 const activePrice = getRecurringAmountForMonth(rec, currentYear, m + 1);
                 
                 if(activePrice) {
                     const cost = activePrice.amount * activePrice.rate;
                     if (m <= currentMonthIndex) {
                         recurringExpTotal += cost;
                     } else {
                         remainingYearFixCosts += cost;
                     }
                 }
             }
          });
      }
  }

  const totalExpensesYTD = dailyExpTotal + recurringExpTotal;
  const savingsRate = totalNetIncome > 0 
      ? Math.round(((totalNetIncome - totalExpensesYTD) / totalNetIncome) * 100) 
      : 0;

  // 4. Trading Performance YTD & Win Rate Calculation
  const tradesYTD = Object.entries(data.trades).filter(([date]) => date.startsWith(currentYear));
  
  const allSingleTrades = tradesYTD.flatMap(([_, day]) => day.trades);
  const winRate = allSingleTrades.length > 0 
      ? ((allSingleTrades.filter(t => t.pnl > 0).length / allSingleTrades.length) * 100).toFixed(1) 
      : '0.0';

  // Chart Data: Allocation (Using Aggregated Values)
  const allocationData = [
      { name: 'Aktien/Fonds', value: Math.round(totalSecuritiesCHF), color: '#3b82f6' },
      { name: 'Cash (IBKR)', value: Math.round(totalIBKRCashCHF), color: '#8b5cf6' },
      { name: 'Banken (Privat)', value: Math.round(bankTotal), color: '#10b981' },
  ].filter(d => d.value > 0);

  // Chart Data: Monthly Income
  const incomeChartData = ['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => {
      const entry = data.salary[currentYear]?.[m];
      return {
          month: m,
          net: entry?.auszahlung || 0
      };
  });

  // 5. TAX OPTIMIZATION / SAULE 3A TRACKING
  const pillar3aLimit = 7258; // 2025 Limit approx.
  const pillar3aInvested = data.tax.expenses
      .filter(e => e.year === currentYear)
      .filter(e => {
          const text = (e.desc + ' ' + e.cat).toLowerCase();
          return text.includes('3a') || text.includes('vorsorge') || text.includes('viac') || text.includes('franke');
      })
      .reduce((sum, e) => {
          // Convert if needed
          let val = e.amount;
          if (e.currency === 'USD') val = e.amount * (data.tax.rateUSD || 0.85);
          if (e.currency === 'EUR') val = e.amount * (data.tax.rateEUR || 0.94);
          return sum + val;
      }, 0);
  
  const p3aPercent = Math.min(100, (pillar3aInvested / pillar3aLimit) * 100);

  // --- GOAL ACTIONS ---
  const saveGoal = () => {
      if (!goalForm.name || !goalForm.targetAmount) return;
      
      const newGoal: SavingsGoal = {
          id: goalForm.id || `goal_${Date.now()}`,
          name: goalForm.name,
          targetAmount: Number(goalForm.targetAmount),
          currentAmount: Number(goalForm.currentAmount) || 0,
          deadline: goalForm.deadline || '',
          color: goalForm.color || '#3b82f6'
      };

      const currentGoals = data.savingsGoals || [];
      const isEdit = !!goalForm.id;
      
      let updatedGoals;
      if (isEdit) {
          updatedGoals = currentGoals.map(g => g.id === newGoal.id ? newGoal : g);
      } else {
          updatedGoals = [...currentGoals, newGoal];
      }

      onUpdate({ ...data, savingsGoals: updatedGoals });
      setIsGoalModalOpen(false);
      setGoalForm({});
  };

  const deleteGoal = (id: string) => {
      if(confirm("Ziel wirklich löschen?")) {
          const updatedGoals = (data.savingsGoals || []).filter(g => g.id !== id);
          onUpdate({ ...data, savingsGoals: updatedGoals });
      }
  };

  const editGoal = (goal: SavingsGoal) => {
      setGoalForm(goal);
      setIsGoalModalOpen(true);
  };

  const StatCard = ({ label, value, sub, icon: Icon, color, navTarget }: any) => (
      <div 
        className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-start justify-between cursor-pointer hover:border-blue-300 dark:hover:border-blue-500 transition-all group"
        onClick={() => navTarget && onNavigate(navTarget)}
      >
          <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-1 group-hover:text-blue-500 transition-colors">{label}</p>
              <h3 className="text-2xl font-black text-gray-800 dark:text-white">{value}</h3>
              {sub && <p className={`text-xs font-bold mt-1 ${sub.startsWith('+') ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'}`}>{sub}</p>}
          </div>
          <div className={`p-3 rounded-xl bg-${color}-50 dark:bg-gray-700 text-${color}-500 dark:text-${color}-400`}>
              <Icon size={24} />
          </div>
      </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-24">
       <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-gray-800 dark:text-white tracking-tight">Financial Cockpit {currentYear}</h2>
          <span className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-lg text-xs font-bold">CHF Basis</span>
       </div>

       {/* KPI Grid */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
           <StatCard 
             label="Gesamtvermögen" 
             value={`${realTotalAssets.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub="Liquidität & Assets (Alle Portfolios)"
             icon={Landmark}
             color="blue"
             navTarget="holdings"
           />
           <StatCard 
             label="Netto Einkommen (YTD)" 
             value={`${totalNetIncome.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub={`Brutto: ${totalGrossIncome.toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={Wallet}
             color="green"
             navTarget="salary"
           />
           <StatCard 
             label="Ausgaben Total (YTD)" 
             value={`${totalExpensesYTD.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub={`Davon Fix: ${recurringExpTotal.toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={CreditCard}
             color="red"
             navTarget="expenses"
           />
           <StatCard 
             label="Sparquote (Real)" 
             value={`${savingsRate}%`} 
             sub={`Überschuss: ~ ${(totalNetIncome - totalExpensesYTD).toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={PiggyBank}
             color="purple"
             navTarget="expenses"
           />
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           {/* Asset Allocation */}
           <div 
             className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col cursor-pointer hover:border-blue-200 dark:hover:border-blue-600 transition-colors"
             onClick={() => onNavigate('holdings')}
           >
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <PieIcon size={14} /> Vermögensaufteilung (Total)
              </h4>
              <div className="flex-1 min-h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie 
                            data={allocationData} 
                            innerRadius={60} 
                            outerRadius={80} 
                            paddingAngle={5} 
                            dataKey="value"
                          >
                            {allocationData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#ffffff', borderRadius: '10px' }}
                            labelStyle={{ color: '#ffffff' }}
                            itemStyle={{ color: '#ffffff' }}
                            formatter={(value: number) => value.toLocaleString('de-CH') + ' CHF'} 
                            />
                      </PieChart>
                  </ResponsiveContainer>
                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs text-gray-400 font-bold uppercase">Total</span>
                      <span className="text-lg font-black text-gray-800 dark:text-white">{(realTotalAssets/1000).toFixed(0)}k</span>
                  </div>
              </div>
              <div className="mt-6 space-y-3">
                  {allocationData.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{backgroundColor: d.color}} />
                              <span className="font-bold text-gray-600 dark:text-gray-300">{d.name}</span>
                          </div>
                          <span className="font-black text-gray-800 dark:text-white">{d.value.toLocaleString('de-CH')}</span>
                      </div>
                  ))}
              </div>
           </div>

           {/* Income Flow */}
           <div 
             className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col cursor-pointer hover:border-blue-200 dark:hover:border-blue-600 transition-colors"
             onClick={() => onNavigate('salary')}
           >
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Activity size={14} /> Einkommensfluss {currentYear}
              </h4>
              <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={incomeChartData}>
                          <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} tick={{fill: '#9ca3af'}} />
                          <Tooltip 
                            cursor={{fill: 'rgba(255,255,255,0.1)'}}
                            contentStyle={{borderRadius: '12px', border: 'none', backgroundColor: '#1f2937', color:'#fff', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'}}
                          />
                          <Bar dataKey="net" fill="#10b981" radius={[6, 6, 6, 6]} barSize={40} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
           </div>
       </div>

       {/* Quick Actions & Goals */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
           
           {/* DYNAMIC TAX OPTIMIZATION */}
           <div 
             className="bg-gradient-to-br from-[#16325c] to-[#1c3f74] dark:from-blue-900 dark:to-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-blue-900/20 dark:shadow-black/40 flex flex-col justify-between min-h-[180px] cursor-pointer hover:scale-[1.02] transition-transform"
             onClick={() => onNavigate('tax')}
           >
               <div>
                   <h4 className="font-bold text-lg mb-2">Säule 3a Tracker</h4>
                   <p className="text-blue-200 text-xs leading-relaxed mb-4">
                       Maximalbetrag 2025: {pillar3aLimit.toLocaleString('de-CH')} CHF.
                       Erfasst via Steuer-Abzüge (Kategorie "3a/Vorsorge").
                   </p>
               </div>
               <div>
                   <div className="w-full bg-white/10 rounded-full h-2 mb-2 overflow-hidden">
                       <div className="bg-green-400 h-2 rounded-full transition-all duration-1000" style={{width: `${p3aPercent}%`}}></div> 
                   </div>
                   <p className="text-[10px] text-right text-blue-300 font-bold">
                       {pillar3aInvested.toLocaleString('de-CH', {maximumFractionDigits:0})} / {pillar3aLimit} CHF
                   </p>
               </div>
           </div>

           {/* FORECAST CARD */}
           <div 
             className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-between min-h-[180px] cursor-pointer hover:border-orange-300 transition-colors"
             onClick={() => onNavigate('expenses')}
           >
               <div>
                   <h4 className="font-bold text-gray-800 dark:text-white mb-1 flex items-center gap-2"><CalendarCheck size={16} className="text-orange-500"/> Fixkosten Prognose</h4>
                   <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">
                       Geschätzte Fixkosten für den Rest des Jahres (basierend auf Abos).
                   </p>
               </div>
               <div>
                   <span className="block text-2xl font-black text-orange-500">{remainingYearFixCosts.toLocaleString('de-CH', {maximumFractionDigits:0})} CHF</span>
                   <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase">Noch fällig in {currentYear}</span>
               </div>
           </div>

           <div 
              className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group hover:border-blue-400 transition-colors cursor-pointer min-h-[180px] flex flex-col justify-center" 
              onClick={() => onNavigate('trading')}
              title="Klicken um zum Trading-Tab zu wechseln"
           >
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                   <ArrowUpRight size={100} className="dark:text-white" />
               </div>
               <h4 className="font-bold text-gray-800 dark:text-white mb-1">Trading Journal</h4>
               <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">
                   {tradesYTD.length} Tage aktiv gehandelt.
                   <br/>Win Rate aktuell: <span className="text-green-600 font-bold">{winRate}%</span>
               </p>
               <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-blue-600 h-full rounded-full" style={{width: `${Math.min(100, parseFloat(winRate))}%`}}></div>
               </div>
           </div>
           
           {/* SAVINGS GOALS WIDGET */}
           <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group hover:border-purple-400 transition-colors min-h-[180px] flex flex-col">
               <div className="flex justify-between items-start mb-3">
                   <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2"><Target size={16} className="text-purple-500"/> Sparziele</h4>
                   <button onClick={() => { setGoalForm({}); setIsGoalModalOpen(true); }} className="p-1 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors">
                       <Plus size={14} />
                   </button>
               </div>
               
               <div className="flex-1 space-y-3 overflow-y-auto max-h-[120px] custom-scrollbar">
                   {data.savingsGoals && data.savingsGoals.length > 0 ? (
                       data.savingsGoals.map(goal => (
                           <div key={goal.id} className="group/item relative">
                               <div className="flex justify-between text-xs mb-1">
                                   <div className="flex items-center gap-1">
                                       <span className="font-bold text-gray-600 dark:text-gray-300">{goal.name}</span>
                                       <button onClick={() => editGoal(goal)} className="opacity-0 group-hover/item:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"><Pencil size={10}/></button>
                                   </div>
                                   <span className="text-gray-400">{(goal.currentAmount/1000).toFixed(1)}k / {(goal.targetAmount/1000).toFixed(1)}k</span>
                               </div>
                               <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                   <div className="h-full rounded-full transition-all duration-500" style={{width: `${Math.min(100, (goal.currentAmount/goal.targetAmount)*100)}%`, backgroundColor: goal.color || '#a855f7'}}></div>
                               </div>
                           </div>
                       ))
                   ) : (
                       <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600 space-y-2">
                           <Target size={24} className="opacity-20" />
                           <p className="text-xs italic">Keine Ziele definiert</p>
                           <button onClick={() => setIsGoalModalOpen(true)} className="text-[10px] text-purple-500 font-bold hover:underline">Erstes Ziel erstellen</button>
                       </div>
                   )}
               </div>
           </div>
       </div>

       {/* MODAL: ADD/EDIT GOAL */}
       {isGoalModalOpen && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white dark:bg-gray-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-700">
                   <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-gray-700">
                       <h3 className="font-black text-xl text-gray-800 dark:text-white">{goalForm.id ? 'Ziel Bearbeiten' : 'Neues Sparziel'}</h3>
                       <button onClick={() => setIsGoalModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full dark:text-gray-400"><X size={20}/></button>
                   </div>
                   
                   <div className="space-y-4">
                       <div className="space-y-1">
                           <label className="text-[10px] font-bold text-gray-400 uppercase">Bezeichnung</label>
                           <input type="text" value={goalForm.name || ''} onChange={(e) => setGoalForm({...goalForm, name: e.target.value})} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-100 dark:text-white" placeholder="z.B. Notgroschen" />
                       </div>
                       <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-1">
                               <label className="text-[10px] font-bold text-gray-400 uppercase">Zielbetrag (CHF)</label>
                               <input type="number" value={goalForm.targetAmount || ''} onChange={(e) => setGoalForm({...goalForm, targetAmount: parseFloat(e.target.value)})} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-100 dark:text-white" />
                           </div>
                           <div className="space-y-1">
                               <label className="text-[10px] font-bold text-gray-400 uppercase">Aktuell (CHF)</label>
                               <input type="number" value={goalForm.currentAmount || ''} onChange={(e) => setGoalForm({...goalForm, currentAmount: parseFloat(e.target.value)})} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-100 dark:text-white" />
                           </div>
                       </div>
                       <div className="space-y-1">
                           <label className="text-[10px] font-bold text-gray-400 uppercase">Farbe</label>
                           <div className="flex gap-2">
                               {['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'].map(c => (
                                   <button 
                                       key={c} 
                                       onClick={() => setGoalForm({...goalForm, color: c})}
                                       className={`w-8 h-8 rounded-full border-2 transition-all ${goalForm.color === c ? 'border-gray-400 scale-110' : 'border-transparent'}`}
                                       style={{backgroundColor: c}}
                                   />
                               ))}
                           </div>
                       </div>
                   </div>

                   <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                       {goalForm.id && (
                           <button onClick={() => { deleteGoal(goalForm.id!); setIsGoalModalOpen(false); }} className="p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100"><Trash2 size={18}/></button>
                       )}
                       <button onClick={saveGoal} className="flex-1 py-3 bg-[#16325c] text-white font-bold text-sm rounded-xl shadow-lg hover:bg-blue-800 transition-all flex items-center justify-center gap-2"><Check size={18}/> Speichern</button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};

export default DashboardView;
