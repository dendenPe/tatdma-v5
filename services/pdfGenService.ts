
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppData, PortfolioPosition, TaxExpense } from '../types';
import { DBService } from './dbService';

export interface PdfExportOptions {
  includePersonal: boolean;
  includeMessage: boolean;
  includeSalary: boolean;
  includeAssets: boolean;
  includeExpenses: boolean;
  includeTradingProof: boolean;
  includeReceipts: boolean;
}

export class PdfGenService {
  
  static async generateTaxPDF(data: AppData, year: string, options: PdfExportOptions) {
    try {
      if (!year || year.length < 4) throw new Error("Bitte wähle zuerst ein Steuerjahr aus.");
      
      const doc = new jsPDF();
      const rateUSD = data.tax.rateUSD || 0.85;
      const rateEUR = data.tax.rateEUR || 0.94;
      const p = data.tax.personal;

      // --- HELPER: FORMATTING ---
      const fmtNum = (val: any, suffix = '') => {
        if (val === undefined || val === null) return '-';
        const num = typeof val === 'string' ? parseFloat(val) : val;
        if (isNaN(num)) return val;
        const parts = num.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
        return parts.join('.') + (suffix ? ' ' + suffix : '');
      };

      // Header Function
      const addHeader = (title: string, yPos = 20) => {
          doc.setFontSize(16); doc.setTextColor(44, 62, 80); doc.setFont("helvetica", 'bold');
          doc.text(title, 20, yPos);
          doc.setDrawColor(200); doc.line(20, yPos + 2, 190, yPos + 2);
          doc.setFontSize(10); doc.setTextColor(100); doc.setFont("helvetica", 'normal');
          doc.text(`Steuerperiode ${year} | PID: ${p.id || '-'} | ${p.name || '-'}`, 20, yPos + 7);
          return yPos + 15;
      };

      let currentY = 20;

      // 1. DECKBLATT (PERSONAL)
      if (options.includePersonal) {
          doc.setFontSize(22); doc.setTextColor(44, 62, 80); doc.setFont("helvetica", "bold");
          doc.text("Steuerreport & Beilagen", 105, 40, { align: 'center' });
          doc.setFontSize(14); doc.setTextColor(100); doc.setFont("helvetica", "normal");
          doc.text(`Kanton Schaffhausen | Steuerjahr ${year}`, 105, 50, { align: 'center' });
          
          doc.setDrawColor(44, 62, 80); doc.setLineWidth(0.5);
          doc.line(40, 60, 170, 60);

          doc.setFontSize(11); doc.setTextColor(0);
          doc.text(`Name:`, 50, 80); doc.text(p.name || '-', 100, 80);
          doc.text(`PID / St-Nr.:`, 50, 90); doc.text(p.id || '-', 100, 90);
          doc.text(`Adresse:`, 50, 100); doc.text(`${p.address || ''}, ${p.zip || ''} ${p.city || ''}`, 100, 100);

          doc.setFontSize(10); doc.setTextColor(100);
          doc.text(`Generiert am: ${new Date().toLocaleDateString('de-CH')}`, 105, 280, { align: 'center' });
      }

      // 2. NACHRICHT AN DAS STEUERAMT
      if (options.includeMessage && data.tax.messageToAuthorities?.[year]) {
          doc.addPage();
          currentY = addHeader("Bemerkungen zur Steuererklärung");
          
          const msg = data.tax.messageToAuthorities[year];
          doc.setTextColor(0); doc.setFontSize(10); doc.setFont("helvetica", "normal");
          
          // Split text to handle line breaks and width
          const splitText = doc.splitTextToSize(msg, 170);
          doc.text(splitText, 20, currentY);
      }

      // 3. LOHNAUSWEIS DATEN (Ziff 100 etc)
      if (options.includeSalary && data.salary[year]) {
          doc.addPage();
          currentY = addHeader("Lohnausweis Zusammenfassung (Ziff. 100)");
          
          const salaryData = data.salary[year];
          let totals = { brutto: 0, pauschal: 0, ahv: 0, alv: 0, bvg: 0, qst: 0, k_zulagen: 0 };
          
          Object.values(salaryData).forEach(m => {
             totals.brutto += Number(m.brutto) || 0;
             totals.pauschal += Number(m.pauschalspesen) || 0;
             totals.k_zulagen += Number(m.familienzulage) || 0;
             totals.ahv += Math.abs(Number(m.ahv) || 0);
             totals.alv += Math.abs(Number(m.alv) || 0);
             totals.bvg += Math.abs(Number(m.bvg) || 0);
             totals.qst += Math.abs(Number(m.quellensteuer) || 0);
          });

          // Calculations for Report
          const totalAHV_ALV = totals.ahv + totals.alv;
          const totalBVG = totals.bvg;
          const totalNettoLohnausweis = totals.brutto - totalAHV_ALV - totalBVG;

          // Description Text
          doc.setFontSize(10); doc.setTextColor(0);
          doc.text("Zusammenzug der 12 Monatsabrechnungen für die Steuererklärung.", 20, currentY);
          currentY += 10;

          const body = [
            ['Bruttolohn Total (inkl. Zulagen)', fmtNum(totals.brutto, 'CHF'), 'Info Brutto'],
            ['./. AHV/IV/EO (inkl. ALV)', `-${fmtNum(totalAHV_ALV, 'CHF')}`, 'Ziff. 280 (falls Brutto deklariert)'],
            ['./. Berufliche Vorsorge (BVG/PK)', `-${fmtNum(totalBVG, 'CHF')}`, 'Ziff. 283 (falls Brutto deklariert)'],
            ['= Nettolohn (Steuerbar)', fmtNum(totalNettoLohnausweis, 'CHF'), 'Ziff. 100 (Haupteinkommen)'],
            ['', '', ''], // Spacer
            ['Total Pauschalspesen', fmtNum(totals.pauschal, 'CHF'), 'Ziff. 100 / 107 (Info)'],
            ['Total Kinder-/Familienzulagen', fmtNum(totals.k_zulagen, 'CHF'), 'In Brutto enthalten'],
            ['Bezahlte Quellensteuer (Total)', fmtNum(totals.qst, 'CHF'), 'Anrechenbar (Verrechnung)'],
          ];

          autoTable(doc, {
            startY: currentY,
            head: [['Position', 'Betrag (Jahr)', 'Steuerformular Referenz']],
            body: body,
            theme: 'grid',
            styles: { fontSize: 10, cellPadding: 4, valign: 'middle' },
            headStyles: { fillColor: [22, 50, 92], textColor: 255, fontStyle: 'bold' },
            columnStyles: { 
                1: { halign: 'right', fontStyle: 'bold', minCellWidth: 40 },
                2: { fontStyle: 'italic', textColor: 100 }
            },
            didParseCell: (d: any) => {
                // Highlight Net Salary Row
                if (d.section === 'body' && d.row.index === 3) {
                    d.cell.styles.fillColor = [240, 249, 255];
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.textColor = [0, 0, 0];
                }
            }
          });
      }

      // 4. VERMÖGEN & WERTSCHRIFTEN
      if (options.includeAssets) {
        doc.addPage();
        currentY = addHeader("Wertschriftenverzeichnis & Vermögen (Ziff. 400)");

        const portfolio = data.portfolios[data.currentPortfolioId];
        const yearPortfolio = portfolio?.years[year];
        const balances = data.tax.balances[year] || { ubs: 0, comdirect: 0, comdirectEUR: 0, ibkr: 0 };
        
        // --- A. Bankguthaben ---
        doc.setFontSize(11); doc.setFont("helvetica", 'bold'); doc.text("A. Bankguthaben", 20, currentY + 5);
        
        const bankRows = [];
        let totalBank = 0;
        
        // Manual Entries
        if (balances.ubs) { bankRows.push(['UBS Switzerland AG', fmtNum(balances.ubs, 'CHF')]); totalBank += balances.ubs; }
        if (balances.comdirectEUR) { 
          const val = balances.comdirectEUR * rateEUR;
          bankRows.push([`Comdirect (EUR ${fmtNum(balances.comdirectEUR)})`, fmtNum(val, 'CHF')]); 
          totalBank += val; 
        } else if (balances.comdirect) {
          bankRows.push(['Comdirect Bank', fmtNum(balances.comdirect, 'CHF')]); totalBank += balances.comdirect;
        }

        // Automatic IBKR Cash from Portfolio Data
        if (yearPortfolio && yearPortfolio.cash) {
             let ibkrCashTotalCHF = 0;
             let details: string[] = [];
             
             // Get rates from the portfolio snapshot to ensure consistency
             const pRates = yearPortfolio.exchangeRates || {};
             const usdChfRate = pRates['USD_CHF'] || 0.88;
             const eurUsdRate = pRates['EUR_USD'] || 1.07;

             for (const [curr, amt] of Object.entries(yearPortfolio.cash)) {
                if (amt !== 0) {
                    let valInUSD = 0;
                    if (curr === 'USD') valInUSD = amt;
                    else if (curr === 'CHF') valInUSD = amt / usdChfRate;
                    else if (curr === 'EUR') valInUSD = amt * eurUsdRate;
                    else {
                        const rateKey = `${curr}_USD`;
                        const rate = pRates[rateKey];
                        if (rate) valInUSD = amt * rate;
                    }
                    
                    const valInCHF = valInUSD * usdChfRate;
                    ibkrCashTotalCHF += valInCHF;
                    details.push(`${fmtNum(amt, curr)}`);
                }
             }

             if (ibkrCashTotalCHF !== 0) {
                 const label = `IBKR Cashbestand (per 31.12.${year} - ${portfolio.name})`;
                 bankRows.push([label, fmtNum(ibkrCashTotalCHF, 'CHF')]);
                 totalBank += ibkrCashTotalCHF;
             }
        }
        
        bankRows.push(['Total Bankguthaben', fmtNum(totalBank, 'CHF')]);

        autoTable(doc, {
            startY: currentY + 10,
            body: bankRows,
            theme: 'plain',
            columnStyles: { 1: { halign: 'right' } },
            didParseCell: (d: any) => { if (d.row.index === bankRows.length - 1) d.cell.styles.fontStyle = 'bold'; }
        });

        currentY = (doc as any).lastAutoTable.finalY + 10;

        // --- B. Wertschriften (Aktien) ---
        if (yearPortfolio && yearPortfolio.positions) {
            doc.setFontSize(11); doc.setFont("helvetica", 'bold'); doc.text("B. Bewegliches Vermögen (Aktien / Fonds)", 20, currentY + 5);
            
            const posRows: any[] = [];
            let totalSecurities = 0;
            const sortedPos = Object.values(yearPortfolio.positions).filter(p => p.qty !== 0).sort((a,b) => b.val - a.val);

            // Get rates from portfolio again
            const pRates = yearPortfolio.exchangeRates || {};
            const usdChfRate = pRates['USD_CHF'] || 0.88;
            const eurUsdRate = pRates['EUR_USD'] || 1.07;

            sortedPos.forEach(p => {
                let valUSD = 0;
                // Calculate Value in USD first (Base)
                if (p.currency === 'USD') valUSD = p.val;
                else if (p.currency === 'EUR') valUSD = p.val * eurUsdRate;
                else if (p.currency === 'CHF') valUSD = p.val / usdChfRate;
                else {
                    const r = pRates[`${p.currency}_USD`];
                    if(r) valUSD = p.val * r;
                }

                const valCHF = valUSD * usdChfRate;
                totalSecurities += valCHF;

                posRows.push([
                    p.symbol,
                    p.qty,
                    fmtNum(p.close, p.currency),
                    fmtNum(valCHF, 'CHF')
                ]);
            });

            posRows.push(['TOTAL Wertschriften', '', '', fmtNum(totalSecurities, 'CHF')]);

            autoTable(doc, {
                startY: currentY + 10,
                head: [['Titel / Valoren', 'Stückzahl', 'Steuerkurs', 'Steuerwert (CHF)']],
                body: posRows,
                theme: 'grid',
                headStyles: { fillColor: [22, 50, 92] },
                columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
                didParseCell: (d: any) => { if (d.row.index === posRows.length - 1) d.cell.styles.fontStyle = 'bold'; }
            });

            currentY = (doc as any).lastAutoTable.finalY + 15;

            // --- C. Dividenden & DA-1 ---
            if (yearPortfolio.summary && (yearPortfolio.summary.dividends > 0 || yearPortfolio.summary.tax > 0)) {
                if (currentY > 230) { doc.addPage(); currentY = 20; }
                
                doc.setFontSize(11); doc.setFont("helvetica", 'bold'); doc.text("C. Erträge & DA-1 (Verrechnungssteuer USA)", 20, currentY);
                
                const divUSD = yearPortfolio.summary.dividends;
                const taxUSD = yearPortfolio.summary.tax;
                
                // Use rates
                const usdChf = yearPortfolio.exchangeRates?.['USD_CHF'] || 0.88;
                const divCHF = divUSD * usdChf;
                const taxCHF = taxUSD * usdChf;

                const divBody = [
                    ['Bruttoertrag Dividenden (USA)', fmtNum(divUSD, 'USD'), fmtNum(divCHF, 'CHF')],
                    ['./. Rückbehalt USA (Withholding Tax)', fmtNum(taxUSD, 'USD'), fmtNum(taxCHF, 'CHF')],
                    ['= Nettoertrag', fmtNum(divUSD - taxUSD, 'USD'), fmtNum(divCHF - taxCHF, 'CHF')]
                ];

                autoTable(doc, {
                    startY: currentY + 5,
                    head: [['Position', 'Betrag (Orig)', 'Betrag (CHF)']],
                    body: divBody,
                    theme: 'striped',
                    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } }
                });
                
                doc.setFontSize(9); doc.setFont("helvetica", 'italic');
                doc.text("Hinweis: Bitte Formular DA-1 für die Rückerstattung der US-Quellensteuer (15%) ausfüllen.", 20, (doc as any).lastAutoTable.finalY + 8);
            }
        }
      }

      // 5. TRADING LOGBUCH (Privatvermögen)
      if (options.includeTradingProof) {
          doc.addPage();
          currentY = addHeader("Trading-Logbuch (Privates Vermögen)");
          
          let netPnL = 0;
          let tradesCount = 0;
          
          // Check all trades
          Object.keys(data.trades).forEach(k => {
             // Basic Check: key matches YYYY-
             if (k.startsWith(year)) {
                 netPnL += data.trades[k].total || 0;
                 tradesCount += data.trades[k].trades.length;
             }
          });
          
          const netCHF = netPnL * rateUSD;

          doc.setFontSize(10);
          doc.text("Zusammenfassung der privaten Trading-Aktivitäten.", 20, currentY);
          
          const tradeStats = [
              ['Anzahl Transaktionen', tradesCount.toString()],
              ['Kapitalgewinn / -verlust (USD)', fmtNum(netPnL, 'USD')],
              ['Kapitalgewinn / -verlust (CHF)', fmtNum(netCHF, 'CHF')]
          ];
          
          autoTable(doc, {
              startY: currentY + 10,
              body: tradeStats,
              theme: 'grid',
              columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
          });
          
          doc.setFontSize(9); doc.setTextColor(100);
          const infoText = "Hinweis: Kapitalgewinne aus privatem Wertschriftenhandel sind in der Regel steuerfrei (Art. 16 Abs. 3 DBG), sofern man nicht als gewerbsmässiger Händler eingestuft wird.";
          const splitInfo = doc.splitTextToSize(infoText, 170);
          doc.text(splitInfo, 20, (doc as any).lastAutoTable.finalY + 10);
      }

      // 6. ABZÜGE / EXPENSES
      if (options.includeExpenses) {
          doc.addPage();
          currentY = addHeader("Berufskosten & Allgemeine Abzüge");

          const expenses = data.tax.expenses.filter(e => e.year === year && e.taxRelevant);
          
          // Group by Category
          const grouped: Record<string, TaxExpense[]> = {};
          expenses.forEach(e => {
              if (!grouped[e.cat]) grouped[e.cat] = [];
              grouped[e.cat].push(e);
          });

          let totalDed = 0;

          // Helper for sub-tables
          const renderCatTable = (catName: string, items: TaxExpense[], formRef: string) => {
              if (!items || items.length === 0) return;
              
              doc.setFontSize(11); doc.setFont("helvetica", 'bold'); doc.setTextColor(0);
              doc.text(`${catName} (${formRef})`, 20, currentY);
              
              const rows = items.map(e => {
                 let valCHF = e.amount;
                 if (e.currency === 'USD') valCHF = e.amount * rateUSD;
                 if (e.currency === 'EUR') valCHF = e.amount * rateEUR;
                 totalDed += valCHF;
                 
                 let desc = e.desc;

                 // DETAILED INFO FOR SPECIAL EXPENSES
                 if (e.childDetails) {
                    const cd = e.childDetails;
                    desc = `Kind: ${cd.vorname} ${cd.nachname} (Geb. ${cd.geburtsdatum || '?'})\nZahlung an: ${cd.empfaenger_vorname || ''} ${cd.empfaenger_name || ''}, ${cd.empfaenger_ort || ''}`;
                 }
                 else if (e.alimonyDetails) {
                    const ad = e.alimonyDetails;
                    desc = `Empfänger: ${ad.empfaenger_vorname || ''} ${ad.empfaenger_name || ''}, ${ad.empfaenger_ort || ''}\nGetrennt seit: ${ad.getrennt_seit || '?'}`;
                 }
                 
                 return [desc, fmtNum(e.amount, e.currency), fmtNum(valCHF, 'CHF')];
              });

              autoTable(doc, {
                  startY: currentY + 5,
                  head: [['Beschreibung / Details', 'Betrag (Orig)', 'Betrag (CHF)']],
                  body: rows,
                  theme: 'striped',
                  headStyles: { fillColor: [100, 100, 100] },
                  columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } }
              });
              currentY = (doc as any).lastAutoTable.finalY + 15;
          };

          renderCatTable("Berufsauslagen", grouped['Berufsauslagen'], "Ziff. 220");
          renderCatTable("Weiterbildung", grouped['Weiterbildung'], "Ziff. 297/298");
          renderCatTable("Versicherungsprämien", grouped['Krankenkassenprämien'], "Ziff. 330");
          renderCatTable("Versicherungsprämien (Sonstige)", grouped['Versicherung'], "Ziff. 330");
          renderCatTable("Alimente", grouped['Alimente'], "Ziff. 254 (Form. 105)");
          renderCatTable("Kindesunterhalt", grouped['Kindesunterhalt'], "Ziff. 255");
          renderCatTable("Fremdbetreuungskosten", grouped['Sonstiges'], "Ziff. 290");

          doc.setDrawColor(0); doc.line(20, currentY, 190, currentY);
          doc.setFontSize(12); doc.text(`Total Geltend gemachte Abzüge: ${fmtNum(totalDed, 'CHF')}`, 190, currentY + 10, { align: 'right' });
      }

      // 7. BELEGE / BILDER & DATEILISTE
      if (options.includeReceipts) {
          const receiptExpenses = data.tax.expenses.filter(e => e.year === year && e.receipts.length > 0 && e.taxRelevant);
          
          if (receiptExpenses.length > 0) {
              doc.addPage();
              currentY = addHeader("Beilagen & Quittungen");

              // Collect files
              const attachments: any[] = [];
              
              for (const exp of receiptExpenses) {
                  for (const fileId of exp.receipts) {
                      try {
                          const blob = await DBService.getFile(fileId);
                          if (blob) {
                              // Type guard for File object to access name
                              const file = blob as File; 
                              const name = file.name || `Beleg_${fileId.substring(0,6)}`;
                              const isImg = blob.type.startsWith('image/');
                              const isPdf = blob.type === 'application/pdf';
                              
                              attachments.push({
                                  cat: exp.cat,
                                  desc: exp.desc,
                                  amount: exp.amount,
                                  currency: exp.currency,
                                  name: name,
                                  type: isImg ? 'Bild' : (isPdf ? 'PDF' : 'Datei'),
                                  blob: blob,
                                  isImg
                              });
                          }
                      } catch (e) {
                          console.warn("File fetch error", e);
                      }
                  }
              }

              // Render Table
              if (attachments.length > 0) {
                  doc.setFontSize(10); doc.setTextColor(0);
                  doc.text("Verzeichnis der eingereichten Belege:", 20, currentY);
                  
                  const tableBody = attachments.map(a => [
                      a.cat,
                      a.desc,
                      a.name,
                      a.type,
                      fmtNum(a.amount, a.currency)
                  ]);

                  autoTable(doc, {
                      startY: currentY + 5,
                      head: [['Kategorie', 'Beschreibung', 'Dateiname', 'Typ', 'Betrag']],
                      body: tableBody,
                      theme: 'grid',
                      headStyles: { fillColor: [50, 50, 50] },
                      columnStyles: { 4: { halign: 'right' } },
                      styles: { fontSize: 9 }
                  });
                  
                  currentY = (doc as any).lastAutoTable.finalY + 20;
              }

              // Embed Images
              for (const item of attachments) {
                  if (item.isImg) {
                      if (currentY > 230) { doc.addPage(); currentY = 20; }

                      doc.setFontSize(10); doc.setFont("helvetica", 'bold'); doc.setTextColor(0);
                      doc.text(`Anhang: ${item.name}`, 20, currentY);
                      doc.setFontSize(9); doc.setFont("helvetica", 'normal'); doc.setTextColor(100);
                      doc.text(`Zu: ${item.cat} - ${item.desc} (${fmtNum(item.amount, item.currency)})`, 20, currentY + 5);

                      try {
                          const imgData = await new Promise<string>((resolve) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(reader.result as string);
                              reader.readAsDataURL(item.blob);
                          });

                          const props = doc.getImageProperties(imgData);
                          const pdfWidth = 150; 
                          const pdfHeight = (props.height * pdfWidth) / props.width;

                          // Check if image fits on page, else add page
                          if (currentY + pdfHeight + 15 > 280) {
                              doc.addPage(); currentY = 20;
                              doc.setFontSize(10); doc.setFont("helvetica", 'bold'); doc.setTextColor(0);
                              doc.text(`Anhang: ${item.name} (Fortsetzung)`, 20, currentY);
                              currentY += 10;
                          }
                          
                          doc.addImage(imgData, 'JPEG', 30, currentY + 10, pdfWidth, pdfHeight);
                          currentY += pdfHeight + 25;
                      } catch (err) {
                          console.error("Img render error", err);
                      }
                  }
              }
          }
      }

      // Final Save
      const fileName = `Steuerreport_${year}_${p.name || 'Entwurf'}.pdf`;
      doc.save(fileName);
      return true;

    } catch (e: any) {
      console.error(e);
      alert("Fehler beim Erstellen des PDFs: " + e.message);
      return false;
    }
  }
}
