import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, Form, DatePicker, Input, Button, Table, Card, Empty, message } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

/**
 * Un montant, en français.
 *
 * ⚠️ Le zéro d'un total s'écrit « 0,00 », jamais « −0,00 ». Additionner trois
 * cent cinquante décimales binaires laisse un résidu de l'ordre de 10⁻¹¹ : un
 * grand livre équilibré affichait « −0,00 » au pied de sa colonne de solde, ce
 * qui n'est pas un déséquilibre mais en a tout l'air. On arrondit au centime,
 * et le zéro négatif redevient zéro.
 */
const euros = (v: number) => {
  const arrondi = Math.round((v || 0) * 100) / 100

  return (0 === arrondi ? 0 : arrondi).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const somme = (lignes: any[], champ: string) =>
  lignes.reduce((total: number, ligne: any) => total + (Number(ligne[champ]) || 0), 0)

/**
 * Ce que montre un tableau qui n'a rien à montrer.
 *
 * ⚠️ « Rien » se dit de deux façons, et les confondre trompe le comptable : un
 * état qu'on n'a pas encore demandé n'est pas un état vide. Sans ce mot, une
 * balance jamais calculée et une période sans le moindre mouvement rendaient la
 * même page blanche.
 */
function vide(demande: boolean, avantLabel: string, apresLabel: string) {
  return { emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={demande ? apresLabel : avantLabel} /> }
}

export default function EtatsTab() {
  const { t } = useTranslation()
  return (
    <Tabs items={[
      { key: 'gl', label: t('comptaEtats.grandLivre'), children: <GrandLivre /> },
      { key: 'bal', label: t('comptaEtats.balance'), children: <Balance /> },
      { key: 'jc', label: t('comptaEtats.journalCentralisateur'), children: <JournalCentral /> },
    ]} />
  )
}

function GrandLivre() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [data, setData] = useState<any[]>([])
  const mut = useMutation({
    // ⚠️ Pas de bornes inventées. Le repli « 100000 » / « 999999 » est une plage
    // à six chiffres taillée pour le plan français, comparée en TEXTE : sur un
    // plan luxembourgeois — « 4011 », « 516 » — elle faisait disparaître des
    // comptes du grand livre sans le moindre message. Sans borne, le serveur
    // rend tout.
    mutationFn: (v: any) => comptaAPI.grandLivre({
      compte_from: v.compte_from || '',
      compte_to: v.compte_to || '',
      date_from: v.range[0].format('YYYY-MM-DD'),
      date_to: v.range[1].format('YYYY-MM-DD'),
    }),
    onSuccess: (r: any) => setData(r.items || []),
    onError: (e: any) => message.error(motifRefus(e, t('comptaEtats.grandLivreError', 'Le grand livre n\'a pas pu être calculé.'))),
  })

  return (
    <Card>
      <Form form={form} layout="inline" initialValues={{ range: [dayjs().startOf('year'), dayjs().endOf('year')] }} style={{ marginBottom: 16 }}>
        <Form.Item name="compte_from" label={t('comptaEtats.from')}><Input style={{ width: 110 }} placeholder={t('comptaEtats.allAccounts', 'Tous')} /></Form.Item>
        <Form.Item name="compte_to" label={t('comptaEtats.to')}><Input style={{ width: 110 }} placeholder={t('comptaEtats.allAccounts', 'Tous')} /></Form.Item>
        <Form.Item name="range" label={t('comptaEtats.period')} rules={[{ required: true }]}><RangePicker format="DD/MM/YYYY" /></Form.Item>
        <Button type="primary" onClick={() => form.validateFields().then(v => mut.mutate(v)).catch(() => undefined)} loading={mut.isPending}>{t('comptaEtats.display')}</Button>
      </Form>
      {/* ⚠️ Une clé de ligne ne se tire pas au sort. Le Math.random() qui tenait
          lieu de rowKey changeait à chaque rendu : React démontait puis
          remontait les cent lignes de la page à chaque re-rendu, et aucune
          sélection ni aucun état de ligne ne pouvait tenir. La route ne sert
          pas encore l'identifiant de la ligne comptable ; on le prend dès qu'il
          arrive, et on retombe sinon sur le rang, qui est stable. */}
      <Table
        rowKey={(r: any, i?: number) => r.id ?? `${r.compte}-${r.date}-${r.piece_ref}-${i}`}
        dataSource={data}
        pagination={{ pageSize: 100, showTotal: (n: number) => t('comptaEtats.lineCount', { count: n, defaultValue: '{{count}} ligne(s)' }) }}
        size="small"
        locale={vide(mut.isSuccess, t('comptaEtats.emptyBefore', 'Choisissez une période, puis « Afficher ».'), t('comptaEtats.emptyGrandLivre', 'Aucun mouvement sur la période demandée.'))}
        columns={[
          { title: t('comptaEtats.account'), dataIndex: 'compte', width: 100 },
          { title: t('common.date'), dataIndex: 'date', width: 100, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
          { title: t('comptaEtats.journalShort'), dataIndex: 'journal_code', width: 80 },
          { title: t('comptaEtats.piece'), dataIndex: 'piece_ref', width: 120 },
          { title: t('comptaEtats.label'), dataIndex: 'libelle', ellipsis: true },
          { title: t('comptaEtats.debit'), dataIndex: 'debit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
          { title: t('comptaEtats.credit'), dataIndex: 'credit', width: 110, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
          { title: t('comptaEtats.balanceCol'), dataIndex: 'solde', width: 120, align: 'right' as const, render: (v: number) => v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) },
          { title: t('comptaEtats.lettrageShort'), dataIndex: 'lettrage', width: 60 },
        ]}
        summary={() => 0 === data.length ? undefined : ligneDeTotal([
          { index: 0, colSpan: 5, contenu: t('comptaEtats.totalAll', { count: data.length, defaultValue: 'Total général ({{count}} lignes)' }) },
          { index: 5, valeur: somme(data, 'debit') },
          { index: 6, valeur: somme(data, 'credit') },
          { index: 7, valeur: somme(data, 'debit') - somme(data, 'credit') },
          { index: 8, contenu: '' },
        ])}
      />
    </Card>
  )
}

/**
 * ⚠️ UN ÉTAT COMPTABLE SANS LIGNE DE TOTAL N'EST PAS UN ÉTAT.
 *
 * Aucun des trois n'en affichait : les chiffres étaient justes, mais le
 * comptable devait additionner lui-même pour savoir si sa balance tombait —
 * c'est précisément ce que la ligne de total prouve.
 *
 * ⚠️ ET IL PORTE SUR TOUT L'ÉTAT, PAS SUR LA PAGE AFFICHÉE.
 *
 * Le paramètre que passe Ant Design au `summary` est `currentPageData` : les
 * cent lignes visibles, pas les trois cent soixante-quinze de la période. Le
 * grand livre annonçait donc 27 442,40 / 105 555,23 / −78 112,83 là où la
 * vérité — celle de la balance, du journal centralisateur et de la base — est
 * 144 720,76 / 144 720,76 / 0,00. Un total faux sur un état comptable est pire
 * que pas de total du tout : le comptable le recopie.
 *
 * Les trois états sont rendus d'un bloc par le serveur et paginés ici même :
 * l'ensemble est donc à portée de main, et c'est LUI qu'on additionne. Le
 * décompte de lignes affiché à côté du mot « Total » dit sur quoi il porte.
 */
function ligneDeTotal(cellules: Array<{ index: number; colSpan?: number; contenu?: string; valeur?: number; entier?: boolean }>) {
  return (
    <Table.Summary fixed>
      <Table.Summary.Row style={{ fontWeight: 600, background: 'rgba(128,128,128,.06)' }}>
        {cellules.map(({ index, colSpan, contenu, valeur, entier }) => (
          <Table.Summary.Cell key={index} index={index} colSpan={colSpan} align={undefined === valeur ? undefined : 'right'}>
            {undefined === valeur ? contenu : (entier ? String(valeur) : euros(valeur))}
          </Table.Summary.Cell>
        ))}
      </Table.Summary.Row>
    </Table.Summary>
  )
}

function Balance() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [data, setData] = useState<any[]>([])
  const mut = useMutation({
    mutationFn: (v: any) => comptaAPI.balance({
      date_from: v.range[0].format('YYYY-MM-DD'),
      date_to: v.range[1].format('YYYY-MM-DD'),
    }),
    onSuccess: (r: any) => setData(r.items || []),
    onError: (e: any) => message.error(motifRefus(e, t('comptaEtats.balanceError', 'La balance n\'a pas pu être calculée.'))),
  })

  return (
    <Card>
      <Form form={form} layout="inline" initialValues={{ range: [dayjs().startOf('year'), dayjs().endOf('year')] }} style={{ marginBottom: 16 }}>
        <Form.Item name="range" label={t('comptaEtats.period')} rules={[{ required: true }]}><RangePicker format="DD/MM/YYYY" /></Form.Item>
        <Button type="primary" onClick={() => form.validateFields().then(v => mut.mutate(v)).catch(() => undefined)} loading={mut.isPending}>{t('comptaEtats.calculate')}</Button>
      </Form>
      <Table
        rowKey="compte"
        dataSource={data}
        pagination={{ pageSize: 50, showTotal: (n: number) => t('comptaEtats.accountCount', { count: n, defaultValue: '{{count}} compte(s)' }) }}
        size="small"
        locale={vide(mut.isSuccess, t('comptaEtats.emptyBeforeBalance', 'Choisissez une période, puis « Calculer ».'), t('comptaEtats.emptyBalance', 'Aucun compte mouvementé sur la période demandée.'))}
        columns={[
          { title: t('comptaEtats.account'), dataIndex: 'compte', width: 100 },
          { title: t('comptaEtats.label'), dataIndex: 'libelle' },
          { title: t('comptaEtats.totalDebit'), dataIndex: 'total_debit', width: 130, align: 'right' as const, render: (v: number) => v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) },
          { title: t('comptaEtats.totalCredit'), dataIndex: 'total_credit', width: 130, align: 'right' as const, render: (v: number) => v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) },
          { title: t('comptaEtats.balanceDebit'), dataIndex: 'solde_debit', width: 130, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
          { title: t('comptaEtats.balanceCredit'), dataIndex: 'solde_credit', width: 130, align: 'right' as const, render: (v: number) => v ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '' },
        ]}
        summary={() => 0 === data.length ? undefined : ligneDeTotal([
          { index: 0, colSpan: 2, contenu: t('comptaEtats.totalAllAccounts', { count: data.length, defaultValue: 'Total général ({{count}} comptes)' }) },
          { index: 2, valeur: somme(data, 'total_debit') },
          { index: 3, valeur: somme(data, 'total_credit') },
          { index: 4, valeur: somme(data, 'solde_debit') },
          { index: 5, valeur: somme(data, 'solde_credit') },
        ])}
      />
    </Card>
  )
}

function JournalCentral() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [data, setData] = useState<any[]>([])
  const mut = useMutation({
    mutationFn: (v: any) => comptaAPI.journalCentralisateur({
      date_from: v.range[0].format('YYYY-MM-DD'),
      date_to: v.range[1].format('YYYY-MM-DD'),
    }),
    onSuccess: (r: any) => setData(r.items || []),
    onError: (e: any) => message.error(motifRefus(e, t('comptaEtats.journalCentralError', 'Le journal centralisateur n\'a pas pu être calculé.'))),
  })

  return (
    <Card>
      <Form form={form} layout="inline" initialValues={{ range: [dayjs().startOf('year'), dayjs().endOf('year')] }} style={{ marginBottom: 16 }}>
        <Form.Item name="range" label={t('comptaEtats.period')} rules={[{ required: true }]}><RangePicker format="DD/MM/YYYY" /></Form.Item>
        <Button type="primary" onClick={() => form.validateFields().then(v => mut.mutate(v)).catch(() => undefined)} loading={mut.isPending}>{t('comptaEtats.calculate')}</Button>
      </Form>
      <Table
        rowKey={(r: any) => `${r.journal_code}-${r.mois}`}
        dataSource={data}
        pagination={false}
        size="small"
        locale={vide(mut.isSuccess, t('comptaEtats.emptyBeforeBalance', 'Choisissez une période, puis « Calculer ».'), t('comptaEtats.emptyJournalCentral', 'Aucune écriture sur la période demandée.'))}
        columns={[
          { title: t('comptaEtats.journal'), dataIndex: 'journal_code', width: 100 },
          { title: t('comptaEtats.label'), dataIndex: 'journal_libelle' },
          { title: t('comptaEtats.month'), dataIndex: 'mois', width: 100 },
          { title: t('comptaEtats.nbEntries'), dataIndex: 'nb_ecritures', width: 100, align: 'right' as const },
          { title: t('comptaEtats.totalDebit'), dataIndex: 'total_debit', width: 130, align: 'right' as const, render: (v: number) => v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) },
          { title: t('comptaEtats.totalCredit'), dataIndex: 'total_credit', width: 130, align: 'right' as const, render: (v: number) => v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) },
        ]}
        // Ce tableau n'est pas paginé, mais il additionne l'état entier comme
        // les deux autres : le jour où il le sera, le total ne bougera pas.
        summary={() => 0 === data.length ? undefined : ligneDeTotal([
          { index: 0, colSpan: 3, contenu: t('comptaEtats.total', 'Total') },
          { index: 3, valeur: somme(data, 'nb_ecritures'), entier: true },
          { index: 4, valeur: somme(data, 'total_debit') },
          { index: 5, valeur: somme(data, 'total_credit') },
        ])}
      />
    </Card>
  )
}
