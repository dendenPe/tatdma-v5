
import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  Cell,
  PieChart,
  Pie,
  ReferenceLine
} from 'recharts';
import { AppData, DayEntry, Trade } from '../types';
import { TrendingUp, Clock, Target, Layers, FilterX, CalendarDays, DollarSign, Wallet } from 'lucide-react';

interface Props {
  data: AppData;
  onNavigateToCalendar?: (dateStr: string) => void;
}

const StatisticsView: React.FC<Props> = ({ data, onNavigateToCalendar }) => {
  // 1. STRICT DATA FILTERING
  const validTradeEntries = Object.entries(data.trades).filter(([dateKey, entry]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
      const parts = dateKey.split('-').map(Number);
      const year = parts[0];
      if (year < 2020 || year > 2040) return false;
      if (entry.total === 0 && (!entry.trades || entry.trades.length === 0)) return false;
      return true;
  }) as [string, DayEntry][];
  
  validTradeEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const allTrades: (Trade & { date: string })[] = [];
  
  validTradeEntries.forEach(([date, entry]) => {
    if(entry.trades) {
        entry.trades.forEach(t => {
            allTrades.push({ ...t, date });
        });
    }
  });

  // 2. CHART DATA PREPARATION (DAILY)
  const tradeData = validTradeEntries.map(([date, entry]) => {
    const dObj = new Date(date);
    const displayDate = !isNaN(dObj.getTime()) 
        ? dObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : date;

    return {
      fullDate: date,
      displayDate: displayDate,
      pnl: Number(entry.total) || 0, // Net PnL
      count: entry.trades ? entry.trades.length : 0
    };
  });

  // 3. MONTHLY AGGREGATION (With Fees Breakdown)
  const monthlyAgg: Record<string, { net: number, fees: number, gross: number }> = {};
  
  validTradeEntries.forEach(([date, entry]) => {
      const monthKey = date.substring(0, 7); 
      if (!monthlyAgg[monthKey]) monthlyAgg[monthKey] = { net: 0, fees: 0, gross: 0 };
      
      const dayNet = Number(entry.total) || 0;
      const dayFees = Number(entry.fees) || 0;
      
      monthlyAgg[monthKey].net += dayNet;
      monthlyAgg[monthKey].fees += dayFees;
      monthlyAgg[monthKey].gross += (dayNet + dayFees);
  });

  const monthlyData = Object.entries(monthlyAgg).map(([key, val]) => {
      const [y, m] = key.split('-');
      const d = new Date(parseInt(y), parseInt(m)-1, 1);
      return {
          monthKey: key, 
          display: d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }), 
          fullDate: `${key}-01`, 
          pnl: val.net,
          fees: val.fees,
          gross: val.gross
      };
  }).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // 4. EQUITY CURVE (Cumulative Net PnL)
  let runningTotal = 0;
  const equityCurveData = tradeData.map(day => {
      runningTotal += day.pnl;
      return { ...day, cum: runningTotal };
  });

  // 5. METRICS & STRATEGY
  const strategyStats = allTrades.reduce((acc: any, t) => {
    const strat = t.strategy || 'Unbekannt';
    if (!acc[strat]) acc[strat] = { name: strat, count: 0, pnl: 0 };
    
    const gross = Number(t.pnl) || 0;
    const fee = Number(t.fee) || 0;
    const net = gross - fee;

    acc[strat].count += 1;
    acc[strat].pnl += net; 
    return acc;
  }, {});

  const strategyData = Object.values(strategyStats);

  // Avg Duration
  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    let diff = (eH * 60 + eM) - (sH * 60 + sM);
    if (diff < 0) diff += 1440;
    return diff;
  };

  const avgDuration = allTrades.length > 0 
    ? allTrades.reduce((sum, t) => sum + calculateDuration(t.start, t.end), 0) / allTrades.length 
    : 0;

  // GLOBAL TOTALS
  const totalGrossPnL = allTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const totalFees = allTrades.reduce((s, t) => s + (Number(t.fee) || 0), 0);
  const totalNetPnL = totalGrossPnL - totalFees;
  
  const winRate = allTrades.length > 0 
    ? (allTrades.filter(t => ((Number(t.pnl)||0) - (Number(t.fee)||0)) > 0).length / allTrades.length * 100).toFixed(1) 
    : 0;

  const handleMonthClick = (data: any) => {
      if (data && data.activePayload && data.activePayload.length > 0) {
          const payload = data.activePayload[0].payload;
          if (payload && payload.fullDate && onNavigateToCalendar) {
              onNavigateToCalendar(payload.fullDate);
          }
      }
  };

  if (tradeData.length === 0) {
      return (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <FilterX size={48} className="mb-4 opacity-50" />
              <p>Keine validen Trading-Daten gefunden.</p>
          </div>
      );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${totalNetPnL >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                <TrendingUp size={16} />
              </div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Netto PnL (Gesamt)</span>
            </div>
            <div className={`text-xl font-black ${totalNetPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalNetPnL.toLocaleString('de-CH', { minimumFractionDigits: 2 })} $
            </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-red-50 text-red-500">
                <Wallet size={16} />
              </div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Kommissionen (Gesamt)</span>
            </div>
            <div className="text-xl font-black text-red-500">
                -{totalFees.toLocaleString('de-CH', { minimumFractionDigits: 2 })} $
            </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-500"><Target size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Win Rate</span>
            </div>
            <div className="text-xl font-black text-gray-800">{winRate}%</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-500"><Clock size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ø Dauer</span>
            </div>
            <div className="text-xl font-black text-gray-800">{Math.round(avgDuration)} min</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-500"><Layers size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Trades</span>
            </div>
            <div className="text-xl font-black text-gray-800">{allTrades.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Monthly Net PnL Chart */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                      <CalendarDays size={14} className="text-blue-500" /> Monatsabschlüsse (Netto)
                  </h4>
              </div>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} onClick={handleMonthClick} className="cursor-pointer">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="display" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} axisLine={false} tickLine={false} />
                    <Tooltip 
                        cursor={{fill: '#f3f4f6'}}
                        content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                const d = payload[0].payload;
                                return (
                                    <div className="bg-white p-3 rounded-xl shadow-xl border border-gray-100 text-xs">
                                        <p className="font-bold text-gray-700 mb-2">{d.display}</p>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                            <span className="text-gray-400">Brutto:</span>
                                            <span className={`font-mono font-bold text-right ${d.gross >= 0 ? 'text-green-600' : 'text-red-600'}`}>{d.gross.toFixed(2)}</span>
                                            <span className="text-gray-400">Gebühr:</span>
                                            <span className="font-mono font-bold text-right text-red-500">-{d.fees.toFixed(2)}</span>
                                            <div className="col-span-2 h-px bg-gray-100 my-1"></div>
                                            <span className="font-black text-gray-800">Netto:</span>
                                            <span className={`font-mono font-black text-right ${d.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{d.pnl.toFixed(2)} $</span>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />
                    <ReferenceLine y={0} stroke="#e5e7eb" />
                    <Bar dataKey="pnl" radius={[4, 4, 4, 4]} barSize={40}>
                      {monthlyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#3b82f6' : '#f87171'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
          </div>

          {/* NEW: Monthly Fees Chart */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Wallet size={14} className="text-red-500" /> Monatliche Kommissionen
              </h4>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="display" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} axisLine={false} tickLine={false} />
                    <Tooltip 
                        cursor={{fill: '#f3f4f6'}}
                        formatter={(value: number) => [`${value.toFixed(2)} $`, 'Gebühren']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="fees" radius={[4, 4, 0, 0]} barSize={40} fill="#f87171" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Daily PnL Chart */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Tägliche Performance (Netto)</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tradeData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="displayDate" fontSize={10} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(2)} $`, 'Net PnL']}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <ReferenceLine y={0} stroke="#e5e7eb" />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {tradeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Breakdown Chart (NET) */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Strategie Performance (Netto)</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={strategyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" fontSize={10} axisLine={false} tickLine={false} width={100} />
                <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'Net PnL']} />
                <ReferenceLine x={0} stroke="#e5e7eb" />
                <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                  {strategyData.map((entry: any, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#3b82f6' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Equity Curve */}
         <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
           <div className="flex justify-between items-center">
               <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Equity Curve (Netto Kumuliert)</h4>
               <span className={`text-xs font-bold ${totalNetPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                   Total: {totalNetPnL.toFixed(2)} $
               </span>
           </div>
           <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={equityCurveData}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                 <XAxis dataKey="displayDate" fontSize={10} axisLine={false} tickLine={false} minTickGap={30} />
                 <YAxis fontSize={10} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                 <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'Equity']} />
                 <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                 <Line type="monotone" dataKey="cum" stroke={totalNetPnL >= 0 ? "#3b82f6" : "#ef4444"} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>

         {/* Distribution Chart */}
         <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
           <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Verteilung (Anzahl Trades)</h4>
           <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={strategyData}
                   dataKey="count"
                   nameKey="name"
                   cx="50%"
                   cy="50%"
                   outerRadius={80}
                   label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                 >
                   {strategyData.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'][index % 5]} />
                   ))}
                 </Pie>
                 <Tooltip />
               </PieChart>
             </ResponsiveContainer>
           </div>
         </div>
      </div>
    </div>
  );
};

export default StatisticsView;
