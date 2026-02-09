
import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, FileUp, Download, Eye, Paperclip, Calculator, ListFilter, Maximize2, Minimize2, Trash2, FileText, Check, X, User, Info, Pencil } from 'lucide-react';
import { AppData, SalaryEntry, SalaryCertificateData } from '../types';
import { DBService } from '../services/dbService';
import { ImportService } from '../services/importService';

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  globalYear: string;
}

const SalaryView: React.FC<Props> = ({ data, onUpdate, globalYear }) => {
  const [year, setYear] = useState(globalYear);
  const [isDetailed, setIsDetailed] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [activeCertTab, setActiveCertTab] = useState<'p1' | 'p2'>('p1');
  const [editingMonthIdx, setEditingMonthIdx] = useState<number | null>(null);
  
  // Sync with global year
  useEffect(() => {
    setYear(globalYear);
  }, [globalYear]);

  const yearData: Record<string, SalaryEntry> = data.salary[year] || {};
  
  // Ensure we have certificate data container
  const certData: SalaryCertificateData = data.salaryCertificates?.[year] || {
      p1: { grossMain: 0, grossSide: 0, grossSimple: 0, expenses: 0 },
      p2: { grossMain: 0, grossSide: 0, grossSimple: 0, expenses: 0 }
  };

  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  
  // Refs for file uploads
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate ref for CSV import to avoid conflict
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [uploadingMonthIdx, setUploadingMonthIdx] = useState<number | null>(null);

  const getEntry = (mIdx: number): SalaryEntry => {
    const key = String(mIdx + 1).padStart(2, '0');
    return yearData[key] || {
      monatslohn: 0,
      familienzulage: 0,
      pauschalspesen: 0,
      aufrechnung: 0,
      brutto: 0,
      ahv: 0,
      alv: 0,
      sozialfond: 0,
      bvg: 0,
      quellensteuer: 0,
      abzuege: 0,
      netto: 0,
      korrektur: 0,
      auszahlung: 0,
      kommentar: ''
    };
  };

  const updateEntry = (mIdx: number, field: keyof SalaryEntry, value: any) => {
    const key = String(mIdx + 1).padStart(2, '0');
    const newData = { ...data };
    if (!newData.salary[year]) newData.salary[year] = {};
    
    const current = getEntry(mIdx);
    const updated = { ...current, [field]: value };

    // Automatic calculations based on Swiss salary logic
    updated.brutto = (Number(updated.monatslohn) || 0) + 
                     (Number(updated.familienzulage) || 0) + 
                     (Number(updated.pauschalspesen) || 0) + 
                     (Number(updated.aufrechnung) || 0);

    updated.abzuege = (Number(updated.ahv) || 0) + 
                      (Number(updated.alv) || 0) + 
                      (Number(updated.sozialfond) || 0) + 
                      (Number(updated.bvg) || 0) + 
                      (Number(updated.quellensteuer) || 0);

    updated.netto = updated.brutto - updated.abzuege;
    updated.auszahlung = updated.netto + (Number(updated.korrektur) || 0);

    newData.salary[year][key] = updated;
    onUpdate(newData);
  };

  // --- CERTIFICATE UPDATE LOGIC ---
  const updateCertData = (person: 'p1' | 'p2', field: keyof SalaryCertificateData['p1'], value: number) => {
      const newData = { ...data };
      if (!newData.salaryCertificates) newData.salaryCertificates = {};
      if (!newData.salaryCertificates[year]) {
          newData.salaryCertificates[year] = {
              p1: { grossMain: 0, grossSide: 0, grossSimple: 0, expenses: 0 },
              p2: { grossMain: 0, grossSide: 0, grossSimple: 0, expenses: 0 }
          };
      }
      newData.salaryCertificates[year][person][field] = value;
      onUpdate(newData);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploadingMonthIdx === null) return;
    const file = files[0];
    const id = `salary_${year}_${uploadingMonthIdx + 1}_${Date.now()}`;
    
    await DBService.saveFile(id, file);
    updateEntry(uploadingMonthIdx, 'pdfFilename', id);
    setUploadingMonthIdx(null);
    if(fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      
      const parsedData = ImportService.parseSalaryCSV(text);
      const newData = { ...data };

      let importCount = 0;
      
      // Merge logic
      Object.keys(parsedData).forEach(y => {
          if (!newData.salary[y]) newData.salary[y] = {};
          
          Object.keys(parsedData[y]).forEach(m => {
             // Preserve existing PDF attachments if simple value update
             const existingPdf = newData.salary[y][m]?.pdfFilename;
             newData.salary[y][m] = { 
                 ...parsedData[y][m], 
                 pdfFilename: existingPdf || parsedData[y][m].pdfFilename 
             };
             importCount++;
          });
      });

      onUpdate(newData);
      alert(`${importCount} Datensätze erfolgreich importiert.`);
      // Reset
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const triggerUpload = (idx: number) => {
    setUploadingMonthIdx(idx);
    fileInputRef.current?.click();
  };

  const viewPdf = async (id: string) => {
     const blob = await DBService.getFile(id);
     if (blob) {
         const url = URL.createObjectURL(blob);
         window.open(url, '_blank');
     } else {
         alert("Datei nicht gefunden.");
     }
  };

  const deletePdf = (idx: number) => {
      if (confirm("Lohnzettel Anhang wirklich löschen?")) {
          updateEntry(idx, 'pdfFilename', undefined);
      }
  };

  const formatCHF = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const allColumns = [
    { id: 'monatslohn', label: 'Monatslohn', color: 'blue', isSummary: true },
    { id: 'familienzulage', label: 'Fam. Zulage', color: 'blue', isSummary: false },
    { id: 'pauschalspesen', label: 'Spesen', color: 'blue', isSummary: false },
    { id: 'aufrechnung', label: 'Aufrechn.', color: 'blue', isSummary: false },
    { id: 'brutto', label: 'Brutto', color: 'gray', readOnly: true, isSummary: true },
    { id: 'ahv', label: 'AHV/IV/EO', color: 'red', isSummary: false },
    { id: 'alv', label: 'ALV', color: 'red', isSummary: false },
    { id: 'sozialfond', label: 'S-Fond', color: 'red', isSummary: false },
    { id: 'bvg', label: 'BVG/PK', color: 'red', isSummary: false },
    { id: 'quellensteuer', label: 'Q-Steuer', color: 'red', isSummary: true },
    { id: 'abzuege', label: 'Abzüge T.', color: 'gray', readOnly: true, isSummary: false },
    { id: 'netto', label: 'Netto', color: 'gray', readOnly: true, isSummary: true },
    { id: 'korrektur', label: 'Korrektur', color: 'blue', isSummary: false },
    { id: 'auszahlung', label: 'Auszahlung', color: 'green', readOnly: true, isSummary: true },
  ];

  const activeColumns = allColumns.filter(col => isDetailed || col.isSummary);

  return (
    <div className="space-y-6 max-w-full overflow-hidden pb-32">
      {/* Header Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center justify-between lg:justify-start gap-6">
          <div className="flex items-center gap-2">
            <button onClick={() => setYear((parseInt(year)-1).toString())} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-2xl font-black text-[#16325c] tracking-tight">{year}</h3>
            <button onClick={() => setYear((parseInt(year)+1).toString())} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="hidden lg:block h-10 w-px bg-gray-100" />
          <div className="hidden lg:block">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Währung</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs font-black text-gray-800">Alle Beträge in CHF</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* NEW CERTIFICATE BUTTON */}
          <button 
            onClick={() => setShowCertModal(true)}
            className="flex-1 lg:flex-none px-4 py-2 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all hover:bg-blue-100"
          >
            <FileText size={14} /> Lohnausweis
          </button>

          <button 
            onClick={() => setIsDetailed(!isDetailed)}
            className={`flex-1 lg:flex-none px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all border ${
              isDetailed ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {isDetailed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isDetailed ? 'Min' : 'Details'}
          </button>
          
          <label className="flex-1 lg:flex-none px-4 py-2 bg-[#16325c] text-white rounded-lg text-xs font-bold hover:bg-[#1c3f74] flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-900/10 cursor-pointer">
            <FileUp size={14} /> Import
            <input type="file" ref={csvInputRef} className="hidden" accept=".csv" onChange={handleCsvImport} />
          </label>
        </div>
      </div>

      <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,image/*" onChange={(e) => handleFileUpload(e.target.files)} />

      {/* Scrollable Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className={`w-full text-left border-collapse table-fixed transition-all duration-300 ${isDetailed ? 'min-w-[1200px] lg:min-w-[1800px]' : 'min-w-[800px] lg:min-w-[1000px]'}`}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="sticky left-0 z-20 bg-gray-50 px-4 py-4 font-bold text-gray-500 uppercase tracking-wider text-[10px] w-24 lg:w-32 border-r border-gray-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">Monat</th>
                {activeColumns.map(col => (
                  <th key={col.id} className={`px-2 py-4 font-bold text-center uppercase tracking-wider text-[10px] w-32 ${col.color === 'red' ? 'text-red-400' : col.color === 'green' ? 'text-green-500' : 'text-blue-400'}`}>
                    {col.label}
                  </th>
                ))}
                <th className="px-4 py-4 font-bold text-gray-500 uppercase tracking-wider text-[10px] w-24 lg:w-32 text-center">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {months.map((m, idx) => {
                const e = getEntry(idx);
                return (
                  <tr key={m} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50/30 px-4 py-3 font-bold text-gray-700 text-xs border-r border-gray-100 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">{m.substring(0,3)}<span className="hidden lg:inline">{m.substring(3)}</span></td>
                    {activeColumns.map(col => (
                      <td key={col.id} className="px-1 py-2">
                        <input 
                          type="number" 
                          step="0.01"
                          readOnly={col.readOnly}
                          value={e[col.id as keyof SalaryEntry] || 0}
                          onChange={(ev) => updateEntry(idx, col.id as keyof SalaryEntry, parseFloat(ev.target.value) || 0)}
                          className={`w-full bg-transparent text-center outline-none transition-all px-1 py-1.5 rounded text-xs font-medium ${
                            col.readOnly ? 'bg-gray-50/50 text-gray-400 cursor-default' : 'hover:bg-white hover:shadow-sm focus:bg-white focus:ring-1 focus:ring-blue-200 text-gray-700'
                          } ${col.id === 'auszahlung' ? 'font-black text-green-600 !text-sm' : ''} ${col.color === 'red' ? 'text-red-500/80' : ''}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 lg:px-4 py-3 text-center">
                      <div className="flex justify-center gap-1 group/btn">
                         <button onClick={() => setEditingMonthIdx(idx)} className="p-1.5 lg:p-2 bg-gray-50 text-gray-400 rounded-lg hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Details & Bearbeiten">
                            <Pencil size={14} />
                         </button>
                         <div className="w-px h-4 bg-gray-200 mx-1"></div>
                         {e.pdfFilename ? (
                            <>
                                <button onClick={() => viewPdf(e.pdfFilename!)} className="p-1.5 lg:p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100" title="Ansehen">
                                   <Eye size={14} />
                                </button>
                                <button onClick={() => deletePdf(idx)} className="p-1.5 lg:p-2 bg-white text-gray-300 rounded-lg hover:bg-red-50 hover:text-red-500 lg:opacity-0 lg:group-hover/btn:opacity-100 transition-opacity" title="Löschen">
                                   <Trash2 size={14} />
                                </button>
                            </>
                         ) : (
                            <button onClick={() => triggerUpload(idx)} className="p-1.5 lg:p-2 bg-gray-50 text-gray-300 rounded-lg hover:text-blue-500 hover:bg-blue-50 transition-colors" title="Upload">
                               <Paperclip size={14} />
                            </button>
                         )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#f8f9fc] font-bold border-t border-gray-200">
              <tr className="divide-x divide-gray-100">
                <td className="sticky left-0 z-10 bg-[#f8f9fc] px-4 py-5 uppercase text-[10px] tracking-widest text-gray-400 border-r border-gray-200">Total</td>
                {activeColumns.map(col => (
                  <td key={col.id} className={`px-2 py-5 text-center text-xs font-black ${col.id === 'auszahlung' ? 'text-green-600' : 'text-gray-700'}`}>
                    {formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (Number(e[col.id as keyof SalaryEntry]) || 0), 0))}
                  </td>
                ))}
                <td className="bg-[#f8f9fc]"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* NEW: ANNUAL CERTIFICATE DISPLAY CARD */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 text-white shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10"><FileText size={100} /></div>
          <div className="relative z-10">
              <h4 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                  <FileText size={16}/> Jahresdaten gemäss Lohnausweis (Für Steuererklärung)
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* P1 Data */}
                  <div className="space-y-3">
                      <div className="flex items-center gap-2 text-blue-300 font-bold text-xs uppercase tracking-wide border-b border-white/10 pb-1">
                          <User size={12}/> Einzelperson / Partner 1 (P1)
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.1 Haupterwerb (Brutto)</span>
                          <span className="font-mono font-bold text-lg">{certData.p1.grossMain > 0 ? certData.p1.grossMain.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.2 Nebenerwerb</span>
                          <span className="font-mono font-bold">{certData.p1.grossSide > 0 ? certData.p1.grossSide.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.3 Vereinfacht (Netto)</span>
                          <span className="font-mono font-bold text-green-300">{certData.p1.grossSimple > 0 ? certData.p1.grossSimple.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">10.1 Pauschalspesen</span>
                          <span className="font-mono font-bold text-blue-300">{certData.p1.expenses > 0 ? certData.p1.expenses.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                  </div>

                  {/* P2 Data */}
                  <div className="space-y-3">
                      <div className="flex items-center gap-2 text-pink-300 font-bold text-xs uppercase tracking-wide border-b border-white/10 pb-1">
                          <User size={12}/> Ehefrau / Partner 2 (P2)
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.1 Haupterwerb (Brutto)</span>
                          <span className="font-mono font-bold text-lg">{certData.p2.grossMain > 0 ? certData.p2.grossMain.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.2 Nebenerwerb</span>
                          <span className="font-mono font-bold">{certData.p2.grossSide > 0 ? certData.p2.grossSide.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">1.3 Vereinfacht (Netto)</span>
                          <span className="font-mono font-bold text-green-300">{certData.p2.grossSimple > 0 ? certData.p2.grossSimple.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">10.2 Pauschalspesen</span>
                          <span className="font-mono font-bold text-pink-300">{certData.p2.expenses > 0 ? certData.p2.expenses.toLocaleString('de-CH', {minimumFractionDigits: 2}) : '-'}</span>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Brutto (Tabelle)</p>
             <p className="text-lg lg:text-xl font-black text-gray-700">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.brutto || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Quellensteuer (Tabelle)</p>
             <p className="text-lg lg:text-xl font-black text-red-600">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.quellensteuer || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Netto Auszahlung (Tabelle)</p>
             <p className="text-lg lg:text-xl font-black text-green-600">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.auszahlung || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
      </div>

      {/* EDIT ENTRY MODAL */}
      {editingMonthIdx !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                  <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                          <Pencil size={18} className="text-blue-600"/>
                          {months[editingMonthIdx]} {year}
                      </h3>
                      <button onClick={() => setEditingMonthIdx(null)}><X size={20} className="text-gray-400 hover:text-gray-600"/></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto space-y-6">
                      {/* Einkommen Section */}
                      <div>
                          <h4 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-3 border-b border-blue-100 pb-1">Einkommen & Zulagen</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Monatslohn</label><input type="number" value={getEntry(editingMonthIdx).monatslohn} onChange={(e) => updateEntry(editingMonthIdx, 'monatslohn', parseFloat(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Familienzulage</label><input type="number" value={getEntry(editingMonthIdx).familienzulage} onChange={(e) => updateEntry(editingMonthIdx, 'familienzulage', parseFloat(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Spesen</label><input type="number" value={getEntry(editingMonthIdx).pauschalspesen} onChange={(e) => updateEntry(editingMonthIdx, 'pauschalspesen', parseFloat(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Aufrechnung</label><input type="number" value={getEntry(editingMonthIdx).aufrechnung} onChange={(e) => updateEntry(editingMonthIdx, 'aufrechnung', parseFloat(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Korrektur (+/-)</label><input type="number" value={getEntry(editingMonthIdx).korrektur} onChange={(e) => updateEntry(editingMonthIdx, 'korrektur', parseFloat(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-100"/></div>
                          </div>
                      </div>

                      {/* Abzüge Section */}
                      <div>
                          <h4 className="text-xs font-black text-red-500 uppercase tracking-widest mb-3 border-b border-red-100 pb-1">Sozialabzüge</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">AHV/IV/EO</label><input type="number" value={getEntry(editingMonthIdx).ahv} onChange={(e) => updateEntry(editingMonthIdx, 'ahv', parseFloat(e.target.value))} className="w-full bg-red-50/30 border border-red-100 rounded-lg px-3 py-2 font-bold text-red-600 outline-none focus:ring-2 focus:ring-red-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">ALV</label><input type="number" value={getEntry(editingMonthIdx).alv} onChange={(e) => updateEntry(editingMonthIdx, 'alv', parseFloat(e.target.value))} className="w-full bg-red-50/30 border border-red-100 rounded-lg px-3 py-2 font-bold text-red-600 outline-none focus:ring-2 focus:ring-red-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">S-Fond/KTG/UVG</label><input type="number" value={getEntry(editingMonthIdx).sozialfond} onChange={(e) => updateEntry(editingMonthIdx, 'sozialfond', parseFloat(e.target.value))} className="w-full bg-red-50/30 border border-red-100 rounded-lg px-3 py-2 font-bold text-red-600 outline-none focus:ring-2 focus:ring-red-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">BVG / PK</label><input type="number" value={getEntry(editingMonthIdx).bvg} onChange={(e) => updateEntry(editingMonthIdx, 'bvg', parseFloat(e.target.value))} className="w-full bg-red-50/30 border border-red-100 rounded-lg px-3 py-2 font-bold text-red-600 outline-none focus:ring-2 focus:ring-red-100"/></div>
                              <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Quellensteuer</label><input type="number" value={getEntry(editingMonthIdx).quellensteuer} onChange={(e) => updateEntry(editingMonthIdx, 'quellensteuer', parseFloat(e.target.value))} className="w-full bg-red-50/30 border border-red-100 rounded-lg px-3 py-2 font-bold text-red-600 outline-none focus:ring-2 focus:ring-red-100"/></div>
                          </div>
                      </div>

                      {/* Notizen & Anhang */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div className="space-y-2">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Kommentar / Notiz</h4>
                              <textarea 
                                  value={getEntry(editingMonthIdx).kommentar || ''}
                                  onChange={(e) => updateEntry(editingMonthIdx, 'kommentar', e.target.value)}
                                  className="w-full h-24 bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-sm resize-none outline-none focus:ring-2 focus:ring-yellow-200"
                                  placeholder="Notizen zur Abrechnung..."
                              />
                          </div>
                          <div className="space-y-2">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">PDF Beleg</h4>
                              <div className="h-24 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center bg-gray-50/50">
                                  {getEntry(editingMonthIdx).pdfFilename ? (
                                      <div className="flex flex-col items-center gap-2">
                                          <span className="text-xs font-bold text-blue-600">Beleg vorhanden</span>
                                          <div className="flex gap-2">
                                              <button onClick={() => viewPdf(getEntry(editingMonthIdx).pdfFilename!)} className="px-3 py-1 bg-blue-100 text-blue-600 rounded text-xs font-bold hover:bg-blue-200">Ansehen</button>
                                              <button onClick={() => deletePdf(editingMonthIdx)} className="px-3 py-1 bg-red-100 text-red-600 rounded text-xs font-bold hover:bg-red-200">Löschen</button>
                                          </div>
                                      </div>
                                  ) : (
                                      <button onClick={() => triggerUpload(editingMonthIdx)} className="text-gray-400 hover:text-blue-500 flex flex-col items-center gap-1">
                                          <Paperclip size={20} />
                                          <span className="text-xs font-bold">PDF Hochladen</span>
                                      </button>
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end">
                      <button onClick={() => setEditingMonthIdx(null)} className="px-8 py-3 bg-[#16325c] text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-800 transition-all shadow-lg shadow-blue-900/10 flex items-center gap-2">
                          <Check size={16} /> Fertig
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CERTIFICATE MODAL */}
      {showCertModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                          <FileText size={18} className="text-blue-600"/>
                          Lohnausweis Erfassen {year}
                      </h3>
                      <button onClick={() => setShowCertModal(false)}><X size={20} className="text-gray-400 hover:text-gray-600"/></button>
                  </div>
                  
                  {/* TABS */}
                  <div className="flex border-b border-gray-100">
                      <button 
                          onClick={() => setActiveCertTab('p1')}
                          className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeCertTab === 'p1' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                      >
                          Einzelperson / P1
                      </button>
                      <button 
                          onClick={() => setActiveCertTab('p2')}
                          className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeCertTab === 'p2' ? 'text-pink-600 border-b-2 border-pink-600 bg-pink-50/50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                      >
                          Ehefrau / P2
                      </button>
                  </div>

                  <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase flex justify-between">
                              <span>Einkünfte Haupterwerb (Brutto)</span>
                              <span className="text-blue-500">Ziff. 1.1</span>
                          </label>
                          <input 
                              type="number" 
                              value={certData[activeCertTab].grossMain || ''} 
                              onChange={(e) => updateCertData(activeCertTab, 'grossMain', parseFloat(e.target.value) || 0)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              placeholder="0.00"
                          />
                          <p className="text-[9px] text-gray-400 italic">Nettolohn gemäss Lohnausweis (ohne Spesen)</p>
                      </div>

                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase flex justify-between">
                              <span>Einkünfte Nebenerwerb</span>
                              <span className="text-blue-500">Ziff. 1.2</span>
                          </label>
                          <input 
                              type="number" 
                              value={certData[activeCertTab].grossSide || ''} 
                              onChange={(e) => updateCertData(activeCertTab, 'grossSide', parseFloat(e.target.value) || 0)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              placeholder="0.00"
                          />
                      </div>

                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase flex justify-between">
                              <span>Vereinfachte Abrechnung</span>
                              <span className="text-blue-500">Ziff. 1.3</span>
                          </label>
                          <input 
                              type="number" 
                              value={certData[activeCertTab].grossSimple || ''} 
                              onChange={(e) => updateCertData(activeCertTab, 'grossSimple', parseFloat(e.target.value) || 0)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-100"
                              placeholder="0.00"
                          />
                          {/* DETAILED INFO BOX FOR ZIFF 1.3 */}
                          <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                               <h5 className="text-[10px] font-black text-blue-600 uppercase mb-1 flex items-center gap-1">
                                   <Info size={12} /> Quellensteuer / Vereinfacht
                               </h5>
                               <p className="text-[10px] text-blue-800 leading-relaxed">
                                   Nur ausfüllen, wenn der Arbeitgeber die Steuer bereits abgezogen hat (Quellensteuer) <strong>und</strong> keine weiteren Berufsauslagen (Ziff. 10) geltend gemacht werden.<br/>
                                   <br/>
                                   Tragen Sie den <strong>"besteuerten Bruttolohn"</strong> (bzw. "verrechneter Lohn") aus dem Lohnausweis ein.
                                   <span className="block mt-1 font-bold text-blue-900">Wichtig: Falls hier ausgefüllt, Ziffer 1.1 oft leer lassen (nicht doppelt zählen!).</span>
                               </p>
                          </div>
                      </div>

                      <div className="pt-4 border-t border-gray-100 space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase flex justify-between">
                              <span>Pauschalspesen (Berufsauslagen)</span>
                              <span className="text-blue-500">Ziff. {activeCertTab === 'p1' ? '10.1' : '10.2'}</span>
                          </label>
                          <input 
                              type="number" 
                              value={certData[activeCertTab].expenses || ''} 
                              onChange={(e) => updateCertData(activeCertTab, 'expenses', parseFloat(e.target.value) || 0)}
                              className="w-full bg-blue-50 border border-blue-100 text-blue-800 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-200"
                              placeholder="0.00"
                          />
                      </div>
                  </div>

                  <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end">
                      <button 
                          onClick={() => setShowCertModal(false)}
                          className="px-8 py-3 bg-[#16325c] text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-800 transition-all shadow-lg shadow-blue-900/10 flex items-center gap-2"
                      >
                          <Check size={16} /> Speichern
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default SalaryView;
