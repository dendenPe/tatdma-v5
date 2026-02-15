
// GLOBAL CONSTANTS
export const APP_VERSION = 'v5e';

export interface Trade {
  pnl: number;
  fee?: number; // Broker commission
  start: string;
  end: string;
  inst: string;
  qty: number;
  tag: string;
  strategy?: "Long-Reversal" | "Short-Reversal" | "Long-Cont." | "Short-Cont." | "Day-Trade" | "Long-Agg." | "Short-Agg.";
}

export interface DayEntry {
  total: number;
  note: string;
  trades: Trade[];
  screenshots: string[]; // Filenames in IndexedDB
  fees?: number;
}

export interface SalaryEntry {
  monatslohn: number;
  familienzulage: number;
  pauschalspesen: number;
  aufrechnung: number;
  brutto: number;
  ahv: number;
  alv: number;
  sozialfond: number;
  bvg: number;
  quellensteuer: number;
  abzuege: number;
  netto: number;
  korrektur: number;
  auszahlung: number;
  kommentar: string;
  pdfFilename?: string;
  [key: string]: any; // For custom columns
}

// NEW: Annual Salary Certificate Data (Lohnausweis) for Tax Form 101/25
export interface SalaryCertificateData {
  p1: {
    grossMain: number; // Ziff 1.1 Haupterwerb
    grossSide: number; // Ziff 1.2 Nebenerwerb
    grossSimple: number; // Ziff 1.3 Vereinfachte Abrechnung
    expenses: number;  // Ziff 10.1 Pauschalspesen
  };
  p2: {
    grossMain: number; // Ziff 1.1 Haupterwerb
    grossSide: number; // Ziff 1.2 Nebenerwerb
    grossSimple: number; // Ziff 1.3 Vereinfachte Abrechnung
    expenses: number;  // Ziff 10.2 Pauschalspesen
  };
}

export interface PortfolioPosition {
  symbol: string;
  currency: string;
  qty: number;
  cost: number;
  close: number;
  val: number;
  unReal: number;
  real: number;
  isCash?: boolean;
  originalAmount?: number;
}

export interface PortfolioSummary {
  totalValue: number;
  unrealized: number;
  realized: number;
  dividends: number;
  tax: number;
}

export interface PortfolioYear {
  positions: Record<string, PortfolioPosition>;
  cash: Record<string, number>; // Currency -> Amount
  summary: PortfolioSummary;
  lastUpdate: string;
  exchangeRates: Record<string, number>; // e.g., "EUR_USD": 1.08, "USD_CHF": 0.88
}

export interface Portfolio {
  name: string;
  years: Record<string, PortfolioYear>;
}

export interface ChildDetails {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  schule_ausbildung: string;
  konfession: string;
  haushalt: boolean;
  ausbildungsende?: string;
  // Extended Child Info
  staatsangehoerigkeit?: string;
  adresse_kind?: string; // If different from recipient
  
  // Recipient details (usually the other parent)
  empfaenger_vorname?: string;
  empfaenger_name?: string;
  empfaenger_strasse?: string;
  empfaenger_plz_ort?: string;
  empfaenger_land?: string;
  empfaenger_geburtsdatum?: string;
  empfaenger_staatsangehoerigkeit?: string;
  
  // Specific Form 101 Fields
  sorgerecht_gemeinsam?: boolean;
  obhut_alternierend?: boolean;
  unterhalt_anderer_elternteil?: boolean;
  
  // Frequency Logic
  paymentFrequency: 'fix' | 'individuell';
  monthlyAmounts: number[]; // 12 entries
  currency: string;
}

export interface AlimonyDetails {
  empfaenger_vorname: string;
  empfaenger_name: string;
  empfaenger_strasse?: string;
  empfaenger_plz_ort?: string;
  empfaenger_land?: string;
  empfaenger_geburtsdatum?: string;
  empfaenger_staatsangehoerigkeit?: string;
  
  getrennt_seit: string;
  
  // Frequency Logic
  paymentFrequency: 'fix' | 'individuell';
  monthlyAmounts: number[]; // 12 entries
  currency: string;
}

export interface TaxExpense {
  id?: string; // Optional ID for tracking
  noteRef?: string; // Reference to source Note ID if imported from Notes
  desc: string;
  amount: number;
  year: string;
  cat: 'Berufsauslagen' | 'Weiterbildung' | 'Alimente' | 'Kindesunterhalt' | 'Hardware/Büro' | 'Versicherung' | 'Krankenkassenprämien' | 'Sonstiges';
  currency: string;
  rate: number;
  receipts: string[];
  taxRelevant: boolean;
  childDetails?: ChildDetails;
  alimonyDetails?: AlimonyDetails;
}

// NEW: Custom Bank Account Interface
export interface CustomBankAccount {
  id: string;
  name: string;
  amount: number;
  currency: string; // 'CHF', 'EUR', 'USD'
  iban?: string;
  includeInTaxReport?: boolean; // NEW: Controls visibility in Tax PDF
}

export interface BankBalance {
  ubs: number;
  ubsPdfFilename?: string;
  comdirect: number;
  comdirectEUR?: number;
  comdirectRate?: number;
  comdirectPdfFilename?: string;
  ibkr: number;
  ibkrPortfolioId?: string;
  ibkrPdfFilename?: string;
  // NEW: Dynamic List of Accounts
  customAccounts?: CustomBankAccount[];
}

// --- NEW DOC MANAGEMENT TYPES ---

// Central Definition of Category Structure for v5a
export const CATEGORY_STRUCTURE: Record<string, string[]> = {
  'Identität & Zivilstand': ['Ausweisdokumente', 'Zivilstandsdokumente', 'Meldebescheinigungen'],
  'Bildung & Qualifikation': ['Abschlüsse & Diplome', 'Arbeitszeugnisse', 'Weiterbildung'],
  'Beruf & Beschäftigung': ['Arbeitsverträge', 'Lohnabrechnungen', 'Sozialversicherungen'],
  'Finanzen & Bankwesen': ['Konten & Karten', 'Kredite & Hypotheken', 'Anlagen & Depots'],
  'Steuern & Abgaben': ['Steuererklärungen', 'Veranlagungen', 'MWST & Zoll'],
  'Wohnen & Immobilien': ['Mietverträge', 'Eigentum', 'Nebenkosten'],
  'Gesundheit & Vorsorge': ['Medizinische Akten', 'Rechnungen & Rezepte', 'Patientenverfügung'],
  'Versicherungen': ['Krankenkasse', 'Sach & Haftpflicht', 'Leben & Unfall'],
  'Recht & Verträge': ['Kauf & Service', 'Rechtsfälle', 'Vollmachten'],
  'Fahrzeuge & Mobilität': ['Fahrzeugpapiere', 'Wartung & MFK', 'Reisen & ÖV'],
  'Behörden & Soziales': ['Leistungen', 'Militär & Zivilschutz', 'Bewilligungen'],
  'Eigentum & Besitz': ['Garantien', 'Wertsachen', 'Inventarlisten'],
  'Kommunikation & Korrespondenz': ['Wichtige Post', 'Protokolle', 'Digitales'],
  'Nachlass & Erbe': ['Testamente', 'Amtliches', 'Bestattung'],
  'Technik & IT': ['Lizenzen', 'Handbücher', 'Zugangsdaten'],
  'Sonstiges': []
};

// Allow any string for dynamic categories, but keep defaults in mind
export type DocCategory = string; 

export interface NoteDocument {
  id: string;
  title: string;
  type: 'pdf' | 'note' | 'image' | 'word' | 'excel' | 'other';
  category: DocCategory;
  subCategory?: string; // New in v5a
  year: string; // e.g. "2025"
  created: string; // ISO date
  content: string; // Full text content (extracted from PDF or manual note)
  fileName?: string; // Original filename if PDF
  filePath?: string; // Path in Vault (e.g. "_ARCHIVE/2025/Rechnungen/file.pdf")
  tags: string[];
  isNew?: boolean; // For Inbox highlighting
  taxRelevant?: boolean; // Checkbox state: Imported to Tax Expenses?
  userNote?: string; // NEW: Manual user comments/notes on top of the document
  isExpense?: boolean; // NEW: Flag for Daily Expenses
  expenseId?: string; // NEW: ID of the linked ExpenseEntry
  attachments?: string[]; // NEW: Array of DB IDs for attachments (PDFs)
  linkedNoteIds?: string[]; // NEW: References to other notes to show their attachments
}

// --- NEW IN v5b: DAILY EXPENSES ---
export type ExpenseCategory = 'Verpflegung' | 'Mobilität' | 'Haushalt' | 'Freizeit' | 'Shopping' | 'Gesundheit' | 'Wohnen' | 'Reisen' | 'Sonstiges';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['Verpflegung', 'Mobilität', 'Haushalt', 'Freizeit', 'Shopping', 'Gesundheit', 'Wohnen', 'Reisen', 'Sonstiges'];

// Updated Item Interface to support Prices
export interface ExpenseItem {
    name: string;
    price: number;
}

export interface ExpenseEntry {
  id: string;
  date: string; // YYYY-MM-DD
  merchant: string; // "Coop", "Shell", "SBB"
  description?: string; // Context details
  // Supports legacy string[] or new ExpenseItem[]
  items?: Array<string | ExpenseItem>; 
  amount: number;
  currency: string;
  rate: number; // Rate to CHF
  category: ExpenseCategory;
  location?: string; // "Zürich", "Berlin"
  receiptId?: string; // DB ID of the receipt file
  isTaxRelevant: boolean; // Flag if copied to tax
}

// --- NEW IN v5c: RECURRING EXPENSES (ABOS) ---
export interface PriceHistory {
    validFrom: string; // YYYY-MM-DD
    amount: number;
    currency: string;
}

export interface RecurringExpense {
    id: string;
    name: string; // "Netflix", "Spotify"
    category: ExpenseCategory;
    frequency: 'M' | 'Q' | 'Y';
    paymentMonth?: number; // 1-12, needed for 'Q' (start month) or 'Y' (payment month)
    history: PriceHistory[]; // Array of price changes
}

// --- NEW IN v5.1: BUDGETS & GOALS ---
export interface SavingsGoal {
    id: string;
    name: string; // e.g. "Notgroschen", "Ferien"
    targetAmount: number;
    currentAmount: number; // Manually updated or linked? For now manual.
    deadline: string; // YYYY-MM-DD
    color: string; // hex
}

export interface AppData {
  trades: Record<string, DayEntry>;
  salary: Record<string, Record<string, SalaryEntry>>; // year -> month -> entry
  // NEW: Salary Certificates (Annual)
  salaryCertificates?: Record<string, SalaryCertificateData>; // year -> data
  tax: {
    personal: {
      name: string;
      address: string;
      zip: string;
      city: string;
      id: string;
    };
    expenses: TaxExpense[];
    balances: Record<string, BankBalance>;
    remarks?: string;
    rateUSD?: number;
    rateEUR?: number;
    notes?: Record<string, string>; // year -> text note for tax office
    messageToAuthorities?: Record<string, string>; // year -> custom message
  };
  portfolios: Record<string, Portfolio>;
  currentPortfolioId: string;
  
  // New in v4
  notes: Record<string, NoteDocument>; // key = id
  categoryRules?: Record<string, string[]>; // Category -> Array of keywords
  
  // New in v5b
  dailyExpenses: Record<string, ExpenseEntry[]>; // Key = Year (2025), Value = List of expenses
  recurringExpenses?: RecurringExpense[]; // New in v5c: List of all recurring items
  
  // New in v5.1
  budgets?: Record<string, number>; // Key = Category (e.g. 'Verpflegung'), Value = Monthly Limit in CHF
  savingsGoals?: SavingsGoal[];
}
