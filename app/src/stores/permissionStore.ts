import { create } from 'zustand'
import { settingsAPI } from '@/services/api'

export type PermissionLevel = 'none' | 'view' | 'edit' | 'full'

export interface PermissionMatrix {
  roles: Array<{ code: string; label: string }>
  modules: Array<{ code: string; label: string }>
  permissions: Record<string, Record<string, PermissionLevel>>
}

interface PermissionState {
  matrix: PermissionMatrix | null
  userRole: string | null
  isLoading: boolean
  error: string | null

  // Actions
  loadPermissions: () => Promise<void>
  setUserRole: (role: string) => void

  // Getters
  hasAccess: (module: string) => boolean
  canView: (module: string) => boolean
  canEdit: (module: string) => boolean
  canValidate: (module: string) => boolean
  getPermissionLevel: (module: string) => PermissionLevel
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  matrix: null,
  userRole: null,
  isLoading: false,
  error: null,

  loadPermissions: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await settingsAPI.getPermissionMatrix()
      set({ matrix: response.data, isLoading: false })
    } catch (error) {
      console.error('Failed to load permissions:', error)
      set({ error: 'Erreur lors du chargement des permissions', isLoading: false })
    }
  },

  setUserRole: (role: string) => {
    set({ userRole: role })
  },

  // super_admin et tenant_admin ont toujours un accès complet
  hasAccess: (module: string): boolean => {
    const { matrix, userRole } = get()
    if (!userRole) return false
    if (userRole === 'super_admin' || userRole === 'tenant_admin') return true
    if (!matrix) return false
    const permission = matrix.permissions[userRole]?.[module]
    return permission !== 'none' && permission !== undefined
  },

  canView: (module: string): boolean => {
    const { matrix, userRole } = get()
    if (!userRole) return false
    if (userRole === 'super_admin' || userRole === 'tenant_admin') return true
    if (!matrix) return false
    const permission = matrix.permissions[userRole]?.[module]
    return ['view', 'edit', 'full'].includes(permission || '')
  },

  canEdit: (module: string): boolean => {
    const { matrix, userRole } = get()
    if (!userRole) return false
    if (userRole === 'super_admin' || userRole === 'tenant_admin') return true
    if (!matrix) return false
    const permission = matrix.permissions[userRole]?.[module]
    return ['edit', 'full'].includes(permission || '')
  },

  canValidate: (module: string): boolean => {
    const { matrix, userRole } = get()
    if (!userRole) return false
    if (userRole === 'super_admin' || userRole === 'tenant_admin') return true
    if (!matrix) return false
    const permission = matrix.permissions[userRole]?.[module]
    return permission === 'full'
  },

  getPermissionLevel: (module: string): PermissionLevel => {
    const { matrix, userRole } = get()
    if (!userRole) return 'none'
    if (userRole === 'super_admin' || userRole === 'tenant_admin') return 'full'
    if (!matrix) return 'none'
    return matrix.permissions[userRole]?.[module] || 'none'
  },
}))

/**
 * Les modules dont les pièces se valident.
 *
 * ⚠️ CETTE LISTE DOIT RESTER LA COPIE EXACTE de
 * `Settings::modulesDocumentaires()` côté serveur : c'est de ces quatre modules
 * seulement que « amsbm_validate_documents » se déduit. En ajouter un ici
 * afficherait le bouton « Valider » à quelqu'un que le serveur refuserait en
 * 403, en oublier un le cacherait à quelqu'un qui en a le droit.
 *
 * Les affaires n'y sont pas : elles n'ont pas de circuit de validation côté
 * serveur (Deals n'hérite pas de Documents).
 */
export const MODULES_DOCUMENTAIRES = ['quotes', 'invoices', 'supplier_invoices', 'purchase_orders']

/**
 * Le droit de valider un document, quel qu'il soit.
 *
 * Il ne commande QUE l'affichage : le bouton « Demande de validation » paraît
 * chez celui qui ne l'a pas, l'entrée « Validé » du menu de statut chez celui
 * qui l'a. C'est le serveur qui refuse (403), jamais l'écran.
 */
export function useCanValidateDocuments(): boolean {
  return usePermissionStore((etat) =>
    MODULES_DOCUMENTAIRES.some((module) => etat.getPermissionLevel(module) === 'full')
  )
}

/**
 * ⚠️ TANT QU'ON NE SAIT PAS, ON NE MONTRE RIEN.
 *
 * La matrice arrive par un appel (MainLayout la charge au montage) : avant sa
 * réponse, getPermissionLevel() rend « none » pour tout le monde. Sans cette
 * garde, le bouton « Demande de validation » s'affichait une seconde chez le
 * responsable qui a pourtant le droit de valider, puis disparaissait — on
 * croyait l'écran instable.
 */
export function usePermissionsChargees(): boolean {
  return usePermissionStore(
    (etat) => null !== etat.matrix || 'tenant_admin' === etat.userRole || 'super_admin' === etat.userRole
  )
}
