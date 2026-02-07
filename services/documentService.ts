
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { createWorker } from 'tesseract.js';
// @ts-ignore
import * as mammoth from 'mammoth';
// @ts-ignore
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

import { NoteDocument, DocCategory, AppData, TaxExpense, ExpenseEntry } from '../types';
import { VaultService } from './vaultService';
import { DBService } from './dbService';
import { GeminiService } from './geminiService';

// Set Worker manually for vite/browser environment
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

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

  static async performOCR(blob: Blob): Promise<string> {
      try {
          const worker = await createWorker('deu'); 
          const ret = await worker.recognize(blob);
          await worker.terminate();
          return ret.data.text;
      } catch (e) { 
          // Tesseract fails on HEIC usually or corrupted images
          console.warn("OCR failed (possibly unsupported format like HEIC in this browser):", e);
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
      
      // 1. Try standard text extraction
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-ignore
        const pageText = textContent.items.map(item => item.str).join(' '); 
        fullText += pageText + '\n'; 
      }

      // 2. If text is extremely short (e.g. Scanned PDF / Image in PDF), try OCR on the first page
      if (fullText.trim().length < 50) {
          console.log("PDF text empty, attempting OCR on PDF Page 1...");
          try {
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 2.0 }); // High res for OCR
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;

              if (context) {
                  // @ts-ignore
                  await page.render({ canvasContext: context, viewport: viewport }).promise;
                  
                  // Convert canvas to blob for OCR
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
        return ""; 
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
    const ext = name.split('.').pop()?.toLowerCase() || '';
    let content = "";
    let docType: NoteDocument['type'] = 'other';
    
    // Explicit Type Check or Ext Check
    const type = file.type || '';

    // Improved Type Detection with fallback for empty MIME types (HEIC)
    if (type === 'application/pdf' || ext === 'pdf') {
        docType = 'pdf';
        content = await this.extractTextFromPdf(file);
    } 
    else if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'webp', 'heif'].includes(ext)) {
        docType = 'image';
        // Only attempt OCR if not HEIC, or if browser supports it. 
        // We wrap in try/catch in performOCR anyway.
        content = await this.performOCR(file);
        if (!content && (ext === 'heic' || ext === 'heif')) {
            content = "[HEIC Image - Inhalt nur via AI sichtbar]";
        }
    }
    else if (['doc', 'docx'].includes(ext) || type.includes('word')) {
        docType = 'word';
        content = await this.extractTextFromWord(file);
    }
    else if (['xls', 'xlsx', 'csv'].includes(ext) || type.includes('spreadsheet') || type.includes('excel')) {
        docType = 'excel';
        content = await this.extractTextFromExcel(file);
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
      userRules: Record<string, string[]> = {}
  ): Promise<{ newDocs: NoteDocument[], movedCount: number, newTaxExpenses: TaxExpense[], newDailyExpenses: ExpenseEntry[] }> {
    
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
    let movedCount = 0;

    // @ts-ignore
    for await (const entry of inboxHandle.values()) {
        if (entry.kind === 'file' && entry.name !== '.DS_Store') {
            const fileHandle = entry as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            if (file.size > 50 * 1024 * 1024) continue;

            try {
                // 1. ANALYZE WITH GEMINI
                const aiResult = await GeminiService.analyzeDocument(file);
                
                let finalDoc: NoteDocument;
                let finalCategory: string;
                let finalSubCategory: string | undefined;
                let finalYear: string;

                if (aiResult) {
                    finalCategory = aiResult.category || 'Sonstiges';
                    finalSubCategory = aiResult.subCategory; 
                    finalYear = aiResult.date ? aiResult.date.split('-')[0] : new Date().getFullYear().toString();
                    
                    const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
                    
                    // Determine Type manually if file.type is empty (HEIC fix)
                    let docType: NoteDocument['type'] = 'other';
                    const ext = file.name.split('.').pop()?.toLowerCase();
                    const mime = file.type || '';
                    if (mime.includes('pdf') || ext === 'pdf') docType = 'pdf';
                    else if (mime.startsWith('image/') || ['jpg','jpeg','png','heic','webp','heif'].includes(ext || '')) docType = 'image';

                    finalDoc = {
                        id,
                        title: aiResult.title || file.name,
                        type: docType,
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

                    const dbId = `receipt_auto_${Date.now()}`;
                    await DBService.saveFile(dbId, file);

                    if (aiResult.dailyExpenseData && aiResult.dailyExpenseData.isExpense) {
                        const expense = aiResult.dailyExpenseData;
                        newDailyExpenses.push({
                            id: `expense_${Date.now()}`,
                            date: aiResult.date || new Date().toISOString().split('T')[0],
                            merchant: expense.merchant || 'Unbekannt',
                            description: aiResult.title,
                            amount: expense.amount || 0,
                            currency: expense.currency || 'CHF',
                            rate: 1, 
                            category: (expense.expenseCategory as any) || 'Sonstiges',
                            location: expense.location,
                            receiptId: dbId,
                            isTaxRelevant: aiResult.isTaxRelevant,
                            items: expense.items // PASS THE EXTRACTED ITEMS
                        });
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
                    }

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
            }
        }
    }
    return { newDocs, movedCount, newTaxExpenses, newDailyExpenses };
  }

  // --- IMPLEMENTED: REBUILD INDEX & GET FILE FROM VAULT ---

  static async rebuildIndexFromVault(): Promise<NoteDocument[]> {
      if (!VaultService.isConnected()) return [];
      const root = await VaultService.getDirHandle();
      if (!root) return [];

      const docs: NoteDocument[] = [];
      // @ts-ignore
      const archiveHandle = await root.getDirectoryHandle('_ARCHIVE', { create: true });

      // Recursive scanner
      const scanDir = async (dirHandle: FileSystemDirectoryHandle, pathPrefix: string, year: string, category: string, subCategory?: string) => {
          // @ts-ignore
          for await (const entry of dirHandle.values()) {
              if (entry.kind === 'file' && entry.name !== '.DS_Store') {
                  const fileHandle = entry as FileSystemFileHandle;
                  const file = await fileHandle.getFile();
                  
                  // Re-process metadata without OCR if possible for speed
                  const forcedMeta = { year, category };
                  const doc = await this.processFile(file, {}, file.name, forcedMeta);
                  
                  doc.subCategory = subCategory;
                  doc.filePath = `${pathPrefix}/${file.name}`;
                  docs.push(doc);
              } else if (entry.kind === 'directory') {
                  // Traverse deeper
                  // Structure: _ARCHIVE / YEAR / CAT / [SUBCAT]
                  // If we are at root archive, entry is YEAR
                  // @ts-ignore
                  const dirEntry = entry as FileSystemDirectoryHandle;
                  if (pathPrefix === '_ARCHIVE') {
                      await scanDir(dirEntry, `${pathPrefix}/${entry.name}`, entry.name, 'Sonstiges');
                  } else if (pathPrefix.split('/').length === 2) {
                      // Inside Year, entry is CAT
                      await scanDir(dirEntry, `${pathPrefix}/${entry.name}`, year, entry.name);
                  } else if (pathPrefix.split('/').length === 3) {
                      // Inside Cat, entry is SUBCAT
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

      // Delete old file (Best effort, path parsing)
      try {
          const oldPathParts = doc.filePath.split('/');
          // _ARCHIVE / YEAR / CAT / [SUB] / FILE
          // Navigate to parent of file
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

  static async getFileFromVault(filePath: string): Promise<Blob | null> {
      if (!VaultService.isConnected()) return null;
      const root = await VaultService.getDirHandle();
      if (!root) return null;

      try {
          const parts = filePath.split('/');
          let currentDir = root;
          
          // Navigate folders
          for (let i = 0; i < parts.length - 1; i++) {
              // @ts-ignore
              currentDir = await currentDir.getDirectoryHandle(parts[i]);
          }
          
          // Get File
          const fileName = parts[parts.length - 1];
          // @ts-ignore
          const fileHandle = await currentDir.getFileHandle(fileName);
          return await fileHandle.getFile();
      } catch (e) {
          console.error("File not found in vault:", filePath, e);
          return null;
      }
  }
}
