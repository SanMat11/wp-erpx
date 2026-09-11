import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Form, Input, Space, Spin, Switch, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import api, { amsbmBoot } from '@/services/api'

const { Paragraph, Text } = Typography

/**
 * Réglages de l'encaissement en ligne.
 *
 * Ce que le client saisit ici sert à une seule chose : permettre à la page
 * publique d'une facture (« /facture/{jeton} ») d'ouvrir une session de
 * paiement Stripe. Rien n'est encaissé dans le navigateur.
 */
interface StripeData {
  enabled: boolean
  publishable_key: string
  /** ⚠️ Revient masqué (« ******** ») dès qu'une clé est enregistrée. */
  secret_key: string
  /** ⚠️ Masqué lui aussi : c'est ce qui authentifie les appels de Stripe. */
  webhook_secret: string
  /** Adresse à recopier dans Stripe ; le serveur la connaît mieux que nous. */
  webhook_url?: string
  /** « Configuré » est un constat du serveur, pas une case à cocher. */
  configured?: boolean
}

/** Un champ que le serveur a masqué : rien que des étoiles. */
function estMasque(v: unknown): boolean {
  return typeof v === 'string' && /^\*+$/.test(v)
}

export default function StripeSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [data, setData] = useState<StripeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [voirSecret, setVoirSecret] = useState(false)
  const [voirWebhook, setVoirWebhook] = useState(false)

  /**
   * L'adresse que Stripe doit appeler.
   *
   * On affiche celle du serveur quand il l'envoie — lui seul sait sous quelle
   * forme ses permaliens répondent. À défaut, on la reconstruit depuis la base
   * REST du produit, et on la rend absolue : une adresse relative recopiée dans
   * Stripe ne mène nulle part.
   */
  const webhookUrl = (() => {
    if (data?.webhook_url) return data.webhook_url
    try {
      return new URL(`${amsbmBoot.restUrl}/public/stripe/webhook`, window.location.origin).href
    } catch {
      return `${amsbmBoot.restUrl}/public/stripe/webhook`
    }
  })()

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<StripeData>('/settings/stripe')
      setData(res.data)
      form.setFieldsValue({
        enabled: res.data.enabled ?? false,
        publishable_key: res.data.publishable_key || '',
        secret_key: res.data.secret_key || '',
        webhook_secret: res.data.webhook_secret || '',
      })
    } catch (error: any) {
      message.error(
        error?.response?.data?.error ||
          t('stripeSettings.loadError', 'Impossible de lire les réglages de paiement.')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * ⚠️ UNE CLÉ MASQUÉE NE SE RÉENREGISTRE PAS.
   *
   * Le serveur ne renvoie jamais les secrets en clair : le champ revient rempli
   * d'étoiles. Les repousser tels quels écraserait la vraie clé par « ******** »
   * — l'encaissement tomberait au premier enregistrement d'un autre champ, et
   * personne ne ferait le lien. Même travers, même remède que le mot de passe
   * SMTP : on n'envoie le champ que si l'utilisateur l'a réellement changé, et
   * le serveur conserve de son côté la valeur en place quand il reçoit du vide
   * ou des étoiles.
   */
  const onFinish = async (values: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {
      enabled: !!values.enabled,
      publishable_key: String(values.publishable_key || '').trim(),
    }

    for (const champ of ['secret_key', 'webhook_secret'] as const) {
      const saisi = String(values[champ] ?? '').trim()

      if (saisi !== '' && !estMasque(saisi) && saisi !== (data?.[champ] || '')) {
        payload[champ] = saisi
      }
    }

    setSaving(true)
    try {
      const res = await api.put<StripeData>('/settings/stripe', payload)
      setData(res.data)
      form.setFieldsValue({
        enabled: res.data.enabled ?? false,
        publishable_key: res.data.publishable_key || '',
        secret_key: res.data.secret_key || '',
        webhook_secret: res.data.webhook_secret || '',
      })
      message.success(t('stripeSettings.saveSuccess', 'Réglages de paiement enregistrés.'))
    } catch (error: any) {
      message.error(
        error?.response?.data?.error ||
          t('stripeSettings.saveError', "Les réglages n'ont pas pu être enregistrés.")
      )
    } finally {
      setSaving(false)
    }
  }

  const copierWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      message.success(t('stripeSettings.webhookCopied', 'Adresse copiée.'))
    } catch {
      message.error(t('stripeSettings.webhookCopyError', "L'adresse n'a pas pu être copiée ; sélectionnez-la à la main."))
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  const configure = data?.configured ?? (!!data?.publishable_key && !!data?.secret_key)

  return (
    <div style={{ maxWidth: 700 }}>
      <h3>{t('stripeSettings.title', 'Paiement en ligne (Stripe)')}</h3>

      <Paragraph type="secondary">
        {t(
          'stripeSettings.intro',
          'Une fois ces clés renseignées, chaque facture envoyée par courriel propose à votre client un bouton « Régler cette facture ». Le paiement se fait chez Stripe : aucun numéro de carte ne transite par cet ERP.'
        )}
      </Paragraph>

      {configure && data?.enabled ? (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 24 }}
          message={t('stripeSettings.activeTitle', 'Paiement en ligne actif')}
          description={t('stripeSettings.activeDescription', 'Vos clients peuvent régler leurs factures par carte depuis le lien reçu par courriel.')}
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          icon={<CloseCircleOutlined />}
          style={{ marginBottom: 24 }}
          message={t('stripeSettings.inactiveTitle', 'Paiement en ligne inactif')}
          description={t('stripeSettings.inactiveDescription', "Tant que les clés ne sont pas renseignées et l'interrupteur allumé, la page publique d'une facture n'affiche pas de bouton de paiement.")}
        />
      )}

      <Card title={t('stripeSettings.keysCardTitle', 'Clés du compte Stripe')} style={{ marginBottom: 24 }}>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            label={t('stripeSettings.enabledLabel', 'Proposer le paiement en ligne')}
            name="enabled"
            valuePropName="checked"
          >
            <Switch checkedChildren={t('common.yes')} unCheckedChildren={t('common.no')} />
          </Form.Item>

          <Form.Item
            label={t('stripeSettings.publishableKeyLabel', 'Clé publique')}
            name="publishable_key"
            extra={t('stripeSettings.publishableKeyHelp', 'Commence par « pk_ ». Elle n\'est pas secrète.')}
          >
            <Input placeholder="pk_live_..." autoComplete="off" />
          </Form.Item>

          <Form.Item
            label={t('stripeSettings.secretKeyLabel', 'Clé secrète')}
            name="secret_key"
            extra={t('stripeSettings.secretKeyHelp', 'Commence par « sk_ ». Laissez les étoiles en place pour conserver la clé déjà enregistrée.')}
          >
            <Input
              type={voirSecret ? 'text' : 'password'}
              placeholder="sk_live_..."
              autoComplete="new-password"
              suffix={
                <Button
                  type="text"
                  size="small"
                  icon={voirSecret ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  onClick={() => setVoirSecret(!voirSecret)}
                />
              }
            />
          </Form.Item>

          <Form.Item
            label={t('stripeSettings.webhookSecretLabel', 'Secret de signature du webhook')}
            name="webhook_secret"
            extra={t('stripeSettings.webhookSecretHelp', 'Commence par « whsec_ ». Stripe vous le donne à la création du webhook ; sans lui, les règlements ne seront pas enregistrés.')}
          >
            <Input
              type={voirWebhook ? 'text' : 'password'}
              placeholder="whsec_..."
              autoComplete="new-password"
              suffix={
                <Button
                  type="text"
                  size="small"
                  icon={voirWebhook ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  onClick={() => setVoirWebhook(!voirWebhook)}
                />
              }
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
              {t('common.save')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title={t('stripeSettings.webhookCardTitle', 'Adresse du webhook')}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {t(
            'stripeSettings.webhookCardDescription',
            "C'est cet appel de Stripe qui solde la facture après le paiement. Créez un webhook dans Stripe (Développeurs → Webhooks) sur l'adresse ci-dessous, puis recopiez ici le secret de signature qu'il vous donne."
          )}
        </Paragraph>

        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={webhookUrl} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
          <Button icon={<CopyOutlined />} onClick={copierWebhook}>
            {t('stripeSettings.copy', 'Copier')}
          </Button>
        </Space.Compact>

        <Paragraph style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: '#888' }}>
          {t('stripeSettings.webhookEvents', 'Événement à cocher dans Stripe :')}{' '}
          <Text code>checkout.session.completed</Text>
        </Paragraph>
      </Card>
    </div>
  )
}
