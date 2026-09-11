import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
    })
  })

  it('should start unauthenticated', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('should set auth on login', () => {
    const user = {
      id: '123',
      email: 'test@test.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'tenant_admin',
      tenantId: '456',
    }

    useAuthStore.getState().setAuth(user)
    const state = useAuthStore.getState()

    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.email).toBe('test@test.com')
  })

  it('should clear state on logout', () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'admin', tenantId: '1' }
    )

    useAuthStore.getState().logout()
    const state = useAuthStore.getState()

    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })
})
