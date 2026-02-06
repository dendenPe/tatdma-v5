
import { PortfolioYear, PortfolioPosition, DayEntry, Trade, SalaryEntry, AppData, TaxExpense } from '../types';

export class ImportService {
  
  // --- HELPER: CSV Zeile splitten (beachtet Anführungszeichen) ---
  private static splitCSV(str: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '"') {
        inQuote = !inQuote;
      } else if ((char === ',' || char === ';') && !inQuote) { // Support both comma and semicolon
        result.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
  }

  private static parseNum(str: any): number {
    if (!str) return 0;
    // Remove ' and spaces
    let s = String(str).replace(/'/g, '').replace(/\s/g, '').trim();
    if (!s || s === '-' || s === '--') return 0;
    
    // Handle German format (1.000,00) vs US format (1,000.00) heuristic
    // If comma exists and is the last separator, replace with dot
    if (s.includes(',') && !s.includes('.')) {
        s = s.replace(',', '.');
    } else if (s.includes(',') && s.includes('.')) {
        // Assume 1.000,00 -> remove dot, replace comma
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
             s = s.replace(/\./g, '').replace(',', '.');
        } 
        // Assume 1,000.00 -> remove comma
        else {
             s = s.replace(/,/g, '');
        }
    }
    
    return parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
  }

  // --- LEGACY JSON IMPORTER (v2/v3 Migration) ---
  static parseLegacyJSON(jsonText: string): Partial<AppData> {
    try {
        const old = JSON.parse(jsonText);
        const result: Partial<AppData> = {};

        // 1. TRADES
        const sourceTrades = old.trades || (old.data && old.data.trades);
        if (sourceTrades) {
            result.trades = sourceTrades;
        }

        // 2. SALARY
        const sourceSalary = old.salary || (old.data && old.data.salary);
        if (sourceSalary) {
            result.salary = sourceSalary;
        }

        // 3. TAX
        const sourceTax = old.tax || old; 
        const sourceExpenses = old.expenses || (old.tax && old.tax.expenses);
        const sourcePersonal = old.personal || (old.tax && old.tax.personal);
        const sourceBalances = old.balances || (old.tax && old.tax.balances);

        if (sourceTax || sourceExpenses || sourcePersonal) {
            result.tax = {
                personal: { name: '', address: '', zip: '', city: '', id: '' },
                expenses: [],
                balances: {}
            };
            
            if (sourcePersonal) result.tax.personal = { ...result.tax.personal, ...sourcePersonal };
            
            if (sourceBalances) {
                result.tax.balances = sourceBalances;
            }

            if (Array.isArray(sourceExpenses)) {
                result.tax.expenses = sourceExpenses.map((exp: any) => {
                    let newCat = exp.cat;
                    if (exp.cat === 'Unterhalt') newCat = 'Alimente';
                    if (exp.cat === 'Krankenkasse') newCat = 'Krankenkassenprämien';
                    
                    return {
                        ...exp,
                        cat: newCat,
                        amount: parseFloat(exp.amount) || 0,
                        year: exp.year || new Date().getFullYear().toString(),
                        currency: exp.currency || 'CHF',
                        rate: exp.rate || 1,
                        receipts: exp.receipts || [],
                        taxRelevant: exp.taxRelevant !== undefined ? exp.taxRelevant : true
                    } as TaxExpense;
                });
            }
            
            if (sourceTax.messageToAuthorities) {
                result.tax.messageToAuthorities = sourceTax.messageToAuthorities;
            }
        }

        if (old.notes) result.notes = old.notes;
        if (old.portfolios) result.portfolios = old.portfolios;

        return result;
    } catch (e) {
        console.error("Legacy Parse Error", e);
        throw new Error("Ungültiges JSON Format oder Datei beschädigt.");
    }
  }

  // --- SALARY PARSER ---
  static parseSalaryCSV(csvText: string): Record<string, Record<string, SalaryEntry>> {
    const lines = csvText.split('\n');
    const result: Record<string, Record<string, SalaryEntry>> = {};
    
    if (lines.length < 2) return result;

    const headerLine = lines[0];
    const headers = this.splitCSV(headerLine).map(h => h.toLowerCase().trim());
    
    const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));

    const colMap = {
        year: findIdx(['jahr', 'year']),
        month: findIdx(['monat', 'month']),
        monatslohn: findIdx(['monatslohn', 'grundlohn', 'salary']),
        familienzulage: findIdx(['familienzulage', 'kinderzulage', 'fazu']),
        pauschalspesen: findIdx(['pauschal', 'spesen']),
        aufrechnung: findIdx(['aufrechnung', 'privatanteil']),
        brutto: findIdx(['brutto', 'gross']),
        ahv: findIdx(['ahv', 'iv', 'eo']),
        alv: findIdx(['alv']),
        sozialfond: findIdx(['sozialfond', 'ktg', 'krankentaggeld']),
        bvg: findIdx(['bvg', 'pensionskasse', 'pk']),
        quellensteuer: findIdx(['quellensteuer', 'qst', 'tax']),
        abzuege: findIdx(['abzüge', 'deductions']),
        netto: findIdx(['netto', 'net']),
        korrektur: findIdx(['korrektur', 'correction']),
        auszahlung: findIdx(['auszahlung', 'payout']),
        kommentar: findIdx(['kommentar', 'bemerkung', 'comment'])
    };

    const normalizeMonth = (m: string): string => {
        m = m.toLowerCase().trim();
        if (!isNaN(parseInt(m))) return String(parseInt(m)).padStart(2, '0');
        if (m.startsWith('jan')) return '01';
        if (m.startsWith('feb')) return '02';
        if (m.startsWith('mär') || m.startsWith('mar')) return '03';
        if (m.startsWith('apr')) return '04';
        if (m.startsWith('mai') || m.startsWith('may')) return '05';
        if (m.startsWith('jun')) return '06';
        if (m.startsWith('jul')) return '07';
        if (m.startsWith('aug')) return '08';
        if (m.startsWith('sep')) return '09';
        if (m.startsWith('okt') || m.startsWith('oct')) return '10';
        if (m.startsWith('nov')) return '11';
        if (m.startsWith('dez') || m.startsWith('dec')) return '12';
        return '00';
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = this.splitCSV(line);

        const year = colMap.year > -1 ? cols[colMap.year] : new Date().getFullYear().toString();
        const monthRaw = colMap.month > -1 ? cols[colMap.month] : '';
        const monthKey = normalizeMonth(monthRaw);

        if (monthKey === '00' || !year) continue;

        if (!result[year]) result[year] = {};

        const entry: SalaryEntry = {
            monatslohn: colMap.monatslohn > -1 ? this.parseNum(cols[colMap.monatslohn]) : 0,
            familienzulage: colMap.familienzulage > -1 ? this.parseNum(cols[colMap.familienzulage]) : 0,
            pauschalspesen: colMap.pauschalspesen > -1 ? this.parseNum(cols[colMap.pauschalspesen]) : 0,
            aufrechnung: colMap.aufrechnung > -1 ? this.parseNum(cols[colMap.aufrechnung]) : 0,
            brutto: colMap.brutto > -1 ? this.parseNum(cols[colMap.brutto]) : 0,
            ahv: colMap.ahv > -1 ? this.parseNum(cols[colMap.ahv]) : 0,
            alv: colMap.alv > -1 ? this.parseNum(cols[colMap.alv]) : 0,
            sozialfond: colMap.sozialfond > -1 ? this.parseNum(cols[colMap.sozialfond]) : 0,
            bvg: colMap.bvg > -1 ? this.parseNum(cols[colMap.bvg]) : 0,
            quellensteuer: colMap.quellensteuer > -1 ? this.parseNum(cols[colMap.quellensteuer]) : 0,
            abzuege: colMap.abzuege > -1 ? this.parseNum(cols[colMap.abzuege]) : 0,
            netto: colMap.netto > -1 ? this.parseNum(cols[colMap.netto]) : 0,
            korrektur: colMap.korrektur > -1 ? this.parseNum(cols[colMap.korrektur]) : 0,
            auszahlung: colMap.auszahlung > -1 ? this.parseNum(cols[colMap.auszahlung]) : 0,
            kommentar: colMap.kommentar > -1 ? cols[colMap.kommentar] : '',
        };

        if (entry.brutto === 0) entry.brutto = entry.monatslohn + entry.familienzulage + entry.pauschalspesen + entry.aufrechnung;
        if (entry.abzuege === 0) entry.abzuege = entry.ahv + entry.alv + entry.sozialfond + entry.bvg + entry.quellensteuer;
        if (entry.netto === 0) entry.netto = entry.brutto - entry.abzuege;
        if (entry.auszahlung === 0) entry.auszahlung = entry.netto + entry.korrektur;

        result[year][monthKey] = entry;
    }
    return result;
  }

  // --- TRADES PARSER (INTELLIGENT: Supports IBKR & JOURNAL Format) ---
  static parseTradesCSV(csvText: string): Record<string, DayEntry> {
      const lines = csvText.split('\n').filter(l => l.trim().length > 0);
      if (lines.length === 0) return {};

      // Detect Format based on Header (Lowercase check)
      const headerLine = lines[0].toLowerCase();
      
      // FORMAT A: Journal/TradeLog Format (Aggregated Day with JSON details)
      // Checks for typical columns found in Journal Export
      if (headerLine.includes('details_json') || headerLine.includes('pnl') || headerLine.includes('notiz') || headerLine.includes('notes')) {
          return this.parseJournalCSV(lines);
      }
      
      // FORMAT B: IBKR/Broker Export (Single Execution Rows)
      return this.parseIBKRCSV(lines);
  }

  // --- IMPLEMENTATION FORMAT A (Journal) ---
  private static parseJournalCSV(lines: string[]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      const headers = this.splitCSV(lines[0]).map(h => h.toLowerCase().trim());
      
      // Flexible Column Mapping
      const idxDate = headers.findIndex(h => h.includes('datum') || h.includes('date') || h.includes('time'));
      const idxPnL = headers.findIndex(h => h === 'pnl' || h === 'total' || h === 'profit' || h.includes('net profit') || h.includes('gewinn'));
      const idxNote = headers.findIndex(h => h.includes('notiz') || h.includes('note') || h.includes('comment') || h.includes('bemerkung'));
      const idxJson = headers.findIndex(h => h.includes('details') || h.includes('json') || h.includes('trades') || h.includes('data'));

      // Helper to convert DD.MM.YYYY to YYYY-MM-DD
      const parseDateDE = (d: string) => {
          if (!d) return '';
          const parts = d.split('.');
          if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
          // Fallback if already ISO or other format
          return d;
      };

      for (let i = 1; i < lines.length; i++) {
          const cols = this.splitCSV(lines[i]);
          if (cols.length < 2) continue;

          const rawDate = idxDate > -1 ? cols[idxDate] : '';
          if (!rawDate) continue;

          const isoDate = parseDateDE(rawDate);
          const totalPnL = idxPnL > -1 ? this.parseNum(cols[idxPnL]) : 0;
          const note = idxNote > -1 ? cols[idxNote] : '';
          const jsonStr = idxJson > -1 ? cols[idxJson] : '[]';

          const entry: DayEntry = {
              total: totalPnL,
              note: note,
              trades: [],
              screenshots: [],
              fees: 0
          };

          try {
              // CSV escaped double quotes "" need to be single " for JSON parsing
              let cleanJson = jsonStr;
              if (cleanJson.startsWith('"') && cleanJson.endsWith('"')) {
                  cleanJson = cleanJson.substring(1, cleanJson.length - 1);
              }
              cleanJson = cleanJson.replace(/""/g, '"');
              
              if (cleanJson.length > 2) {
                  const tradesData = JSON.parse(cleanJson);
                  if (Array.isArray(tradesData)) {
                      entry.trades = tradesData.map((t: any) => ({
                          pnl: Number(t.pnl) || 0,
                          fee: Number(t.fee) || 0,
                          inst: t.symbol || t.inst || 'UNK',
                          qty: Number(t.qty) || 1,
                          start: t.start || '',
                          end: t.end || '',
                          tag: t.tag || '',
                          strategy: t.strategy || (Number(t.pnl) > 0 ? 'Long-Cont.' : 'Short-Cont.')
                      }));
                  }
              }
          } catch (e) {
              console.warn(`JSON Parse Error in line ${i}:`, e);
          }
          
          result[isoDate] = entry;
      }
      return result;
  }

  // --- IMPLEMENTATION FORMAT B (IBKR/Broker) ---
  private static parseIBKRCSV(lines: string[]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      
      const headerIndex = lines.findIndex(l => {
          const lower = l.toLowerCase();
          return lower.includes('date') && (lower.includes('symbol') || lower.includes('description') || lower.includes('underlying'));
      });
      
      if (headerIndex === -1) return result;

      const headers = this.splitCSV(lines[headerIndex]).map(h => h.trim().toLowerCase());
      
      const idxDate = headers.findIndex(h => h.includes('date/time') || h === 'date');
      const idxSymbol = headers.findIndex(h => h === 'symbol' || h === 'financial instrument' || h === 'description');
      const idxQty = headers.findIndex(h => h === 'quantity' || h === 'qty');
      const idxComm = headers.findIndex(h => h === 'comm/fee' || h === 'commission');
      const idxRealized = headers.findIndex(h => h.includes('realized') || h.includes('net amount') || h.includes('profit')); 
      
      const dataLines = lines.slice(headerIndex + 1);

      dataLines.forEach(line => {
          const cols = this.splitCSV(line);
          if (cols.length < headers.length) return;

          const rawDate = cols[idxDate];
          if (!rawDate) return;

          let dateStr = '';
          let timeStr = '00:00';
          
          // Handle "2026-01-29 20:06:05" or "2026-01-29, 20:06:05"
          const cleanDateRaw = rawDate.replace(',', ''); 
          if (cleanDateRaw.includes(' ')) {
              const parts = cleanDateRaw.split(' ');
              dateStr = parts[0].trim();
              timeStr = parts[1].trim().substring(0,5);
          } else {
              dateStr = cleanDateRaw.trim();
          }

          if (!result[dateStr]) {
              result[dateStr] = {
                  total: 0,
                  note: '',
                  trades: [],
                  screenshots: [],
                  fees: 0
              };
          }

          const qty = this.parseNum(cols[idxQty]);
          const pnl = idxRealized > -1 ? this.parseNum(cols[idxRealized]) : 0;
          const fee = idxComm > -1 ? Math.abs(this.parseNum(cols[idxComm])) : 0;
          const symbol = cols[idxSymbol];

          if (!symbol || (isNaN(qty) && isNaN(pnl))) return;

          const trade: Trade = {
              pnl: pnl,
              fee: fee,
              inst: symbol,
              qty: Math.abs(qty),
              start: timeStr,
              end: timeStr,
              tag: '',
              strategy: qty > 0 ? 'Long-Cont.' : 'Short-Cont.'
          };
          
          result[dateStr].trades.push(trade);
          result[dateStr].fees = (result[dateStr].fees || 0) + fee;
          result[dateStr].total += pnl; 
      });
      
      return result;
  }

  // --- IBKR PORTFOLIO PARSER ---
  static parseIBKRPortfolioCSV(csvText: string, currentRates: Record<string, number>): { 
      positions: Record<string, PortfolioPosition>, 
      cash: Record<string, number>, 
      summary: any,
      exchangeRates: Record<string, number>,
      lastUpdate: string
  } {
      const positions: Record<string, PortfolioPosition> = {};
      const cash: Record<string, number> = {};
      const exchangeRates = { ...currentRates };
      const summary = { totalValue: 0, unrealized: 0, realized: 0, dividends: 0, tax: 0 };
      
      const lines = csvText.split('\n');
      
      lines.forEach(line => {
          const cols = this.splitCSV(line);

          if (cols[0] === 'Cash Report' && cols[1] === 'Data') {
              const curr = cols[2];
              const total = this.parseNum(cols[3]);
              if (curr && !isNaN(total)) cash[curr] = total;
          }
          
          if (cols[0] === 'Open Positions' && cols[1] === 'Data') {
              const symbol = cols[3];
              const qty = this.parseNum(cols[4]);
              const closePrice = this.parseNum(cols[7]);
              const value = this.parseNum(cols[8]);
              const unrealized = this.parseNum(cols[9]);
              const cost = this.parseNum(cols[6]);
              
              if (symbol && symbol !== 'Total') {
                 let curr = 'USD';
                 if (symbol.includes('.SW') || symbol.includes('CHF')) curr = 'CHF';
                 if (symbol.includes('.DE') || symbol.includes('EUR')) curr = 'EUR';
                 
                 positions[symbol] = {
                     symbol,
                     currency: curr,
                     qty,
                     cost: cost / qty,
                     close: closePrice,
                     val: value,
                     unReal: unrealized,
                     real: 0
                 };
              }
          }
          
          if (cols[0] === 'Net Asset Value' && cols[1] === 'Data' && cols[2] === 'Total') {
              summary.totalValue = this.parseNum(cols[4]);
          }
      });
      
      return { 
          positions, 
          cash, 
          summary, 
          exchangeRates,
          lastUpdate: new Date().toISOString()
      };
  }
}
