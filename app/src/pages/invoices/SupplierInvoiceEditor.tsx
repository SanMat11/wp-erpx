import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Popconfirm, Space, Spin, Table, Tag, Typography, message } from 'antd'
import { CheckOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import api from '@/services/api'
import { useCanValidateDocuments, usePermissionsChargees, usePermissionStore } from '@/stores/permissionStore'
import InvoiceEditor from './InvoiceEditor'

/**
 * L'onglet d'une pièce d'achat : une facture fournisseur, ou son AVOIR.
 *
 * ⚠️ L'AVOIR NE PEUT PAS PASSER PAR L'ÉDITEUR DE FACTURES, PAS ENCORE.
 *
 * InvoiceEditor charge sa pièce par « GET /invoices/{id} », et écrit, valide et
 * imprime par la même racine. Or Invoices::acceptedPostTypes() ne connaît pas
 * « amsbm_pcredit » : sur un avoir FOURNISSEUR, toutes ces routes répondent 404.
 * L'écran s'ouvrait donc sur un formulaire vide, comme pour une facture neuve —
 * la pièce qu'on venait d'établir semblait n'avoir jamais existé.
 *
 * Le contrôleur des factures fournisseurs, lui, les sert : « /supplier-invoices »
 * déclare les deux types (voir SupplierInvoices::acceptedPostTypes). On lit donc
 * l'avoir par là, et on le montre. Le jour où « amsbm_pcredit » entrera dans
 * Invoices::acceptedPostTypes(), cette vue pourra céder la place à l'éditeur
 * complet — et ce fichier redeviendra la ligne qu'il était.
 *
 * Un avoir se lit, se valide et s'imprime ; il ne se saisit pas ligne à ligne :
 * c'est le fournisseur qui l'émet, on l'enregistre tel qu'il est arrivé.
 */

interface SupplierInvoiceEditorProps {
  tabId: string
  documentId?: string
}

interface AvoirLigne {
  id: string
  line_type?: string
  description: string
  quantity: number
  unit_price: number
  tva_rate: number
  total_ht: number
}

interface Avoir {
  id: string
  number: string
  supplier_invoice_number?: string
  is_credit?: boolean
  status: string
  date: string
  due_date?: string
  subject?: string
  notes?: string
  supplier?: { id: string; name: string } | null
  lines?: AvoirLigne[]
  total_ht: number
  total_tva: number
  total_ttc: number
}

export default function SupplierInvoiceEditor({ tabId, documentId }: SupplierInvoiceEditorProps) {
  // Une seule lecture, et seulement sur une pièce existante : un onglet de
  // création n'a rien à demander. Elle sert à savoir À QUI on a affaire — la
  // facture repart aussitôt vers son éditeur, qui refait sa propre lecture.
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-piece', documentId],
    queryFn: async () => (await api.get(`/supplier-invoices/${documentId}`)).data as Avoir,
    enabled: !!documentId,
    // Le genre d'une pièce ne change pas : inutile de le redemander à chaque
    // retour sur l'onglet.
    staleTime: 5 * 60 * 1000,
  })

  if (documentId && isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (data?.is_credit) {
    return <SupplierCreditView avoir={data} />
  }

  return <InvoiceEditor tabId={tabId} documentId={documentId} invoiceType="supplier" />
}

function SupplierCreditView({ avoir }: { avoir: Avoir }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // ⚠️ CET ÉCRAN OFFRAIT « Valider l'avoir » À TOUT LE MONDE. Le serveur refusait
  // bien — la route exige le droit d'écrire sur la pièce d'achat et la capacité
  // de valider —, mais le bouton était là, et le refus n'arrivait qu'au clic.
  // Un bouton qu'on ne peut pas actionner est une promesse qu'on ne tient pas.
  //
  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN : la matrice arrive par un appel,
  // et masquer avant sa réponse ferait clignoter le bouton. Même règle que les
  // affaires, dont cet idiome est repris.
  const droitsConnus = usePermissionsChargees()
  const peutValider = useCanValidateDocuments()
  const peutEcrire = usePermissionStore((etat) => etat.canEdit('supplier_invoices'))
  const offrirLaValidation = !droitsConnus || (peutEcrire && peutValider)

  const couleurs: Record<string, string> = {
    draft: 'default',
    pending_validation: 'orange',
    sent: 'blue',
    partial: 'orange',
    paid: 'green',
    cancelled: 'default',
  }

  const libelles: Record<string, string> = {
    draft: t('supplierInvoices.statusDraft'),
    pending_validation: t('supplierInvoices.statusPendingValidation', 'Attente validation'),
    sent: t('supplierInvoices.statusReceived'),
    validated: t('supplierInvoices.statusReceived'),
    partial: t('supplierInvoices.statusPartial'),
    paid: t('supplierInvoices.statusPaid'),
    cancelled: t('supplierInvoices.statusCancelled'),
  }

  const motif = (e: unknown, repli: string): string => {
    const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string }

    return err?.response?.data?.message || err?.response?.data?.error || err?.message || repli
  }

  const euros = (v: number) => `${(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

  const validerMutation = useMutation({
    mutationFn: () => api.post(`/supplier-invoices/${avoir.id}/validate`),
    onSuccess: () => {
      message.success(t('supplierInvoices.creditValidated', 'Avoir validé : il porte désormais son numéro.'))
      queryClient.invalidateQueries({ queryKey: ['supplier-piece', avoir.id] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => {
      message.error(motif(e, t('supplierInvoices.creditValidateError', "L'avoir n'a pas pu être validé.")))
    },
  })

  // ⚠️ L'ONGLET S'OUVRE AVANT L'APPEL, PAS APRÈS : un window.open() lancé une
  // fois la réponse revenue n'est plus rattaché au clic, et les navigateurs le
  // prennent pour une fenêtre surgissante. Même précaution que la liste.
  const voirPdf = async () => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const reponse = await api.get(`/supplier-invoices/${avoir.id}/pdf`, {
        responseType: 'blob',
        params: { t: Date.now() },
      })
      const url = window.URL.createObjectURL(new Blob([reponse.data as BlobPart], { type: 'application/pdf' }))
      if (onglet) {
        onglet.location.href = url
      } else {
        window.open(url, '_blank', 'noopener')
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      onglet?.close()
      message.error(motif(e, t('supplierInvoices.pdfLoadError')))
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <Space>
            <Tag color="volcano">{t('supplierInvoices.creditTag', 'AV')}</Tag>
            <span>{avoir.number || t('supplierInvoices.noNumber')}</span>
            <Tag color={couleurs[avoir.status] || 'default'}>{libelles[avoir.status] || avoir.status}</Tag>
          </Space>
        }
        extra={
          <Space>
            {avoir.status === 'draft' && offrirLaValidation && (
              <Popconfirm
                title={t('supplierInvoices.creditValidateConfirm', 'Valider cet avoir ?')}
                onConfirm={() => validerMutation.mutate()}
                okText={t('supplierInvoices.yes')}
                cancelText={t('supplierInvoices.no')}
              >
                <Button type="primary" icon={<CheckOutlined />} loading={validerMutation.isPending}>
                  {t('supplierInvoices.creditValidate', "Valider l'avoir")}
                </Button>
              </Popconfirm>
            )}
            <Button icon={<FilePdfOutlined />} onClick={voirPdf}>
              {t('supplierInvoices.tooltipDownloadPdf')}
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('supplierInvoices.creditReadOnly', "Un avoir fournisseur ne se saisit pas : c'est le fournisseur qui l'émet, AMS Studio l'enregistre pour défaire la dette.")}
        />

        {/* Et si le rôle n'a pas le droit d'agir, on le DIT, et on dit à qui le
            demander : sinon l'absence de bouton passe pour un écran cassé. */}
        {droitsConnus && !peutEcrire && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('supplierInvoices.readOnlyTitle', 'Consultation')}
            description={t(
              'supplierInvoices.readOnlyHelp',
              "Vous ouvrez cette pièce en lecture : votre rôle n'a pas le droit d'écrire sur les factures fournisseurs. Demandez le niveau « Créer/modifier » sur le module Factures fournisseurs à un responsable."
            )}
          />
        )}

        <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('supplierInvoices.colSupplier')}>
            {avoir.supplier?.name || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierInvoices.colNumber')}>
            {avoir.supplier_invoice_number || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierInvoices.colDate')}>
            {avoir.date ? dayjs(avoir.date).format('DD/MM/YYYY') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierInvoices.colDueDate')}>
            {avoir.due_date ? dayjs(avoir.due_date).format('DD/MM/YYYY') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierInvoices.colSubject')} span={2}>
            {avoir.subject || '-'}
          </Descriptions.Item>
        </Descriptions>

        <Table<AvoirLigne>
          rowKey="id"
          size="small"
          bordered
          pagination={false}
          dataSource={avoir.lines ?? []}
          columns={[
            { title: t('supplierInvoices.colSubject'), dataIndex: 'description', key: 'description' },
            {
              title: t('receipts.quantity', 'Quantité'),
              dataIndex: 'quantity',
              key: 'quantity',
              align: 'right' as const,
              width: 110,
              render: (v: number) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 }),
            },
            {
              // ⚠️ CETTE COLONNE S'INTITULAIT « Montant HT », comme la dernière.
              // Le tableau affichait donc deux fois le même titre au-dessus de deux
              // chiffres différents — le prix unitaire et le total de la ligne — et
              // rien ne disait lequel était lequel.
              title: t('supplierInvoices.colUnitPrice'),
              dataIndex: 'unit_price',
              key: 'unit_price',
              align: 'right' as const,
              width: 120,
              render: (v: number) => euros(v),
            },
            {
              title: t('supplierInvoices.colVat'),
              dataIndex: 'tva_rate',
              key: 'tva_rate',
              align: 'right' as const,
              width: 80,
              render: (v: number) => `${v || 0} %`,
            },
            {
              title: t('supplierInvoices.colTotalHT'),
              dataIndex: 'total_ht',
              key: 'total_ht',
              align: 'right' as const,
              width: 130,
              render: (v: number) => <strong>{euros(v)}</strong>,
            },
          ]}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Descriptions size="small" column={1} bordered style={{ minWidth: 320 }}>
            <Descriptions.Item label={t('supplierInvoices.colTotalHT')}>{euros(avoir.total_ht)}</Descriptions.Item>
            <Descriptions.Item label={t('supplierInvoices.colVat')}>{euros(avoir.total_tva)}</Descriptions.Item>
            <Descriptions.Item label={t('supplierInvoices.colTotalTTC')}>
              <Typography.Text strong>{euros(avoir.total_ttc)}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    </div>
  )
}
