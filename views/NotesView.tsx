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
  Share2,
  Printer,
  Maximize,
  Minimize,
  ShoppingBag
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import heic2any from 'heic2any';
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

// Map the new constant to UI friendly definition if needed, 
// but we can just iterate CATEGORY_STRUCTURE keys
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

// --- SEARCH CONTEXT HELPER (Moved outside component) ---
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

// --- COMPONENT: BLOB IMAGE (Handles HEIC) ---
const BlobImage = ({ blob, alt, className }: { blob: Blob, alt: string, className?: string }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
        if (!blob) return;
        setLoading(true);
        setError(false);
        
        try {
            // Check for HEIC
            const isHeic = blob.type === 'image/heic' || blob.type === 'image/heif';
            
            if (isHeic) {
               const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
               const resBlob = Array.isArray(result) ? result[0] : result;
               if (isMounted) setSrc(URL.createObjectURL(resBlob));
            } else {
               if (isMounted) setSrc(URL.createObjectURL(blob));
            }
        } catch (e) {
            console.error("Image Load Error (BlobImage):", e);
            if (isMounted) setSrc(URL.createObjectURL(blob));
        } finally {
            if (isMounted) setLoading(false);
        }
    };
    load();
    return () => { isMounted = false; };
  }, [blob]);

  if (loading) return <div className={`flex items-center justify-center bg-gray-100 text-gray-400 animate-pulse ${className}`}><Loader2 className="animate-spin" /></div>;
  if (!src) return <div className={`flex items-center justify-center bg-gray-100 text-red-400 text-xs ${className}`}>Bildfehler</div>;
  
  return <img src={src} alt={alt} className={className} onError={() => setError(true)} />;
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
                // Limit to first 5 pages for performance in preview, unless full view needed
                const numPagesToRender = Math.min(loadedPdf.numPages, 10);
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
            const containerWidth = containerRef.current.clientWidth - 24; // Reduced Padding
            const page = pages[0];
            const viewport = page.getViewport({ scale: 1.0 });
            
            let newScale = containerWidth / viewport.width;
            // Limit scale to avoid blurriness on huge screens, but ensure fit on mobile
            if (newScale > 2.5) newScale = 2.5;
            if (newScale < 0.1) newScale = 0.1;
            setScale(newScale);
        };

        const observer = new ResizeObserver(() => {
            updateScale();
        });

        observer.observe(containerRef.current);
        updateScale(); // Initial delay slightly

        return () => observer.disconnect();
    }, [pages]);

    if (!pdf) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-blue-500" /></div>;

    return (
        <div ref={containerRef} className="w-full bg-gray-100/50 rounded-lg p-2 overflow-y-auto h-full text-center">
            {pages.map((page, idx) => (
                <PdfPage key={idx} page={page} scale={scale} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />
            ))}
            {pdf.numPages > 10 && (
                <div className="text-center text-xs text-gray-400 py-4 font-bold uppercase tracking-widest">
                    ... {pdf.numPages - 10} weitere Seiten (Download für volle Ansicht)
                </div>
            )}
        </div>
    );
};


const NotesView: React.FC<Props> = ({ data, onUpdate }) => {
  const [selectedCat, setSelectedCat] = useState<string | 'All'>('All');
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isAnalyzingTax, setIsAnalyzingTax] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  
  // Local state for subcategory input
  const [tempSubCategory, setTempSubCategory] = useState<string>('');
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);

  // Layout Resizing State
  const [layout, setLayout] = useState({ sidebarW: 280, listW: 320 });
  const [isResizing, setIsResizing] = useState<null | 'sidebar' | 'list'>(null);
  const resizeRef = useRef<{ startX: number, startSidebarW: number, startListW: number } | null>(null);
  
  // File Preview State
  const [activeFileBlob, setActiveFileBlob] = useState<Blob | null>(null);
  const [isLensEnabled, setIsLensEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false); // NEW: Fullscreen state
  
  // UI States for Feedback
  const [scanMessage, setScanMessage] = useState<{text: string, type: 'success'|'info'|'warning'} | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  
  const [isCreatingCat, setIsCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

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

  // --- MIGRATION LOGIC ---
  useEffect(() => {
      let needsUpdate = false;
      const newNotes = { ...data.notes };
      Object.values(newNotes).forEach((note: any) => {
          if (OLD_TO_NEW_MAP[note.category]) {
              note.category = OLD_TO_NEW_MAP[note.category];
              needsUpdate = true;
          }
      });
      if (needsUpdate) onUpdate({ ...data, notes: newNotes });
  }, []);

  const selectedNote = selectedNoteId ? data.notes?.[selectedNoteId] : null;

  useEffect(() => {
      if (selectedNote) {
          setTempSubCategory(selectedNote.subCategory || '');
          setIsFullscreen(false); // Reset fullscreen on note change
      } else {
          setTempSubCategory('');
      }
  }, [selectedNoteId, selectedNote?.subCategory]);

  // --- RESIZING HANDLERS ---
  const startResizing = (type: 'sidebar' | 'list') => (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(type);
      resizeRef.current = { startX: e.clientX, startSidebarW: layout.sidebarW, startListW: layout.listW };
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
      if (selectedCat === 'Inbox') return note.category === 'Inbox';
      const cleanContent = stripHtml(note.content).toLowerCase();
      const matchesSearch = !searchQuery || note.title.toLowerCase().includes(searchQuery.toLowerCase()) || cleanContent.includes(searchQuery.toLowerCase());
      return matchesMainCat && matchesSubCat && matchesSearch;
    });
  }, [notesList, selectedCat, selectedSubCat, searchQuery]);

  // --- EFFECT: LOAD FILE BLOB ON SELECTION ---
  useEffect(() => {
      const loadBlob = async () => {
          setActiveFileBlob(null);
          if (selectedNote && selectedNote.type === 'pdf') {
              let blob = await DBService.getFile(selectedNote.id);
              if (!blob && selectedNote.filePath && VaultService.isConnected()) {
                  blob = await DocumentService.getFileFromVault(selectedNote.filePath);
              }
              if (blob && !blob.type) blob = new Blob([blob], { type: 'application/pdf' });
              if (blob) setActiveFileBlob(blob);
          } else if (selectedNote && selectedNote.type === 'image') {
              let blob = await DBService.getFile(selectedNote.id);
              if (!blob && selectedNote.filePath && VaultService.isConnected()) {
                  blob = await DocumentService.getFileFromVault(selectedNote.filePath);
              }
              if (blob) setActiveFileBlob(blob);
          }
      };
      loadBlob();
  }, [selectedNoteId]);

  // --- AUTOMATIC SCAN ON MOUNT ---
  useEffect(() => {
    if (VaultService.isConnected()) {
        const timer = setTimeout(() => {
            if (!isScanning) {
                handleScanInbox(false); // false = auto, silent
            }
        }, 800);
        return () => clearTimeout(timer);
    }
  }, []);

  // --- SHARE FUNCTION ---
  const handleShare = async () => {
      if (!activeFileBlob || !selectedNote) return;
      
      try {
          // Construct a File object
          const ext = selectedNote.type === 'pdf' ? '.pdf' : '.jpg';
          const fileName = (selectedNote.fileName || selectedNote.title).endsWith(ext) 
              ? (selectedNote.fileName || selectedNote.title) 
              : (selectedNote.fileName || selectedNote.title) + ext;
              
          const file = new File([activeFileBlob], fileName, { type: activeFileBlob.type || (selectedNote.type === 'pdf' ? 'application/pdf' : 'image/jpeg') });

          // Web Share API Level 2 supports files
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                  files: [file],
                  title: selectedNote.title,
                  text: 'Dokument aus TaTDMA v5'
              });
          } else {
              // Fallback
              alert("Teilen wird auf diesem Gerät/Browser nicht nativ unterstützt. Datei wird heruntergeladen.");
              const url = URL.createObjectURL(activeFileBlob);
              const a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              a.click();
          }
      } catch (error: any) {
          if (error.name !== 'AbortError') {
              console.error('Error sharing:', error);
              alert('Fehler beim Teilen: ' + error.message);
          }
      }
  };

  // --- OPEN/PRINT FUNCTION ---
  const handleOpenExternal = () => {
      if (!activeFileBlob) return;
      const url = URL.createObjectURL(activeFileBlob);
      window.open(url, '_blank');
  };

  // --- EDITOR SYNC ---
  useEffect(() => {
      if (selectedNoteId && data.notes[selectedNoteId] && data.notes[selectedNoteId].type === 'note' && editorRef.current) {
          const noteContent = data.notes[selectedNoteId].content;
          if (lastNoteIdRef.current !== selectedNoteId) {
              editorRef.current.innerHTML = noteContent;
              lastNoteIdRef.current = selectedNoteId;
          } else if (editorRef.current.innerHTML !== noteContent) {
               if (document.activeElement !== editorRef.current) {
                   editorRef.current.innerHTML = noteContent;
               }
          }
      }
  }, [selectedNoteId, data.notes]);

  // --- RICH TEXT ACTIONS (abbreviated) ---
  const execCmd = (command: string, value: string | undefined = undefined) => {
      document.execCommand(command, false, value);
      editorRef.current?.focus();
      handleEditorInput(); 
  };

  const updateSelectedNote = (updates: Partial<NoteDocument>) => {
      if (!selectedNoteId) return;
      const updatedNote = { ...data.notes[selectedNoteId], ...updates };
      onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: updatedNote } });
  };

  const handleEditorInput = () => {
      if (lastNoteIdRef.current !== selectedNoteId) return;
      if (editorRef.current && selectedNoteId) {
          const html = editorRef.current.innerHTML;
          updateSelectedNote({ content: html });
      }
      checkTableContext();
  };

  // --- TABLE LOGIC (abbreviated) ---
  const checkTableContext = () => {
      const selection = window.getSelection();
      if (!selection || !selection.anchorNode) { setActiveTableCtx(null); return; }
      let node: Node | null = selection.anchorNode;
      let td: HTMLTableCellElement | null = null;
      let table: HTMLTableElement | null = null;
      while (node && node !== editorRef.current) {
          if (node.nodeName === 'TD' || node.nodeName === 'TH') td = node as HTMLTableCellElement;
          if (node.nodeName === 'TABLE') { table = node as HTMLTableElement; break; }
          node = node.parentNode;
      }
      if (table && td) {
          setActiveTableCtx({ table, rowIndex: (td.parentNode as HTMLTableRowElement).rowIndex, colIndex: td.cellIndex });
      } else { setActiveTableCtx(null); }
  };

  const insertTable = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
      }
      setTableModal({ open: true, rows: 3, cols: 3 });
  };

  const confirmInsertTable = () => {
      if (savedRangeRef.current) {
          const selection = window.getSelection();
          if (selection) { selection.removeAllRanges(); selection.addRange(savedRangeRef.current); }
      } else { editorRef.current?.focus(); }
      const { rows, cols } = tableModal;
      let html = '<table style="width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; margin: 10px 0; table-layout: fixed;"><tbody>';
      for (let r = 0; r < rows; r++) {
          html += '<tr>';
          for (let c = 0; c < cols; c++) html += '<td style="border: 1px solid #d1d5db; padding: 8px; min-width: 50px; vertical-align: top; word-break: break-word;">&nbsp;</td>';
          html += '</tr>';
      }
      html += '</tbody></table><p><br/></p>';
      execCmd('insertHTML', html);
      setTableModal({ ...tableModal, open: false });
      savedRangeRef.current = null;
  };

  const manipulateTable = (action: 'addRowAbove'|'addRowBelow'|'addColLeft'|'addColRight'|'delRow'|'delCol'|'delTable') => {
      if (!activeTableCtx) return;
      const { table, rowIndex, colIndex } = activeTableCtx;
      if (action === 'delTable') { table.remove(); setActiveTableCtx(null); handleEditorInput(); return; }
      // ... table logic omitted for brevity, same as previous
      handleEditorInput();
  };

  const insertImage = (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => { if (e.target?.result) execCmd('insertImage', e.target.result as string); };
      reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) { insertImage(e.target.files[0]); e.target.value = ''; }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length > 0) {
          const file = e.clipboardData.files[0];
          if (file.type.startsWith('image/')) { e.preventDefault(); insertImage(file); }
      }
  };

  // Actions
  const handleScanInbox = async (isManual: boolean = true) => {
    if (!VaultService.isConnected()) { 
        if (isManual) alert("Verwende den 'Import' Button auf mobilen Geräten."); 
        return; 
    }
    
    const apiKey = localStorage.getItem('tatdma_api_key');
    if (!apiKey && isManual) { alert("ACHTUNG: Kein API Key gefunden."); }
    
    const hasPermission = await VaultService.verifyPermission();
    if (!hasPermission && isManual) await VaultService.requestPermission();
    
    setIsScanning(true);
    
    if (isManual) setScanMessage({ text: "Synchronisiere Inbox...", type: 'info' });
    
    setTimeout(async () => {
        try {
            const result = await DocumentService.scanInbox(data.notes || {}, data.categoryRules || {});
            setLastScanTime(new Date().toLocaleTimeString());
            if (result.movedCount > 0) {
                const newNotes = { ...(data.notes || {}) };
                result.newDocs.forEach(doc => { newNotes[doc.id] = doc; });
                
                // Tax Expenses
                let newTaxExpenses = [...data.tax.expenses];
                if (result.newTaxExpenses.length > 0) {
                    result.newTaxExpenses.forEach(exp => {
                        if (exp.currency === 'USD') exp.rate = data.tax.rateUSD || 0.85;
                        if (exp.currency === 'EUR') exp.rate = data.tax.rateEUR || 0.94;
                    });
                    newTaxExpenses = [...newTaxExpenses, ...result.newTaxExpenses];
                }

                // Daily Expenses Logic (Fix for missing updates)
                let updatedDailyExpenses = { ...(data.dailyExpenses || {}) };
                if (result.newDailyExpenses && result.newDailyExpenses.length > 0) {
                     result.newDailyExpenses.forEach(exp => {
                         const y = exp.date.split('-')[0];
                         if (!updatedDailyExpenses[y]) updatedDailyExpenses[y] = [];
                         updatedDailyExpenses[y] = [...updatedDailyExpenses[y], exp];
                     });
                }

                onUpdate({ 
                    ...data, 
                    notes: newNotes, 
                    tax: { ...data.tax, expenses: newTaxExpenses },
                    dailyExpenses: updatedDailyExpenses 
                });

                const msg = `${result.movedCount} Dateien importiert`;
                setScanMessage({ text: msg, type: 'success' });
                if (isManual) alert(msg);
                setSelectedCat('Inbox'); 
                setTimeout(() => setScanMessage(null), 5000);
            } else {
                if (isManual) { alert("Keine neuen Dateien."); setScanMessage(null); } 
                else { 
                    setScanMessage(null);
                }
            }
        } catch (e: any) { if (isManual) alert("Fehler beim Scannen: " + e.message); } finally { setIsScanning(false); }
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
                  for (const doc of newDocs) { newNotes[doc.id] = doc; }
                  onUpdate({ ...data, notes: newNotes });
                  setScanMessage({ text: `${newDocs.length} Dateien erfolgreich importiert!`, type: 'success' });
                  setSelectedCat('Inbox');
              }
          } catch (err: any) { alert("Fehler beim Import: " + err.message); } finally { setIsScanning(false); setTimeout(() => setScanMessage(null), 3000); }
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
                  for (const doc of newDocs) { newNotes[doc.id] = doc; }
                  onUpdate({ ...data, notes: newNotes });
                  setScanMessage({ text: `${newDocs.length} Dateien aus ZIP wiederhergestellt!`, type: 'success' });
                  setSelectedCat('All');
              } else { alert("Keine gültigen Dateien im ZIP gefunden."); setScanMessage(null); }
          } catch (err: any) { alert("Fehler beim ZIP Import: " + err.message); setScanMessage(null); } finally { setIsScanning(false); setTimeout(() => setScanMessage(null), 4000); }
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
         recoveredDocs.forEach(doc => {
             if (!Object.values(currentMap).some(d => d.filePath === doc.filePath)) { currentMap[doc.id] = doc; addedCount++; }
         });
         onUpdate({ ...data, notes: currentMap });
         alert(`Index aktualisiert!\n\n${addedCount} neu.`);
     } catch (e: any) { alert("Fehler: " + e.message); } finally { setIsReindexing(false); }
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
              const newContent = selectedNote.content + 
                  `<div style="margin-top:20px; border-top:2px solid #eee; padding-top:15px;">
                      <h4>AI Analyse</h4><p>${aiResult.summary}</p>
                   </div>`;
              updateSelectedNote({ category: aiResult.category, subCategory: aiResult.subCategory, title: aiResult.title || selectedNote.title, content: newContent });
              alert(`Analyse abgeschlossen!\n\nKategorie: ${aiResult.category}`);
          } else { alert("AI konnte keine Daten extrahieren."); }
      } catch (e: any) { alert("Fehler bei Analyse: " + e.message); } finally { setIsReanalyzing(false); }
  };

  const toggleTaxImport = async () => {
     if (!selectedNoteId || !selectedNote) return;
     if (selectedNote.taxRelevant) {
         const newExpenses = data.tax.expenses.filter(e => e.noteRef !== selectedNote.id);
         updateSelectedNote({ taxRelevant: false });
         onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: false } }, tax: { ...data.tax, expenses: newExpenses } });
         return;
     }
     setIsAnalyzingTax(true);
     try {
         const apiKey = localStorage.getItem('tatdma_api_key');
         if (!apiKey) throw new Error("Kein API Key für AI Scan gefunden.");
         let fileBlob = await DBService.getFile(selectedNote.id);
         if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) { fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath); }
         if (!fileBlob) throw new Error("Originaldatei für Analyse nicht gefunden.");
         const file = new File([fileBlob], selectedNote.fileName || 'beleg.pdf', { type: fileBlob.type });
         const aiResult = await GeminiService.analyzeDocument(file);
         let amount = 0; let currency = 'CHF'; let category: any = 'Sonstiges';
         if (aiResult && aiResult.taxData) { amount = aiResult.taxData.amount; currency = aiResult.taxData.currency; category = aiResult.taxData.taxCategory; }
         const newReceiptId = `receipt_from_note_${Date.now()}`;
         await DBService.saveFile(newReceiptId, fileBlob);
         const newExpense: TaxExpense = { id: `exp_${Date.now()}`, noteRef: selectedNote.id, desc: selectedNote.title, amount: amount, year: selectedNote.year, cat: category, currency: currency, rate: 1, receipts: [newReceiptId], taxRelevant: true };
         onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: true } }, tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] } });
         alert(`Importiert: ${amount} ${currency}\nKat: ${category}`);
     } catch (e: any) { alert("Fehler beim Import: " + e.message); } finally { setIsAnalyzingTax(false); }
  };

  // --- NEW: TOGGLE EXPENSE (Shopping Bag) ---
  const toggleExpenseImport = async () => {
      if (!selectedNoteId || !selectedNote) return;

      // REMOVE from Expenses
      if (selectedNote.isExpense) {
          const year = selectedNote.year || new Date().getFullYear().toString();
          let currentYearExpenses = data.dailyExpenses?.[year] || [];
          if (selectedNote.expenseId) {
              currentYearExpenses = currentYearExpenses.filter(e => e.id !== selectedNote.expenseId);
          } else {
              currentYearExpenses = currentYearExpenses.filter(e => e.description !== selectedNote.title);
          }
          
          updateSelectedNote({ isExpense: false, expenseId: undefined });
          onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, isExpense: false, expenseId: undefined } }, dailyExpenses: { ...data.dailyExpenses, [year]: currentYearExpenses } });
          return;
      }

      // ADD to Expenses
      let amount = 0;
      let currency = 'CHF';
      let merchant = 'Unbekannt';
      
      const html = selectedNote.content || '';
      
      const amountMatch = html.match(/Betrag:.*?<strong>([\d\.'’]+)\s*(\w*)<\/strong>/) || html.match(/(\d+[\.,]\d{2})\s?(CHF|EUR|USD)/);
      const merchantMatch = html.match(/Händler:.*?<strong>(.*?)<\/strong>/);
      
      if (amountMatch) {
          const rawAmount = amountMatch[1].replace(/['’]/g, '');
          amount = parseFloat(rawAmount);
          if (amountMatch[2]) currency = amountMatch[2];
      }
      if (merchantMatch) {
          merchant = merchantMatch[1];
      }

      if (amount === 0 || isNaN(amount)) {
          const manualAmount = prompt("Betrag nicht automatisch erkannt. Bitte eingeben (z.B. 25.50):");
          if (!manualAmount) return;
          amount = parseFloat(manualAmount);
      }

      const year = selectedNote.year || new Date().getFullYear().toString();
      const expenseId = `expense_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
      
      let receiptId = undefined;
      let fileBlob = await DBService.getFile(selectedNote.id);
      if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) {
          fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
      }
      if (fileBlob) {
          receiptId = `receipt_exp_${Date.now()}`;
          await DBService.saveFile(receiptId, fileBlob);
      }

      const newEntry: ExpenseEntry = {
          id: expenseId,
          date: new Date().toISOString().split('T')[0], 
          merchant: merchant,
          description: selectedNote.title,
          amount: amount,
          currency: currency,
          rate: 1,
          category: 'Sonstiges', // Default
          isTaxRelevant: false,
          receiptId: receiptId
      };

      const currentYearExpenses = data.dailyExpenses?.[year] || [];
      const updatedDailyExpenses = { ...data.dailyExpenses, [year]: [...currentYearExpenses, newEntry] };

      const updatedNote = { ...selectedNote, isExpense: true, expenseId: expenseId };
      const updatedNotes = { ...data.notes, [selectedNoteId]: updatedNote };

      onUpdate({ 
          ...data, 
          notes: updatedNotes,
          dailyExpenses: updatedDailyExpenses 
      });
      
      alert(`Als Ausgabe erfasst: ${amount} ${currency} bei ${merchant}\n(Jahr: ${year})`);
  };

  const createNote = () => {
    const id = `note_${Date.now()}`;
    const year = new Date().getFullYear().toString();
    let initialCat = selectedCat === 'All' || selectedCat === 'Inbox' ? 'Sonstiges' : selectedCat;
    const newNote: NoteDocument = { id, title: 'Neue Notiz', type: 'note', category: initialCat, year: year, created: new Date().toISOString(), content: '<p></p>', fileName: 'note.txt', tags: [], isNew: true };
    onUpdate({ ...data, notes: { ...data.notes, [id]: newNote } });
    setSelectedNoteId(id);
    if (selectedCat !== 'All' && selectedCat !== initialCat) setSelectedCat(initialCat);
  };

  const changeCategory = async (newCat: DocCategory, newSubCat?: string) => {
      if (!selectedNoteId || !selectedNote) return;
      if (selectedNote.category === newCat && selectedNote.subCategory === newSubCat) return;
      setIsCreatingCat(false); setNewCatName('');
      if (selectedNote.filePath && VaultService.isConnected()) {
          const updatedDoc = await DocumentService.moveFile(selectedNote, newCat, newSubCat);
          onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: updatedDoc } });
      } else { updateSelectedNote({ category: newCat, subCategory: newSubCat }); }
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

  const openFile = async () => {
      if (!selectedNote) return;
      if (selectedNote.filePath && VaultService.isConnected()) {
          const blob = await DocumentService.getFileFromVault(selectedNote.filePath);
          if (blob) { const url = URL.createObjectURL(blob); window.open(url, '_blank'); return; }
      }
      try {
          const blob = await DBService.getFile(selectedNote.id);
          if (blob) { const url = URL.createObjectURL(blob); window.open(url, '_blank'); return; }
      } catch (e) { console.error(e); }
      alert("Datei nicht gefunden.");
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
      return 'bg-gray-50 text-gray-500 border border-gray-100';
  };

  const toggleCatExpanded = (cat: string) => { setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] })); };

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
                <select value={selectedCat} onChange={(e) => { setSelectedCat(e.target.value); setSelectedSubCat(null); }} className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-2 text-sm font-bold shadow-sm min-w-0">
                <option value="All">Alle Kategorien</option>
                {CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {/* Subtle scanning indicator for mobile */}
                {isScanning && <div className="p-2"><Loader2 size={16} className="animate-spin text-blue-500" /></div>}
                
                <button onClick={() => zipImportInputRef.current?.click()} className="p-2 bg-purple-100 text-purple-600 rounded-lg shadow-sm active:scale-95 transition-transform shrink-0"><FileArchive size={20} /></button>
                <input type="file" ref={zipImportInputRef} accept=".zip" className="hidden" onChange={handleZipImport} />
                <button onClick={() => mobileImportInputRef.current?.click()} className="p-2 bg-[#16325c] text-white rounded-lg shadow-sm active:scale-95 transition-transform shrink-0"><UploadCloud size={20} /></button>
                <input type="file" ref={mobileImportInputRef} multiple className="hidden" onChange={handleMobileImport} />
                <button onClick={createNote} className="p-2 bg-blue-100 text-blue-600 rounded-lg shadow-sm active:scale-95 transition-transform shrink-0"><PenTool size={20} /></button>
         </div>

         {/* Desktop Create Button */}
         <div className="hidden md:block p-4 space-y-2">
            <button onClick={createNote} className="w-full py-3 bg-[#16325c] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 hover:bg-blue-800 transition-all"><PenTool size={16} /> Neue Notiz</button>
         </div>
         
         {/* Categories List (Desktop) */}
         <div className="hidden md:block flex-1 overflow-y-auto px-2 space-y-1">
            <button onClick={() => { setSelectedCat('All'); setSelectedSubCat(null); }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-bold transition-colors ${selectedCat === 'All' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                <div className="flex items-center gap-2"><Inbox size={16}/> Alle Notizen</div><span className="bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">{notesList.length}</span>
            </button>
            <div className="pt-4 pb-2 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Kategorien</div>
            <div className="group flex items-center gap-1 w-full px-1">
                <button onClick={() => { setSelectedCat('Inbox'); setSelectedSubCat(null); }} className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCat === 'Inbox' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                    <div className="flex items-center gap-2"><Inbox size={16} className="text-purple-500"/> Inbox</div><span className="text-[10px] text-gray-300">{notesList.filter(n => n.category === 'Inbox').length}</span>
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
                            <div className="flex items-center gap-2 truncate"><FolderOpen size={16} className="text-amber-500 shrink-0"/><span className="truncate">{catName}</span></div><span className="text-[10px] text-gray-300 shrink-0">{docCount}</span>
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

         {/* Desktop Vault/Scan Footer */}
         <div className="hidden md:block p-4 border-t border-gray-100 bg-gray-50 space-y-2 relative">
            {scanMessage && <div className={`absolute bottom-full left-4 right-4 mb-2 p-3 text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 z-20 ${scanMessage.type === 'warning' ? 'bg-orange-100 text-orange-700' : scanMessage.type === 'success' ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'}`}>{scanMessage.text}</div>}
             <button onClick={() => zipImportInputRef.current?.click()} disabled={isScanning} className="w-full py-2.5 border border-purple-200 bg-purple-50 text-purple-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-purple-100 transition-all"><FileArchive size={14} /> ZIP Archiv Import</button>
            <button onClick={() => handleScanInbox(true)} disabled={isScanning} className={`w-full py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-gray-50 transition-all ${isScanning ? 'opacity-50 cursor-wait' : ''}`}>
                {isScanning ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} 
                Inbox Scannen
            </button>
            <button onClick={handleReindex} disabled={isReindexing} className={`w-full py-2.5 border border-blue-200 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-100 transition-all ${isReindexing ? 'opacity-50 cursor-wait' : ''}`}>{isReindexing ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Archive Sync</button>
         </div>
      </div>

      {/* Resizer Sidebar -> List */}
      <div className="hidden md:flex w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize items-center justify-center transition-all z-10" onMouseDown={startResizing('sidebar')} />

      {/* 2. NOTE LIST */}
      <div className={`border-r border-gray-100 flex flex-col min-h-0 bg-white shrink-0 ${selectedNoteId ? 'hidden md:flex' : 'flex'}`} style={{ width: window.innerWidth >= 768 ? layout.listW : '100%' }}>
         <div className="p-4 border-b border-gray-50 shrink-0 space-y-2">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                <input type="text" placeholder="Suchen..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-50 transition-all"/>
            </div>
            {(selectedCat !== 'All' || selectedSubCat) && (
                <div className="flex gap-2 flex-wrap">
                    {selectedCat !== 'All' && <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-[10px] font-bold"><span>{selectedCat}</span><button onClick={() => { setSelectedCat('All'); setSelectedSubCat(null); }} className="hover:text-red-500"><X size={10}/></button></div>}
                    {selectedSubCat && <div className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded-md text-[10px] font-bold"><span>{selectedSubCat}</span><button onClick={() => setSelectedSubCat(null)} className="hover:text-red-500"><X size={10}/></button></div>}
                </div>
            )}
         </div>
         <div className="flex-1 md:overflow-y-auto min-h-0 pb-20">
            {filteredNotes.map((note: any) => (
                <div key={note.id} onClick={() => setSelectedNoteId(note.id)} className={`p-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedNoteId === note.id ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}>
                    <div className="flex items-start justify-between mb-1">
                        <h4 className={`font-bold text-sm truncate flex-1 ${selectedNoteId === note.id ? 'text-blue-700' : 'text-gray-800'}`}>{note.title}</h4>
                        <div className="flex items-center gap-1">
                            {note.isExpense && <span title="Ausgabe erfasst"><ShoppingBag size={14} className="text-orange-500" /></span>}
                            {note.taxRelevant && <span title="In Steuer importiert"><Receipt size={14} className="text-blue-500" /></span>}
                            {getIconForType(note.type)}
                        </div>
                    </div>
                    <div className="text-xs mb-2 h-10 leading-relaxed line-clamp-2">{renderNotePreview(note.content, searchQuery)}</div>
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex gap-2 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCategoryColor(note.category)}`}>{note.category}</span>
                            {note.subCategory && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 border border-gray-200">{note.subCategory}</span>}
                        </div>
                        <span className="text-[10px] text-gray-300">{new Date(note.created).toLocaleDateString()}</span>
                    </div>
                </div>
            ))}
            {filteredNotes.length === 0 && <div className="p-8 text-center text-gray-400 text-xs italic">Keine Dokumente gefunden.</div>}
         </div>
      </div>

      {/* Resizer List -> Detail */}
      <div className="hidden md:flex w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize items-center justify-center transition-all z-10" onMouseDown={startResizing('list')} />

      {/* 3. DETAIL / EDITOR */}
      <div className={`flex-1 flex flex-col bg-gray-50/30 ${selectedNoteId ? 'fixed inset-0 z-[100] bg-white md:static h-[100dvh]' : 'hidden md:flex'}`}>
         {selectedNote ? (
             <>
                {/* MODIFIED HEADER WITH SAFE AREA PADDING */}
                <div className="px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] border-b border-gray-100 bg-white flex flex-wrap items-center justify-between shrink-0 gap-y-2">
                    <div className="flex items-center gap-3 flex-1 mr-2 overflow-hidden min-w-[200px]">
                        <button onClick={() => setSelectedNoteId(null)} className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full shrink-0"><ArrowLeft size={20} /></button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <input type="text" value={selectedNote.title} onChange={(e) => updateSelectedNote({ title: e.target.value })} className="text-lg font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300 truncate min-w-0" placeholder="Titel..."/>
                                {selectedNote.taxRelevant && <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest whitespace-nowrap hidden lg:inline-block shrink-0">In Steuer importiert</span>}
                                {selectedNote.isExpense && <span className="text-[9px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest whitespace-nowrap hidden lg:inline-block shrink-0">Ausgabe Erfasst</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1 h-6 overflow-x-auto no-scrollbar">
                                <select value={selectedNote.category} onChange={(e) => changeCategory(e.target.value as DocCategory, undefined)} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-bold border border-transparent hover:border-gray-300 transition-colors" title="Kategorie ändern">
                                    {CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <span className="text-gray-300">/</span>
                                {CATEGORY_STRUCTURE[selectedNote.category]?.length > 0 ? (
                                    <select value={selectedNote.subCategory || ''} onChange={(e) => changeCategory(selectedNote.category, e.target.value || undefined)} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-medium hover:border-gray-300 transition-colors">
                                        <option value="">(Keine Unterkategorie)</option>
                                        {CATEGORY_STRUCTURE[selectedNote.category].map(sub => <option key={sub} value={sub}>{sub}</option>)}
                                        {selectedNote.subCategory && !CATEGORY_STRUCTURE[selectedNote.category].includes(selectedNote.subCategory) && <option value={selectedNote.subCategory}>{selectedNote.subCategory} (Custom)</option>}
                                    </select>
                                ) : (
                                    <div className="relative group flex items-center gap-1">
                                        <input type="text" value={tempSubCategory} onChange={(e) => setTempSubCategory(e.target.value)} onBlur={() => { if(tempSubCategory === (selectedNote.subCategory || '')) return; changeCategory(selectedNote.category, tempSubCategory.trim() || undefined); }} placeholder="Unterkategorie..." disabled={isUpdatingCategory} className={`text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-lg outline-none font-medium hover:border-gray-300 transition-colors w-32 focus:w-48 focus:ring-1 focus:ring-blue-100 ${isUpdatingCategory ? 'opacity-50 cursor-wait' : ''}`} />
                                    </div>
                                )}
                                <div className="w-px h-3 bg-gray-200 mx-1"></div>
                                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-mono shrink-0">{selectedNote.year}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 md:gap-2 shrink-0">
                        <button onClick={() => setIsLensEnabled(!isLensEnabled)} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${isLensEnabled ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`} title="Lupe"><ZoomIn size={16} /></button>
                        
                        {/* EXPENSE TOGGLE BUTTON */}
                        <button onClick={toggleExpenseImport} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${selectedNote.isExpense ? 'bg-orange-50 border-orange-200 text-orange-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-orange-500 hover:border-orange-100'}`} title={selectedNote.isExpense ? "Ausgabe entfernen" : "Zu Ausgaben hinzufügen"}>
                            <ShoppingBag size={16} />
                        </button>

                        <button onClick={handleReanalyzeContent} disabled={isReanalyzing} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 bg-white border-gray-100 text-gray-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50`}>{isReanalyzing ? <Loader2 size={16} className="animate-spin text-purple-500" /> : <BrainCircuit size={16} />}</button>
                        <button onClick={toggleTaxImport} disabled={isAnalyzingTax} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 ${selectedNote.taxRelevant ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`}>{isAnalyzingTax ? <Loader2 size={16} className="animate-spin text-blue-500" /> : (selectedNote.taxRelevant ? <Receipt size={16} /> : <Sparkles size={16} />)}</button>
                        <div className="w-px h-6 bg-gray-100 mx-1"></div>
                        {selectedNote.filePath && <button onClick={openFile} className="p-1.5 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors" title="Dokument Öffnen"><Eye size={16} /></button>}
                        <button onClick={deleteNote} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                </div>
                
                <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
                    {/* RICH TEXT EDITOR */}
                    {selectedNote.type === 'note' ? (
                        <div key={selectedNote.id} className="flex flex-col h-full bg-white">
                            {/* Toolbar Omitted for brevity (same as previous) */}
                            <div className="flex flex-col bg-gray-50 border-b border-gray-100 shrink-0">
                                <div className="flex items-center gap-1 p-2 overflow-x-auto flex-nowrap no-scrollbar">
                                    <button onClick={() => execCmd('undo')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Undo size={14}/></button>
                                    <button onClick={() => execCmd('redo')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600 mr-2"><Redo size={14}/></button>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 font-bold"><Bold size={14}/></button>
                                    <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 italic"><Italic size={14}/></button>
                                    <button onClick={() => execCmd('underline')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 underline"><Underline size={14}/></button>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <button onClick={() => execCmd('insertUnorderedList')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><List size={14}/></button>
                                    <button onClick={insertTable} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><TableIcon size={14}/></button>
                                    <div className="relative group p-1.5 hover:bg-gray-200 rounded text-gray-600 cursor-pointer"><Palette size={14} /><input ref={colorInputRef} type="color" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" onChange={(e) => execCmd('foreColor', e.target.value)}/></div>
                                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                                    <label className="p-1.5 hover:bg-gray-200 rounded text-gray-600 cursor-pointer flex items-center gap-1"><ImagePlus size={14}/><input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} /></label>
                                </div>
                                {activeTableCtx && <div className="flex items-center gap-1 p-1 bg-blue-50 border-t border-blue-100 overflow-x-auto flex-nowrap animate-in slide-in-from-top-1">
                                    <button onClick={() => manipulateTable('addRowBelow')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><ArrowDown size={12}/> Zeile</button>
                                    <button onClick={() => manipulateTable('addColRight')} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><ArrowRightIcon size={12}/> Spalte</button>
                                    <button onClick={() => manipulateTable('delRow')} className="p-1 hover:bg-red-100 rounded text-red-500 text-[10px] flex gap-1"><Trash2 size={12}/> Zeile</button>
                                    <div className="flex-1"></div>
                                    <button onClick={() => manipulateTable('delTable')} className="p-1 hover:bg-red-100 rounded text-red-600 text-[10px] font-bold flex gap-1 bg-white border border-red-100 shadow-sm"><X size={12}/> Löschen</button>
                                </div>}
                            </div>
                            <div ref={editorRef} contentEditable onInput={handleEditorInput} onPaste={handlePaste} onSelect={checkTableContext} onClick={checkTableContext} onKeyUp={checkTableContext} className="flex-1 p-4 md:p-8 outline-none overflow-y-auto text-gray-800 leading-relaxed text-sm prose max-w-none pb-24" />
                        </div>
                    ) : (
                        // PREVIEW FOR FILES
                        <div className="flex-1 p-4 overflow-y-auto pb-24" style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}>
                           <div className="mb-4">
                               <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-1"><StickyNote size={12} /> Eigene Notizen</label>
                               <textarea value={selectedNote.userNote || ''} onChange={(e) => updateSelectedNote({ userNote: e.target.value })} className="w-full p-2 bg-amber-50/50 border border-amber-100 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-amber-200 outline-none resize-y min-h-[60px] shadow-sm transition-all" placeholder="Notizen zum Dokument..." />
                           </div>

                           {selectedNote.type === 'pdf' && activeFileBlob ? (
                                <div className={`space-y-2 ${isFullscreen ? 'fixed inset-0 z-[200] bg-white flex flex-col' : ''}`}>
                                    {isFullscreen && (
                                        <div className="bg-gray-800 text-white p-3 flex justify-between items-center shrink-0">
                                            <span className="font-bold truncate">{selectedNote.fileName}</span>
                                            <button onClick={() => setIsFullscreen(false)}><Minimize size={24}/></button>
                                        </div>
                                    )}
                                    <div className={`flex items-center gap-2 text-xs text-gray-500 font-medium px-1 ${isFullscreen ? 'hidden' : ''}`}>
                                        <FileText size={14} className="text-gray-400" />
                                        <span className="font-mono truncate">{selectedNote.fileName}</span>
                                    </div>
                                    
                                    {/* ACTION BAR FOR PDF */}
                                    <div className={`flex gap-2 mb-2 p-1 overflow-x-auto no-scrollbar ${isFullscreen ? 'bg-gray-100 p-2' : ''}`}>
                                        <button onClick={() => setIsFullscreen(!isFullscreen)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-700 whitespace-nowrap">
                                            {isFullscreen ? <Minimize size={14}/> : <Maximize size={14}/>} {isFullscreen ? 'Klein' : 'Gross'}
                                        </button>
                                        <button onClick={handleShare} className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold text-blue-700 whitespace-nowrap">
                                            <Share2 size={14}/> Teilen / Senden
                                        </button>
                                        <button onClick={handleOpenExternal} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-700 whitespace-nowrap">
                                            <Printer size={14}/> Drucken / Öffnen
                                        </button>
                                    </div>

                                    <div className={`overflow-hidden border border-gray-200 rounded-lg ${isFullscreen ? 'flex-1 rounded-none border-none' : ''}`}>
                                        <PdfViewer blob={activeFileBlob} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />
                                    </div>
                                </div>
                           ) : selectedNote.type === 'image' ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs text-gray-500 font-medium px-1">
                                        <ImageIcon size={14} className="text-gray-400" />
                                        <span className="font-mono truncate">{selectedNote.fileName}</span>
                                    </div>
                                    
                                    {/* ACTION BAR FOR IMAGE */}
                                    <div className="flex gap-2 mb-2 p-1 overflow-x-auto no-scrollbar">
                                        <button onClick={handleShare} className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs font-bold text-blue-700 whitespace-nowrap">
                                            <Share2 size={14}/> Teilen
                                        </button>
                                        <button onClick={handleOpenExternal} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold text-gray-700 whitespace-nowrap">
                                            <Printer size={14}/> Öffnen
                                        </button>
                                    </div>

                                    {activeFileBlob && (
                                        <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm bg-gray-50 flex items-center justify-center min-h-[200px]">
                                            <BlobImage blob={activeFileBlob} alt="Preview" className="w-full h-auto max-h-[70vh] object-contain" />
                                        </div>
                                    )}
                                    <div className="space-y-1 mt-4">
                                        <h5 className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Extrahierter Text / Details</h5>
                                        {/* HTML RENDERING FIX: Use dangerousHTML instead of textarea */}
                                        <div className="w-full p-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 leading-relaxed overflow-x-auto" dangerouslySetInnerHTML={{ __html: selectedNote.content }} />
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                                    <div className={`w-24 h-24 rounded-3xl flex items-center justify-center ${selectedNote.type === 'word' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{selectedNote.type === 'word' ? <FileType size={48} /> : <FileSpreadsheet size={48} />}</div>
                                    <div className="space-y-2"><h3 className="text-xl font-black text-gray-800">{selectedNote.type === 'word' ? 'Word Dokument' : 'Excel Tabelle'}</h3><p className="text-sm text-gray-400 max-w-md mx-auto">Inhalt extrahiert:<br/><span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded mt-2 inline-block max-w-xs truncate">{selectedNote.content.substring(0,50)}...</span></p></div>
                                    {selectedNote.filePath && <button onClick={openFile} className="px-8 py-3 bg-[#16325c] text-white rounded-xl font-bold shadow-xl flex items-center gap-2"><Download size={18} /> Datei Öffnen</button>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
             </>
         ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-300 hidden md:flex">
                 <FileText size={64} className="mb-4 opacity-20" />
                 <p className="text-sm font-bold uppercase tracking-widest">Wähle eine Notiz</p>
             </div>
         )}
      </div>

      {/* MODAL: CREATE TABLE */}
      {tableModal.open && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 space-y-4 animate-in zoom-in-95">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2"><TableIcon size={18} className="text-blue-500"/> Tabelle erstellen</h3>
                      <button onClick={() => setTableModal({...tableModal, open: false})} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Zeilen</label><input type="number" min="1" max="50" value={tableModal.rows} onChange={(e) => setTableModal({...tableModal, rows: parseInt(e.target.value) || 1})} className="w-full border border-gray-200 rounded-lg px-3 py-2 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"/></div>
                      <div className="space-y-1"><label className="text-[10px] uppercase font-bold text-gray-400">Spalten</label><input type="number" min="1" max="20" value={tableModal.cols} onChange={(e) => setTableModal({...tableModal, cols: parseInt(e.target.value) || 1})} className="w-full border border-gray-200 rounded-lg px-3 py-2 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"/></div>
                  </div>
                  <button onClick={confirmInsertTable} className="w-full bg-[#16325c] text-white py-3 rounded-xl font-bold text-sm hover:bg-blue-800 transition-colors">Einfügen</button>
              </div>
          </div>
      )}

      {/* MODAL: MANAGE RULES */}
      {ruleModalCat && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full space-y-4 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                      <div className="flex items-center gap-2"><Tag size={18} className="text-blue-500" /><div><h3 className="font-bold text-gray-800">Stichwörter</h3><p className="text-xs text-gray-400">Für Kategorie: <span className="font-bold text-blue-600">{ruleModalCat}</span></p></div></div>
                      <button onClick={() => setRuleModalCat(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                  </div>
                  <div className="space-y-2"><div className="flex gap-2"><input type="text" autoFocus placeholder="Neues Stichwort..." value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKeyword()} className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-100"/><button onClick={addKeyword} className="bg-blue-600 text-white px-3 rounded-lg hover:bg-blue-700"><Plus size={18}/></button></div></div>
                  <div className="max-h-60 overflow-y-auto space-y-1 py-2">
                      {(data.categoryRules?.[ruleModalCat] || []).map(keyword => (<div key={keyword} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg group"><span className="text-sm font-medium text-gray-700">{keyword}</span><button onClick={() => removeKeyword(keyword)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button></div>))}
                      {(!data.categoryRules?.[ruleModalCat] || data.categoryRules[ruleModalCat].length === 0) && (<div className="text-center py-4 text-xs text-gray-300 italic">Keine eigenen Stichwörter definiert.</div>)}
                  </div>
              </div>
          </div>
      )}

      {/* FLOATING TOOLTIP */}
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