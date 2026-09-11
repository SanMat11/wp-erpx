// Common types
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}

// Client
export interface Client {
  id: string
  code: string
  name: string
  email: string
  phone: string
  mobile: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  country: string
  siret: string
  tvaIntra: string
  paymentTerms: number
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Supplier
export interface Supplier {
  id: string
  code: string
  name: string
  email: string
  phone: string
  mobile: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  country: string
  siret: string
  tvaIntra: string
  paymentTerms: number
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Article
export interface Article {
  id: string
  code: string
  name: string
  description: string
  type: 'product' | 'service'
  unit: string
  purchasePrice: number
  salePrice: number
  tvaRate: number
  categoryId: string | null
  isComposed: boolean
  stockManaged: boolean
  minStock: number
  barcode: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  components?: ArticleComponent[]
}

export interface ArticleComponent {
  id: string
  parentId: string
  childId: string
  quantity: number
  child?: Article
}

// Quote
export interface Quote {
  id: string
  number: string
  clientId: string
  client?: Client
  date: string
  validityDate: string | null
  status: 'draft' | 'sent' | 'accepted' | 'refused' | 'expired' | 'invoiced'
  totalHt: number
  totalTva: number
  totalTtc: number
  discountPercent: number
  discountAmount: number
  notes: string
  conditions: string
  lines: QuoteLine[]
  createdAt: string
  updatedAt: string
}

export interface QuoteLine {
  id: string
  quoteId: string
  articleId: string | null
  position: number
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountPercent: number
  tvaRate: number
  totalHt: number
}

// Invoice
export interface Invoice {
  id: string
  number: string
  type: 'client' | 'supplier' | 'credit_note'
  clientId: string | null
  supplierId: string | null
  client?: Client
  supplier?: Supplier
  quoteId: string | null
  date: string
  dueDate: string | null
  status: 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  totalHt: number
  totalTva: number
  totalTtc: number
  paidAmount: number
  discountPercent: number
  discountAmount: number
  notes: string
  paymentTerms: string
  lines: InvoiceLine[]
  payments: Payment[]
  createdAt: string
  updatedAt: string
}

export interface InvoiceLine {
  id: string
  invoiceId: string
  articleId: string | null
  position: number
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountPercent: number
  tvaRate: number
  totalHt: number
}

export interface Payment {
  id: string
  invoiceId: string
  date: string
  amount: number
  method: 'cash' | 'check' | 'bank_transfer' | 'card' | 'other'
  reference: string
  notes: string
  createdAt: string
}

// Stock
export interface StockLevel {
  id: string
  articleId: string
  warehouseId: string
  quantity: number
  reservedQuantity: number
  minThreshold: number | null
  maxThreshold: number | null
  article?: Article
  warehouse?: Warehouse
}

export interface StockMovement {
  id: string
  articleId: string
  warehouseId: string
  type: 'in' | 'out' | 'transfer' | 'adjustment'
  quantity: number
  reference: string
  notes: string
  createdAt: string
  article?: Article
  warehouse?: Warehouse
}

export interface Warehouse {
  id: string
  code: string
  name: string
  address: string
  isDefault: boolean
  isActive: boolean
}

export interface StockAlert {
  articleId: string
  articleCode: string
  articleName: string
  warehouseId: string
  warehouseName: string
  currentQuantity: number
  minThreshold: number
  alertType: 'low_stock' | 'out_of_stock'
}

// Deal
export interface Deal {
  id: string
  name: string
  clientId: string | null
  client?: Client
  status: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost'
  probability: number
  expectedAmount: number
  expectedCloseDate: string | null
  assignedTo: string | null
  source: string
  notes: string
  activities?: DealActivity[]
  createdAt: string
  updatedAt: string
}

export interface DealActivity {
  id: string
  dealId: string
  type: 'call' | 'email' | 'meeting' | 'note' | 'task'
  description: string
  date: string
  completed: boolean
  createdAt: string
}

// Dashboard
export interface DashboardStats {
  revenue: {
    currentMonth: number
    previousMonth: number
    growthPercent: number
    yearToDate: number
  }
  invoices: {
    total: number
    draft: number
    pending: number
  }
  quotes: {
    total: number
    draft: number
    pending: number
  }
  clients: number
  deals: {
    open: number
    wonThisMonth: number
    totalPipeline: number
    weightedPipeline: number
  }
  stockAlerts: number
  overdueAmount: number
}
