
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  FolderOpen, 
  FileText, 
  Plus, 
  Trash2, 
  Tag, 
  Inbox, 
  PenTool,
  Loader2,
  Eye,
  Info,
  Database,
  ScanLine,
  Check,
  X,
  Settings,
  FileSpreadsheet,
  FileType,
  Image as ImageIcon,
  Bold,
  Italic,
  Underline,
  List,
  Undo,
  Redo,
  ImagePlus,
  ArrowLeft,
  UploadCloud,
  FileArchive,
  Receipt,
  Sparkles,
  Download,
  File as FileIcon,
  ZoomIn,
  Table as TableIcon,
  Palette,
  ArrowUp,
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  Layout,
  ChevronDown,
  ChevronRight,
  BrainCircuit,
  StickyNote,
  ShoppingBag,
  Share2,
  Printer,
  Maximize2,
  Minimize2
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { AppData, NoteDocument, DocCategory, TaxExpense, CATEGORY_STRUCTURE, ExpenseEntry } from '../types';
import { DocumentService } from '../services/documentService';
import { VaultService } from '../services/vaultService';
import { DBService } from '../services/dbService';
import { GeminiService } from '../services/geminiService';

// Ensure worker is set
// @ts-ignore
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
}

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
}

// Map the new constant to UI friendly definition
const CATEGORY_KEYS = Object.keys(CATEGORY_STRUCTURE);

// Mapping helper for migration
const OLD_TO_NEW_MAP: Record<string, string> = {
    'Steuern': 'Steuern & Abgaben',
    'Rechnungen': 'Finanzen & Bankwesen',
    'Versicherung': 'Versicherungen',
    'Bank': 'Finanzen & Bankwesen',
    'Wohnen': 'Wohnen & Immobilien',
    'Arbeit': 'Beruf & Beschäftigung',
    'Privat': 'Identität & Zivilstand',
    'Fahrzeug': 'Fahrzeuge & Mobilität',
    'Verträge': 'Recht & Verträge'
};

// --- HELPER: Strip HTML for Preview ---
const stripHtml = (html: string) => {
   const tmp = document.createElement("DIV");
   tmp.innerHTML = html;
   return tmp.textContent || tmp.innerText || "";
};

// --- SUB-COMPONENT: PDF PAGE RENDERER WITH OPTIONAL LENS ---
const PdfPage = ({ page, scale, searchQuery, isLensEnabled }: { page: any, scale: number, searchQuery: string, isLensEnabled: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null); // Ref to hold the active render task
    const [isHovering, setIsHovering] = useState(false);
    const [lensPos, setLensPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const renderPage = async () => {
            if (!canvasRef.current) return;
            
            // CANCEL PREVIOUS TASK IF EXISTS
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) {
                    // Ignore cancellation errors
                }
            }

            const viewport = page.getViewport({ scale });
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            
            // High DPI Fix
            const outputScale = window.devicePixelRatio || 1;

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            
            // CSS scaling for display
            canvas.style.width = Math.floor(viewport.width) + "px";
            canvas.style.height = Math.floor(viewport.height) + "px";

            if (context) {
                // Reset transform matrix
                context.setTransform(1, 0, 0, 1, 0, 0);

                const transform = outputScale !== 1
                  ? [outputScale, 0, 0, outputScale, 0, 0]
                  : null;

                const renderContext = {
                    canvasContext: context,
                    transform: transform,
                    viewport: viewport
                };
                
                // Start new render task and store reference
                const renderTask = page.render(renderContext);
                renderTaskRef.current = renderTask;

                try {
                    await renderTask.promise;
                    renderTaskRef.current = null; // Clear ref on success

                    // --- HIGHLIGHTING LOGIC ---
                    if (searchQuery && searchQuery.length > 2) {
                        const textContent = await page.getTextContent();
                        const query = searchQuery.toLowerCase();
                        
                        context.save();
                        context.scale(outputScale, outputScale);

                        textContent.items.forEach((item: any) => {
                            if (item.str.toLowerCase().includes(query)) {
                                const tx = pdfjsLib.Util.transform(
                                    viewport.transform,
                                    item.transform
                                );
                                
                                const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                                
                                context.fillStyle = 'rgba(255, 255, 0, 0.4)';
                                context.fillRect(
                                    tx[4], 
                                    tx[5] - fontHeight * 0.8,
                                    item.width * scale, 
                                    fontHeight
                                );
                            }
                        });
                        context.restore();
                    }
                } catch(e: any) {
                    // Ignore rendering cancelled exceptions explicitly
                    if (e?.name !== 'RenderingCancelledException') {
                        console.error("Render error", e);
                    }
                }
            }
        };
        renderPage();

        // Cleanup: Cancel task when component unmounts or deps change
        return () => {
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) { }
            }
        };
    }, [page, scale, searchQuery]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isLensEnabled || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setLensPos({ x, y });
    };

    return (
        <div 
            ref={containerRef}
            className="mb-4 relative overflow-hidden rounded-sm shadow-md border border-gray-200 bg-white mx-auto inline-block max-w-full"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onMouseMove={handleMouseMove}
            style={{ cursor: (isLensEnabled && isHovering) ? 'zoom-in' : 'default' }}
        >
            <canvas 
                ref={canvasRef} 
                className="block max-w-full h-auto transition-transform duration-100 ease-out will-change-transform origin-center"
                style={{
                    transformOrigin: `${lensPos.x}% ${lensPos.y}%`,
                    transform: (isLensEnabled && isHovering) ? 'scale(2)' : 'scale(1)'
                }}
            />
        </div>
    );
};


// --- SUB-COMPONENT: PDF VIEWER ---
const PdfViewer = ({ blob, searchQuery, isLensEnabled }: { blob: Blob, searchQuery: string, isLensEnabled: boolean }) => {
    const [pdf, setPdf] = useState<any>(null);
    const [pages, setPages] = useState<any[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1.0);

    useEffect(() => {
        const loadPdf = async () => {
            if (!blob) return;
            try {
                const buffer = await blob.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument(buffer);
                const loadedPdf = await loadingTask.promise;
                setPdf(loadedPdf);

                const loadedPages = [];
                // Limit to first 5 pages for performance in preview
                const numPagesToRender = Math.min(loadedPdf.numPages, 5);
                for (let i = 1; i <= numPagesToRender; i++) {
                    loadedPages.push(await loadedPdf.getPage(i));
                }
                setPages(loadedPages);
            } catch (e) {
                console.error("PDF Load Error", e);
            }
        };
        loadPdf();
    }, [blob]);

    // Resizer Observer to adjust PDF scale when column width changes
    useEffect(() => {
        if (!containerRef.current || pages.length === 0) return;

        const updateScale = () => {
            if (!containerRef.current || pages.length === 0) return;
            const containerWidth = containerRef.current.clientWidth - 32; // Reduced Padding
            const page = pages[0];
            const viewport = page.getViewport({ scale: 1.0 });
            
            let newScale = containerWidth / viewport.width;
            if (newScale > 2.0) newScale = 2.0;
            if (newScale < 0.1) newScale = 0.1;
            setScale(newScale);
        };

        const observer = new ResizeObserver(() => {
            updateScale();
        });

        observer.observe(containerRef.current);
        updateScale(); // Initial

        return () => observer.disconnect();
    }, [pages]);

    if (!pdf) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-blue-500" /></div>;

    return (
        <div ref={containerRef} className="w-full bg-gray-100 rounded-lg p-2 overflow-y-auto h-full text-center">
            {pages.map((page, idx) => (
                <PdfPage key={idx} page={page} scale={scale} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />
            ))}
            {pdf.numPages > 5 && (
                <div className="text-center text-xs text-gray-400 py-2">
                    ... {pdf.numPages - 5} weitere Seiten (Download zum Ansehen)
                </div>
            )}
        </div>
    );
};


const NotesView: React.FC<Props> = ({ data, onUpdate }) => {
  const [selectedCat, setSelectedCat] = useState<string | 'All'>('All');
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null); // Sidebar filter for subcat
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isAnalyzingTax, setIsAnalyzingTax] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false); // For general AI analysis
  
  // Layout Resizing State
  const [layout, setLayout] = useState({ sidebarW: 280, listW: 320 });
  const [isResizing, setIsResizing] = useState<null | 'sidebar' | 'list'>(null);
  const resizeRef = useRef<{ startX: number, startSidebarW: number, startListW: number } | null>(null);
  
  // File Preview State
  const [activeFileBlob, setActiveFileBlob] = useState<Blob | null>(null);
  const [isLensEnabled, setIsLensEnabled] = useState(false); // Zoom Lens Toggle
  const [isMaximized, setIsMaximized] = useState(false); // FULLSCREEN TOGGLE
  
  // UI States for Feedback
  const [scanMessage, setScanMessage] = useState<{text: string, type: 'success'|'info'|'warning'} | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  
  // UI State for creating new category (Now mostly for Main Category switching)
  const [isCreatingCat, setIsCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState(''); // Legacy prop used for manual input, now selects main cat

  // UI State for Managing Rules
  const [ruleModalCat, setRuleModalCat] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');

  // Sidebar Accordion State
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  // FLOATING TOOLTIP STATE
  const [tooltip, setTooltip] = useState<{x: number, y: number, title: string, content: string} | null>(null);

  // UI State for Tables
  const [tableModal, setTableModal] = useState<{open: boolean, rows: number, cols: number}>({ open: false, rows: 3, cols: 3 });
  const [activeTableCtx, setActiveTableCtx] = useState<{ table: HTMLTableElement, rowIndex: number, colIndex: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  
  // Editor Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const lastNoteIdRef = useRef<string | null>(null);
  const mobileImportInputRef = useRef<HTMLInputElement>(null);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // --- MIGRATION LOGIC (Old -> New Categories) ---
  useEffect(() => {
      let needsUpdate = false;
      const newNotes = { ...data.notes };
      
      Object.values(newNotes).forEach((note: any) => {
          if (OLD_TO_NEW_MAP[note.category]) {
              note.category = OLD_TO_NEW_MAP[note.category];
              needsUpdate = true;
          }
      });

      if (needsUpdate) {
          console.log("Migration applied: Updating categories...");
          onUpdate({ ...data, notes: newNotes });
      }
  }, []);

  // --- RESIZING HANDLERS ---
  const startResizing = (type: 'sidebar' | 'list') => (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(type);
      resizeRef.current = {
          startX: e.clientX,
          startSidebarW: layout.sidebarW,
          startListW: layout.listW
      };
      // Force cursor to stay col-resize even if mouse leaves the handle line during fast drag
      document.body.style.cursor = 'col-resize';
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
      if (!isResizing || !resizeRef.current) return;
      
      const delta = e.clientX - resizeRef.current.startX;

      if (isResizing === 'sidebar') {
          const newW = Math.max(200, Math.min(400, resizeRef.current.startSidebarW + delta));
          setLayout(prev => ({ ...prev, sidebarW: newW }));
      } else if (isResizing === 'list') {
          const newW = Math.max(250, Math.min(600, resizeRef.current.startListW + delta));
          setLayout(prev => ({ ...prev, listW: newW }));
      }
  }, [isResizing]);

  const handleGlobalMouseUp = useCallback(() => {
      setIsResizing(null);
      resizeRef.current = null;
      document.body.style.cursor = '';
  }, []);

  useEffect(() => {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);


  // Derived Data
  const notesList = (Object.values(data.notes || {}) as NoteDocument[]).sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  
  const filteredNotes = useMemo(() => {
    return notesList.filter(note => {
      const matchesMainCat = selectedCat === 'All' || note.category === selectedCat;
      const matchesSubCat = !selectedSubCat || note.subCategory === selectedSubCat;
      
      // Special logic for Inbox virtual view
      if (selectedCat === 'Inbox') {
          return note.category === 'Inbox';
      }

      const cleanContent = stripHtml(note.content).toLowerCase();
      const matchesSearch = !searchQuery || 
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        cleanContent.includes(searchQuery.toLowerCase());
      
      return matchesMainCat && matchesSubCat && matchesSearch;
    });
  }, [notesList, selectedCat, selectedSubCat, searchQuery]);

  const selectedNote = selectedNoteId ? data.notes?.[selectedNoteId] : null;

  // --- EFFECT: LOAD FILE BLOB ON SELECTION ---
  useEffect(() => {
      const loadBlob = async () => {
          setActiveFileBlob(null);
          // On selection change, reset maximize
          setIsMaximized(false);
          
          if (selectedNote) {
              const blob = await ensureFileBlob();
              // No need to set activeFileBlob again as ensureFileBlob does it
          }
      };
      loadBlob();
  }, [selectedNoteId]);

  // --- AUTOMATIC SCAN ON MOUNT ---
  useEffect(() => {
    if (VaultService.isConnected()) {
        const timer = setTimeout(() => {
            if (!isScanning) {
                handleScanInbox(false); 
            }
        }, 800);
        return () => clearTimeout(timer);
    }
  }, []); 

  // --- EDITOR SYNC (Fix for Backwards Typing) ---
  useEffect(() => {
      if (selectedNoteId && data.notes[selectedNoteId] && data.notes[selectedNoteId].type === 'note' && editorRef.current) {
          const noteContent = data.notes[selectedNoteId].content;
          if (lastNoteIdRef.current !== selectedNoteId) {
              editorRef.current.innerHTML = noteContent;
              lastNoteIdRef.current = selectedNoteId;
          } 
          else if (editorRef.current.innerHTML !== noteContent) {
               if (document.activeElement !== editorRef.current) {
                   editorRef.current.innerHTML = noteContent;
               }
          }
      }
  }, [selectedNoteId, data.notes]);

  // --- SEARCH CONTEXT HELPER ---
  const renderNotePreview = (content: string, query: string) => {
      const cleanContent = stripHtml(content).replace(/\s+/g, ' ').trim();
      
      if (!query.trim()) {
          return <span className="text-gray-400">{cleanContent.substring(0, 90)}{cleanContent.length > 90 ? '...' : ''}</span>;
      }

      const idx = cleanContent.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return <span className="text-gray-400">{cleanContent.substring(0, 90)}...</span>;

      const padding = 35; 
      const start = Math.max(0, idx - padding);
      const end = Math.min(cleanContent.length, idx + query.length + padding);
      
      const snippet = cleanContent.substring(start, end);
      const parts = snippet.split(new RegExp(`(${query})`, 'gi'));

      return (
          <span className="text-gray-500">
              {start > 0 && "..."}
              {parts.map((part, i) => 
                  part.toLowerCase() === query.toLowerCase() 
                  ? <span key={i} className="bg-yellow-200 text-gray-900 font-bold px-0.5 rounded box-decoration-clone">{part}</span>
                  : part
              )}
              {end < cleanContent.length && "..."}
          </span>
      );
  };

  // --- RICH TEXT ACTIONS ---
  const execCmd = (command: string, value: string | undefined = undefined) => {
      document.execCommand(command, false, value);
      editorRef.current?.focus();
      handleEditorInput(); // Trigger Save
  };

  const updateSelectedNote = (updates: Partial<NoteDocument>) => {
      if (!selectedNoteId) return;
      const updatedNote = { ...data.notes[selectedNoteId], ...updates };
      onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: updatedNote } });
  };

  const handleEditorInput = () => {
      // FIX: Race condition guard
      if (lastNoteIdRef.current !== selectedNoteId) return;

      if (editorRef.current && selectedNoteId) {
          const html = editorRef.current.innerHTML;
          updateSelectedNote({ content: html });
      }
      checkTableContext();
  };

  // --- TABLE LOGIC ---
  const checkTableContext = () => {
      const selection = window.getSelection();
      if (!selection || !selection.anchorNode) {
          setActiveTableCtx(null);
          return;
      }

      let node: Node | null = selection.anchorNode;
      // Traverse up to find TD and Table
      let td: HTMLTableCellElement | null = null;
      let table: HTMLTableElement | null = null;

      while (node && node !== editorRef.current) {
          if (node.nodeName === 'TD' || node.nodeName === 'TH') {
              td = node as HTMLTableCellElement;
          }
          if (node.nodeName === 'TABLE') {
              table = node as HTMLTableElement;
              break;
          }
          node = node.parentNode;
      }

      if (table && td) {
          // Calculate row/col index
          const rowIndex = (td.parentNode as HTMLTableRowElement).rowIndex;
          const colIndex = td.cellIndex;
          setActiveTableCtx({ table, rowIndex, colIndex });
      } else {
          setActiveTableCtx(null);
      }
  };

  const insertTable = () => {
      // 1. SAVE CURRENT SELECTION
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
              savedRangeRef.current = range.cloneRange();
          }
      }
      // Open modal
      setTableModal({ open: true, rows: 3, cols: 3 });
  };

  const confirmInsertTable = () => {
      // 2. RESTORE SELECTION
      if (savedRangeRef.current) {
          const selection = window.getSelection();
          if (selection) {
              selection.removeAllRanges();
              selection.addRange(savedRangeRef.current);
          }
      } else {
          // Fallback: Just focus editor if no range saved
          editorRef.current?.focus();
      }

      const { rows, cols } = tableModal;
      // Explicit styles to ensure visibility and fixed layout
      let html = '<table style="width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; margin: 10px 0; table-layout: fixed;"><tbody>';
      for (let r = 0; r < rows; r++) {
          html += '<tr>';
          for (let c = 0; c < cols; c++) {
              // Add &nbsp; to make cell clickable/visible
              html += '<td style="border: 1px solid #d1d5db; padding: 8px; min-width: 50px; vertical-align: top; word-break: break-word;">&nbsp;</td>';
          }
          html += '</tr>';
      }
      html += '</tbody></table><p><br/></p>';
      
      execCmd('insertHTML', html);
      setTableModal({ ...tableModal, open: false });
      savedRangeRef.current = null; // Clean up
  };

  const manipulateTable = (action: 'addRowAbove'|'addRowBelow'|'addColLeft'|'addColRight'|'delRow'|'delCol'|'delTable') => {
      if (!activeTableCtx) return;
      const { table, rowIndex, colIndex } = activeTableCtx;

      if (action === 'delTable') {
          table.remove();
          setActiveTableCtx(null);
          handleEditorInput();
          return;
      }

      if (action === 'delRow') {
          if (table.rows.length > 0) table.deleteRow(rowIndex);
          if (table.rows.length === 0) table.remove();
      }
      else if (action === 'delCol') {
          for (let i = 0; i < table.rows.length; i++) {
              if (table.rows[i].cells.length > colIndex) {
                  table.rows[i].deleteCell(colIndex);
              }
          }
          // If table empty (no cols), delete it
          if (table.rows.length > 0 && table.rows[0].cells.length === 0) table.remove();
      }
      else if (action === 'addRowAbove' || action === 'addRowBelow') {
          const insertIdx = action === 'addRowAbove' ? rowIndex : rowIndex + 1;
          const newRow = table.insertRow(insertIdx);
          const cellCount = table.rows[rowIndex === 0 ? 1 : 0].cells.length; // use existing row as ref
          for (let c = 0; c < cellCount; c++) {
              const newCell = newRow.insertCell(c);
              newCell.style.border = '1px solid #d1d5db';
              newCell.style.padding = '8px';
              newCell.style.verticalAlign = 'top';
              newCell.style.wordBreak = 'break-word';
              newCell.innerHTML = '&nbsp;';
          }
      }
      else if (action === 'addColLeft' || action === 'addColRight') {
          const insertIdx = action === 'addColLeft' ? colIndex : colIndex + 1;
          for (let i = 0; i < table.rows.length; i++) {
              const newCell = table.rows[i].insertCell(insertIdx);
              newCell.style.border = '1px solid #d1d5db';
              newCell.style.padding = '8px';
              newCell.style.verticalAlign = 'top';
              newCell.style.wordBreak = 'break-word';
              newCell.innerHTML = '&nbsp;';
          }
      }

      handleEditorInput();
  };

  const insertImage = (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
          if (e.target?.result) {
              execCmd('insertImage', e.target.result as string);
          }
      };
      reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
          insertImage(e.target.files[0]);
          e.target.value = ''; // Reset
      }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length > 0) {
          const file = e.clipboardData.files[0];
          if (file.type.startsWith('image/')) {
              e.preventDefault();
              insertImage(file);
          }
      }
  };

  // Actions
  const handleScanInbox = async (isManual: boolean = true) => {
    // Desktop Vault Check
    if (!VaultService.isConnected()) {
        if (isManual) alert("Verwende den 'Import' Button auf mobilen Geräten.");
        return; 
    }

    // CHECK FOR API KEY (via LocalStorage now)
    const apiKey = localStorage.getItem('tatdma_api_key');
    if (!apiKey) {
        alert("ACHTUNG: Kein API Key gefunden. Die AI-Funktion ist deaktiviert. Bitte in den Systemeinstellungen hinterlegen.");
    }

    const hasPermission = await VaultService.verifyPermission();
    if (!hasPermission && isManual) await VaultService.requestPermission();
    
    setIsScanning(true);
    if (!isManual) setScanMessage({ text: "Synchronisiere Inbox...", type: 'info' });

    setTimeout(async () => {
        try {
            const result = await DocumentService.scanInbox(data.notes || {}, data.categoryRules || {});
            setLastScanTime(new Date().toLocaleTimeString());

            if (result.movedCount > 0) {
                const newNotes = { ...(data.notes || {}) };
                result.newDocs.forEach(doc => { 
                    newNotes[doc.id] = doc; 
                });
                
                // Handle Tax Entries
                let taxMsg = "";
                let newExpenses = [...data.tax.expenses];
                if (result.newTaxExpenses.length > 0) {
                    result.newTaxExpenses.forEach(exp => {
                        if (exp.currency === 'USD') exp.rate = data.tax.rateUSD || 0.85;
                        if (exp.currency === 'EUR') exp.rate = data.tax.rateEUR || 0.94;
                    });
                    newExpenses = [...newExpenses, ...result.newTaxExpenses];
                    taxMsg = `, ${result.newTaxExpenses.length} Steuerbelege erfasst!`;
                }

                onUpdate({ ...data, notes: newNotes, tax: { ...data.tax, expenses: newExpenses } });
                
                const msg = `${result.movedCount} Dateien importiert${taxMsg}`;
                setScanMessage({ text: msg, type: 'success' });
                if (isManual) alert(msg);
                setSelectedCat('Inbox'); 
                setTimeout(() => setScanMessage(null), 5000);
            } else {
                if (isManual) {
                    alert("Keine neuen Dateien im _INBOX Ordner gefunden.");
                    setScanMessage(null);
                } else {
                    setScanMessage({ text: "Auto-Sync: Keine neuen Dateien", type: 'info' });
                    setTimeout(() => setScanMessage(null), 2000); 
                }
            }
        } catch (e: any) {
            if (isManual) alert("Fehler beim Scannen: " + e.message);
        } finally {
            setIsScanning(false);
        }
    }, 50);
  };

  const handleMobileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      
      setIsScanning(true);
      setScanMessage({ text: "Importiere Dateien...", type: 'info' });

      setTimeout(async () => {
          try {
              const newDocs = await DocumentService.processManualUpload(e.target.files!, data.categoryRules || {});
              
              if (newDocs.length > 0) {
                  const newNotes = { ...(data.notes || {}) };
                  for (const doc of newDocs) {
                      newNotes[doc.id] = doc;
                  }

                  onUpdate({ ...data, notes: newNotes });
                  const msg = `${newDocs.length} Dateien erfolgreich importiert!`;
                  setScanMessage({ text: msg, type: 'success' });
                  setSelectedCat('Inbox');
              }
          } catch (err: any) {
              console.error(err);
              alert("Fehler beim Import: " + err.message);
          } finally {
              setIsScanning(false);
              setTimeout(() => setScanMessage(null), 3000);
          }
      }, 50);
      e.target.value = '';
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setIsScanning(true);
      setScanMessage({ text: "Entpacke Archiv...", type: 'info' });

      setTimeout(async () => {
          try {
              const newDocs = await DocumentService.processArchiveZip(file, data.categoryRules || {});
              
              if (newDocs.length > 0) {
                  const newNotes = { ...(data.notes || {}) };
                  for (const doc of newDocs) {
                      newNotes[doc.id] = doc;
                  }
                  onUpdate({ ...data, notes: newNotes });
                  const msg = `${newDocs.length} Dateien aus ZIP wiederhergestellt!`;
                  setScanMessage({ text: msg, type: 'success' });
                  setSelectedCat('All');
              } else {
                  alert("Keine gültigen Dateien im ZIP gefunden.");
                  setScanMessage(null);
              }
          } catch (err: any) {
              console.error(err);
              alert("Fehler beim ZIP Import: " + err.message);
              setScanMessage(null);
          } finally {
              setIsScanning(false);
              setTimeout(() => setScanMessage(null), 4000);
          }
      }, 50);
      e.target.value = '';
  };

  const handleReindex = async () => {
     if (!confirm("Vollständiger Re-Index?\n\nDas liest alle Dateien im _ARCHIVE Ordner neu ein.")) return;
     if (!VaultService.isConnected()) return;
     
     setIsReindexing(true);
     try {
         const recoveredDocs = await DocumentService.rebuildIndexFromVault();
         const currentMap: Record<string, NoteDocument> = { ...(data.notes || {}) };
         let addedCount = 0;
         let updatedCount = 0;

         recoveredDocs.forEach(doc => {
             const existingEntry = Object.entries(currentMap).find(([_, val]) => val.filePath === doc.filePath);
             if (existingEntry) {
                 const [oldId, oldDoc] = existingEntry;
                 if (doc.content && doc.content.length > (oldDoc.content?.length || 0)) {
                    currentMap[oldId] = { ...oldDoc, content: doc.content, category: doc.category, subCategory: doc.subCategory, year: doc.year };
                    updatedCount++;
                 }
             } else {
                 currentMap[doc.id] = doc;
                 addedCount++;
             }
         });
         onUpdate({ ...data, notes: currentMap });
         alert(`Index aktualisiert!\n\n${addedCount} neu, ${updatedCount} aktualisiert.`);
     } catch (e: any) {
         alert("Fehler: " + e.message);
     } finally {
         setIsReindexing(false);
     }
  };

  const handleReanalyzeContent = async () => {
      if (!selectedNoteId || !selectedNote) return;
      
      setIsReanalyzing(true);
      try {
          const apiKey = localStorage.getItem('tatdma_api_key');
          if (!apiKey) throw new Error("Kein API Key gefunden.");

          let fileBlob = await DBService.getFile(selectedNote.id);
          if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) {
              fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
          }

          if (!fileBlob) throw new Error("Originaldatei für Analyse nicht gefunden.");

          const file = new File([fileBlob], selectedNote.fileName || 'doc', { type: fileBlob.type });
          
          const aiResult = await GeminiService.analyzeDocument(file);
          
          if (aiResult) {
              const year = aiResult.date ? aiResult.date.split('-')[0] : selectedNote.year;
              
              let paymentTable = '';
              if (aiResult.paymentDetails && (aiResult.paymentDetails.recipientName || aiResult.paymentDetails.iban)) {
                  paymentTable = `
                  <div style="background-color:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px; margin-top:8px;">
                      <strong style="color:#0284c7; font-size:11px; text-transform:uppercase; display:block; margin-bottom:6px;">💰 Zahlungsdetails</strong>
                      <table style="width:100%; font-size:12px; border-collapse:collapse;">
                          ${aiResult.paymentDetails.recipientName ? `<tr><td style="color:#64748b; padding:2px 0;">Empfänger:</td><td style="font-weight:bold; color:#0f172a;">${aiResult.paymentDetails.recipientName}</td></tr>` : ''}
                          ${aiResult.paymentDetails.payerName ? `<tr><td style="color:#64748b; padding:2px 0;">Zahlungspflichtig:</td><td style="font-weight:bold; color:#0f172a;">${aiResult.paymentDetails.payerName}</td></tr>` : ''}
                          ${aiResult.paymentDetails.iban ? `<tr><td style="color:#64748b; padding:2px 0;">IBAN / Konto:</td><td style="font-family:monospace; color:#0f172a;">${aiResult.paymentDetails.iban}</td></tr>` : ''}
                          ${aiResult.paymentDetails.reference ? `<tr><td style="color:#64748b; padding:2px 0;">Referenz:</td><td style="font-family:monospace; color:#0f172a;">${aiResult.paymentDetails.reference}</td></tr>` : ''}
                          ${aiResult.paymentDetails.dueDate ? `<tr><td style="color:#64748b; padding:2px 0;">Fällig am:</td><td style="font-weight:bold; color:#b91c1c;">${aiResult.paymentDetails.dueDate}</td></tr>` : ''}
                      </table>
                  </div>
                  `;
              }

              const aiBlock = `
              <div style="margin-top:20px; border-top:2px solid #e5e7eb; padding-top:15px;">
                  <h4 style="color:#4f46e5; font-weight:800; font-size:12px; text-transform:uppercase; display:flex; align-items:center; gap:5px;">
                      🤖 AI Analyse & Zusammenfassung
                  </h4>
                  <div style="background-color:#f9fafb; padding:12px; border-radius:8px; border:1px solid #f3f4f6; margin-top:8px;">
                      <p style="font-weight:bold; margin-bottom:4px; font-size:13px;">${aiResult.title}</p>
                      <p style="color:#4b5563; font-size:12px; line-height:1.5;">${aiResult.summary}</p>
                      ${paymentTable}
                      <div style="margin-top:8px; font-size:10px; color:#9ca3af; font-style:italic;">
                          Grund für Kategorie: ${aiResult.aiReasoning}
                      </div>
                  </div>
              </div>
              <p><br/></p>
              `;

              const newContent = selectedNote.content + aiBlock;

              updateSelectedNote({
                  category: aiResult.category,
                  subCategory: aiResult.subCategory,
                  title: aiResult.title || selectedNote.title,
                  year: year,
                  content: newContent
              });
              
              alert(`Analyse abgeschlossen!\n\nKategorie: ${aiResult.category}\nSub: ${aiResult.subCategory || '-'}`);
          } else {
              alert("AI konnte keine Daten extrahieren.");
          }

      } catch (e: any) {
          alert("Fehler bei Analyse: " + e.message);
      } finally {
          setIsReanalyzing(false);
      }
  };

  const toggleTaxImport = async () => {
     if (!selectedNoteId || !selectedNote) return;
     if (selectedNote.taxRelevant) {
         const newExpenses = data.tax.expenses.filter(e => e.noteRef !== selectedNote.id);
         updateSelectedNote({ taxRelevant: false });
         onUpdate({
             ...data,
             notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: false } },
             tax: { ...data.tax, expenses: newExpenses }
         });
         return;
     }

     setIsAnalyzingTax(true);
     try {
         const apiKey = localStorage.getItem('tatdma_api_key');
         if (!apiKey) throw new Error("Kein API Key für AI Scan gefunden.");

         let fileBlob = await DBService.getFile(selectedNote.id);
         if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) {
             fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
         }

         if (!fileBlob) throw new Error("Originaldatei für Analyse nicht gefunden.");

         let amount = 0;
         let currency = 'CHF';
         let category: any = 'Sonstiges';
         let reasoning = '';
         
         const file = new File([fileBlob], selectedNote.fileName || 'beleg.pdf', { type: fileBlob.type });
         const aiResult = await GeminiService.analyzeDocument(file);
         
         if (aiResult) {
             if (aiResult.aiReasoning) {
                 const newContent = selectedNote.content + 
                     `<br/><br/><div style="border-top:1px solid #eee; padding-top:10px; font-size:10px; color:#666;">
                        <strong>🤖 AI Analysis:</strong> ${aiResult.aiReasoning}<br/>
                        <em>Tax Rel: ${aiResult.isTaxRelevant ? 'Yes' : 'No'}</em>
                      </div>`;
                 updateSelectedNote({ content: newContent, category: aiResult.category, subCategory: aiResult.subCategory });
                 reasoning = aiResult.aiReasoning;
             }

             if (aiResult.taxData) {
                 amount = aiResult.taxData.amount;
                 currency = aiResult.taxData.currency;
                 category = aiResult.taxData.taxCategory;
             }
         }

         if (amount === 0) {
             const amountMatch = stripHtml(selectedNote.content).match(/(\d+[.,]\d{2})/);
             if (amountMatch) amount = parseFloat(amountMatch[1].replace(',', '.'));
             if (selectedNote.category.includes('Beruf') || selectedNote.category.includes('Arbeit')) category = 'Berufsauslagen';
             else if (selectedNote.category.includes('Versicherung')) category = 'Versicherung';
             else category = 'Sonstiges';
         }

         const newReceiptId = `receipt_from_note_${Date.now()}`;
         await DBService.saveFile(newReceiptId, fileBlob);

         const newExpense: TaxExpense = {
             id: `exp_${Date.now()}`,
             noteRef: selectedNote.id,
             desc: selectedNote.title,
             amount: amount,
             year: selectedNote.year,
             cat: category,
             currency: currency,
             rate: 1,
             receipts: [newReceiptId],
             taxRelevant: true
         };

         onUpdate({
             ...data,
             notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: true, content: selectedNote.content } }, 
             tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] }
         });
         alert(`Importiert: ${amount} ${currency}\nKat: ${category}\n\nAI Info: ${reasoning || 'n/a'}`);

     } catch (e: any) {
         alert("Fehler beim Import: " + e.message);
     } finally {
         setIsAnalyzingTax(false);
     }
  };

  const createNote = () => {
    const id = `note_${Date.now()}`;
    const year = new Date().getFullYear().toString();
    let initialCat = selectedCat;
    if (initialCat === 'All' || initialCat === 'Inbox') {
        initialCat = 'Sonstiges';
    }

    const newNote: NoteDocument = {
        id,
        title: 'Neue Notiz',
        type: 'note',
        category: initialCat,
        year: year,
        created: new Date().toISOString(),
        content: '<p></p>',
        fileName: 'note.txt',
        tags: [],
        isNew: true
    };

    onUpdate({ ...data, notes: { ...data.notes, [id]: newNote } });
    setSelectedNoteId(id);
    
    if (selectedCat !== 'All' && selectedCat !== initialCat) {
        setSelectedCat(initialCat);
    }
  };

  const changeCategory = async (newCat: DocCategory, newSubCat?: string) => {
      if (!selectedNoteId || !selectedNote) return;
      if (selectedNote.category === newCat && selectedNote.subCategory === newSubCat) return;

      setIsCreatingCat(false);
      setNewCatName('');

      if (selectedNote.filePath && VaultService.isConnected()) {
          const updatedDoc = await DocumentService.moveFile(selectedNote, newCat, newSubCat);
          onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: updatedDoc } });
      } else {
          updateSelectedNote({ category: newCat, subCategory: newSubCat });
      }
  };

  const deleteNote = () => {
      if (!selectedNoteId) return;
      if (confirm("Notiz / Dokument wirklich löschen?")) {
          const newNotes = { ...data.notes };
          delete newNotes[selectedNoteId];
          onUpdate({ ...data, notes: newNotes });
          setSelectedNoteId(null);
      }
  };

  // --- ROBUST FILE HANDLING (FIXED: Force correct MIME Types) ---
  const ensureFileBlob = async (): Promise<Blob | null> => {
      if (!selectedNote) return null;
      if (activeFileBlob) return activeFileBlob; 

      let blob: Blob | null = null;
      try {
          blob = await DBService.getFile(selectedNote.id);
      } catch (e) { /* ignore */ }

      if (!blob && selectedNote.filePath && VaultService.isConnected()) {
          blob = await DocumentService.getFileFromVault(selectedNote.filePath);
      }
      
      // CRITICAL FIX: FORCE CORRECT MIME TYPE
      if (blob) {
          let type = blob.type;
          
          if (selectedNote.type === 'pdf') type = 'application/pdf';
          else if (selectedNote.type === 'image') type = 'image/jpeg';
          
          // If type is missing or generic, enforce it based on metadata
          if (!type || type === 'application/octet-stream') {
             if (selectedNote.fileName?.toLowerCase().endsWith('.pdf')) type = 'application/pdf';
             else if (selectedNote.fileName?.toLowerCase().match(/\.(jpg|jpeg|png)$/)) type = 'image/jpeg';
          }

          if (blob.type !== type) {
              console.log(`Fixing Blob Type: ${blob.type} -> ${type}`);
              blob = new Blob([blob], { type });
          }
          setActiveFileBlob(blob);
      }
      return blob;
  };

  const openFile = async () => {
      const blob = await ensureFileBlob();
      if (blob) {
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
      } else {
          alert("Datei konnte nicht geladen werden (nicht in DB oder Vault gefunden).");
      }
  };

  // --- SHARE FUNCTIONALITY (ROBUST FALLBACK) ---
  const handleShare = async () => {
      if (!selectedNote) return;
      const blob = await ensureFileBlob();
      if (!blob) return alert("Datei nicht bereit zum Teilen.");

      let fileName = selectedNote.fileName || (selectedNote.type === 'pdf' ? 'dokument.pdf' : 'bild.jpg');
      if (blob.type === 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
      if (blob.type === 'image/jpeg' && !fileName.toLowerCase().endsWith('.jpg')) fileName += '.jpg';
      
      const file = new File([blob], fileName, { type: blob.type });
      
      // 1. Try Native Share (Mobile & Supported Desktop)
      // We rely on feature detection instead of user agent to be robust
      if (navigator.share) {
          try {
              await navigator.share({
                  files: [file],
                  title: selectedNote.title,
                  text: 'Dokument aus TaTDMA'
              });
              return; // Success, stop here.
          } catch (shareError: any) {
              // Ignore abort errors (user cancelled share sheet)
              if (shareError.name !== 'AbortError') {
                  console.warn("Share failed, falling back to open", shareError);
              } else {
                  return; // User cancelled, do nothing
              }
          }
      } 
      
      // 2. Desktop / Fallback Behavior: Open in New Tab
      // User explicitly requested to STOP automatic downloading.
      // Opening in a new tab allows printing, saving, and copying URL.
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      
      // If popup blocker blocked it
      if (!newWindow) {
          alert("Bitte Popups erlauben, um das Dokument zu öffnen.");
      }
      
      // Clean up URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // --- DOWNLOAD FUNCTIONALITY (Corrected) ---
  const handleDownload = async () => {
      const blob = await ensureFileBlob();
      if (!blob) return alert("Datei nicht verfügbar.");

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedNote?.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  // --- PRINT FUNCTIONALITY (Corrected) ---
  const handlePrint = async () => {
      const blob = await ensureFileBlob();
      if (!blob) return alert("Datei nicht verfügbar.");
      const url = URL.createObjectURL(blob);
      
      // Open in new tab - browser handles PDF printing best
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000); 
  };

  const addKeyword = () => {
      if (!ruleModalCat || !newKeyword.trim()) return;
      const currentRules = data.categoryRules || {};
      const catRules = currentRules[ruleModalCat] || [];
      if (catRules.includes(newKeyword.trim())) { setNewKeyword(''); return; }
      const updatedRules = { ...currentRules, [ruleModalCat]: [...catRules, newKeyword.trim()] };
      onUpdate({ ...data, categoryRules: updatedRules });
      setNewKeyword('');
  };

  const removeKeyword = (keyword: string) => {
      if (!ruleModalCat) return;
      const currentRules = data.categoryRules || {};
      const catRules = currentRules[ruleModalCat] || [];
      const updatedRules = { ...currentRules, [ruleModalCat]: catRules.filter(k => k !== keyword) };
      onUpdate({ ...data, categoryRules: updatedRules });
  };

  const getIconForType = (type: NoteDocument['type']) => {
      switch(type) {
          case 'pdf': return <FileText size={16} className="text-red-500" />;
          case 'image': return <ImageIcon size={16} className="text-purple-500" />;
          case 'word': return <FileType size={16} className="text-blue-600" />;
          case 'excel': return <FileSpreadsheet size={16} className="text-green-600" />;
          case 'note': return <FileIcon size={16} className="text-gray-500" />;
          default: return <FileIcon size={16} className="text-gray-400" />;
      }
  };

  const getCategoryColor = (cat: string) => {
      if (cat === 'Inbox') return 'bg-purple-50 text-purple-600 border border-purple-100';
      if (cat.includes('Steuern')) return 'bg-red-50 text-red-600 border border-red-100';
      if (cat.includes('Finanzen') || cat.includes('Bank')) return 'bg-blue-50 text-blue-600 border border-blue-100';
      if (cat.includes('Wohnen')) return 'bg-emerald-50 text-emerald-600 border border-emerald-100';
      if (cat.includes('Versicherung')) return 'bg-teal-50 text-teal-600 border border-teal-100';
      if (cat.includes('Beruf') || cat.includes('Arbeit')) return 'bg-indigo-50 text-indigo-600 border border-indigo-100';
      if (cat.includes('Identität') || cat.includes('Privat')) return 'bg-pink-50 text-pink-600 border border-pink-100';
      if (cat.includes('Fahrzeug')) return 'bg-orange-50 text-orange-600 border border-orange-100';
      return 'bg-gray-50 text-gray-500 border border-gray-100';
  };

  const toggleCatExpanded = (cat: string) => {
    setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleExpenseImport = () => {
      if (!selectedNoteId || !selectedNote) return;
      if (selectedNote.isExpense) {
          updateSelectedNote({ isExpense: false });
          return;
      }

      const expenseId = `expense_${Date.now()}`;
      const year = selectedNote.year || new Date().getFullYear().toString();
      const currentExpenses = data.dailyExpenses?.[year] || [];
      
      const newEntry: ExpenseEntry = {
          id: expenseId,
          date: selectedNote.created.split('T')[0],
          merchant: 'Aus Notiz',
          description: selectedNote.title,
          amount: 0,
          currency: 'CHF',
          rate: 1,
          category: 'Sonstiges',
          receiptId: selectedNote.id,
          isTaxRelevant: selectedNote.taxRelevant || false
      };

      const newData = { 
          ...data, 
          dailyExpenses: {
              ...data.dailyExpenses,
              [year]: [...currentExpenses, newEntry]
          },
          notes: {
              ...data.notes,
              [selectedNoteId]: { ...selectedNote, isExpense: true, expenseId: expenseId }
          }
      };
      
      onUpdate(newData);
      alert("Zu Ausgaben hinzugefügt. Bitte im 'Ausgaben'-Tab vervollständigen.");
  };

  return (
    <div 
        className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-hidden relative min-h-[calc(100dvh-150px)] w-full"
        style={{ cursor: isResizing ? 'col-resize' : 'default' }}
    >
      
      {/* 1. SIDEBAR (Desktop Only) / Mobile Toolbar */}
      <div 
        className={`bg-gray-50 border-r border-gray-100 flex flex-col shrink-0 ${selectedNoteId ? 'hidden md:flex' : 'flex'}`}
        style={{ width: window.innerWidth >= 768 ? layout.sidebarW : '100%' }}
      >
         
         {/* Mobile Toolbar Header */}
         <div className="md:hidden p-3 border-b border-gray-100 flex gap-2 items-center w-full overflow-x-hidden">
            {isScanning ? (
                <div className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold animate-pulse">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Importiere...</span>
                </div>
            ) : (
                <>
                    <select 
                    value={selectedCat} 
                    onChange={(e) => { setSelectedCat(e.target.value); setSelectedSubCat(null); }} 
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-2 text-sm font-bold shadow-sm min-w-0"
                    >
                    <option value="All">Alle Kategorien</option>
                    {CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    
                    <button onClick={() => zipImportInputRef.current?.click()} className="p-2 bg-purple-100 text-purple-600 rounded-lg shadow-sm shrink-0"><FileArchive size={20} /></button>
                    <input type="file" ref={zipImportInputRef} accept=".zip" className="hidden" onChange={handleZipImport} />

                    <button onClick={() => mobileImportInputRef.current?.click()} className="p-2 bg-[#16325c] text-white rounded-lg shadow-sm shrink-0"><UploadCloud size={20} /></button>
                    <input type="file" ref={mobileImportInputRef} multiple className="hidden" onChange={handleMobileImport} />

                    <button onClick={createNote} className="p-2 bg-blue-100 text-blue-600 rounded-lg shadow-sm shrink-0"><PenTool size={20} /></button>
                </>
            )}
         </div>

         {/* Desktop Create Button */}
         <div className="hidden md:block p-4 space-y-2">
            <button 
                onClick={createNote}
                className="w-full py-3 bg-[#16325c] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 hover:bg-blue-800 transition-all"
            >
                <PenTool size={16} /> Neue Notiz
            </button>
         </div>
         
         {/* Categories List (Desktop) */}
         <div className="hidden md:block flex-1 overflow-y-auto px-2 space-y-1">
            <button 
                onClick={() => { setSelectedCat('All'); setSelectedSubCat(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-bold transition-colors ${selectedCat === 'All' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
            >
                <div className="flex items-center gap-2"><Inbox size={16}/> Alle Notizen</div>
                <span className="bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">{notesList.length}</span>
            </button>
            <div className="pt-4 pb-2 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Kategorien</div>
            <div className="group flex items-center gap-1 w-full px-1">
                <button 
                    onClick={() => { setSelectedCat('Inbox'); setSelectedSubCat(null); }}
                    className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCat === 'Inbox' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    <div className="flex items-center gap-2"><Inbox size={16} className="text-purple-500"/>Inbox</div>
                    <span className="text-[10px] text-gray-300">{notesList.filter(n => n.category === 'Inbox').length}</span>
                </button>
            </div>
            {CATEGORY_KEYS.filter(c => c !== 'Inbox').map(catName => {
                const subCats = CATEGORY_STRUCTURE[catName];
                const isExpanded = expandedCats[catName];
                const docCount = notesList.filter(n => n.category === catName).length;
                return (
                <div key={catName} className="w-full px-1">
                    <div className="group relative flex items-center gap-1">
                         {subCats.length > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); toggleCatExpanded(catName); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg transition-colors absolute left-1 z-10">
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                         )}
                        <button onClick={() => { setSelectedCat(catName); setSelectedSubCat(null); if (!isExpanded) toggleCatExpanded(catName); }} className={`flex-1 flex items-center justify-between pl-8 pr-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCat === catName ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                            <div className="flex items-center gap-2 truncate"><FolderOpen size={16} className="text-amber-500 shrink-0"/><span className="truncate">{catName}</span></div>
                            <span className="text-[10px] text-gray-300 shrink-0">{docCount}</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setRuleModalCat(catName); }} className="p-2 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"><Tag size={12} /></button>
                    </div>
                    {isExpanded && subCats.length > 0 && (
                        <div className="pl-9 pr-2 space-y-0.5 mt-0.5 mb-1 animate-in slide-in-from-top-1 fade-in duration-200">
                            {subCats.map(sub => {
                                const subCount = notesList.filter(n => n.category === catName && n.subCategory === sub).length;
                                return (
                                    <button key={sub} onClick={() => { setSelectedCat(catName); setSelectedSubCat(sub); }} className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs transition-colors ${selectedCat === catName && selectedSubCat === sub ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}>
                                        <span className="truncate">{sub}</span>{subCount > 0 && <span className="text-[9px] opacity-60">{subCount}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                );
            })}
         </div>
         {/* Footer */}
         <div className="hidden md:block p-4 border-t border-gray-100 bg-gray-50 space-y-2 relative">
            <button onClick={() => zipImportInputRef.current?.click()} disabled={isScanning} className="w-full py-2.5 border border-purple-200 bg-purple-50 text-purple-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-purple-100 transition-all"><FileArchive size={14} /> ZIP Archiv Import</button>
            <input type="file" ref={zipImportInputRef} accept=".zip" className="hidden" onChange={handleZipImport} />
            <button onClick={() => handleScanInbox(true)} disabled={isScanning} className={`w-full py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-gray-50 transition-all ${isScanning ? 'opacity-50 cursor-wait' : ''}`}>{isScanning ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Inbox Scannen</button>
            <button onClick={handleReindex} disabled={isReindexing} className={`w-full py-2.5 border border-blue-200 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-100 transition-all ${isReindexing ? 'opacity-50 cursor-wait' : ''}`} title="Liest bestehende Ordnerstruktur neu ein (kein AI-Scan)">{isReindexing ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Archive Sync</button>
         </div>
      </div>

      {/* Resizer */}
      <div className="hidden md:flex w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize items-center justify-center transition-all z-10" onMouseDown={startResizing('sidebar')}/>

      {/* 2. NOTE LIST */}
      <div className={`border-r border-gray-100 flex flex-col min-h-0 bg-white shrink-0 ${selectedNoteId ? 'hidden md:flex' : 'flex'}`} style={{ width: window.innerWidth >= 768 ? layout.listW : '100%' }}>
         <div className="p-4 border-b border-gray-50 shrink-0 space-y-2">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                <input type="text" placeholder="Suchen..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-50 transition-all"/>
            </div>
            {(selectedCat !== 'All' || selectedSubCat) && (
                <div className="flex gap-2 flex-wrap">
                    {selectedCat !== 'All' && (<div className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-[10px] font-bold"><span>{selectedCat}</span><button onClick={() => { setSelectedCat('All'); setSelectedSubCat(null); }} className="hover:text-red-500"><X size={10}/></button></div>)}
                    {selectedSubCat && (<div className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded-md text-[10px] font-bold"><span>{selectedSubCat}</span><button onClick={() => setSelectedSubCat(null)} className="hover:text-red-500"><X size={10}/></button></div>)}
                </div>
            )}
         </div>
         <div className="flex-1 md:overflow-y-auto min-h-0 pb-20">
            {filteredNotes.map((note: any) => (
                <div key={note.id} onClick={() => setSelectedNoteId(note.id)} className={`p-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedNoteId === note.id ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}>
                    <div className="flex items-start justify-between mb-1">
                        <h4 className={`font-bold text-sm truncate flex-1 ${selectedNoteId === note.id ? 'text-blue-700' : 'text-gray-800'}`}>{note.title}</h4>
                        <div className="flex items-center gap-1">{note.taxRelevant && <span title="In Steuer importiert"><Receipt size={14} className="text-blue-500" /></span>}{getIconForType(note.type)}</div>
                    </div>
                    <div className="text-xs mb-2 h-10 leading-relaxed line-clamp-2">{renderNotePreview(note.content, searchQuery)}</div>
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex gap-2 flex-wrap"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCategoryColor(note.category)}`}>{note.category}</span>{note.subCategory && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 border border-gray-200">{note.subCategory}</span>}</div>
                        <span className="text-[10px] text-gray-300">{new Date(note.created).toLocaleDateString()}</span>
                    </div>
                </div>
            ))}
            {filteredNotes.length === 0 && <div className="p-8 text-center text-gray-400 text-xs italic">Keine Dokumente gefunden.</div>}
         </div>
      </div>

      <div className="hidden md:flex w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize items-center justify-center transition-all z-10" onMouseDown={startResizing('list')}/>

      {/* 3. DETAIL / EDITOR */}
      <div className={`flex-1 flex flex-col bg-gray-50/30 ${selectedNoteId ? 'fixed inset-0 z-[100] bg-white md:static h-[100dvh]' : 'hidden md:flex'}`}>
         {selectedNote ? (
             <>
                <div className="px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-gray-100 bg-white flex flex-wrap items-center justify-between shrink-0 gap-y-2">
                    <div className="flex items-center gap-3 flex-1 mr-2 overflow-hidden min-w-[200px]">
                        <button onClick={() => setSelectedNoteId(null)} className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full shrink-0"><ArrowLeft size={20} /></button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <input type="text" value={selectedNote.title} onChange={(e) => updateSelectedNote({ title: e.target.value })} className="text-lg font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300 truncate min-w-0" placeholder="Titel..."/>
                                {selectedNote.taxRelevant && <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest whitespace-nowrap hidden lg:inline-block shrink-0">In Steuer importiert</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1 h-6 overflow-x-auto no-scrollbar">
                                <select value={selectedNote.category} onChange={(e) => changeCategory(e.target.value as DocCategory, undefined)} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-bold border border-transparent hover:border-gray-300 transition-colors" title="Kategorie ändern">{CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                <span className="text-gray-300">/</span>
                                {CATEGORY_STRUCTURE[selectedNote.category]?.length > 0 ? (
                                    <select value={selectedNote.subCategory || ''} onChange={(e) => changeCategory(selectedNote.category, e.target.value || undefined)} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-medium hover:border-gray-300 transition-colors">
                                        <option value="">(Keine Unterkategorie)</option>{CATEGORY_STRUCTURE[selectedNote.category].map(sub => (<option key={sub} value={sub}>{sub}</option>))}
                                    </select>
                                ) : (<span className="text-[10px] text-gray-300 italic">n/a</span>)}
                                <div className="w-px h-3 bg-gray-200 mx-1"></div>
                                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-mono shrink-0">{selectedNote.year}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 md:gap-2 shrink-0">
                        {/* Always show actions for non-text notes, even if filePath is missing (DB files) */}
                        
                        {(selectedNote.type !== 'note' || activeFileBlob) && (
                            <button onClick={handleShare} className="p-1.5 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors" title="Teilen / Senden"><Share2 size={16} /></button>
                        )}
                        {(selectedNote.type !== 'note' || activeFileBlob) && (
                            <button onClick={handlePrint} className="p-1.5 text-gray-600 bg-white border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors hidden md:block" title="Drucken"><Printer size={16} /></button>
                        )}
                        {(selectedNote.type !== 'note' || activeFileBlob) && (
                            <button onClick={handleDownload} className="p-1.5 text-gray-600 bg-white border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors hidden md:block" title="Download"><Download size={16} /></button>
                        )}
                        
                        {/* MAXIMIZE BUTTON ALWAYS VISIBLE */}
                        <button onClick={() => setIsMaximized(!isMaximized)} className={`p-1.5 rounded-lg transition-colors ${isMaximized ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-blue-600'}`} title={isMaximized ? "Verkleinern" : "Vollbild"}>
                            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        
                        <div className="w-px h-6 bg-gray-100 mx-1"></div>
                        <button onClick={() => setIsLensEnabled(!isLensEnabled)} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${isLensEnabled ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`} title={isLensEnabled ? "Lupe deaktivieren" : "Lupe aktivieren"}><ZoomIn size={16} /></button>
                        <button onClick={toggleExpenseImport} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${selectedNote.isExpense ? 'bg-orange-50 border-orange-200 text-orange-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-orange-500 hover:border-orange-100'}`} title={selectedNote.isExpense ? "Ausgabe entfernen" : "Zu Ausgaben hinzufügen"}><ShoppingBag size={16} /></button>
                        <button onClick={handleReanalyzeContent} disabled={isReanalyzing} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 bg-white border-gray-100 text-gray-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50`} title="Inhalt neu analysieren & kategorisieren (ohne Steuer-Import)">{isReanalyzing ? <Loader2 size={16} className="animate-spin text-purple-500" /> : <BrainCircuit size={16} />}</button>
                        <button onClick={toggleTaxImport} disabled={isAnalyzingTax} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${selectedNote.taxRelevant ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`} title={selectedNote.taxRelevant ? "Bereits importiert (Klick zum Entfernen)" : "Via AI scannen & in Steuern importieren"}>{isAnalyzingTax ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <>{selectedNote.taxRelevant ? <Receipt size={16} /> : <Sparkles size={16} />}</>}</button>
                        <div className="w-px h-6 bg-gray-100 mx-1"></div>
                        <button onClick={deleteNote} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                </div>
                
                <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
                    {selectedNote.type === 'note' ? (
                        <div key={selectedNote.id} className="flex flex-col h-full bg-white">
                            {/* Toolbar */}
                            <div className="flex flex-col bg-gray-50 border-b border-gray-100 shrink-0">
                                <div className="flex items-center gap-1 p-2 overflow-x-auto flex-nowrap no-scrollbar">
                                    <button onClick={() => execCmd('undo')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Rückgängig"><Undo size={14}/></button>
                                    <button onClick={() => execCmd('redo')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600 mr-2" title="Wiederholen"><Redo size={14}/></button>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 font-bold" title="Fett"><Bold size={14}/></button>
                                    <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 italic" title="Kursiv"><Italic size={14}/></button>
                                    <button onClick={() => execCmd('underline')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 underline" title="Unterstrichen"><Underline size={14}/></button>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <button onClick={() => execCmd('insertUnorderedList')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Liste"><List size={14}/></button>
                                    <button onClick={insertTable} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Tabelle einfügen"><TableIcon size={14}/></button>
                                    <div className="relative group p-1.5 hover:bg-gray-200 rounded text-gray-600 cursor-pointer" title="Textfarbe">
                                        <Palette size={14} />
                                        <input ref={colorInputRef} type="color" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" onChange={(e) => execCmd('foreColor', e.target.value)} title="Textfarbe wählen" />
                                    </div>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <label className="p-1.5 hover:bg-gray-200 rounded text-gray-600 cursor-pointer flex items-center gap-1" title="Bild einfügen">
                                        <ImagePlus size={14}/>
                                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    </label>
                                </div>
                                {activeTableCtx && (
                                    <div className="flex items-center gap-1 p-1 bg-blue-50 border-t border-blue-100 overflow-x-auto flex-nowrap animate-in slide-in-from-top-1">
                                        <div className="px-2 text-[9px] font-black text-blue-400 uppercase tracking-wider flex items-center gap-1"><Layout size={10}/> Tabelle</div>
                                        <button onClick={() => manipulateTable('addRowAbove')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1" title="Zeile oben"><ArrowUp size={12}/> Zeile</button>
                                        <button onClick={() => manipulateTable('addRowBelow')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1" title="Zeile unten"><ArrowDown size={12}/> Zeile</button>
                                        <div className="w-px h-3 bg-blue-200 mx-1"></div>
                                        <button onClick={() => manipulateTable('addColLeft')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1" title="Spalte links"><ArrowLeftIcon size={12}/> Spalte</button>
                                        <button onClick={() => manipulateTable('addColRight')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1" title="Spalte rechts"><ArrowRightIcon size={12}/> Spalte</button>
                                        <div className="w-px h-3 bg-blue-200 mx-1"></div>
                                        <button onClick={() => manipulateTable('delRow')} className="p-1 hover:bg-red-100 rounded text-red-500 text-[10px] flex gap-1" title="Zeile löschen"><Trash2 size={12}/> Zeile</button>
                                        <button onClick={() => manipulateTable('delCol')} className="p-1 hover:bg-red-100 rounded text-red-500 text-[10px] flex gap-1" title="Spalte löschen"><Trash2 size={12}/> Spalte</button>
                                        <div className="flex-1"></div>
                                        <button onClick={() => manipulateTable('delTable')} className="p-1 hover:bg-red-100 rounded text-red-600 text-[10px] font-bold flex gap-1 bg-white border border-red-100 shadow-sm" title="Tabelle löschen"><X size={12}/> Löschen</button>
                                    </div>
                                )}
                            </div>
                            <div ref={editorRef} contentEditable onInput={handleEditorInput} onPaste={handlePaste} onSelect={checkTableContext} onClick={checkTableContext} onKeyUp={checkTableContext} className="flex-1 p-4 md:p-8 outline-none overflow-y-auto text-gray-800 leading-relaxed text-sm prose max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 [&_td]:align-top [&_td]:break-words [&_th]:border [&_th]:border-gray-300 [&_th]:p-2 [&_th]:bg-gray-50 [&_th]:text-left pb-24" style={{ minHeight: '100px', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }} />
                            <div className="p-2 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 flex justify-between safe-area-bottom"><span>{stripHtml(selectedNote.content).length} Zeichen</span></div>
                        </div>
                    ) : (
                        <div className="flex-1 p-4 overflow-y-auto pb-24" style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}>
                           <div className="mb-4">
                               <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-1"><StickyNote size={12} /> Eigene Notizen</label>
                               <textarea value={selectedNote.userNote || ''} onChange={(e) => updateSelectedNote({ userNote: e.target.value })} className="w-full p-2 bg-amber-50/50 border border-amber-100 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-amber-200 outline-none resize-y min-h-[60px] shadow-sm transition-all" placeholder="Notizen zum Dokument..." />
                           </div>
                           
                           {/* ROBUST WRAPPER FOR PDF/IMAGE PREVIEW WITH OVERLAY */}
                           <div className={isMaximized ? "fixed inset-0 z-[5000] bg-white p-2 md:p-4 flex flex-col overflow-auto" : "space-y-2"}>
                               <div className={`relative ${isMaximized ? 'w-full h-full min-h-screen bg-white' : ''}`}>
                                   
                                   {isMaximized && (
                                       <div className="absolute top-2 right-2 z-50 flex gap-2">
                                           <button onClick={() => setIsMaximized(false)} className="bg-white p-3 rounded-full shadow-lg border hover:bg-gray-100 text-gray-800" title="Schliessen">
                                               <Minimize2 size={24} />
                                           </button>
                                       </div>
                                   )}

                                   {selectedNote.type === 'pdf' && activeFileBlob ? (
                                        <div className={isMaximized ? "w-full h-full overflow-auto" : "space-y-2"}>
                                            {!isMaximized && (
                                                <div className="flex items-center gap-2 text-xs text-gray-500 font-medium px-1"><FileText size={14} className="text-gray-400" /><span className="font-mono truncate">{selectedNote.fileName}</span></div>
                                            )}
                                            <div className={`${isMaximized ? 'min-h-screen' : 'overflow-x-auto border border-gray-200 rounded-lg'}`}>
                                                <PdfViewer blob={activeFileBlob} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />
                                            </div>
                                        </div>
                                   ) : selectedNote.type === 'image' ? (
                                        <div className={isMaximized ? "w-full h-full overflow-auto flex items-center justify-center bg-gray-50" : "space-y-2"}>
                                            {!isMaximized && (
                                                <div className="flex items-center gap-2 text-xs text-gray-500 font-medium px-1"><ImageIcon size={14} className="text-gray-400" /><span className="font-mono truncate">{selectedNote.fileName}</span></div>
                                            )}
                                            {activeFileBlob && (
                                                <div className={`${isMaximized ? 'w-full h-auto' : 'rounded-lg border border-gray-200 overflow-hidden shadow-sm'}`}>
                                                    <img 
                                                        src={URL.createObjectURL(activeFileBlob)} 
                                                        alt="Preview" 
                                                        className={isMaximized ? "w-full h-auto object-contain" : "w-full h-auto"} 
                                                    />
                                                </div>
                                            )}
                                            {!isMaximized && (
                                                <div className="space-y-1 mt-4">
                                                    <h5 className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Extrahierter Text</h5>
                                                    <div className="w-full p-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 leading-relaxed overflow-x-auto" dangerouslySetInnerHTML={{ __html: selectedNote.content }} />
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                                            <div className={`w-24 h-24 rounded-3xl flex items-center justify-center ${selectedNote.type === 'word' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                                                {selectedNote.type === 'word' ? <FileType size={48} /> : <FileSpreadsheet size={48} />}
                                            </div>
                                            <div className="space-y-2">
                                                <h3 className="text-xl font-black text-gray-800">{selectedNote.type === 'word' ? 'Word Dokument' : 'Excel Tabelle'}</h3>
                                                <p className="text-sm text-gray-400 max-w-md mx-auto">Inhalt extrahiert:<br/><span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded mt-2 inline-block max-w-xs truncate">{selectedNote.content.substring(0,50)}...</span></p>
                                            </div>
                                            {selectedNote.filePath && (<button onClick={openFile} className="px-8 py-3 bg-[#16325c] text-white rounded-xl font-bold shadow-xl flex items-center gap-2"><Download size={18} /> Datei Öffnen</button>)}
                                        </div>
                                    )}
                               </div>
                           </div>
                        </div>
                    )}
                </div>
             </>
         ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-300 hidden md:flex"><FileText size={64} className="mb-4 opacity-20" /><p className="text-sm font-bold uppercase tracking-widest">Wähle eine Notiz</p></div>
         )}
      </div>

      {tableModal.open && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 space-y-4 animate-in zoom-in-95">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><TableIcon size={18} className="text-blue-500"/> Tabelle erstellen</h3>
                      <button onClick={() => setTableModal({...tableModal, open: false})} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-gray-400">Zeilen</label>
                          <input type="number" min="1" max="50" value={tableModal.rows} onChange={(e) => setTableModal({...tableModal, rows: parseInt(e.target.value) || 1})} className="w-full border border-gray-200 rounded-lg px-3 py-2 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"/>
                      </div>
                      <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-gray-400">Spalten</label>
                          <input type="number" min="1" max="20" value={tableModal.cols} onChange={(e) => setTableModal({...tableModal, cols: parseInt(e.target.value) || 1})} className="w-full border border-gray-200 rounded-lg px-3 py-2 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"/>
                      </div>
                  </div>
                  <button onClick={confirmInsertTable} className="w-full bg-[#16325c] text-white py-3 rounded-xl font-bold text-sm hover:bg-blue-800 transition-colors">Einfügen</button>
              </div>
          </div>
      )}

      {ruleModalCat && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full space-y-4 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                      <div className="flex items-center gap-2"><Tag size={18} className="text-blue-500" /><div><h3 className="font-bold text-gray-800">Stichwörter</h3><p className="text-xs text-gray-400">Für Kategorie: <span className="font-bold text-blue-600">{ruleModalCat}</span></p></div></div>
                      <button onClick={() => setRuleModalCat(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                  </div>
                  <div className="space-y-2">
                      <div className="flex gap-2"><input type="text" autoFocus placeholder="Neues Stichwort..." value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKeyword()} className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"/><button onClick={addKeyword} className="bg-blue-600 text-white px-3 rounded-lg hover:bg-blue-700"><Plus size={18}/></button></div>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1 py-2">
                      {(data.categoryRules?.[ruleModalCat] || []).map(keyword => (<div key={keyword} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg group"><span className="text-sm font-medium text-gray-700">{keyword}</span><button onClick={() => removeKeyword(keyword)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button></div>))}
                      {(!data.categoryRules?.[ruleModalCat] || data.categoryRules[ruleModalCat].length === 0) && (<div className="text-center py-4 text-xs text-gray-300 italic">Keine eigenen Stichwörter definiert.</div>)}
                  </div>
              </div>
          </div>
      )}

      {tooltip && (
          <div className="fixed z-[9999] w-48 bg-black/90 backdrop-blur-md text-white text-[9px] leading-tight p-2.5 rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150 pointer-events-none border border-white/10" style={{ top: tooltip.y, left: tooltip.x, transform: 'translateY(-50%)' }}>
              <div className="font-bold mb-1 border-b border-white/10 pb-1 text-blue-300 uppercase tracking-wider">{tooltip.title}</div>
              <div className="text-gray-300 font-medium">{tooltip.content}</div>
              <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-r-[6px] border-r-black/90 border-b-[5px] border-b-transparent"></div>
          </div>
      )}
    </div>
  );
};

export default NotesView;
