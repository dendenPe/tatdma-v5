
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, User, Loader2, Sparkles } from 'lucide-react';
import { GeminiService } from '../services/geminiService';
import { AppData } from '../types';

interface Props {
    data: AppData;
    isOpen: boolean;
    onClose: () => void;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

const AiAssistant: React.FC<Props> = ({ data, isOpen, onClose }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: 'init', role: 'model', text: 'Hallo! Ich bin dein Finanz-Assistent. Frag mich nach deinen Ausgaben, Trades oder Budget.', timestamp: new Date() }
    ]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    const handleSend = async () => {
        if (!inputText.trim()) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            text: inputText,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsTyping(true);

        try {
            // PREPARE CONTEXT DATA
            const currentYear = new Date().getFullYear().toString();
            const todayStr = new Date().toISOString().split('T')[0];

            // 1. Income & Expenses Summary
            const salaryYTD = Object.values(data.salary[currentYear] || {}).reduce((acc, s) => acc + (s.auszahlung || 0), 0);
            const expensesYTD = (data.dailyExpenses[currentYear] || []).reduce((acc, e) => acc + (e.amount * e.rate), 0);
            
            // 2. Portfolio
            const pid = data.currentPortfolioId || Object.keys(data.portfolios)[0];
            const portfolioVal = data.portfolios[pid]?.years[currentYear]?.summary?.totalValue || 0;

            // 3. DETAILED TRADING CONTEXT
            const tradesList = Object.entries(data.trades);
            
            // A. YTD Total
            const tradesYTD = tradesList
                .filter(([d]) => d.startsWith(currentYear))
                .reduce((acc, [_, t]) => acc + t.total, 0);

            // B. Today's Trades (Full Detail)
            const todayEntry = data.trades[todayStr];
            const todayContext = todayEntry ? {
                netPnL: todayEntry.total,
                fees: todayEntry.fees,
                note: todayEntry.note,
                trades: todayEntry.trades.map(t => ({
                    instrument: t.inst,
                    strategy: t.strategy,
                    pnl: t.pnl,
                    time: `${t.start}-${t.end}`
                }))
            } : "No trades recorded for today yet.";

            // C. Recent History (Last 20 Active Days)
            const recentTradingHistory = tradesList
                .sort((a, b) => b[0].localeCompare(a[0])) // Descending date
                .slice(0, 20) // Last 20 days
                .map(([date, day]) => ({
                    date: date,
                    netPnL: day.total,
                    tradeCount: day.trades.length,
                    winRate: day.trades.length > 0 ? Math.round((day.trades.filter(t => t.pnl > 0).length / day.trades.length) * 100) + '%' : '0%'
                }));

            const contextData = {
                meta: {
                    currentDate: todayStr,
                    year: currentYear
                },
                financials: {
                    netIncomeYTD: salaryYTD,
                    expensesYTD: expensesYTD,
                    portfolioValueUSD: portfolioVal,
                },
                trading: {
                    ytdPnL: tradesYTD,
                    today: todayContext,
                    recentHistory: recentTradingHistory
                },
                budgets: data.budgets || {},
                goals: data.savingsGoals || [],
                recentExpenses: (data.dailyExpenses[currentYear] || []).slice(-10).map(e => `${e.date}: ${e.merchant} (${e.amount} ${e.currency})`),
                taxDeductions: data.tax.expenses.filter(e => e.year === currentYear).map(e => ({cat: e.cat, amount: e.amount, desc: e.desc}))
            };

            // Format history for API
            const apiHistory = messages.map(m => ({ role: m.role, text: m.text }));
            
            const responseText = await GeminiService.chatWithData(apiHistory, contextData, userMsg.text);

            const botMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: responseText,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, botMsg]);

        } catch (e) {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: 'Fehler bei der Verbindung.', timestamp: new Date() }]);
        } finally {
            setIsTyping(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:justify-end pointer-events-none">
            {/* Backdrop for mobile only */}
            <div className="absolute inset-0 bg-black/20 sm:bg-transparent pointer-events-auto sm:pointer-events-none" onClick={onClose} />
            
            <div className="pointer-events-auto bg-white w-full sm:w-[400px] h-[80vh] sm:h-[600px] sm:mr-6 sm:mb-20 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100 animate-in slide-in-from-bottom-10 fade-in duration-300">
                
                {/* Header */}
                <div className="bg-[#16325c] p-4 flex items-center justify-between text-white shadow-md shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-white/10 rounded-lg"><Sparkles size={18} /></div>
                        <div>
                            <h3 className="font-bold text-sm">Finanz Assistent</h3>
                            <p className="text-[10px] text-blue-200">Powered by Gemini AI</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={18}/></button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                    {messages.map(msg => (
                        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                                {msg.role === 'user' ? <User size={14}/> : <Bot size={14}/>}
                            </div>
                            <div className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-700 rounded-tl-none border border-gray-100'}`}>
                                {/* Simple Markdown parser could go here, for now just text */}
                                {msg.text.split('\n').map((line, i) => <p key={i} className="min-h-[1em]">{line}</p>)}
                                <span className={`text-[9px] block mt-1 opacity-70 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                                    {msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                </span>
                            </div>
                        </div>
                    ))}
                    {isTyping && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><Bot size={14}/></div>
                            <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 bg-white border-t border-gray-100 shrink-0">
                    <div className="relative flex items-center">
                        <input 
                            type="text" 
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Frage etwas zu deinen Finanzen..."
                            className="w-full bg-gray-100 border-none rounded-xl py-3 pl-4 pr-12 text-sm focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                            disabled={isTyping}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!inputText.trim() || isTyping}
                            className="absolute right-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {isTyping ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiAssistant;
