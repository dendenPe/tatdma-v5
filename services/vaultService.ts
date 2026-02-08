
import { DBService } from './dbService';

export class VaultService {
  private static dirHandle: FileSystemDirectoryHandle | null = null;

  // Check if browser supports File System Access API (Desktop Chrome/Edge/Opera)
  // iOS Safari and Android Chrome generally DO NOT support this yet.
  static isSupported(): boolean {
    return 'showDirectoryPicker' in window;
  }

  static async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      alert("Dein Browser (z.B. iPhone/iPad) unterstützt den direkten Ordner-Zugriff nicht. Die App läuft im 'Lokal-Modus'. Daten bleiben im Browser-Speicher.");
      return false;
    }

    try {
      // @ts-ignore - window.showDirectoryPicker is not yet in standard TS types
      this.dirHandle = await window.showDirectoryPicker();
      await DBService.saveSetting('vaultHandle', this.dirHandle);
      return true;
    } catch (e) {
      console.error("Vault Connect Error:", e);
      return false;
    }
  }

  static async init(): Promise<boolean> {
    if (!this.isSupported()) return false;

    const handle = await DBService.getSetting('vaultHandle');
    if (handle) {
      this.dirHandle = handle;
      try {
        // @ts-ignore
        const perm = await this.dirHandle!.queryPermission({ mode: 'readwrite' });
        return perm === 'granted';
      } catch (e) {
        console.warn("Permission check failed", e);
        return false;
      }
    }
    return false;
  }

  // Neue Methode für den Auto-Scan Check
  static async verifyPermission(): Promise<boolean> {
    if (!this.dirHandle) return false;
    try {
        // @ts-ignore
        const perm = await this.dirHandle.queryPermission({ mode: 'readwrite' });
        return perm === 'granted';
    } catch {
        return false;
    }
  }

  static async requestPermission(): Promise<boolean> {
    if (!this.dirHandle) return false;
    // @ts-ignore
    const perm = await this.dirHandle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }

  static isConnected() {
    return !!this.dirHandle;
  }

  // Exposed for DocumentService
  static getDirHandle() {
      return this.dirHandle;
  }

  static async writeFile(filename: string, content: Blob | string) {
    if (!this.dirHandle) throw new Error("Vault nicht verbunden");
    
    // @ts-ignore
    const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true });
    // @ts-ignore
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}
