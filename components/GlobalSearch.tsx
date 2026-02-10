
import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ChevronRight, FileText, LayoutDashboard, CreditCard, Receipt, Briefcase, Calendar } from 'lucide-react';
import { AppData, NoteDocument, TaxExpense, ExpenseEntry } from '../types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    data: AppData;
    onNavigate: (tab: string, params?: any) => void;
}

interface SearchResult {
    id: string;
    type: 'trade' | 'expense' | 'doc' | 'salary' | 'tax';
    title: string;
    subtitle: string;
    date?: string;
    navTab: string;
    navParams?: any;
    score: number;
}

const GlobalSearch: React.FC<Props> = ({ isOpen, onClose, data, onNavigate }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
            setQuery('');
            setResults([]);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }

        const term = query.toLowerCase();
        const hits: SearchResult[] = [];

        // 1. Search Docs
        Object.values(data.notes || {}).forEach((doc: NoteDocument) => {
            const title = doc.title || '';
            const content = doc.content || '';
            
            if (title.toLowerCase().includes(term) || (content && content.substring(0, 500).toLowerCase().includes(term))) {
                hits.push({
                    id: doc.id,
                    type: 'doc',
                    title: title,
                    subtitle: `Dokument (${doc.category || 'Uncategorized'})`,
                    date: doc.created ? doc.created.split('T')[0] : '',
                    navTab: 'notes',
                    navParams: { noteId: doc.id },
                    score: title.toLowerCase().includes(term) ? 10 : 5
                });
            }
        });

        // 2. Search Expenses
        const allExpenses = Object.values(data.dailyExpenses || {}).flat();
        allExpenses.forEach((exp: ExpenseEntry) => {
            const merchant = exp.merchant || '';
            const desc = exp.description || '';
            
            if (merchant.toLowerCase().includes(term) || (desc && desc.toLowerCase().includes(term))) {
                hits.push({
                    id: exp.id,
                    type: 'expense',
                    title: merchant,
                    subtitle: `${exp.amount} ${exp.currency} - ${desc || exp.category}`,
                    date: exp.date,
                    navTab: 'expenses',
                    score: 8
                });
            }
        });

        // 3. Search Trades (Group by Day)
        Object.entries(data.trades).forEach(([date, entry]) => {
            const note = entry.note || '';
            if (note.toLowerCase().includes(term)) {
                hits.push({
                    id: date,
                    type: 'trade',
                    title: `Trading Journal: ${date}`,
                    subtitle: `Notiz Treffer (${entry.trades ? entry.trades.length : 0} Trades)`,
                    date: date,
                    navTab: 'trading', // Ideally we pass date to trading view
                    score: 6
                });
            }
        });

        // 4. Search Tax
        data.tax.expenses.forEach((exp: TaxExpense, idx) => {
            const desc = exp.desc || '';
            const cat = exp.cat || '';
            
            if (desc.toLowerCase().includes(term) || cat.toLowerCase().includes(term)) {
                hits.push({
                    id: `tax_${idx}`,
                    type: 'tax',
                    title: desc || cat,
                    subtitle: `Steuerabzug ${exp.year}: ${exp.amount} ${exp.currency}`,
                    navTab: 'tax',
                    score: 7
                });
            }
        });

        setResults(hits.sort((a, b) => b.score - a.score).slice(0, 10));
        setSelectedIndex(0);

    }, [query, data]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        } else if (e.key === 'Enter' && results.length > 0) {
            handleSelect(results[selectedIndex]);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    const handleSelect = (item: SearchResult) => {
        // We can pass params later if views support it, for now just basic nav
        onNavigate(item.navTab, item.navParams);
        onClose();
    };

    const getIcon = (type: string) => {
        switch(type) {
            case 'doc': return <FileText size={18} className="text-blue-500" />;
            case 'trade': return <LayoutDashboard size={18} className="text-green-500" />;
            case 'expense': return <CreditCard size={18} className="text-purple-500" />;
            case 'tax': return <Receipt size={18} className="text-orange-500" />;
            default: return <Search size={18} />;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[15vh] p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-200 border border-gray-100 dark:border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                    <Search className="text-gray-400" size={20} />
                    <input 
                        ref={inputRef}
                        type="text" 
                        placeholder="Suche nach Trades, Belegen, Ausgaben..." 
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 bg-transparent outline-none text-lg text-gray-800 dark:text-gray-100 placeholder-gray-400"
                    />
                    <div className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 px-2 py-1 rounded">ESC</div>
                </div>
                
                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {results.length === 0 && query && (
                        <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine Treffer gefunden.</div>
                    )}
                    {results.length === 0 && !query && (
                        <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Tippe um zu suchen...</div>
                    )}
                    
                    {results.map((res, idx) => (
                        <div 
                            key={res.id}
                            onClick={() => handleSelect(res)}
                            className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors ${idx === selectedIndex ? 'bg-blue-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                        >
                            <div className={`p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 shadow-sm shrink-0`}>
                                {getIcon(res.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">{res.title}</h4>
                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <span className="truncate">{res.subtitle}</span>
                                    {res.date && (
                                        <>
                                            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span>
                                            <span className="shrink-0">{res.date}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {idx === selectedIndex && <ChevronRight size={16} className="text-blue-500" />}
                        </div>
                    ))}
                </div>
                
                <div className="p-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 text-[10px] text-gray-400 flex justify-between px-4">
                    <span><strong>↑↓</strong> zum Wählen</span>
                    <span><strong>Enter</strong> zum Öffnen</span>
                </div>
            </div>
        </div>
    );
};

export default GlobalSearch;
