import { describe, it, expect, beforeEach } from 'vitest'
import { usePermissionStore, PermissionMatrix } from '../permissionStore'

/**
 * Helper to build a permission matrix for testing.
 * Accepts a map of role -> module -> level.
 */
function buildMatrix(
  permissions: Record<string, Record<string, 'none' | 'view' | 'edit' | 'full'>>
): PermissionMatrix {
  const roles = Object.keys(permissions).map((code) => ({ code, label: code }))
  const moduleSet = new Set<string>()
  for (const mods of Object.values(permissions)) {
    for (const m of Object.keys(mods)) moduleSet.add(m)
  }
  const modules = [...moduleSet].map((code) => ({ code, label: code }))
  return { roles, modules, permissions }
}

describe('permissionStore', () => {
  beforeEach(() => {
    usePermissionStore.setState({
      matrix: null,
      userRole: null,
      isLoading: false,
      error: null,
    })
  })

  // --- hasAccess ---

  it('hasAccess returns true for "view"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'view' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(true)
  })

  it('hasAccess returns true for "edit"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'edit' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(true)
  })

  it('hasAccess returns true for "full"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'full' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(true)
  })

  it('hasAccess returns false for "none"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'none' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(false)
  })

  it('hasAccess returns false for undefined module', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'view' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().hasAccess('unknown_module')).toBe(false)
  })

  it('hasAccess returns false when matrix is null (fail-closed)', () => {
    usePermissionStore.setState({ matrix: null, userRole: 'user' })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(false)
  })

  it('hasAccess returns false when userRole is null (fail-closed)', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'full' } }),
      userRole: null,
    })
    expect(usePermissionStore.getState().hasAccess('clients')).toBe(false)
  })

  // --- canEdit ---

  it('canEdit returns true for "edit"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { articles: 'edit' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canEdit('articles')).toBe(true)
  })

  it('canEdit returns true for "full"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { articles: 'full' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canEdit('articles')).toBe(true)
  })

  it('canEdit returns false for "view"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { articles: 'view' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canEdit('articles')).toBe(false)
  })

  it('canEdit returns false for "none"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { articles: 'none' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canEdit('articles')).toBe(false)
  })

  // --- canView ---

  it('canView returns true for "view", "edit", "full"', () => {
    for (const level of ['view', 'edit', 'full'] as const) {
      usePermissionStore.setState({
        matrix: buildMatrix({ user: { stock: level } }),
        userRole: 'user',
      })
      expect(usePermissionStore.getState().canView('stock')).toBe(true)
    }
  })

  it('canView returns false for "none"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { stock: 'none' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canView('stock')).toBe(false)
  })

  // --- canValidate ---

  it('canValidate returns true only for "full"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { devis: 'full' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canValidate('devis')).toBe(true)
  })

  it('canValidate returns false for "edit"', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { devis: 'edit' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().canValidate('devis')).toBe(false)
  })

  // --- getPermissionLevel ---

  it('getPermissionLevel returns the correct level', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'edit' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().getPermissionLevel('clients')).toBe('edit')
  })

  it('getPermissionLevel returns "none" for unknown module', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({ user: { clients: 'edit' } }),
      userRole: 'user',
    })
    expect(usePermissionStore.getState().getPermissionLevel('unknown')).toBe('none')
  })

  it('getPermissionLevel returns "none" when matrix is null', () => {
    usePermissionStore.setState({ matrix: null, userRole: 'user' })
    expect(usePermissionStore.getState().getPermissionLevel('clients')).toBe('none')
  })

  // --- Admin roles always have full access (via matrix configuration) ---

  it('super_admin has full access to all modules', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({
        super_admin: { clients: 'full', articles: 'full', stock: 'full', devis: 'full' },
      }),
      userRole: 'super_admin',
    })
    const state = usePermissionStore.getState()
    expect(state.hasAccess('clients')).toBe(true)
    expect(state.canEdit('clients')).toBe(true)
    expect(state.canValidate('clients')).toBe(true)
    expect(state.hasAccess('stock')).toBe(true)
    expect(state.canEdit('stock')).toBe(true)
  })

  it('tenant_admin has full access to all modules', () => {
    usePermissionStore.setState({
      matrix: buildMatrix({
        tenant_admin: { clients: 'full', articles: 'full', stock: 'full', devis: 'full' },
      }),
      userRole: 'tenant_admin',
    })
    const state = usePermissionStore.getState()
    expect(state.hasAccess('clients')).toBe(true)
    expect(state.canEdit('articles')).toBe(true)
    expect(state.canValidate('devis')).toBe(true)
    expect(state.getPermissionLevel('stock')).toBe('full')
  })

  // --- setUserRole ---

  it('setUserRole updates the role', () => {
    usePermissionStore.getState().setUserRole('manager')
    expect(usePermissionStore.getState().userRole).toBe('manager')
  })
})
