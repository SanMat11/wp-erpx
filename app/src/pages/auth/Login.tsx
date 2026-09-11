import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Form, Input, Button, message, Divider } from 'antd'
import { UserOutlined, LockOutlined, SafetyOutlined, KeyOutlined } from '@ant-design/icons'
import { authAPI } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { browserSupportsWebAuthn, loginWithPasskey } from '@/utils/webauthn'

interface LoginForm {
  email: string
  password: string
}

export default function Login() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [twoFactorToken, setTwoFactorToken] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const setAuth = useAuthStore((state) => state.setAuth)

  useEffect(() => {
    // Connexion par passkey réactivée (vérification cryptographique go-webauthn côté serveur).
    setPasskeyAvailable(browserSupportsWebAuthn())
    authAPI.getRegistrationStatus()
      .then(res => setRegistrationEnabled(res.data?.enabled !== false))
      .catch(() => setRegistrationEnabled(true))
  }, [])

  const onFinish = async (values: LoginForm) => {
    setLoading(true)
    try {
      const response = await authAPI.login(values.email, values.password)
      const data = response.data

      if (data.two_factor_required) {
        setTwoFactorRequired(true)
        setTwoFactorToken(data.temp_token)
        setLoading(false)
        return
      }

      const { user } = data

      setAuth({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenantId: user.tenant_id,
      })

      message.success(t('loginPage.messages.loginSuccess'))
      window.location.href = '/dashboard'
    } catch (error) {
      message.error(t('loginPage.messages.invalidCredentials'))
    } finally {
      setLoading(false)
    }
  }

  const onVerify2FA = async () => {
    setLoading(true)
    try {
      const response = await authAPI.verify2FA(twoFactorToken, twoFactorCode)
      const { user } = response.data

      setAuth({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenantId: user.tenant_id,
      })

      message.success(t('loginPage.messages.loginSuccess'))
      window.location.href = '/dashboard'
    } catch (error) {
      message.error(t('loginPage.messages.invalid2FACode'))
    } finally {
      setLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true)
    try {
      const beginRes = await authAPI.passkeyLoginBegin()
      const { options, challengeToken } = beginRes.data

      const assertion = await loginWithPasskey(options)

      const finishRes = await authAPI.passkeyLoginFinish(challengeToken, assertion)
      const { user } = finishRes.data

      setAuth({ id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role, tenantId: user.tenant_id })
      message.success(t('loginPage.messages.loginSuccess'))
      window.location.href = '/dashboard'
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') {
        return
      }
      message.error(error?.response?.data?.error || t('loginPage.messages.noPasskeyFound'))
    } finally {
      setPasskeyLoading(false)
    }
  }

  if (twoFactorRequired) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <SafetyOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
            {t('loginPage.twoFactor.title')}
          </h2>
          <p style={{ color: '#64748b', marginTop: 8, fontSize: 14 }}>
            {t('loginPage.twoFactor.subtitle')}
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Input
            size="large"
            placeholder={t('loginPage.twoFactor.codePlaceholder')}
            prefix={<SafetyOutlined style={{ color: '#94a3b8' }} />}
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value)}
            maxLength={10}
            onPressEnter={onVerify2FA}
            autoFocus
            style={{
              height: 48,
              borderRadius: 10,
              border: '1.5px solid #e2e8f0',
              fontSize: 16,
              letterSpacing: '0.15em',
              textAlign: 'center',
            }}
          />
        </div>

        <Button
          type="primary"
          size="large"
          loading={loading}
          block
          onClick={onVerify2FA}
          disabled={twoFactorCode.trim().length < 6}
          style={{
            height: 48,
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 15,
            background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
            border: 'none',
            boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
          }}
        >
          {t('loginPage.twoFactor.verifyButton')}
        </Button>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Button
            type="link"
            onClick={() => {
              setTwoFactorRequired(false)
              setTwoFactorToken('')
              setTwoFactorCode('')
            }}
            style={{ color: '#64748b', fontSize: 13 }}
          >
            {t('loginPage.twoFactor.backToLogin')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.5px',
          }}
        >
          {t('loginPage.header.title')}
        </h1>
        <p style={{ color: '#64748b', marginTop: 6, fontSize: 15, marginBottom: 0 }}>
          {t('loginPage.header.subtitle')}
        </p>
      </div>

      {/* Passkey button */}
      {passkeyAvailable && (
        <>
          <Button
            icon={<KeyOutlined />}
            onClick={handlePasskeyLogin}
            loading={passkeyLoading}
            block
            size="large"
            style={{
              height: 48,
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              border: '1.5px solid #e2e8f0',
              background: '#fff',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'all 0.2s ease',
            }}
          >
            {t('loginPage.passkey.button')}
          </Button>
          <Divider
            plain
            style={{ margin: '20px 0', color: '#94a3b8', fontSize: 13 }}
          >
            {t('loginPage.passkey.divider')}
          </Divider>
        </>
      )}

      {/* Login form */}
      <Form form={form} name="login" onFinish={onFinish} layout="vertical" requiredMark={false}>
        <Form.Item
          name="email"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('loginPage.form.emailLabel')}</span>}
          rules={[
            { required: true, message: t('loginPage.form.emailRequired') },
            { type: 'email', message: t('loginPage.form.emailInvalid') },
          ]}
          style={{ marginBottom: 18 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('loginPage.form.emailPlaceholder')}
            size="large"
            style={{
              height: 46,
              borderRadius: 10,
              border: '1.5px solid #e2e8f0',
              fontSize: 14,
            }}
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('loginPage.form.passwordLabel')}</span>}
          rules={[{ required: true, message: t('loginPage.form.passwordRequired') }]}
          style={{ marginBottom: 28 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('loginPage.form.passwordPlaceholder')}
            size="large"
            style={{
              height: 46,
              borderRadius: 10,
              border: '1.5px solid #e2e8f0',
              fontSize: 14,
            }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 20 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
            style={{
              height: 48,
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 15,
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
              border: 'none',
              boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
              transition: 'all 0.2s ease',
            }}
          >
            {t('loginPage.form.submitButton')}
          </Button>
        </Form.Item>

        {registrationEnabled && (
          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#64748b', fontSize: 14 }}>{t('loginPage.form.noAccount')} </span>
            <Link to="/register" style={{ fontWeight: 600, fontSize: 14 }}>
              {t('loginPage.form.createAccount')}
            </Link>
          </div>
        )}
      </Form>
    </div>
  )
}
