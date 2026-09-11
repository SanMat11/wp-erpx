import { useState } from 'react'
import { Card, Row, Col, Statistic, Table, Tag, Spin, Empty, Button, Space, Modal } from 'antd'
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  FileTextOutlined,
  UserOutlined,
  WarningOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { dashboardAPI, stockAPI } from '@/services/api'
import { useDocumentTabsStore, StaticTabType } from '@/stores/documentTabsStore'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { refusEcran } from '@/components/layouts/MainLayout'

// ⚠️ UN SEUL FORMAT DE MONTANT SUR TOUT L'ÉCRAN.
//
// Trois cohabitaient : « 5,890.00EUR » (le format anglais d'antd Statistic, avec
// en prime le symbole € en préfixe ET « EUR » en suffixe), « 1 404,00 EUR » et
// « 5 890,00 EUR ». Le ConfigProvider français ne corrige rien pour Statistic :
// sa locale ne porte aucun réglage de nombre. On formate donc nous-mêmes.
const euros = (valeur: number | string | undefined): string =>
  `${Number(valeur ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// La première année que le serveur accepte (Dashboard.php : hors [2000, 2100],
// il refuse la requête).
const PREMIERE_ANNEE = 2000

// ⚠️ DOUZE BARRES À ZÉRO, CE N'EST PAS UN ÉCRAN VIDE, C'EST UN ÉCRAN CASSÉ.
//
// months() rend TOUJOURS douze points, y compris pour une année sans la
// moindre facture : la longueur de la série ne dit donc jamais qu'il n'y a
// rien, et le bloc « Aucune donnée » écrit plus bas était inatteignable pour
// toute année valide. On regarde les valeurs, pas leur nombre.
const aDesDonnees = (points: Array<{ value: number }>): boolean => points.some((p) => 0 !== p.value)

// ⚠️ LES GRADUATIONS DISENT LA VALEUR, PAS UN ARRONDI AU MILLIER.
//
// Le formateur était `(v / 1000).toFixed(0)}k` : cinq graduations régulières
// (0, 1 500, 3 000, 4 500, 6 000) s'affichaient « 0k 2k 3k 5k 6k », un axe qui
// progresse de 2, 1, 2, 1. Et tout montant sous 500 € était libellé « 0k » —
// dans une PME dont les lignes se comptent en centaines d'euros, l'axe entier
// devenait « 0k ». On ne passe au millier qu'au-delà de 10 000, où il éclaire
// au lieu de mentir.
const graduation = (valeur: number): string =>
  Math.abs(valeur) >= 10000
    ? `${(valeur / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
    : valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

interface DashboardStats {
  revenue: {
    current_month: number
    previous_month: number
    growth_percent: number
    year_to_date: number
  }
  invoices: {
    total: number
    draft: number
    pending: number
  }
  quotes: {
    total: number
    draft: number
    pending: number
  }
  clients: number
  deals: {
    open: number
    won_this_month: number
    total_pipeline: number
    weighted_pipeline: number
  }
  stock_alerts: number
  overdue_amount: number
}

interface StockAlert {
  article_id: string
  article_code: string
  article_name: string
  warehouse_name: string
  current_quantity: number
  min_threshold: number
  alert_type: string
}

interface ChartPoint {
  label: string
  value: number
}

interface ChartData {
  revenue_by_month: ChartPoint[]
  expenses_by_month: ChartPoint[]
}

export default function Dashboard() {
  const { t } = useTranslation()
  const { openStaticTab, openDocumentTab } = useDocumentTabsStore()
  const hasAccess = usePermissionStore((state) => state.hasAccess)
  const [refus, setRefus] = useState<{ motif: 'droits' | 'absent'; libelle: string } | null>(null)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const hasHydrated = useAuthStore((state) => state._hasHydrated)
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const canFetch = hasHydrated && isAuthenticated

  // Fetch dashboard stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const response = await dashboardAPI.getStats()
      return response.data as DashboardStats
    },
    enabled: canFetch,
  })

  // Fetch chart data for selected year
  const { data: chartData, isLoading: chartsLoading } = useQuery({
    queryKey: ['dashboard', 'charts', selectedYear],
    queryFn: async () => {
      const response = await dashboardAPI.getCharts(selectedYear)
      return response.data as ChartData
    },
    enabled: canFetch,
  })

  // Fetch stock alerts
  const { data: alertsData, isLoading: alertsLoading } = useQuery<StockAlert[]>({
    queryKey: ['stock-alerts-dashboard'],
    queryFn: async () => {
      const response = await stockAPI.getAlerts()
      return response.data
    },
    enabled: canFetch,
  })

  const stats = statsData || {
    revenue: { current_month: 0, previous_month: 0, growth_percent: 0, year_to_date: 0 },
    invoices: { total: 0, draft: 0, pending: 0 },
    quotes: { total: 0, draft: 0, pending: 0 },
    clients: 0,
    deals: { open: 0, won_this_month: 0, total_pipeline: 0, weighted_pipeline: 0 },
    stock_alerts: 0,
    overdue_amount: 0,
  }

  // ⚠️ Les raccourcis d'ici franchissent la MÊME garde que le menu.
  //
  // Les tuiles et le lien « Tout voir » appelaient openStaticTab() directement :
  // un comptable sans droit sur le stock ouvrait l'écran Stock depuis le
  // tableau de bord, quand la barre latérale le lui refusait. refusEcran() est
  // la décision commune (voir MainLayout).
  const ouvrirEcran = (key: StaticTabType) => {
    const refuse = refusEcran(key, hasAccess)

    if (refuse) {
      setRefus(refuse)
      return
    }

    openStaticTab(key)
  }

  // Une ligne d'alerte ouvre l'article concerné : c'est la seule chose qu'on
  // ait envie de faire en la lisant, et le tableau était inerte. Même garde que
  // partout ailleurs — la fiche appartient au module Articles.
  const ouvrirArticle = (alerte: StockAlert) => {
    const refuse = refusEcran('articles', hasAccess)

    if (refuse) {
      setRefus(refuse)
      return
    }

    openDocumentTab('article', alerte.article_id, alerte.article_name)
  }

  const stockAlerts: StockAlert[] = alertsData || []
  const outOfStockAlerts = stockAlerts.filter(a => a.alert_type === 'out_of_stock')
  const lowStockAlerts = stockAlerts.filter(a => a.alert_type === 'low_stock')

  // Month labels (localized)
  const monthLabels: Record<string, string> = {
    '01': t('dashboard.monthJan'), '02': t('dashboard.monthFeb'), '03': t('dashboard.monthMar'), '04': t('dashboard.monthApr'),
    '05': t('dashboard.monthMay'), '06': t('dashboard.monthJun'), '07': t('dashboard.monthJul'), '08': t('dashboard.monthAug'),
    '09': t('dashboard.monthSep'), '10': t('dashboard.monthOct'), '11': t('dashboard.monthNov'), '12': t('dashboard.monthDec'),
  }

  // Format chart data for display
  const formatChartData = (data: ChartPoint[] | undefined) => {
    if (!data) return []
    return data.map(point => ({
      month: monthLabels[point.label.split('-')[1]] || point.label,
      value: point.value,
    }))
  }

  const revenueData = formatChartData(chartData?.revenue_by_month)
  const expensesData = formatChartData(chartData?.expenses_by_month)

  if (statsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>{t('dashboard.title')}</h1>

      {/* Les quatre tuiles ouvrent l'écran qu'elles résument : un chiffre sur
          lequel on ne peut pas cliquer oblige à retrouver l'entrée de menu
          correspondante. */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => ouvrirEcran('invoices')} style={{ cursor: 'pointer' }}>
            <Statistic
              // ⚠️ HT OU TTC, L'ÉCRAN DOIT LE DIRE.
              //
              // Deux natures de montants cohabitent sur cette seule rangée : le
              // chiffre d'affaires est hors taxes (la TVA n'est pas un produit,
              // voir Dashboard.php), le reste à encaisser juste en dessous est
              // TTC — c'est bien cette somme-là que le client doit verser. Rien
              // ne le disait : un comptable ne pouvait pas savoir ce qu'il lit.
              title={`${t('dashboard.monthlyRevenue')} (${t('dashboard.excludingTax', { defaultValue: 'HT' })})`}
              value={stats.revenue.current_month}
              formatter={(v) => euros(v as number)}
              // ⚠️ PAS DE COULEUR SUR LE CHIFFRE D'AFFAIRES LUI-MÊME.
              // Elle suivait le signe de la VARIATION : un chiffre d'affaires
              // bien réel s'affichait en rouge dès que le mois était moins bon
              // que le précédent, comme s'il était négatif. La variation, elle,
              // garde sa flèche et sa couleur, juste en dessous.
            />
            <div style={{ marginTop: 8 }}>
              {stats.revenue.growth_percent >= 0 ? (
                <span style={{ color: '#3f8600' }}>
                  <ArrowUpOutlined /> {stats.revenue.growth_percent.toFixed(1)}%
                </span>
              ) : (
                <span style={{ color: '#cf1322' }}>
                  <ArrowDownOutlined /> {Math.abs(stats.revenue.growth_percent).toFixed(1)}%
                </span>
              )}
              <span style={{ marginLeft: 8, color: '#666' }}>{t('dashboard.vsLastMonth')}</span>
            </div>
            {/* Le cumul de l'année était calculé à chaque chargement puis jeté,
                alors que c'est le chiffre qui manquait le plus à côté de celui
                du mois. */}
            <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>
              {t('dashboard.yearToDate', { defaultValue: 'Depuis le 1er janvier' })} : {euros(stats.revenue.year_to_date)}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => ouvrirEcran('invoices')} style={{ cursor: 'pointer' }}>
            <Statistic
              title={t('dashboard.pendingInvoices')}
              value={stats.invoices.pending}
              prefix={<FileTextOutlined />}
            />
            <div style={{ marginTop: 8, color: '#666' }}>
              {stats.overdue_amount > 0 && (
                <span style={{ color: '#cf1322' }}>
                  {t('dashboard.overdueLate', { amount: euros(stats.overdue_amount), defaultValue: '{{amount}} en retard' })}
                  {' '}({t('dashboard.includingTax', { defaultValue: 'TTC' })})
                </span>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => ouvrirEcran('clients')} style={{ cursor: 'pointer' }}>
            <Statistic
              title={t('dashboard.activeClients')}
              value={stats.clients}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => ouvrirEcran('stock')} style={{ cursor: 'pointer' }}>
            <Statistic
              title={t('dashboard.stockAlerts')}
              value={stats.stock_alerts}
              prefix={<WarningOutlined />}
              valueStyle={{ color: stats.stock_alerts > 0 ? '#faad14' : '#52c41a' }}
            />
            {stockAlerts.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {outOfStockAlerts.length > 0 && (
                  <Tag color="red">{t('dashboard.outOfStockCount', { count: outOfStockAlerts.length })}</Tag>
                )}
                {lowStockAlerts.length > 0 && (
                  <Tag color="orange">{t('dashboard.lowStockCount', { count: lowStockAlerts.length })}</Tag>
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        {/* ⚠️ UN SEUL SÉLECTEUR D'ANNÉE, ET IL EST HORS DES CARTES.
            Chaque carte portait le sien — quatre flèches, deux fois « 2026 » —
            mais les deux pilotaient la MÊME valeur : reculer sur les dépenses
            reculait aussi le chiffre d'affaires, sans que rien ne l'annonce. Il
            n'est pas non plus posé en haut de page : il ne commande que les deux
            graphiques, et non les tuiles, qui restent sur le mois courant. */}
        <Col xs={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <span style={{ color: '#666', fontSize: 13 }}>
              {t('dashboard.chartsYear', { defaultValue: 'Année des graphiques' })}
            </span>
            <Space size="small">
              <Button
                size="small"
                icon={<LeftOutlined />}
                onClick={() => setSelectedYear(selectedYear - 1)}
                // Le serveur refuse tout ce qui précède 2000 : sans plancher,
                // un clic de trop vidait les DEUX graphiques sans un mot.
                disabled={selectedYear <= PREMIERE_ANNEE}
              />
              <span style={{ fontSize: 14, fontWeight: 500, minWidth: 40, textAlign: 'center' }}>
                {selectedYear}
              </span>
              <Button
                size="small"
                icon={<RightOutlined />}
                onClick={() => setSelectedYear(selectedYear + 1)}
                disabled={selectedYear >= currentYear}
              />
            </Space>
          </div>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={`${t('dashboard.revenueByMonth')} ${selectedYear}`}>
            {chartsLoading ? (
              <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin />
              </div>
            ) : aDesDonnees(revenueData) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => graduation(v as number)} />
                  <Tooltip
                    formatter={(value) => [euros(value as number), t('dashboard.revenueLabel')]}
                    labelFormatter={(label) => `${t('dashboard.monthLabel')}: ${label}`}
                  />
                  <Bar dataKey="value" fill="#52c41a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={t('dashboard.noData')} style={{ height: 250, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={`${t('dashboard.expensesByMonth')} ${selectedYear}`}>
            {chartsLoading ? (
              <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin />
              </div>
            ) : aDesDonnees(expensesData) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={expensesData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => graduation(v as number)} />
                  <Tooltip
                    formatter={(value) => [euros(value as number), t('dashboard.expensesLabel')]}
                    labelFormatter={(label) => `${t('dashboard.monthLabel')}: ${label}`}
                  />
                  <Bar dataKey="value" fill="#ff7a45" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={t('dashboard.noData')} style={{ height: 250, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <Card title={t('dashboard.salesPipeline')}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title={t('dashboard.openDeals')}
                  value={stats.deals.open}
                />
              </Col>
              <Col span={8}>
                {/* Le serveur comptait les affaires gagnées du mois à chaque
                    chargement et personne ne les montrait. */}
                <Statistic
                  title={t('dashboard.wonThisMonth', { defaultValue: 'Gagnées ce mois' })}
                  value={stats.deals.won_this_month}
                />
              </Col>
              <Col span={8}>
                {/* Le portefeuille additionne des budgets d'affaires et des
                    avenants, tous deux enregistrés TTC (voir Dashboard.php). */}
                <Statistic
                  title={`${t('dashboard.totalPipeline')} (${t('dashboard.includingTax', { defaultValue: 'TTC' })})`}
                  value={stats.deals.total_pipeline}
                  formatter={(v) => euros(v as number)}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={t('dashboard.quoteStats')}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title={t('dashboard.totalQuotes')}
                  value={stats.quotes.total}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={t('dashboard.pending')}
                  value={stats.quotes.pending}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {stockAlerts.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24}>
            <Card
              title={
                <span>
                  <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
                  {t('dashboard.alertArticles', { count: stockAlerts.length })}
                </span>
              }
              extra={
                <a href="#" onClick={(e) => { e.preventDefault(); ouvrirEcran('stock') }}>
                  {t('dashboard.viewAll')}
                </a>
              }
            >
              <Table
                dataSource={stockAlerts.slice(0, 5)}
                columns={[
                  { title: t('dashboard.colCode'), dataIndex: 'article_code', key: 'code', width: 100 },
                  { title: t('dashboard.colArticle'), dataIndex: 'article_name', key: 'name' },
                  { title: t('dashboard.colWarehouse'), dataIndex: 'warehouse_name', key: 'warehouse', width: 120 },
                  {
                    title: t('dashboard.colStock'),
                    dataIndex: 'current_quantity',
                    key: 'qty',
                    width: 100,
                    render: (v: number, record: StockAlert) => (
                      <span style={{ color: record.alert_type === 'out_of_stock' ? '#ff4d4f' : '#faad14', fontWeight: 500 }}>
                        {v?.toFixed(0)}
                      </span>
                    ),
                  },
                  {
                    title: t('dashboard.colThreshold'),
                    dataIndex: 'min_threshold',
                    key: 'threshold',
                    width: 80,
                    render: (v: number) => v?.toFixed(0),
                  },
                  {
                    title: t('dashboard.colStatus'),
                    key: 'status',
                    width: 100,
                    render: (_: unknown, record: StockAlert) =>
                      record.alert_type === 'out_of_stock' ? (
                        <Tag color="red">{t('dashboard.outOfStock')}</Tag>
                      ) : (
                        <Tag color="orange">{t('dashboard.lowStock')}</Tag>
                      ),
                  },
                ]}
                rowKey={(record) => `${record.article_id}-${record.warehouse_name}`}
                onRow={(record) => ({
                  onClick: () => ouvrirArticle(record),
                  style: { cursor: 'pointer' },
                })}
                pagination={false}
                size="small"
                loading={alertsLoading}
                locale={{ emptyText: t('dashboard.noAlerts') }}
              />
              {stockAlerts.length > 5 && (
                <div style={{ textAlign: 'center', marginTop: 8, color: '#999' }}>
                  {t('dashboard.moreAlerts', { count: stockAlerts.length - 5 })}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* Refus d'ouverture : même motif que dans la barre latérale, dit ici
          plutôt que d'ouvrir un écran qui répondrait 403. */}
      <Modal
        open={null !== refus}
        title={
          refus?.motif === 'absent'
            ? t('pro.title', { defaultValue: 'Module disponible avec AMS Studio Pro' })
            : t('dashboard.accessDenied', { defaultValue: 'Accès refusé' })
        }
        onOk={() => setRefus(null)}
        onCancel={() => setRefus(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText={t('common.close')}
      >
        <p>
          {refus?.motif === 'absent'
            ? t('pro.body', {
                module: refus?.libelle || '',
                defaultValue:
                  'Le module « {{module}} » n\'est pas installé sur ce site. Il fait partie du module complémentaire AMS Studio Pro.',
              })
            : t('dashboard.accessDeniedBody', {
                module: refus?.libelle || '',
                defaultValue: "Vous n'avez pas les droits pour accéder au module {{module}}.",
              })}
        </p>
      </Modal>
    </div>
  )
}
