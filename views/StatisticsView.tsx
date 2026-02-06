
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
import { TrendingUp, Clock, Target, Layers, FilterX } from 'lucide-react';

interface Props {
  data: AppData;
}

const StatisticsView: React.FC<Props> = ({ data }) => {
  // 1. STRICT DATA FILTERING
  // Filtert ungültige Datums-Keys (z.B. Import-Fehler, leere Strings, Jahr < 2020).
  // Verwendet exakt die gleichen Daten wie der Kalender.
  const validTradeEntries = Object.entries(data.trades).filter(([dateKey, entry]) => {
      // Regex Check: YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
      
      const parts = dateKey.split('-').map(Number);
      const year = parts[0];
      const month = parts[1];
      const day = parts[2];

      // "Ghost Data" Filter: Ignoriere alles vor 2020 (oft Import-Fehler 1970/0000)
      if (year < 2020 || year > 2040) return false;
      
      // Validiere Datum-Logik
      if (month < 1 || month > 12) return false;
      if (day < 1 || day > 31) return false;

      // Ignoriere Tage komplett ohne Daten (weder PnL noch Trades)
      if (entry.total === 0 && (!entry.trades || entry.trades.length === 0)) return false;

      return true;
  }) as [string, DayEntry][];
  
  // Sortierung: Chronologisch aufsteigend für korrekte Equity Curve
  validTradeEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const allTrades: (Trade & { date: string })[] = [];
  
  validTradeEntries.forEach(([date, entry]) => {
    if(entry.trades) {
        entry.trades.forEach(t => {
            allTrades.push({ ...t, date });
        });
    }
  });

  // 2. CHART DATA PREPARATION
  // WICHTIG: Wir nutzen hier 'entry.total' (wie im Kalender), anstatt die Trades neu zu summieren.
  const tradeData = validTradeEntries.map(([date, entry]) => {
    
    // Display Date Format (dd.mm.yy)
    const dObj = new Date(date);
    const displayDate = !isNaN(dObj.getTime()) 
        ? dObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : date;

    return {
      fullDate: date,
      displayDate: displayDate,
      pnl: Number(entry.total) || 0, // Nutze strikt den Kalender-Wert
      count: entry.trades ? entry.trades.length : 0
    };
  });

  // 3. EQUITY CURVE (Kumuliert)
  // Beginnt bei 0 am ersten validen Tag
  let runningTotal = 0;
  const equityCurveData = tradeData.map(day => {
      runningTotal += day.pnl;
      return {
          ...day,
          cum: runningTotal
      };
  });

  // 4. METRICS
  // Strategie Auswertung basiert weiterhin auf Einzeltrades
  const strategyStats = allTrades.reduce((acc: any, t) => {
    const strat = t.strategy || 'Unbekannt';
    if (!acc[strat]) acc[strat] = { name: strat, count: 0, pnl: 0 };
    acc[strat].count += 1;
    acc[strat].pnl += (Number(t.pnl) || 0);
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

  // Total PnL (Summe der validen Tage)
  const totalPnL = tradeData.reduce((s, d) => s + d.pnl, 0);
  
  // Win Rate (basierend auf Einzeltrades, da genauer für Performance)
  const winRate = allTrades.length > 0 
    ? (allTrades.filter(t => (t.pnl || 0) > 0).length / allTrades.length * 100).toFixed(1) 
    : 0;

  if (tradeData.length === 0) {
      return (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <FilterX size={48} className="mb-4 opacity-50" />
              <p>Keine validen Trading-Daten im Zeitraum 2020-2040 gefunden.</p>
              <p className="text-xs mt-2">Bitte prüfe den Kalender auf Einträge.</p>
          </div>
      );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt PnL', value: `${totalPnL.toLocaleString('de-CH', { minimumFractionDigits: 2 })} $`, icon: TrendingUp, color: totalPnL >= 0 ? 'green' : 'red' },
          { label: 'Win Rate', value: `${winRate}%`, icon: Target, color: 'blue' },
          { label: 'Avg. Duration', value: `${Math.round(avgDuration)} min`, icon: Clock, color: 'purple' },
          { label: 'Anzahl Trades', value: allTrades.length, icon: Layers, color: 'amber' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg bg-${stat.color}-50 text-${stat.color}-500`}>
                <stat.icon size={16} />
              </div>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className={`text-xl font-black ${stat.label === 'Gesamt PnL' ? (totalPnL >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-800'}`}>
                {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Daily PnL Chart */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Tägliche Performance</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tradeData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                    dataKey="displayDate" 
                    fontSize={10} 
                    axisLine={false} 
                    tickLine={false} 
                    minTickGap={20}
                />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(2)} $`, 'PnL']}
                    labelFormatter={(label) => `Datum: ${label}`}
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

        {/* Strategy Breakdown Chart */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Strategie Performance</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={strategyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" fontSize={10} axisLine={false} tickLine={false} width={100} />
                <Tooltip />
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
               <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Equity Curve (Kumuliert)</h4>
               <span className={`text-xs font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                   Total: {totalPnL.toFixed(2)} $
               </span>
           </div>
           <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={equityCurveData}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                 <XAxis 
                    dataKey="displayDate" 
                    fontSize={10} 
                    axisLine={false} 
                    tickLine={false} 
                    minTickGap={30} 
                 />
                 <YAxis fontSize={10} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                 <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(2)} $`, 'Equity']}
                    labelFormatter={(label) => `Datum: ${label}`}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                 />
                 <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                 <Line 
                    type="monotone" 
                    dataKey="cum" 
                    stroke={totalPnL >= 0 ? "#3b82f6" : "#ef4444"} 
                    strokeWidth={3} 
                    dot={false} 
                    activeDot={{ r: 4 }}
                 />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>

         {/* Distribution Chart */}
         <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
           <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Strategie Verteilung (Anzahl)</h4>
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
