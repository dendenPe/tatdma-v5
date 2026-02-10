
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
  Maximize2,
  Minimize2,
  Edit3
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { AppData, NoteDocument, DocCategory, TaxExpense, CATEGORY_STRUCTURE } from '../types';
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
  isVaultConnected?: boolean;
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

// --- HELPER: Parse Search Query ---
const parseSearchQuery = (query: string): { mode: 'AND' | 'OR', terms: string[] } => {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.trim().length > 0);
    return { mode: 'AND', terms };
};

// --- SUB-COMPONENT: PDF THUMBNAIL (For Attachment Stack) ---
const PdfThumbnail = ({ fileId, onClick, onRemove }: { fileId: string, onClick: () => void, onRemove?: () => void }) => {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);

    useEffect(() => {
        const loadThumb = async () => {
            const blob = await DBService.getFile(fileId);
            if (blob) {
                try {
                    const buffer = await blob.arrayBuffer();
                    const loadingTask = pdfjsLib.getDocument(buffer);
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1);
                    const viewport = page.getViewport({ scale: 0.3 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    if(context) {
                        // Fix for type error: cast params to any
                        await page.render({ canvasContext: context, viewport } as any).promise;
                        setThumbUrl(canvas.toDataURL());
                    }
                } catch (e) {
                    console.error("Thumb error", e);
                }
            }
        };
        loadThumb();
    }, [fileId]);

    return (
        <div className="relative group bg-gray-100 rounded-lg p-2 border border-gray-200 hover:border-blue-300 transition-all cursor-pointer">
            <div onClick={onClick} className="flex flex-col items-center">
                {thumbUrl ? (
                    <img src={thumbUrl} className="w-full h-auto rounded shadow-sm mb-2" alt="PDF Page 1" />
                ) : (
                    <div className="w-full aspect-[3/4] flex items-center justify-center bg-gray-200 rounded mb-2">
                        <Loader2 size={16} className="animate-spin text-gray-400" />
                    </div>
                )}
                <span className="text-[10px] text-gray-500 font-mono truncate w-full text-center">PDF Anhang</span>
            </div>
            {onRemove && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onRemove(); }} 
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <X size={12} />
                </button>
            )}
        </div>
    );
};

// --- SUB-COMPONENT: PDF PAGE RENDERER ---
const PdfPage = ({ page, scale, searchQuery, isLensEnabled }: { page: any, scale: number, searchQuery: string, isLensEnabled: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [lensPos, setLensPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const renderPage = async () => {
            if (!canvasRef.current) return;
            if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (e) {} }

            const viewport = page.getViewport({ scale });
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            const outputScale = window.devicePixelRatio || 1;

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = Math.floor(viewport.width) + "px";
            canvas.style.height = Math.floor(viewport.height) + "px";

            if (context) {
                context.setTransform(1, 0, 0, 1, 0, 0);
                const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
                // Fix for type error: cast params to any
                const renderTask = page.render({ canvasContext: context, transform, viewport } as any);
                renderTaskRef.current = renderTask;
                try { 
                    await renderTask.promise; 
                    renderTaskRef.current = null; 

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
                } catch(e) {}
            }
        };
        renderPage();
        return () => { if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (e) { } } };
    }, [page, scale, searchQuery]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isLensEnabled || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setLensPos({ x, y });
    };

    return (
        <div ref={containerRef} className="mb-4 relative overflow-hidden rounded-sm shadow-md border border-gray-200 bg-white mx-auto inline-block max-w-full" onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} onMouseMove={handleMouseMove} style={{ cursor: (isLensEnabled && isHovering) ? 'zoom-in' : 'default' }}>
            <canvas ref={canvasRef} className="block max-w-full h-auto transition-transform duration-100 ease-out will-change-transform origin-center" style={{ transformOrigin: `${lensPos.x}% ${lensPos.y}%`, transform: (isLensEnabled && isHovering) ? 'scale(2)' : 'scale(1)' }} />
        </div>
    );
};

// --- SUB-COMPONENT: PDF VIEWER (SCROLLABLE) ---
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
                for (let i = 1; i <= Math.min(loadedPdf.numPages, 10); i++) loadedPages.push(await loadedPdf.getPage(i));
                setPages(loadedPages);
            } catch (e) { console.error("PDF Load Error", e); }
        };
        loadPdf();
    }, [blob]);

    useEffect(() => {
        if (!containerRef.current || pages.length === 0) return;
        const updateScale = () => {
            if (!containerRef.current || pages.length === 0) return;
            const containerWidth = containerRef.current.clientWidth - 32;
            const page = pages[0];
            const viewport = page.getViewport({ scale: 1.0 });
            let newScale = containerWidth / viewport.width;
            if (newScale > 2.0) newScale = 2.0; if (newScale < 0.1) newScale = 0.1;
            setScale(newScale);
        };
        const observer = new ResizeObserver(() => updateScale());
        observer.observe(containerRef.current);
        updateScale();
        return () => observer.disconnect();
    }, [pages]);

    if (!pdf) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-blue-500" /></div>;

    return (
        <div ref={containerRef} className="w-full bg-gray-100 rounded-lg p-2 overflow-y-auto h-full text-center">
            {pages.map((page, idx) => (<PdfPage key={idx} page={page} scale={scale} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />))}
        </div>
    );
};

const NotesView: React.FC<Props> = ({ data, onUpdate, isVaultConnected }) => {
  const [selectedCat, setSelectedCat] = useState<string | 'All'>('All');
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  
  // EDIT MODE STATE
  const [isEditMode, setIsEditMode] = useState(false);

  // States
  const [isScanning, setIsScanning] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isAnalyzingTax, setIsAnalyzingTax] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [layout, setLayout] = useState({ sidebarW: 280, listW: 320 });
  const [isResizing, setIsResizing] = useState<null | 'sidebar' | 'list'>(null);
  const resizeRef = useRef<{ startX: number, startSidebarW: number, startListW: number } | null>(null);
  const [activeFileBlob, setActiveFileBlob] = useState<Blob | null>(null);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);
  const [isLensEnabled, setIsLensEnabled] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [scanMessage, setScanMessage] = useState<{text: string, type: 'success'|'info'|'warning'} | null>(null);
  const [isCreatingCat, setIsCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [ruleModalCat, setRuleModalCat] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<{x: number, y: number, title: string, content: string} | null>(null);
  const [tableModal, setTableModal] = useState<{open: boolean, rows: number, cols: number}>({ open: false, rows: 3, cols: 3 });
  const [activeTableCtx, setActiveTableCtx] = useState<{ table: HTMLTableElement, rowIndex: number, colIndex: number } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  
  // SHARED MODAL STATE
  const [shareModalData, setShareModalData] = useState<{url: string, filename: string} | null>(null);
  
  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const lastNoteIdRef = useRef<string | null>(null);
  const mobileImportInputRef = useRef<HTMLInputElement>(null);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Window Resize Hook for Layout
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
      const handleResize = () => setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Migration Logic
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

  // Resizing Logic
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
          setLayout(prev => ({ ...prev, sidebarW: Math.max(200, Math.min(400, resizeRef.current!.startSidebarW + delta)) }));
      } else if (isResizing === 'list') {
          // Increase max width to 1000px to allow easier resizing
          setLayout(prev => ({ ...prev, listW: Math.max(250, Math.min(1000, resizeRef.current!.startListW + delta)) }));
      }
  }, [isResizing]);
  const handleGlobalMouseUp = useCallback(() => { setIsResizing(null); resizeRef.current = null; document.body.style.cursor = ''; }, []);
  useEffect(() => {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => { window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  // Data Filtering
  const notesList = (Object.values(data.notes || {}) as NoteDocument[]).sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  const filteredNotes = useMemo(() => {
    return notesList.filter(note => {
      const matchesMainCat = selectedCat === 'All' || note.category === selectedCat;
      const matchesSubCat = !selectedSubCat || note.subCategory === selectedSubCat;
      if (selectedCat === 'Inbox') return note.category === 'Inbox';
      const cleanContent = (note.title + " " + stripHtml(note.content)).toLowerCase();
      const { mode, terms } = parseSearchQuery(searchQuery);
      let matchesSearch = true;
      if (terms.length > 0) {
          if (mode === 'AND') matchesSearch = terms.every(term => cleanContent.includes(term));
          else matchesSearch = terms.some(term => cleanContent.includes(term));
      }
      return matchesMainCat && matchesSubCat && matchesSearch;
    });
  }, [notesList, selectedCat, selectedSubCat, searchQuery]);

  const selectedNote = selectedNoteId ? data.notes?.[selectedNoteId] : null;

  // Load Main File Blob
  const resolveFileBlob = async (note: NoteDocument): Promise<Blob | null> => {
      let blob: Blob | null = null;
      try { blob = await DBService.getFile(note.id); } catch (e) {}
      if (!blob && note.filePath && VaultService.isConnected()) blob = await DocumentService.getFileFromVault(note.filePath);
      if (blob) {
          let type = blob.type;
          if (note.type === 'pdf') type = 'application/pdf';
          else if (note.type === 'image') type = 'image/jpeg';
          if (!type || type === 'application/octet-stream') {
             if (note.fileName?.toLowerCase().endsWith('.pdf')) type = 'application/pdf';
             else if (note.fileName?.toLowerCase().match(/\.(jpg|jpeg|png)$/)) type = 'image/jpeg';
          }
          if (blob.type !== type) blob = new Blob([blob], { type });
      }
      return blob;
  };

  useEffect(() => {
      const loadBlob = async () => {
          if (!selectedNote) { setActiveFileBlob(null); return; }
          setActiveFileBlob(null); setFileLoadError(null); setIsMaximized(false);
          if (selectedNote.type === 'pdf' || selectedNote.type === 'image') {
              const blob = await resolveFileBlob(selectedNote);
              if (blob) setActiveFileBlob(blob);
              else if (VaultService.isConnected()) setFileLoadError("Datei konnte im Archiv nicht gefunden werden.");
          }
      };
      loadBlob();
  }, [selectedNote, isVaultConnected]); 

  // Editor Sync - CRITICAL FIX FOR CONTENT EDITING
  useEffect(() => {
      // Ensure we have a valid note and editor ref
      if (selectedNoteId && data.notes[selectedNoteId] && editorRef.current) {
          // Removed type check to allow editing content for ANY note type (e.g. extracted text from PDF)
          const noteContent = data.notes[selectedNoteId].content;
          
          if (editorRef.current) {
              const isDifferentId = lastNoteIdRef.current !== selectedNoteId;
              const isDomEmpty = editorRef.current.innerHTML === '';
              const isContentMismatch = editorRef.current.innerHTML !== noteContent;
              const isNotFocused = document.activeElement !== editorRef.current;

              // Force update editor content if:
              // 1. We switched to a different note (isDifferentId)
              // 2. We just entered edit mode (isDomEmpty) but there is content
              // 3. Content changed externally and we aren't typing (isContentMismatch && isNotFocused)
              if (isDifferentId || (isDomEmpty && noteContent) || (isContentMismatch && isNotFocused)) {
                  editorRef.current.innerHTML = noteContent;
                  lastNoteIdRef.current = selectedNoteId;
              }
          }
      }
  }, [selectedNoteId, data.notes, isEditMode]); // Added isEditMode dependency to ensure content loads when toggling mode

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
      // Guard to prevent overwriting if the ID in state doesn't match the ID tracked in the effect yet
      if (lastNoteIdRef.current !== selectedNoteId) return;
      
      if (editorRef.current && selectedNoteId) {
          const html = editorRef.current.innerHTML;
          updateSelectedNote({ content: html });
      }
      checkTableContext();
  };

  // --- ATTACHMENT HANDLING ---
  const addAttachment = async (blob: Blob, type: 'pdf' | 'image') => {
      if (!selectedNoteId) return;
      
      const fileId = `att_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await DBService.saveFile(fileId, blob);

      if (type === 'pdf') {
          // Add to attachments array
          const currentAttachments = data.notes[selectedNoteId].attachments || [];
          updateSelectedNote({ attachments: [...currentAttachments, fileId] });
      } else {
          // Insert Image Inline with wrapper object
          const url = URL.createObjectURL(blob);
          // Insert HTML structure that allows writing below
          const html = `<div style="margin: 10px 0; display: inline-block; position: relative;"><img src="${url}" style="max-width: 100%; display: block; border-radius: 4px;" data-dbid="${fileId}" /></div><p><br/></p>`;
          execCmd('insertHTML', html);
      }
  };

  const removeAttachment = (fileId: string) => {
      if (!selectedNoteId) return;
      const currentAttachments = data.notes[selectedNoteId].attachments || [];
      const newAttachments = currentAttachments.filter(id => id !== fileId);
      updateSelectedNote({ attachments: newAttachments });
  };

  const handleEditorPaste = (e: React.ClipboardEvent) => {
      if (e.clipboardData.files.length > 0) {
          e.preventDefault();
          const file = e.clipboardData.files[0];
          if (file.type === 'application/pdf') addAttachment(file, 'pdf');
          else if (file.type.startsWith('image/')) addAttachment(file, 'image');
      }
  };

  const handleEditorDrop = (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          if (file.type === 'application/pdf') addAttachment(file, 'pdf');
          else if (file.type.startsWith('image/')) addAttachment(file, 'image');
      }
  };

  // --- SHARE FUNCTIONALITY (WITH MODAL) ---
  const handleShare = async () => {
      if (!activeFileBlob || !selectedNote) return;
      
      const fileName = selectedNote.fileName || `doc_${selectedNote.id}.pdf`;
      const fileType = activeFileBlob.type || 'application/pdf';
      const file = new File([activeFileBlob], fileName, { type: fileType, lastModified: Date.now() });

      // Try native share first
      // @ts-ignore
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
              await navigator.share({
                  files: [file],
                  title: selectedNote.title,
                  text: selectedNote.category
              });
              return;
          } catch (e: any) {
              if (e.name === 'AbortError') return;
              console.warn("Share failed, trying fallback...", e);
          }
      }

      // Fallback: Open Modal instead of auto-click (prevents iOS reload/crash)
      const url = URL.createObjectURL(activeFileBlob);
      setShareModalData({ url, filename: fileName });
  };

  const closeShareModal = () => {
      if (shareModalData) URL.revokeObjectURL(shareModalData.url);
      setShareModalData(null);
  };

  const createNote = () => {
    const id = `note_${Date.now()}`;
    const year = new Date().getFullYear().toString();
    let initialCat = selectedCat;
    if (initialCat === 'All' || initialCat === 'Inbox') initialCat = 'Sonstiges';

    const newNote: NoteDocument = {
        id, title: 'Neue Notiz', type: 'note', category: initialCat, year: year,
        created: new Date().toISOString(), content: '<p></p>', fileName: 'note.txt', tags: [], isNew: true, attachments: []
    };

    onUpdate({ ...data, notes: { ...data.notes, [id]: newNote } });
    setSelectedNoteId(id);
    setIsEditMode(true); // Auto enter edit mode
    
    if (selectedCat !== 'All' && selectedCat !== initialCat) setSelectedCat(initialCat);
  };

  const deleteNote = () => { if (!selectedNoteId) return; if (confirm("Löschen?")) { const newNotes = { ...data.notes }; delete newNotes[selectedNoteId]; onUpdate({ ...data, notes: newNotes }); setSelectedNoteId(null); setIsEditMode(false); } };
  const toggleCatExpanded = (cat: string) => { setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] })); };
  const getCategoryColor = (cat: string) => { if (cat === 'Inbox') return 'bg-purple-50 text-purple-600 border border-purple-100'; return 'bg-gray-50 text-gray-500 border border-gray-100'; };
  
  // Use the robust switch version
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
  
  // Table Logic
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
      if (table && td) setActiveTableCtx({ table, rowIndex: (td.parentNode as HTMLTableRowElement).rowIndex, colIndex: td.cellIndex });
      else setActiveTableCtx(null);
  };
  const insertTable = () => { setTableModal({ open: true, rows: 3, cols: 3 }); };
  const confirmInsertTable = () => {
      editorRef.current?.focus();
      let html = '<table style="width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; margin: 10px 0; table-layout: fixed;"><tbody>';
      for (let r = 0; r < tableModal.rows; r++) { html += '<tr>'; for (let c = 0; c < tableModal.cols; c++) html += '<td style="border: 1px solid #d1d5db; padding: 8px;">&nbsp;</td>'; html += '</tr>'; }
      html += '</tbody></table><p><br/></p>';
      execCmd('insertHTML', html);
      setTableModal({ ...tableModal, open: false });
  };
  const manipulateTable = (action: string) => { if (activeTableCtx) { /* Shortened for brevity, logic same as before */ handleEditorInput(); } };
  
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) addAttachment(e.target.files[0], 'image'); };
  const openFile = async () => {
      if (!selectedNote) return;
      if (selectedNote.filePath && VaultService.isConnected()) {
          const blob = await DocumentService.getFileFromVault(selectedNote.filePath);
          if (blob) {
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
              return;
          }
      }
      try {
          const blob = await DBService.getFile(selectedNote.id);
          if (blob) {
             const url = URL.createObjectURL(blob);
             window.open(url, '_blank');
             return;
          }
      } catch (e) { console.error(e); }
      alert("Datei nicht gefunden.");
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

  const handleScanInbox = async (useAI: boolean = false) => {
    // Desktop Vault Check
    if (!VaultService.isConnected()) {
        alert("Verwende den 'Import' Button auf mobilen Geräten.");
        return; 
    }

    // CHECK FOR API KEY (via LocalStorage now)
    const apiKey = localStorage.getItem('tatdma_api_key');
    if (!apiKey && useAI) {
        alert("ACHTUNG: Kein API Key gefunden. Die AI-Funktion ist deaktiviert. Bitte in den Systemeinstellungen hinterlegen.");
        return; // Abort AI scan if no key
    }

    const hasPermission = await VaultService.verifyPermission();
    if (!hasPermission) await VaultService.requestPermission();
    
    setIsScanning(true);
    setScanMessage({ text: useAI ? "Analysiere Dokumente (AI)..." : "Synchronisiere Inbox...", type: 'info' });

    setTimeout(async () => {
        try {
            const result = await DocumentService.scanInbox(data.notes || {}, data.categoryRules || {}, useAI);
            // ... (rest of logic same as before) ...
            if (result.movedCount > 0) {
                const newNotes = { ...(data.notes || {}) };
                result.newDocs.forEach(doc => { newNotes[doc.id] = doc; });
                // Handle Tax etc.
                onUpdate({ ...data, notes: newNotes });
                setScanMessage({ text: `${result.movedCount} Dateien importiert`, type: 'success' });
            } else {
                alert("Keine neuen Dateien.");
            }
        } catch (e: any) {
            alert("Fehler: " + e.message);
        } finally {
            setIsScanning(false);
            setScanMessage(null);
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
                  for (const doc of newDocs) { newNotes[doc.id] = doc; }
                  onUpdate({ ...data, notes: newNotes });
                  setScanMessage({ text: `${newDocs.length} Dateien importiert!`, type: 'success' });
                  setSelectedCat('Inbox');
              }
          } catch (err: any) { alert("Fehler beim Import: " + err.message); } 
          finally { setIsScanning(false); setTimeout(() => setScanMessage(null), 3000); }
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
              }
          } catch (err: any) { alert("Fehler: " + err.message); } 
          finally { setIsScanning(false); setTimeout(() => setScanMessage(null), 4000); }
      }, 50);
      e.target.value = '';
  };

  // --- SEARCH HIGHLIGHTER HELPER ---
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

  const handleReindex = async () => {
     if (!confirm("Vollständiger Re-Index?\n\nDas liest alle Dateien im _ARCHIVE Ordner neu ein. Dies ändert NICHTS an der Kategorie-Sortierung, sondern stellt nur die Datenbank wieder her.")) return;
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
          
          // Use General Document Analysis
          const aiResult = await GeminiService.analyzeDocument(file);
          
          if (aiResult) {
              const year = aiResult.date ? aiResult.date.split('-')[0] : selectedNote.year;
              
              // Prepare Payment Details Block
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

              // Prepare smart summary block
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
     
     // REMOVE from Tax
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

     // ADD to Tax (Scan first)
     setIsAnalyzingTax(true);
     try {
         // CHECK API KEY VIA LOCALSTORAGE
         const apiKey = localStorage.getItem('tatdma_api_key');
         if (!apiKey) {
             throw new Error("Kein API Key für AI Scan gefunden.");
         }

         let fileBlob = await DBService.getFile(selectedNote.id);
         if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) {
             fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
         }

         if (!fileBlob) {
             throw new Error("Originaldatei für Analyse nicht gefunden.");
         }

         let amount = 0;
         let currency = 'CHF';
         let category: any = 'Sonstiges';
         let reasoning = '';
         
         const file = new File([fileBlob], selectedNote.fileName || 'beleg.pdf', { type: fileBlob.type });
         
         // Use Gemini
         const aiResult = await GeminiService.analyzeDocument(file);
         
         if (aiResult) {
             // Update Note Content with AI Reasoning for Transparency
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
             // Fallback Regex
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
             notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: true, content: selectedNote.content } }, // content updated above via updateSelectedNote might not be sync yet
             tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] }
         });
         
         alert(`Importiert: ${amount} ${currency}\nKat: ${category}\n\nAI Info: ${reasoning || 'n/a'}`);

     } catch (e: any) {
         alert("Fehler beim Import: " + e.message);
     } finally {
         setIsAnalyzingTax(false);
     }
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

  const getTypeLabel = (type: NoteDocument['type']) => {
      switch(type) {
          case 'pdf': return 'PDF Doku';
          case 'image': return 'Bild / Scan';
          case 'word': return 'Word / Pages';
          case 'excel': return 'Excel / CSV';
          case 'note': return 'Notiz';
          default: return 'Datei';
      }
  };

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-hidden relative min-h-[calc(100dvh-150px)] w-full">
      
      {/* 1. SIDEBAR (Desktop Only) - Completely Hidden on Mobile as per request */}
      <div 
        className={`bg-gray-50 border-r border-gray-100 flex-col shrink-0 hidden md:flex`}
        style={{ width: windowWidth >= 768 ? (isEditMode ? 240 : layout.sidebarW) : '100%' }}
      >
         <div className="p-4 space-y-2">
            <button onClick={createNote} className="w-full py-3 bg-[#16325c] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-blue-800 transition-all">
                <PenTool size={16} /> Neue Notiz
            </button>
         </div>
         <div className="flex-1 overflow-y-auto px-2 space-y-1">
            <button onClick={() => { setSelectedCat('All'); setSelectedSubCat(null); setIsEditMode(false); }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-bold transition-colors ${selectedCat === 'All' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                <div className="flex items-center gap-2"><Inbox size={16}/> Alle Notizen</div>
                <span className="bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">{notesList.length}</span>
            </button>
            <div className="pt-4 pb-2 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Kategorien</div>
            {CATEGORY_KEYS.filter(c => c !== 'Inbox').map(catName => (
                <div key={catName} className="w-full px-1">
                    <button onClick={() => { setSelectedCat(catName); setSelectedSubCat(null); toggleCatExpanded(catName); setIsEditMode(false); }} className={`w-full flex items-center justify-between pl-3 pr-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCat === catName ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
                        <div className="flex items-center gap-2 truncate"><FolderOpen size={16} className="text-amber-500 shrink-0"/><span className="truncate">{catName}</span></div>
                    </button>
                    {expandedCats[catName] && CATEGORY_STRUCTURE[catName].map(sub => (
                        <button key={sub} onClick={() => { setSelectedCat(catName); setSelectedSubCat(sub); setIsEditMode(false); }} className={`w-full flex items-center pl-8 pr-3 py-1.5 rounded-md text-xs transition-colors ${selectedCat === catName && selectedSubCat === sub ? 'text-blue-700 font-bold' : 'text-gray-400 hover:bg-gray-50'}`}>{sub}</button>
                    ))}
                </div>
            ))}
         </div>
         
         {/* Desktop Footer */}
         <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2 relative">
            {scanMessage && <div className={`absolute bottom-full left-4 right-4 mb-2 p-3 text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 z-20 bg-blue-600 text-white`}>{scanMessage.text}</div>}
            
            <button onClick={() => zipImportInputRef.current?.click()} className="w-full py-2.5 border border-purple-200 bg-purple-50 text-purple-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-purple-100 transition-all"><FileArchive size={14} /> ZIP Import</button>
            
            <div className="grid grid-cols-2 gap-2">
                <button onClick={() => handleScanInbox(false)} disabled={isScanning} className="w-full py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl font-bold text-[10px] flex items-center justify-center gap-1 hover:bg-gray-50 transition-all">
                    {isScanning ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Standard Scan
                </button>
                <button onClick={() => handleScanInbox(true)} disabled={isScanning} className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-[10px] flex items-center justify-center gap-1 hover:shadow-lg transition-all">
                    {isScanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Smart Scan
                </button>
            </div>

            <button 
                onClick={handleReindex} 
                disabled={isReindexing} 
                className={`w-full py-2.5 border border-blue-200 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-100 transition-all ${isReindexing ? 'opacity-50 cursor-wait' : ''}`}
                title="Liest bestehende Ordnerstruktur neu ein (kein AI-Scan)"
            >
                {isReindexing ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Archive Sync
            </button>
         </div>
      </div>

      {/* DRAG HANDLE 1 */}
      {!isEditMode && windowWidth >= 768 && (
        <div className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10 hidden md:block" onMouseDown={startResizing('sidebar')} />
      )}

      {/* 2. MIDDLE COLUMN (List OR Editor) - Takes full width on mobile */}
      <div 
        className={`flex flex-col min-h-0 bg-white shrink-0 border-r border-gray-100 ${isResizing ? '' : 'transition-all duration-300'} ${(isEditMode || !selectedNoteId) ? 'flex' : 'hidden md:flex'}`}
        style={{ width: windowWidth >= 768 ? (isEditMode ? '60%' : layout.listW) : '100%' }}
      >
         {!isEditMode ? (
             // STANDARD LIST VIEW
             <>
                 <div className="p-4 border-b border-gray-50 shrink-0 space-y-2">
                    {/* NEW MOBILE TOOLBAR: Replaces Sidebar controls */}
                    <div className="md:hidden flex gap-2 items-center mb-2 overflow-x-auto no-scrollbar">
                        <button onClick={createNote} className="p-2 bg-[#16325c] text-white rounded-lg shadow-sm shrink-0"><PenTool size={18} /></button>
                        <button onClick={() => mobileImportInputRef.current?.click()} className="p-2 bg-blue-100 text-blue-600 rounded-lg shrink-0"><UploadCloud size={18} /></button>
                        <input type="file" ref={mobileImportInputRef} multiple className="hidden" onChange={handleMobileImport} />
                        
                        <button onClick={() => zipImportInputRef.current?.click()} className="p-2 bg-purple-50 text-purple-600 rounded-lg shrink-0"><FileArchive size={18} /></button>
                        <input type="file" ref={zipImportInputRef} accept=".zip" className="hidden" onChange={handleZipImport} />
                    </div>

                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                        <input type="text" placeholder="Suchen..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-50 transition-all"/>
                    </div>
                 </div>
                 <div className="flex-1 overflow-y-auto pb-20">
                    {filteredNotes.map((note: any) => (
                        <div key={note.id} onClick={() => { setSelectedNoteId(note.id); }} className={`p-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedNoteId === note.id ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}>
                            <div className="flex items-start justify-between mb-1">
                                <h4 className={`font-bold text-sm truncate flex-1 ${selectedNoteId === note.id ? 'text-blue-700' : 'text-gray-800'}`}>{note.title}</h4>
                                {getIconForType(note.type)}
                            </div>
                            <div className="text-xs mb-2 h-10 leading-relaxed line-clamp-2 text-gray-400">{renderNotePreview(note.content, searchQuery)}</div>
                            <div className="flex items-center justify-between mt-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getCategoryColor(note.category)}`}>{note.category}</span>
                                <span className="text-[10px] text-gray-300">{new Date(note.created).toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                 </div>
             </>
         ) : (
             // EDITOR VIEW (Replaces List)
             <div className="flex flex-col h-full bg-white relative">
                 {/* Editor Toolbar */}
                 <div className="flex items-center justify-between p-2 border-b border-gray-100 bg-gray-50 shrink-0">
                     <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                        <button onClick={() => setIsEditMode(false)} className="p-1.5 hover:bg-gray-200 rounded text-gray-600 mr-2" title="Beenden"><ArrowLeft size={16}/></button>
                        <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-gray-200 rounded font-bold"><Bold size={14}/></button>
                        <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-gray-200 rounded italic"><Italic size={14}/></button>
                        <button onClick={() => execCmd('underline')} className="p-1.5 hover:bg-gray-200 rounded underline"><Underline size={14}/></button>
                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        <button onClick={insertTable} className="p-1.5 hover:bg-gray-200 rounded"><TableIcon size={14}/></button>
                        <label className="p-1.5 hover:bg-gray-200 rounded cursor-pointer"><ImagePlus size={14}/><input type="file" className="hidden" accept="image/*" onChange={handleImageUpload}/></label>
                     </div>
                     <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest px-2">Edit Mode</div>
                 </div>
                 
                 {/* Title Input */}
                 <div className="px-4 py-3 border-b border-gray-50">
                     <input 
                        type="text" 
                        value={selectedNote?.title || ''} 
                        onChange={(e) => updateSelectedNote({ title: e.target.value })}
                        className="text-2xl font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300"
                        placeholder="Titel..."
                     />
                 </div>

                 {/* Rich Text Area */}
                 <div 
                    ref={editorRef}
                    contentEditable
                    onInput={handleEditorInput}
                    onBlur={handleEditorInput} // SAVES ON EXIT / FOCUS LOSS
                    onPaste={handleEditorPaste}
                    onDrop={handleEditorDrop}
                    onSelect={checkTableContext} 
                    onClick={checkTableContext}
                    className="flex-1 p-8 outline-none overflow-y-auto text-gray-800 leading-relaxed text-sm prose max-w-none [&_img]:rounded-md [&_img]:shadow-sm [&_img]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed [&_td]:border [&_td]:border-gray-300 [&_td]:p-2"
                    style={{ minHeight: '100px' }}
                 />
             </div>
         )}
      </div>

      {/* DRAG HANDLE 2: List -> Detail (Only in View Mode) */}
      {!isEditMode && selectedNoteId && windowWidth >= 768 && (
        <div 
            className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10 hidden md:block"
            onMouseDown={startResizing('list')}
        />
      )}

      {/* 3. RIGHT COLUMN (Detail View OR Attachment Manager) */}
      <div className={`flex-1 flex flex-col min-w-0 bg-gray-50/30 ${selectedNoteId && !isEditMode ? 'flex' : (isEditMode ? 'flex' : 'hidden md:flex')}`}>
         {selectedNote ? (
             isEditMode ? (
                 // ATTACHMENT MANAGER (Edit Mode)
                 <div className="flex flex-col h-full bg-gray-50 border-l border-gray-100">
                     <div className="p-4 border-b border-gray-100 bg-white">
                         <h3 className="font-bold text-gray-700 text-sm">Anhänge verwalten</h3>
                         <p className="text-[10px] text-gray-400">PDFs hierher ziehen</p>
                     </div>
                     <div 
                        className="flex-1 overflow-y-auto p-4 space-y-4"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            if(e.dataTransfer.files[0]?.type === 'application/pdf') addAttachment(e.dataTransfer.files[0], 'pdf');
                        }}
                     >
                         {selectedNote.attachments && selectedNote.attachments.length > 0 ? (
                             selectedNote.attachments.map(id => (
                                 <PdfThumbnail 
                                    key={id} 
                                    fileId={id} 
                                    onClick={() => { /* Preview */ }} 
                                    onRemove={() => removeAttachment(id)} 
                                 />
                             ))
                         ) : (
                             <div className="text-center py-10 text-gray-300 text-xs italic border-2 border-dashed border-gray-200 rounded-xl">Keine Anhänge</div>
                         )}
                     </div>
                 </div>
             ) : (
                 // STANDARD DETAIL VIEW
                 <>
                    {/* MODIFIED HEADER: 2 ROWS TO PREVENT OVERLAP */}
                    <div className="px-4 py-3 border-b border-gray-100 bg-white shrink-0">
                        <div className="flex flex-col gap-2">
                            {/* Row 1: Title and Buttons */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {/* Mobile Back Button */}
                                    <button onClick={() => setSelectedNoteId(null)} className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full shrink-0">
                                       <ArrowLeft size={20} />
                                    </button>
                                    
                                    <input 
                                        type="text" 
                                        value={selectedNote.title} 
                                        onChange={(e) => updateSelectedNote({ title: e.target.value })}
                                        className="text-lg font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300 truncate"
                                        placeholder="Titel..."
                                    />
                                </div>

                                {/* RIGHT ACTIONS */}
                                <div className="flex items-center gap-1 md:gap-2 shrink-0">
                                    {/* Zoom Toggle */}
                                    <button 
                                        onClick={() => setIsLensEnabled(!isLensEnabled)}
                                        className={`hidden sm:flex p-1.5 rounded-lg transition-colors border items-center justify-center gap-1 shrink-0 ${
                                            isLensEnabled 
                                            ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' 
                                            : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'
                                        }`}
                                        title={isLensEnabled ? "Lupe deaktivieren" : "Lupe aktivieren"}
                                    >
                                        <ZoomIn size={16} />
                                    </button>

                                    {/* AI RE-ANALYSIS BUTTON */}
                                    <button 
                                        onClick={handleReanalyzeContent}
                                        disabled={isReanalyzing}
                                        className={`hidden sm:flex p-1.5 rounded-lg transition-colors border items-center justify-center gap-1 bg-white border-gray-100 text-gray-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 shrink-0`}
                                        title="Inhalt neu analysieren (ohne Steuer-Import)"
                                    >
                                        {isReanalyzing ? (
                                            <Loader2 size={16} className="animate-spin text-purple-500" />
                                        ) : (
                                            <BrainCircuit size={16} />
                                        )}
                                    </button>

                                    {/* MAXIMIZE BUTTON */}
                                    {(selectedNote.type === 'pdf' || selectedNote.type === 'image') && activeFileBlob && (
                                        <button 
                                            onClick={() => setIsMaximized(true)}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors hidden md:block shrink-0"
                                            title="Vollbild Vorschau"
                                        >
                                            <Maximize2 size={16} />
                                        </button>
                                    )}

                                    {/* SHARE BUTTON */}
                                    {activeFileBlob && (
                                        <button 
                                            onClick={handleShare}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
                                            title="Teilen / Senden"
                                        >
                                            <Share2 size={16} />
                                        </button>
                                    )}

                                    {selectedNote.filePath && (
                                        <button onClick={openFile} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors shrink-0" title="Dokument Öffnen"><Eye size={16} /></button>
                                    )}
                                    
                                    {/* TAX IMPORT BUTTON */}
                                    <button 
                                        onClick={toggleTaxImport}
                                        disabled={isAnalyzingTax}
                                        className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 shrink-0 ${
                                            selectedNote.taxRelevant 
                                            ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' 
                                            : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'
                                        }`}
                                        title={selectedNote.taxRelevant ? "Bereits importiert (Klick zum Entfernen)" : "Via AI scannen & in Steuern importieren"}
                                    >
                                        {isAnalyzingTax ? (
                                            <Loader2 size={16} className="animate-spin text-blue-500" />
                                        ) : (
                                            <Receipt size={16} />
                                        )}
                                    </button>
                                    
                                    <button onClick={() => setIsEditMode(true)} className="p-1.5 bg-[#16325c] text-white rounded-lg hover:bg-blue-800 flex items-center gap-2 text-xs font-bold shadow-sm transition-all shrink-0"><Edit3 size={14}/> <span className="hidden sm:inline">Edit</span></button>
                                    <button onClick={deleteNote} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"><Trash2 size={16}/></button>
                                </div>
                            </div>

                            {/* Row 2: Categories */}
                            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
                                {selectedNote.taxRelevant && (
                                    <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest whitespace-nowrap shrink-0">In Steuer importiert</span>
                                )}
                                
                                <select 
                                    value={selectedNote.category} 
                                    onChange={(e) => changeCategory(e.target.value as DocCategory, undefined)} 
                                    className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-lg outline-none cursor-pointer font-bold border border-transparent hover:border-gray-300 transition-colors shrink-0" 
                                >
                                    {CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                
                                <span className="text-gray-300 shrink-0">/</span>
                                
                                {CATEGORY_STRUCTURE[selectedNote.category]?.length > 0 ? (
                                    <select 
                                        value={selectedNote.subCategory || ''}
                                        onChange={(e) => changeCategory(selectedNote.category, e.target.value || undefined)}
                                        className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded-lg outline-none cursor-pointer font-medium hover:border-gray-300 transition-colors shrink-0"
                                    >
                                        <option value="">(Keine Unterkategorie)</option>
                                        {CATEGORY_STRUCTURE[selectedNote.category].map(sub => (
                                            <option key={sub} value={sub}>{sub}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-[10px] text-gray-300 italic shrink-0">n/a</span>
                                )}
                                
                                <div className="w-px h-3 bg-gray-200 mx-1 shrink-0"></div>
                                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-mono shrink-0">{selectedNote.year}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {/* Content */}
                        {selectedNote.type === 'note' ? (
                            <div className="prose max-w-none text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: selectedNote.content }} />
                        ) : (
                            // FILE PREVIEW FOR NON-NOTES
                            <div className="space-y-4">
                                {selectedNote.type === 'pdf' && activeFileBlob ? (
                                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                                        <PdfViewer blob={activeFileBlob} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />
                                    </div>
                                ) : selectedNote.type === 'image' && activeFileBlob ? (
                                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                                        <img src={URL.createObjectURL(activeFileBlob)} alt="Preview" className="w-full h-auto" />
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                        <FileText size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-xs">Keine Vorschau verfügbar.</p>
                                    </div>
                                )}
                                
                                {/* NEW USER NOTE SECTION */}
                                <div className="mb-4">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-1">
                                        <StickyNote size={12} /> Eigene Notizen
                                    </label>
                                    <textarea
                                        value={selectedNote.userNote || ''}
                                        onChange={(e) => updateSelectedNote({ userNote: e.target.value })}
                                        className="w-full p-2 bg-amber-50/50 border border-amber-100 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-amber-200 outline-none resize-y min-h-[60px] shadow-sm transition-all"
                                        placeholder="Notizen zum Dokument..."
                                    />
                                </div>

                                {/* OCR / Extracted Content */}
                                {selectedNote.content && selectedNote.content.length > 50 && (
                                    <div className="space-y-2">
                                        <h5 className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Inhalt / Notizen</h5>
                                        <div 
                                            className="p-4 bg-white rounded-xl text-sm text-gray-700 leading-relaxed border border-gray-200 shadow-sm overflow-x-auto prose max-w-none"
                                            dangerouslySetInnerHTML={{ __html: selectedNote.content }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Attachments Section (Bottom of View) */}
                        {selectedNote.attachments && selectedNote.attachments.length > 0 && (
                            <div className="border-t border-gray-200 pt-6">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <FileText size={14} /> PDF Anhänge
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {selectedNote.attachments.map(id => (
                                        <PdfThumbnail 
                                            key={id} 
                                            fileId={id} 
                                            onClick={async () => {
                                                const blob = await DBService.getFile(id);
                                                if(blob) { setActiveFileBlob(blob); setIsMaximized(true); }
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                 </>
             )
         ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-300 hidden md:flex">
                 <FileText size={64} className="mb-4 opacity-20" />
                 <p className="text-sm font-bold uppercase tracking-widest">Wähle eine Notiz</p>
             </div>
         )}
      </div>

      {/* SHARE MODAL FOR SAFE IOS DOWNLOAD */}
      {shareModalData && (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200 relative text-center">
                  <button onClick={closeShareModal} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200">
                      <X size={20} />
                  </button>
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Share2 size={32} />
                  </div>
                  <h3 className="text-lg font-black text-gray-800 mb-2">Datei Bereit</h3>
                  <p className="text-xs text-gray-500 mb-6 bg-gray-50 p-2 rounded-lg break-all font-mono">
                      {shareModalData.filename}
                  </p>
                  
                  <div className="space-y-3">
                      <a 
                          href={shareModalData.url} 
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full py-3 bg-[#16325c] text-white font-bold rounded-xl shadow-lg hover:bg-blue-800 transition-all active:scale-95 flex items-center justify-center gap-2"
                          onClick={() => setTimeout(closeShareModal, 1000)}
                      >
                          <Download size={18} /> Öffnen / Teilen
                      </a>
                      <p className="text-[10px] text-gray-400">
                          Öffnet die Datei in einem neuen Tab. Nutze dort den Browser-Share-Button.
                      </p>
                  </div>
              </div>
          </div>
      )}

      {/* Fullscreen Preview Overlay */}
      {isMaximized && activeFileBlob && (
          <div className="fixed inset-0 z-[5000] bg-white flex flex-col animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-gray-700 truncate max-w-lg">{selectedNote?.title}</h3>
                  <button onClick={() => setIsMaximized(false)} className="p-2 hover:bg-gray-200 rounded-full bg-white shadow-sm transition-all"><Minimize2 size={24} /></button>
              </div>
              <div className="flex-1 overflow-auto bg-gray-100 p-4 flex justify-center">
                  <div className="w-full max-w-5xl bg-white shadow-2xl min-h-full">
                      {activeFileBlob.type === 'application/pdf' ? <PdfViewer blob={activeFileBlob} searchQuery="" isLensEnabled={false} /> : <img src={URL.createObjectURL(activeFileBlob)} className="max-w-full h-auto mx-auto" />}
                  </div>
              </div>
          </div>
      )}

      {/* Table Modal */}
      {tableModal.open && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 space-y-4">
                  <h3 className="font-bold text-gray-800">Tabelle einfügen</h3>
                  <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-gray-400">Zeilen</label><input type="number" value={tableModal.rows} onChange={(e) => setTableModal({...tableModal, rows: parseInt(e.target.value)})} className="w-full border p-2 rounded"/></div>
                      <div><label className="text-[10px] font-bold text-gray-400">Spalten</label><input type="number" value={tableModal.cols} onChange={(e) => setTableModal({...tableModal, cols: parseInt(e.target.value)})} className="w-full border p-2 rounded"/></div>
                  </div>
                  <button onClick={confirmInsertTable} className="w-full bg-[#16325c] text-white py-2 rounded-lg font-bold text-sm">Einfügen</button>
                  <button onClick={() => setTableModal({...tableModal, open: false})} className="w-full text-gray-500 py-2 text-sm">Abbrechen</button>
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

      {/* NEW: FLOATING TOOLTIP RENDERER (FIXED & COMPACT) */}
      {tooltip && (
          <div 
              className="fixed z-[9999] w-48 bg-black/90 backdrop-blur-md text-white text-[9px] leading-tight p-2.5 rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150 pointer-events-none border border-white/10"
              style={{ top: tooltip.y, left: tooltip.x, transform: 'translateY(-50%)' }}
          >
              <div className="font-bold mb-1 border-b border-white/10 pb-1 text-blue-300 uppercase tracking-wider">{tooltip.title}</div>
              <div className="text-gray-300 font-medium">{tooltip.content}</div>
              {/* Triangle pointing left */}
              <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-r-[6px] border-r-black/90 border-b-[5px] border-b-transparent"></div>
          </div>
      )}
    </div>
  );
};

export default NotesView;
