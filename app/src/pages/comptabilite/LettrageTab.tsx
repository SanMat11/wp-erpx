import { useMemo, useState } from 'react'
import { Table, Input, Button, Space, message, Alert, Card, Tag, Popconfirm, Select, Empty } from 'antd'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'

/**
 * ⚠️ ON NE LETTRE PAS À L'AVEUGLE.
 *
 * L'écran listait les cinquante-quatre lignes d'un compte COLLECTIF — 4011,
 * « Fournisseurs » — sans dire à quel TIERS chacune appartenait. Le comptable
 * cochait au hasard, et le serveur, qui refuse depuis peu de rapprocher deux
 * tiers différents, répondait un refus incompréhensible : rien à l'écran ne
 * disait qu'on venait de mêler deux fournisseurs.
 *
 * Le tiers est déjà servi par la route, dans `compte_aux` (« 4011CLI0035 ») :
 * aucun changement d'API n'était nécessaire. Son libellé se lit dans le plan
 * comptable, où le compte auxiliaire porte le nom du tiers.
 */
export default function LettrageTab() {
  const { t } = useTranslation()
  const [compte, setCompte] = useState('')
  const [compteAux, setCompteAux] = useState('')
  const [tiersFiltre, setTiersFiltre] = useState<string | undefined>()
  const [selected, setSelected] = useState<string[]>([])

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['compta.non-lettrees', compte, compteAux],
    queryFn: () => comptaAPI.listNonLettrees(compte, compteAux || undefined),
    enabled: !!compte,
  })

  // Les lignes DÉJÀ lettrées. Sans cette liste, une erreur de lettrage ne se
  // défaisait pas : la route existait côté serveur, aucun écran ne l'appelait.
  const { data: lettrees, refetch: refetchLettrees } = useQuery({
    queryKey: ['compta.lettrees', compte, compteAux],
    queryFn: () => comptaAPI.listLettrees(compte, compteAux || undefined),
    enabled: !!compte,
  })

  // Le NOM du tiers, pas seulement son numéro. Les comptes auxiliaires d'un
  // collectif commencent tous par le numéro du collectif : une recherche sur
  // « 4011 » les ramène tous, avec leur libellé.
  const { data: comptes } = useQuery({
    queryKey: ['compta.comptes.aux', compte],
    queryFn: () => comptaAPI.listComptes({ search: compte, page_size: 500 }),
    enabled: !!compte,
    staleTime: 5 * 60 * 1000,
  })
  const nomsTiers = useMemo(() => {
    const noms: Record<string, string> = {}
    for (const c of (comptes?.items || [])) {
      noms[String(c.numero)] = String(c.libelle || '')
    }

    return noms
  }, [comptes?.items])

  const lignes: any[] = useMemo(() => data?.items || [], [data?.items])

  /** Le tiers d'une ligne : son compte auxiliaire, ou le collectif à défaut. */
  const tiersDe = (l: any) => String(l.compte_aux || '')
  const libelleTiers = (aux: string) =>
    '' === aux
      ? t('comptaLettrage.sansTiers', 'Sans tiers')
      : (nomsTiers[aux] ? `${aux} — ${nomsTiers[aux]}` : aux)

  /** Les tiers présents dans le résultat, avec le nombre de lignes de chacun. */
  const tiersPresents = useMemo(() => {
    const parTiers: Record<string, number> = {}
    for (const l of lignes) {
      const aux = tiersDe(l)
      parTiers[aux] = (parTiers[aux] || 0) + 1
    }

    return Object.entries(parTiers).sort(([a], [b]) => a.localeCompare(b))
  }, [lignes])

  const affichees = useMemo(
    () => (undefined === tiersFiltre ? lignes : lignes.filter((l: any) => tiersDe(l) === tiersFiltre)),
    [lignes, tiersFiltre]
  )

  const lettrerMut = useMutation({
    mutationFn: (ids: string[]) => comptaAPI.lettrer(ids),
    onSuccess: (r: any) => { message.success(t('comptaLettrage.lettrageApplied', { code: r.code })); setSelected([]); refetch(); refetchLettrees() },
    onError: (e: any) => message.error(motifRefus(e, t('comptaLettrage.error'))),
  })

  const delettrerMut = useMutation({
    mutationFn: (ids: string[]) => comptaAPI.delettrer(ids),
    onSuccess: (r: any) => { message.success(t('comptaLettrage.unlettered', { count: r.lignes })); refetch(); refetchLettrees() },
    onError: (e: any) => message.error(motifRefus(e, t('comptaLettrage.error'))),
  })

  // Groupé par code : on délettre un rapprochement entier, pas une ligne isolée
  // — défaire la moitié d'un lettrage laisserait un code qui ne rapproche plus
  // rien, et un solde qui ne veut plus dire grand-chose.
  const groupes: Record<string, any[]> = {}
  for (const l of (lettrees?.items || [])) {
    (groupes[l.lettrage] = groupes[l.lettrage] || []).push(l)
  }

  const selectionnees = lignes.filter((l: any) => selected.includes(l.id))
  const totalDebit = selectionnees.reduce((s: number, l: any) => s + (l.debit || 0), 0)
  const totalCredit = selectionnees.reduce((s: number, l: any) => s + (l.credit || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  // ⚠️ Le refus du serveur, DIT AVANT de partir. « Un lettrage ne rapproche que
  // les mouvements d'un même tiers » : la sélection qui en mêle deux part pour
  // rien, et l'utilisateur ne sait pas pourquoi. On le lui montre ici, avec le
  // nom des tiers en cause.
  const tiersSelectionnes = Array.from(new Set(selectionnees.map(tiersDe)))
  const melangeDesTiers = tiersSelectionnes.length > 1

  return (
    <div>
      <Alert message={t('comptaLettrage.alert')} description={t('comptaLettrage.alertTiers', 'Sur un compte collectif, la colonne « Tiers » dit à quel client ou fournisseur appartient chaque ligne : un lettrage ne rapproche que les mouvements d\'un même tiers.')} style={{ marginBottom: 16 }} />
      <Space style={{ marginBottom: 16 }} wrap>
        <Input placeholder={t('comptaLettrage.comptePlaceholder')} value={compte} onChange={e => setCompte(e.target.value)} style={{ width: 180 }} />
        <Input placeholder={t('comptaLettrage.compteAuxPlaceholder')} value={compteAux} onChange={e => setCompteAux(e.target.value)} style={{ width: 180 }} />
        <Button type="primary" onClick={() => refetch()} disabled={!compte}>{t('common.search')}</Button>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 320 }}
          placeholder={t('comptaLettrage.tiersFilter', 'Filtrer par tiers')}
          value={tiersFiltre}
          onChange={(v) => setTiersFiltre(v)}
          disabled={0 === tiersPresents.length}
          options={tiersPresents.map(([aux, n]) => ({ value: aux, label: `${libelleTiers(aux)} (${n})` }))}
        />
        <Button
          type="primary"
          disabled={selected.length < 2 || !isBalanced || melangeDesTiers}
          onClick={() => lettrerMut.mutate(selected)}
          loading={lettrerMut.isPending}
        >
          {t('comptaLettrage.lettrerButton', { count: selected.length })} {selected.length >= 2 && (isBalanced ? t('comptaLettrage.balanced') : t('comptaLettrage.unbalanced'))}
        </Button>
      </Space>

      {melangeDesTiers && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('comptaLettrage.mixedTiers', 'La sélection mêle plusieurs tiers : le lettrage sera refusé.')}
          description={tiersSelectionnes.map(libelleTiers).join(' · ')}
        />
      )}

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={affichees}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
        pagination={{ pageSize: 50, showTotal: (n: number) => t('comptaLettrage.lineCount', { count: n, defaultValue: '{{count}} ligne(s) non lettrée(s)' }) }}
        size="small"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                !compte
                  ? t('comptaLettrage.emptyNoAccount', 'Saisissez un compte, puis « Rechercher ».')
                  : (undefined !== tiersFiltre
                    ? t('comptaLettrage.emptyTiers', 'Aucune ligne non lettrée pour ce tiers.')
                    : t('comptaLettrage.emptyAccount', 'Aucune ligne non lettrée sur ce compte : tout est rapproché.'))
              }
            />
          ),
        }}
        columns={[
          { title: t('common.date'), dataIndex: 'ecriture_date', width: 100, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
          // Trier sur le tiers, c'est grouper : les lignes d'un même client se
          // suivent, et se cochent d'un seul regard.
          {
            title: t('comptaLettrage.tiers', 'Tiers'), dataIndex: 'compte_aux', width: 230,
            sorter: (a: any, b: any) => tiersDe(a).localeCompare(tiersDe(b)),
            render: (_: string, rec: any) => {
              const aux = tiersDe(rec)

              return '' === aux
                ? <Tag>{t('comptaLettrage.sansTiers', 'Sans tiers')}</Tag>
                : (
                  <span>
                    <span style={{ fontFamily: 'monospace' }}>{aux}</span>
                    {nomsTiers[aux] ? <span style={{ color: '#8c8c8c' }}> — {nomsTiers[aux]}</span> : null}
                  </span>
                )
            },
          },
          { title: t('comptaLettrage.journal'), dataIndex: 'journal_code', width: 80 },
          { title: t('comptaLettrage.piece'), dataIndex: 'piece_ref', width: 120 },
          { title: t('comptaLettrage.libelle'), dataIndex: 'libelle', ellipsis: true },
          { title: t('comptaLettrage.debit'), dataIndex: 'debit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
          { title: t('comptaLettrage.credit'), dataIndex: 'credit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
        ]}
        // La sélection survit au filtre et à la pagination : le total porte sur
        // TOUT ce qui est coché, pas sur ce qui est visible.
        summary={() => selected.length > 0 ? (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}><b>{t('comptaLettrage.totalSelection', { count: selected.length })}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><b>{totalDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><b>{totalCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        ) : undefined}
      />

      {Object.keys(groupes).length > 0 && (
        <>
          <h3 style={{ marginTop: 28, fontSize: 15 }}>{t('comptaLettrage.letteredTitle')}</h3>
          <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 12 }}>
            {t('comptaLettrage.letteredHelp')}
          </div>
          {Object.entries(groupes).map(([code, lignesGroupe]) => (
            <Card
              key={code}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <Tag color="purple">{code}</Tag>
                  {/* Un groupe lettré appartient à un tiers : il se nomme. */}
                  <span style={{ fontWeight: 400, fontSize: 13 }}>{libelleTiers(tiersDe(lignesGroupe[0]))}</span>
                  <span style={{ fontWeight: 400, fontSize: 13, color: '#8c8c8c' }}>{lignesGroupe.length} {t('comptaLettrage.lines')}</span>
                </Space>
              }
              extra={
                <Popconfirm
                  title={t('comptaLettrage.unletterConfirm', { code })}
                  onConfirm={() => delettrerMut.mutate(lignesGroupe.map((l: any) => l.id))}
                  okText={t('comptaLettrage.unletter')}
                  cancelText={t('common.cancel')}
                >
                  <Button size="small" danger loading={delettrerMut.isPending}>{t('comptaLettrage.unletter')}</Button>
                </Popconfirm>
              }
            >
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                showHeader={false}
                dataSource={lignesGroupe}
                columns={[
                  { dataIndex: 'ecriture_date', width: 100, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
                  { dataIndex: 'compte_aux', width: 130, render: (v: string) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : '' },
                  { dataIndex: 'journal_code', width: 60 },
                  { dataIndex: 'piece_ref', width: 130 },
                  { dataIndex: 'libelle', ellipsis: true },
                  { dataIndex: 'debit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                  { dataIndex: 'credit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
                ]}
              />
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
