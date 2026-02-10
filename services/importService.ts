
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
    // remove currency symbols like CHF, USD, etc. if they are attached
    s = s.replace(/[A-Z]{3}$/, '').trim();
    
    if (!s || s === '-' || s === '--') return 0;
    
    // Heuristic: If comma appears after the last dot, it might be the decimal separator (EU style)
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');

    if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
            // 1.000,00 -> Replace dots, swap comma to dot
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // 1,000.00 -> Remove commas
            s = s.replace(/,/g, '');
        }
    } else if (lastComma > -1) {
        // Safe bet: Remove all commas if it looks like thousands separator
        s = s.replace(/,/g, ''); 
    }
    
    return parseFloat(s) || 0;
  }

  // --- TRADES PARSER ---
  static parseTradesCSV(csvText: string): Record<string, DayEntry> {
      const rows = this.parseCSV(csvText);
      if (rows.length === 0) return {};

      // Scan first few rows to find header
      let parserType = 'generic';

      for(let i=0; i<Math.min(rows.length, 10); i++) {
          const line = rows[i].map(h => h.toLowerCase().trim().replace(/[\ufeff]/g, ''));
          const str = line.join(',');
          
          if (str.includes('fill price') && (str.includes('net amount') || str.includes('netamount')) && str.includes('side')) {
              parserType = 'ibkr_portal';
              break;
          }
          if (str.includes('details_json') || str.includes('notiz')) {
              parserType = 'journal';
              break;
          }
      }

      if (parserType === 'ibkr_portal') {
          return this.parseIBKRClientPortalCSV(rows);
      } else if (parserType === 'journal') {
          return this.parseJournalCSV(rows);
      }
      
      return this.parseIBKRGenericCSV(rows);
  }

  private static parseIBKRClientPortalCSV(rows: string[][]): Record<string, DayEntry> {
      const result: Record<string, DayEntry> = {};
      
      // 1. DYNAMIC HEADER DETECTION
      let headerIdx = -1;
      for(let i=0; i<rows.length; i++) {
          const line = rows[i].map(c => c.toLowerCase().trim().replace(/[\ufeff\r\n]/g, ''));
          if (line.includes('symbol') && (line.includes('net amount') || line.includes('netamount'))) {
              headerIdx = i;
              break;
          }
      }
      if (headerIdx === -1) return {};

      const headers = rows[headerIdx].map(h => h.trim().toLowerCase().replace(/[\ufeff\r\n]/g, ''));

      const idxSymbol = headers.indexOf('symbol');
      const idxSide = headers.indexOf('side');
      const idxQty = headers.indexOf('qty');
      const idxPrice = headers.findIndex(h => h.includes('price')); 
      const idxTime = headers.indexOf('time'); 
      const idxNet = headers.findIndex(h => h.includes('net amount') || h.includes('netamount'));
      const idxComm = headers.findIndex(h => h.includes('commission') || h.includes('comm'));

      if (idxSymbol === -1 || idxNet === -1) return {};

      // --- 2. EXTRACT RAW EXECUTIONS ---
      interface RawExec {
          symbol: string;
          side: 'buy' | 'sell';
          qty: number;
          price: number;
          date: string; // YYYY-MM-DD
          time: string; // HH:MM
          dateTime: number; // timestamp for sorting
          fee: number; // Total fee for this execution
          unitFee: number; // Fee per 1 qty
          netAmount: number; // for multiplier check
      }

      const executions: RawExec[] = [];

      for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2) continue; // Skip empty lines

          const timeRaw = row[idxTime]; 
          if (!timeRaw) continue;
          
          // Robust Date Parsing
          let dateStr = '';
          let timeStr = '00:00';
          let timestamp = 0;

          try {
              // Handle formats like "2025-02-10 15:30:00" or "20250210;153000" or "10/02/2025"
              const cleanTimeRaw = timeRaw.replace(/,/g, ' ').replace(/;/g, ' ').trim();
              
              if (cleanTimeRaw.match(/^\d{4}-\d{2}-\d{2}/)) {
                  // ISO Format
                  const parts = cleanTimeRaw.split(' ');
                  dateStr = parts[0];
                  timeStr = parts[1]?.substring(0, 5) || '00:00';
                  timestamp = new Date(cleanTimeRaw).getTime();
              } else {
                  // Fallback: Try Date.parse, if fails, manual split
                  const d = new Date(cleanTimeRaw);
                  if (!isNaN(d.getTime())) {
                      dateStr = d.toISOString().split('T')[0];
                      timeStr = d.toISOString().split('T')[1].substring(0, 5);
                      timestamp = d.getTime();
                  } else {
                      // Basic fallback
                      dateStr = cleanTimeRaw.split(' ')[0];
                  }
              }
          } catch (e) {
              console.warn("Date parse error", timeRaw);
              continue; 
          }

          const sideRaw = row[idxSide]?.toLowerCase() || '';
          let side: 'buy' | 'sell' = 'buy';
          if (sideRaw.includes('sell') || sideRaw === 's' || sideRaw === 'sld') side = 'sell';

          const qty = Math.abs(this.parseNum(row[idxQty]));
          const price = this.parseNum(row[idxPrice]);
          const fee = Math.abs(this.parseNum(row[idxComm]));
          let symbol = row[idxSymbol];

          // Parse Net Amount Robustly (can contain codes)
          let netAmount = 0;
          if (row[idxNet]) {
              const cleanNet = row[idxNet].replace(/[A-Z]{3}/g, '').trim();
              netAmount = Math.abs(this.parseNum(cleanNet));
          }

          if (qty > 0) {
              executions.push({
                  symbol,
                  side,
                  qty,
                  price,
                  date: dateStr,
                  time: timeStr,
                  dateTime: timestamp,
                  fee,
                  unitFee: fee / qty,
                  netAmount
              });
          }
      }

      // --- 3. SORT BY TIME ---
      executions.sort((a, b) => a.dateTime - b.dateTime);

      // --- 4. FIFO MATCHING ---
      const inventory: Record<string, RawExec[]> = {};
      const completedTrades: (Trade & { date: string })[] = [];

      for (const exec of executions) {
          if (!inventory[exec.symbol]) inventory[exec.symbol] = [];
          const queue = inventory[exec.symbol];

          // Logic: If queue is empty or matches side -> Open
          // If queue has opposite side -> Close
          const isOpen = queue.length === 0 || queue[0].side === exec.side;

          if (isOpen) {
              queue.push(exec);
          } else {
              // CLOSING TRADE
              let remainingQty = exec.qty;
              
              while (remainingQty > 0 && queue.length > 0) {
                  const openExec = queue[0];
                  const matchQty = Math.min(remainingQty, openExec.qty);
                  
                  // DETERMINE MULTIPLIER
                  // NetAmount ~= Price * Qty * Multiplier
                  let multiplier = 1;
                  if (openExec.netAmount !== 0 && openExec.price > 0) {
                      multiplier = Math.abs(openExec.netAmount / (openExec.price * openExec.qty));
                      // Snap to common multipliers
                      if (Math.abs(multiplier - 50) < 1) multiplier = 50; // ES
                      else if (Math.abs(multiplier - 5) < 0.1) multiplier = 5; // MES
                      else if (Math.abs(multiplier - 20) < 0.5) multiplier = 20; // NQ
                      else if (Math.abs(multiplier - 2) < 0.1) multiplier = 2; // MNQ
                      else if (Math.abs(multiplier - 1000) < 10) multiplier = 1000; // CL
                      else multiplier = Math.round(multiplier);
                      if (multiplier === 0) multiplier = 1;
                  }

                  // PnL CALCULATION
                  const priceDiff = exec.price - openExec.price;
                  const direction = openExec.side === 'buy' ? 1 : -1; // 1 = Long, -1 = Short
                  const grossPnL = priceDiff * matchQty * multiplier * direction;
                  
                  // Fee Calculation (Roundturn)
                  // Closing Fee Part:
                  const closingFeePart = exec.unitFee * matchQty;
                  // Opening Fee Part:
                  const openingFeePart = openExec.unitFee * matchQty;
                  
                  const totalRoundturnFee = closingFeePart + openingFeePart;

                  // Prepend asset class to symbol if Future detected
                  let displaySymbol = exec.symbol;
                  if (multiplier === 50) displaySymbol = "ES " + displaySymbol;
                  else if (multiplier === 5) displaySymbol = "MES " + displaySymbol;
                  else if (multiplier === 20) displaySymbol = "NQ " + displaySymbol;
                  else if (multiplier === 2) displaySymbol = "MNQ " + displaySymbol;

                  const trade: Trade & { date: string } = {
                      date: exec.date, // Trade date is closing date
                      inst: displaySymbol,
                      qty: parseFloat(matchQty.toFixed(4)), 
                      pnl: parseFloat(grossPnL.toFixed(2)), 
                      fee: parseFloat(totalRoundturnFee.toFixed(2)),
                      start: openExec.time,
                      end: exec.time,
                      tag: '',
                      strategy: direction === 1 ? 'Long-Cont.' : 'Short-Cont.' 
                  };
                  completedTrades.push(trade);

                  remainingQty -= matchQty;
                  openExec.qty -= matchQty;
                  
                  if (openExec.qty <= 0.0001) {
                      queue.shift(); // Remove fully closed position
                  }
              }
              
              // If we oversold/overbought (flipping position), the remaining becomes a new open
              if (remainingQty > 0.0001) {
                  const remainderExec: RawExec = {
                      ...exec,
                      qty: remainingQty,
                      fee: exec.unitFee * remainingQty, // Recalc total fee for remainder
                      unitFee: exec.unitFee, // Unit fee stays same
                      netAmount: (exec.netAmount / exec.qty) * remainingQty // Pro-rate net amount
                  };
                  queue.push(remainderExec);
              }
          }
      }

      // --- 5. GROUP BY DATE ---
      completedTrades.forEach(t => {
          if (!result[t.date]) {
              result[t.date] = { total: 0, fees: 0, trades: [], note: '', screenshots: [] };
          }
          result[t.date].trades.push(t);
          
          // Recalculate Day Totals
          const day = result[t.date];
          const gross = day.trades.reduce((s, tr) => s + (tr.pnl || 0), 0);
          const fees = day.trades.reduce((s, tr) => s + (tr.fee || 0), 0);
          day.fees = fees;
          day.total = gross - fees;
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
