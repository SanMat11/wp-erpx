import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { ShopOutlined, SyncOutlined, ImportOutlined } from '@ant-design/icons'
import api from '@/services/api'

const { Paragraph, Text } = Typography

/**
 * Un incident du pont, tel que le journal le porte désormais.
 *
 * Les entrées écrites par les versions précédentes n'avaient ni geste ni
 * commande : tous les champs restent donc facultatifs côté écran.
 */
interface BridgeError {
  at: string
  when?: string
  operation?: string
  label?: string
  order_id?: number
  order_ref?: string
  document_id?: number
  message: string
  where?: string
}

interface WooSettings {
  enabled: boolean
  invoice_trigger: string
  auto_validate: boolean
  push_products: boolean
  pull_products: boolean
  create_customers: boolean
  refund_creates_credit: boolean
  payout_account_id: string
  available: boolean
  version: string
  products: number
  linked: number
  wc_taxes: boolean
  wc_prices_include_tax: boolean
  wc_currency: string
  errors: BridgeError[]
  gateways: Array<{ id: string; title: string }>
}

interface BankAccount {
  id: string
  label: string
}

interface ImportState {
  state: string
  products: number
  customers: number
  orders: number
}

export default function WooCommerceSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [data, setData] = useState<WooSettings | null>(null)
  const [pending, setPending] = useState<ImportState | null>(null)
  const [accounts, setAccounts] = useState<BankAccount[]>([])

  const load = async () => {
    try {
      const [settings, imported, banks] = await Promise.all([
        api.get<WooSettings>('/settings/woocommerce'),
        api.get<ImportState>('/woocommerce/import'),
        api.get<{ data: BankAccount[] }>('/bank-accounts'),
      ])
      setData(settings.data)
      setPending(imported.data)
      setAccounts(banks.data?.data ?? [])
      // « 0 » veut dire « aucun choix » : le champ doit paraître vide, sinon le
      // client croit avoir désigné un compte qui n'existe pas.
      form.setFieldsValue({
        ...settings.data,
        payout_account_id:
          settings.data.payout_account_id && settings.data.payout_account_id !== '0'
            ? String(settings.data.payout_account_id)
            : undefined,
      })
    } catch {
      message.error('Impossible de lire les réglages de la boutique.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFinish = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      const response = await api.put<WooSettings>('/settings/woocommerce', {
        ...values,
        payout_account_id: values.payout_account_id ?? '0',
      })
      setData(response.data)
      message.success('Réglages enregistrés.')
    } catch {
      message.error("Les réglages n'ont pas pu être enregistrés.")
    } finally {
      setSaving(false)
    }
  }

  // ⚠️ Les routes de la boutique rendent 200 avec { success: false }.
  //
  // Rien ne lève, le catch ne voit donc rien : l'écran annonçait « Catalogue
  // synchronisé : 0 produit(s) » alors que WooCommerce venait d'être désactivé
  // et que rien n'avait été fait. On lit le drapeau avant de crier victoire.
  const refuse = (payload: { success?: boolean; message?: string } | undefined): boolean => {
    if (payload?.success === false) {
      message.error(payload.message || "L'opération n'a pas abouti.")
      load()
      return true
    }

    return false
  }

  const syncTaxes = async (enableTaxes: boolean) => {
    Modal.confirm({
      title: 'Reporter la TVA de l’ERP dans la boutique ?',
      width: 560,
      content: (
        <div>
          <Paragraph>
            Les taux du référentiel (onglet TVA) seront écrits dans les taxes de WooCommerce, qui les
            appliquera au panier.
          </Paragraph>
          <Paragraph type="secondary">
            C’est le référentiel de l’ERP qui fait autorité : deux calculs indépendants sur la même
            vente donneraient un écart de quelques centimes entre ce que le client paie et ce que la
            facture dit.
          </Paragraph>
          {enableTaxes && (
            <Paragraph type="warning">
              Le calcul de la taxe sera <strong>activé</strong> dans WooCommerce. Les prix affichés en
              boutique en tiendront compte.
            </Paragraph>
          )}
        </div>
      ),
      okText: 'Reporter',
      cancelText: 'Annuler',
      onOk: async () => {
        try {
          const response = await api.post('/woocommerce/taxes', { enable_taxes: enableTaxes })

          if (refuse(response.data)) {
            return
          }

          message.success(`${response.data.rates ?? 0} taux reporté(s) dans la boutique.`)

          if (response.data.stale > 0) {
            message.warning(
              t(
                'wooSettings.taxes.stale',
                "{{count}} taux écrit(s) autrefois par AMS Studio ne figurent plus dans le référentiel, et restent actifs dans la boutique. AMS Studio ne supprime pas une ligne de fiscalité : retirez-les depuis WooCommerce → Réglages → TVA si vous ne les voulez plus.",
                { count: response.data.stale }
              ),
              10
            )
          }

          load()
        } catch {
          message.error('Le report des taux a échoué.')
        }
      },
    })
  }

  const syncProducts = async () => {
    setSyncing(true)
    try {
      const response = await api.post('/woocommerce/sync')

      if (refuse(response.data)) {
        return
      }

      message.success(
        t(
          'wooSettings.sync.done',
          'Catalogue synchronisé : {{imported}} produit(s) repris, {{exported}} article(s) publié(s), {{stocks}} stock(s) initialisé(s).',
          {
            imported: response.data.imported ?? 0,
            exported: response.data.exported ?? 0,
            stocks: response.data.stocks ?? 0,
          }
        )
      )
      load()
    } catch {
      message.error('La synchronisation a échoué.')
    } finally {
      setSyncing(false)
    }
  }

  const runImport = (withOrders: boolean) => {
    Modal.confirm({
      title: 'Reprendre les données existantes ?',
      width: 560,
      content: (
        <div>
          <Paragraph>
            AMS Studio va créer un article par produit, un tiers par compte client
            {withOrders ? ', et une facture en brouillon par commande déjà passée' : ''}.
          </Paragraph>
          {withOrders && (
            <Paragraph type="warning">
              Les factures reprises restent <strong>en brouillon</strong>. Les émettre aujourd'hui avec
              des dates anciennes donnerait une numérotation ni continue ni chronologique : à vous de
              les relire et de décider.
            </Paragraph>
          )}
        </div>
      ),
      okText: 'Reprendre',
      cancelText: 'Annuler',
      onOk: async () => {
        try {
          const response = await api.post('/woocommerce/import', {
            customers: true,
            orders: withOrders,
          })

          if (refuse(response.data)) {
            return
          }

          message.success(
            `Reprise effectuée : ${response.data.products ?? 0} produit(s), ${response.data.customers ?? 0} client(s), ${response.data.orders ?? 0} commande(s).`
          )
          load()
        } catch {
          message.error('La reprise a échoué.')
        }
      },
    })
  }

  const declineImport = async () => {
    await api.delete('/woocommerce/import')
    message.info('Compris : AMS Studio ne reprendra pas l’existant.')
    load()
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    )
  }

  if (!data?.available) {
    return (
      <Alert
        type="info"
        showIcon
        message="WooCommerce n'est pas installé sur ce site"
        description="Installez et activez WooCommerce pour relier votre boutique à AMS Studio : produits, comptes clients, commandes, paiements et remboursements."
      />
    )
  }

  return (
    <div>
      <Space size="large" style={{ marginBottom: 24 }}>
        <Statistic title="Produits de la boutique" value={data.products} prefix={<ShopOutlined />} />
        <Statistic title="Articles reliés" value={data.linked} />
        <Statistic title="Devise" value={data.wc_currency} />
      </Space>

      {!data.wc_taxes && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="La boutique ne calcule pas la TVA"
          description="Les taxes sont désactivées dans WooCommerce. AMS Studio appliquera donc le taux de TVA de chaque article — celui du référentiel, réglé dans l'onglet TVA. Les factures resteront justes, mais les totaux affichés dans la boutique et dans l'ERP différeront."
        />
      )}

      {pending?.state === 'pending' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Votre boutique contient déjà des données"
          description={
            <div>
              <Paragraph style={{ marginBottom: 8 }}>
                {pending.products} produit(s), {pending.customers} compte(s) client et {pending.orders}{' '}
                commande(s). Voulez-vous les reprendre dans AMS Studio ? Tant que vous n'aurez pas répondu,
                AMS Studio ne touche pas à l'existant : il suit seulement ce qui se passe à partir de
                maintenant.
              </Paragraph>
              <Space>
                <Button type="primary" icon={<ImportOutlined />} onClick={() => runImport(false)}>
                  Reprendre produits et clients
                </Button>
                <Button onClick={() => runImport(true)}>Reprendre aussi les commandes</Button>
                <Button type="text" onClick={declineImport}>
                  Non merci
                </Button>
              </Space>
            </div>
          }
        />
      )}

      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Card size="small" title="Liaison" style={{ marginBottom: 16 }}>
          <Form.Item name="enabled" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Relier la boutique et l'ERP</Checkbox>
          </Form.Item>
          <Form.Item name="pull_products" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Un produit créé ou modifié dans la boutique met à jour son article</Checkbox>
          </Form.Item>
          <Form.Item name="push_products" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Un article créé ou modifié dans l'ERP met à jour son produit</Checkbox>
          </Form.Item>
          <Form.Item name="create_customers" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>Un compte créé sur la boutique devient un tiers</Checkbox>
          </Form.Item>
        </Card>

        <Card size="small" title="Facturation des commandes" style={{ marginBottom: 16 }}>
          <Form.Item name="invoice_trigger" label="La facture est établie">
            <Radio.Group>
              <Radio value="paid">à l'encaissement du paiement</Radio>
              <Radio value="completed">quand la commande est terminée</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="auto_validate" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>
              Émettre la facture aussitôt
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Émettre, c'est valider : numéro attribué depuis la série continue, montants et client
                figés, empreinte calculée. Décoché, la facture reste en brouillon et attend votre
                relecture.
              </Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {t(
                  'wooSettings.autoValidate.guard',
                  'Dans tous les cas, une facture dont le total ne retombe pas sur celui de la commande n’est jamais émise : elle reste en brouillon, avec le motif, et l’incident apparaît plus bas.'
                )}
              </Text>
            </Checkbox>
          </Form.Item>

          <Form.Item name="refund_creates_credit" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>
              Un remboursement établit un avoir
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Une facture émise ne se modifie pas et ne s'annule pas : elle se contre-passe.
              </Text>
            </Checkbox>
          </Form.Item>
        </Card>

        <Card size="small" title="Encaissements" style={{ marginBottom: 16 }}>
          <Form.Item
            name="payout_account_id"
            label="Compte qui reçoit les versements"
            extra="Le client règle le total facturé, la passerelle garde sa commission, et c'est le net qui arrive ici. La facture est soldée du total, la commission part en charge, et le solde de ce compte est le versement réellement reçu."
          >
            <Select
              allowClear
              placeholder="Le compte par défaut de la trésorerie"
              options={accounts.map((a) => ({ value: String(a.id), label: a.label }))}
            />
          </Form.Item>
        </Card>

        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            Enregistrer
          </Button>
          <Button icon={<SyncOutlined />} loading={syncing} onClick={syncProducts}>
            Synchroniser tout le catalogue
          </Button>
          <Button onClick={() => syncTaxes(!data.wc_taxes)}>
            {data.wc_taxes ? 'Reporter la TVA dans la boutique' : 'Activer et reporter la TVA'}
          </Button>
        </Space>
      </Form>

      {data.gateways?.length > 0 && (
        <>
          <Divider />
          <Card size="small" title="Moyens de paiement de la boutique">
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Le moyen employé est repris sur la facture, dans les conditions de règlement. Le suivi
              des encaissements viendra avec le module de trésorerie.
            </Paragraph>
            <Space wrap>
              {data.gateways.map((gateway) => (
                <Tag key={gateway.id} color="blue">
                  {gateway.title}
                </Tag>
              ))}
            </Space>
          </Card>
        </>
      )}

      {data.errors?.length > 0 && (
        <>
          <Divider />
          <Card
            size="small"
            title={t('wooSettings.incidents.title', 'Incidents de synchronisation')}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('wooSettings.incidents.kept', 'Les 30 derniers')}
              </Text>
            }
          >
            {/*
              ⚠️ Le journal ne se lisait pas. Il portait le message de l'exception
              et le fichier PHP où elle est née — « OrderSync.php:296 » — sans
              jamais dire de QUELLE COMMANDE il s'agissait ni ce que le pont
              essayait de faire. Personne ne pouvait s'en servir, donc personne
              n'allait le voir. On montre maintenant le geste, la commande, la
              pièce et l'heure du site.
            */}
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={t(
                'wooSettings.incidents.hint',
                'Une facture ou un avoir « laissé en brouillon » n’a pas été émis parce que son total ne correspondait pas à celui de la boutique. Corrigez la cause indiquée, puis repassez la commande en « terminée » : le pont reprendra la pièce là où elle est.'
              )}
            />
            <Table<BridgeError>
              size="small"
              rowKey={(row, index) => `${row.at}-${index}`}
              dataSource={data.errors}
              pagination={data.errors.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
              columns={[
                {
                  title: t('wooSettings.incidents.when', 'Quand'),
                  dataIndex: 'when',
                  width: 130,
                  render: (when: string | undefined, row) => (
                    <Text type="secondary">{when || row.at?.slice(0, 16).replace('T', ' ') || '—'}</Text>
                  ),
                },
                {
                  title: t('wooSettings.incidents.what', 'Ce qui a échoué'),
                  dataIndex: 'operation',
                  width: 210,
                  render: (operation: string | undefined) => (
                    <Tag color={operation?.endsWith('.blocked') ? 'orange' : 'red'}>
                      {t(`wooSettings.incidents.operation.${operation ?? 'bridge'}`, operation ?? 'bridge')}
                    </Tag>
                  ),
                },
                {
                  title: t('wooSettings.incidents.where', 'Sur quoi'),
                  key: 'cible',
                  width: 170,
                  render: (_: unknown, row) => (
                    <>
                      {(row.order_ref || row.order_id) && (
                        <div>
                          {t('wooSettings.incidents.order', 'Commande')} {row.order_ref || row.order_id}
                        </div>
                      )}
                      {row.document_id ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('wooSettings.incidents.document', 'Pièce n°')} {row.document_id}
                        </Text>
                      ) : null}
                      {!row.order_ref && !row.order_id && !row.document_id ? <Text type="secondary">—</Text> : null}
                    </>
                  ),
                },
                {
                  title: t('wooSettings.incidents.message', 'Ce qui s’est passé'),
                  dataIndex: 'message',
                  render: (text: string, row) => (
                    <>
                      <div>{text}</div>
                      {row.where ? (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {row.where}
                        </Text>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  )
}
