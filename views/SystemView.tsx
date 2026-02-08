
import React, { useState, useEffect } from 'react';
import { Package, Download, Archive, RefreshCw, AlertCircle, CheckCircle, FolderOpen, Key, Share2, FileDown, Search, X } from 'lucide-react';
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
  const [message, setMessage] = useState<{type: 'success'|'error'|'info', text: string} | null>(null);
  
  // State für den Download Prozess
  const [readyBackup, setReadyBackup] = useState<{blob: Blob, filename: string, url: string} | null>(null);
  const [showIOSOverlay, setShowIOSOverlay] = useState(false);

  useEffect(() => {
      return () => {
          if (readyBackup?.url) URL.revokeObjectURL(readyBackup.url);
      };
  }, [readyBackup]);

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
    setReadyBackup(null);
    setShowIOSOverlay(false);

    try {
      const blob = await BackupService.createBackupZip(data);
      const filename = `TaTDMA_Backup_${new Date().toISOString().split('T')[0]}.zip`;

      if (VaultService.isConnected()) {
          await VaultService.writeFile(filename, blob);
          setMessage({ type: 'success', text: `Backup "${filename}" im Vault gespeichert!` });
      } else {
          // Generiere URL
          const url = URL.createObjectURL(blob);
          setReadyBackup({ blob, filename, url });
          
          // Check Device Type
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
          
          if (isIOS) {
              // iOS: Zeige Overlay statt direktem Download
              setShowIOSOverlay(true);
          } else {
              // Desktop/Android: Zeige Info Box
              setMessage({ type: 'info', text: "Backup erstellt! Bitte unten Methode wählen." });
          }
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: "Fehler beim Export: " + err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const triggerManualShare = async () => {
      if (!readyBackup) return;
      const file = new File([readyBackup.blob], readyBackup.filename, { type: 'application/zip' });
      
      if (navigator.share) {
          try {
              await navigator.share({
                  files: [file],
                  title: 'TaTDMA Backup',
                  text: `Backup vom ${new Date().toLocaleDateString()}`
              });
              setMessage({ type: 'success', text: "Erfolgreich." });
          } catch (e: any) {
              // Wenn Share fehlschlägt, Overlay öffnen als Fallback
              if (e.name !== 'AbortError') {
                  setShowIOSOverlay(true);
              }
          }
      } else {
          setShowIOSOverlay(true);
      }
  };

  const closeOverlay = () => {
      setShowIOSOverlay(false);
      // Optional: Cleanup backup URL if user closes overlay
      // setReadyBackup(null); 
  };

  const resetApiKey = () => {
      if(confirm("Möchtest du den gespeicherten API Key wirklich löschen?")) {
          localStorage.removeItem('tatdma_api_key');
          window.location.reload();
      }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-24">
      {message && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : message.type === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-red-50 text-red-700 border border-red-200'} animate-in slide-in-from-top-2`}>
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="font-bold text-sm">{message.text}</span>
        </div>
      )}

      {/* iOS SAFE DOWNLOAD OVERLAY */}
      {showIOSOverlay && readyBackup && (
          <div className="fixed inset-0 z-[9999] bg-gray-900/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
                  <button onClick={closeOverlay} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200">
                      <X size={20} />
                  </button>
                  
                  <div className="flex flex-col items-center text-center space-y-6 pt-4">
                      <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center shadow-inner">
                          <Package size={40} />
                      </div>
                      
                      <div>
                          <h3 className="text-xl font-black text-gray-800">Backup bereit</h3>
                          <p className="text-xs text-gray-400 mt-2 font-mono bg-gray-100 p-2 rounded-lg break-all">
                              {readyBackup.filename}
                          </p>
                      </div>

                      <div className="w-full space-y-3">
                          {/* CRITICAL: A simple HTML link is the most robust way for iOS Safari to trigger the Download Manager without weird context switches */}
                          <a 
                              href={readyBackup.url}
                              download={readyBackup.filename}
                              className="w-full py-4 bg-blue-600 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-blue-700 shadow-lg shadow-blue-200 flex items-center justify-center gap-2 active:scale-95 transition-transform"
                              onClick={() => {
                                  // Don't close immediately, give user time to see native prompt
                                  setTimeout(() => setMessage({ type: 'success', text: "Download sollte gestartet sein. Prüfe 'Dateien' App." }), 1000);
                              }}
                          >
                              <Download size={20} /> DATEI LADEN
                          </a>
                          
                          <p className="text-[10px] text-gray-400 leading-relaxed px-2">
                              <strong>Anleitung:</strong><br/>
                              1. Klicke auf <strong>"DATEI LADEN"</strong>.<br/>
                              2. Bestätige das Popup <strong>"Laden"</strong>.<br/>
                              3. Klicke auf den blauen Pfeil <span className="inline-block bg-gray-200 rounded px-1 text-blue-600">↓</span> in der Adressleiste oder öffne die App <strong>"Dateien"</strong>.
                          </p>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* DESKTOP / FALLBACK CARD (Wenn Overlay nicht aktiv ist) */}
      {readyBackup && !showIOSOverlay && (
          <div className="bg-[#16325c] rounded-3xl p-6 shadow-xl shadow-blue-900/20 text-white animate-in zoom-in-95 border-2 border-white/10">
              <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm"><FileDown size={32}/></div>
                  <div>
                      <h4 className="text-xl font-black">Backup bereit!</h4>
                      <p className="text-blue-200 text-xs mt-1 font-bold tracking-wide">Wähle eine Methode:</p>
                  </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button 
                      onClick={triggerManualShare}
                      className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
                  >
                      <Share2 size={18} /> Teilen (Mobil)
                  </button>

                  <a 
                      href={readyBackup.url}
                      download={readyBackup.filename}
                      className="w-full px-6 py-4 bg-white text-[#16325c] border border-transparent rounded-xl font-black text-sm uppercase tracking-widest hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
                  >
                      <Download size={18} /> Download
                  </a>
              </div>
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
               {isExporting ? 'Erstelle...' : 'ZIP Erstellen'}
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
