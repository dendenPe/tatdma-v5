
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
import { CATEGORY_STRUCTURE, EXPENSE_CATEGORIES, PortfolioYear } from "../types";

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
      // Updated items to support objects
      items?: Array<{ name: string, price: number }>; 
  };
  salaryData?: {
      isSalary: boolean;
      month: string; // "01", "02", etc.
      year: string;
      netIncome: number;
      grossIncome: number;
      payout: number;
      ahv: number;
      alv: number;
      bvg: number;
      tax: number;
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
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }

  private static async fileToText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
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

  // --- RETRY HELPER ---
  private static async generateWithRetry(aiModel: any, params: any, retries = 3): Promise<any> {
      for (let attempt = 0; attempt <= retries; attempt++) {
          try {
              return await aiModel.generateContent(params);
          } catch (error: any) {
              const msg = error.message || '';
              // 503 = Service Unavailable, 429 = Too Many Requests
              if ((msg.includes('503') || msg.includes('429') || msg.includes('overloaded')) && attempt < retries) {
                  const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
                  console.warn(`Gemini API Busy (503/429). Retrying in ${delay}ms... (Attempt ${attempt + 1}/${retries})`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue;
              }
              throw error;
          }
      }
  }

  // --- AI ASSISTANT CHAT ---
  static async chatWithData(history: {role: 'user'|'model', text: string}[], contextData: any, userMessage: string): Promise<string> {
      try {
          const apiKey = this.getApiKey();
          if (!apiKey) throw new Error("API Key fehlt.");

          const ai = new GoogleGenAI({ apiKey });
          
          // Construct System Instruction
          const systemInstruction = `
          You are 'TaTDMA Assistant', a helpful financial AI for a personal finance app.
          
          Here is a summary of the user's current data (JSON):
          ${JSON.stringify(contextData, null, 2)}
          
          Your goal is to answer questions based STRICTLY on this data.
          - If the user asks about spending, look at 'expenses'.
          - If trading, look at 'trading'.
          - If net worth, look at 'netWorth'.
          - Be concise, friendly, and use bolding for numbers.
          - All currency is CHF unless specified.
          - If data is missing for a specific question, say so politely.
          `;

          const contents = history.map(h => ({
              role: h.role,
              parts: [{ text: h.text }]
          }));
          
          contents.push({ role: 'user', parts: [{ text: userMessage }] });

          const response = await this.generateWithRetry(ai.models, {
              model: 'gemini-3-flash-preview',
              contents: contents,
              config: {
                  systemInstruction: systemInstruction,
                  temperature: 0.7
              }
          });

          return response.text || "Keine Antwort generiert.";

      } catch (e: any) {
          console.error("Chat Error", e);
          return "Entschuldigung, ich konnte die Anfrage nicht verarbeiten. (API Fehler)";
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

      const response = await this.generateWithRetry(ai.models, {
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
                      items: { 
                          type: Type.OBJECT,
                          properties: {
                              name: { type: Type.STRING, description: "Name of the item (e.g. Milk)" },
                              price: { type: Type.NUMBER, description: "Single item price or total line price" }
                          }
                      },
                      description: "List of specific items purchased with their prices." 
                  }
              },
              nullable: true
          },

          salaryData: {
              type: Type.OBJECT,
              properties: {
                  isSalary: { type: Type.BOOLEAN, description: "TRUE if this is a Salary Slip (Lohnabrechnung) or Insurance Payout (Taggeld/Lohnausfall)." },
                  month: { type: Type.STRING, description: "Two digit month string e.g. '01', '02', '12'." },
                  year: { type: Type.STRING, description: "YYYY" },
                  netIncome: { type: Type.NUMBER, description: "Nettolohn or Net Payout" },
                  grossIncome: { type: Type.NUMBER, description: "Bruttolohn" },
                  payout: { type: Type.NUMBER, description: "Auszahlungsbetrag" },
                  ahv: { type: Type.NUMBER, description: "AHV/IV deduction (positive number)" },
                  alv: { type: Type.NUMBER, description: "ALV deduction (positive number)" },
                  bvg: { type: Type.NUMBER, description: "PK/BVG deduction (positive number)" },
                  tax: { type: Type.NUMBER, description: "Quellensteuer deduction (positive number)" }
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
      
      STEP 1: IDENTIFY DOCUMENT TYPE (INCOME vs EXPENSE)
      
      A) INCOME: Is this a Salary Slip (Lohnabrechnung), Bonus statement, or Loss of Earnings Insurance (Taggeldabrechnung / Lohnausfallversicherung / Versicherungsleistung)?
         -> If YES:
            - Set 'salaryData.isSalary' to TRUE.
            - Extract Month (format "01" to "12") and Year.
            - Extract Gross (Brutto) and Net (Netto/Auszahlung). 
            - If it's Insurance/Taggeld, usually there is only a Net Payout (Auszahlung) or a Daily Allowance amount. Treat this as Net/Payout.
            - Extract Deductions (AHV, ALV, BVG/PK, Quellensteuer) if present. If columns are missing, leave them as 0.
            - IMPORTANT: Do NOT categorize as 'Steuern & Abgaben' or 'Expenses'. Categorize as 'Beruf & Beschäftigung' or 'Versicherungen' (if Taggeld).
            - Set 'isTaxRelevant' to FALSE (It's income, not a tax deduction).
      
      B) EXPENSE: Is this a Bill, Receipt, Ticket, Invoice, or Purchase?
         -> If YES:
            - Set 'dailyExpenseData.isExpense' to TRUE.
            - Extract Merchant, Amount, Items.
            - If it's tax deductible (e.g. Weiterbildung, Krankenkasse, Berufsauslagen), set 'isTaxRelevant' to TRUE and fill 'taxData'.
      
      STEP 2: CLASSIFY
      Assign a main category from the provided list.
      Structure:
      ${structureContext}
      
      Important: 
      - Date format: YYYY-MM-DD.
      - Ignore bad OCR text layers; trust your vision model (pixels) for numbers and names.
      `;

      const response = await this.generateWithRetry(ai.models, {
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

  // --- NEW: SMART IBKR PORTFOLIO IMPORT ---
  static async analyzePortfolioCSV(file: File): Promise<PortfolioYear | null> {
      try {
          const apiKey = this.getApiKey();
          if (!apiKey) throw new Error("API Key fehlt!");

          const ai = new GoogleGenAI({ apiKey });
          const csvText = await this.fileToText(file);
          
          const schema = {
              type: Type.OBJECT,
              properties: {
                  positions: {
                      type: Type.ARRAY,
                      items: {
                          type: Type.OBJECT,
                          properties: {
                              symbol: { type: Type.STRING },
                              qty: { type: Type.NUMBER },
                              cost: { type: Type.NUMBER, description: "Cost Basis / Einstandskurs" },
                              close: { type: Type.NUMBER, description: "Market Price / Schlusskurs" },
                              val: { type: Type.NUMBER, description: "Market Value in Base Currency (usually USD)" },
                              unReal: { type: Type.NUMBER, description: "Unrealized PnL" },
                              real: { type: Type.NUMBER, description: "Realized PnL (from Performance section)" },
                              currency: { type: Type.STRING }
                          }
                      }
                  },
                  cash: {
                      type: Type.ARRAY,
                      items: {
                          type: Type.OBJECT,
                          properties: {
                              currency: { type: Type.STRING },
                              amount: { type: Type.NUMBER, description: "Ending Settled Cash / Endbarsaldo" }
                          }
                      }
                  },
                  summary: {
                      type: Type.OBJECT,
                      properties: {
                          totalValue: { type: Type.NUMBER, description: "Total Net Asset Value (Stocks only) in Base Currency" },
                          unrealized: { type: Type.NUMBER, description: "Total Unrealized PnL" },
                          realized: { type: Type.NUMBER, description: "Total Realized PnL from the period" },
                          dividends: { type: Type.NUMBER, description: "Total Dividends" },
                          tax: { type: Type.NUMBER, description: "Total Withholding Tax" }
                      }
                  },
                  exchangeRates: {
                      type: Type.ARRAY,
                      items: {
                          type: Type.OBJECT,
                          properties: {
                              pair: { type: Type.STRING, description: "Format: FROM_TO, e.g. USD_CHF" },
                              rate: { type: Type.NUMBER }
                          }
                      },
                      description: "Extract explicit exchange rates OR calculate them from 'Forex Positions' or 'Mark-to-Market' sections where you see a currency symbol and a close price in Base Currency."
                  }
              }
          };

          const prompt = `
          Analyze this Interactive Brokers (IBKR) CSV Activity Statement.
          Extract the Portfolio Snapshot data.
          
          CRITICAL FILTERING RULES:
          - IGNORE all "Futures" positions and "Futures" PnL.
          - IGNORE "Options" on Futures.
          - ONLY extract "Stocks" (Aktien), "Funds" (Fonds), and "ETFs".
          
          Sections to look for:
          1. "Open Positions" (Offene Positionen): Extract Stock/ETF positions (Symbol, Qty, Cost, Close, Value, Unrealized).
          2. "Cash Report" (Cash-Bericht): Extract Ending Settled Cash for each currency.
          3. "Realized & Unrealized Performance": Extract Realized PnL per symbol for STOCKS only. 
             - If a symbol is a Future (e.g. ES, NQ, CL), SKIP IT.
             - Do NOT include Futures PnL in the 'summary.realized' total.
          4. "Dividends" / "Withholding Tax": Sum up totals.
          5. "Exchange Rates" (Wechselkurse) OR "Forex Positions": 
             - I need rates to convert to/from the Base Currency (usually USD).
             - Return pairs like 'USD_CHF', 'EUR_USD'.
          
          Important:
          - Ignore Header/Footer lines.
          - 'real' PnL comes from the Realized Performance section.
          - 'val' is the Market Value at the end of the period.
          
          CSV CONTENT:
          ${csvText.substring(0, 100000)} 
          `;

          const response = await this.generateWithRetry(ai.models, {
              model: 'gemini-3-flash-preview',
              contents: { parts: [{ text: prompt }] },
              config: { responseMimeType: "application/json", responseSchema: schema }
          });

          if (!response.text) return null;
          const aiJson = JSON.parse(response.text);

          const result: PortfolioYear = {
              positions: {},
              cash: {},
              summary: {
                  totalValue: aiJson.summary?.totalValue || 0,
                  unrealized: aiJson.summary?.unrealized || 0,
                  realized: aiJson.summary?.realized || 0,
                  dividends: aiJson.summary?.dividends || 0,
                  tax: aiJson.summary?.tax || 0
              },
              lastUpdate: new Date().toISOString(),
              exchangeRates: {}
          };

          if (aiJson.positions) {
              aiJson.positions.forEach((p: any) => {
                  if (p.symbol) {
                      result.positions[p.symbol] = {
                          symbol: p.symbol,
                          qty: p.qty || 0,
                          cost: p.cost || 0,
                          close: p.close || 0,
                          val: p.val || 0,
                          unReal: p.unReal || 0,
                          real: p.real || 0,
                          currency: p.currency || 'USD'
                      };
                  }
              });
          }

          if (aiJson.cash) {
              aiJson.cash.forEach((c: any) => {
                  if (c.currency) result.cash[c.currency] = c.amount || 0;
              });
          }

          if (aiJson.exchangeRates) {
              aiJson.exchangeRates.forEach((r: any) => {
                  if (r.pair && r.rate) result.exchangeRates[r.pair] = r.rate;
              });
          }

          return result;

      } catch (e) {
          console.error("Smart IBKR Import Failed", e);
          throw e;
      }
  }
}
