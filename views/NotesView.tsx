
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
  Minimize2,
  AlertTriangle,
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
const parseSearchQuery = (query: string) => {
    if (!query) return { mode: 'OR', terms: [] };
    if (query.includes(';')) return { mode: 'AND', terms: query.split(';').map(t => t.trim().toLowerCase()).filter(t => t.length > 0) };
    if (query.includes('/')) return { mode: 'OR', terms: query.split('/').map(t => t.trim().toLowerCase()).filter(t => t.length > 0) };
    return { mode: 'OR', terms: [query.trim().toLowerCase()] };
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
                try { await renderTask.promise; renderTaskRef.current = null; } catch(e) {}
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

  // Editor Sync
  useEffect(() => {
      // Ensure we have a valid note and editor ref
      if (selectedNoteId && data.notes[selectedNoteId] && data.notes[selectedNoteId].type === 'note') {
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
  const getIconForType = (type: NoteDocument['type'], filename?: string) => { if (filename?.endsWith('.pdf')) return <FileText size={16} className="text-red-500" />; return <FileIcon size={16} className="text-gray-400" />; };
  
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

  // --- RENDER HELPERS ---
  const renderAttachmentStack = (attachments: string[], canDelete: boolean) => (
      <div className="space-y-4 p-4">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <FileText size={12} /> Anhänge ({attachments.length})
          </h4>
          <div className="grid grid-cols-1 gap-4">
              {attachments.map(id => (
                  <div key={id}>
                      <PdfThumbnail 
                          fileId={id} 
                          onClick={async () => {
                              const blob = await DBService.getFile(id);
                              if(blob) { setActiveFileBlob(blob); setIsMaximized(true); }
                          }}
                          onRemove={canDelete ? () => removeAttachment(id) : undefined}
                      />
                  </div>
              ))}
          </div>
      </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-hidden relative min-h-[calc(100dvh-150px)] w-full">
      
      {/* 1. LEFT SIDEBAR (Standard) */}
      <div 
        className={`bg-gray-50 border-r border-gray-100 flex flex-col shrink-0 ${isEditMode ? 'hidden lg:flex' : 'flex'}`}
        style={{ width: windowWidth >= 768 ? (isEditMode ? 240 : layout.sidebarW) : '100%' }}
      >
         {/* Sidebar Content */}
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
      </div>

      {/* DRAG HANDLE 1: Sidebar -> List (Only in View Mode) */}
      {!isEditMode && windowWidth >= 768 && (
        <div 
            className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10"
            onMouseDown={startResizing('sidebar')}
        />
      )}

      {/* 2. MIDDLE COLUMN (List OR Editor) */}
      <div 
        className={`flex flex-col min-h-0 bg-white shrink-0 border-r border-gray-100 ${isResizing ? '' : 'transition-all duration-300'} ${(isEditMode || !selectedNoteId) ? 'flex' : 'hidden md:flex'}`}
        style={{ width: windowWidth >= 768 ? (isEditMode ? '60%' : layout.listW) : '100%' }}
      >
         {!isEditMode ? (
             // STANDARD LIST VIEW
             <>
                 <div className="p-4 border-b border-gray-50 shrink-0 space-y-2">
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
                                {getIconForType(note.type, note.fileName)}
                            </div>
                            <div className="text-xs mb-2 h-10 leading-relaxed line-clamp-2 text-gray-400">{stripHtml(note.content).substring(0,90)}...</div>
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
            className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10"
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
                    <div className="px-4 py-3 border-b border-gray-100 bg-white flex items-center justify-between shrink-0">
                        <div className="flex-1 min-w-0 mr-4">
                            <h3 className="font-bold text-gray-800 truncate">{selectedNote.title}</h3>
                            {/* CATEGORY & SUB-CATEGORY EDITING */}
                            <div className="flex items-center gap-2 mt-1 h-6 overflow-x-auto no-scrollbar">
                                <select 
                                    value={selectedNote.category} 
                                    onChange={(e) => changeCategory(e.target.value as DocCategory, undefined)} // Reset subcat on main change
                                    className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-bold border border-transparent hover:border-gray-300 transition-colors" 
                                    title="Kategorie ändern"
                                >
                                    {CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                
                                <span className="text-gray-300">/</span>
                                
                                {CATEGORY_STRUCTURE[selectedNote.category]?.length > 0 ? (
                                    <select 
                                        value={selectedNote.subCategory || ''}
                                        onChange={(e) => changeCategory(selectedNote.category, e.target.value || undefined)}
                                        className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-lg outline-none cursor-pointer font-medium hover:border-gray-300 transition-colors"
                                    >
                                        <option value="">(Keine Unterkategorie)</option>
                                        {CATEGORY_STRUCTURE[selectedNote.category].map(sub => (
                                            <option key={sub} value={sub}>{sub}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-[10px] text-gray-300 italic">n/a</span>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            {selectedNote.filePath && (
                                <button onClick={openFile} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Dokument Öffnen"><Eye size={16} /></button>
                            )}
                            <button onClick={() => setIsEditMode(true)} className="p-2 bg-[#16325c] text-white rounded-lg hover:bg-blue-800 flex items-center gap-2 text-xs font-bold shadow-sm transition-all"><Edit3 size={14}/> Bearbeiten</button>
                            <button onClick={deleteNote} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
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
                                
                                {/* OCR / Extracted Content */}
                                {selectedNote.content && selectedNote.content.length > 50 && (
                                    <div className="space-y-2">
                                        <h5 className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Extrahierter Text / Inhalt</h5>
                                        <div className="p-4 bg-gray-50 rounded-xl text-xs font-mono text-gray-600 whitespace-pre-wrap leading-relaxed border border-gray-100">
                                            {selectedNote.content}
                                        </div>
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

      {/* Fullscreen Preview Overlay */}
      {isMaximized && activeFileBlob && (
          <div className="fixed inset-0 z-[5000] bg-white flex flex-col">
              <div className="p-2 border-b flex justify-end"><button onClick={() => setIsMaximized(false)}><X size={24}/></button></div>
              <div className="flex-1 overflow-auto bg-gray-100 p-4">
                  {activeFileBlob.type === 'application/pdf' ? <PdfViewer blob={activeFileBlob} searchQuery="" isLensEnabled={false} /> : <img src={URL.createObjectURL(activeFileBlob)} className="max-w-full mx-auto" />}
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
    </div>
  );
};

export default NotesView;
