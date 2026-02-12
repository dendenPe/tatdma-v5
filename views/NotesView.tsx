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
  Edit3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Type,
  CheckSquare,
  Highlighter,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Columns,
  Rows,
  Trash,
  Combine,
  Split,
  Search as SearchIcon
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// TIPTAP IMPORTS
import { useEditor, EditorContent, Extension } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Underline as TiptapUnderline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontFamily } from '@tiptap/extension-font-family';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';

import { AppData, NoteDocument, DocCategory, CATEGORY_STRUCTURE, TaxExpense } from '../types';
import { DocumentService } from '../services/documentService';
import { VaultService } from '../services/vaultService';
import { DBService } from '../services/dbService';
import { GeminiService } from '../services/geminiService';

// Ensure worker is set to specific version matching package.json
// @ts-ignore
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';
}

interface Props {
  data: AppData;
  onUpdate: (data: AppData) => void;
  isVaultConnected?: boolean;
}

const CATEGORY_KEYS = Object.keys(CATEGORY_STRUCTURE);

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

// --- CUSTOM FONT SIZE EXTENSION ---
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize.replace(/['"]+/g, ''),
          renderHTML: attributes => {
            if (!attributes.fontSize) return {};
            return { style: `font-size: ${attributes.fontSize}` };
          },
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize: null }).run();
      },
    }
  },
});

const stripHtml = (html: string) => {
   const tmp = document.createElement("DIV");
   tmp.innerHTML = html;
   return tmp.textContent || tmp.innerText || "";
};

const parseSearchQuery = (query: string): { mode: 'AND' | 'OR', terms: string[] } => {
    const raw = query.toLowerCase();
    if (raw.includes(';')) {
        return { mode: 'AND', terms: raw.split(';').map(t => t.trim()).filter(t => t.length > 0) };
    }
    if (raw.includes('/')) {
        return { mode: 'OR', terms: raw.split('/').map(t => t.trim()).filter(t => t.length > 0) };
    }
    return { mode: 'AND', terms: raw.split(/\s+/).filter(t => t.trim().length > 0) };
};

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
                        // @ts-ignore
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
                // @ts-ignore
                const renderTask = page.render({ canvasContext: context, transform, viewport } as any);
                renderTaskRef.current = renderTask;

                try {
                    await renderTask.promise;
                    renderTaskRef.current = null;

                    if (searchQuery && searchQuery.length > 2) {
                        const textContent = await page.getTextContent();
                        const terms = parseSearchQuery(searchQuery).terms;
                        context.save();
                        context.scale(outputScale, outputScale);
                        textContent.items.forEach((item: any) => {
                            if (terms.some(t => item.str.toLowerCase().includes(t))) {
                                const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                                const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                                context.fillStyle = 'rgba(255, 255, 0, 0.4)';
                                context.fillRect(tx[4], tx[5] - fontHeight * 0.8, item.width * scale, fontHeight);
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

const PdfViewer = ({ blob, searchQuery, isLensEnabled, isFullHeight }: { blob: Blob, searchQuery: string, isLensEnabled: boolean, isFullHeight?: boolean }) => {
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
                // Load first 5 pages for performance
                for (let i = 1; i <= Math.min(loadedPdf.numPages, 5); i++) loadedPages.push(await loadedPdf.getPage(i));
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
        <div ref={containerRef} className={`w-full bg-gray-100 rounded-lg p-2 overflow-y-auto text-center ${isFullHeight ? 'h-full' : 'max-h-[calc(100vh-250px)]'}`}>
            {pages.map((page, idx) => (<PdfPage key={idx} page={page} scale={scale} searchQuery={searchQuery} isLensEnabled={isLensEnabled} />))}
            {pdf.numPages > 5 && <div className="text-gray-400 text-xs py-2">... {pdf.numPages - 5} weitere Seiten (Download zum Ansehen)</div>}
        </div>
    );
};

const NotesView: React.FC<Props> = ({ data, onUpdate, isVaultConnected }) => {
  const [selectedCat, setSelectedCat] = useState<string | 'All'>('All');
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
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
  const [shareModalData, setShareModalData] = useState<{url: string, filename: string} | null>(null);
  
  // Table Modal State
  const [tableModal, setTableModal] = useState<{open: boolean, rows: number, cols: number}>({ open: false, rows: 3, cols: 3 });
  
  // NEW: Search & Replace State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [editorSearchQuery, setEditorSearchQuery] = useState('');
  
  // NEW: Buffered User Note Input for Debouncing
  const [userNoteInput, setUserNoteInput] = useState('');

  const lastNoteIdRef = useRef<string | null>(null);
  const mobileImportInputRef = useRef<HTMLInputElement>(null);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
      const handleResize = () => setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          setLayout(prev => ({ ...prev, listW: Math.max(250, Math.min(1000, resizeRef.current!.startListW + delta)) }));
      }
  }, [isResizing]);
  const handleGlobalMouseUp = useCallback(() => { setIsResizing(null); resizeRef.current = null; document.body.style.cursor = ''; }, []);
  useEffect(() => {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => { window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

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
          if (mode === 'AND') {
              matchesSearch = terms.every(term => cleanContent.includes(term));
          } else {
              matchesSearch = terms.some(term => cleanContent.includes(term));
          }
      }
      return matchesMainCat && matchesSubCat && matchesSearch;
    });
  }, [notesList, selectedCat, selectedSubCat, searchQuery]);

  const selectedNote = selectedNoteId ? data.notes?.[selectedNoteId] : null;

  // Sync user note input buffer when selection changes
  useEffect(() => {
      if (selectedNoteId && data.notes[selectedNoteId]) {
          setUserNoteInput(data.notes[selectedNoteId].userNote || '');
      }
  }, [selectedNoteId]);

  // Debounced Auto-Save for User Note
  useEffect(() => {
      if (!selectedNoteId) return;
      
      // Prevent unnecessary updates/cycles
      const currentStored = data.notes[selectedNoteId]?.userNote || '';
      if (userNoteInput === currentStored) return;

      const timer = setTimeout(() => {
          updateSelectedNote({ userNote: userNoteInput });
      }, 1000); // 1s debounce to prevent mobile keyboard glitches

      return () => clearTimeout(timer);
  }, [userNoteInput, selectedNoteId]);

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

  const updateSelectedNote = (updates: Partial<NoteDocument>) => {
      if (!selectedNoteId) return;
      const updatedNote = { ...data.notes[selectedNoteId], ...updates };
      onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: updatedNote } });
  };

  const addAttachment = async (blob: Blob) => {
      if (!selectedNoteId) return;
      const fileId = `att_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await DBService.saveFile(fileId, blob);
      const currentAttachments = data.notes[selectedNoteId].attachments || [];
      updateSelectedNote({ attachments: [...currentAttachments, fileId] });
  };

  // --- TIPTAP EDITOR SETUP ---
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'image'],
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({
          inline: true,
          allowBase64: true,
      }),
      Link.configure({
        openOnClick: true,
      }),
      TiptapUnderline,
      FontFamily,
      Highlight,
      TaskItem.configure({ nested: true }),
      TaskList,
      Subscript,
      Superscript,
      FontSize
    ],
    content: '<p></p>',
    onUpdate: ({ editor }) => {
        if(selectedNoteId) {
            updateSelectedNote({ content: editor.getHTML() });
        }
    },
    editorProps: {
        attributes: {
            class: 'prose max-w-none focus:outline-none min-h-[200px] tiptap-content p-4',
            spellcheck: 'true'
        },
        handlePaste: (view, event, slice) => {
            const items = Array.from(event.clipboardData?.items || []);
            for (const item of items) {
                if (item.type.indexOf("image") === 0) {
                    const file = item.getAsFile();
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (readerEvent) => {
                            const node = view.state.schema.nodes.image.create({
                                src: readerEvent.target?.result
                            });
                            const transaction = view.state.tr.replaceSelectionWith(node);
                            view.dispatch(transaction);
                        };
                        reader.readAsDataURL(file);
                        return true; // Handled
                    }
                }
            }
            return false;
        },
        handleDrop: (view, event, slice, moved) => {
            if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                const files = Array.from(event.dataTransfer.files);
                let handled = false;
                
                files.forEach(file => {
                    if (file.type === 'application/pdf') {
                        // PDF -> Sidebar Attachment
                        addAttachment(file);
                        handled = true;
                    } else if (file.type.startsWith('image/')) {
                        // Image -> Insert into Editor
                        const reader = new FileReader();
                        reader.onload = (readerEvent) => {
                            const node = view.state.schema.nodes.image.create({
                                src: readerEvent.target?.result
                            });
                            const transaction = view.state.tr.replaceSelectionWith(node);
                            view.dispatch(transaction);
                        };
                        reader.readAsDataURL(file);
                        handled = true;
                    }
                });
                return handled;
            }
            return false;
        }
    }
  });

  // Sync content when note changes
  useEffect(() => {
      if (editor && selectedNoteId && data.notes[selectedNoteId]) {
          const content = data.notes[selectedNoteId].content;
          // Prevent unnecessary re-renders if content is same (except focused typing)
          if (editor.getHTML() !== content) {
              // Only set content if we are switching notes or external update
              editor.commands.setContent(content);
          }
      }
  }, [selectedNoteId, editor]);

  // Search in Editor Logic
  const handleEditorSearch = (e: React.FormEvent) => {
      e.preventDefault();
      if (!editor || !editorSearchQuery) return;
      
      const json = editor.getJSON();
      alert("Tipp: Nutze Browser-Suche (Ctrl+F) für beste Ergebnisse in diesem Editor.");
  };

  const removeAttachment = (fileId: string) => {
      if (!selectedNoteId) return;
      const currentAttachments = data.notes[selectedNoteId].attachments || [];
      const newAttachments = currentAttachments.filter(id => id !== fileId);
      updateSelectedNote({ attachments: newAttachments });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => { 
      if (e.target.files?.[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
              if (e.target?.result && editor) {
                  editor.chain().focus().setImage({ src: e.target.result as string }).run();
              }
          };
          reader.readAsDataURL(file);
      }
  };

  const handleNativeShare = async () => {
      if (!activeFileBlob || !selectedNote) return;
      
      try {
          // 1. Convert Blob to File
          const fileName = selectedNote.fileName || `doc_${selectedNote.id}.pdf`;
          const mimeType = activeFileBlob.type || 'application/pdf';
          const file = new File([activeFileBlob], fileName, { type: mimeType });

          // 2. Check and Share using Navigator API
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                  files: [file],
                  title: selectedNote.title || 'Dokument',
                  text: selectedNote.title
              });
          } else {
              // Fallback for desktop browsers
              const url = URL.createObjectURL(activeFileBlob);
              setShareModalData({ url, filename: fileName });
          }
      } catch (e: any) {
          if (e.name !== 'AbortError') {
              console.error("Share failed", e);
              // Fallback
              const url = URL.createObjectURL(activeFileBlob);
              setShareModalData({ url, filename: selectedNote.fileName || 'doc.pdf' });
          }
      }
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
    setIsEditMode(true);
    if (selectedCat !== 'All' && selectedCat !== initialCat) setSelectedCat(initialCat);
  };

  const deleteNote = () => { if (!selectedNoteId) return; if (confirm("Löschen?")) { const newNotes = { ...data.notes }; delete newNotes[selectedNoteId]; onUpdate({ ...data, notes: newNotes }); setSelectedNoteId(null); setIsEditMode(false); } };
  const toggleCatExpanded = (cat: string) => { setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] })); };
  const getCategoryColor = (cat: string) => { if (cat === 'Inbox') return 'bg-purple-50 text-purple-600 border border-purple-100'; return 'bg-gray-50 text-gray-500 border border-gray-100'; };
  
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
    if (!VaultService.isConnected()) { alert("Verwende den 'Import' Button auf mobilen Geräten."); return; }
    const apiKey = localStorage.getItem('tatdma_api_key');
    if (!apiKey && useAI) { alert("ACHTUNG: Kein API Key gefunden."); return; }
    const hasPermission = await VaultService.verifyPermission();
    if (!hasPermission) await VaultService.requestPermission();
    
    setIsScanning(true);
    setScanMessage({ text: useAI ? "Analysiere Dokumente (AI)..." : "Synchronisiere Inbox...", type: 'info' });

    setTimeout(async () => {
        try {
            const result = await DocumentService.scanInbox(data.notes || {}, data.categoryRules || {}, useAI);
            if (result.movedCount > 0) {
                const newNotes = { ...(data.notes || {}) };
                result.newDocs.forEach(doc => { newNotes[doc.id] = doc; });
                onUpdate({ ...data, notes: newNotes });
                setScanMessage({ text: `${result.movedCount} Dateien importiert`, type: 'success' });
            } else {
                alert("Keine neuen Dateien.");
            }
        } catch (e: any) { alert("Fehler: " + e.message); } 
        finally { setIsScanning(false); setScanMessage(null); }
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

  const renderNotePreview = (content: string, query: string) => {
      const cleanContent = stripHtml(content).replace(/\s+/g, ' ').trim();
      const { terms } = parseSearchQuery(query);
      
      if (terms.length === 0) return <span className="text-gray-400">{cleanContent.substring(0, 90)}{cleanContent.length > 90 ? '...' : ''}</span>;
      
      // Find first occurrence of ANY term
      const lowerContent = cleanContent.toLowerCase();
      let firstIndex = -1;
      
      for (const term of terms) {
          const idx = lowerContent.indexOf(term);
          if (idx !== -1) {
              if (firstIndex === -1 || idx < firstIndex) firstIndex = idx;
          }
      }

      if (firstIndex === -1) return <span className="text-gray-400">{cleanContent.substring(0, 90)}...</span>;
      
      const padding = 35; 
      const start = Math.max(0, firstIndex - padding);
      const end = Math.min(cleanContent.length, firstIndex + 100);
      const snippet = cleanContent.substring(start, end);
      
      // Split by any of the terms to highlight
      const safeTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp(`(${safeTerms.join('|')})`, 'gi');
      
      const parts = snippet.split(regex);
      
      return (
          <span className="text-gray-500">
              {start > 0 && "..."}
              {parts.map((part, i) => 
                  terms.some(t => part.toLowerCase() === t) 
                  ? <span key={i} className="bg-yellow-200 text-gray-900 font-bold px-0.5 rounded box-decoration-clone">{part}</span> 
                  : part
              )}
              {end < cleanContent.length && "..."}
          </span>
      );
  };

  const handleReindex = async () => {
     if (!confirm("Re-Index?\n\nLiest alle Dateien im _ARCHIVE Ordner neu ein.")) return;
     if (!VaultService.isConnected()) return;
     setIsReindexing(true);
     try {
         const recoveredDocs = await DocumentService.rebuildIndexFromVault();
         const currentMap: Record<string, NoteDocument> = { ...(data.notes || {}) };
         recoveredDocs.forEach(doc => {
             const existingEntry = Object.entries(currentMap).find(([_, val]) => val.filePath === doc.filePath);
             if (!existingEntry) currentMap[doc.id] = doc;
         });
         onUpdate({ ...data, notes: currentMap });
         alert(`Index aktualisiert!`);
     } catch (e: any) { alert("Fehler: " + e.message); } finally { setIsReindexing(false); }
  };

  const handleReanalyzeContent = async () => {
      if (!selectedNoteId || !selectedNote) return;
      setIsReanalyzing(true);
      try {
          const apiKey = localStorage.getItem('tatdma_api_key');
          if (!apiKey) throw new Error("Kein API Key.");
          let fileBlob = await DBService.getFile(selectedNote.id);
          if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
          if (!fileBlob) throw new Error("Datei nicht gefunden.");
          const file = new File([fileBlob], selectedNote.fileName || 'doc', { type: fileBlob.type });
          const aiResult = await GeminiService.analyzeDocument(file);
          if (aiResult) {
              const newContent = selectedNote.content + `\n\nAI Summary: ${aiResult.summary}`;
              updateSelectedNote({ category: aiResult.category, subCategory: aiResult.subCategory, title: aiResult.title || selectedNote.title, content: newContent });
              alert(`Analyse fertig!\nKat: ${aiResult.category}`);
          }
      } catch (e: any) { alert("Fehler: " + e.message); } finally { setIsReanalyzing(false); }
  };

  const toggleTaxImport = async () => {
     if (!selectedNoteId || !selectedNote) return;
     if (selectedNote.taxRelevant) {
         updateSelectedNote({ taxRelevant: false });
         return;
     }
     setIsAnalyzingTax(true);
     try {
         const apiKey = localStorage.getItem('tatdma_api_key');
         if (!apiKey) throw new Error("Kein API Key.");
         let fileBlob = await DBService.getFile(selectedNote.id);
         if (!fileBlob && selectedNote.filePath && VaultService.isConnected()) fileBlob = await DocumentService.getFileFromVault(selectedNote.filePath);
         if (!fileBlob) throw new Error("Datei nicht gefunden.");
         const file = new File([fileBlob], selectedNote.fileName || 'beleg.pdf', { type: fileBlob.type });
         const aiResult = await GeminiService.analyzeDocument(file);
         if (aiResult && aiResult.taxData) {
             const newExpense: TaxExpense = {
                 id: `exp_${Date.now()}`,
                 noteRef: selectedNote.id,
                 desc: selectedNote.title,
                 amount: aiResult.taxData.amount,
                 year: selectedNote.year,
                 cat: aiResult.taxData.taxCategory as any,
                 currency: aiResult.taxData.currency,
                 rate: 1,
                 receipts: [],
                 taxRelevant: true
             };
             onUpdate({ ...data, notes: { ...data.notes, [selectedNoteId]: { ...selectedNote, taxRelevant: true } }, tax: { ...data.tax, expenses: [...data.tax.expenses, newExpense] } });
             alert(`Importiert: ${newExpense.amount} ${newExpense.currency}`);
         }
     } catch (e: any) { alert("Fehler: " + e.message); } finally { setIsAnalyzingTax(false); }
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

  const insertTable = () => {
      setTableModal({ open: true, rows: 3, cols: 3 });
  };

  const confirmInsertTable = () => {
      if (editor) {
          editor.chain().focus().insertTable({ 
              rows: tableModal.rows, 
              cols: tableModal.cols, 
              withHeaderRow: true 
          }).run();
      }
      setTableModal({ ...tableModal, open: false });
  };

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-hidden relative min-h-[calc(100dvh-150px)] w-full">
      {/* 1. SIDEBAR */}
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
         <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2 relative">
            {scanMessage && <div className={`absolute bottom-full left-4 right-4 mb-2 p-3 text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 z-20 bg-blue-600 text-white`}>{scanMessage.text}</div>}
            <button onClick={() => zipImportInputRef.current?.click()} className="w-full py-2.5 border border-purple-200 bg-purple-50 text-purple-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-purple-100 transition-all"><FileArchive size={14} /> ZIP Import</button>
            <div className="grid grid-cols-2 gap-2">
                <button onClick={() => handleScanInbox(false)} disabled={isScanning} className="w-full py-2.5 border border-gray-200 bg-white text-gray-600 rounded-xl font-bold text-[10px] flex items-center justify-center gap-1 hover:bg-gray-50 transition-all">{isScanning ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Standard Scan</button>
                <button onClick={() => handleScanInbox(true)} disabled={isScanning} className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-bold text-[10px] flex items-center justify-center gap-1 hover:shadow-lg transition-all">{isScanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Scan</button>
            </div>
         </div>
      </div>

      {/* DRAG HANDLE 1 */}
      {!isEditMode && windowWidth >= 768 && (
        <div className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10 hidden md:block" onMouseDown={startResizing('sidebar')} />
      )}

      {/* 2. MIDDLE COLUMN */}
      <div 
        className={`flex flex-col min-h-0 bg-white shrink-0 border-r border-gray-100 ${isResizing ? '' : 'transition-all duration-300'} ${(isEditMode || !selectedNoteId) ? 'flex' : 'hidden md:flex'}`}
        style={{ width: windowWidth >= 768 ? (isEditMode ? '60%' : layout.listW) : '100%' }}
      >
         {!isEditMode ? (
             <>
                 <div className="p-4 border-b border-gray-50 shrink-0 space-y-2">
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
             <div className="flex flex-col h-full bg-white relative">
                 {/* EDITOR TOOLBAR */}
                 <div className="flex flex-col border-b border-gray-100 bg-gray-50 shrink-0">
                    <div className="flex items-center gap-1 p-2 flex-wrap">
                        <button onClick={() => setIsEditMode(false)} className="p-1.5 hover:bg-gray-200 rounded text-gray-600 mr-2" title="Beenden"><ArrowLeft size={16}/></button>
                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        
                        {/* FONT FAMILY */}
                        <select onChange={(e) => editor?.chain().focus().setFontFamily(e.target.value).run()} className="bg-transparent text-xs font-bold text-gray-600 outline-none w-20">
                            <option value="Inter">Default</option>
                            <option value="serif">Serif</option>
                            <option value="monospace">Mono</option>
                            <option value="cursive">Cursive</option>
                        </select>

                        {/* FONT SIZE (H1-H3 + P) */}
                        <select onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'p') editor?.chain().focus().setParagraph().run();
                            else if (val.startsWith('h')) editor?.chain().focus().toggleHeading({ level: parseInt(val.replace('h', '')) as any }).run();
                            else editor?.chain().focus().setFontSize(val).run();
                        }} className="bg-transparent text-xs font-bold text-gray-600 outline-none w-16">
                            <option value="p">Text</option>
                            <option value="h1">H1</option>
                            <option value="h2">H2</option>
                            <option value="h3">H3</option>
                            <option value="12px">12px</option>
                            <option value="14px">14px</option>
                            <option value="18px">18px</option>
                            <option value="24px">24px</option>
                        </select>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>

                        {/* BASIC FORMATTING */}
                        <button onClick={() => editor?.chain().focus().toggleBold().run()} className={`p-1.5 rounded ${editor?.isActive('bold') ? 'bg-gray-200 text-black' : 'hover:bg-gray-100 text-gray-600'}`}><Bold size={14}/></button>
                        <button onClick={() => editor?.chain().focus().toggleItalic().run()} className={`p-1.5 rounded ${editor?.isActive('italic') ? 'bg-gray-200 text-black' : 'hover:bg-gray-100 text-gray-600'}`}><Italic size={14}/></button>
                        <button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={`p-1.5 rounded ${editor?.isActive('underline') ? 'bg-gray-200 text-black' : 'hover:bg-gray-100 text-gray-600'}`}><Underline size={14}/></button>
                        <button onClick={() => (editor?.chain().focus() as any).toggleHighlight().run()} className={`p-1.5 rounded ${editor?.isActive('highlight') ? 'bg-yellow-200 text-black' : 'hover:bg-gray-100 text-gray-600'}`}><Highlighter size={14}/></button>
                        
                        <div className="w-px h-4 bg-gray-300 mx-1"></div>

                        <button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`p-1.5 rounded ${editor?.isActive('bulletList') ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><List size={14}/></button>
                        <button onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={`p-1.5 rounded ${editor?.isActive('orderedList') ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><ListOrdered size={14}/></button>
                        <button onClick={() => editor?.chain().focus().toggleTaskList().run()} className={`p-1.5 rounded ${editor?.isActive('taskList') ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><CheckSquare size={14}/></button>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>

                        {/* ALIGNMENT */}
                        <button onClick={() => (editor?.chain().focus() as any).setTextAlign('left').run()} className={`p-1.5 rounded ${editor?.isActive({ textAlign: 'left' }) ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><AlignLeft size={14}/></button>
                        <button onClick={() => (editor?.chain().focus() as any).setTextAlign('center').run()} className={`p-1.5 rounded ${editor?.isActive({ textAlign: 'center' }) ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><AlignCenter size={14}/></button>
                        <button onClick={() => (editor?.chain().focus() as any).setTextAlign('right').run()} className={`p-1.5 rounded ${editor?.isActive({ textAlign: 'right' }) ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><AlignRight size={14}/></button>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        
                        {/* COLOR */}
                        <div className="relative group p-1.5 hover:bg-gray-200 rounded text-gray-600 cursor-pointer">
                            <Type size={14} style={{color: editor?.getAttributes('textStyle').color}} />
                            <input type="color" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()} />
                        </div>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        
                        {/* SUBSCRIPT / SUPERSCRIPT */}
                        <button onClick={() => (editor?.chain().focus() as any).toggleSubscript().run()} className={`p-1.5 rounded ${editor?.isActive('subscript') ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><SubIcon size={12}/></button>
                        <button onClick={() => (editor?.chain().focus() as any).toggleSuperscript().run()} className={`p-1.5 rounded ${editor?.isActive('superscript') ? 'bg-gray-200' : 'hover:bg-gray-100 text-gray-600'}`}><SupIcon size={12}/></button>

                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        
                        {/* INSERTS */}
                        <button onClick={insertTable} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><TableIcon size={14}/></button>
                        <label className="p-1.5 hover:bg-gray-200 rounded cursor-pointer text-gray-600"><ImagePlus size={14}/><input type="file" className="hidden" accept="image/*" onChange={handleImageUpload}/></label>
                        
                        <div className="w-px h-4 bg-gray-300 mx-1"></div>
                        
                        {/* SEARCH */}
                        <button onClick={() => { setIsSearchOpen(!isSearchOpen); }} className={`p-1.5 rounded ${isSearchOpen ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}><SearchIcon size={14}/></button>
                    </div>

                    {/* TABLE CONTEXT MENU */}
                    {editor && editor.isActive('table') && (
                        <div className="flex items-center gap-1 p-1 bg-blue-50 border-t border-blue-100 overflow-x-auto flex-nowrap animate-in slide-in-from-top-1">
                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-wider px-2">Tabelle:</span>
                            <button onClick={() => editor.chain().focus().addColumnBefore().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Columns size={12}/> +Links</button>
                            <button onClick={() => editor.chain().focus().addColumnAfter().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Columns size={12}/> +Rechts</button>
                            <button onClick={() => editor.chain().focus().deleteColumn().run()} className="p-1 hover:bg-red-100 rounded text-red-500 text-[10px] flex gap-1"><Trash size={12}/> Spalte</button>
                            <div className="w-px h-3 bg-blue-200 mx-1"></div>
                            <button onClick={() => editor.chain().focus().addRowBefore().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Rows size={12}/> +Oben</button>
                            <button onClick={() => editor.chain().focus().addRowAfter().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Rows size={12}/> +Unten</button>
                            <button onClick={() => editor.chain().focus().deleteRow().run()} className="p-1 hover:bg-red-100 rounded text-red-500 text-[10px] flex gap-1"><Trash size={12}/> Zeile</button>
                            <div className="w-px h-3 bg-blue-200 mx-1"></div>
                            <button onClick={() => editor.chain().focus().mergeCells().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Combine size={12}/> Merge</button>
                            <button onClick={() => editor.chain().focus().splitCell().run()} className="p-1 hover:bg-blue-100 rounded text-blue-600 text-[10px] flex gap-1"><Split size={12}/> Split</button>
                            <div className="flex-1"></div>
                            <button onClick={() => editor.chain().focus().deleteTable().run()} className="p-1 hover:bg-red-100 rounded text-red-600 text-[10px] font-bold flex gap-1 bg-white border border-red-100 shadow-sm"><X size={12}/> Tabelle Löschen</button>
                        </div>
                    )}

                    {/* SEARCH BAR */}
                    {isSearchOpen && (
                        <div className="flex items-center gap-2 p-2 bg-yellow-50 border-t border-yellow-100 animate-in slide-in-from-top-1">
                            <SearchIcon size={14} className="text-yellow-600"/>
                            <input 
                                type="text" 
                                placeholder="Suchen..." 
                                className="text-xs bg-white border border-yellow-200 rounded px-2 py-1 outline-none w-40 focus:ring-1 focus:ring-yellow-400"
                                onChange={(e) => {
                                    // Basic Highlight Search Simulation
                                    // Real "Find Next" requires complex traversing or external plugin not in core list.
                                    // We will alert user to use Browser Search for robustness.
                                }}
                                onKeyDown={(e) => {
                                    if(e.key === 'Enter') alert("Bitte benutze die Browser-Suche (Ctrl+F / Cmd+F) für zuverlässiges Finden & Ersetzen.");
                                }}
                            />
                            <button onClick={() => setIsSearchOpen(false)} className="text-yellow-600 hover:text-yellow-800"><X size={14}/></button>
                            <span className="text-[9px] text-yellow-600 ml-auto">Nutze Ctrl+F für beste Ergebnisse</span>
                        </div>
                    )}
                 </div>
                 
                 <div className="px-4 py-3 border-b border-gray-50">
                     <input type="text" value={selectedNote?.title || ''} onChange={(e) => updateSelectedNote({ title: e.target.value })} className="text-2xl font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300" placeholder="Titel..."/>
                 </div>

                 <EditorContent editor={editor} className="flex-1 p-8 overflow-y-auto" />
             </div>
         )}
      </div>

      {/* DRAG HANDLE 2 */}
      {!isEditMode && selectedNoteId && windowWidth >= 768 && (
        <div className="w-1 hover:w-2 bg-gray-100 hover:bg-blue-300 cursor-col-resize flex-shrink-0 transition-all z-10 hidden md:block" onMouseDown={startResizing('list')} />
      )}

      {/* 3. RIGHT COLUMN */}
      <div className={`flex-1 flex flex-col min-w-0 bg-gray-50/30 ${selectedNoteId && !isEditMode ? 'flex' : (isEditMode ? 'flex' : 'hidden md:flex')}`}>
         {selectedNote ? (
             isEditMode ? (
                 <div className="flex flex-col h-full bg-gray-50 border-l border-gray-100">
                     <div className="p-4 border-b border-gray-100 bg-white">
                         <h3 className="font-bold text-gray-700 text-sm">Anhänge verwalten</h3>
                         <p className="text-[10px] text-gray-400">PDFs hierher ziehen</p>
                     </div>
                     <div className="flex-1 overflow-y-auto p-4 space-y-4">
                         {selectedNote.attachments && selectedNote.attachments.length > 0 ? (
                             selectedNote.attachments.map(id => (
                                 <PdfThumbnail key={id} fileId={id} onClick={() => {}} onRemove={() => removeAttachment(id)} />
                             ))
                         ) : (
                             <div className="text-center py-10 text-gray-300 text-xs italic border-2 border-dashed border-gray-200 rounded-xl">Keine Anhänge</div>
                         )}
                     </div>
                 </div>
             ) : (
                 <>
                    <div className="px-4 py-3 border-b border-gray-100 bg-white shrink-0">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <button onClick={() => setSelectedNoteId(null)} className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full shrink-0"><ArrowLeft size={20} /></button>
                                    <input type="text" value={selectedNote.title} onChange={(e) => updateSelectedNote({ title: e.target.value })} className="text-lg font-black text-gray-800 bg-transparent outline-none w-full placeholder-gray-300 truncate" placeholder="Titel..."/>
                                </div>
                                <div className="flex items-center gap-1 md:gap-2 shrink-0">
                                    <button onClick={() => setIsLensEnabled(!isLensEnabled)} className={`hidden sm:flex p-1.5 rounded-lg transition-colors border items-center justify-center gap-1 shrink-0 ${isLensEnabled ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`}><ZoomIn size={16} /></button>
                                    <button onClick={handleReanalyzeContent} disabled={isReanalyzing} className={`hidden sm:flex p-1.5 rounded-lg transition-colors border items-center justify-center gap-1 bg-white border-gray-100 text-gray-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 shrink-0`}>{isReanalyzing ? <Loader2 size={16} className="animate-spin text-purple-500" /> : <BrainCircuit size={16} />}</button>
                                    {(selectedNote.type === 'pdf' || selectedNote.type === 'image') && activeFileBlob && (
                                        <button onClick={() => setIsMaximized(true)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors hidden md:block shrink-0"><Maximize2 size={16} /></button>
                                    )}
                                    {activeFileBlob && <button onClick={handleNativeShare} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors shrink-0"><Share2 size={16} /></button>}
                                    {selectedNote.filePath && <button onClick={openFile} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors shrink-0"><Eye size={16} /></button>}
                                    <button onClick={toggleTaxImport} disabled={isAnalyzingTax} className={`p-1.5 rounded-lg transition-colors border flex items-center justify-center gap-1 shrink-0 ${selectedNote.taxRelevant ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-gray-100 text-gray-300 hover:text-blue-500 hover:border-blue-100'}`}>{isAnalyzingTax ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Receipt size={16} />}</button>
                                    <button onClick={() => setIsEditMode(true)} className="p-1.5 bg-[#16325c] text-white rounded-lg hover:bg-blue-800 flex items-center gap-2 text-xs font-bold shadow-sm transition-all shrink-0"><Edit3 size={14}/> <span className="hidden sm:inline">Edit</span></button>
                                    <button onClick={deleteNote} className="p-1.5 text-gray-400 hover:text-red-500 shrink-0"><Trash2 size={16}/></button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
                                {selectedNote.taxRelevant && <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest whitespace-nowrap shrink-0">In Steuer importiert</span>}
                                <select value={selectedNote.category} onChange={(e) => changeCategory(e.target.value as DocCategory, undefined)} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-lg outline-none cursor-pointer font-bold border border-transparent hover:border-gray-300 transition-colors shrink-0">{CATEGORY_KEYS.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                <span className="text-gray-300 shrink-0">/</span>
                                {CATEGORY_STRUCTURE[selectedNote.category]?.length > 0 ? (
                                    <select value={selectedNote.subCategory || ''} onChange={(e) => changeCategory(selectedNote.category, e.target.value || undefined)} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded-lg outline-none cursor-pointer font-medium hover:border-gray-300 transition-colors shrink-0">
                                        <option value="">(Keine Unterkategorie)</option>
                                        {CATEGORY_STRUCTURE[selectedNote.category].map(sub => <option key={sub} value={sub}>{sub}</option>)}
                                    </select>
                                ) : <span className="text-[10px] text-gray-300 italic shrink-0">n/a</span>}
                                <div className="w-px h-3 bg-gray-200 mx-1 shrink-0"></div>
                                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-mono shrink-0">{selectedNote.year}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {selectedNote.type === 'note' ? (
                            <div className="prose max-w-none text-sm text-gray-700 tiptap-content" dangerouslySetInnerHTML={{ __html: selectedNote.content }} />
                        ) : (
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
                                <div className="mb-4">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-1"><StickyNote size={12} /> Eigene Notizen</label>
                                    <textarea value={userNoteInput} onChange={(e) => setUserNoteInput(e.target.value)} className="w-full p-2 bg-amber-50/50 border border-amber-100 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-amber-200 outline-none resize-y min-h-[60px] shadow-sm transition-all" placeholder="Notizen zum Dokument..."/>
                                </div>
                                {selectedNote.content && selectedNote.content.length > 50 && (
                                    <div className="space-y-2">
                                        <h5 className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Inhalt / Notizen</h5>
                                        <div className="p-4 bg-white rounded-xl text-sm text-gray-700 leading-relaxed border border-gray-200 shadow-sm overflow-x-auto prose max-w-none tiptap-content" dangerouslySetInnerHTML={{ __html: selectedNote.content }}/>
                                    </div>
                                )}
                            </div>
                        )}
                        {selectedNote.attachments && selectedNote.attachments.length > 0 && (
                            <div className="border-t border-gray-200 pt-6">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><FileText size={14} /> PDF Anhänge</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {selectedNote.attachments.map(id => (
                                        <PdfThumbnail key={id} fileId={id} onClick={async () => { const blob = await DBService.getFile(id); if(blob) { setActiveFileBlob(blob); setIsMaximized(true); } }}/>
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

      {shareModalData && (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200 relative text-center">
                  <button onClick={closeShareModal} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200"><X size={20} /></button>
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4"><Share2 size={32} /></div>
                  <h3 className="text-lg font-black text-gray-800 mb-2">Datei Bereit</h3>
                  <p className="text-xs text-gray-500 mb-6 bg-gray-50 p-2 rounded-lg break-all font-mono">{shareModalData.filename}</p>
                  <div className="space-y-3">
                      <a href={shareModalData.url} target="_blank" rel="noopener noreferrer" className="block w-full py-3 bg-[#16325c] text-white font-bold rounded-xl shadow-lg hover:bg-blue-800 transition-all active:scale-95 flex items-center justify-center gap-2" onClick={() => setTimeout(closeShareModal, 1000)}><Download size={18} /> Öffnen / Teilen</a>
                      <p className="text-[10px] text-gray-400">Öffnet die Datei in einem neuen Tab. Nutze dort den Browser-Share-Button.</p>
                  </div>
              </div>
          </div>
      )}

      {isMaximized && activeFileBlob && (
          <div className="fixed inset-0 z-[5000] bg-white flex flex-col animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-gray-700 truncate max-w-lg">{selectedNote?.title}</h3>
                  <button onClick={() => setIsMaximized(false)} className="p-2 hover:bg-gray-200 rounded-full bg-white shadow-sm transition-all"><Minimize2 size={24} /></button>
              </div>
              <div className="flex-1 overflow-auto bg-gray-100 p-4 flex justify-center">
                  <div className="w-full max-w-5xl bg-white shadow-2xl min-h-full">
                      {activeFileBlob.type === 'application/pdf' ? (
                          <PdfViewer blob={activeFileBlob} searchQuery="" isLensEnabled={false} isFullHeight={true} />
                      ) : (
                          <img src={URL.createObjectURL(activeFileBlob)} className="max-w-full h-auto mx-auto" />
                      )}
                  </div>
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

      {/* TABLE MODAL */}
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

      {tooltip && (
          <div 
              className="fixed z-[9999] w-48 bg-black/90 backdrop-blur-md text-white text-[9px] leading-tight p-2.5 rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150 pointer-events-none border border-white/10"
              style={{ top: tooltip.y, left: tooltip.x, transform: 'translateY(-50%)' }}
          >
              <div className="font-bold mb-1 border-b border-white/10 pb-1 text-blue-300 uppercase tracking-wider">{tooltip.title}</div>
              <div className="text-gray-300 font-medium">{tooltip.content}</div>
              <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-r-[6px] border-r-black/90 border-b-[5px] border-b-transparent"></div>
          </div>
      )}
    </div>
  );
};

export default NotesView;