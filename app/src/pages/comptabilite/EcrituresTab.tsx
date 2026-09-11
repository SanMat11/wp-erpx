import { useState, useEffect } from 'react'
import { Table, Button, Select, Space, Tag, message, DatePicker, Drawer, Descriptions, Modal, Form, Input, InputNumber, Popconfirm, Collapse, Statistic, Row, Col } from 'antd'
import { CheckOutlined, PlayCircleOutlined, DeleteOutlined, PlusOutlined, CheckCircleOutlined, LockOutlined, WarningOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

/** La flèche que porte une colonne, déduite de l'ordre envoyé au serveur. */
function triCourant(filters: any, colonne: string): 'ascend' | 'descend' | null {
  if (filters.orderby !== colonne) return null

  return filters.order === 'asc' ? 'ascend' : 'descend'
}

/**
 * Le nom d'un exercice, avec CE QUI LE DISTINGUE.
 *
 * ⚠️ Rien n'empêche deux exercices de porter le même code et le même libellé —
 * le banc en a deux, « TAV2044 / TAV essai », l'un sur 2044 et l'autre sur
 * 2046. Le sélecteur de la saisie OD affichait donc deux « TAV essai »
 * identiques : impossible de savoir dans lequel on écrivait, et une écriture
 * passée dans le mauvais exercice ne se rattrape pas d'un clic. Ce sont les
 * dates qui les séparent : elles font partie du nom.
 */
function nomExercice(e: any): string {
  const periode = `${dayjs(e.date_debut).format('DD/MM/YYYY')} → ${dayjs(e.date_fin).format('DD/MM/YYYY')}`

  return `${e.code} — ${e.libelle} (${periode})`
}

/**
 * Le compte rendu d'une opération de lot : ce qui a été FAIT, ce qui a été
 * ÉCARTÉ, et POURQUOI.
 *
 * ⚠️ « 0 validée » N'EST PAS UN COMPTE RENDU. Les routes de lot rendent
 * désormais, pièce par pièce, le motif de ce qu'elles ont laissé de côté —
 * exercice clos, écriture déjà numérotée, pièce introuvable. Sans cet écran,
 * ces phrases écrites par le serveur mouraient dans la réponse HTTP et
 * l'utilisateur lisait « 0 » sans savoir quoi en faire.
 *
 * Un message flottant par pièce noierait l'écran dès dix pièces : on donne donc
 * le décompte d'abord — deux nombres, côte à côte, l'un vert et l'autre orange
 * — et les motifs en dessous, dans un panneau qu'on déplie.
 */
interface Rapport {
  titre: string
  faitesLabel: string
  faites: number
  ecarteesLabel: string
  ecartees: number
  motifs: string[]
}

function ModaleRapport({ rapport, onClose, t }: { rapport: Rapport | null; onClose: () => void; t: (k: string, o?: any) => string }) {
  if (null === rapport) return null

  return (
    <Modal open title={rapport.titre} onCancel={onClose} onOk={onClose} cancelButtonProps={{ style: { display: 'none' } }} width={680}>
      <Row gutter={16} style={{ marginBottom: rapport.motifs.length > 0 ? 16 : 0 }}>
        <Col span={12}>
          <Statistic title={rapport.faitesLabel} value={rapport.faites} valueStyle={{ color: rapport.faites > 0 ? '#389e0d' : undefined }} />
        </Col>
        <Col span={12}>
          <Statistic
            title={rapport.ecarteesLabel}
            value={rapport.ecartees}
            valueStyle={{ color: rapport.ecartees > 0 ? '#d46b08' : undefined }}
            prefix={rapport.ecartees > 0 ? <WarningOutlined /> : undefined}
          />
        </Col>
      </Row>
      {rapport.motifs.length > 0 && (
        <Collapse
          defaultActiveKey={rapport.motifs.length <= 8 ? ['motifs'] : []}
          items={[{
            key: 'motifs',
            label: t('comptaEcritures.reportReasons', { count: rapport.motifs.length, defaultValue: 'Pourquoi ({{count}})' }),
            children: (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {rapport.motifs.map((m, i) => <li key={i} style={{ marginBottom: 6 }}>{m}</li>)}
              </ul>
            ),
          }]}
        />
      )}
    </Modal>
  )
}

export default function EcrituresTab() {
  const { t } = useTranslation()
  // ⚠️ Le tri et la recherche sont SERVEUR, pas navigateur.
  //
  // La liste est paginée (cinquante par page) : trier la page affichée donnerait
  // un ordre faux dès la deuxième page, et une recherche locale ne trouverait
  // que ce qui est déjà chargé. Les trois paramètres partent donc dans la
  // requête, comme le statut, le journal et l'exercice.
  const [filters, setFilters] = useState<any>({ status: '', page: 1, page_size: 50, orderby: 'date', order: 'desc' })
  const [recherche, setRecherche] = useState('')
  const [compte, setCompte] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()
  const [rapport, setRapport] = useState<Rapport | null>(null)
  // Les pièces que la génération laisse hors comptabilité. C'est un ÉTAT que le
  // serveur renvoie à chaque génération, pas un événement : il reste affiché
  // sous la barre d'outils au lieu de disparaître avec la fenêtre.
  const [ecartees, setEcartees] = useState<any[]>([])
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['compta.ecritures', filters],
    queryFn: () => comptaAPI.listEcritures({ ...filters, with_lines: true }),
  })

  // Auto-déplie toutes les écritures dès qu'elles arrivent (async). defaultExpandAllRows
  // ne se déclenche qu'au tout premier render et rate les données chargées plus tard.
  useEffect(() => {
    if (data?.items) {
      setExpandedRowKeys(data.items.filter((e: any) => (e.lignes?.length || 0) > 0).map((e: any) => e.id))
    }
  }, [data])
  const { data: journaux } = useQuery({ queryKey: ['compta.journaux'], queryFn: () => comptaAPI.listJournaux() })
  const { data: exercices } = useQuery({ queryKey: ['compta.exercices'], queryFn: () => comptaAPI.listExercices() })

  const { data: details } = useQuery({
    queryKey: ['compta.ecriture', selectedId],
    queryFn: () => comptaAPI.getEcriture(selectedId!),
    enabled: !!selectedId,
  })

  const generateMut = useMutation({
    mutationFn: () => comptaAPI.generateNow(),
    onSuccess: (r: any) => {
      setEcartees(Array.isArray(r.set_aside) ? r.set_aside : [])
      // Une pièce écartée pour exercice clos n'est pas une erreur et n'est pas
      // « déjà comptabilisée » : c'est du travail en attente d'une réouverture.
      // Le serveur la compte à part, l'écran aussi.
      const motifs: string[] = [
        ...(r.closed > 0 ? [t('comptaEcritures.generateClosed', { count: r.closed, defaultValue: '{{count}} pièce(s) écartée(s) : leur exercice est clos. Rouvrez-le depuis l\'onglet Exercices pour les comptabiliser.' })] : []),
        ...(r.warnings || []),
      ]
      if (r.count > 0) {
        message.success(t('comptaEcritures.entriesGenerated', { count: r.count }))
      } else {
        message.warning(t('comptaEcritures.entriesGeneratedNone', 'Aucune écriture générée.'))
      }
      if (motifs.length > 0 || r.closed > 0) {
        setRapport({
          titre: t('comptaEcritures.reportGenerate', 'Génération des écritures'),
          faitesLabel: t('comptaEcritures.reportGenerated', 'Écritures générées'),
          faites: Number(r.count) || 0,
          ecarteesLabel: t('comptaEcritures.reportSetAside', 'Pièces écartées'),
          ecartees: Number(r.closed) || 0,
          motifs,
        })
      }
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })
  const validateMut = useMutation({
    mutationFn: (id: string) => comptaAPI.validateEcriture(id),
    onSuccess: (r: any) => {
      message.success(t('comptaEcritures.entryValidated'))
      // ⚠️ L'avertissement de numérotation non chronologique est une réserve sur
      // la valeur probante de la série : il se lit, il ne se devine pas.
      if (r?.warnings?.length) {
        setRapport({
          titre: t('comptaEcritures.reportValidateOne', 'Écriture numérotée, avec réserve'),
          faitesLabel: t('comptaEcritures.reportNumbered', 'Écriture numérotée'),
          faites: 1,
          ecarteesLabel: t('comptaEcritures.reportWarnings', 'Avertissements'),
          ecartees: r.warnings.length,
          motifs: r.warnings,
        })
      }
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
      qc.invalidateQueries({ queryKey: ['compta.ecriture'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => comptaAPI.deleteEcriture(id),
    onSuccess: () => { message.success(t('comptaEcritures.entryDeleted')); qc.invalidateQueries({ queryKey: ['compta.ecritures'] }); setSelectedId(null) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })
  const createMut = useMutation({
    mutationFn: (v: any) => comptaAPI.createEcriture(v),
    onSuccess: () => { message.success(t('comptaEcritures.entryCreated')); setCreateOpen(false); createForm.resetFields(); qc.invalidateQueries({ queryKey: ['compta.ecritures'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })
  // ⚠️ UN LOT QUI RÉPOND « 0 VALIDÉE » DOIT DIRE POURQUOI.
  //
  // La route rend maintenant `ignored` et une ligne nommée par pièce écartée —
  // « RV-2026-06-15 : Cette écriture appartient à un exercice clos… ». L'écran
  // se contentait d'un décompte : le comptable voyait « 0 sur 3 » et n'avait
  // aucun moyen de savoir laquelle bloquait, ni ce qu'il fallait faire.
  const validateBulkMut = useMutation({
    mutationFn: (ids: string[]) => comptaAPI.validateEcrituresBulk(ids),
    onSuccess: (r: any) => {
      const ignored = Number(r.ignored ?? (r.requested - r.validated)) || 0
      if (r.validated > 0) {
        message.success(ignored > 0
          ? t('comptaEcritures.entriesValidatedWithIgnored', { count: r.validated, ignored })
          : t('comptaEcritures.entriesValidated', { count: r.validated }))
      } else {
        message.warning(t('comptaEcritures.entriesValidatedNone', { count: ignored, defaultValue: 'Aucune écriture validée : {{count}} écartée(s).' }))
      }
      if (ignored > 0 || r.warnings?.length) {
        setRapport({
          titre: t('comptaEcritures.reportValidateBulk', { count: r.requested, defaultValue: 'Validation de {{count}} écriture(s)' }),
          faitesLabel: t('comptaEcritures.reportValidated', 'Validées'),
          faites: Number(r.validated) || 0,
          ecarteesLabel: t('comptaEcritures.reportIgnored', 'Écartées'),
          ecartees: ignored,
          motifs: r.warnings || [],
        })
      }
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })
  // ⚠️ La clôture mensuelle existait côté serveur et n'était atteignable depuis
  // AUCUN écran. C'est pourtant l'opération que le cabinet demande tous les
  // mois : numéroter d'un coup tout ce qui reste en brouillon sur la période,
  // pour que la série soit continue avant la remise.
  const [clotureMois, setClotureMois] = useState<string>(dayjs().subtract(1, 'month').format('YYYY-MM'))
  const clotureMut = useMutation({
    mutationFn: () => comptaAPI.clotureMensuelle(filters.exercice_id || '', clotureMois),
    onSuccess: (r: any) => {
      message.success(t('comptaEcritures.monthClosed', { count: r.validated, mois: clotureMois }))
      if (r.warnings?.length) {
        setRapport({
          titre: t('comptaEcritures.reportMonthClose', { mois: clotureMois, defaultValue: 'Clôture du mois {{mois}}' }),
          faitesLabel: t('comptaEcritures.reportValidated', 'Validées'),
          faites: Number(r.validated) || 0,
          ecarteesLabel: t('comptaEcritures.reportWarnings', 'Avertissements'),
          ecartees: r.warnings.length,
          motifs: r.warnings,
        })
      }
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })

  // ⚠️ Même règle qu'à la validation : une écriture numérotée ne se supprime
  // pas, elle se contre-passe — et c'est le serveur qui le dit, pièce par
  // pièce. « 0 supprimée » sans ce texte laissait croire à une panne.
  const deleteBulkMut = useMutation({
    mutationFn: (ids: string[]) => comptaAPI.deleteEcrituresBulk(ids),
    onSuccess: (r: any) => {
      const ignored = Number(r.ignored ?? (r.requested - r.deleted)) || 0
      if (r.deleted > 0) {
        message.success(t('comptaEcritures.entriesDeleted', { count: r.deleted }))
      } else {
        message.warning(t('comptaEcritures.entriesDeletedNone', { count: ignored, defaultValue: 'Aucune écriture supprimée : {{count}} écartée(s).' }))
      }
      if (ignored > 0 || r.warnings?.length) {
        setRapport({
          titre: t('comptaEcritures.reportDeleteBulk', { count: r.requested, defaultValue: 'Suppression de {{count}} écriture(s)' }),
          faitesLabel: t('comptaEcritures.reportDeleted', 'Supprimées'),
          faites: Number(r.deleted) || 0,
          ecarteesLabel: t('comptaEcritures.reportIgnored', 'Écartées'),
          ecartees: ignored,
          motifs: r.warnings || [],
        })
      }
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaEcritures.error'))),
  })

  const statusTag = (s: string) => {
    if (s === 'draft') return <Tag color="orange">{t('comptaEcritures.statusDraft')}</Tag>
    if (s === 'validated') return <Tag color="blue">{t('comptaEcritures.statusValidated')}</Tag>
    if (s === 'exported') return <Tag color="green">{t('comptaEcritures.statusExported')}</Tag>
    return <Tag>{s}</Tag>
  }

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => generateMut.mutate()} loading={generateMut.isPending}>
          {t('comptaEcritures.generateButton')}
        </Button>
        <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t('comptaEcritures.manualEntry')}</Button>
        <Select placeholder={t('comptaEcritures.statusPlaceholder')} allowClear value={filters.status || undefined} onChange={v => setFilters({ ...filters, page: 1, status: v || '' })} style={{ width: 140 }}
          options={[{ value: 'draft', label: t('comptaEcritures.statusDraft') }, { value: 'validated', label: t('comptaEcritures.statusValidated') }, { value: 'exported', label: t('comptaEcritures.statusExported') }]} />
        <Select placeholder={t('comptaEcritures.journalPlaceholder')} allowClear value={filters.journal_id || undefined} onChange={v => setFilters({ ...filters, page: 1, journal_id: v })} style={{ width: 160 }}
          options={(journaux?.items || []).map((j: any) => ({ value: j.id, label: `${j.code} - ${j.libelle}` }))} />
        <Select placeholder={t('comptaEcritures.exercicePlaceholder')} allowClear showSearch optionFilterProp="label" value={filters.exercice_id || undefined} onChange={v => setFilters({ ...filters, page: 1, exercice_id: v })} style={{ width: 300 }}
          options={(exercices?.items || []).map((e: any) => ({ value: e.id, label: nomExercice(e) }))} />
        <RangePicker format="DD/MM/YYYY" onChange={(v) => setFilters({ ...filters, page: 1, date_from: v?.[0]?.format('YYYY-MM-DD'), date_to: v?.[1]?.format('YYYY-MM-DD') })} />
        <Input.Search
          allowClear
          style={{ width: 220 }}
          placeholder={t('comptaEcritures.searchPlaceholder', 'Pièce, libellé ou numéro')}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onSearch={(v) => setFilters({ ...filters, page: 1, search: v })}
        />
        {/* « Sur quel compte est passée cette écriture » est la question la plus
            courante, et c'était la seule qu'on ne pouvait pas poser. */}
        <Input.Search
          allowClear
          style={{ width: 180 }}
          placeholder={t('comptaEcritures.accountFilterPlaceholder', 'Filtrer par compte')}
          value={compte}
          onChange={(e) => setCompte(e.target.value)}
          onSearch={(v) => setFilters({ ...filters, page: 1, compte: v })}
        />
      </Space>

      {/* ⚠️ CE QUI RESTE HORS COMPTABILITÉ DOIT SE VOIR SANS AVOIR À REGÉNÉRER.
          La génération rend l'état des pièces mises de côté, avec le motif et la
          date. Le laisser dans la seule fenêtre d'avertissement, c'était le
          perdre au premier clic : ces pièces restent affichées ici, dépliables,
          jusqu'à la génération suivante. */}
      {ecartees.length > 0 && (
        <Collapse
          style={{ marginBottom: 16 }}
          items={[{
            key: 'ecartees',
            label: (
              <span>
                <WarningOutlined style={{ color: '#d46b08', marginRight: 8 }} />
                {t('comptaEcritures.setAsideTitle', { count: ecartees.length, defaultValue: '{{count}} pièce(s) restée(s) hors comptabilité' })}
              </span>
            ),
            children: (
              <Table
                rowKey={(r: any) => r.document_id}
                size="small"
                pagination={false}
                dataSource={ecartees}
                columns={[
                  { title: t('comptaEcritures.colPiece'), dataIndex: 'piece', width: 200 },
                  { title: t('comptaEcritures.setAsideReason', 'Motif'), dataIndex: 'motif' },
                  { title: t('comptaEcritures.setAsideSince', 'Depuis le'), dataIndex: 'le', width: 150, render: (d: string) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '' },
                ]}
              />
            ),
          }]}
        />
      )}

      <Space wrap style={{ marginBottom: 16, padding: 10, background: 'rgba(128,128,128,.06)', borderRadius: 6, width: '100%' }}>
        <span style={{ fontWeight: 600 }}>{t('comptaEcritures.monthlyClose')}</span>
        <DatePicker
          picker="month"
          format="MM/YYYY"
          value={dayjs(clotureMois, 'YYYY-MM')}
          onChange={(v) => v && setClotureMois(v.format('YYYY-MM'))}
          allowClear={false}
          style={{ width: 130 }}
        />
        <Popconfirm
          title={t('comptaEcritures.monthlyCloseConfirm', { mois: clotureMois })}
          description={t('comptaEcritures.monthlyCloseDescription')}
          onConfirm={() => clotureMut.mutate()}
          okText={t('comptaEcritures.close')}
          cancelText={t('common.cancel')}
        >
          <Button icon={<LockOutlined />} loading={clotureMut.isPending}>{t('comptaEcritures.close')}</Button>
        </Popconfirm>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{t('comptaEcritures.monthlyCloseHelp')}</span>
      </Space>

      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 12, padding: 8, background: '#e6f4ff', borderRadius: 6, width: '100%' }}>
          <span><b>{selectedRowKeys.length}</b> {t('comptaEcritures.entriesSelected', { count: selectedRowKeys.length })}</span>
          <Popconfirm
            title={t('comptaEcritures.validateBulkTitle', { count: selectedRowKeys.length })}
            description={t('comptaEcritures.validateBulkDescription')}
            onConfirm={() => validateBulkMut.mutate(selectedRowKeys)}
            okText={t('comptaEcritures.validate')}
            cancelText={t('common.cancel')}
          >
            <Button type="primary" icon={<CheckCircleOutlined />} loading={validateBulkMut.isPending}>
              {t('comptaEcritures.validateSelection')}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={t('comptaEcritures.deleteBulkTitle', { count: selectedRowKeys.length })}
            description={t('comptaEcritures.deleteBulkDescription')}
            onConfirm={() => deleteBulkMut.mutate(selectedRowKeys)}
            okText={t('common.delete')}
            okButtonProps={{ danger: true }}
            cancelText={t('common.cancel')}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleteBulkMut.isPending}>
              {t('comptaEcritures.deleteSelection')}
            </Button>
          </Popconfirm>
          <Button onClick={() => setSelectedRowKeys([])}>{t('comptaEcritures.deselectAll')}</Button>
        </Space>
      )}

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={{
          total: data?.total || 0, current: filters.page, pageSize: filters.page_size,
          showTotal: (n: number) => t('comptaEcritures.entryCount', { count: n, defaultValue: '{{count}} écriture(s)' }),
        }}
        size="small"
        onChange={(pagination: any, _tableFilters: any, sorter: any) => {
          const tri = Array.isArray(sorter) ? sorter[0] : sorter
          // ⚠️ LA COLONNE « DATE » NE POUVAIT PAS SE RENVERSER.
          //
          // Ant Design offre un troisième état, « pas de tri », après croissant
          // et décroissant. Comme l'écran arrive déjà trié sur la date en
          // décroissant, le premier clic tombait sur cet état-là : `sorter.order`
          // arrivait vide, on retombait sur « date desc », et la liste ne
          // bougeait pas. Le comptable cliquait deux, trois fois sans jamais
          // voir la pièce la plus ANCIENNE.
          //
          // Le « pas de tri » n'a de toute façon aucun sens ici : le serveur
          // ordonne toujours. Un clic sur la colonne déjà triée inverse donc le
          // sens, au lieu de ne rien faire.
          const colonne = tri?.field ? String(tri.field) : filters.orderby
          const sens = tri?.order
            ? ('ascend' === tri.order ? 'asc' : 'desc')
            : (colonne === filters.orderby && 'asc' === filters.order ? 'desc' : 'asc')

          setFilters({
            ...filters,
            page: pagination?.current || 1,
            orderby: colonne,
            order: sens,
          })
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
          getCheckboxProps: (rec: any) => ({ disabled: rec.status !== 'draft' }),
        }}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
          expandRowByClick: false,
          rowExpandable: (rec: any) => (rec.lignes?.length || 0) > 0,
          expandedRowRender: (rec: any) => (
            <Table
              size="small"
              showHeader={false}
              pagination={false}
              rowKey="id"
              dataSource={rec.lignes || []}
              style={{ marginLeft: 24, background: '#fafafa' }}
              columns={[
                { dataIndex: 'compte', width: 110, render: (v: string) => <span style={{ color: '#1d4ed8', fontFamily: 'monospace' }}>{v}</span> },
                { dataIndex: 'compte_aux', width: 110, render: (v: string) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : '' },
                { dataIndex: 'libelle', ellipsis: true },
                { dataIndex: 'lettrage', width: 70, align: 'center' as const, render: (v: string) => v ? <Tag color="purple" style={{ marginRight: 0 }}>{v}</Tag> : '' },
                { dataIndex: 'debit', width: 120, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                { dataIndex: 'credit', width: 120, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                { width: 110 }, // espace réservé statut
              ]}
            />
          ),
        }}
        onRow={(rec: any) => ({
          onClick: (e: any) => {
            if (e.target.closest && e.target.closest('.ant-table-selection-column, .ant-checkbox-wrapper, .ant-table-row-expand-icon-cell, .ant-table-expanded-row')) return
            setSelectedId(rec.id)
          },
          style: { cursor: 'pointer' },
        })}
        columns={[
          // « sorter: true » sans comparateur : c'est le serveur qui trie, la
          // colonne ne fait qu'annoncer l'ordre demandé. Les deux colonnes de
          // montants ne sont pas triables — le total d'une écriture est calculé à
          // partir de ses lignes et ne se trie pas en base sans y renoncer.
          { title: t('common.date'), dataIndex: 'date', width: 100, sorter: true, sortOrder: triCourant(filters, 'date'), render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
          { title: t('comptaEcritures.colJournal'), dataIndex: 'journal_code', width: 80, sorter: true, sortOrder: triCourant(filters, 'journal_code') },
          { title: t('comptaEcritures.colNumber'), dataIndex: 'numero', width: 80, sorter: true, sortOrder: triCourant(filters, 'numero') },
          { title: t('comptaEcritures.colPiece'), dataIndex: 'piece_ref', width: 120, sorter: true, sortOrder: triCourant(filters, 'piece_ref'), render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
          { title: t('comptaEcritures.colLabel'), dataIndex: 'libelle', ellipsis: true, sorter: true, sortOrder: triCourant(filters, 'libelle') },
          { title: t('comptaEcritures.colDebit'), dataIndex: 'total_debit', width: 120, align: 'right' as const, render: (v: number) => <b>{v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</b> },
          { title: t('comptaEcritures.colCredit'), dataIndex: 'total_credit', width: 120, align: 'right' as const, render: (v: number) => <b>{v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</b> },
          { title: t('common.status'), dataIndex: 'status', width: 110, sorter: true, sortOrder: triCourant(filters, 'status'), render: statusTag },
        ]}
      />

      <Drawer
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        width={800}
        title={details ? `${t('comptaEcritures.entryTitle')} ${details.journal_code} ${details.numero}` : ''}
        extra={details?.status === 'draft' && (
          <Space>
            <Button type="primary" icon={<CheckOutlined />} onClick={() => validateMut.mutate(details.id)}>{t('comptaEcritures.validate')}</Button>
            <Popconfirm title={t('comptaEcritures.deleteEntryConfirm')} onConfirm={() => deleteMut.mutate(details.id)}>
              <Button danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
            </Popconfirm>
          </Space>
        )}
      >
        {details && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label={t('common.date')}>{dayjs(details.date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label={t('common.status')}>{statusTag(details.status)}</Descriptions.Item>
              <Descriptions.Item label={t('comptaEcritures.colPiece')}>{details.piece_ref}</Descriptions.Item>
              <Descriptions.Item label={t('comptaEcritures.exercice')}>{details.exercice_code}</Descriptions.Item>
              <Descriptions.Item label={t('comptaEcritures.colLabel')} span={2}>{details.libelle}</Descriptions.Item>
              <Descriptions.Item label={t('comptaEcritures.totalDebit')}>{details.total_debit?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</Descriptions.Item>
              <Descriptions.Item label={t('comptaEcritures.totalCredit')}>{details.total_credit?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</Descriptions.Item>
            </Descriptions>
            <Table
              style={{ marginTop: 16 }}
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={details.lignes || []}
              columns={[
                { title: t('comptaEcritures.colAccount'), dataIndex: 'compte', width: 100 },
                { title: t('comptaEcritures.colAux'), dataIndex: 'compte_aux', width: 100 },
                { title: t('comptaEcritures.colLabel'), dataIndex: 'libelle', ellipsis: true },
                { title: t('comptaEcritures.colDebit'), dataIndex: 'debit', width: 100, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                { title: t('comptaEcritures.colCredit'), dataIndex: 'credit', width: 100, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                { title: t('comptaEcritures.colLettrage'), dataIndex: 'lettrage', width: 80 },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* ⚠️ confirmLoading : sans lui, le bouton OK reste cliquable pendant
          l'envoi et un double clic écrit DEUX écritures identiques — rien ne
          dédoublonne côté serveur, et sur une régularisation la balance est
          fausse du double. Même garde que ExercicesTab et PlanComptableTab. */}
      <Modal title={t('comptaEcritures.createModalTitle')} open={createOpen} onCancel={() => setCreateOpen(false)} width={900}
        confirmLoading={createMut.isPending}
        // ⚠️ .catch() : validateFields() REJETTE tant qu'un champ obligatoire
        // manque. Sans lui, chaque « OK » sur une modale vide envoyait une
        // exception non rattrapée dans la console — les messages de champ
        // s'affichaient bien, mais l'application criait à l'erreur pour une
        // saisie simplement incomplète.
        onOk={() => createForm.validateFields().then(v => {
          createMut.mutate({
            ...v, date: v.date.format('YYYY-MM-DD'),
            lignes: v.lignes.map((l: any) => ({ ...l, debit: l.debit || 0, credit: l.credit || 0 })),
          })
        }).catch(() => undefined)}>
        <Form form={createForm} layout="vertical" initialValues={{ lignes: [{}, {}] }}>
          <Space>
            <Form.Item name="journal_id" label={t('comptaEcritures.colJournal')} rules={[{ required: true }]} style={{ width: 250 }}>
              <Select options={(journaux?.items || []).map((j: any) => ({ value: j.id, label: `${j.code} - ${j.libelle}` }))} />
            </Form.Item>
            <Form.Item name="exercice_id" label={t('comptaEcritures.exercice')} rules={[{ required: true }]} style={{ width: 320 }}>
              <Select showSearch optionFilterProp="label" options={(exercices?.items || []).filter((e: any) => e.status === 'open').map((e: any) => ({ value: e.id, label: nomExercice(e) }))} />
            </Form.Item>
            <Form.Item name="date" label={t('common.date')} rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
            <Form.Item name="piece_ref" label={t('comptaEcritures.colPiece')}><Input /></Form.Item>
          </Space>
          <Form.Item name="libelle" label={t('comptaEcritures.colLabel')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.List name="lignes">
            {(fields, { add, remove }) => (
              <>
                <Table size="small" pagination={false} rowKey={(f: any) => f.key}
                  dataSource={fields}
                  columns={[
                    // ⚠️ Le message par défaut d'Ant Design nomme le CHEMIN du
                    // champ : « Le champ 0,compte est obligatoire » — l'index de
                    // ligne du formulaire, servi tel quel à l'utilisateur. Dans
                    // une Form.List, le message doit être écrit à la main.
                    {
                      title: t('comptaEcritures.colAccount'), width: 110,
                      render: (_, _r, idx) => (
                        <Form.Item
                          name={[idx, 'compte']}
                          rules={[{ required: true, message: t('comptaEcritures.lineAccountRequired', { n: idx + 1, defaultValue: 'Le compte de la ligne {{n}} est obligatoire.' }) }]}
                        >
                          <Input />
                        </Form.Item>
                      ),
                    },
                    { title: t('comptaEcritures.colAux'), render: (_, _r, idx) => <Form.Item name={[idx, 'compte_aux']}><Input /></Form.Item>, width: 110 },
                    { title: t('comptaEcritures.colLabel'), render: (_, _r, idx) => <Form.Item name={[idx, 'libelle']}><Input /></Form.Item> },
                    { title: t('comptaEcritures.colDebit'), render: (_, _r, idx) => <Form.Item name={[idx, 'debit']}><InputNumber min={0} step={0.01} style={{ width: '100%' }} /></Form.Item>, width: 110 },
                    { title: t('comptaEcritures.colCredit'), render: (_, _r, idx) => <Form.Item name={[idx, 'credit']}><InputNumber min={0} step={0.01} style={{ width: '100%' }} /></Form.Item>, width: 110 },
                    { title: '', render: (_, _r, idx) => <Button size="small" icon={<DeleteOutlined />} onClick={() => remove(idx)} />, width: 50 },
                  ]}
                />
                <Button block onClick={() => add()} style={{ marginTop: 8 }} icon={<PlusOutlined />}>{t('comptaEcritures.addLine')}</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <ModaleRapport rapport={rapport} onClose={() => setRapport(null)} t={t} />
    </div>
  )
}
