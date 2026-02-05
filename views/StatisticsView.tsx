
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
  Pie
} from 'recharts';
import { AppData, DayEntry, Trade } from '../types';
import { TrendingUp, Clock, Target, Layers } from 'lucide-react';

interface Props {
  data: AppData;
}

const StatisticsView: React.FC<Props> = ({ data }) => {
  const tradeEntries = Object.entries(data.trades) as [string, DayEntry][];
  const allTrades: (Trade & { date: string })[] = [];
  
  tradeEntries.forEach(([date, entry]) => {
    entry.trades.forEach(t => {
      allTrades.push({ ...t, date });
    });
  });

  const tradeData = tradeEntries.map(([date, entry]) => ({
    date: date.split('-').slice(1).join('.'),
    pnl: entry.total,
    count: entry.trades.length
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Strategy Analysis
  const strategyStats = allTrades.reduce((acc: any, t) => {
    const strat = t.strategy || 'Unknown';
    if (!acc[strat]) acc[strat] = { name: strat, count: 0, pnl: 0 };
    acc[strat].count += 1;
    acc[strat].pnl += t.pnl;
    return acc;
  }, {});

  const strategyData = Object.values(strategyStats);

  // Duration Analysis
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

  const totalPnL = tradeData.reduce((s, d) => s + d.pnl, 0);
  const winRate = allTrades.length > 0 
    ? (allTrades.filter(t => t.pnl > 0).length / allTrades.length * 100).toFixed(1) 
    : 0;

  return (
    <div className="space-y-8 pb-12">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt PnL', value: `${totalPnL.toLocaleString()} $`, icon: TrendingUp, color: 'blue' },
          { label: 'Win Rate', value: `${winRate}%`, icon: Target, color: 'green' },
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
            <div className="text-xl font-black text-gray-800">{stat.value}</div>
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
                <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
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
           <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Equity Curve</h4>
           <div className="h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={tradeData.reduce((acc: any[], curr) => {
                 const last = acc.length > 0 ? acc[acc.length-1].cum : 0;
                 acc.push({ ...curr, cum: last + curr.pnl });
                 return acc;
               }, [])}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                 <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} />
                 <YAxis fontSize={10} axisLine={false} tickLine={false} />
                 <Tooltip />
                 <Line type="monotone" dataKey="cum" stroke="#3b82f6" strokeWidth={3} dot={false} />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>

         {/* Distribution Chart */}
         <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
           <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Strategie Verteilung</h4>
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
                     <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'][index % 4]} />
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
