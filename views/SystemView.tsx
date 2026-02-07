
import React, { useState } from 'react';
import { Package, Download, Archive, RefreshCw, AlertCircle, CheckCircle, FolderOpen, Key } from 'lucide-react';
import { AppData, APP_VERSION, DayEntry } from '../types';
import { VaultService } from '../services/vaultService';
import { BackupService } from '../services/backupService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
}

const SystemView: React.FC<Props> = ({ data, onUpdate }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;

     setIsImporting(true);
     setMessage(null);

     try {
       const restoredData = await BackupService.restoreBackupZip(file);
       onUpdate(restoredData);
       setMessage({ type: 'success', text: `Backup erfolgreich wiederhergestellt! (${Object.keys(restoredData.trades).length} Tage)` });
     } catch (err: any) {
       console.error(err);
       setMessage({ type: 'error', text: "Fehler beim Import: " + err.message });
     } finally {
       setIsImporting(false);
       e.target.value = '';
     }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    setMessage(null);
    try {
      const blob = await BackupService.createBackupZip(data);
      const filename = `TaTDMA_Backup_${new Date().toISOString().split('T')[0]}.zip`;

      if (VaultService.isConnected()) {
          // DIRECT VAULT SAVE
          await VaultService.writeFile(filename, blob);
          setMessage({ type: 'success', text: `Backup "${filename}" (Version ${APP_VERSION}) im Vault gespeichert!` });
      } else {
          // BROWSER DOWNLOAD FALLBACK
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setMessage({ type: 'success', text: `Backup ZIP (Version ${APP_VERSION}) erfolgreich erstellt!` });
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: "Fehler beim Export: " + err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const resetApiKey = () => {
      if(confirm("Möchtest du den gespeicherten API Key wirklich löschen?")) {
          localStorage.removeItem('tatdma_api_key');
          window.location.reload();
      }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {message && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'} animate-in slide-in-from-top-2`}>
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="font-bold text-sm">{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
            <RefreshCw size={32} />
          </div>
          <div>
            <h4 className="text-xl font-bold text-gray-700">Speicherort (Vault)</h4>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Verbinde einen lokalen Ordner (z.B. iCloud Drive), um deine Daten automatisch zu sichern.
              <br/><br/>
              <span className="text-blue-600 font-bold">Status:</span> Wenn verbunden, wird bei jeder Änderung automatisch eine <code>tatdma_autosave.json</code> im Ordner aktualisiert.
            </p>
          </div>
          <button 
            onClick={() => VaultService.connect()}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
          >
            <FolderOpen size={18} />
            {VaultService.isConnected() ? 'Verbindung erneuern' : 'Ordner Verbinden'}
          </button>
        </div>

        <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
          <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
            <Archive size={32} />
          </div>
          <div>
            <h4 className="text-xl font-bold text-gray-700">Manuelles Backup</h4>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Erstelle ein vollständiges ZIP-Backup inklusive aller Bilder und PDF-Belege.
              <br/><br/>
              Ist der Vault aktiv, wird die Datei <strong>direkt dort gespeichert</strong>.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
             <label className={`bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-center text-xs flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
               <Package size={18} /> 
               {isImporting ? 'Importiere...' : 'ZIP Import'}
               <input type="file" className="hidden" accept=".zip" onChange={handleZipImport} disabled={isImporting} />
             </label>
             <button 
               onClick={handleExportAll} 
               disabled={isExporting}
               className={`bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-center text-xs flex flex-col items-center justify-center gap-2 transition-all ${isExporting ? 'opacity-50 cursor-wait' : ''}`}
             >
               <Download size={18} /> 
               {isExporting ? 'Sichere...' : 'ZIP Backup'}
             </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-yellow-50 text-yellow-600 rounded-2xl flex items-center justify-center">
                  <Key size={24} />
              </div>
              <div>
                  <h4 className="text-lg font-bold text-gray-700">AI Konfiguration</h4>
                  <p className="text-xs text-gray-400">Gemini API Key verwalten.</p>
              </div>
          </div>
          <button onClick={resetApiKey} className="px-6 py-3 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold hover:bg-red-50 hover:text-red-500 transition-colors">
              Key Löschen / Ändern
          </button>
      </div>

      <div className="bg-gray-900 rounded-2xl p-8 text-white">
        <h5 className="text-xs uppercase font-bold text-gray-500 tracking-[0.2em] mb-4">Daten Statistik</h5>
        <div className="grid grid-cols-3 gap-8">
           <div>
             <span className="block text-2xl font-bold">{Object.keys(data.trades).length}</span>
             <span className="text-[10px] uppercase font-bold text-gray-500">Handelstage</span>
           </div>
           <div>
             <span className="block text-2xl font-bold">{(Object.values(data.trades) as DayEntry[]).reduce((a, b) => a + b.trades.length, 0)}</span>
             <span className="text-[10px] uppercase font-bold text-gray-500">Einzeltrades</span>
           </div>
           <div>
             <span className="block text-2xl font-bold">{data.tax.expenses.length}</span>
             <span className="text-[10px] uppercase font-bold text-gray-500">Belege</span>
           </div>
        </div>
      </div>
    </div>
  );
};

export default SystemView;
