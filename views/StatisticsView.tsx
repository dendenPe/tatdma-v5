
import React, { useState, useMemo } from 'react';
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
  ReferenceLine,
  AreaChart,
  Area
} from 'recharts';
import { AppData, DayEntry, Trade } from '../types';
import { TrendingUp, Clock, Target, Layers, FilterX, CalendarDays, Wallet, AlertTriangle, Activity, Calendar } from 'lucide-react';

interface Props {
  data: AppData;
  onNavigateToCalendar?: (dateStr: string) => void;
}

const StatisticsView: React.FC<Props> = ({ data, onNavigateToCalendar }) => {
  const [selectedYear, setSelectedYear] = useState<string>('All');

  // 1. DATA PREPARATION & FILTERING
  const availableYears = useMemo(() => {
      const years = new Set<string>();
      Object.keys(data.trades).forEach(date => {
          // FIX: Strictly validate date format (YYYY-MM-DD) to prevent notes or invalid keys from appearing as years
          if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              const y = date.split('-')[0];
              if(y) years.add(y);
          }
      });
      return Array.from(years).sort().reverse();
  }, [data.trades]);

  const validTradeEntries = useMemo(() => {
      return Object.entries(data.trades).filter(([dateKey, entry]) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
          
          // Year Filter
          if (selectedYear !== 'All' && !dateKey.startsWith(selectedYear)) return false;

          const parts = dateKey.split('-').map(Number);
          const year = parts[0];
          if (year < 2020 || year > 2040) return false;
          if (entry.total === 0 && (!entry.trades || entry.trades.length === 0)) return false;
          return true;
      }).sort((a, b) => a[0].localeCompare(b[0])) as [string, DayEntry][];
  }, [data.trades, selectedYear]);
  
  const allTrades = useMemo(() => {
      const trades: (Trade & { date: string, dayOfWeek: number, hour: number })[] = [];
      validTradeEntries.forEach(([date, entry]) => {
        if(entry.trades) {
            entry.trades.forEach(t => {
                const d = new Date(date);
                let h = 0;
                if(t.start) h = parseInt(t.start.split(':')[0]) || 0;
                trades.push({ ...t, date, dayOfWeek: d.getDay(), hour: h });
            });
        }
      });
      return trades;
  }, [validTradeEntries]);

  // 2. BASIC CHART DATA
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

  // 3. DRAWDOWN & EQUITY CURVE
  let runningTotal = 0;
  let peak = -Infinity;
  let maxDrawdown = 0;

  const equityData = tradeData.map(day => {
      runningTotal += day.pnl;
      if (runningTotal > peak) peak = runningTotal;
      const dd = runningTotal - peak;
      if (dd < maxDrawdown) maxDrawdown = dd;

      return { 
          ...day, 
          cum: runningTotal,
          drawdown: dd
      };
  });

  // 4. MONTHLY AGGREGATION
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

  // 5. ADVANCED METRICS
  const wins = allTrades.filter(t => (t.pnl - (t.fee||0)) > 0);
  const losses = allTrades.filter(t => (t.pnl - (t.fee||0)) <= 0);
  
  const grossWin = wins.reduce((s, t) => s + (t.pnl - (t.fee||0)), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl - (t.fee||0)), 0));
  
  const profitFactor = grossLoss === 0 ? grossWin : (grossWin / grossLoss);
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  
  // Streak Calculation
  let currentStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  
  // Need to iterate strictly by day
  let streakCounter = 0;
  tradeData.forEach((day) => {
      if (day.pnl > 0) {
          if (streakCounter < 0) streakCounter = 0;
          streakCounter++;
          if (streakCounter > maxWinStreak) maxWinStreak = streakCounter;
      } else if (day.pnl < 0) {
          if (streakCounter > 0) streakCounter = 0;
          streakCounter--;
          if (Math.abs(streakCounter) > maxLossStreak) maxLossStreak = Math.abs(streakCounter);
      }
  });
  currentStreak = streakCounter;

  // 6. DAY OF WEEK ANALYSIS
  const dowStats = [0,1,2,3,4,5,6].map(dayIdx => {
      const dayTrades = allTrades.filter(t => t.dayOfWeek === dayIdx);
      const totalPnL = dayTrades.reduce((s, t) => s + (t.pnl - (t.fee||0)), 0);
      const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      return { day: names[dayIdx], pnl: totalPnL, count: dayTrades.length };
  }).filter(d => d.count > 0);

  // 7. TIME OF DAY ANALYSIS
  const todStats = Array.from({length: 24}, (_, h) => {
      const hourTrades = allTrades.filter(t => t.hour === h);
      const totalPnL = hourTrades.reduce((s, t) => s + (t.pnl - (t.fee||0)), 0);
      return { hour: `${h}h`, pnl: totalPnL, count: hourTrades.length };
  });

  const totalGrossPnL = allTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const totalFees = allTrades.reduce((s, t) => s + (Number(t.fee) || 0), 0);
  const totalNetPnL = totalGrossPnL - totalFees;
  const winRate = allTrades.length > 0 ? (wins.length / allTrades.length * 100).toFixed(1) : '0.0';

  // Strategy Data
  const strategyStats = allTrades.reduce((acc: any, t) => {
    const strat = t.strategy || 'Unbekannt';
    if (!acc[strat]) acc[strat] = { name: strat, count: 0, pnl: 0 };
    const net = (Number(t.pnl) || 0) - (Number(t.fee) || 0);
    acc[strat].count += 1;
    acc[strat].pnl += net; 
    return acc;
  }, {});
  const strategyData = Object.values(strategyStats);

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
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 space-y-4">
              <FilterX size={48} className="mb-4 opacity-50" />
              <p>Keine Trading-Daten für den gewählten Zeitraum gefunden.</p>
              <select 
                  value={selectedYear} 
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg px-4 py-2 font-bold max-w-xs"
              >
                  <option value="All">Alle Jahre</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
          </div>
      );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      
      {/* YEAR FILTER HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-2xl border border-gray-100 shadow-sm gap-4">
          <h2 className="text-xl font-black text-gray-800">Trading Performance</h2>
          <div className="flex items-center gap-2 max-w-full">
              <Calendar size={16} className="text-gray-400 shrink-0"/>
              <select 
                  value={selectedYear} 
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm outline-none cursor-pointer hover:bg-gray-100 max-w-[200px] truncate"
              >
                  <option value="All">Alle Zeiträume</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
          </div>
      </div>

      {/* QUICK STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${totalNetPnL >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                <TrendingUp size={16} />
              </div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Netto PnL</span>
            </div>
            <div className={`text-2xl font-black ${totalNetPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalNetPnL.toLocaleString('de-CH', { minimumFractionDigits: 2 })} $
            </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-500"><Target size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Profit Factor</span>
            </div>
            <div className="text-2xl font-black text-gray-800">{profitFactor.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 mt-1">Gross Win / Gross Loss</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-500"><Activity size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Win Rate</span>
            </div>
            <div className="text-2xl font-black text-gray-800">{winRate}%</div>
            <p className="text-[9px] text-gray-400 mt-1">{wins.length} Wins / {losses.length} Losses</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-red-50 text-red-500"><AlertTriangle size={16} /></div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Max Drawdown</span>
            </div>
            <div className="text-2xl font-black text-red-600">{maxDrawdown.toLocaleString('de-CH', {maximumFractionDigits:0})} $</div>
            <p className="text-[9px] text-gray-400 mt-1">Vom Höchststand</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Avg Win</span>
              <p className="text-lg font-black text-green-600">{avgWin.toFixed(0)} $</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Avg Loss</span>
              <p className="text-lg font-black text-red-600">-{avgLoss.toFixed(0)} $</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Streak (Aktuell)</span>
              <p className={`text-lg font-black ${currentStreak >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currentStreak > 0 ? '+' : ''}{currentStreak}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase">Bester Streak</span>
              <p className="text-lg font-black text-green-600">+{maxWinStreak}</p>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Equity Curve */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
             <div className="flex justify-between items-center">
                 <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Equity Curve (Netto)</h4>
             </div>
             <div className="h-[300px]">
               <ResponsiveContainer width="100%" height="100%">
                 <LineChart data={equityData}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                   <XAxis dataKey="displayDate" fontSize={10} axisLine={false} tickLine={false} minTickGap={40} />
                   <YAxis fontSize={10} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                   <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'Equity']} />
                   <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                   <Line type="monotone" dataKey="cum" stroke={totalNetPnL >= 0 ? "#3b82f6" : "#ef4444"} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                 </LineChart>
               </ResponsiveContainer>
             </div>
          </div>

          {/* Drawdown Chart */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
             <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-red-400">Drawdown (Vom Peak)</h4>
             <div className="h-[300px]">
               <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={equityData}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                   <XAxis dataKey="displayDate" fontSize={10} axisLine={false} tickLine={false} minTickGap={40} />
                   <YAxis fontSize={10} axisLine={false} tickLine={false} />
                   <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'Drawdown']} />
                   <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#fecaca" />
                 </AreaChart>
               </ResponsiveContainer>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Monthly Net PnL Chart */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                  <CalendarDays size={14} className="text-blue-500" /> Monatsabschlüsse
              </h4>
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
                    <Bar dataKey="pnl" radius={[4, 4, 4, 4]} barSize={30}>
                      {monthlyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#3b82f6' : '#f87171'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
          </div>

          {/* Strategy Breakdown Chart (NET) */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Strategie Performance</h4>
            <div className="h-[250px]">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Day of Week Analysis */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Wochentags-Analyse</h4>
              <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dowStats}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis dataKey="day" fontSize={10} axisLine={false} tickLine={false} />
                          <YAxis fontSize={10} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'PnL']} />
                          <ReferenceLine y={0} stroke="#e5e7eb" />
                          <Bar dataKey="pnl" radius={[4, 4, 4, 4]} barSize={30}>
                              {dowStats.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f87171'} />
                              ))}
                          </Bar>
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Time of Day Analysis */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Tageszeit-Performance</h4>
              <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={todStats}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis dataKey="hour" fontSize={10} axisLine={false} tickLine={false} />
                          <YAxis fontSize={10} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(value: number) => [`${value.toFixed(2)} $`, 'PnL']} />
                          <ReferenceLine y={0} stroke="#e5e7eb" />
                          <Bar dataKey="pnl" radius={[2, 2, 2, 2]}>
                              {todStats.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#8b5cf6' : '#f472b6'} />
                              ))}
                          </Bar>
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>
      </div>
    </div>
  );
};

export default StatisticsView;
