import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types'

export { browserSupportsWebAuthn }

export async function registerPasskey(options: PublicKeyCredentialCreationOptionsJSON) {
  return startRegistration({ optionsJSON: options })
}

export async function loginWithPasskey(options: PublicKeyCredentialRequestOptionsJSON) {
  return startAuthentication({ optionsJSON: options })
}
