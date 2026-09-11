import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined, MailOutlined, HomeOutlined } from '@ant-design/icons'
import { authAPI } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

interface RegisterForm {
  email: string
  password: string
  confirmPassword: string
  firstName: string
  lastName: string
  companyName: string
  subdomain: string
}

export default function Register() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)

  useEffect(() => {
    authAPI.getRegistrationStatus()
      .then(res => {
        if (res.data?.enabled === false) {
          message.error(t('registerPage.messages.registrationDisabled'))
          navigate('/login', { replace: true })
        }
      })
      .catch(() => {})
  }, [navigate, t])

  const onFinish = async (values: RegisterForm) => {
    setLoading(true)
    try {
      const response = await authAPI.register({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        companyName: values.companyName,
        subdomain: values.subdomain,
      })

      const { user } = response.data

      setAuth({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenantId: user.tenant_id,
      })

      message.success(t('registerPage.messages.createSuccess'))
      navigate('/dashboard')
    } catch (error) {
      message.error(t('registerPage.messages.createError'))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    height: 46,
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.5px',
          }}
        >
          {t('registerPage.header.title')}
        </h1>
        <p style={{ color: '#64748b', marginTop: 6, fontSize: 15, marginBottom: 0 }}>
          {t('registerPage.header.subtitle')}
        </p>
      </div>

      <Form name="register" onFinish={onFinish} layout="vertical" requiredMark={false}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item
            name="firstName"
            label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.firstName.label')}</span>}
            style={{ flex: 1, marginBottom: 16 }}
            rules={[{ required: true, message: t('registerPage.fields.firstName.required') }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
              placeholder={t('registerPage.fields.firstName.placeholder')}
              size="large"
              style={inputStyle}
            />
          </Form.Item>
          <Form.Item
            name="lastName"
            label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.lastName.label')}</span>}
            style={{ flex: 1, marginBottom: 16 }}
            rules={[{ required: true, message: t('registerPage.fields.lastName.required') }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
              placeholder={t('registerPage.fields.lastName.placeholder')}
              size="large"
              style={inputStyle}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="email"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.email.label')}</span>}
          style={{ marginBottom: 16 }}
          rules={[
            { required: true, message: t('registerPage.fields.email.required') },
            { type: 'email', message: t('registerPage.fields.email.invalid') },
          ]}
        >
          <Input
            prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('registerPage.fields.email.placeholder')}
            size="large"
            style={inputStyle}
          />
        </Form.Item>

        <Form.Item
          name="companyName"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.companyName.label')}</span>}
          style={{ marginBottom: 16 }}
          rules={[{ required: true, message: t('registerPage.fields.companyName.required') }]}
        >
          <Input
            prefix={<HomeOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('registerPage.fields.companyName.placeholder')}
            size="large"
            style={inputStyle}
          />
        </Form.Item>

        <Form.Item
          name="subdomain"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.subdomain.label')}</span>}
          style={{ marginBottom: 16 }}
          rules={[
            { required: true, message: t('registerPage.fields.subdomain.required') },
            { min: 3, message: t('registerPage.fields.subdomain.min') },
            { pattern: /^[a-z0-9-]+$/, message: t('registerPage.fields.subdomain.pattern') },
          ]}
        >
          <Input
            placeholder={t('registerPage.fields.subdomain.placeholder')}
            addonAfter=".erp-saas.com"
            size="large"
            style={{ ...inputStyle, borderRadius: undefined }}
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.password.label')}</span>}
          style={{ marginBottom: 16 }}
          rules={[
            { required: true, message: t('registerPage.fields.password.required') },
            { min: 8, message: t('registerPage.fields.password.min') },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('registerPage.fields.password.placeholder')}
            size="large"
            style={inputStyle}
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label={<span style={{ fontWeight: 500, color: '#334155', fontSize: 13 }}>{t('registerPage.fields.confirmPassword.label')}</span>}
          style={{ marginBottom: 24 }}
          dependencies={['password']}
          rules={[
            { required: true, message: t('registerPage.fields.confirmPassword.required') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error(t('registerPage.fields.confirmPassword.mismatch')))
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
            placeholder={t('registerPage.fields.confirmPassword.placeholder')}
            size="large"
            style={inputStyle}
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
            }}
          >
            {t('registerPage.submit')}
          </Button>
        </Form.Item>

        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#64748b', fontSize: 14 }}>{t('registerPage.login.prompt')} </span>
          <Link to="/login" style={{ fontWeight: 600, fontSize: 14 }}>
            {t('registerPage.login.link')}
          </Link>
        </div>
      </Form>
    </div>
  )
}
