
import React from 'react';
import { 
  TrendingUp, 
  Wallet, 
  Landmark, 
  PiggyBank, 
  ArrowUpRight,
  PieChart as PieIcon,
  Activity,
  CreditCard
} from 'lucide-react';
import { AppData, PortfolioYear } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  onNavigate: (tab: string) => void;
}

const DashboardView: React.FC<Props> = ({ data, onUpdate, onNavigate }) => {
  const currentYear = new Date().getFullYear().toString();
  const portfolioId = data.currentPortfolioId || Object.keys(data.portfolios)[0];
  const portfolio = data.portfolios[portfolioId];
  const portYearData = portfolio?.years[currentYear];

  // 1. Calculate Net Worth
  // Portfolio Value
  const portValue = portYearData?.summary?.totalValue || 0;
  
  // Bank Balances (Manual entries in Tax)
  const balances = data.tax.balances[currentYear] || { ubs: 0, comdirect: 0, ibkr: 0 };
  const bankTotal = (balances.ubs || 0) + (balances.comdirect || 0) + ((balances.comdirectEUR || 0) * (data.tax.rateEUR || 0.94));
  
  // Cash in Portfolio (IBKR) - Convert to CHF
  const rates = portYearData?.exchangeRates || {};
  const usdToChf = rates['USD_CHF'] || 0.88;
  const eurToUsd = rates['EUR_USD'] || 1.07;
  
  let cashTotalCHF = 0;
  if (portYearData?.cash) {
      Object.entries(portYearData.cash).forEach(([curr, amt]) => {
          let valUSD = 0;
          if (curr === 'USD') valUSD = amt;
          else if (curr === 'CHF') valUSD = amt / usdToChf;
          else if (curr === 'EUR') valUSD = amt * eurToUsd;
          else valUSD = amt * (rates[`${curr}_USD`] || 0);
          cashTotalCHF += valUSD * usdToChf;
      });
  }

  // Portfolio Securities Value in CHF
  const securitiesCHF = (portValue * usdToChf);
  
  const totalNetWorth = bankTotal + securitiesCHF;
  const realTotalAssets = securitiesCHF + cashTotalCHF + bankTotal;

  // 2. Income Calculation
  const salaryData = Object.values(data.salary[currentYear] || {});
  const totalNetIncome = salaryData.reduce((acc, entry) => acc + (entry.auszahlung || 0), 0);
  const totalGrossIncome = salaryData.reduce((acc, entry) => acc + (entry.brutto || 0), 0);

  // 3. EXPENSES CALCULATION (YTD) - FIXED
  const today = new Date();
  const currentMonthIndex = today.getMonth(); // 0 = Jan, 1 = Feb...

  // A. Daily Expenses Sum
  const dailyExpList = data.dailyExpenses[currentYear] || [];
  const dailyExpTotal = dailyExpList.reduce((sum, exp) => sum + (exp.amount * exp.rate), 0);

  // B. Recurring Expenses Sum (YTD based on current month)
  let recurringExpTotal = 0;
  if (data.recurringExpenses) {
      for(let m = 0; m <= currentMonthIndex; m++) {
          data.recurringExpenses.forEach(rec => {
             // Logic copy from ExpensesView
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
                 // Find valid price for this specific month
                 const targetDate = new Date(parseInt(currentYear), m, 1);
                 const history = [...rec.history].sort((a,b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime());
                 const activePrice = history.find(h => new Date(h.validFrom) <= targetDate);
                 
                 if(activePrice) {
                     let r = 1;
                     // Simple rate lookup (could be improved with historical rates but global static is fine for estimate)
                     if(activePrice.currency === 'USD') r = data.tax.rateUSD || 0.85;
                     if(activePrice.currency === 'EUR') r = data.tax.rateEUR || 0.94;
                     recurringExpTotal += (activePrice.amount * r);
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
  
  // Calculate PnL USD Total
  const tradePnlUSD = tradesYTD.reduce((acc, [_, day]) => acc + day.total, 0);
  const tradePnlCHF = tradePnlUSD * usdToChf;

  // Calculate Real Win Rate
  const allSingleTrades = tradesYTD.flatMap(([_, day]) => day.trades);
  const winRate = allSingleTrades.length > 0 
      ? ((allSingleTrades.filter(t => t.pnl > 0).length / allSingleTrades.length) * 100).toFixed(1) 
      : '0.0';

  // Chart Data: Allocation
  const allocationData = [
      { name: 'Aktien/Fonds', value: Math.round(securitiesCHF), color: '#3b82f6' },
      { name: 'Cash (IBKR)', value: Math.round(cashTotalCHF), color: '#8b5cf6' },
      { name: 'Banken', value: Math.round(bankTotal), color: '#10b981' },
  ].filter(d => d.value > 0);

  // Chart Data: Monthly Income
  const incomeChartData = ['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => {
      const entry = data.salary[currentYear]?.[m];
      return {
          month: m,
          net: entry?.auszahlung || 0
      };
  });

  const StatCard = ({ label, value, sub, icon: Icon, color }: any) => (
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-start justify-between">
          <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-1">{label}</p>
              <h3 className="text-2xl font-black text-gray-800">{value}</h3>
              {sub && <p className={`text-xs font-bold mt-1 ${sub.startsWith('+') ? 'text-green-500' : 'text-gray-400'}`}>{sub}</p>}
          </div>
          <div className={`p-3 rounded-xl bg-${color}-50 text-${color}-500`}>
              <Icon size={24} />
          </div>
      </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-24">
       <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-gray-800 tracking-tight">Financial Cockpit {currentYear}</h2>
          <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold">CHF Basis</span>
       </div>

       {/* KPI Grid */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
           <StatCard 
             label="Gesamtvermögen" 
             value={`${realTotalAssets.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub="Liquidität & Assets"
             icon={Landmark}
             color="blue"
           />
           <StatCard 
             label="Netto Einkommen (YTD)" 
             value={`${totalNetIncome.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub={`Brutto: ${totalGrossIncome.toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={Wallet}
             color="green"
           />
           {/* REPLACED TRADING CARD WITH EXPENSES CARD FOR BETTER OVERVIEW */}
           <StatCard 
             label="Ausgaben Total (YTD)" 
             value={`${totalExpensesYTD.toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF`} 
             sub={`Davon Fix: ${recurringExpTotal.toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={CreditCard}
             color="red"
           />
           <StatCard 
             label="Sparquote (Real)" 
             value={`${savingsRate}%`} 
             sub={`Überschuss: ~ ${(totalNetIncome - totalExpensesYTD).toLocaleString('de-CH', {maximumFractionDigits:0})}`}
             icon={PiggyBank}
             color="purple"
           />
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           {/* Asset Allocation */}
           <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <PieIcon size={14} /> Vermögensaufteilung
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
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => value.toLocaleString('de-CH') + ' CHF'} />
                      </PieChart>
                  </ResponsiveContainer>
                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs text-gray-400 font-bold uppercase">Total</span>
                      <span className="text-lg font-black text-gray-800">{(realTotalAssets/1000).toFixed(0)}k</span>
                  </div>
              </div>
              <div className="mt-6 space-y-3">
                  {allocationData.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{backgroundColor: d.color}} />
                              <span className="font-bold text-gray-600">{d.name}</span>
                          </div>
                          <span className="font-black text-gray-800">{d.value.toLocaleString('de-CH')}</span>
                      </div>
                  ))}
              </div>
           </div>

           {/* Income Flow */}
           <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Activity size={14} /> Einkommensfluss {currentYear}
              </h4>
              <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={incomeChartData}>
                          <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} tick={{fill: '#9ca3af'}} />
                          <Tooltip 
                            cursor={{fill: '#f3f4f6'}}
                            contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'}}
                          />
                          <Bar dataKey="net" fill="#10b981" radius={[6, 6, 6, 6]} barSize={40} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
           </div>
       </div>

       {/* Quick Actions / Recommendations */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <div className="bg-gradient-to-br from-[#16325c] to-[#1c3f74] rounded-3xl p-6 text-white shadow-xl shadow-blue-900/20">
               <h4 className="font-bold text-lg mb-2">Steuer-Optimierung</h4>
               <p className="text-blue-200 text-xs leading-relaxed mb-4">
                   Du hast im Jahr {currentYear} bereits {totalGrossIncome.toLocaleString('de-CH')} CHF verdient. 
                   Hast du deine Säule 3a bereits voll einbezahlt?
               </p>
               <div className="w-full bg-white/10 rounded-full h-2 mb-2">
                   <div className="bg-green-400 h-2 rounded-full" style={{width: '0%'}}></div> 
               </div>
               <p className="text-[10px] text-right text-blue-300">0 / 7'056 CHF</p>
           </div>

           <div 
              className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm relative overflow-hidden group hover:border-blue-200 transition-colors cursor-pointer" 
              onClick={() => onNavigate('trading')}
              title="Klicken um zum Trading-Tab zu wechseln"
           >
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                   <ArrowUpRight size={100} />
               </div>
               <h4 className="font-bold text-gray-800 mb-1">Trading Journal</h4>
               <p className="text-gray-500 text-xs">
                   {tradesYTD.length} Tage aktiv gehandelt.
                   <br/>Win Rate aktuell: <span className="text-green-600 font-bold">{winRate}%</span>
               </p>
           </div>
           
           <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm relative overflow-hidden group hover:border-purple-200 transition-colors">
               <h4 className="font-bold text-gray-800 mb-1">Fixkosten Check</h4>
               <p className="text-gray-500 text-xs">
                   Durchschnittliche Fixkosten pro Monat (geschätzt):
                   <br/>
                   <span className="text-purple-600 font-bold text-lg mt-1 block">~ {(recurringExpTotal / (currentMonthIndex + 1)).toLocaleString('de-CH', {maximumFractionDigits: 0})} CHF</span>
               </p>
           </div>
       </div>
    </div>
  );
};

export default DashboardView;
