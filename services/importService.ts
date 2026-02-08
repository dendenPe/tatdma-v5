
import { PortfolioYear, PortfolioPosition, DayEntry, Trade, SalaryEntry, AppData, TaxExpense } from '../types';

export class ImportService {
  
  // --- ROBUST CSV PARSER ---
  private static parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuote = false;
    
    // Normalize line endings
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const nextChar = cleanText[i + 1];
      
      if (char === '"') {
        if (inQuote && nextChar === '"') {
          currentCell += '"';
          i++; 
        } else {
          inQuote = !inQuote;
        }
      } else if ((char === ',' || char === ';') && !inQuote) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\n' && !inQuote) {
        currentRow.push(currentCell.trim());
        if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) {
             rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    if (currentCell || currentRow.length > 0) {
       currentRow.push(currentCell.trim());
       rows.push(currentRow);
    }
    return rows;
  }

  private static parseNum(str: any): number {
    if (!str) return 0;
    let s = String(str).replace(/["']/g, '').trim();
    if (!s || s === '-' || s === '--') return 0;
    
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');

    if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(/,/g, '');
    }
    
    return parseFloat(s) || 0;
  }

  // --- TRADES PARSER ---
  static parseTradesCSV(csvText: string): Record<string, DayEntry> {
      const rows = this.parseCSV(csvText);
      if (rows.length === 0) return {};

      const headerLine = rows[0].map(h => h.toLowerCase().trim());
      const headerString = headerLine.join(',');

      if (headerString.includes('fill price') && headerString.includes('net amount') && headerString.includes('side')) {
          return this.parseIBKRClientPortalCSV(rows);
      }
      
      if (headerString.includes('details_json') || headerString.includes('notiz')) {
          return this.parseJournalCSV(rows);
      }
      
      return this.parseIBKRGenericCSV(rows);
  }

  private static parseIBKRClientPortalCSV(rows: string[][]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      const headers = rows[0].map(h => h.trim().toLowerCase());

      const idxSymbol = headers.indexOf('symbol');
      const idxSide = headers.indexOf('side');
      const idxQty = headers.indexOf('qty');
      const idxPrice = headers.findIndex(h => h.includes('price')); 
      const idxTime = headers.indexOf('time'); 
      const idxNet = headers.findIndex(h => h.includes('net amount') || h.includes('netamount'));
      const idxComm = headers.findIndex(h => h.includes('commission') || h.includes('comm'));

      if (idxSymbol === -1 || idxNet === -1) return {};

      const aggs: Record<string, Record<string, { 
          buyVol: number, 
          sellVol: number, 
          fees: number, 
          qty: number, 
          times: string[]
      }>> = {};

      for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < headers.length) continue;

          const timeRaw = row[idxTime]; 
          if (!timeRaw) continue;
          
          const dateStr = timeRaw.split(' ')[0]; 
          const timeStr = timeRaw.split(' ')[1]?.substring(0, 5) || '00:00';

          const side = row[idxSide].toLowerCase(); 
          const qty = this.parseNum(row[idxQty]);
          const price = this.parseNum(row[idxPrice]);
          const netAmount = Math.abs(this.parseNum(row[idxNet])); 
          const fee = Math.abs(this.parseNum(row[idxComm]));
          let symbol = row[idxSymbol];

          let multiplier = 1;
          if (price > 0 && qty > 0) {
              multiplier = Math.round(netAmount / (price * qty));
          }

          if (multiplier === 50) symbol = "ES " + symbol;
          else if (multiplier === 5) symbol = "MES " + symbol;
          else if (multiplier === 20) symbol = "NQ " + symbol;
          else if (multiplier === 2) symbol = "MNQ " + symbol;

          if (!aggs[dateStr]) aggs[dateStr] = {};
          if (!aggs[dateStr][symbol]) {
              aggs[dateStr][symbol] = { buyVol: 0, sellVol: 0, fees: 0, qty: 0, times: [] };
          }

          const entry = aggs[dateStr][symbol];
          entry.fees += fee;
          entry.qty += qty;
          entry.times.push(timeStr);

          if (side === 'buy' || side === 'b') {
              entry.buyVol += netAmount;
          } else {
              entry.sellVol += netAmount;
          }
      }

      Object.keys(aggs).forEach(date => {
          const dayData = aggs[date];
          const trades: Trade[] = [];
          let dayTotalPnL = 0;
          let dayTotalFees = 0;

          Object.keys(dayData).forEach(symbol => {
              const d = dayData[symbol];
              let grossPnL = d.sellVol - d.buyVol;
              
              const trade: Trade = {
                  inst: symbol,
                  qty: d.qty, 
                  pnl: grossPnL, 
                  fee: d.fees,
                  start: d.times.sort()[0],
                  end: d.times.sort()[d.times.length - 1],
                  tag: '',
                  strategy: grossPnL >= 0 ? 'Long-Agg.' : 'Short-Agg.'
              };
              
              trades.push(trade);
              dayTotalPnL += (grossPnL - d.fees);
              dayTotalFees += d.fees;
          });

          result[date] = {
              total: dayTotalPnL,
              fees: dayTotalFees,
              trades: trades,
              note: '',
              screenshots: []
          };
      });

      return result;
  }

  private static parseIBKRGenericCSV(rows: string[][]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      
      const headerRowIdx = rows.findIndex(row => {
          const line = row.join(' ').toLowerCase();
          const hasTime = line.includes('date') || line.includes('time');
          const hasSymbol = line.includes('symbol') || line.includes('description');
          return hasTime && hasSymbol;
      });
      
      if (headerRowIdx === -1) return result;

      const headers = rows[headerRowIdx].map(h => h.trim().toLowerCase());
      
      const idxDate = headers.findIndex(h => h.includes('date/time') || h === 'date' || h === 'time');
      const idxSymbol = headers.findIndex(h => h === 'symbol' || h === 'description');
      const idxQty = headers.findIndex(h => h.includes('quantity') || h === 'qty');
      const idxComm = headers.findIndex(h => h.includes('comm') || h.includes('fee'));
      const idxRealized = headers.findIndex(h => h.includes('realized') || h.includes('p/l'));
      
      if (idxRealized === -1) return result; 

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < headers.length) continue;

          const dateRaw = row[idxDate];
          if (!dateRaw) continue;
          
          let dateStr = dateRaw.split(',')[0].trim();
          if (dateStr.includes(' ')) dateStr = dateStr.split(' ')[0];

          if (!result[dateStr]) result[dateStr] = { total: 0, fees: 0, trades: [], note: '', screenshots: [] };

          const pnl = this.parseNum(row[idxRealized]);
          const fee = Math.abs(this.parseNum(row[idxComm]));
          const qty = Math.abs(this.parseNum(row[idxQty]));
          const symbol = row[idxSymbol];

          if (pnl === 0 && fee === 0) continue;

          const trade: Trade = {
              pnl: pnl,
              fee: fee,
              inst: symbol,
              qty: qty,
              start: '00:00',
              end: '00:00',
              tag: '',
              strategy: 'Day-Trade'
          };

          result[dateStr].trades.push(trade);
          result[dateStr].total += pnl; 
          result[dateStr].fees = (result[dateStr].fees || 0) + fee;
      }
      return result;
  }

  private static parseJournalCSV(rows: string[][]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      const headers = rows[0].map(h => h.toLowerCase().trim());
      
      const idxDate = headers.findIndex(h => h.includes('datum') || h.includes('date'));
      const idxPnL = headers.findIndex(h => h === 'pnl' || h === 'total');
      const idxJson = headers.findIndex(h => h.includes('details') || h.includes('json'));

      for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2) continue;
          const date = row[idxDate];
          if (!date) continue;

          const entry: DayEntry = {
              total: this.parseNum(row[idxPnL]),
              note: '',
              trades: [],
              screenshots: [],
              fees: 0
          };

          try {
              if (row[idxJson]) {
                  const trades = JSON.parse(row[idxJson]);
                  if (Array.isArray(trades)) entry.trades = trades;
              }
          } catch {}
          
          result[date] = entry;
      }
      return result;
  }

  static parseSalaryCSV(csvText: string): Record<string, Record<string, SalaryEntry>> {
    const rows = this.parseCSV(csvText);
    const result: Record<string, Record<string, SalaryEntry>> = {};
    if (rows.length < 2) return result;
    return result; 
  }
  
  // --- UPDATED IBKR PORTFOLIO PARSER FOR GERMAN FORMAT ---
  static parseIBKRPortfolioCSV(csvText: string, existingRates: Record<string, number> = {}): PortfolioYear {
      const rows = this.parseCSV(csvText);
      const yearData: PortfolioYear = {
          positions: {},
          cash: {},
          summary: { totalValue: 0, unrealized: 0, realized: 0, dividends: 0, tax: 0 },
          lastUpdate: new Date().toISOString(),
          exchangeRates: { ...existingRates }
      };

      let posHeader: Record<string, number> = {};
      let realHeader: Record<string, number> = {}; 
      let forexHeader: Record<string, number> = {}; // Header map for fallback exchange rates
      let mtmHeader: Record<string, number> = {};   // Header map for MtM (another fallback)
      let inOpenPositions = false;
      
      // Scan rows
      for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const section = row[0] ? row[0].trim() : ''; 
          const type = row[1] ? row[1].trim() : ''; 

          // 1. OPEN POSITIONS (Offene Positionen)
          if (section === 'Offene Positionen') {
              if (type === 'Header') {
                  row.forEach((col, idx) => {
                      posHeader[col.toLowerCase()] = idx;
                  });
                  inOpenPositions = true;
              } else if (type === 'Data' && inOpenPositions) {
                  const catIdx = posHeader['vermögenswertkategorie'];
                  const cat = row[catIdx];
                  
                  if (cat === 'Aktien' || cat === 'Stocks') {
                      const sym = row[posHeader['symbol']];
                      const qty = this.parseNum(row[posHeader['menge']]); 
                      const val = this.parseNum(row[posHeader['wert']]); 
                      const cost = this.parseNum(row[posHeader['einstands kurs']]); 
                      const close = this.parseNum(row[posHeader['schlusskurs']]); 
                      const unreal = this.parseNum(row[posHeader['unrealisierter g/v']]); 
                      const curr = row[posHeader['währung']]; 

                      if (sym && qty !== 0) {
                          const pos: PortfolioPosition = {
                              symbol: sym,
                              qty: qty,
                              cost: cost,
                              close: close,
                              val: val,
                              unReal: unreal,
                              real: 0, 
                              currency: curr || 'USD'
                          };
                          yearData.positions[sym] = pos;
                          
                          if (curr === 'USD') {
                              yearData.summary.totalValue += val;
                              yearData.summary.unrealized += unreal;
                          }
                      }
                  }
              }
          }

          // 2. REALIZED PnL (Closed/Sold Positions)
          if (section.includes('realisierten') && section.includes('Performance')) {
              if (type === 'Header') {
                  row.forEach((col, idx) => {
                      realHeader[col.trim().toLowerCase()] = idx;
                  });
              } else if (type === 'Data') {
                  const catIdx = realHeader['vermögenswertkategorie'];
                  const cat = row[catIdx];
                  
                  if (cat === 'Aktien' || cat === 'Stocks') {
                      const symIdx = realHeader['symbol'];
                      const sym = row[symIdx];
                      
                      let realTotalIdx = realHeader['realisiert gesamt'];
                      if (realTotalIdx === undefined) realTotalIdx = realHeader['realized total'];
                      
                      const realVal = this.parseNum(row[realTotalIdx]);

                      if (sym && realVal !== 0) {
                          if (yearData.positions[sym]) {
                              yearData.positions[sym].real = realVal;
                          } else {
                              yearData.positions[sym] = {
                                  symbol: sym,
                                  qty: 0,
                                  cost: 0,
                                  close: 0,
                                  val: 0,
                                  unReal: 0,
                                  real: realVal,
                                  currency: 'USD' 
                              };
                          }
                          yearData.summary.realized += realVal;
                      }
                  }
              }
          }

          // 3. CASH (Cash-Bericht)
          if (section === 'Cash-Bericht') {
              if (type === 'Data') {
                  const label = row[2]; 
                  const curr = row[3]; 
                  const amount = this.parseNum(row[4]); 

                  if (label === 'Endbarsaldo') {
                      if (curr && curr.length === 3) {
                          yearData.cash[curr] = amount;
                      }
                  }
              }
          }

          // 4. DIVIDENDS TOTAL
          if (section === 'Dividenden' && type === 'Data') {
              const desc = row.join(' ');
              if (desc.includes('Gesamt Dividenden in USD')) {
                  for (let k = row.length - 1; k >= 0; k--) {
                      if (row[k] && !isNaN(parseFloat(row[k]))) {
                          yearData.summary.dividends = this.parseNum(row[k]);
                          break;
                      }
                  }
              }
          }

          // 5. TAX TOTAL
          if (section === 'Quellensteuer' && type === 'Data') {
              const desc = row.join(' ');
              if (desc.includes('Gesamt Quellensteuer in USD')) {
                  for (let k = row.length - 1; k >= 0; k--) {
                      if (row[k] && !isNaN(parseFloat(row[k]))) {
                          yearData.summary.tax = Math.abs(this.parseNum(row[k]));
                          break;
                      }
                  }
              }
          }

          // 6. EXCHANGE RATES (Direct Table)
          if (section === 'Wechselkurse' || section === 'Exchange Rates') {
              if (type === 'Data') {
                  const fromCurr = row[2];
                  const toCurr = row[3];
                  const rate = this.parseNum(row[4]);

                  if (fromCurr && toCurr && rate > 0) {
                      yearData.exchangeRates[`${fromCurr}_${toCurr}`] = rate;
                  }
              }
          }

          // 7. FALLBACK: EXCHANGE RATES FROM "Devisenpositionen"
          // If explicit table is missing, try to infer rates from Forex Positions
          if (section === 'Devisenpositionen' || section === 'Forex Positions') {
              if (type === 'Header') {
                  row.forEach((col, idx) => forexHeader[col.toLowerCase()] = idx);
              } else if (type === 'Data') {
                  // Find indices dynamically
                  let symIdx = forexHeader['beschreibung']; // Often Description is the Symbol e.g. CHF
                  if (symIdx === undefined) symIdx = forexHeader['symbol'];
                  if (symIdx === undefined) symIdx = forexHeader['description'];

                  // Close price is usually "Schlusskurs"
                  let closeIdx = forexHeader['schlusskurs'];
                  if (closeIdx === undefined) closeIdx = forexHeader['close price'];

                  if (symIdx !== undefined && closeIdx !== undefined) {
                      const sym = row[symIdx]; // e.g. CHF
                      const rate = this.parseNum(row[closeIdx]); // e.g. 1.3015 (Price of CHF in Base Currency USD)
                      
                      // Check if it's a valid currency code (3 letters) and not USD itself
                      if (sym && sym.length === 3 && sym !== 'USD' && rate > 0) {
                          // The report usually gives price of Foreign Currency in Base Currency (USD)
                          // So 1 CHF = 1.3015 USD => Rate is CHF_USD
                          yearData.exchangeRates[`${sym}_USD`] = rate;
                          
                          // Also store the inverse which app uses for display: USD_CHF = 1 / 1.3015
                          yearData.exchangeRates[`USD_${sym}`] = 1 / rate;
                      }
                  }
              }
          }
          
          // 8. FALLBACK 2: EXCHANGE RATES FROM "Mark-to-Market"
          // Sometimes "Devisenpositionen" is empty but MtM has it
          if (section.startsWith('Mark-to-Market')) {
              if (type === 'Header') {
                  row.forEach((col, idx) => mtmHeader[col.toLowerCase()] = idx);
              } else if (type === 'Data') {
                  const catIdx = mtmHeader['vermögenswertkategorie'];
                  const cat = row[catIdx];
                  if (cat === 'Devisen' || cat === 'Forex') {
                      const symIdx = mtmHeader['symbol'];
                      const sym = row[symIdx];
                      const closeIdx = mtmHeader['aktuell kurs']; // Current Price
                      
                      if (sym && sym.length === 3 && sym !== 'USD' && closeIdx !== undefined) {
                          const rate = this.parseNum(row[closeIdx]);
                          if (rate > 0) {
                              yearData.exchangeRates[`${sym}_USD`] = rate;
                              yearData.exchangeRates[`USD_${sym}`] = 1 / rate;
                          }
                      }
                  }
              }
          }
      }

      return yearData;
  }
}
