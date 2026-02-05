
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Lade Environment Variablen basierend auf dem Modus (z.B. .env)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    // WICHTIG: './' sorgt dafür, dass die App relativ zum aktuellen Ordner lädt.
    base: './',
    // Wir entfernen die harte Injektion des Keys, damit er nicht im Build landet.
    // Der Key wird nun zur Laufzeit vom User abgefragt.
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
      esbuildOptions: {
        // Dies behebt den Fehler im Development Modus
        target: 'esnext'
      }
    },
    server: {
      port: 3000
    }
  }
})
