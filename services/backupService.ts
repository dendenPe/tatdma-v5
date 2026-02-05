
import JSZip from 'jszip';
import { AppData, SalaryEntry } from '../types';
import { DBService } from './dbService';

export class BackupService {

  static async createBackupZip(data: AppData): Promise<Blob> {
    const zip = new JSZip();
    
    // 1. Main Data JSON
    zip.file("TradeLog_Data.json", JSON.stringify(data, null, 2));

    // Mapping to restore IDs on import: { [dbId]: "path/in/zip" }
    const fileMapping: Record<string, string> = {};

    // 2. Steuern (Tax Receipts)
    // Structure: Steuern/<Kategorie>_<OriginalName>.pdf
    const taxFolder = zip.folder("Steuern");
    
    for (const expense of data.tax.expenses) {
      if (expense.receipts && expense.receipts.length > 0) {
        for (const fileId of expense.receipts) {
          const blob = await DBService.getFile(fileId);
          if (blob) {
            const file = blob as File;
            // Clean filename
            const safeName = (file.name || 'Beleg').replace(/[^a-z0-9.]/gi, '_');
            const safeCat = expense.cat.replace(/[^a-z0-9]/gi, '_');
            const zipFileName = `${safeCat}_${safeName}`;
            
            if (taxFolder) {
              taxFolder.file(zipFileName, blob);
              const fullPath = `Steuern/${zipFileName}`;
              fileMapping[fileId] = fullPath;
            }
          }
        }
      }
    }

    // 3. Trades (Screenshots)
    // Structure: Trades/<Date>_<Time>.img
    const tradesFolder = zip.folder("Trades");
    for (const [date, dayEntry] of Object.entries(data.trades)) {
      if (dayEntry.screenshots && dayEntry.screenshots.length > 0) {
         for (let i = 0; i < dayEntry.screenshots.length; i++) {
            const fileId = dayEntry.screenshots[i];
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
         }
      }
    }

    // 4. Salary (Lohnzettel)
    // Structure: Salary/<Year>/<Month>_Lohn.pdf
    const salaryFolder = zip.folder("Salary");
    for (const [year, months] of Object.entries(data.salary)) {
       for (const [monthKey, entry] of Object.entries(months)) {
          const salEntry = entry as SalaryEntry;
          if (salEntry.pdfFilename) {
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
          }
       }
    }

    // 5. Portfolios (If specific files existed, structure would be Portfolios/<Name>/<Year>/...)
    // Currently portfolios are mainly data in JSON, but if we had IBKR reports as files we would add them here.
    
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
     // We iterate the mapping, read the file from zip, and save to DB with the ORIGINAL ID.
     // This ensures the AppData references remain valid.
     const restorePromises = Object.entries(mapping).map(async ([dbId, zipPath]) => {
        const fileInZip = zip.file(zipPath);
        if (fileInZip) {
           const blob = await fileInZip.async("blob");
           // Restore as File object if possible to keep name metadata, though DBService handles Blobs
           // We try to extract original name from zip path
           const fileName = zipPath.split('/').pop() || "restored_file";
           const restoredFile = new File([blob], fileName, { type: blob.type });
           
           await DBService.saveFile(dbId, restoredFile);
        }
     });

     await Promise.all(restorePromises);

     return data;
  }
}
