import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Descriptions, Popconfirm, Space, Spin, Table, Tag, Typography, message } from 'antd'
import { CloseOutlined, FilePdfOutlined, LockOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import api from '@/services/api'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'

/**
 * L'onglet d'une RÉCEPTION.
 *
 * ⚠️ UNE RÉCEPTION EST UNE PIÈCE COMME LES AUTRES, ET ELLE S'OUVRE COMME ELLES.
 *
 * Elle n'avait qu'une fenêtre : un aperçu qui montrait trois champs et rien
 * d'autre — et qui, faute de relire la pièce, affichait « Aucune donnée » à la
 * place de ses lignes. On ne lisait pas une réception, on l'entrevoyait.
 *
 * Or c'est un document du même rang qu'une commande fournisseur ou qu'une
 * facture d'achat : même en-tête, même bandeau de statut, même tableau de
 * lignes, même pied de totaux, même bouton de PDF. La nomenclature ne se
 * discute pas d'un écran à l'autre — c'est elle qui fait qu'on reconnaît ce
 * qu'on lit.
 *
 * Elle ne se SAISIT pas pour autant : une réception s'enregistre depuis sa
 * commande, et se défait en l'annulant. D'où la pastille « Non modifiable »,
 * comme sur une commande confirmée.
 */

interface ReceiptEditorProps {
  tabId: string
  documentId?: string
}

interface LigneRecue {
  id: string
  line_type?: string
  description: string
  quantity: number
  unit?: string
  unit_price: number
  tva_rate: number
  total_ht: number
}

interface Reception {
  id: string
  number: string
  status: string
  date: string
  expected_date?: string
  subject?: string
  notes?: string
  reference?: string
  supplier?: { id: string; name: string } | null
  lines?: LigneRecue[]
  total_ht: number
  total_tva: number
  total_ttc: number
}

export default function ReceiptEditor({ tabId, documentId }: ReceiptEditorProps) {
  void tabId

  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const droitsConnus = usePermissionsChargees()
  const peutAnnuler = usePermissionStore((etat) => etat.canValidate('purchase_orders'))
  const montrerLAnnulation = !droitsConnus || peutAnnuler

  const { data: reception, isLoading } = useQuery({
    queryKey: ['receipt', documentId],
    queryFn: async () => (await api.get(`/receipts/${documentId}`)).data as Reception,
    enabled: !!documentId,
  })

  const couleurs: Record<string, string> = {
    draft: 'default',
    received: 'green',
    validated: 'green',
    cancelled: 'red',
  }

  const libelles: Record<string, string> = {
    draft: t('receipts.statusDraft', 'Brouillon'),
    received: t('receipts.statusReceived', 'Reçue'),
    validated: t('receipts.statusReceived', 'Reçue'),
    cancelled: t('receipts.statusCancelled', 'Annulée'),
  }

  const motif = (e: unknown, repli: string): string => {
    const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string }

    return err?.response?.data?.message || err?.response?.data?.error || err?.message || repli
  }

  const euros = (v: number) =>
    `${(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

  const annulerMutation = useMutation({
    mutationFn: () => api.post(`/receipts/${documentId}/cancel`),
    onSuccess: () => {
      message.success(t('receipts.cancelSuccess', 'Réception annulée : la marchandise est ressortie du stock.'))
      queryClient.invalidateQueries({ queryKey: ['receipt', documentId] })
      queryClient.invalidateQueries({ queryKey: ['receipts'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['stock-levels'], refetchType: 'all' })
    },
    onError: (e) => message.error(motif(e, t('receipts.cancelError', "La réception n'a pas pu être annulée.")), 10),
  })

  // ⚠️ L'ONGLET S'OUVRE AVANT L'APPEL, PAS APRÈS : un window.open() lancé une
  // fois la réponse revenue n'est plus rattaché au clic, et les navigateurs le
  // prennent pour une fenêtre surgissante. Même précaution que partout ailleurs.
  const voirPdf = async () => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const reponse = await api.get(`/receipts/${documentId}/pdf`, {
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
      message.error(motif(e, t('receipts.pdfError', 'Le PDF de la réception n’a pas pu être produit.')))
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (!reception) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Typography.Text type="secondary">
          {t('receipts.notFound', 'Cette réception est introuvable.')}
        </Typography.Text>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <Space>
            <span>
              {t('receipts.receipt', 'Réception')} {reception.number}
            </span>
            <Tag color={couleurs[reception.status] || 'default'}>
              {libelles[reception.status] || reception.status}
            </Tag>
            {/* La même pastille que sur une commande confirmée : l'explication
                vit dans la bulle d'aide, pas dans un bandeau qui pousse le
                document vers le bas. */}
            <Tag icon={<LockOutlined />} color="warning" style={{ cursor: 'help' }} title={t(
              'receipts.readOnlyHelp',
              "Une réception ne se saisit pas ici : elle s'enregistre depuis sa commande fournisseur, et se défait en l'annulant — ce qui ressort la marchandise du stock."
            )}>
              {t('receipts.readOnly', 'Non modifiable')}
            </Tag>
          </Space>
        }
        extra={
          <Space>
            {montrerLAnnulation && reception.status !== 'cancelled' && (
              <Popconfirm
                title={t('receipts.cancelConfirm', 'Annuler cette réception ?')}
                description={t(
                  'receipts.cancelDescription',
                  'La marchandise ressort du stock, et la commande redevient à recevoir.'
                )}
                onConfirm={() => annulerMutation.mutate()}
                okText={t('common.yes')}
                cancelText={t('common.no')}
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<CloseOutlined />} loading={annulerMutation.isPending}>
                  {t('receipts.cancel', 'Annuler la réception')}
                </Button>
              </Popconfirm>
            )}
            <Button icon={<FilePdfOutlined />} onClick={voirPdf}>
              {t('receipts.downloadPdf', 'Télécharger le PDF')}
            </Button>
          </Space>
        }
      >
        <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('receipts.supplier', 'Fournisseur')}>
            {reception.supplier?.name || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('receipts.reference', 'Référence')}>
            {reception.reference || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('receipts.date', 'Date')}>
            {reception.date ? dayjs(reception.date).format('DD/MM/YYYY') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('receipts.expectedDate', 'Date prévue')}>
            {reception.expected_date ? dayjs(reception.expected_date).format('DD/MM/YYYY') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('receipts.subject', 'Objet')} span={2}>
            {reception.subject || '-'}
          </Descriptions.Item>
          {reception.notes ? (
            <Descriptions.Item label={t('receipts.notes', 'Notes')} span={2}>
              {reception.notes}
            </Descriptions.Item>
          ) : null}
        </Descriptions>

        <Table<LigneRecue>
          rowKey="id"
          size="small"
          bordered
          pagination={false}
          dataSource={reception.lines ?? []}
          locale={{ emptyText: t('receipts.noLines', 'Cette réception ne porte aucune ligne.') }}
          columns={[
            {
              title: t('receipts.designation', 'Désignation'),
              dataIndex: 'description',
              key: 'description',
            },
            {
              title: t('receipts.quantity', 'Quantité reçue'),
              dataIndex: 'quantity',
              key: 'quantity',
              align: 'right' as const,
              width: 130,
              render: (v: number) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 }),
            },
            {
              title: t('receipts.unitPrice', 'Prix unitaire HT'),
              dataIndex: 'unit_price',
              key: 'unit_price',
              align: 'right' as const,
              width: 140,
              render: (v: number) => euros(v),
            },
            {
              title: 'TVA',
              dataIndex: 'tva_rate',
              key: 'tva_rate',
              align: 'right' as const,
              width: 80,
              render: (v: number) => `${v || 0} %`,
            },
            {
              title: t('receipts.totalHT', 'Total HT'),
              dataIndex: 'total_ht',
              key: 'total_ht',
              align: 'right' as const,
              width: 140,
              render: (v: number) => <strong>{euros(v)}</strong>,
            },
          ]}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Descriptions size="small" column={1} bordered style={{ minWidth: 320 }}>
            <Descriptions.Item label={t('receipts.totalHT', 'Total HT')}>
              {euros(reception.total_ht)}
            </Descriptions.Item>
            <Descriptions.Item label="TVA">{euros(reception.total_tva)}</Descriptions.Item>
            <Descriptions.Item label={t('receipts.totalTTC', 'Total TTC')}>
              <Typography.Text strong>{euros(reception.total_ttc)}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </div>
      </Card>
    </div>
  )
}
