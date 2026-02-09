
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { createWorker } from 'tesseract.js';
// @ts-ignore
import * as mammoth from 'mammoth';
// @ts-ignore
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import { NoteDocument, DocCategory, AppData, TaxExpense, ExpenseEntry, ExpenseItem } from '../types';
import { VaultService } from './vaultService';
import { DBService } from './dbService';
import { GeminiService } from './geminiService';

// Set Worker manually for vite/browser environment
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

export class DocumentService {

  private static defaultRules: Record<string, DocCategory> = {
    'pass': 'Identität & Zivilstand', 'ausweis': 'Identität & Zivilstand', 'urkunde': 'Identität & Zivilstand', 'zivilstand': 'Identität & Zivilstand',
    'zeugnis': 'Bildung & Qualifikation', 'diplom': 'Bildung & Qualifikation', 'zertifikat': 'Bildung & Qualifikation', 'kurs': 'Bildung & Qualifikation',
    'lohn': 'Beruf & Beschäftigung', 'gehalt': 'Beruf & Beschäftigung', 'arbeit': 'Beruf & Beschäftigung', 'vertrag': 'Beruf & Beschäftigung', 'ahv': 'Beruf & Beschäftigung',
    'bank': 'Finanzen & Bankwesen', 'konto': 'Finanzen & Bankwesen', 'kredit': 'Finanzen & Bankwesen', 'depot': 'Finanzen & Bankwesen', 'rechnung': 'Finanzen & Bankwesen',
    'steuer': 'Steuern & Abgaben', 'tax': 'Steuern & Abgaben', 'finanzamt': 'Steuern & Abgaben', 'mwst': 'Steuern & Abgaben',
    'miete': 'Wohnen & Immobilien', 'wohnung': 'Wohnen & Immobilien', 'strom': 'Wohnen & Immobilien', 'nebenkosten': 'Wohnen & Immobilien',
    'arzt': 'Gesundheit & Vorsorge', 'krank': 'Gesundheit & Vorsorge', 'rezept': 'Gesundheit & Vorsorge', 'spital': 'Gesundheit & Vorsorge',
    'versicherung': 'Versicherungen', 'police': 'Versicherungen', 'helsana': 'Versicherungen', 'swica': 'Versicherungen',
    'anwalt': 'Recht & Verträge', 'gericht': 'Recht & Verträge', 'vollmacht': 'Recht & Verträge', 'agb': 'Recht & Verträge',
    'auto': 'Fahrzeuge & Mobilität', 'kfz': 'Fahrzeuge & Mobilität', 'bahn': 'Fahrzeuge & Mobilität', 'sbb': 'Fahrzeuge & Mobilität', 'flug': 'Fahrzeuge & Mobilität',
    'amt': 'Behörden & Soziales', 'gemeinde': 'Behörden & Soziales', 'rente': 'Behörden & Soziales', 'kindergeld': 'Behörden & Soziales',
    'garantie': 'Eigentum & Besitz', 'kaufbeleg': 'Eigentum & Besitz', 'quittung': 'Eigentum & Besitz', 'inventar': 'Eigentum & Besitz',
    'brief': 'Kommunikation & Korrespondenz', 'schreiben': 'Kommunikation & Korrespondenz', 'notiz': 'Kommunikation & Korrespondenz', 'email': 'Kommunikation & Korrespondenz',
    'erbe': 'Nachlass & Erbe', 'testament': 'Nachlass & Erbe', 'tod': 'Nachlass & Erbe', 'schenkung': 'Nachlass & Erbe',
    'software': 'Technik & IT', 'lizenz': 'Technik & IT', 'handbuch': 'Technik & IT', 'anleitung': 'Technik & IT', 'passwort': 'Technik & IT'
  };

  /**
   * ROBUST FILE SIGNATURE DETECTION (Magic Bytes)
   */
  static async detectRealMimeType(blob: Blob): Promise<string> {
      return new Promise((resolve) => {
          const fileReader = new FileReader();
          fileReader.onloadend = function(e) {
              if (!e.target || !e.target.result) {
                  resolve(blob.type || '');
                  return;
              }
              const arr = (new Uint8Array(e.target.result as ArrayBuffer)).subarray(0, 4);
              let header = "";
              for(let i = 0; i < arr.length; i++) {
                  header += arr[i].toString(16).toUpperCase();
              }

              if (header.startsWith('25504446')) { resolve('application/pdf'); return; }
              if (header.startsWith('504B0304')) { resolve('application/zip'); return; }
              if (header.startsWith('D0CF11E0')) { resolve('application/msword'); return; }
              if (header.startsWith('FFD8FF')) { resolve('image/jpeg'); return; }
              if (header.startsWith('89504E47')) { resolve('image/png'); return; }
              
              resolve(blob.type || '');
          };
          fileReader.readAsArrayBuffer(blob.slice(0, 4));
      });
  }

  static async performOCR(blob: Blob): Promise<string> {
      try {
          const worker = await createWorker('deu'); 
          const ret = await worker.recognize(blob);
          await worker.terminate();
          return ret.data.text;
      } catch (e) { 
          console.warn("OCR failed:", e);
          return ""; 
      }
  }

  static async extractTextFromWord(file: File | Blob): Promise<string> {
      try {
          const arrayBuffer = await file.arrayBuffer();
          // @ts-ignore
          let lib = mammoth;
          // @ts-ignore
          if (lib.default) lib = lib.default;
          if (!lib || !lib.extractRawText) return "";
          const result = await lib.extractRawText({ arrayBuffer: arrayBuffer });
          return result.value || "";
      } catch (e) { return ""; }
  }

  static async extractTextFromExcel(file: File | Blob): Promise<string> {
      try {
          const arrayBuffer = await file.arrayBuffer();
          // @ts-ignore
          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          let fullText = "";
          const limit = Math.min(wb.SheetNames.length, 3);
          for(let i=0; i<limit; i++) {
              const sheetName = wb.SheetNames[i];
              const ws = wb.Sheets[sheetName];
              // @ts-ignore
              const csv = XLSX.utils.sheet_to_csv(ws);
              fullText += `--- Blatt: ${sheetName} ---\n${csv}\n`;
          }
          return fullText;
      } catch (e) { return ""; }
  }

  static async extractTextFromPdf(file: File | Blob): Promise<string> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      const maxPages = Math.min(pdf.numPages, 3); 
      
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-ignore
        const pageText = textContent.items.map(item => item.str).join(' '); 
        fullText += pageText + '\n'; 
      }

      if (fullText.trim().length < 50) {
          console.log("PDF seems to be an image, trying OCR...");
          try {
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 2.0 });
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;

              if (context) {
                  // @ts-ignore
                  await page.render({ canvasContext: context, viewport: viewport }).promise;
                  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                  if (blob) {
                      const ocrText = await this.performOCR(blob);
                      fullText += "\n[OCR Extracted]:\n" + ocrText;
                  }
              }
          } catch (ocrErr) {
              console.warn("PDF OCR Fallback failed", ocrErr);
          }
      }

      return fullText;
    } catch (e) { 
        console.error("PDF extract error", e);
        return "PDF Inhalt konnte nicht gelesen werden."; 
    }
  }

  static extractYear(text: string): string {
    const simpleYear = text.match(/(202[0-9])/);
    return simpleYear ? simpleYear[0] : new Date().getFullYear().toString();
  }

  static categorizeText(text: string, filename: string, userRules: Record<string, string[]> = {}): DocCategory {
    const lowerText = (text + " " + filename).toLowerCase();
    const scores: Record<string, number> = {};
    const addScore = (keyword: string, category: string) => {
        const lowerKey = keyword.toLowerCase();
        if (lowerText.includes(lowerKey)) {
            scores[category] = (scores[category] || 0) + lowerKey.length;
        }
    };
    for (const [keyword, cat] of Object.entries(this.defaultRules)) addScore(keyword, cat);
    for (const [cat, keywords] of Object.entries(userRules)) {
        if (Array.isArray(keywords)) keywords.forEach(k => addScore(k, cat));
    }
    let bestCat = 'Sonstiges';
    let maxScore = 0;
    for (const [cat, score] of Object.entries(scores)) {
        if (score > maxScore) { maxScore = score; bestCat = cat; }
    }
    return bestCat;
  }

  static async processFile(file: File | Blob, userRules: Record<string, string[]> = {}, fileNameOverride?: string, forcedMetadata?: { year?: string, category?: string }): Promise<NoteDocument> {
    const name = fileNameOverride || (file as File).name || 'Unknown';
    const ext = name.split('.').pop()?.trim().toLowerCase() || '';
    
    // DETECT TYPE WITH PDF PRIORITY
    let realMimeType = await this.detectRealMimeType(file);
    
    // Force PDF if extension says PDF (Overrules weak magic byte detection that might say octet-stream)
    if (ext === 'pdf') realMimeType = 'application/pdf';

    console.log(`Processing ${name}: Detected Signature: ${realMimeType}, Extension: ${ext}`);

    let content = "";
    let docType: NoteDocument['type'] = 'other';

    if (realMimeType === 'application/pdf' || ext === 'pdf') {
        docType = 'pdf';
        content = await this.extractTextFromPdf(file);
    } 
    else if (realMimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) {
        docType = 'image';
        content = await this.performOCR(file);
    }
    else if (realMimeType === 'application/msword' || ext === 'doc' || ext === 'docx') {
        docType = 'word';
        content = await this.extractTextFromWord(file);
    }
    else if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
        docType = 'excel';
        content = await this.extractTextFromExcel(file);
    }
    else if (['txt', 'md', 'json', 'log'].includes(ext)) {
        docType = 'note';
        try { content = await file.text(); } catch {}
    }
    else { 
        content = name; 
        if(ext === 'pdf') docType = 'pdf'; 
    }

    const category = forcedMetadata?.category || this.categorizeText(content, name, userRules);
    const year = forcedMetadata?.year || this.extractYear(content) || new Date().getFullYear().toString();
    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;

    return {
        id,
        title: name,
        type: docType,
        category,
        subCategory: undefined,
        year,
        created: new Date().toISOString(),
        content: content,
        fileName: name,
        tags: [],
        isNew: true
    };
  }

  static async processManualUpload(files: FileList, userRules: Record<string, string[]> = {}): Promise<NoteDocument[]> {
      const docs: NoteDocument[] = [];
      for (let i = 0; i < files.length; i++) {
          try {
              const file = files[i];
              const doc = await this.processFile(file, userRules);
              await DBService.saveFile(doc.id, file);
              docs.push(doc);
          } catch (e) { console.error(e); }
      }
      return docs;
  }

  static async processArchiveZip(zipFile: File, userRules: Record<string, string[]> = {}): Promise<NoteDocument[]> {
      const zip = await JSZip.loadAsync(zipFile);
      const docs: NoteDocument[] = [];
      for (const [relativePath, entry] of Object.entries(zip.files)) {
          const zipEntry = entry as JSZip.JSZipObject;
          if (zipEntry.dir || relativePath.includes('__MACOSX') || relativePath.includes('.DS_Store')) continue;
          
          const parts = relativePath.split('/');
          const fileName = parts.pop() || relativePath;
          let forcedMetadata: { year?: string, category?: string } | undefined = undefined;
          let foundYear = undefined;
          let foundCat = undefined;

          for(const p of parts) if (p.match(/^202[0-9]$/)) foundYear = p;
          for(const p of parts) {
             const lowerP = p.toLowerCase();
             const knownCats = Object.values(this.defaultRules);
             if (knownCats.includes(p)) foundCat = p;
          }
          if (foundYear || foundCat) forcedMetadata = { year: foundYear, category: foundCat };

          try {
              const blob = await zipEntry.async("blob");
              const doc = await this.processFile(blob, userRules, fileName, forcedMetadata);
              await DBService.saveFile(doc.id, blob);
              docs.push(doc);
          } catch (e) { console.error(e); }
      }
      return docs;
  }

  static async scanInbox(
      currentNotes: Record<string, NoteDocument>, 
      userRules: Record<string, string[]> = {},
      useAI: boolean = false
  ): Promise<{ newDocs: NoteDocument[], movedCount: number, newTaxExpenses: TaxExpense[], newDailyExpenses: ExpenseEntry[], newSalaryData: any[] }> {
    
    if (!VaultService.isConnected()) throw new Error("Vault not connected");
    const root = await VaultService.getDirHandle();
    if (!root) throw new Error("No Vault Root");

    // @ts-ignore
    const inboxHandle = await root.getDirectoryHandle('_INBOX', { create: true });
    // @ts-ignore
    const archiveHandle = await root.getDirectoryHandle('_ARCHIVE', { create: true });

    const newDocs: NoteDocument[] = [];
    const newTaxExpenses: TaxExpense[] = [];
    const newDailyExpenses: ExpenseEntry[] = [];
    const newSalaryData: any[] = [];
    let movedCount = 0;

    // @ts-ignore
    for await (const entry of inboxHandle.values()) {
        if (entry.kind === 'file' && entry.name !== '.DS_Store') {
            
            // ARTIFICIAL DELAY TO PREVENT RATE LIMITING
            if (useAI) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay between files
            }

            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            if (file.size > 50 * 1024 * 1024) continue;

            try {
                let finalDoc: NoteDocument;
                let finalCategory: string;
                let finalSubCategory: string | undefined;
                let finalYear: string;
                
                let aiResult = null;

                if (useAI) {
                    aiResult = await GeminiService.analyzeDocument(file);
                }

                if (aiResult) {
                    finalCategory = aiResult.category || 'Sonstiges';
                    finalSubCategory = aiResult.subCategory; 
                    finalYear = aiResult.date ? aiResult.date.split('-')[0] : new Date().getFullYear().toString();
                    
                    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
                    
                    // Determine Type (Robust PDF Check)
                    let docType: NoteDocument['type'] = 'other';
                    const ext = file.name.split('.').pop()?.toLowerCase();
                    const mime = file.type || '';
                    if (ext === 'pdf' || mime.includes('pdf')) docType = 'pdf';
                    else if (['jpg','jpeg','png','heic','webp','heif'].includes(ext || '') || mime.startsWith('image/')) docType = 'image';

                    let contentHtml = aiResult.summary || "Automatisch analysiert durch AI.";
                    
                    const dbId = `receipt_auto_${Date.now()}`;
                    await DBService.saveFile(dbId, file);

                    // LOGIC: Salary vs Tax vs Daily
                    if (aiResult.salaryData && aiResult.salaryData.isSalary) {
                        // SALARY / INCOME IMPORT
                        const s = aiResult.salaryData;
                        newSalaryData.push({
                            year: s.year,
                            month: s.month, 
                            data: {
                                monatslohn: s.netIncome || 0,
                                brutto: s.grossIncome || 0,
                                ahv: s.ahv || 0,
                                alv: s.alv || 0,
                                bvg: s.bvg || 0,
                                quellensteuer: s.tax || 0,
                                auszahlung: s.payout || 0,
                                pdfFilename: dbId,
                                kommentar: `Importiert: ${aiResult.title}`
                            }
                        });
                        contentHtml += `<div style="color:green; font-weight:bold; margin-top:10px;">✅ Als Einnahme erkannt.</div>`;
                    
                    } else {
                        // ONLY IF NOT SALARY -> CHECK FOR EXPENSES
                        
                        if (aiResult.dailyExpenseData && aiResult.dailyExpenseData.isExpense) {
                            const d = aiResult.dailyExpenseData;
                            const generatedExpenseId = `expense_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
                            newDailyExpenses.push({
                                id: generatedExpenseId,
                                date: aiResult.date || new Date().toISOString().split('T')[0],
                                merchant: d.merchant || 'Unbekannt',
                                description: aiResult.title,
                                amount: d.amount || 0,
                                currency: d.currency || 'CHF',
                                rate: 1, 
                                category: (d.expenseCategory as any) || 'Sonstiges',
                                location: d.location,
                                receiptId: dbId,
                                isTaxRelevant: aiResult.isTaxRelevant,
                                items: d.items
                            });
                            contentHtml += `<div style="margin-top:15px; border-top:1px solid #eee; padding-top:10px;"><strong style="font-size:11px;">Beleg Details:</strong><br/>${d.merchant} - ${d.amount.toFixed(2)} ${d.currency}</div>`;
                        }
                        
                        if (aiResult.isTaxRelevant && aiResult.taxData) {
                            newTaxExpenses.push({
                                desc: aiResult.title || file.name,
                                amount: aiResult.taxData.amount || 0,
                                currency: aiResult.taxData.currency || 'CHF',
                                cat: (aiResult.taxData.taxCategory as any) || 'Sonstiges',
                                year: finalYear,
                                rate: 1, 
                                receipts: [dbId],
                                taxRelevant: true
                            });
                            contentHtml += `<div style="color:blue; font-weight:bold; margin-top:5px;">📋 Als Steuerabzug markiert.</div>`;
                        }
                    }

                    finalDoc = {
                        id,
                        title: aiResult.title || file.name,
                        type: docType,
                        category: finalCategory,
                        subCategory: finalSubCategory,
                        year: finalYear,
                        created: new Date().toISOString(),
                        content: contentHtml,
                        fileName: file.name,
                        tags: ['AI-Scanned'],
                        isNew: true,
                        taxRelevant: aiResult.isTaxRelevant,
                    };

                } else {
                    finalDoc = await this.processFile(file, userRules);
                    finalCategory = finalDoc.category;
                    finalYear = finalDoc.year;
                    finalSubCategory = undefined;
                }

                // @ts-ignore
                const yearDir = await archiveHandle.getDirectoryHandle(finalYear, { create: true });
                // @ts-ignore
                const catDir = await yearDir.getDirectoryHandle(finalCategory, { create: true });
                
                let targetDir = catDir;
                if (finalSubCategory) {
                    // @ts-ignore
                    targetDir = await catDir.getDirectoryHandle(finalSubCategory, { create: true });
                }

                // @ts-ignore
                const newFileHandle = await targetDir.getFileHandle(file.name, { create: true });
                // @ts-ignore
                const writable = await newFileHandle.createWritable();
                await writable.write(file);
                await writable.close();
                // @ts-ignore
                await inboxHandle.removeEntry(file.name);

                const subPath = finalSubCategory ? `${finalSubCategory}/${file.name}` : file.name;
                finalDoc.filePath = `_ARCHIVE/${finalYear}/${finalCategory}/${subPath}`;
                
                newDocs.push(finalDoc);
                movedCount++;

            } catch (err) { 
                console.error(`Failed to move ${file.name}`, err); 
                // Do not throw here, allow other files to be processed
            }
        }
    }
    return { newDocs, movedCount, newTaxExpenses, newDailyExpenses, newSalaryData };
  }

  static async rebuildIndexFromVault(): Promise<NoteDocument[]> {
      if (!VaultService.isConnected()) return [];
      const root = await VaultService.getDirHandle();
      if (!root) return [];

      const docs: NoteDocument[] = [];
      // @ts-ignore
      const archiveHandle = await root.getDirectoryHandle('_ARCHIVE', { create: true });

      const scanDir = async (dirHandle: FileSystemDirectoryHandle, pathPrefix: string, year: string, category: string, subCategory?: string) => {
          // @ts-ignore
          for await (const entry of dirHandle.values()) {
              if (entry.kind === 'file' && entry.name !== '.DS_Store') {
                  const fileHandle = entry as FileSystemFileHandle;
                  const file = await fileHandle.getFile();
                  const forcedMeta = { year, category };
                  const doc = await this.processFile(file, {}, file.name, forcedMeta);
                  
                  doc.subCategory = subCategory;
                  doc.filePath = `${pathPrefix}/${file.name}`;
                  docs.push(doc);
              } else if (entry.kind === 'directory') {
                  // @ts-ignore
                  const dirEntry = entry as FileSystemDirectoryHandle;
                  if (pathPrefix === '_ARCHIVE') {
                      await scanDir(dirEntry, `${pathPrefix}/${entry.name}`, entry.name, 'Sonstiges');
                  } else if (pathPrefix.split('/').length === 2) {
                      await scanDir(dirEntry, `${pathPrefix}/${entry.name}`, year, entry.name);
                  } else if (pathPrefix.split('/').length === 3) {
                      await scanDir(dirEntry, `${pathPrefix}/${entry.name}`, year, category, entry.name);
                  }
              }
          }
      };

      await scanDir(archiveHandle, '_ARCHIVE', '2025', 'Sonstiges');
      return docs;
  }

  static async moveFile(doc: NoteDocument, newCategory: DocCategory, newSubCategory?: string): Promise<NoteDocument> {
      if (!VaultService.isConnected() || !doc.filePath) return doc;
      
      const fileBlob = await this.getFileFromVault(doc.filePath);
      if (!fileBlob) throw new Error("Quelldatei nicht gefunden");

      const root = await VaultService.getDirHandle();
      // @ts-ignore
      const archiveHandle = await root!.getDirectoryHandle('_ARCHIVE', { create: true });
      // @ts-ignore
      const yearDir = await archiveHandle.getDirectoryHandle(doc.year, { create: true });
      // @ts-ignore
      const newCatDir = await yearDir.getDirectoryHandle(newCategory, { create: true });
      
      let targetDir = newCatDir;
      if (newSubCategory) {
          // @ts-ignore
          targetDir = await newCatDir.getDirectoryHandle(newSubCategory, { create: true });
      }

      const fileName = doc.fileName || doc.title;
      // @ts-ignore
      const newFileHandle = await targetDir.getFileHandle(fileName, { create: true });
      // @ts-ignore
      const writable = await newFileHandle.createWritable();
      await writable.write(fileBlob);
      await writable.close();

      try {
          const oldPathParts = doc.filePath.split('/');
          let currentDir = root;
          for(let i=0; i<oldPathParts.length - 1; i++) {
              // @ts-ignore
              currentDir = await currentDir!.getDirectoryHandle(oldPathParts[i]);
          }
          // @ts-ignore
          await currentDir!.removeEntry(oldPathParts[oldPathParts.length-1]);
      } catch (e) {
          console.warn("Could not delete old file", e);
      }

      const subPath = newSubCategory ? `${newSubCategory}/${fileName}` : fileName;
      doc.filePath = `_ARCHIVE/${doc.year}/${newCategory}/${subPath}`;
      doc.category = newCategory;
      doc.subCategory = newSubCategory;
      
      return doc;
  }

  /**
   * UPDATED GET FILE LOGIC (ROBUST SEARCH)
   * If exact match fails, iterates directory to find fuzzy match (Unicode NFD/NFC discrepancies).
   */
  static async getFileFromVault(filePath: string): Promise<Blob | null> {
      if (!VaultService.isConnected()) return null;
      const root = await VaultService.getDirHandle();
      if (!root) return null;

      const parts = filePath.split('/');
      const fileName = parts.pop(); // Remove filename from path array
      if (!fileName) return null;

      let currentDir = root;
      
      try {
          // Navigate to parent folder
          for (const part of parts) {
              // @ts-ignore
              currentDir = await currentDir.getDirectoryHandle(part);
          }
          
          // TRY 1: Exact Match
          try {
              // @ts-ignore
              const fileHandle = await currentDir.getFileHandle(fileName);
              return await fileHandle.getFile();
          } catch (err) {
              console.warn(`Exact match failed for ${fileName}, searching directory...`);
          }

          // TRY 2: Fuzzy Match (Unicode Normalization)
          // @ts-ignore
          for await (const entry of currentDir.values()) {
              if (entry.kind === 'file') {
                  const entryName = entry.name.normalize('NFC').trim();
                  const searchName = fileName.normalize('NFC').trim();
                  
                  if (entryName === searchName) {
                      console.log(`Fuzzy match found: ${entry.name}`);
                      // @ts-ignore
                      const fileHandle = entry as FileSystemFileHandle;
                      return await fileHandle.getFile();
                  }
              }
          }
          
          console.error("File not found in vault after fuzzy search:", filePath);
          return null;

      } catch (e) {
          console.error("Directory navigation failed:", filePath, e);
          return null;
      }
  }
}
