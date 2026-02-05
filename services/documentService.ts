

import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { createWorker } from 'tesseract.js';
// @ts-ignore
import * as mammoth from 'mammoth';
// @ts-ignore
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import { NoteDocument, DocCategory, AppData, TaxExpense } from '../types';
import { VaultService } from './vaultService';
import { DBService } from './dbService';
import { GeminiService } from './geminiService';

// Set Worker manually for vite/browser environment
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

interface ScoredCandidate {
    val: number;
    score: number;
}

export class DocumentService {

  // Updated Keywords for new categorization
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
   * LOCAL AI SIMULATION v4 (Scoring System)
   * Highly robust parsing using a weighted scoring algorithm to find the correct amount.
   */
  static parseReceiptContent(text: string): { amount?: number, date?: string, category?: string, desc?: string, currency?: string } {
      const result: any = { currency: 'CHF' }; // Default
      const lines = text.split(/\r?\n/);
      const lowerText = text.toLowerCase();

      // --- 1. CATEGORY & DESCRIPTION ---
      let bestCat = 'Sonstiges';
      let maxScore = 0;
      let detectedDesc = '';

      for (const [keyword, cat] of Object.entries(this.defaultRules)) {
          if (lowerText.includes(keyword)) {
              if (keyword.length > maxScore) { 
                  maxScore = keyword.length;
                  bestCat = cat;
                  detectedDesc = keyword.charAt(0).toUpperCase() + keyword.slice(1);
              }
          }
      }
      
      if (lowerText.includes('helsana') || lowerText.includes('swica')) { detectedDesc = 'Krankenkasse Prämie'; result.category = 'Versicherungen'; } // Updated cat
      else if (lowerText.includes('sbb') || lowerText.includes('ticket')) { detectedDesc = 'Reisekosten'; result.category = 'Fahrzeuge & Mobilität'; } // Updated cat
      else if (bestCat !== 'Sonstiges') { result.category = bestCat; result.desc = detectedDesc; }
      else { result.category = 'Sonstiges'; result.desc = 'Beleg'; }

      // --- 2. DATE EXTRACTION ---
      const dateRegex = /(\d{2})\.(\d{2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})/;
      for (let i = 0; i < Math.min(lines.length, 25); i++) {
          const match = lines[i].match(dateRegex);
          if (match) {
              if (match[1]) result.date = `${match[3]}-${match[2]}-${match[1]}`; 
              else result.date = match[0];
              break; 
          }
      }

      // --- 3. CURRENCY DETECTION (GLOBAL) ---
      let countEUR = (text.match(/EUR|€/gi) || []).length;
      let countCHF = (text.match(/CHF|Fr\./gi) || []).length;
      let countUSD = (text.match(/USD|\$/gi) || []).length;
      
      if (text.includes('Deutschland') || text.includes('Germany')) countEUR += 2;
      if (text.includes('Schweiz') || text.includes('Switzerland')) countCHF += 1;

      if (countEUR > countCHF && countEUR > countUSD) result.currency = 'EUR';
      else if (countUSD > countCHF && countUSD > countEUR) result.currency = 'USD';
      else result.currency = 'CHF';

      // --- 4. AMOUNT SCORING ENGINE ---
      const candidates: ScoredCandidate[] = [];
      const alimonyCandidates: number[] = []; // Simple list for Summation Logic

      const amountRegex = /([0-9']{1,3}(?:[']?[0-9]{3})*(?:[.,]\d{2})?)/g;

      for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          // POISON PILL: Skip lines with IDs, Phones, IBANs
          if (/IBAN|BIC|SWIFT|Konto|Account|Telefon|Tel\.|Fax|HRB|UID|Steuer-Nr|St-Nr|Matrikel|PLZ|Zip/i.test(cleanLine)) continue;

          const isTotalLine = /total|summe|betrag|amount|netto|zahlbar|überweisen/i.test(cleanLine);
          const hasCurrencyContext = /CHF|Fr\.|EUR|€|\$|USD/.test(cleanLine);
          
          // Line-specific currency override (strong signal)
          if (isTotalLine && hasCurrencyContext) {
             if (/EUR|€/.test(cleanLine)) result.currency = 'EUR';
             else if (/CHF|Fr\./.test(cleanLine)) result.currency = 'CHF';
             else if (/USD|\$/.test(cleanLine)) result.currency = 'USD';
          }

          let match;
          while ((match = amountRegex.exec(cleanLine)) !== null) {
              const matchText = match[1];
              const matchIndex = match.index;
              
              // Boundary Check: Ensure not part of alphanum code
              if (matchIndex > 0 && /[a-zA-Z]/.test(cleanLine[matchIndex - 1])) continue;
              if (matchIndex + matchText.length < cleanLine.length && /[a-zA-Z]/.test(cleanLine[matchIndex + matchText.length])) continue;

              // Normalize
              let raw = matchText.replace(/'/g, '');
              // German logic: 1.200,50 -> 1200.50
              if (raw.includes(',') && !raw.includes('.')) raw = raw.replace(',', '.');
              else if (raw.includes('.') && raw.includes(',')) {
                  if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) raw = raw.replace(/\./g, '').replace(',', '.'); 
                  else raw = raw.replace(/,/g, ''); 
              }
              
              const val = parseFloat(raw);
              
              if (!isNaN(val)) {
                  const isInteger = Math.floor(val) === val;
                  
                  // FILTER: Large Integers without Currency Context (HRB Numbers, IDs, etc)
                  if (val > 2500 && isInteger && !hasCurrencyContext && !isTotalLine) continue;
                  
                  // FILTER: Years (1990-2030)
                  const looksLikeYear = val >= 1990 && val <= 2030 && isInteger;
                  if (looksLikeYear && !hasCurrencyContext) continue;

                  // FILTER: Garbage values
                  if (val < 1) continue; 

                  alimonyCandidates.push(val);

                  // SCORING
                  let score = 1; 
                  if (hasCurrencyContext) score += 5;
                  if (isTotalLine) score += 10;
                  if (!isInteger) score += 2; // Decimals prefered for amounts
                  if (isInteger && val > 2000) score -= 5; // Large integers penalized

                  // Position Bonus: Numbers lower in the document often Total
                  // (Not implemented here to keep simple, but TotalLine handles most)

                  candidates.push({ val, score });
              }
          }
      }

      // --- 5. DECISION LOGIC ---
      
      // A. Special Case: Alimony Summation (Check new categories if needed, but Alimente is specific logic)
      if (text.toLowerCase().includes('alimente') && alimonyCandidates.length > 1) {
          const sum = alimonyCandidates.reduce((a, b) => a + b, 0);
          const max = Math.max(...alimonyCandidates);
          
          if (sum > max * 1.5) {
              result.amount = sum;
              result.desc += ' (Summiert)';
              return result;
          }
      }

      // B. Standard Scoring
      if (candidates.length > 0) {
          // Sort by Score DESC, then Value DESC
          candidates.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return b.val - a.val;
          });
          result.amount = candidates[0].val;
      } else {
          result.amount = 0;
      }

      return result;
  }

  static async performOCR(blob: Blob): Promise<string> {
      try {
          console.log("Starte OCR...");
          const worker = await createWorker('deu'); 
          const ret = await worker.recognize(blob);
          await worker.terminate();
          return ret.data.text;
      } catch (e) {
          console.error("OCR Fehler:", e);
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
      
      // If PDF text layer is empty (scanned PDF), try OCR
      if (fullText.trim().length < 50) {
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (context) {
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              await page.render({ canvasContext: context, viewport: viewport } as any).promise;
              const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
              if (blob) {
                  const ocrText = await this.performOCR(blob);
                  fullText += "\n[OCR RESULT]\n" + ocrText;
              }
          }
      }
      return fullText;
    } catch (e) { return ""; }
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

  static extractYear(text: string): string {
    const simpleYear = text.match(/(202[0-9])/);
    return simpleYear ? simpleYear[0] : new Date().getFullYear().toString();
  }

  static async processFile(file: File | Blob, userRules: Record<string, string[]> = {}, fileNameOverride?: string, forcedMetadata?: { year?: string, category?: string }): Promise<NoteDocument> {
    const name = fileNameOverride || (file as File).name || 'Unknown';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    let content = "";
    let docType: NoteDocument['type'] = 'other';

    if (file.type === 'application/pdf' || ext === 'pdf') {
        docType = 'pdf';
        content = await this.extractTextFromPdf(file);
    } 
    else if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic'].includes(ext)) {
        docType = 'image';
        content = await this.performOCR(file);
    }
    else if (['doc', 'docx'].includes(ext)) {
        docType = 'word';
        content = await this.extractTextFromWord(file);
        if (!content) content = name;
    }
    else if (['xls', 'xlsx', 'csv'].includes(ext)) {
        docType = 'excel';
        content = await this.extractTextFromExcel(file);
        if (!content) content = name;
    }
    else if (['pages'].includes(ext)) {
        docType = 'word'; content = `Apple Pages: ${name}`;
    }
    else if (['txt', 'md', 'json', 'log'].includes(ext)) {
        docType = 'note';
        try { content = await file.text(); } catch {}
    }
    else { content = name; }

    const category = forcedMetadata?.category || this.categorizeText(content, name, userRules);
    const year = forcedMetadata?.year || this.extractYear(content) || new Date().getFullYear().toString();
    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;

    return {
        id,
        title: name,
        type: docType,
        category,
        subCategory: undefined, // Default no subcat for regex based
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
             if (!foundCat) {
                 for(const [key, val] of Object.entries(this.defaultRules)) {
                     if (lowerP.includes(key)) { foundCat = val; break; }
                 }
             }
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

  // --- UPDATED SCAN INBOX WITH SUB-CATEGORIES ---
  static async scanInbox(
      currentNotes: Record<string, NoteDocument>, 
      userRules: Record<string, string[]> = {}
  ): Promise<{ newDocs: NoteDocument[], movedCount: number, newTaxExpenses: TaxExpense[] }> {
    
    if (!VaultService.isConnected()) throw new Error("Vault not connected");
    const root = await VaultService.getDirHandle();
    if (!root) throw new Error("No Vault Root");

    // @ts-ignore
    const inboxHandle = await root.getDirectoryHandle('_INBOX', { create: true });
    // @ts-ignore
    const archiveHandle = await root.getDirectoryHandle('_ARCHIVE', { create: true });

    const newDocs: NoteDocument[] = [];
    const newTaxExpenses: TaxExpense[] = [];
    let movedCount = 0;

    // @ts-ignore
    for await (const entry of inboxHandle.values()) {
        if (entry.kind === 'file' && entry.name !== '.DS_Store') {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            if (file.size > 50 * 1024 * 1024) continue; // Skip large files

            try {
                // 1. ANALYZE WITH GEMINI
                const aiResult = await GeminiService.analyzeDocument(file);
                
                // Fallback vars
                let finalDoc: NoteDocument;
                let finalCategory: string;
                let finalSubCategory: string | undefined;
                let finalYear: string;

                if (aiResult) {
                    // AI SUCCESS
                    finalCategory = aiResult.category || 'Sonstiges';
                    finalSubCategory = aiResult.subCategory; // New field from Gemini
                    finalYear = aiResult.date ? aiResult.date.split('-')[0] : new Date().getFullYear().toString();
                    
                    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
                    
                    finalDoc = {
                        id,
                        title: aiResult.title || file.name,
                        type: (file.type.startsWith('image') || file.type.includes('pdf')) ? (file.type.includes('pdf') ? 'pdf' : 'image') : 'other',
                        category: finalCategory,
                        subCategory: finalSubCategory,
                        year: finalYear,
                        created: new Date().toISOString(),
                        content: aiResult.summary || "Automatisch analysiert durch AI.",
                        fileName: file.name,
                        tags: ['AI-Scanned'],
                        isNew: true,
                        taxRelevant: aiResult.isTaxRelevant
                    };

                    // Handle Tax Relevance
                    if (aiResult.isTaxRelevant && aiResult.taxData) {
                        const dbId = `receipt_auto_${Date.now()}`;
                        await DBService.saveFile(dbId, file);

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
                    }

                } else {
                    // AI FALLBACK (Regex)
                    finalDoc = await this.processFile(file, userRules);
                    finalCategory = finalDoc.category;
                    finalYear = finalDoc.year;
                    finalSubCategory = undefined;
                }

                // 2. MOVE FILE IN VAULT WITH SUB-FOLDER
                // @ts-ignore
                const yearDir = await archiveHandle.getDirectoryHandle(finalYear, { create: true });
                // @ts-ignore
                const catDir = await yearDir.getDirectoryHandle(finalCategory, { create: true });
                
                let targetDir = catDir;
                // Create subfolder if needed
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

                // Build Path
                const subPath = finalSubCategory ? `${finalSubCategory}/${file.name}` : file.name;
                finalDoc.filePath = `_ARCHIVE/${finalYear}/${finalCategory}/${subPath}`;
                
                newDocs.push(finalDoc);
                movedCount++;

            } catch (err) { 
                console.error(`Failed to move ${file.name}`, err); 
            }
        }
    }
    return { newDocs, movedCount, newTaxExpenses };
  }

  // --- RECURSIVE REINDEX TO SUPPORT SUBFOLDERS ---
  static async rebuildIndexFromVault(): Promise<NoteDocument[]> {
    if (!VaultService.isConnected()) throw new Error("Vault not connected");
    const root = await VaultService.getDirHandle();
    if (!root) throw new Error("No Vault Root");

    const recoveredDocs: NoteDocument[] = [];
    
    // Process a specific directory, looking for files
    const processDirectory = async (dirHandle: FileSystemDirectoryHandle, year: string, category: string, subCategory?: string) => {
         // @ts-ignore
         for await (const entry of dirHandle.values()) {
             if (entry.kind === 'file' && entry.name !== '.DS_Store') {
                  const fileHandle = entry as FileSystemFileHandle;
                  const file = await fileHandle.getFile();
                  const ext = file.name.split('.').pop()?.toLowerCase() || '';
                  
                  let docType: NoteDocument['type'] = 'other';
                  if (['pdf'].includes(ext)) docType = 'pdf';
                  else if (['jpg','jpeg','png','heic'].includes(ext)) docType = 'image';
                  else if (['doc','docx'].includes(ext)) docType = 'word';
                  else if (['xls','xlsx','csv'].includes(ext)) docType = 'excel';
                  else if (['txt','md'].includes(ext)) docType = 'note';

                  let content = "";
                  try {
                      if (docType === 'word') content = await this.extractTextFromWord(file);
                      else if (docType === 'excel') content = await this.extractTextFromExcel(file);
                      else if (docType === 'pdf') content = await this.extractTextFromPdf(file);
                  } catch (e) {}
                  if (!content || content.length < 5) content = `Datei: ${file.name}`;

                  const idPart = subCategory ? `${category}_${subCategory}` : category;
                  const id = `rec_${year}_${idPart}_${file.name.replace(/\W/g,'')}`;
                  
                  const subPath = subCategory ? `${subCategory}/${file.name}` : file.name;

                  recoveredDocs.push({
                      id, title: file.name, type: docType, category, subCategory, year,
                      created: new Date(file.lastModified).toISOString(), content,
                      fileName: file.name, filePath: `_ARCHIVE/${year}/${category}/${subPath}`,
                      tags: [], isNew: false
                  });
             }
         }
    };

    try {
        // @ts-ignore
        const archiveHandle = await root.getDirectoryHandle('_ARCHIVE');
        // @ts-ignore
        for await (const yearEntry of archiveHandle.values()) {
            if (yearEntry.kind === 'directory') {
                const year = yearEntry.name;
                const yearHandle = yearEntry as FileSystemDirectoryHandle;
                
                // @ts-ignore
                for await (const catEntry of yearHandle.values()) {
                    if (catEntry.kind === 'directory') {
                        const category = catEntry.name as DocCategory;
                        const catHandle = catEntry as FileSystemDirectoryHandle;
                        
                        // 1. Process Files directly in Category Folder (Legacy/Standard)
                        await processDirectory(catHandle, year, category, undefined);

                        // 2. Check for Sub-Directories (New Structure)
                        // @ts-ignore
                        for await (const subEntry of catHandle.values()) {
                            if (subEntry.kind === 'directory') {
                                const subCat = subEntry.name;
                                const subHandle = subEntry as FileSystemDirectoryHandle;
                                await processDirectory(subHandle, year, category, subCat);
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {}
    return recoveredDocs;
  }

  // --- UPDATED MOVE FILE TO SUPPORT SUBFOLDERS ---
  static async moveFile(doc: NoteDocument, newCategory: DocCategory, newSubCategory?: string): Promise<NoteDocument> {
      if (!VaultService.isConnected() || !doc.filePath) return { ...doc, category: newCategory, subCategory: newSubCategory };
      
      // If nothing changed, return
      if (doc.category === newCategory && doc.subCategory === newSubCategory) return doc; 
      
      try {
          const root = await VaultService.getDirHandle();
          if(!root) throw new Error("No Vault");
          const oldBlob = await this.getFileFromVault(doc.filePath);
          if (!oldBlob) throw new Error("Quelldatei nicht gefunden");
          
          // @ts-ignore
          const archiveHandle = await root.getDirectoryHandle('_ARCHIVE');
          // @ts-ignore
          const yearHandle = await archiveHandle.getDirectoryHandle(doc.year, { create: true });
          
          // New Category Dir
          // @ts-ignore
          const newCatHandle = await yearHandle.getDirectoryHandle(newCategory, { create: true });
          
          let targetDir = newCatHandle;
          // New Sub Dir if needed
          if (newSubCategory) {
              // @ts-ignore
              targetDir = await newCatHandle.getDirectoryHandle(newSubCategory, { create: true });
          }

          // @ts-ignore
          const newFileHandle = await targetDir.getFileHandle(doc.fileName, { create: true });
          // @ts-ignore
          const writable = await newFileHandle.createWritable();
          await writable.write(oldBlob);
          await writable.close();

          // Delete Old File
          // We need to find the parent dir of the old file
          const pathParts = doc.filePath.split('/');
          // pathParts: _ARCHIVE / YEAR / CAT / (SUBCAT?) / FILE
          // If length is 4: _ARCHIVE/2024/Cat/file.pdf
          // If length is 5: _ARCHIVE/2024/Cat/Sub/file.pdf
          
          const oldCatName = pathParts[2];
          // @ts-ignore
          const oldCatDir = await yearHandle.getDirectoryHandle(oldCatName);
          
          if (pathParts.length === 5) {
               // Was in subfolder
               const oldSubName = pathParts[3];
               // @ts-ignore
               const oldSubDir = await oldCatDir.getDirectoryHandle(oldSubName);
               // @ts-ignore
               await oldSubDir.removeEntry(doc.fileName);
               // Optional: remove subfolder if empty? No, dangerous.
          } else {
               // Was in main folder
               // @ts-ignore
               await oldCatDir.removeEntry(doc.fileName);
          }

          const subPath = newSubCategory ? `${newSubCategory}/${doc.fileName}` : doc.fileName;
          return { ...doc, category: newCategory, subCategory: newSubCategory, filePath: `_ARCHIVE/${doc.year}/${newCategory}/${subPath}` };
      } catch (e) { 
          console.error("Move failed", e);
          return doc; 
      }
  }

  static async getFileFromVault(filePath: string): Promise<Blob | null> {
      if (!VaultService.isConnected()) return null;
      if (!filePath) return null;
      try {
          const parts = filePath.split('/');
          let currentDir = await VaultService.getDirHandle();
          for (let i = 0; i < parts.length - 1; i++) {
              if(!currentDir) return null;
              // @ts-ignore
              currentDir = await currentDir.getDirectoryHandle(parts[i]);
          }
          // @ts-ignore
          const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1]);
          return await fileHandle.getFile();
      } catch (e) { return null; }
  }
}