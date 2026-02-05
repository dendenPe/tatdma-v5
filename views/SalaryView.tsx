
import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, FileUp, Download, Eye, Paperclip, Calculator, ListFilter, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { AppData, SalaryEntry } from '../types';
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
  
  // Sync with global year
  useEffect(() => {
    setYear(globalYear);
  }, [globalYear]);

  const yearData: Record<string, SalaryEntry> = data.salary[year] || {};
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
                <th className="px-4 py-4 font-bold text-gray-500 uppercase tracking-wider text-[10px] w-16 lg:w-24 text-center">PDF</th>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Brutto</p>
             <p className="text-lg lg:text-xl font-black text-gray-700">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.brutto || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Quellensteuer</p>
             <p className="text-lg lg:text-xl font-black text-red-600">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.quellensteuer || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
        <div className="bg-white p-4 lg:p-6 rounded-xl border border-gray-100 shadow-sm flex items-center gap-4">
           <div className="w-10 h-10 lg:w-12 lg:h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center shrink-0">
             <Calculator size={20} className="lg:w-6 lg:h-6" />
           </div>
           <div>
             <p className="text-[9px] lg:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Netto Auszahlung</p>
             <p className="text-lg lg:text-xl font-black text-green-600">{formatCHF((Object.values(yearData) as SalaryEntry[]).reduce((s, e) => s + (e.auszahlung || 0), 0))} <span className="text-xs">CHF</span></p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default SalaryView;
