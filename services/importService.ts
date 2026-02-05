import { PortfolioYear, PortfolioPosition, DayEntry, Trade, SalaryEntry } from '../types';

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

  // --- SALARY PARSER ---
  static parseSalaryCSV(csvText: string): Record<string, Record<string, SalaryEntry>> {
    const lines = csvText.split('\n');
    const result: Record<string, Record<string, SalaryEntry>> = {};
    
    if (lines.length < 2) return result;

    // Detect Headers
    const headerLine = lines[0];
    const headers = this.splitCSV(headerLine).map(h => h.toLowerCase().trim());
    
    // Mapping helper
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
        sozialfond: findIdx(['sozialfond', 'ktg', 'krankentaggeld']), // Often grouped
        bvg: findIdx(['bvg', 'pensionskasse', 'pk']),
        quellensteuer: findIdx(['quellensteuer', 'qst', 'tax']),
        abzuege: findIdx(['abzüge', 'deductions']),
        netto: findIdx(['netto', 'net']),
        korrektur: findIdx(['korrektur', 'correction']),
        auszahlung: findIdx(['auszahlung', 'payout']),
        kommentar: findIdx(['kommentar', 'bemerkung', 'comment'])
    };

    // Helper to normalize months (1, 01, Jan, Januar -> 01)
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

        // Get Year and Month
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
            ahv: colMap.ahv > -1 ? Math.abs(this.parseNum(cols[colMap.ahv])) : 0,
            alv: colMap.alv > -1 ? Math.abs(this.parseNum(cols[colMap.alv])) : 0,
            sozialfond: colMap.sozialfond > -1 ? Math.abs(this.parseNum(cols[colMap.sozialfond])) : 0,
            bvg: colMap.bvg > -1 ? Math.abs(this.parseNum(cols[colMap.bvg])) : 0,
            quellensteuer: colMap.quellensteuer > -1 ? Math.abs(this.parseNum(cols[colMap.quellensteuer])) : 0,
            abzuege: colMap.abzuege > -1 ? Math.abs(this.parseNum(cols[colMap.abzuege])) : 0,
            netto: colMap.netto > -1 ? this.parseNum(cols[colMap.netto]) : 0,
            korrektur: colMap.korrektur > -1 ? this.parseNum(cols[colMap.korrektur]) : 0,
            auszahlung: colMap.auszahlung > -1 ? this.parseNum(cols[colMap.auszahlung]) : 0,
            kommentar: colMap.kommentar > -1 ? cols[colMap.kommentar] : '',
        };

        const calcBrutto = entry.brutto || (entry.monatslohn + entry.familienzulage + entry.pauschalspesen + entry.aufrechnung);
        const calcAbzuege = entry.abzuege || (entry.ahv + entry.alv + entry.sozialfond + entry.bvg + entry.quellensteuer);
        
        entry.brutto = calcBrutto;
        entry.abzuege = calcAbzuege;
        if (!entry.netto) entry.netto = calcBrutto - calcAbzuege;
        if (!entry.auszahlung) entry.auszahlung = entry.netto + entry.korrektur;

        result[year][monthKey] = entry;
    }

    return result;
  }

  // --- PORTFOLIO PARSER (HOLDINGS) ---
  static parseIBKRPortfolioCSV(csvText: string, currentRates: Record<string, number>): PortfolioYear {
    const lines = csvText.split('\n');
    let reportStartDate = '';
    let reportEndDate = '';
    
    // Kopie der Rates erstellen
    const newRates = { ...currentRates };

    const positions: Record<string, PortfolioPosition> = {};
    const cash: Record<string, number> = {};
    let totalDividendsUSD = 0;
    let totalWithholdingTaxUSD = 0;
    
    let colMap: Record<string, number> = {}; 
    let currentSection = "";

    const getIdx = (keys: string[]) => {
        for (const key of keys) if (colMap.hasOwnProperty(key)) return colMap[key];
        return -1;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = this.splitCSV(line);
        if (cols.length < 3) continue;

        if (cols[1] === 'Header') {
            currentSection = cols[0].trim();
            colMap = {}; 
            for (let c = 2; c < cols.length; c++) colMap[cols[c].trim()] = c;
            continue; 
        }

        if (cols[1] === 'Data') {
            if (currentSection === "Offene Positionen" || currentSection === "Open Positions") {
                const idxCat = getIdx(['Vermögenswertkategorie', 'Asset Class']);
                const idxDesc = getIdx(['Beschreibung', 'Description', 'Financial Instrument']);
                let isAllowed = true;

                if (idxCat > -1) {
                    const cat = cols[idxCat].toLowerCase();
                    isAllowed = cat.includes('aktien') || cat.includes('stock') || cat.includes('etf') || cat.includes('fonds') || cat.includes('fund');
                    if (cat.includes('future') || cat.includes('option') || cat.includes('warrant')) isAllowed = false;
                }
                if (idxDesc > -1) {
                    const desc = cols[idxDesc].toLowerCase();
                    if (desc.includes('future') || desc.includes('option') || desc.includes('warrant')) isAllowed = false;
                }

                if (!isAllowed) continue;

                const idxSym = getIdx(['Symbol']);
                if (idxSym > -1) {
                    const sym = cols[idxSym];
                    if (!sym || sym.startsWith('Total') || sym === 'Gesamt') continue;

                    if (!positions[sym]) {
                        positions[sym] = { symbol: sym, qty: 0, val: 0, unReal: 0, real: 0, cost: 0, close: 0, currency: 'USD' };
                    }
                    
                    const idxQty = getIdx(['Menge', 'Quantity']);
                    const idxVal = getIdx(['Wert', 'Value']);
                    const idxUnreal = getIdx(['Unrealisierter G/V', 'Unrealized PnL']);
                    const idxCost = getIdx(['Einstands Kurs', 'Cost Price', 'Kostenbasis', 'Cost Basis']);
                    const idxPrice = getIdx(['Schlusskurs', 'Close Price']);
                    const idxCurr = getIdx(['Währung', 'Currency']);

                    if (idxQty > -1) positions[sym].qty = this.parseNum(cols[idxQty]);
                    if (idxVal > -1) positions[sym].val = this.parseNum(cols[idxVal]);
                    if (idxUnreal > -1) positions[sym].unReal = this.parseNum(cols[idxUnreal]);
                    if (idxCost > -1) positions[sym].cost = this.parseNum(cols[idxCost]);
                    if (idxPrice > -1) positions[sym].close = this.parseNum(cols[idxPrice]);
                    if (idxCurr > -1) positions[sym].currency = cols[idxCurr];
                }
            }

            else if (currentSection.includes('Realized') || currentSection.includes('Realisierte')) {
                 const idxSym = getIdx(['Symbol']);
                 const idxCat = getIdx(['Vermögenswertkategorie', 'Asset Class']);
                 const idxDesc = getIdx(['Beschreibung', 'Description']);
                 let isAllowed = true;

                 if (idxCat > -1) {
                     const cat = cols[idxCat].toLowerCase();
                     isAllowed = cat.includes('aktien') || cat.includes('stock') || cat.includes('etf');
                     if (cat.includes('future')) isAllowed = false;
                 }
                 
                 if (!isAllowed) continue;

                 const idxRealTotal = getIdx(['Realisiert Gesamt', 'Realized Total', 'Total Realized']);
                 const idxRealST = getIdx(['Realisiert K', 'Realized S/T']);
                 const idxRealLT = getIdx(['Realisiert L', 'Realized L/T']);
                 
                 if (idxSym > -1) {
                     const sym = cols[idxSym];
                     let real = 0;
                     if (idxRealTotal > -1) real = this.parseNum(cols[idxRealTotal]);
                     else {
                         const st = idxRealST > -1 ? this.parseNum(cols[idxRealST]) : 0;
                         const lt = idxRealLT > -1 ? this.parseNum(cols[idxRealLT]) : 0;
                         real = st + lt;
                     }

                     if (sym && sym !== 'Gesamt' && !sym.startsWith('Total')) {
                         if (!positions[sym]) positions[sym] = { symbol: sym, qty: 0, val: 0, unReal: 0, real: real, cost: 0, close: 0, currency: 'USD' };
                         else positions[sym].real = real;
                     }
                 }
            }

            else if (currentSection.includes("Bargeld") || currentSection === "Cash Report") {
                const idxDesc = getIdx(['Währungsübersicht', 'Description', 'Field Name']);
                const idxCurr = getIdx(['Währung', 'Currency']);
                const idxAmount = getIdx(['Gesamt', 'Total', 'Schlusssaldo', 'Ending Cash']);
                
                if (idxCurr > -1 && idxAmount > -1) {
                    const desc = idxDesc > -1 ? cols[idxDesc] : '';
                    const curr = cols[idxCurr];
                    const amount = this.parseNum(cols[idxAmount]);
                    const isEndingBalance = desc.includes('Endbarsaldo') || desc.includes('Ending Settled') || desc.includes('Ending Cash');

                    if (isEndingBalance && curr && curr.length === 3 && amount !== 0) {
                        cash[curr] = amount;
                        if (curr !== 'USD' && newRates[`${curr}_USD`] === undefined) newRates[`${curr}_USD`] = 0; 
                    }
                }
            }
            
            else if (currentSection === "Devisenpositionen" || currentSection === "Forex Positions") {
                 const idxAsset = getIdx(['Beschreibung', 'Description', 'Symbol']);
                 const idxRate = getIdx(['Schlusskurs', 'Close Price']);
                 if (idxAsset > -1 && idxRate > -1) {
                     const assetCurr = cols[idxAsset];
                     const rate = this.parseNum(cols[idxRate]);
                     if (assetCurr && rate && assetCurr !== 'USD') newRates[`${assetCurr}_USD`] = rate;
                 }
            }

            else if (currentSection === "Cash-Bericht" || currentSection === "Change in NAV") {
                const idxDesc = getIdx(['Beschreibung', 'Description', 'Field Name']);
                const idxVal = getIdx(['Betrag', 'Amount', 'Value']); 
                const valColIndex = idxVal > -1 ? idxVal : 3; 
                if (idxDesc > -1) {
                    const desc = cols[idxDesc];
                    const val = this.parseNum(cols[valColIndex]);
                    if (desc.includes('Dividenden') || desc.includes('Dividends')) { if(val > 0) totalDividendsUSD += val; }
                    if (desc.includes('Quellensteuer') || desc.includes('Withholding Tax')) totalWithholdingTaxUSD += Math.abs(val);
                }
            }
        }
    }

    let totalValue = 0;
    let totalUnreal = 0;
    let totalRealized = 0;

    Object.values(positions).forEach(p => {
        let rate = 1;
        if (p.currency !== 'USD') rate = newRates[`${p.currency}_USD`] || 0;
        totalValue += p.val * rate;
        totalUnreal += p.unReal * rate;
        totalRealized += p.real;
    });

    return {
        positions,
        cash,
        summary: { totalValue, unrealized: totalUnreal, realized: totalRealized, dividends: totalDividendsUSD, tax: totalWithholdingTaxUSD },
        lastUpdate: new Date().toISOString(),
        exchangeRates: newRates
    };
  }

  // --- TRADES PARSER (FUTURES - FIFO) ---
  static parseIBKRTradesCSV(csvText: string): Record<string, DayEntry> {
    const rows = csvText.split('\n').map(r => r.trim()).filter(r => r);
    if (rows.length < 2) return {};

    const header = rows[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    const colIdx = {
      symbol: header.findIndex(h => h === 'Symbol' || h === 'Financial Instrument'),
      side: header.findIndex(h => h === 'Side'),
      qty: header.findIndex(h => h === 'Qty' || h === 'Quantity'),
      price: header.findIndex(h => h === 'Fill Price' || h === 'Price'),
      time: header.findIndex(h => h === 'Time' || h === 'Date/Time'),
      netAmount: header.findIndex(h => h === 'Net Amount' || h === 'Net' || h === 'Proceeds'),
      commission: header.findIndex(h => h === 'Commission' || h === 'Comm/Fee'),
      realizedPnL: header.findIndex(h => h.includes('Realized P/L') || h.includes('Fifo P/L Realized'))
    };

    if (colIdx.time === -1 || colIdx.price === -1 || colIdx.side === -1) {
       console.error("Critical columns missing in CSV");
       return {};
    }

    interface Execution {
      symbol: string;
      side: 'Buy' | 'Sell';
      qty: number;
      price: number;
      time: Date;
      fee: number;
      multiplier: number;
      contract: string;
      realizedPnL?: number; // Pre-calculated PnL from IBKR
    }

    const executions: Execution[] = [];
    
    for(let i=1; i<rows.length; i++) {
        const cols = this.splitCSV(rows[i]);
        if (cols.length < 5) continue;

        const timeStr = cols[colIdx.time];
        const dateObj = new Date(timeStr);
        if(isNaN(dateObj.getTime())) continue;

        const contract = cols[colIdx.symbol];
        const side = cols[colIdx.side] as 'Buy' | 'Sell';
        
        const qty = Math.abs(this.parseNum(cols[colIdx.qty]));
        const price = this.parseNum(cols[colIdx.price]);
        
        // Fee is usually negative (-2.00). We store absolute cost (2.00)
        const fee = Math.abs(this.parseNum(cols[colIdx.commission] || '0'));
        
        // Check for Realized PnL column (Preferred method)
        let realizedPnL: number | undefined = undefined;
        if (colIdx.realizedPnL > -1) {
            const val = this.parseNum(cols[colIdx.realizedPnL]);
            if (val !== 0) realizedPnL = val;
        }

        // Detect Multiplier
        let multiplier = 1;
        let symbol = contract;
        const upperContract = contract.toUpperCase();
        
        // STRICT DETECTION
        if (upperContract.startsWith('MES') || upperContract.includes('MICRO E-MINI S&P') || upperContract.includes('MICRO S&P')) {
            symbol = 'MES';
            multiplier = 5;
        } else if (upperContract.startsWith('MNQ') || upperContract.includes('MICRO E-MINI NASDAQ')) {
            symbol = 'MNQ';
            multiplier = 2;
        } else if (upperContract.startsWith('M2K') || upperContract.includes('MICRO E-MINI RUSSELL')) {
            symbol = 'M2K';
            multiplier = 5;
        } else if (upperContract.startsWith('ES') || upperContract.includes('E-MINI S&P')) {
            symbol = 'ES';
            multiplier = 50;
        } else if (upperContract.startsWith('NQ') || upperContract.includes('E-MINI NASDAQ')) {
            symbol = 'NQ';
            multiplier = 20;
        } 

        executions.push({
            symbol,
            contract,
            side,
            qty,
            price,
            time: dateObj,
            fee,
            multiplier,
            realizedPnL
        });
    }

    executions.sort((a, b) => a.time.getTime() - b.time.getTime());

    const days: Record<string, DayEntry> = {};
    const openLongs: Record<string, Execution[]> = {}; 
    const openShorts: Record<string, Execution[]> = {};

    executions.forEach(ex => {
        const dateKey = ex.time.toISOString().split('T')[0];
        if (!days[dateKey]) {
            days[dateKey] = { total: 0, note: '', trades: [], screenshots: [], fees: 0 };
        }

        days[dateKey].fees = (days[dateKey].fees || 0) + ex.fee;
        
        if (!openLongs[ex.symbol]) openLongs[ex.symbol] = [];
        if (!openShorts[ex.symbol]) openShorts[ex.symbol] = [];

        let qtyToMatch = ex.qty;

        if (ex.side === 'Buy') {
            const shorts = openShorts[ex.symbol];
            while (qtyToMatch > 0 && shorts.length > 0) {
                const openShort = shorts[0]; 
                const matchQty = Math.min(qtyToMatch, openShort.qty);
                
                // PnL Calculation
                // 1. Prefer IBKR "Realized P/L" from the closing execution (Buy side here)
                // 2. Fallback to manual calc
                let pnl = 0;
                if (ex.realizedPnL !== undefined && ex.realizedPnL !== 0) {
                    // Pro-rate if partial fill: TotalRealized * (Matched / TotalQtyOfExecution)
                    pnl = ex.realizedPnL * (matchQty / ex.qty);
                } else {
                    pnl = (openShort.price - ex.price) * matchQty * ex.multiplier;
                }
                
                const trade: Trade = {
                   pnl: pnl,
                   fee: (openShort.fee * (matchQty/openShort.qty)) + (ex.fee * (matchQty/ex.qty)), 
                   inst: ex.symbol,
                   qty: matchQty,
                   start: openShort.time.toTimeString().slice(0, 5),
                   end: ex.time.toTimeString().slice(0, 5),
                   tag: 'Match',
                   strategy: 'Short-Cont.' 
                };
                days[dateKey].trades.push(trade);
                days[dateKey].total += pnl;

                qtyToMatch -= matchQty;
                openShort.qty -= matchQty;
                if (openShort.qty < 0.0001) shorts.shift();
            }
            if (qtyToMatch > 0) openLongs[ex.symbol].push({ ...ex, qty: qtyToMatch });

        } else { // Sell
            const longs = openLongs[ex.symbol];
            while (qtyToMatch > 0 && longs.length > 0) {
                const openLong = longs[0]; 
                const matchQty = Math.min(qtyToMatch, openLong.qty);
                
                let pnl = 0;
                if (ex.realizedPnL !== undefined && ex.realizedPnL !== 0) {
                     pnl = ex.realizedPnL * (matchQty / ex.qty);
                } else {
                     pnl = (ex.price - openLong.price) * matchQty * ex.multiplier;
                }
                
                const trade: Trade = {
                   pnl: pnl,
                   fee: (openLong.fee * (matchQty/openLong.qty)) + (ex.fee * (matchQty/ex.qty)),
                   inst: ex.symbol,
                   qty: matchQty,
                   start: openLong.time.toTimeString().slice(0, 5),
                   end: ex.time.toTimeString().slice(0, 5),
                   tag: 'Match',
                   strategy: 'Long-Cont.' 
                };
                days[dateKey].trades.push(trade);
                days[dateKey].total += pnl;

                qtyToMatch -= matchQty;
                openLong.qty -= matchQty;
                if (openLong.qty < 0.0001) longs.shift();
            }
            if (qtyToMatch > 0) openShorts[ex.symbol].push({ ...ex, qty: qtyToMatch });
        }
    });

    // Final Net Calculation: Total PnL (Gross) - Fees
    Object.keys(days).forEach(d => {
       // Only subtract fees if PnL was calculated GROSS. 
       // IBKR Realized PnL column is typically NET of fees. 
       // If we used RealizedPnL column, we likely double-counted fees if we subtract again?
       // Usually RealizedPnL in CSV is Net. 
       // Let's assume if we used RealizedPnL logic, we shouldn't subtract fees.
       // But we mixed methods potentially. 
       // SAFE BET: Display "Total PnL" as Gross PnL - Fees.
       // If Realized PnL was Net, we might show a slightly lower number.
       // However, for Manual Calc, we NEED to subtract fees.
       
       // Standard approach for this app: total is Net.
       days[d].total = days[d].total - (days[d].fees || 0);
    });

    return days;
  }
}