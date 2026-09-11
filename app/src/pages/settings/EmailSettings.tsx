import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Input, Button, message, Spin, Alert, Tag, Space, Divider, Switch, Card } from 'antd'
import { SendOutlined, CheckCircleOutlined, CloseCircleOutlined, SaveOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { settingsAPI } from '@/services/api'

interface EmailData {
  configured: boolean
  smtp_host: string
  smtp_port: string
  smtp_user: string
  smtp_password: string
  smtp_from: string
  smtp_from_name: string
  smtp_secure: boolean
}

export default function EmailSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [emailData, setEmailData] = useState<EmailData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getEmail()
      setEmailData(response.data)
      form.setFieldsValue({
        smtp_host: response.data.smtp_host || '',
        smtp_port: response.data.smtp_port || '587',
        smtp_user: response.data.smtp_user || '',
        smtp_password: response.data.smtp_password || '',
        smtp_from: response.data.smtp_from || '',
        smtp_from_name: response.data.smtp_from_name || '',
        smtp_secure: response.data.smtp_secure ?? true,
      })
    } catch (error) {
      message.error(t('emailSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      const response = await settingsAPI.updateEmail(values)
      setEmailData(response.data)
      message.success(t('emailSettings.saveSuccess'))
    } catch (error: any) {
      message.error(error.response?.data?.error || t('emailSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmail) {
      message.warning(t('emailSettings.testEmailRequired'))
      return
    }

    setSending(true)
    setTestResult(null)
    try {
      await settingsAPI.testEmail(testEmail)
      setTestResult({ ok: true, message: t('emailSettings.testSentTo', { email: testEmail }) })
      message.success(t('emailSettings.testSentSuccess'))
    } catch (error: any) {
      const errMsg = error.response?.data?.error || t('emailSettings.sendError')
      setTestResult({ ok: false, message: errMsg })
      message.error(t('emailSettings.testFailed'))
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h3>{t('emailSettings.title')}</h3>

      {emailData?.configured ? (
        <Alert
          message={t('emailSettings.configuredTitle')}
          description={t('emailSettings.configuredDescription')}
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 24 }}
        />
      ) : (
        <Alert
          message={t('emailSettings.notConfiguredTitle')}
          description={t('emailSettings.notConfiguredDescription')}
          type="warning"
          showIcon
          icon={<CloseCircleOutlined />}
          style={{ marginBottom: 24 }}
        />
      )}

      <Card title={t('emailSettings.serverParamsTitle')} style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <Form.Item
              label={t('emailSettings.smtpHostLabel')}
              name="smtp_host"
              rules={[{ required: true, message: t('emailSettings.smtpHostRequired') }]}
            >
              <Input placeholder="smtp.example.com" />
            </Form.Item>

            <Form.Item
              label={t('emailSettings.portLabel')}
              name="smtp_port"
              rules={[{ required: true, message: t('emailSettings.portRequired') }]}
            >
              <Input placeholder="587" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              label={t('emailSettings.smtpUserLabel')}
              name="smtp_user"
              rules={[{ required: true, message: t('emailSettings.smtpUserRequired') }]}
            >
              <Input placeholder="user@example.com" />
            </Form.Item>

            <Form.Item
              label={t('emailSettings.passwordLabel')}
              name="smtp_password"
              rules={[{ required: true, message: t('emailSettings.passwordRequired') }]}
            >
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="********"
                suffix={
                  <Button
                    type="text"
                    size="small"
                    icon={showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    onClick={() => setShowPassword(!showPassword)}
                  />
                }
              />
            </Form.Item>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              label={t('emailSettings.fromEmailLabel')}
              name="smtp_from"
              rules={[
                { required: true, message: t('emailSettings.fromEmailRequired') },
                { type: 'email', message: t('emailSettings.emailInvalid') }
              ]}
            >
              <Input placeholder="noreply@example.com" />
            </Form.Item>

            <Form.Item
              label={t('emailSettings.fromNameLabel')}
              name="smtp_from_name"
            >
              <Input placeholder={t('emailSettings.fromNamePlaceholder')} />
            </Form.Item>
          </div>

          <Form.Item
            label={t('emailSettings.useTlsLabel')}
            name="smtp_secure"
            valuePropName="checked"
          >
            <Switch checkedChildren={t('common.yes')} unCheckedChildren={t('common.no')} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
            >
              {t('common.save')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title={t('emailSettings.testCardTitle')}>
        <p style={{ color: '#666', marginBottom: 16 }}>
          {t('emailSettings.testCardDescription')}
        </p>

        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={t('emailSettings.testEmailPlaceholder')}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            disabled={!emailData?.configured}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleTestEmail}
            loading={sending}
            disabled={!emailData?.configured}
          >
            {t('emailSettings.send')}
          </Button>
        </Space.Compact>

        {!emailData?.configured && (
          <Alert
            message={t('emailSettings.saveFirstTitle')}
            description={t('emailSettings.saveFirstDescription')}
            type="info"
            style={{ marginTop: 16 }}
          />
        )}

        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => setTestResult(null)}
            message={testResult.ok ? t('emailSettings.testResultSuccess') : t('emailSettings.testResultFailed')}
            description={
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {testResult.message}
                </div>
                {!testResult.ok && /535|5\.7\./.test(testResult.message) && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
                    <strong>{t('emailSettings.credentialsRejected')}</strong> {t('emailSettings.office365Intro')}
                    <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                      <li>{t('emailSettings.office365CheckAddress')}</li>
                      <li>{t('emailSettings.office365SmtpAuth')}</li>
                      <li>{t('emailSettings.office365MfaPrefix')}<strong>{t('emailSettings.office365AppPassword')}</strong>{t('emailSettings.office365MfaSuffix')}</li>
                    </ul>
                  </div>
                )}
              </div>
            }
          />
        )}
      </Card>

      <div style={{ marginTop: 24 }}>
        <h4>{t('emailSettings.commonPortsTitle')}</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.colPort')}</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.colSecurity')}</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}>{t('common.description')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}><Tag color="blue">587</Tag></td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>STARTTLS</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.port587Description')}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}><Tag color="green">465</Tag></td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>SSL/TLS</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.port465Description')}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}><Tag color="orange">25</Tag></td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.port25Security')}</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{t('emailSettings.port25Description')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
