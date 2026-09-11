import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { Card, Result, Spin, Descriptions, Tag, Typography } from 'antd'
import { CheckCircleFilled, SafetyCertificateOutlined } from '@ant-design/icons'
import { amsbmBoot } from '@/services/api'

// ⚠️ « /api/v1 » était l'adresse du SaaS d'origine, et elle ne répond plus rien
// ici : l'API est celle de WordPress. On reprend la base du produit — celle que
// window.amsbmBoot pose au démarrage — plutôt que d'en redéclarer une à part.
const API_URL = amsbmBoot.restUrl

type Verification = {
  valid: boolean
  quote_number: string
  tenant_name: string
  client_name: string
  total_ttc: number
  signatory_name: string
  signed_at: string
  content_hash: string
}

function formatMoney(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '0,00'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR')
}

export default function QuoteVerification() {
  const { t } = useTranslation()
  const { code } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Verification | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!code) return
      setLoading(true)
      try {
        const res = await axios.get(`${API_URL}/public/verify/${code}`)
        if (!cancelled) {
          setData(res.data)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [code])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', padding: 16 }}>
        <Result
          status="error"
          title={t('quoteVerification.error.title')}
          subTitle={t('quoteVerification.error.subtitle')}
        />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px 12px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <div style={{ background: '#52c41a', color: '#fff', padding: '28px', borderRadius: '8px 8px 0 0', textAlign: 'center' }}>
          <CheckCircleFilled style={{ fontSize: 48, marginBottom: 12 }} />
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t('quoteVerification.banner.title')}</div>
          <div style={{ opacity: 0.95, marginTop: 6 }}>
            {t('quoteVerification.banner.subtitle')}
          </div>
        </div>

        <Card bordered={false} style={{ borderRadius: '0 0 8px 8px' }} bodyStyle={{ padding: 28 }}>
          <Descriptions
            column={1}
            bordered
            size="middle"
            labelStyle={{ width: 200, fontWeight: 600 }}
          >
            <Descriptions.Item label={t('quoteVerification.fields.status')}>
              <Tag color="green" icon={<SafetyCertificateOutlined />}>
                {t('quoteVerification.fields.statusValue')}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.issuer')}>{data.tenant_name || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.quoteNumber')}>{data.quote_number}</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.client')}>{data.client_name || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.amountTtc')}>{formatMoney(data.total_ttc)} €</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.signedBy')}>{data.signatory_name}</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.signedAt')}>{formatDateTime(data.signed_at)}</Descriptions.Item>
            <Descriptions.Item label={t('quoteVerification.fields.hash')}>
              <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                {data.content_hash}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 20, color: '#888', fontSize: 13, lineHeight: 1.6 }}>
            {t('quoteVerification.hashNotice')}
          </div>
        </Card>
      </div>
    </div>
  )
}
