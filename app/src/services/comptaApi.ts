import api from './api'

export const comptaAPI = {
  // Config
  getConfig: () => api.get('/compta/config').then(r => r.data),
  updateConfig: (data: any) => api.put('/compta/config', data).then(r => r.data),
  init: (data: any) => api.post('/compta/init', data).then(r => r.data),
  testSage: () => api.post('/compta/test-sage').then(r => r.data),

  // Plan comptable
  listComptes: (params: any) => api.get('/compta/comptes', { params }).then(r => r.data),
  createCompte: (data: any) => api.post('/compta/comptes', data).then(r => r.data),
  updateCompte: (id: string, data: any) => api.put(`/compta/comptes/${id}`, data).then(r => r.data),
  deleteCompte: (id: string) => api.delete(`/compta/comptes/${id}`).then(r => r.data),

  // Exercices
  listExercices: () => api.get('/compta/exercices').then(r => r.data),
  createExercice: (data: any) => api.post('/compta/exercices', data).then(r => r.data),
  closeExercice: (id: string) => api.post(`/compta/exercices/${id}/close`).then(r => r.data),
  deleteExercice: (id: string) => api.delete(`/compta/exercices/${id}`).then(r => r.data),

  // Journaux
  listJournaux: () => api.get('/compta/journaux').then(r => r.data),
  createJournal: (data: any) => api.post('/compta/journaux', data).then(r => r.data),
  updateJournal: (id: string, data: any) => api.put(`/compta/journaux/${id}`, data).then(r => r.data),
  deleteJournal: (id: string) => api.delete(`/compta/journaux/${id}`).then(r => r.data),

  // Écritures
  listEcritures: (params: any) => api.get('/compta/ecritures', { params }).then(r => r.data),
  getEcriture: (id: string) => api.get(`/compta/ecritures/${id}`).then(r => r.data),
  createEcriture: (data: any) => api.post('/compta/ecritures', data).then(r => r.data),
  updateEcriture: (id: string, data: any) => api.put(`/compta/ecritures/${id}`, data).then(r => r.data),
  validateEcriture: (id: string) => api.post(`/compta/ecritures/${id}/validate`).then(r => r.data),
  validateEcrituresBulk: (ids: string[]) => api.post('/compta/ecritures/validate-bulk', { ids }).then(r => r.data),
  deleteEcrituresBulk: (ids: string[]) => api.post('/compta/ecritures/delete-bulk', { ids }).then(r => r.data),
  deleteEcriture: (id: string) => api.delete(`/compta/ecritures/${id}`).then(r => r.data),

  // Génération
  generateNow: () => api.post('/compta/generate').then(r => r.data),

  // Lettrage
  listNonLettrees: (compte: string, compte_aux?: string) =>
    api.get('/compta/lettrage/non-lettrees', { params: { compte, compte_aux } }).then(r => r.data),
  lettrer: (ligne_ids: string[], code?: string) =>
    api.post('/compta/lettrage', { ligne_ids, code }).then(r => r.data),
  listLettrees: (compte: string, compte_aux?: string) =>
    api.get('/compta/lettrage/lettrees', { params: { compte, compte_aux } }).then(r => r.data),
  delettrer: (ligne_ids: string[]) =>
    api.post('/compta/lettrage/delettrer', { ligne_ids }).then(r => r.data),

  // Export Sage
  exportSage: async (data: any) => {
    const resp = await api.post('/compta/export', data, { responseType: 'blob' })
    return resp
  },
  listExportLogs: () => api.get('/compta/export/logs').then(r => r.data),
  importReglements: (from: string, to: string) =>
    api.get('/compta/import-reglements', { params: { from, to } }).then(r => r.data),
  listImportReglements: (only_pending?: boolean) =>
    api.get('/compta/import-reglements/list', { params: { only_pending } }).then(r => r.data),

  // États
  grandLivre: (params: any) => api.get('/compta/etats/grand-livre', { params }).then(r => r.data),
  balance: (params: any) => api.get('/compta/etats/balance', { params }).then(r => r.data),
  journalCentralisateur: (params: any) => api.get('/compta/etats/journal-centralisateur', { params }).then(r => r.data),

  // Clôture
  clotureMensuelle: (exercice_id: string, mois: string) =>
    api.post('/compta/cloture-mensuelle', { exercice_id, mois }).then(r => r.data),

  // Paramètres comptables par article
  listArticleParams: (articleId: string) => api.get(`/compta/articles/${articleId}/params`).then(r => r.data),
  replaceArticleParams: (articleId: string, params: any[]) =>
    api.put(`/compta/articles/${articleId}/params`, { params }).then(r => r.data),

  // Paramètres par défaut (auto-appliqués à chaque nouvel article)
  listDefaultArticleParams: () => api.get('/compta/default-article-params').then(r => r.data),
  replaceDefaultArticleParams: (params: any[]) =>
    api.put('/compta/default-article-params', { params }).then(r => r.data),
  applyDefaultsToAllArticles: (force: boolean) =>
    api.post(`/compta/default-article-params/apply-to-all?force=${force}`).then(r => r.data),

  // Taux/codes TVA (autocomplete dans grilles). Si type fourni, ne retourne que les codes achat ou vente.
  listTaxes: (type?: 'achat' | 'vente') =>
    api.get('/compta/taxes', { params: type ? { type } : undefined }).then(r => r.data),
}
