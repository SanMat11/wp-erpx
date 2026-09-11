import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

/**
 * Amorçage passé par WordPress au moment où la page d'administration est rendue.
 *
 * C'est LA couture entre cette application et son hôte : au-dessus de cette
 * ligne, plus rien ne sait qu'on tourne dans WordPress. Les écrans, les
 * magasins, les gabarits sont ceux de l'ERP, inchangés.
 */
export interface AmsbmBoot {
  /** Version du plugin, telle que déclarée par son en-tête. */
  version?: string
  restUrl: string
  nonce: string
  /**
   * Écran d'entrée imposé par le serveur, quand il y en a un.
   *
   * ⚠️ La coquille PUBLIQUE (AMSBM\Front\PublicApp) sert « /devis/{jeton} » et
   * « /verification/{code} » à des visiteurs sans compte. Sans cette adresse, le
   * routeur démarrait sur son écran par défaut : la page répondait 200, l'appli
   * se montait sans une erreur… et le client voyait la page d'accueil
   * commerciale au lieu de son devis.
   */
  route?: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    tenantId: string
  } | null
  adminUrl: string
  /**
   * Adresse de déconnexion de WordPress, nonce compris.
   *
   * ⚠️ Elle est FABRIQUÉE PAR LE SERVEUR (wp_logout_url) et ne peut pas l'être
   * ici : sans le nonce, WordPress ne ferme pas la session. Se contenter de
   * vider le magasin local faisait quitter l'ERP avec les cookies toujours
   * valables — sur un poste partagé, la session restait ouverte.
   */
  logoutUrl: string
  /** Locale dans laquelle AMS Studio s'exprime, par exemple « fr_FR ». */
  locale: string
  /**
   * Les langues effectivement livrées, annoncées par le serveur.
   *
   * ⚠️ NE PAS LES ÉCRIRE EN DUR ICI. Le catalogue des écrans et celui du
   * serveur avancent ensemble ou pas du tout : une liste locale finirait par
   * offrir une langue dont le .mo n'existe pas, et l'écran basculerait pendant
   * que le serveur continuerait de répondre en français.
   */
  langues?: string[]
  /** Le choix des réglages : un code de langue, ou « » pour suivre WordPress. */
  langueChoisie?: string
  /**
   * Ce que cette installation CONTIENT, module par module.
   *
   * ⚠️ CE N'EST PAS UN ÉTAT DE DROITS. Le serveur lit sur le disque quels
   * modules ont été livrés — voir AMSBM\Modules. Un module à « false » n'est
   * pas fermé : son code n'est pas là. L'écran le propose donc au lieu de le
   * refuser, et l'installer suffit à l'ouvrir.
   */
  modules?: Record<string, boolean>
  /** Les modules absents, avec leur libellé, pour les proposer. */
  manquants?: Record<string, string>
  /** Où l'on obtient les modules absents. */
  boutique?: string
  /**
   * L'état de la licence — présent dans le paquet complet UNIQUEMENT.
   *
   * Absent (null ou indéfini), il n'y a pas de licence dans cette
   * installation : l'onglet d'abonnement ne s'affiche pas, et rien ne réclame
   * de clé. C'est le cas du paquet publié par WordPress.org.
   */
  licence?: {
    valid: boolean
    in_grace: boolean
    grace_left: number
    notice: string
  } | null
}

declare global {
  interface Window {
    amsbmBoot?: AmsbmBoot
  }
}

export const amsbmBoot: AmsbmBoot = window.amsbmBoot || {
  restUrl: '/wp-json/amsbm/v1',
  nonce: '',
  user: null,
  adminUrl: '/wp-admin/',
  // Hors WordPress (développement à part), on n'a pas de nonce : la page de
  // déconnexion demandera confirmation, ce qui vaut mieux que de ne rien faire.
  logoutUrl: '/wp-login.php?action=logout',
  locale: 'fr_FR',
  langues: ['fr', 'en'],
  langueChoisie: '',
  modules: {},
  manquants: {},
}

const api = axios.create({
  baseURL: amsbmBoot.restUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor.
//
// Le jeton CSRF du SaaS est remplacé par le nonce de WordPress, qui joue
// exactement le même rôle : dire que la requête vient bien de l'application et
// pas d'un autre site. L'identité, elle, vient du cookie de session WordPress —
// il n'y a plus ni JWT, ni rafraîchissement, ni redirection vers /login : si la
// session expire, WordPress renvoie 401 et l'utilisateur recharge la page.
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (amsbmBoot.nonce) {
      config.headers['X-WP-Nonce'] = amsbmBoot.nonce
    }

    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor.
//
// WP_REST_Response emballe déjà ce qu'on renvoie ; les erreurs arrivent en
// WP_Error, dont on remonte le message à la place du « Request failed with
// status code 500 » d'axios, sans quoi aucun écran ne saurait quoi afficher.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string; code?: string; error?: string }>) => {
    const message = error.response?.data?.message

    if (message) {
      error.message = message

      // ⚠️ On recopie AUSSI le motif dans « data.error ».
      //
      // Une douzaine d'écrans (réglages, utilisateurs, TVA, entrepôts…) lisent
      // err.response?.data?.error, héritage du SaaS ; WordPress, lui, n'emballe
      // jamais qu'un « message ». Ces écrans lisaient donc undefined et
      // affichaient « Erreur lors de la sauvegarde » à la place de la raison
      // exacte du refus — y compris pour un 409 qui explique une règle légale.
      // Corriger ici évite d'aller poser la même rustine dans chacun d'eux.
      if (error.response?.data && !error.response.data.error) {
        error.response.data.error = message
      }
    }

    return Promise.reject(error)
  }
)

export default api

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  register: (data: {
    email: string
    password: string
    firstName: string
    lastName: string
    companyName: string
    subdomain: string
  }) => api.post('/auth/register', {
    email: data.email,
    password: data.password,
    first_name: data.firstName,
    last_name: data.lastName,
    company_name: data.companyName,
    subdomain: data.subdomain,
  }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get('/auth/me'),

  verify2FA: (twoFactorToken: string, code: string) =>
    api.post('/auth/verify-2fa', { two_factor_token: twoFactorToken, code }),

  passkeyLoginBegin: (email?: string) => api.post('/auth/passkey/login/begin', { email: email || '' }),
  passkeyLoginFinish: (challengeToken: string, response: any) =>
    api.post('/auth/passkey/login/finish', { challengeToken, response }),

  getRegistrationStatus: () => api.get<{ enabled: boolean }>('/public/registration-status'),
}

// Client API
export const clientAPI = {
  list: (params?: Record<string, unknown>) => api.get('/clients', { params }),
  get: (id: string) => api.get(`/clients/${id}`),
  getNextCode: () => api.get('/clients/next-code'),
  create: (data: Record<string, unknown>) => api.post('/clients', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
}

// Supplier API
export const supplierAPI = {
  list: (params?: Record<string, unknown>) => api.get('/suppliers', { params }),
  get: (id: string) => api.get(`/suppliers/${id}`),
  getNextCode: () => api.get('/suppliers/next-code'),
  create: (data: Record<string, unknown>) => api.post('/suppliers', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/suppliers/${id}`, data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
}

// Factures fournisseurs.
//
// ⚠️ Elles ne se servent PAS des routes des factures clients. « /invoices/{id}/send »
// envoie la facture par courriel au client : sur une facture fournisseur, cela
// n'a aucun sens — et c'est pourtant ce que le bouton « réceptionner » appelait.
// Rien n'était validé, la facture restait en brouillon, et le message d'échec
// laissait croire à une panne.
export const supplierInvoiceAPI = {
  validate: (id: string) => api.post(`/supplier-invoices/${id}/validate`),
  /** Voir quoteAPI.requestValidation : même route, servie par la classe de base. */
  requestValidation: (id: string) => api.post(`/supplier-invoices/${id}/request-validation`),
  updateStatus: (id: string, status: string) => api.patch(`/supplier-invoices/${id}/status`, { status }),
  /**
   * Établit l'avoir FOURNISSEUR d'une facture d'achat.
   *
   * Le fournisseur envoie son propre avoir ; on ne l'invente pas à sa place,
   * mais il faut bien l'enregistrer — sinon la dette reste due et la
   * comptabilité ne voit jamais la contre-passation. Sans « lines », la facture
   * est reprise en entier.
   */
  credit: (id: string, lines?: Array<{ id: string; quantity: number }>) =>
    api.post(`/supplier-invoices/${id}/credit`, lines && lines.length ? { lines } : {}),
}

// Article API
export const articleAPI = {
  list: (params?: Record<string, unknown>) => api.get('/articles', { params }),
  get: (id: string) => api.get(`/articles/${id}`),
  // Le numéro d'ordre suivant, comme pour les clients et les fournisseurs :
  // un code inventé à la main finit par en heurter un autre, et la colonne est
  // unique — l'écran renvoyait alors une 500 incompréhensible.
  getNextCode: () => api.get('/articles/next-code'),
  create: (data: Record<string, unknown>) => api.post('/articles', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/articles/${id}`, data),
  delete: (id: string) => api.delete(`/articles/${id}`),
  getComponents: (id: string) => api.get(`/articles/${id}/components`),
  addComponent: (id: string, data: { childId: string; quantity: number }) =>
    api.post(`/articles/${id}/components`, { child_id: data.childId, quantity: data.quantity }),
  removeComponent: (id: string, componentId: string) =>
    api.delete(`/articles/${id}/components/${componentId}`),
}

// Quote API
// Les PDF portent un paramètre d'horodatage. L'hébergeur pose une heure de
// cache sur tout ce qui sort en application/pdf ; le serveur envoie désormais
// « no-store », mais cela ne défait pas les entrées DÉJÀ en cache — un document
// corrigé continuerait de s'afficher dans sa version précédente jusqu'à
// expiration. Une adresse différente à chaque demande contourne le problème
// pour tout le monde, sans rien demander à l'utilisateur.
export const quoteAPI = {
  list: (params?: Record<string, unknown>) => api.get('/quotes', { params }),
  get: (id: string) => api.get(`/quotes/${id}`),
  create: (data: Record<string, unknown>) => api.post('/quotes', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/quotes/${id}`, data),
  delete: (id: string) => api.delete(`/quotes/${id}`),
  validate: (id: string) => api.post(`/quotes/${id}/validate`),
  /**
   * Demande la validation à ceux qui en ont le droit.
   *
   * ⚠️ CE N'EST PAS « valider ». Le rédacteur qui n'a pas
   * « amsbm_validate_documents » se heurtait à un 403 sans savoir à qui
   * s'adresser : cette route pose l'état « attente validation » ET prévient
   * par courriel tous ceux qui peuvent valider. Elle rend
   * { success, notified, status } — « notified » est le nombre de personnes
   * réellement prévenues, et l'écran doit le dire, zéro compris.
   *
   * Elle vit dans Documents::registerCommonActions() : les factures, les
   * commandes et les factures fournisseurs l'ont aussi, au même chemin.
   */
  requestValidation: (id: string) => api.post(`/quotes/${id}/request-validation`),
  convert: (id: string) => api.post(`/invoices/from-quote/${id}`),
  updateStatus: (id: string, status: string) => api.patch(`/quotes/${id}/status`, { status }),
  getPdf: (id: string) => api.get(`/quotes/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
  sendEmail: (id: string, email: string, message?: string) =>
    api.post(`/quotes/${id}/send-email`, { email, message: message || '' }),
  getLinkedInvoices: (id: string) => api.get(`/quotes/${id}/invoices`),
  getInvoicingInfo: (id: string) => api.get(`/quotes/${id}/invoicing-info`),
  createDepositInvoice: (id: string, percent: number, date?: string) =>
    api.post('/invoices/deposit', {
      quote_id: id,
      deposit_percent: percent,
      date: date || new Date().toISOString()
    }),
  createDeal: (id: string) => api.post(`/quotes/${id}/create-deal`),
  duplicate: (id: string) => api.post(`/quotes/${id}/duplicate`),
  archive: (id: string, archived: boolean) => api.post(`/quotes/${id}/archive`, { archived }),
  archiveBulk: (ids: string[], archived: boolean) => api.post('/quotes/archive-bulk', { ids, archived }),
}

// Invoice API
export const invoiceAPI = {
  list: (params?: Record<string, unknown>) => api.get('/invoices', { params }),
  listUnpaid: (type?: 'client' | 'supplier') => api.get('/invoices/unpaid', { params: type ? { type } : undefined }),
  get: (id: string) => api.get(`/invoices/${id}`),
  create: (data: Record<string, unknown>) => api.post('/invoices', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/invoices/${id}`, data),
  delete: (id: string) => api.delete(`/invoices/${id}`),
  send: (id: string) => api.post(`/invoices/${id}/send`),
  /** Voir quoteAPI.requestValidation : même route, servie par la classe de base. */
  requestValidation: (id: string) => api.post(`/invoices/${id}/request-validation`),
  updateStatus: (id: string, status: string) => api.patch(`/invoices/${id}/status`, { status }),
  getPdf: (id: string) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
  getPayments: (id: string) => api.get(`/invoices/${id}/payments`),
  addPayment: (id: string, data: Record<string, unknown>) =>
    api.post(`/invoices/${id}/payments`, data),
  sendEmail: (id: string, email: string) =>
    api.post(`/invoices/${id}/send-email`, { email }),
  getBankPayments: (id: string) => api.get(`/invoices/${id}/bank-payments`),
  duplicate: (id: string) => api.post(`/invoices/${id}/duplicate`),
  importElectronic: (file: File, supplierId?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (supplierId) formData.append('supplier_id', supplierId)
    return api.post('/invoices/import-electronic', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  checkDuplicate: (number: string) => api.get('/invoices/check-duplicate', { params: { number } }),
  pendingReminders: () => api.get('/invoices/reminders/pending'),
  sendReminders: (invoiceIds: string[]) => api.post('/invoices/reminders/send', { invoice_ids: invoiceIds }),
}

// Stock API
export const stockAPI = {
  getLevels: (params?: Record<string, unknown>) => api.get('/stock/levels', { params }),
  getMovements: (params?: Record<string, unknown>) => api.get('/stock/movements', { params }),
  createMovement: (data: Record<string, unknown>) => api.post('/stock/movements', data),
  updateMovement: (id: string, data: Record<string, unknown>) => api.put(`/stock/movements/${id}`, data),
  deleteMovement: (id: string) => api.delete(`/stock/movements/${id}`),
  getAlerts: () => api.get('/stock/alerts'),
  sendAlertsEmail: (email: string) => api.post('/stock/alerts/send-email', { email }),
  getEmailStatus: () => api.get('/stock/alerts/email-status'),
  getWarehouses: () => api.get('/stock/warehouses'),
  createWarehouse: (data: { code: string; name: string; address?: string; is_default?: boolean }) =>
    api.post('/stock/warehouses', data),
  updateWarehouse: (id: string, data: { code: string; name: string; address?: string; is_default?: boolean; is_active?: boolean }) =>
    api.put(`/stock/warehouses/${id}`, data),
  deleteWarehouse: (id: string) => api.delete(`/stock/warehouses/${id}`),
}

// Deal API
export const dealAPI = {
  list: (params?: Record<string, unknown>) => api.get('/deals', { params }),
  get: (id: string) => api.get(`/deals/${id}`),
  create: (data: Record<string, unknown>) => api.post('/deals', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/deals/${id}`, data),
  delete: (id: string) => api.delete(`/deals/${id}`),
  /**
   * Voir quoteAPI.requestValidation. Les affaires n'héritent pas de Documents :
   * la route est écrite à la main dans Deals, mais le contrat est le même.
   */
  requestValidation: (id: string) => api.post(`/deals/${id}/request-validation`),
  getActivities: (id: string) => api.get(`/deals/${id}/activities`),
  addActivity: (id: string, data: Record<string, unknown>) =>
    api.post(`/deals/${id}/activities`, data),
  getPdf: (id: string) => api.get(`/deals/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
  getAmendments: (id: string) => api.get(`/deals/${id}/amendments`),
}

// Amendment API (Client Amendments linked to deals)
export const amendmentAPI = {
  list: (params?: Record<string, unknown>) => api.get('/amendments', { params }),
  get: (id: string) => api.get(`/amendments/${id}`),
  create: (data: Record<string, unknown>) => api.post('/amendments', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/amendments/${id}`, data),
  delete: (id: string) => api.delete(`/amendments/${id}`),
  updateStatus: (id: string, status: string) => api.put(`/amendments/${id}/status`, { status }),
  getPdf: (id: string) => api.get(`/amendments/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
  // Invoicing from amendment
  getInvoicingInfo: (id: string) => api.get(`/invoices/amendment/${id}/invoicing-info`),
  createDepositInvoice: (id: string, depositPercent: number) =>
    api.post('/invoices/amendment-deposit', { amendment_id: id, deposit_percent: depositPercent, date: new Date().toISOString() }),
  convert: (id: string) => api.post(`/invoices/from-amendment/${id}`),
}

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getCharts: (year?: number) => api.get('/dashboard/charts', { params: year ? { year } : undefined }),
}

// Document API (GED)
export const documentAPI = {
  list: (params?: Record<string, unknown>) => api.get('/documents', { params }),
  get: (id: string) => api.get(`/documents/${id}`),
  upload: (formData: FormData) => api.post('/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  uploadMerged: (formData: FormData) => api.post('/documents/merge', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  update: (id: string, data: Record<string, unknown>) => api.put(`/documents/${id}`, data),
  delete: (id: string) => api.delete(`/documents/${id}`),
  download: (id: string) => api.get(`/documents/${id}/download`, { responseType: 'blob' }),
}

// Purchase Order API
/**
 * Les réceptions fournisseurs.
 *
 * Une réception ne se CRÉE pas ici : elle naît du bouton « Recevoir » d'une
 * commande. Cet écran sert à la relire, à l'imprimer et — c'est tout son
 * intérêt — à l'ANNULER quand on s'est trompé de quantité : la marchandise
 * ressort du dépôt et la commande redevient due d'autant.
 */
/**
 * La cloche.
 *
 * Pas de temps réel : WordPress n'a pas de serveur de messages, et l'écran vient
 * chercher ce qui l'attend. `read()` sans identifiant marque tout comme lu.
 */
export const notificationAPI = {
  list: () => api.get('/notifications'),
  read: (id?: string) => api.post('/notifications/read', id ? { id } : {}),
  clear: () => api.delete('/notifications'),
}

export const receiptAPI = {
  list: (params?: Record<string, unknown>) => api.get('/receipts', { params }),
  get: (id: string) => api.get(`/receipts/${id}`),
  cancel: (id: string) => api.post(`/receipts/${id}/cancel`),
  getPdf: (id: string) => api.get(`/receipts/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
}

export const purchaseOrderAPI = {
  list: (params?: Record<string, unknown>) => api.get('/purchase-orders', { params }),
  get: (id: string) => api.get(`/purchase-orders/${id}`),
  create: (data: Record<string, unknown>) => api.post('/purchase-orders', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/purchase-orders/${id}`, data),
  delete: (id: string) => api.delete(`/purchase-orders/${id}`),
  confirm: (id: string) => api.post(`/purchase-orders/${id}/confirm`),
  /** Voir quoteAPI.requestValidation : même route, servie par la classe de base. */
  requestValidation: (id: string) => api.post(`/purchase-orders/${id}/request-validation`),
  /** « Attente validation » posée ou retirée à la main — même route que partout. */
  updateStatus: (id: string, status: string) => api.patch(`/purchase-orders/${id}/status`, { status }),
  receive: (id: string, data: Record<string, unknown>) => api.post(`/purchase-orders/${id}/receive`, data),
  cancel: (id: string) => api.post(`/purchase-orders/${id}/cancel`),
  duplicate: (id: string) => api.post(`/purchase-orders/${id}/duplicate`),
  archive: (id: string, archived: boolean) => api.post(`/purchase-orders/${id}/archive`, { archived }),
  archiveBulk: (ids: string[], archived: boolean) => api.post('/purchase-orders/archive-bulk', { ids, archived }),
  createInvoice: (id: string, data: Record<string, unknown>) => api.post(`/purchase-orders/${id}/create-invoice`, data),
  getPdf: (id: string) => api.get(`/purchase-orders/${id}/pdf`, { responseType: 'blob', params: { t: Date.now() } }),
}

// VAT Validation API (VIES)
export const vatAPI = {
  validate: (vatNumber: string) => api.get('/vat/validate', { params: { vat_number: vatNumber } }),
}

// Settings API
/**
 * La clé du cache où vivent les taux de TVA.
 *
 * Elle est ici, et pas dans l'écran qui les affiche, parce que deux écrans les
 * écrivent : la poser dans l'un obligerait l'autre à l'importer, et les deux
 * s'importent déjà mutuellement.
 */
export const CLE_TAUX_TVA = ['settings.vatRates'] as const

export const settingsAPI = {
  // Company settings
  getCompany: () => api.get('/settings/company'),
  updateCompany: (data: Record<string, unknown>) => api.put('/settings/company', data),

  // Logo
  uploadLogo: (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)
    return api.post('/settings/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deleteLogo: () => api.delete('/settings/logo'),

  // Billing settings
  getBilling: () => api.get('/settings/billing'),
  updateBilling: (data: Record<string, unknown>) => api.put('/settings/billing', data),

  // Email settings
  getEmail: () => api.get('/settings/email'),
  updateEmail: (data: Record<string, unknown>) => api.put('/settings/email', data),
  testEmail: (email: string) => api.post('/settings/email/test', { email }),

  // Notification settings
  getNotifications: () => api.get('/settings/notifications'),
  updateNotifications: (data: Record<string, unknown>) => api.put('/settings/notifications', data),

  // Users
  listUsers: () => api.get('/settings/users'),
  createUser: (data: Record<string, unknown>) => api.post('/settings/users', data),
  updateUser: (id: string, data: Record<string, unknown>) => api.put(`/settings/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/settings/users/${id}`),

  // Password
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/settings/password', { current_password: currentPassword, new_password: newPassword }),

  // Storage
  getStorage: () => api.get('/settings/storage'),

  // VAT Rates
  //
  // ⚠️ Les taux ont DEUX écrivains : l'onglet TVA, qui les tient un par un, et
  // l'onglet Société, qui en crée un lot entier au choix d'un pays. Ils ne se
  // voient pas l'un l'autre — les onglets d'antd restent montés — donc ils se
  // parlent par le cache, sous CLE_TAUX_TVA ci-dessus. Qui écrit, invalide.
  listVATRates: () => api.get('/settings/vat-rates'),
  getVATRate: (id: string) => api.get(`/settings/vat-rates/${id}`),
  createVATRate: (data: Record<string, unknown>) => api.post('/settings/vat-rates', data),
  updateVATRate: (id: string, data: Record<string, unknown>) => api.put(`/settings/vat-rates/${id}`, data),
  deleteVATRate: (id: string) => api.delete(`/settings/vat-rates/${id}`),

  // Payment Terms
  listPaymentTerms: () => api.get('/settings/payment-terms'),
  getPaymentTerm: (id: string) => api.get(`/settings/payment-terms/${id}`),
  createPaymentTerm: (data: Record<string, unknown>) => api.post('/settings/payment-terms', data),
  updatePaymentTerm: (id: string, data: Record<string, unknown>) => api.put(`/settings/payment-terms/${id}`, data),
  deletePaymentTerm: (id: string) => api.delete(`/settings/payment-terms/${id}`),

  // Appearance settings
  getAppearance: () => api.get('/settings/appearance'),
  updateAppearance: (data: { pdf_template: string; primary_color: string; theme_mode: string }) =>
    api.put('/settings/appearance', data),

  // Legal mentions settings
  getLegalMentions: () => api.get('/settings/legal-mentions'),
  updateLegalMentions: (data: { quote: string; client_invoice: string; supplier_invoice: string; purchase_order: string }) =>
    api.put('/settings/legal-mentions', data),

  // General terms and conditions (CGV) - same for all documents
  getGeneralTerms: () => api.get('/settings/general-terms'),
  updateGeneralTerms: (generalTerms: string) =>
    api.put('/settings/general-terms', { general_terms: generalTerms }),

  // Permissions
  getPermissionMatrix: () => api.get('/settings/permissions'),
  getPermissionsByRole: (role: string) => api.get(`/settings/permissions/role/${role}`),
  updatePermission: (data: { role: string; module: string; permission: string }) =>
    api.put('/settings/permissions', data),
  bulkUpdatePermissions: (permissions: Array<{ role: string; module: string; permission: string }>) =>
    api.put('/settings/permissions/bulk', { permissions }),
  checkPermission: (role: string, module: string) =>
    api.get('/settings/permissions/check', { params: { role, module } }),
  initializePermissions: () => api.post('/settings/permissions/initialize'),

  // Footers (custom document footers)
  listFooters: (params?: { document_type?: string; search?: string }) =>
    api.get('/settings/footers', { params }).then((res) => res.data),
  listFootersByDocumentType: (documentType: string) =>
    api.get(`/settings/footers/by-type/${documentType}`).then((res) => res.data),
  getFooter: (id: string) => api.get(`/settings/footers/${id}`).then((res) => res.data),
  createFooter: (data: Record<string, unknown>) => api.post('/settings/footers', data),
  updateFooter: (id: string, data: Record<string, unknown>) => api.put(`/settings/footers/${id}`, data),
  deleteFooter: (id: string) => api.delete(`/settings/footers/${id}`),
}

// Bank Account API (Treasury)
export const bankAccountAPI = {
  list: (params?: { search?: string; country?: string; show_archived?: boolean; page?: number; limit?: number }) =>
    api.get('/bank-accounts', { params }),
  get: (id: string) => api.get(`/bank-accounts/${id}`),
  create: (data: {
    country: string
    country_code: string
    bank_name: string
    bic: string
    iban: string
    initial_balance?: number
    statement_number?: number
    label?: string
    is_default?: boolean
  }) => api.post('/bank-accounts', data),
  update: (
    id: string,
    data: {
      country: string
      country_code: string
      bank_name: string
      bic: string
      iban: string
      initial_balance?: number
      statement_number?: number
      label?: string
      is_default?: boolean
    }
  ) => api.put(`/bank-accounts/${id}`, data),
  delete: (id: string) => api.delete(`/bank-accounts/${id}`),
  validateIBAN: (iban: string) => api.get('/bank-accounts/validate-iban', { params: { iban } }),
  archive: (id: string, archived: boolean) => api.post(`/bank-accounts/${id}/archive`, { archived }),
  archiveBulk: (ids: string[], archived: boolean) => api.post('/bank-accounts/archive-bulk', { ids, archived }),
}

// Bank Statement API (Treasury)
export const bankStatementAPI = {
  // Statements
  list: (bankAccountId: string, params?: { year?: number; status?: string }) =>
    api.get(`/bank-accounts/${bankAccountId}/statements`, { params }),
  get: (id: string) => api.get(`/bank-statements/${id}`),
  create: (bankAccountId: string, data: {
    date: string
    notes?: string
  }) => api.post(`/bank-accounts/${bankAccountId}/statements`, data),
  update: (id: string, data: {
    date: string
    notes?: string
  }) => api.put(`/bank-statements/${id}`, data),
  delete: (id: string) => api.delete(`/bank-statements/${id}`),
  validate: (id: string) => api.post(`/bank-statements/${id}/validate`),
  unvalidate: (id: string) => api.post(`/bank-statements/${id}/unvalidate`),
  importCSV: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/bank-statements/${id}/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // Lines
  listLines: (statementId: string) => api.get(`/bank-statements/${statementId}/lines`),
  addLine: (statementId: string, data: {
    date: string
    value_date?: string
    reference?: string
    label: string
    debit?: number | null
    credit?: number | null
    category?: string
  }) => api.post(`/bank-statements/${statementId}/lines`, data),
  updateLine: (lineId: string, data: {
    date: string
    value_date?: string
    reference?: string
    label: string
    debit?: number | null
    credit?: number | null
    category?: string
  }) => api.put(`/bank-statement-lines/${lineId}`, data),
  deleteLine: (lineId: string) => api.delete(`/bank-statement-lines/${lineId}`),

  // Line Invoice Links (for unlinking invoices from lines)
  deleteLineInvoice: (linkId: string) => api.delete(`/bank-statement-line-invoices/${linkId}`),
}

// Profile API
export const profileAPI = {
  getProfile: () => api.get('/profile'),
  updateProfile: (data: Record<string, unknown>) => api.put('/profile', data),
  // ⚠️ « /profile/password » n'existe pas côté serveur : seule
  // « /settings/password » est enregistrée, et c'est elle que l'écran des
  // utilisateurs appelle déjà. L'onglet « Mot de passe » du profil ne recevait
  // qu'un 404 rest_no_route, donc un message d'échec générique à chaque essai.
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/settings/password', { current_password: currentPassword, new_password: newPassword }),
  setup2FA: () => api.post('/profile/2fa/setup'),
  verify2FA: (code: string) => api.post('/profile/2fa/verify', { code }),
  disable2FA: (password: string) => api.post('/profile/2fa/disable', { password }),
  generateMobileAccess: () => api.post('/profile/mobile-access'),
  // ⚠️ AUCUNE ROUTE « passkey » N'EXISTE CÔTÉ SERVEUR — vestige du SaaS.
  //
  // Rien dans src/Rest n'enregistre /profile/passkeys ni /auth/passkey/* : la
  // WebAuthn du SaaS n'a pas été reprise. L'onglet « Passkeys » de Mon profil
  // appelle pourtant listPasskeys() à chaque ouverture, d'où les deux 404 en
  // console dès qu'on ouvre l'écran, et chaque bouton de cet onglet échoue de
  // la même façon. Tant que l'onglet n'est pas retiré (ProfilePage.tsx) ou la
  // fonctionnalité écrite côté serveur, ne pas s'appuyer sur ce bloc.
  passkeyRegisterBegin: () => api.post('/profile/passkey/register/begin'),
  passkeyRegisterFinish: (challengeToken: string, response: any, friendlyName?: string) =>
    api.post('/profile/passkey/register/finish', { challengeToken, response, friendlyName }),
  listPasskeys: () => api.get('/profile/passkeys'),
  deletePasskey: (id: string) => api.delete(`/profile/passkeys/${id}`),
  deleteAllPasskeys: () => api.delete('/profile/passkeys'),
  renamePasskey: (id: string, friendlyName: string) => api.put(`/profile/passkeys/${id}`, { friendlyName }),
}

// Admin API — VESTIGE DU SaaS, NON REPRIS.
//
// ⚠️ Aucune de ces routes n'existe dans AMS Studio : il n'y a plus de locataires à
// administrer, un seul site, une seule société. Le rôle « super_admin » que
// l'écran attendait n'est d'ailleurs jamais rendu par Api::currentRole(), si
// bien que l'entrée de menu qui menait ici ne s'affichait pour personne — elle
// a été retirée de MainLayout. Ce bloc n'est gardé que le temps de décider du
// sort de app/src/pages/admin/AdminPage.tsx, qui en dépend encore : ne pas s'en
// servir pour du code neuf.
export const adminAPI = {
  listTenants: (search?: string) => api.get('/admin/tenants', { params: { search } }),
  getTenant: (id: string) => api.get(`/admin/tenants/${id}`),
  updateTenant: (id: string, data: Record<string, unknown>) => api.put(`/admin/tenants/${id}`, data),
  updateTenantStatus: (id: string, status: string) => api.put(`/admin/tenants/${id}/status`, { status }),
  deleteTenant: (id: string) => api.delete(`/admin/tenants/${id}`),
  getGlobalStats: () => api.get('/admin/stats'),
  getAuditLogs: (params?: Record<string, unknown>) => api.get('/admin/audit-logs', { params }),
  // Plans
  listPlans: () => api.get('/admin/plans'),
  createPlan: (data: Record<string, unknown>) => api.post('/admin/plans', data),
  updatePlan: (id: string, data: Record<string, unknown>) => api.put(`/admin/plans/${id}`, data),
  deletePlan: (id: string) => api.delete(`/admin/plans/${id}`),
  // Health
  getSystemHealth: () => api.get('/admin/health'),
  // Security settings (fail2ban/geoblocking)
  getSecuritySettings: () => api.get('/admin/security'),
  updateSecuritySetting: (key: string, value: unknown) => api.put(`/admin/security/${key}`, value),
  // Global default permissions
  getDefaultPermissions: () => api.get('/admin/permissions'),
  updateDefaultPermissions: (permissions: Array<{role: string, module: string, permission: string}>) =>
    api.put('/admin/permissions', { permissions }),
  // PDF Templates
  listPDFTemplates: () => api.get('/admin/pdf-templates'),
  getPDFTemplate: (id: string) => api.get(`/admin/pdf-templates/${id}`),
  createPDFTemplate: (data: any) => api.post('/admin/pdf-templates', data),
  updatePDFTemplate: (id: string, data: any) => api.put(`/admin/pdf-templates/${id}`, data),
  deletePDFTemplate: (id: string) => api.delete(`/admin/pdf-templates/${id}`),
  duplicatePDFTemplate: (id: string, name: string) => api.post(`/admin/pdf-templates/${id}/duplicate`, { name }),
  assignTemplateToTenant: (tenantId: string, templateId: string, docType: string) =>
    api.post('/admin/pdf-templates/assign', { tenant_id: tenantId, template_id: templateId, document_type: docType }),
  getTenantTemplateAssignments: (tenantId: string) => api.get(`/admin/pdf-templates/assignments/${tenantId}`),
  removeTenantTemplateAssignment: (tenantId: string, docType: string) =>
    api.delete(`/admin/pdf-templates/assignments/${tenantId}/${docType}`),
}

// ⚠️ EXPORTÉE POUR LES ÉCRANS CHARGÉS À LA DEMANDE.
//
// L'écran d'abonnement porte ses PROPRES appels plutôt que de les ajouter
// ici : le paquet du dépôt ne le contient pas, et son bundle ne doit donc pas
// embarquer même la forme d'une saisie de clé. Un morceau à part,
// supprimable.
export { api }
