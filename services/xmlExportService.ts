
import { AppData, SalaryEntry, PortfolioPosition, TaxExpense } from '../types';

export class XmlExportService {

  // --- 1. WERTSCHRIFTENVERZEICHNIS (CSV for Import) ---
  // Many Swiss tax programs (ZHprivateTax, EasyTax, etc.) allow CSV import for securities.
  static generateSecuritiesCSV(data: AppData, year: string): string {
      const portfolioId = data.currentPortfolioId || Object.keys(data.portfolios)[0];
      const portfolio = data.portfolios[portfolioId]?.years[year];
      
      if (!portfolio || !portfolio.positions) return "";

      const pRates = portfolio.exchangeRates || {};
      const usdChf = pRates['USD_CHF'] || 0.85;
      const eurChf = pRates['EUR_CHF'] || 0.94; // fallback approximation if missing
      
      const header = "ValorenNr;ISIN;Titel;Kaufdatum;Stueckzahl;Waehrung;Steuerwert_CHF;Bruttoertrag_Valuta;Bruttoertrag_CHF";
      const rows: string[] = [header];

      Object.values(portfolio.positions).forEach(pos => {
          if (pos.qty === 0 && pos.real === 0) return; // Skip completely empty/inactive

          // Rate logic
          let rateToChf = 1;
          if (pos.currency === 'USD') rateToChf = usdChf;
          else if (pos.currency === 'EUR') rateToChf = pRates['EUR_CHF'] || eurChf; // Try exact, else approx
          else if (pRates[`${pos.currency}_CHF`]) rateToChf = pRates[`${pos.currency}_CHF`];
          
          // Values
          const taxValueCHF = (pos.val * (pos.currency === 'USD' ? usdChf : rateToChf)).toFixed(2);
          
          // Dividends aren't stored per position in the current model, but we have Realized PnL.
          // For now, we export 0 for Dividend per position (user must fill) OR we could distribute the summary dividend.
          // Better approach: Leave 0, let user fill, or if we had dividend per pos, fill it here.
          const dividendValuta = "0.00"; 
          const dividendCHF = "0.00"; 

          // Escape title for CSV
          const safeTitle = pos.symbol.replace(/;/g, ',');

          rows.push(`${pos.symbol};${pos.symbol};${safeTitle};;${pos.qty};${pos.currency};${taxValueCHF};${dividendValuta};${dividendCHF}`);
      });

      // Add Cash Positions
      if (portfolio.cash) {
          Object.entries(portfolio.cash).forEach(([curr, amt]) => {
              if (amt > 1) {
                  let rate = 1;
                  if (curr === 'USD') rate = usdChf;
                  if (curr === 'EUR') rate = pRates['EUR_CHF'] || 0.94;
                  
                  const valCHF = (amt * rate).toFixed(2);
                  rows.push(`;Cash ${curr};Bankguthaben ${curr};;1;${curr};${valCHF};0.00;0.00`);
              }
          });
      }

      return rows.join('\n');
  }

  // --- 2. FULL TAX DATA (XML / eCH Style) ---
  static generateTaxXML(data: AppData, year: string): string {
    const p = data.tax.personal;
    const portfolioId = data.currentPortfolioId || Object.keys(data.portfolios)[0];
    const portfolio = data.portfolios[portfolioId]?.years[year];
    
    // Expenses Grouping
    const expenses = data.tax.expenses.filter(e => e.year === year && e.taxRelevant);
    const berufsauslagen = expenses.filter(e => e.cat === 'Berufsauslagen' || e.cat === 'Hardware/Büro').reduce((s, e) => s + (e.amount * e.rate), 0);
    const weiterbildung = expenses.filter(e => e.cat === 'Weiterbildung').reduce((s, e) => s + (e.amount * e.rate), 0);
    const versicherungen = expenses.filter(e => e.cat.includes('Versicherung') || e.cat.includes('Kranken')).reduce((s, e) => s + (e.amount * e.rate), 0);
    const alimente = expenses.filter(e => e.cat === 'Alimente').reduce((s, e) => s + (e.amount * e.rate), 0);
    const kinderabzug = expenses.filter(e => e.cat === 'Kindesunterhalt').reduce((s, e) => s + (e.amount * e.rate), 0);

    // Salary Data (Prefer Certificate if exists)
    const cert = data.salaryCertificates?.[year]?.p1;
    const manualSalary = Object.values(data.salary[year] || {});
    
    // Values
    const lohnBrutto = cert?.grossMain || manualSalary.reduce((s, e) => s + (e.brutto || 0), 0);
    const lohnNetto = cert?.grossSimple || (lohnBrutto - manualSalary.reduce((s,e) => s + (e.ahv||0)+(e.alv||0)+(e.bvg||0), 0)); 
    const spesen = cert?.expenses || manualSalary.reduce((s, e) => s + (e.pauschalspesen || 0), 0);

    // Calculate Bank Totals
    const balances = data.tax.balances[year];
    let bankTotalCHF = 0;
    if (balances) {
        bankTotalCHF += (balances.ubs || 0);
        bankTotalCHF += (balances.comdirect || 0);
        if (balances.customAccounts) {
            balances.customAccounts.forEach(acc => {
                if (acc.includeInTaxReport !== false) { // NEW CHECK
                    let val = acc.amount;
                    // Simple conversion estimate for XML if rate not provided, ideally passed in
                    if (acc.currency === 'USD') val = val * (data.tax.rateUSD || 0.85);
                    else if (acc.currency === 'EUR') val = val * (data.tax.rateEUR || 0.94);
                    bankTotalCHF += val;
                }
            });
        }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<eTaxData xmlns="http://www.ech.ch/xmlns/eCH-0196/2" version="4.0">
    <Header>
        <ExportDate>${new Date().toISOString()}</ExportDate>
        <Software>TaTDMA v5</Software>
        <TaxYear>${year}</TaxYear>
    </Header>
    <Taxpayer>
        <PID>${p.id || ''}</PID>
        <Name>${p.name || ''}</Name>
        <Address>
            <Street>${p.address || ''}</Street>
            <ZIP>${p.zip || ''}</ZIP>
            <City>${p.city || ''}</City>
        </Address>
    </Taxpayer>
    
    <!-- EINKÜNFTE (Formular 100 / Ziff 1.1) -->
    <Income>
        <Salary id="100">
            <Label>Unselbständige Erwerbstätigkeit (Haupterwerb)</Label>
            <GrossAmount currency="CHF">${lohnBrutto.toFixed(2)}</GrossAmount>
            <NetCalculation>
                <Basis>${lohnBrutto.toFixed(2)}</Basis>
                <!-- Only if we calculated net manually, otherwise assume cert value -->
            </NetCalculation>
            <CertificateData>
                <Ziff_1_1>${cert?.grossMain?.toFixed(2) || '0.00'}</Ziff_1_1>
                <Ziff_1_2>${cert?.grossSide?.toFixed(2) || '0.00'}</Ziff_1_2>
                <Ziff_10_1>${spesen.toFixed(2)}</Ziff_10_1>
            </CertificateData>
        </Salary>
    </Income>

    <!-- ABZÜGE (Formular Berufsauslagen / Ziff 200+) -->
    <Deductions>
        <ProfessionalExpenses id="220">
            <Label>Übrige Berufskosten</Label>
            <Amount currency="CHF">${berufsauslagen.toFixed(2)}</Amount>
            <Detail>Pauschal oder Effektiv gemäss Belegen</Detail>
        </ProfessionalExpenses>
        
        <Education id="297">
            <Label>Weiterbildung / Umschulung</Label>
            <Amount currency="CHF">${weiterbildung.toFixed(2)}</Amount>
        </Education>

        <InsurancePremiums id="330">
            <Label>Krankenkassen- & Versicherungsprämien</Label>
            <Amount currency="CHF">${versicherungen.toFixed(2)}</Amount>
        </InsurancePremiums>

        ${alimente > 0 ? `
        <Alimony id="254">
            <Label>Geleistete Unterhaltsbeiträge</Label>
            <Amount currency="CHF">${alimente.toFixed(2)}</Amount>
        </Alimony>` : ''}
        
        ${kinderabzug > 0 ? `
        <ChildSupport id="255">
            <Label>Kindesunterhalt</Label>
            <Amount currency="CHF">${kinderabzug.toFixed(2)}</Amount>
        </ChildSupport>` : ''}
    </Deductions>

    <!-- VERMÖGEN (Formular Wertschriften / Ziff 400) -->
    <Assets>
        <BankAccounts>
            <Position id="30.1">
                <Description>Bankguthaben Total (UBS, Comdirect, Weitere)</Description>
                <Value3112 currency="CHF">${bankTotalCHF.toFixed(2)}</Value3112>
            </Position>
        </BankAccounts>
        
        <Securities>
            <Summary>
                <TotalTaxValue currency="CHF">${portfolio?.summary.totalValue.toFixed(2)}</TotalTaxValue>
                <TotalDividends currency="CHF">${portfolio?.summary.dividends.toFixed(2)}</TotalDividends>
                <WithholdingTaxUSA currency="CHF">${portfolio?.summary.tax.toFixed(2)}</WithholdingTaxUSA>
            </Summary>
            <!-- Detailed positions exported separately via CSV for better compatibility -->
        </Securities>
    </Assets>
</eTaxData>`;
    return xml;
  }
}
