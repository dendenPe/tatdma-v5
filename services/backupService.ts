
import JSZip from 'jszip';
import { AppData, SalaryEntry, NoteDocument } from '../types';
import { DBService } from './dbService';
// Import DocumentService dynamically or ensure no circular dependency
import { DocumentService } from './documentService'; 

export class BackupService {

  static async createBackupZip(data: AppData): Promise<Blob> {
    const zip = new JSZip();
    
    // 1. Main Data JSON
    zip.file("TradeLog_Data.json", JSON.stringify(data, null, 2));

    // Mapping to restore IDs on import: { [dbId]: "path/in/zip" }
    const fileMapping: Record<string, string> = {};

    // 2. Steuern (Tax Receipts)
    const taxFolder = zip.folder("Steuern");
    for (const expense of data.tax.expenses) {
      if (expense.receipts && expense.receipts.length > 0) {
        for (const fileId of expense.receipts) {
          try {
            const blob = await DBService.getFile(fileId);
            if (blob) {
              const file = blob as File;
              const safeName = (file.name || 'Beleg').replace(/[^a-z0-9.]/gi, '_');
              const safeCat = expense.cat.replace(/[^a-z0-9]/gi, '_');
              const zipFileName = `${safeCat}_${safeName}`;
              
              if (taxFolder) {
                taxFolder.file(zipFileName, blob);
                fileMapping[fileId] = `Steuern/${zipFileName}`;
              }
            }
          } catch (e) { console.warn(`Skipped tax receipt ${fileId}`, e); }
        }
      }
    }

    // 3. Trades (Screenshots)
    const tradesFolder = zip.folder("Trades");
    for (const [date, dayEntry] of Object.entries(data.trades)) {
      if (dayEntry.screenshots && dayEntry.screenshots.length > 0) {
         for (let i = 0; i < dayEntry.screenshots.length; i++) {
            const fileId = dayEntry.screenshots[i];
            try {
                const blob = await DBService.getFile(fileId);
                if (blob) {
                   const file = blob as File;
                   const ext = file.type.split('/')[1] || 'png';
                   const zipFileName = `${date}_img_${i+1}.${ext}`;
                   
                   if (tradesFolder) {
                     tradesFolder.file(zipFileName, blob);
                     fileMapping[fileId] = `Trades/${zipFileName}`;
                   }
                }
            } catch (e) { console.warn(`Skipped trade image ${fileId}`, e); }
         }
      }
    }

    // 4. Salary (Lohnzettel)
    const salaryFolder = zip.folder("Salary");
    for (const [year, months] of Object.entries(data.salary)) {
       for (const [monthKey, entry] of Object.entries(months)) {
          const salEntry = entry as SalaryEntry;
          if (salEntry.pdfFilename) {
             try {
                 const blob = await DBService.getFile(salEntry.pdfFilename);
                 if (blob) {
                    const file = blob as File;
                    const safeName = (file.name || 'Lohn').replace(/[^a-z0-9.]/gi, '_');
                    const zipPath = `${year}/${monthKey}_${safeName}`;
                    
                    if (salaryFolder) {
                       salaryFolder.file(zipPath, blob);
                       fileMapping[salEntry.pdfFilename] = `Salary/${zipPath}`;
                    }
                 }
             } catch (e) { console.warn(`Skipped salary doc ${salEntry.pdfFilename}`, e); }
          }
       }
    }

    // 5. Notes & Documents (Vault Sync Logic)
    const docsFolder = zip.folder("Documents");
    const notes = Object.values(data.notes || {}) as NoteDocument[];
    
    for (const note of notes) {
        // Skip text-only notes
        if (note.type === 'note' || !note.id) continue;

        try {
            let blob: Blob | null = await DBService.getFile(note.id);
            
            // If not in DB, try fetching from Vault (Desktop scenario)
            if (!blob && note.filePath) {
                blob = await DocumentService.getFileFromVault(note.filePath);
            }

            if (blob) {
                // Create a clean path inside ZIP: Documents/Year/Category/Filename
                const safeYear = note.year || 'Unsorted';
                const safeCat = (note.category || 'Sonstiges').replace(/[^a-z0-9]/gi, '_');
                const originalName = note.fileName || note.title || `doc_${note.id}`;
                const safeName = originalName.replace(/[^a-z0-9.]/gi, '_');
                
                // Ensure extension
                let finalName = safeName;
                if (!finalName.includes('.')) {
                    if (blob.type === 'application/pdf') finalName += '.pdf';
                    else if (blob.type.includes('image')) finalName += '.jpg';
                }

                const zipPath = `${safeYear}/${safeCat}/${finalName}`;
                
                if (docsFolder) {
                    docsFolder.file(zipPath, blob);
                    // IMPORTANT: Map the Note ID to this file in ZIP
                    fileMapping[note.id] = `Documents/${zipPath}`;
                }
            }
        } catch (e) {
            console.warn(`Failed to include document ${note.title} in backup`, e);
        }
    }

    // 6. Daily Expenses (Manual or non-Note linked receipts)
    const dailyFolder = zip.folder("DailyExpenses");
    if (data.dailyExpenses) {
        for (const [year, expenses] of Object.entries(data.dailyExpenses)) {
            for (const exp of expenses) {
                // Only if fileId exists AND it hasn't been mapped already (e.g. by Notes)
                if (exp.receiptId && !fileMapping[exp.receiptId]) {
                    try {
                        const blob = await DBService.getFile(exp.receiptId);
                        if (blob) {
                            const file = blob as File;
                            // Default extension
                            let ext = 'jpg';
                            if (file.type) ext = file.type.split('/')[1];
                            
                            const zipFileName = `exp_${exp.id}.${ext}`;
                            
                            if (dailyFolder) {
                                dailyFolder.file(zipFileName, blob);
                                fileMapping[exp.receiptId] = `DailyExpenses/${zipFileName}`;
                            }
                        }
                    } catch (e) { console.warn("Skipped daily exp receipt", e); }
                }
            }
        }
    }

    // Save Mapping
    zip.file("file_mapping.json", JSON.stringify(fileMapping, null, 2));

    return await zip.generateAsync({ type: "blob" });
  }

  static async restoreBackupZip(file: File): Promise<AppData> {
     const zip = await JSZip.loadAsync(file);
     
     // 1. Load Data
     const dataFile = zip.file("TradeLog_Data.json");
     if (!dataFile) throw new Error("Keine gültige Backup-Datei (TradeLog_Data.json fehlt)");
     
     const jsonStr = await dataFile.async("string");
     const data = JSON.parse(jsonStr) as AppData;

     // 2. Load Mapping
     const mapFile = zip.file("file_mapping.json");
     let mapping: Record<string, string> = {};
     if (mapFile) {
        const mapStr = await mapFile.async("string");
        mapping = JSON.parse(mapStr);
     }

     // 3. Restore Files to IndexedDB
     const restorePromises = Object.entries(mapping).map(async ([dbId, zipPath]) => {
        const fileInZip = zip.file(zipPath);
        if (fileInZip) {
           const blob = await fileInZip.async("blob");
           // Restore as File object if possible to keep name metadata
           const fileName = zipPath.split('/').pop() || "restored_file";
           const restoredFile = new File([blob], fileName, { type: blob.type });
           
           await DBService.saveFile(dbId, restoredFile);
        }
     });

     await Promise.all(restorePromises);

     return data;
  }
}
