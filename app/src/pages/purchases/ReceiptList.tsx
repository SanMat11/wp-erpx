import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, Table, Tag, Space, Button, Input, message, Popconfirm, Tooltip, Select, DatePicker } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { SorterResult } from 'antd/es/table/interface'
import { EyeOutlined, FilePdfOutlined, StopOutlined, SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import dayjs, { Dayjs } from 'dayjs'
import { receiptAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'

/**
 * Les réceptions fournisseurs.
 *
 * ⚠️ CET ÉCRAN N'EXISTAIT PAS, ET SON ABSENCE ÉTAIT SANS ISSUE.
 *
 * Réceptionner une commande créait bien une pièce — numérotée, faisant avancer
 * le reliquat, entrant la marchandise en stock. Mais rien ne la servait : elle
 * ne vivait que dans la base. Une quantité saisie de travers était donc
 * DÉFINITIVE, et le magasinier n'avait aucun moyen de la reprendre.
 *
 * On ne CRÉE pas de réception ici : elle naît du bouton « Recevoir » d'une
 * commande, et elle ne se modifie pas — c'est un fait daté, et le stock en
 * découle. Elle s'ANNULE, et l'annulation fait les deux gestes à la fois : la
 * marchandise ressort du dépôt, la commande redevient due d'autant.
 */

interface ReceiptLine {
  id: string
  description: string
  quantity: number
  unit_price: number
  total_ht: number
  article?: { name?: string; reference?: string } | null
}

interface Receipt {
  id: string
  number: string
  date: string
  status: string
  subject?: string
  total_ht?: number
  total_ttc?: number
  supplier?: { id: string; name: string } | null
  lines?: ReceiptLine[]
}

// ⚠️ LES QUATRE LIBELLÉS ÉTAIENT ÉCRITS EN DUR, EN FRANÇAIS.
//
// Ils ne passaient par aucune traduction : l'écran restait français quelle que
// soit la langue choisie, et « Reçue » s'affichait au milieu d'une interface en
// anglais. Seule la COULEUR reste ici — elle ne se traduit pas ; le texte se
// demande à i18n au moment du rendu, sans quoi il serait figé au chargement du
// module et ne changerait plus au basculement de langue.
const COULEURS: Record<string, string> = {
  draft: 'default',
  received: 'green',
  invoiced: 'blue',
  cancelled: 'red',
}

const { RangePicker } = DatePicker

export default function ReceiptList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [recherche, setRecherche] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // ⚠️ UNE RÉCEPTION S'OUVRE COMME UNE COMMANDE OU UNE FACTURE : DANS UN ONGLET.
  //
  // Elle n'avait qu'une fenêtre d'aperçu, qui montrait trois champs et affichait
  // « Aucune donnée » à la place de ses lignes — la liste ne les porte pas
  // (Documents::index() rend les pièces sans leur détail). Mais le vrai défaut
  // n'était pas là : c'est qu'une pièce du même rang qu'une commande
  // fournisseur s'ouvrait autrement que les autres. La nomenclature d'un
  // document ne se discute pas d'un écran à l'autre.
  const { openDocumentTab } = useDocumentTabsStore()

  const ouvrir = (r: Receipt) =>
    openDocumentTab('receipt', r.id, `${t('receipts.receipt', 'Réception')} ${r.number}`)
  const [statut, setStatut] = useState<string | undefined>()
  const [periode, setPeriode] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  // ⚠️ LE TRI EST CELUI DU SERVEUR.
  //
  // La liste est paginée par le serveur : reclasser les vingt lignes reçues
  // faisait croire que la plus ancienne réception de la base était en tête. La
  // colonne cliquée part donc dans la requête — « sort » et « order », sur la
  // liste blanche de Receipts::ordres() — exactement comme le fait l'écran du
  // stock, dont Stock::ordre() documente ce piège.
  const [tri, setTri] = useState<{ sort?: string; order?: 'asc' | 'desc' }>({})

  const libelles: Record<string, string> = {
    draft: t('receipts.statusDraft', 'Brouillon'),
    received: t('receipts.statusReceived', 'Reçue'),
    invoiced: t('receipts.statusInvoiced', 'Facturée'),
    cancelled: t('receipts.statusCancelled', 'Annulée'),
  }

  const etiquette = (valeur: string) => (
    <Tag color={COULEURS[valeur] || 'default'}>{libelles[valeur] || valeur}</Tag>
  )

  const debut = periode?.[0] ? periode[0].format('YYYY-MM-DD') : undefined
  const fin = periode?.[1] ? periode[1].format('YYYY-MM-DD') : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['receipts', page, pageSize, recherche, statut ?? '', debut ?? '', fin ?? '', tri],
    queryFn: async () => {
      const reponse = await receiptAPI.list({
        page,
        page_size: pageSize,
        search: recherche || undefined,
        status: statut || undefined,
        date_from: debut,
        date_to: fin,
        ...tri,
      })
      return reponse.data as { data: Receipt[]; pagination?: { totalItems?: number; total_items?: number } }
    },
  })

  const receptions = data?.data ?? []
  const total = data?.pagination?.totalItems ?? data?.pagination?.total_items ?? receptions.length

  const annuler = useMutation({
    mutationFn: (id: string) => receiptAPI.cancel(id),
    onSuccess: (reponse) => {
      const sorties = (reponse.data as { stock_moves?: number })?.stock_moves ?? 0
      message.success(
        t('receipts.cancelled', {
          count: sorties,
          defaultValue:
            sorties > 0
              ? 'Réception annulée : {{count}} ligne(s) ressortie(s) du stock, la commande redevient due.'
              : 'Réception annulée, la commande redevient due.',
        })
      )
      // La commande d'origine et le stock changent tous les deux : les deux
      // écrans doivent se relire, sinon l'un des deux ment jusqu'au prochain clic.
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
    },
    onError: (e: Error & { response?: { data?: { message?: string; error?: string } } }) => {
      message.error(e?.response?.data?.message || e?.response?.data?.error || e?.message || t('receipts.cancelError', 'Annulation impossible'))
    },
  })

  const voirPdf = async (id: string) => {
    try {
      const reponse = await receiptAPI.getPdf(id)
      const url = URL.createObjectURL(new Blob([reponse.data as BlobPart], { type: 'application/pdf' }))
      window.open(url, '_blank', 'noopener')
    } catch {
      message.error(t('receipts.pdfError', 'Le PDF de cette réception est indisponible'))
    }
  }

  const colonnes = [
    {
      title: t('receipts.number', 'Numéro'),
      dataIndex: 'number',
      key: 'number',
      sorter: true,
    },
    {
      title: t('receipts.supplier', 'Fournisseur'),
      key: 'supplier',
      render: (_: unknown, r: Receipt) => r.supplier?.name || '-',
      sorter: true,
    },
    {
      title: t('receipts.subject', 'Objet'),
      dataIndex: 'subject',
      key: 'subject',
      render: (v: string) => v || '-',
      sorter: true,
    },
    {
      title: t('receipts.date', 'Date'),
      dataIndex: 'date',
      key: 'date',
      render: (v: string) => (v ? dayjs(v).format('DD/MM/YYYY') : '-'),
      sorter: true,
    },
    {
      title: t('receipts.status', 'Statut'),
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => etiquette(v),
      sorter: true,
    },
    {
      title: t('receipts.actions', 'Actions'),
      key: 'actions',
      width: 140,
      // La colonne des actions n'ouvre pas l'aperçu : chaque bouton ferait
      // deux gestes à la fois — le sien, et l'ouverture de la fiche par-dessus.
      onCell: () => ({ onClick: (e: React.MouseEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() }),
      render: (_: unknown, r: Receipt) => (
        <Space size="small">
          <Tooltip title={t('receipts.preview', 'Aperçu')}>
            <Button type="text" icon={<EyeOutlined />} onClick={() => ouvrir(r)} />
          </Tooltip>
          <Tooltip title={t('receipts.pdf', 'PDF')}>
            <Button type="text" icon={<FilePdfOutlined />} onClick={() => voirPdf(r.id)} />
          </Tooltip>
          {/* Annuler n'a de sens que sur une réception faite : un brouillon
              n'est jamais entré en stock, une réception annulée ou déjà
              facturée ne se défait pas d'un clic. */}
          <Tooltip title={t('receipts.cancel', 'Annuler la réception')}>
            <Popconfirm
              title={t('receipts.cancelTitle', 'Annuler cette réception ?')}
              description={t(
                'receipts.cancelHelp',
                'La marchandise ressortira du stock et la commande redeviendra due.'
              )}
              okText={t('common.yes', 'Oui')}
              cancelText={t('common.no', 'Non')}
              onConfirm={() => annuler.mutate(r.id)}
              disabled={r.status !== 'received'}
            >
              <Button type="text" danger icon={<StopOutlined />} disabled={r.status !== 'received'} />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={t('receipts.title', 'Réceptions fournisseurs')}
        extra={
          <Space wrap>
            <Select
              allowClear
              style={{ width: 170 }}
              placeholder={t('receipts.filterStatus', 'Tous les statuts')}
              value={statut}
              onChange={(v) => {
                setStatut(v)
                setPage(1)
              }}
              options={Object.keys(libelles).map((clef) => ({ value: clef, label: libelles[clef] }))}
            />
            <RangePicker
              allowEmpty={[true, true]}
              format="DD/MM/YYYY"
              value={periode as [Dayjs, Dayjs] | null}
              onChange={(valeurs) => {
                setPeriode(valeurs as [Dayjs | null, Dayjs | null] | null)
                setPage(1)
              }}
            />
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('receipts.search', 'Rechercher…')}
              value={recherche}
              onChange={(e) => {
                setRecherche(e.target.value)
                setPage(1)
              }}
              style={{ width: 260 }}
            />
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={colonnes}
          dataSource={receptions}
          // ⚠️ LE DOUBLE-CLIC N'OUVRAIT RIEN. Commandes, Factures fournisseurs
          // et Fournisseurs ouvrent tous la pièce depuis la ligne ; cet écran
          // était le seul à ne pas répondre. Une réception n'a pas d'éditeur —
          // c'est un fait daté, elle ne se modifie pas — donc « ouvrir la
          // pièce » veut dire l'afficher, lignes comprises. Le clic simple le
          // fait aussi, comme sur la fiche fournisseur : le curseur promet un
          // clic, il doit le tenir.
          onRow={(record) => ({
            onClick: () => ouvrir(record),
            onDoubleClick: () => ouvrir(record),
            style: { cursor: 'pointer' },
          })}
          onChange={(
            _pagination: TablePaginationConfig,
            _filtres: unknown,
            sorter: SorterResult<Receipt> | SorterResult<Receipt>[],
            extra: { action: 'paginate' | 'sort' | 'filter' }
          ) => {
            // Le tableau appelle aussi onChange pour la pagination : sans ce
            // test, changer de page effacerait le tri et ramènerait en page 1.
            if (extra.action !== 'sort') return

            const premier = Array.isArray(sorter) ? sorter[0] : sorter
            const colonne = premier?.columnKey ? String(premier.columnKey) : undefined

            setTri(
              premier?.order
                ? { sort: colonne, order: premier.order === 'descend' ? 'desc' : 'asc' }
                : {}
            )
            // Trier refait un résultat : la page 3 de l'ancien n'a plus de sens.
            setPage(1)
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (nombre) => t('receipts.totalRows', { count: nombre, defaultValue: '{{count}} réception(s)' }),
            onChange: (p, taille) => {
              setPage(p)
              setPageSize(taille)
            },
          }}
        />
      </Card>

    </div>
  )
}
