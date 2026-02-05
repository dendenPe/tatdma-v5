
import { AppData, SalaryEntry } from '../types';

export class XmlExportService {

  static generateTaxXML(data: AppData, year: string): string {
    const p = data.tax.personal;
    const salary = data.salary[year];
    const portfolioId = data.currentPortfolioId || Object.keys(data.portfolios)[0];
    const portfolio = data.portfolios[portfolioId]?.years[year];
    const expenses = data.tax.expenses.filter(e => e.year === year && e.taxRelevant);

    // Calc Totals
    let bruttoLohn = 0;
    let berufsauslagen = 0;
    
    if (salary) {
       Object.values(salary).forEach(e => {
           bruttoLohn += (e.brutto || 0);
       });
    }

    expenses.forEach(e => {
        if (e.cat === 'Berufsauslagen') {
            bruttoLohn -= e.amount; // Just estimating net for demo logic, real mapping depends on software
            berufsauslagen += e.amount;
        }
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TaxData xmlns="http://www.estv.admin.ch/xml/taxdata/2021">
    <Header>
        <Version>4.0</Version>
        <ExportDate>${new Date().toISOString()}</ExportDate>
        <Software>TaTDMA v4</Software>
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
    <Assessment year="${year}">
        <Income>
            <Salary>
                <GrossAmount currency="CHF">${bruttoLohn.toFixed(2)}</GrossAmount>
                <WorkExpenses currency="CHF">${berufsauslagen.toFixed(2)}</WorkExpenses>
            </Salary>
        </Income>
        <Assets>
            <Securities>
                ${portfolio?.positions ? Object.values(portfolio.positions).map(pos => `
                <Position>
                    <ISIN>${pos.symbol}</ISIN>
                    <Title>${pos.symbol}</Title>
                    <Quantity>${pos.qty}</Quantity>
                    <TaxValue currency="CHF">${(pos.val * (portfolio.exchangeRates['USD_CHF'] || 0.85)).toFixed(2)}</TaxValue>
                </Position>`).join('') : ''}
            </Securities>
            <BankAccounts>
                ${data.tax.balances[year] ? `
                <Account>
                    <BankName>UBS Switzerland AG</BankName>
                    <Balance3112 currency="CHF">${data.tax.balances[year].ubs.toFixed(2)}</Balance3112>
                </Account>` : ''}
            </BankAccounts>
        </Assets>
        <Deductions>
             ${expenses.map(e => `
             <Deduction type="${e.cat}">
                 <Description>${e.desc}</Description>
                 <Amount currency="${e.currency}">${e.amount.toFixed(2)}</Amount>
             </Deduction>`).join('')}
        </Deductions>
    </Assessment>
</TaxData>`;
    return xml;
  }
}
