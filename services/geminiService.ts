
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
import { CATEGORY_STRUCTURE, EXPENSE_CATEGORIES } from "../types";

// Set Worker for PDF to Image conversion
// @ts-ignore
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
}

// Response Interface based on Schema
export interface ScannedReceipt {
  amount: number;
  currency: string;
  date: string;
  category: string;
  description: string;
  isMonthlySummary: boolean;
}

export interface AnalyzedDocument {
  title: string;
  summary: string;
  category: string;
  subCategory?: string;
  date: string;
  isTaxRelevant: boolean;
  taxData?: {
    amount: number;
    currency: string;
    taxCategory: string;
  };
  dailyExpenseData?: {
      isExpense: boolean;
      merchant: string;
      location: string;
      expenseCategory: string;
      amount: number;
      currency: string;
      items?: string[]; // NEW
  };
  paymentDetails?: {
    recipientName?: string;
    payerName?: string;
    iban?: string;
    reference?: string;
    dueDate?: string;
  };
  aiReasoning: string;
}

export class GeminiService {
  
  private static getApiKey(): string | null {
      return localStorage.getItem('tatdma_api_key') || (typeof process !== 'undefined' && process.env ? process.env.API_KEY : null) || null;
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // The result usually looks like "data:image/jpeg;base64,..."
        // If file.type was empty, it might be "data:base64,..." or similar depending on browser.
        // We always want the part AFTER the comma.
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }

  // Helper to determine MIME type if file.type is empty (common with HEIC on some browsers)
  private static getMimeType(file: File): string {
      if (file.type) return file.type;
      
      const ext = file.name.split('.').pop()?.toLowerCase();
      switch (ext) {
          case 'heic': return 'image/heic';
          case 'heif': return 'image/heif';
          case 'jpg':
          case 'jpeg': return 'image/jpeg';
          case 'png': return 'image/png';
          case 'webp': return 'image/webp';
          case 'pdf': return 'application/pdf';
          default: return 'application/octet-stream';
      }
  }

  // NEW: Convert first page of PDF to High-Res Image Base64
  // This forces Gemini to use Vision capabilities instead of relying on broken PDF text layers.
  private static async pdfToImageBase64(file: File): Promise<string> {
      try {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1); // Get first page

          // Scale up for better OCR/Vision resolution (2.0 is usually enough, 3.0 is safer)
          const viewport = page.getViewport({ scale: 2.5 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          
          if (!context) throw new Error("Canvas context not available");

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          // @ts-ignore
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          return dataUrl.split(',')[1];
      } catch (e) {
          console.error("PDF-to-Image conversion failed", e);
          throw e;
      }
  }

  // Legacy method for single receipt scan in TaxView (updated to use vision logic)
  static async analyzeReceipt(file: File): Promise<ScannedReceipt | null> {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) throw new Error("API Key fehlt! Bitte in den Systemeinstellungen hinterlegen.");

      const ai = new GoogleGenAI({ apiKey });
      
      let base64Data: string;
      let mimeType = this.getMimeType(file);

      // Force Vision Mode for PDFs
      if (mimeType === 'application/pdf') {
          try {
              base64Data = await this.pdfToImageBase64(file);
              mimeType = 'image/jpeg'; // Trick AI into treating it as an image
          } catch (e) {
              // Fallback
              base64Data = await this.fileToBase64(file);
          }
      } else {
          base64Data = await this.fileToBase64(file);
      }

      const schema = {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER, description: "Total amount on the receipt. If monthly is shown, calculate yearly." },
          currency: { type: Type.STRING, description: "CHF, USD, or EUR" },
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          category: { 
            type: Type.STRING, 
            enum: ['Berufsauslagen', 'Weiterbildung', 'Alimente', 'Kindesunterhalt', 'Hardware/Büro', 'Versicherung', 'Krankenkassenprämien', 'Sonstiges']
          },
          description: { type: Type.STRING },
          isMonthlySummary: { type: Type.BOOLEAN }
        },
        required: ["amount", "currency", "category", "description"],
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', 
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: `Analyze this image visually. Extract exact total amount.` }
          ]
        },
        config: { responseMimeType: "application/json", responseSchema: schema }
      });

      const text = response.text;
      if (!text) return null;
      return JSON.parse(text) as ScannedReceipt;

    } catch (error) {
      console.error("Gemini Analysis Failed:", error);
      throw error;
    }
  }

  // MAIN ANALYSIS FUNCTION
  static async analyzeDocument(file: File): Promise<AnalyzedDocument | null> {
    try {
      const apiKey = this.getApiKey();
      
      if (!apiKey) {
          console.warn("ABORTING: No API Key found.");
          return null; 
      }

      const ai = new GoogleGenAI({ apiKey });
      
      let base64Data: string;
      let mimeType = this.getMimeType(file);
      
      console.log(`Gemini Scan Start. File: ${file.name}, Detected MIME: ${mimeType}`);

      // 1. VISION BRIDGE: Convert PDF to Image to force Vision Model
      if (mimeType === 'application/pdf') {
          console.log("Converting PDF to Image for Vision Analysis...");
          try {
              base64Data = await this.pdfToImageBase64(file);
              mimeType = 'image/jpeg'; // Sending as Image!
          } catch (e) {
              console.warn("PDF conversion failed, using raw PDF", e);
              base64Data = await this.fileToBase64(file);
          }
      } else {
          base64Data = await this.fileToBase64(file);
      }
      
      const structureContext = Object.entries(CATEGORY_STRUCTURE).map(([cat, subs]) => {
          return `- ${cat}: [${subs.join(', ')}]`;
      }).join('\n');

      const schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Short title." },
          summary: { type: Type.STRING, description: "Short summary." },
          category: { type: Type.STRING, enum: Object.keys(CATEGORY_STRUCTURE) },
          subCategory: { type: Type.STRING },
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          isTaxRelevant: { type: Type.BOOLEAN },
          aiReasoning: { type: Type.STRING },
          
          taxData: {
            type: Type.OBJECT,
            properties: {
              amount: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              taxCategory: { type: Type.STRING, enum: ['Berufsauslagen', 'Weiterbildung', 'Alimente', 'Kindesunterhalt', 'Hardware/Büro', 'Versicherung', 'Krankenkassenprämien', 'Sonstiges'] }
            },
            nullable: true
          },

          // AGGRESSIVE EXPENSE EXTRACTION
          dailyExpenseData: {
              type: Type.OBJECT,
              properties: {
                  isExpense: { type: Type.BOOLEAN, description: "TRUE if this is ANY kind of cost, purchase, ticket, restaurant, shop, invoice, fee or bill." },
                  merchant: { type: Type.STRING, description: "Vendor Name (e.g. Coop, Migros, SBB, Netflix, Restaurant Name)." },
                  location: { type: Type.STRING, description: "City/Location if visible." },
                  amount: { type: Type.NUMBER, description: "The TOTAL amount paid." },
                  currency: { type: Type.STRING },
                  expenseCategory: { type: Type.STRING, enum: EXPENSE_CATEGORIES },
                  items: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING },
                      description: "List of specific items purchased (e.g. 'Milk', 'Bread', 'Chicken'). Only for shopping/groceries." 
                  }
              },
              nullable: true
          },

          paymentDetails: {
            type: Type.OBJECT,
            properties: {
                recipientName: { type: Type.STRING, nullable: true },
                payerName: { type: Type.STRING, nullable: true },
                iban: { type: Type.STRING, nullable: true },
                reference: { type: Type.STRING, nullable: true },
                dueDate: { type: Type.STRING, nullable: true }
            },
            nullable: true
          }
        },
        required: ["title", "summary", "category", "date", "isTaxRelevant", "aiReasoning"]
      };

      const prompt = `
      Perform a VISUAL ANALYSIS of this document. It might be an image or a scanned PDF.
      
      TASK: IDENTIFY EXPENSES
      Look for ANY prices, totals, receipts, invoices, or payment confirmations.
      If you see a price and a merchant/vendor:
      1. Set 'dailyExpenseData.isExpense' to TRUE.
      2. Extract the 'merchant' (e.g. Coop, SBB, Apple, Restaurant XYZ).
      3. Extract the 'amount' (Endbetrag / Total).
      4. Categorize into: Verpflegung, Mobilität, Haushalt, Freizeit, Shopping, Gesundheit, Wohnen, Reisen, Sonstiges.
      5. IF IT IS A SHOPPING RECEIPT: Extract the specific items purchased into 'dailyExpenseData.items'.
      
      TASK: CLASSIFY
      Assign a main category from the provided list.
      Structure:
      ${structureContext}
      
      Important: 
      - If it is a receipt (Quittung), extracting the expense data AND ITEMS is the HIGHEST priority.
      - Ignore bad OCR text layers; trust your vision model (pixels) for numbers and names.
      - Date format: YYYY-MM-DD.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: mimeType, data: base64Data } },
            { text: prompt }
          ]
        },
        config: { responseMimeType: "application/json", responseSchema: schema }
      });

      console.log("Gemini Vision Response:", response.text);

      if (!response.text) return null;
      return JSON.parse(response.text) as AnalyzedDocument;

    } catch (e) {
      console.error("Gemini Doc Analysis Error:", e);
      return null;
    }
  }
}
