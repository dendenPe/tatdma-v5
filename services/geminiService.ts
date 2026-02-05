

import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORY_STRUCTURE } from "../types";

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
  subCategory?: string; // New in v5a
  date: string;
  isTaxRelevant: boolean;
  taxData?: {
    amount: number;
    currency: string;
    taxCategory: string;
  };
  // NEW: Detailed Payment Info
  paymentDetails?: {
    recipientName?: string; // Who gets the money?
    payerName?: string;     // Who pays?
    iban?: string;          // Account Number
    reference?: string;     // Ref Nr / Invoice Nr
    dueDate?: string;       // Payment Deadline
  };
  aiReasoning: string;
}

export class GeminiService {
  
  private static getApiKey(): string | null {
      // Priority: LocalStorage (User Input) -> Process Env (Dev fallback)
      return localStorage.getItem('tatdma_api_key') || (typeof process !== 'undefined' && process.env ? process.env.API_KEY : null) || null;
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g. "data:image/jpeg;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }

  // Legacy method for single receipt scan in TaxView
  static async analyzeReceipt(file: File): Promise<ScannedReceipt | null> {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) throw new Error("API Key fehlt! Bitte in den Systemeinstellungen hinterlegen.");

      const ai = new GoogleGenAI({ apiKey });
      const base64Data = await this.fileToBase64(file);
      const mimeType = file.type;

      const schema = {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER, description: "Total YEARLY amount. If the document shows a monthly amount, multiply by 12." },
          currency: { type: Type.STRING, description: "CHF, USD, or EUR" },
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          category: { 
            type: Type.STRING, 
            enum: ['Berufsauslagen', 'Weiterbildung', 'Alimente', 'Kindesunterhalt', 'Hardware/Büro', 'Versicherung', 'Krankenkassenprämien', 'Sonstiges']
          },
          description: { type: Type.STRING },
          isMonthlySummary: { type: Type.BOOLEAN, description: "Set to true if you calculated a yearly sum from a monthly amount." }
        },
        required: ["amount", "currency", "category", "description"],
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview', 
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: `Analyze this receipt for tax purposes. IMPORTANT: If you see a monthly amount (e.g. 'monatlich', 'pro Monat'), calculate the yearly sum (x12). Return JSON.` }
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

  // NEW: Generic Document Analysis for Inbox with Updated Categories
  static async analyzeDocument(file: File): Promise<AnalyzedDocument | null> {
    try {
      const apiKey = this.getApiKey();
      
      // DEBUG LOGGING
      console.log("Gemini Scan Start. File:", file.name, "API Key Present:", !!apiKey);
      
      if (!apiKey) {
          console.warn("ABORTING: No API Key found.");
          return null; 
      }

      const ai = new GoogleGenAI({ apiKey });
      const base64Data = await this.fileToBase64(file);
      
      // Dynamic Schema based on CATEGORY_STRUCTURE
      const mainCategories = Object.keys(CATEGORY_STRUCTURE);
      
      // Create a string representation of the structure for the prompt context
      const structureContext = Object.entries(CATEGORY_STRUCTURE).map(([cat, subs]) => {
          return `- ${cat}: [${subs.join(', ')}]`;
      }).join('\n');

      const schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "A clean, short filename/title for the document." },
          summary: { type: Type.STRING, description: "A highly relevant summary of the content (2-3 sentences). Identify the sender, key figures, and main purpose." },
          category: { 
            type: Type.STRING, 
            enum: mainCategories,
            description: "The strict Main Category for this document." 
          },
          subCategory: {
            type: Type.STRING,
            description: "The most fitting Sub-Category based on the Main Category. If none fits perfectly, leave empty."
          },
          date: { type: Type.STRING, description: "YYYY-MM-DD. The official date of the document (Date of issue or Period Start)." },
          isTaxRelevant: { type: Type.BOOLEAN, description: "True ONLY if this document represents a deductible expense for Swiss taxes." },
          aiReasoning: { type: Type.STRING, description: "Short explanation: Why did you choose this category? If amount found, show calculation." },
          taxData: {
            type: Type.OBJECT,
            properties: {
              amount: { type: Type.NUMBER, description: "The total deductible amount for the tax year. Prefer explicit yearly totals found in text. If monthly, calculate x12 (or pro-rata if start date is mid-year)." },
              currency: { type: Type.STRING, description: "CHF, EUR, USD" },
              taxCategory: { 
                 type: Type.STRING, 
                 enum: ['Berufsauslagen', 'Weiterbildung', 'Alimente', 'Kindesunterhalt', 'Hardware/Büro', 'Versicherung', 'Krankenkassenprämien', 'Sonstiges'],
                 description: "Strict tax deduction category."
              }
            },
            nullable: true
          },
          paymentDetails: {
            type: Type.OBJECT,
            properties: {
                recipientName: { type: Type.STRING, description: "The name of the company or person receiving payment (Sender of the invoice).", nullable: true },
                payerName: { type: Type.STRING, description: "The name of the person expected to pay (Addressee).", nullable: true },
                iban: { type: Type.STRING, description: "The IBAN or Account Number found.", nullable: true },
                reference: { type: Type.STRING, description: "QR Reference number or Invoice number.", nullable: true },
                dueDate: { type: Type.STRING, description: "The specific due date if mentioned (Zahlbar bis).", nullable: true }
            },
            nullable: true
          }
        },
        required: ["title", "summary", "category", "date", "isTaxRelevant", "aiReasoning"]
      };

      const prompt = `
      You are a smart Personal Assistant & Swiss Tax Expert. Analyze this document carefully.
      
      TASK 1: CATEGORIZE
      Assign one of the provided Main Categories and a Sub-Category.
      Here is the allowed structure:
      ${structureContext}
      
      TASK 2: SUMMARIZE
      Provide a concise but useful summary. 
      - Who is the sender? 
      - What is the subject? 
      - Are there key dates or deadlines?
      
      TASK 3: EXTRACTION (PAYMENT DETAILS)
      If this is an invoice, contract, or bill, extract detailed payment information:
      - Who is the Recipient (Creditor)?
      - Who is the Payer (Debtor)?
      - Extract IBAN, QR-Reference, or Account Numbers.
      
      IMPORTANT: If NO payment details (IBAN, Reference, Due Date) are found, return 'null' for the paymentDetails object. Do not invent data.
      
      TASK 4: TAX ANALYSIS
      Search for any cost that can be deducted from taxes in Switzerland (e.g. Health Insurance, Professional Expenses, Education).
      
      *** IMPORTANT CALCULATION RULES ***
      1. **DATE:** Find the DATE OF ISSUE or START OF PERIOD. Do NOT use the current date (2025). Use the year found in the document.
      2. **AMOUNT:** 
         - Prefer an EXPLICIT ANNUAL TOTAL if printed.
         - If only a MONTHLY amount is found, check the VALID FROM date.
         - If valid from Jan 1st: Multiply by 12.
         - If valid from mid-year: Calculate pro-rata.
      
      If no tax relevant amount is found, set isTaxRelevant to false.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: file.type, data: base64Data } },
            { text: prompt }
          ]
        },
        config: { responseMimeType: "application/json", responseSchema: schema }
      });

      console.log("Gemini Response Raw:", response.text);

      if (!response.text) return null;
      return JSON.parse(response.text) as AnalyzedDocument;

    } catch (e) {
      console.error("Gemini Doc Analysis Error:", e);
      return null;
    }
  }
}