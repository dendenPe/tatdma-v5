
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Lade Environment Variablen basierend auf dem Modus (z.B. .env)
  // Fix: Cast process to any to access cwd() which might not be typed in frontend tsconfig
  const env = loadEnv(mode, (process as any).cwd(), '');

  // Base Path Logik:
  // Im Development ('serve') nutzen wir Root '/', damit localhost:3000 funktioniert.
  // Im Build ('build') nutzen wir das Unterverzeichnis für GitHub Pages.
  const base = command === 'serve' ? '/' : '/tatdma-v5/';

  return {
    plugins: [react()],
    base: base,
    define: {
      // 'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY), // REMOVED FOR SECURITY
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // pdfjs-dist benötigt 'esnext' oder mindestens 'es2022' für top-level await Support
      target: 'esnext'
    },
    optimizeDeps: {
      include: [
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/extension-table',
        '@tiptap/extension-table-row',
        '@tiptap/extension-table-cell',
        '@tiptap/extension-table-header',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-underline',
        '@tiptap/extension-text-style',
        '@tiptap/extension-color',
        '@tiptap/extension-text-align',
        '@tiptap/extension-font-family',
        '@tiptap/extension-highlight',
        '@tiptap/extension-task-item',
        '@tiptap/extension-task-list',
        '@tiptap/extension-subscript',
        '@tiptap/extension-superscript'
      ],
      esbuildOptions: {
        // Dies behebt den Fehler im Development Modus
        target: 'esnext'
      }
    },
    server: {
      port: 3000,
      open: true
    }
  }
})