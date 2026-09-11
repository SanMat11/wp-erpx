import { useState, useEffect } from 'react'
import {
  Tabs, Card, Row, Col, Statistic, Table, Tag, Input, Button, Modal, Select,
  message, Space, Drawer, Form, InputNumber, Badge, Popconfirm, Switch,
  Descriptions, Divider, Typography, Tooltip,
} from 'antd'
import {
  TeamOutlined, ShopOutlined, AuditOutlined, SearchOutlined, EyeOutlined,
  UserOutlined, HeartOutlined, SafetyOutlined, LockOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, GlobalOutlined, CrownOutlined, FileTextOutlined,
} from '@ant-design/icons'
import PDFTemplateEditor from './PDFTemplateEditor'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminAPI } from '@/services/api'
import dayjs from 'dayjs'

const { Text, Title } = Typography

const statusColors: Record<string, string> = { active: 'green', trial: 'blue', suspended: 'red', cancelled: 'default' }

const ROLE_KEYS = ['super_admin', 'tenant_admin', 'manager', 'accountant', 'sales', 'warehouse', 'readonly']

const MODULES = [
  'dashboard', 'clients', 'suppliers', 'articles', 'quotes', 'invoices',
  'supplier_invoices', 'purchase_orders', 'deals', 'stock', 'stock_movements', 'ged', 'treasury', 'settings',
]

type PermLevel = 'full' | 'edit' | 'view' | 'none'
const PERM_CYCLE: PermLevel[] = ['none', 'view', 'edit', 'full']
const permColors: Record<string, string> = { full: 'green', edit: 'blue', view: 'orange', none: 'red' }

// ============================================================================
// Component
// ============================================================================

export default function AdminPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const statusLabels: Record<string, string> = {
    active: t('adminPage.statusActive'),
    trial: t('adminPage.statusTrial'),
    suspended: t('adminPage.statusSuspended'),
    cancelled: t('adminPage.statusCancelled'),
  }
  const ROLES = ROLE_KEYS.map(key => ({ key, label: t(`adminPage.role_${key}`) }))
  const MODULE_LABELS: Record<string, string> = {
    dashboard: t('adminPage.module_dashboard'),
    clients: t('adminPage.module_clients'),
    suppliers: t('adminPage.module_suppliers'),
    articles: t('adminPage.module_articles'),
    quotes: t('adminPage.module_quotes'),
    invoices: t('adminPage.module_invoices'),
    supplier_invoices: t('adminPage.module_supplier_invoices'),
    purchase_orders: t('adminPage.module_purchase_orders'),
    deals: t('adminPage.module_deals'),
    stock: t('adminPage.module_stock'),
    stock_movements: t('adminPage.module_stock_movements'),
    ged: t('adminPage.module_ged'),
    treasury: t('adminPage.module_treasury'),
    settings: t('adminPage.module_settings'),
  }
  const permLabels: Record<string, string> = {
    full: t('adminPage.permFull'),
    edit: t('adminPage.permEdit'),
    view: t('adminPage.permView'),
    none: t('adminPage.permNone'),
  }

  const [search, setSearch] = useState('')
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [auditPage, setAuditPage] = useState(1)
  const [planModalVisible, setPlanModalVisible] = useState(false)
  const [editingPlan, setEditingPlan] = useState<any>(null)
  const [permMatrix, setPermMatrix] = useState<Record<string, Record<string, PermLevel>>>({})
  const [permDirty, setPermDirty] = useState(false)

  const [tenantForm] = Form.useForm()
  const [planForm] = Form.useForm()

  // --- Queries ---
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: async () => (await adminAPI.getGlobalStats()).data })
  const { data: tenantsData, isLoading: tenantsLoading } = useQuery({ queryKey: ['admin-tenants', search], queryFn: async () => (await adminAPI.listTenants(search)).data })
  const { data: tenantDetail } = useQuery({ queryKey: ['admin-tenant', selectedTenant], queryFn: async () => (await adminAPI.getTenant(selectedTenant!)).data, enabled: !!selectedTenant })
  const { data: auditData, isLoading: auditLoading } = useQuery({ queryKey: ['admin-audit', auditPage], queryFn: async () => (await adminAPI.getAuditLogs({ page: auditPage, page_size: 20 })).data })
  const { data: plansData, isLoading: plansLoading } = useQuery({ queryKey: ['admin-plans'], queryFn: async () => (await adminAPI.listPlans()).data })
  const { data: healthData, refetch: refetchHealth } = useQuery({ queryKey: ['admin-health'], queryFn: async () => (await adminAPI.getSystemHealth()).data, refetchInterval: 30000 })
  const { data: securityData } = useQuery({ queryKey: ['admin-security'], queryFn: async () => (await adminAPI.getSecuritySettings()).data })
  const { data: permsData } = useQuery({ queryKey: ['admin-permissions'], queryFn: async () => (await adminAPI.getDefaultPermissions()).data })

  // Build permission matrix from API data
  useEffect(() => {
    if (!permsData?.permissions) return
    const m: Record<string, Record<string, PermLevel>> = {}
    ROLES.forEach(r => { m[r.key] = {} ; MODULES.forEach(mod => { m[r.key][mod] = 'none' }) })
    permsData.permissions.forEach((p: any) => { if (m[p.role]) m[p.role][p.module] = p.permission })
    setPermMatrix(m)
    setPermDirty(false)
  }, [permsData])

  // Set tenant form when detail loads
  useEffect(() => {
    if (tenantDetail?.tenant && drawerVisible) {
      tenantForm.setFieldsValue({
        name: tenantDetail.tenant.name,
        status: tenantDetail.tenant.status,
        plan_id: tenantDetail.tenant.plan_id,
        max_users_override: tenantDetail.tenant.max_users_override || 0,
      })
    }
  }, [tenantDetail, drawerVisible, tenantForm])

  // --- Mutations ---
  const updateTenantMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => adminAPI.updateTenant(id, data),
    onSuccess: () => { message.success(t('adminPage.tenantUpdated')); qc.invalidateQueries({ queryKey: ['admin-tenants'] }); qc.invalidateQueries({ queryKey: ['admin-tenant'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }) },
    onError: () => message.error(t('adminPage.tenantUpdateError')),
  })
  const deleteTenantMut = useMutation({
    mutationFn: (id: string) => adminAPI.deleteTenant(id),
    onSuccess: () => { message.success(t('adminPage.tenantDeleted')); setDrawerVisible(false); setSelectedTenant(null); qc.invalidateQueries({ queryKey: ['admin-tenants'] }) },
    onError: () => message.error(t('adminPage.deleteError')),
  })
  const createPlanMut = useMutation({
    mutationFn: (data: any) => adminAPI.createPlan(data),
    onSuccess: () => { message.success(t('adminPage.planCreated')); setPlanModalVisible(false); planForm.resetFields(); qc.invalidateQueries({ queryKey: ['admin-plans'] }) },
    onError: () => message.error(t('adminPage.planCreateError')),
  })
  const updatePlanMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => adminAPI.updatePlan(id, data),
    onSuccess: () => { message.success(t('adminPage.planUpdated')); setPlanModalVisible(false); setEditingPlan(null); planForm.resetFields(); qc.invalidateQueries({ queryKey: ['admin-plans'] }) },
    onError: () => message.error(t('adminPage.planUpdateError')),
  })
  const deletePlanMut = useMutation({
    mutationFn: (id: string) => adminAPI.deletePlan(id),
    onSuccess: () => { message.success(t('adminPage.planDeleted')); qc.invalidateQueries({ queryKey: ['admin-plans'] }) },
    onError: () => message.error(t('adminPage.planDeleteError')),
  })
  const updateSecurityMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: any }) => adminAPI.updateSecuritySetting(key, value),
    onSuccess: () => { message.success(t('adminPage.settingSaved')); qc.invalidateQueries({ queryKey: ['admin-security'] }) },
    onError: () => message.error(t('adminPage.saveError')),
  })
  const updatePermsMut = useMutation({
    mutationFn: (perms: any[]) => adminAPI.updateDefaultPermissions(perms),
    onSuccess: () => { message.success(t('adminPage.permissionsSaved')); setPermDirty(false); qc.invalidateQueries({ queryKey: ['admin-permissions'] }) },
    onError: () => message.error(t('adminPage.permissionsSaveError')),
  })

  // --- Handlers ---
  const openTenantDrawer = (id: string) => { setSelectedTenant(id); setDrawerVisible(true) }
  const closeTenantDrawer = () => { setDrawerVisible(false); setSelectedTenant(null); tenantForm.resetFields() }
  const handleTenantSave = async () => {
    if (!selectedTenant) return
    const values = await tenantForm.validateFields()
    updateTenantMut.mutate({ id: selectedTenant, data: values })
  }
  const openPlanModal = (plan?: any) => {
    setEditingPlan(plan || null)
    if (plan) {
      planForm.setFieldsValue(plan)
    } else {
      planForm.resetFields()
      planForm.setFieldsValue({ is_active: true, max_users: 5, max_invoices_month: 100, max_storage_mb: 1024 })
    }
    setPlanModalVisible(true)
  }
  const handlePlanSave = async () => {
    const values = await planForm.validateFields()
    if (editingPlan) {
      updatePlanMut.mutate({ id: editingPlan.id, data: values })
    } else {
      createPlanMut.mutate(values)
    }
  }
  const cyclePermission = (role: string, module: string) => {
    setPermMatrix(prev => {
      const cur = prev[role]?.[module] || 'none'
      const idx = PERM_CYCLE.indexOf(cur as PermLevel)
      const next = PERM_CYCLE[(idx + 1) % PERM_CYCLE.length]
      return { ...prev, [role]: { ...prev[role], [module]: next } }
    })
    setPermDirty(true)
  }
  const savePermissions = () => {
    const perms: any[] = []
    Object.entries(permMatrix).forEach(([role, modules]) => {
      Object.entries(modules).forEach(([module, permission]) => {
        perms.push({ role, module, permission })
      })
    })
    updatePermsMut.mutate(perms)
  }

  // --- Plan options for tenant form ---
  const plansList = plansData?.plans || []
  const planOptions = Array.isArray(plansList) ? plansList.map((p: any) => ({ value: p.id, label: p.name })) : []

  // --- Security data parsing ---
  const rateLimits = securityData?.rate_limits ? (typeof securityData.rate_limits === 'string' ? JSON.parse(securityData.rate_limits) : securityData.rate_limits) : {}
  const blockedIps: any[] = securityData?.blocked_ips ? (typeof securityData.blocked_ips === 'string' ? JSON.parse(securityData.blocked_ips) : securityData.blocked_ips) : []
  const geoblocking = securityData?.geoblocking ? (typeof securityData.geoblocking === 'string' ? JSON.parse(securityData.geoblocking) : securityData.geoblocking) : { enabled: false, allowed_countries: [] }
  const registrationEnabled: boolean = (() => {
    const raw = securityData?.registration_enabled
    if (raw === undefined || raw === null) return true
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    return obj?.enabled !== false
  })()

  // --- Uptime formatting ---
  const formatUptime = (seconds: number) => {
    if (!seconds) return '-'
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return `${d}${t('adminPage.uptimeDayUnit')} ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m ${seconds % 60}s`
  }

  // =========================================================================
  // TABS
  // =========================================================================

  const tabItems = [
    // --- Dashboard ---
    {
      key: 'dashboard',
      label: <span><ShopOutlined /> {t('adminPage.tabDashboard')}</span>,
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}><Card><Statistic title={t('adminPage.totalTenants')} value={stats?.total_tenants || 0} prefix={<TeamOutlined />} /></Card></Col>
          <Col xs={12} lg={6}><Card><Statistic title={t('adminPage.activeTenants')} value={stats?.active_tenants || 0} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col xs={12} lg={6}><Card><Statistic title={t('adminPage.trialTenants')} value={stats?.trial_tenants || 0} valueStyle={{ color: '#1677ff' }} /></Card></Col>
          <Col xs={12} lg={6}><Card><Statistic title={t('adminPage.users')} value={stats?.total_users || 0} prefix={<UserOutlined />} /></Card></Col>
        </Row>
      ),
    },

    // --- Tenants ---
    {
      key: 'tenants',
      label: <span><TeamOutlined /> {t('adminPage.tabTenants')}</span>,
      children: (
        <div>
          <Input placeholder={t('adminPage.searchPlaceholder')} prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 300, marginBottom: 16 }} allowClear />
          <Table
            columns={[
              { title: t('common.name'), dataIndex: 'name', key: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name) },
              { title: t('adminPage.subdomain'), dataIndex: 'subdomain', key: 'subdomain' },
              { title: t('adminPage.plan'), dataIndex: 'plan_name', key: 'plan_name' },
              { title: t('common.status'), dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s] || s}</Tag> },
              { title: t('adminPage.usersShort'), dataIndex: 'user_count', key: 'user_count', align: 'center' as const },
              { title: t('adminPage.createdAt'), dataIndex: 'created_at', key: 'created_at', render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
              { title: '', key: 'actions', render: (_: any, r: any) => <Button size="small" icon={<EyeOutlined />} onClick={() => openTenantDrawer(r.id)}>{t('adminPage.details')}</Button> },
            ]}
            dataSource={tenantsData?.tenants || []}
            loading={tenantsLoading}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            size="small"
          />
        </div>
      ),
    },

    // --- Plans ---
    {
      key: 'plans',
      label: <span><CrownOutlined /> {t('adminPage.tabPlans')}</span>,
      children: (
        <div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openPlanModal()} style={{ marginBottom: 16 }}>{t('adminPage.newPlan')}</Button>
          <Table
            columns={[
              { title: t('common.name'), dataIndex: 'name', key: 'name' },
              { title: t('adminPage.maxUsers'), dataIndex: 'max_users', key: 'mu', align: 'center' as const },
              { title: t('adminPage.maxInvoicesMonth'), dataIndex: 'max_invoices_month', key: 'mi', align: 'center' as const },
              { title: t('adminPage.storageMb'), dataIndex: 'max_storage_mb', key: 'ms', align: 'center' as const },
              { title: t('adminPage.pricePerMonth'), dataIndex: 'price_monthly', key: 'pm', align: 'right' as const, render: (v: number) => `${Number(v || 0).toFixed(2)} €` },
              { title: t('adminPage.pricePerYear'), dataIndex: 'price_yearly', key: 'py', align: 'right' as const, render: (v: number) => `${Number(v || 0).toFixed(2)} €` },
              { title: t('adminPage.active'), dataIndex: 'is_active', key: 'a', align: 'center' as const, render: (v: boolean) => v ? <Tag color="green">{t('common.yes')}</Tag> : <Tag color="red">{t('common.no')}</Tag> },
              {
                title: t('common.actions'), key: 'actions', render: (_: any, r: any) => (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openPlanModal(r)}>{t('common.edit')}</Button>
                    <Popconfirm title={t('adminPage.deletePlanConfirm')} onConfirm={() => deletePlanMut.mutate(r.id)} okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            dataSource={Array.isArray(plansList) ? plansList : []}
            loading={plansLoading}
            rowKey="id"
            size="small"
          />
        </div>
      ),
    },

    // --- Health Check ---
    {
      key: 'health',
      label: <span><HeartOutlined /> {t('adminPage.tabHealth')}</span>,
      children: (
        <div>
          <Button icon={<ReloadOutlined />} onClick={() => refetchHealth()} style={{ marginBottom: 16 }}>{t('adminPage.refresh')}</Button>
          <Text type="secondary" style={{ marginLeft: 8 }}>{t('adminPage.autoRefresh30s')}</Text>
          <Row gutter={[16, 16]}>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.database')}>
                {healthData?.database ? <><CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} /> <Text strong style={{ color: '#52c41a' }}>{t('adminPage.statusOk')}</Text></> : <><CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 24 }} /> <Text strong style={{ color: '#ff4d4f' }}>{t('adminPage.statusDown')}</Text></>}
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.redis')}>
                {healthData?.redis ? <><CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} /> <Text strong style={{ color: '#52c41a' }}>{t('adminPage.statusOk')}</Text></> : <><CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 24 }} /> <Text strong style={{ color: '#ff4d4f' }}>{t('adminPage.statusDown')}</Text></>}
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.uptime')}>
                <Text strong style={{ fontSize: 18 }}>{formatUptime(healthData?.uptime_seconds)}</Text>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.goVersion')}>
                <Text code>{healthData?.go_version || '-'}</Text>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.goroutines')}>
                <Text strong style={{ fontSize: 18 }}>{healthData?.goroutines || 0}</Text>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.memoryAllocated')}>
                <Text strong style={{ fontSize: 18 }}>{healthData?.memory?.alloc_mb ? `${healthData.memory.alloc_mb.toFixed(1)} MB` : '-'}</Text>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.memorySystem')}>
                <Text strong style={{ fontSize: 18 }}>{healthData?.memory?.sys_mb ? `${healthData.memory.sys_mb.toFixed(1)} MB` : '-'}</Text>
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small" title={t('adminPage.gcCycles')}>
                <Text strong style={{ fontSize: 18 }}>{healthData?.memory?.gc_cycles || 0}</Text>
              </Card>
            </Col>
            {healthData?.disk && (
              <Col xs={24}>
                <Card size="small" title={t('adminPage.storage')}>
                  <Text>{t('adminPage.diskPath')} : {healthData.disk.path} — {healthData.disk.files} {t('adminPage.files')} — {healthData.disk.size_mb?.toFixed(1)} MB</Text>
                </Card>
              </Col>
            )}
          </Row>
        </div>
      ),
    },

    // --- Fail2ban & Geoblocking ---
    {
      key: 'security',
      label: <span><SafetyOutlined /> {t('adminPage.tabSecurity')}</span>,
      children: (
        <div>
          <Title level={4}>{t('adminPage.accountCreation')}</Title>
          <Card size="small" style={{ marginBottom: 24 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Text strong>{t('adminPage.allowRegistration')}</Text>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {t('adminPage.allowRegistrationHint')}
                </div>
              </div>
              <Switch checked={registrationEnabled} onChange={(checked) => {
                updateSecurityMut.mutate({ key: 'registration_enabled', value: { enabled: checked } })
              }} />
            </Space>
          </Card>

          <Title level={4}><LockOutlined /> {t('adminPage.rateLimiting')}</Title>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {Object.entries(rateLimits).map(([key, val]) => (
              <Col xs={12} sm={6} key={key}>
                <Card size="small">
                  <Statistic title={key.replace('_', ' ').toUpperCase()} value={String(val)} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
            ))}
          </Row>

          <Title level={5}>{t('adminPage.blockedIps')}</Title>
          <Space style={{ marginBottom: 8 }}>
            <Input placeholder={t('adminPage.addIpPlaceholder')} id="newBlockedIp" style={{ width: 200 }} />
            <Button icon={<PlusOutlined />} onClick={() => {
              const input = document.getElementById('newBlockedIp') as HTMLInputElement
              const ip = input?.value?.trim()
              if (!ip) return
              const newList = [...blockedIps, { ip, reason: 'Manuel', blocked_at: new Date().toISOString() }]
              updateSecurityMut.mutate({ key: 'blocked_ips', value: newList })
              input.value = ''
            }}>{t('adminPage.block')}</Button>
          </Space>
          <Table
            columns={[
              { title: t('adminPage.ip'), dataIndex: 'ip', key: 'ip' },
              { title: t('adminPage.reason'), dataIndex: 'reason', key: 'reason' },
              { title: t('adminPage.since'), dataIndex: 'blocked_at', key: 'blocked_at', render: (d: string) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '-' },
              { title: '', key: 'a', render: (_: any, _r: any, idx: number) => (
                <Button size="small" danger onClick={() => {
                  const newList = blockedIps.filter((_: any, i: number) => i !== idx)
                  updateSecurityMut.mutate({ key: 'blocked_ips', value: newList })
                }}>{t('adminPage.unblock')}</Button>
              )},
            ]}
            dataSource={blockedIps.map((ip: any, i: number) => ({ ...ip, key: i }))}
            locale={{ emptyText: t('adminPage.noBlockedIp') }}
            size="small"
            pagination={false}
            style={{ marginBottom: 32 }}
          />

          <Divider />
          <Title level={4}><GlobalOutlined /> {t('adminPage.geoblocking')}</Title>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text strong>{t('adminPage.enableGeoblocking')}</Text>
              <Switch checked={geoblocking.enabled} onChange={(checked) => {
                updateSecurityMut.mutate({ key: 'geoblocking', value: { ...geoblocking, enabled: checked } })
              }} />
            </Space>
          </Card>
          <Space style={{ marginBottom: 8 }}>
            <Input placeholder={t('adminPage.countryCodePlaceholder')} id="newCountry" style={{ width: 180 }} maxLength={2} />
            <Button icon={<PlusOutlined />} onClick={() => {
              const input = document.getElementById('newCountry') as HTMLInputElement
              const code = input?.value?.trim().toUpperCase()
              if (!code || code.length !== 2) return
              if (geoblocking.allowed_countries?.includes(code)) { message.warning(t('adminPage.countryAlreadyAdded')); return }
              const newGeo = { ...geoblocking, allowed_countries: [...(geoblocking.allowed_countries || []), code] }
              updateSecurityMut.mutate({ key: 'geoblocking', value: newGeo })
              input.value = ''
            }}>{t('adminPage.add')}</Button>
          </Space>
          <Table
            columns={[
              { title: t('adminPage.countryCode'), dataIndex: 'code', key: 'code', render: (c: string) => <Tag>{c}</Tag> },
              { title: t('common.status'), key: 's', render: () => <Tag color="green">{t('adminPage.allowed')}</Tag> },
              { title: '', key: 'a', render: (_: any, r: any) => (
                <Popconfirm title={t('adminPage.removeCountryConfirm', { code: r.code })} onConfirm={() => {
                  const newGeo = { ...geoblocking, allowed_countries: geoblocking.allowed_countries.filter((c: string) => c !== r.code) }
                  updateSecurityMut.mutate({ key: 'geoblocking', value: newGeo })
                }} okText={t('common.yes')} cancelText={t('common.no')}>
                  <Button size="small" danger>{t('adminPage.remove')}</Button>
                </Popconfirm>
              )},
            ]}
            dataSource={(geoblocking.allowed_countries || []).map((c: string) => ({ key: c, code: c }))}
            size="small"
            pagination={false}
          />
        </div>
      ),
    },

    // --- Rôles & Permissions ---
    {
      key: 'roles',
      label: <span><LockOutlined /> {t('adminPage.tabPermissions')}</span>,
      children: (
        <div>
          <Space style={{ marginBottom: 16 }}>
            <Tag color="green">{t('adminPage.permFull')}</Tag><Tag color="blue">{t('adminPage.permEdit')}</Tag><Tag color="orange">{t('adminPage.permView')}</Tag><Tag color="red">{t('adminPage.permNone')}</Tag>
            <Text type="secondary" style={{ marginLeft: 16 }}>{t('adminPage.clickTagHint')}</Text>
            {permDirty && (
              <Button type="primary" size="small" onClick={savePermissions} loading={updatePermsMut.isPending} style={{ marginLeft: 16 }}>
                {t('adminPage.saveChanges')}
              </Button>
            )}
          </Space>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #f0f0f0', minWidth: 120 }}>{t('adminPage.moduleColumn')}</th>
                {ROLES.map(r => (
                  <th key={r.key} style={{ padding: '8px 4px', textAlign: 'center', borderBottom: '2px solid #f0f0f0', minWidth: 80 }}>
                    <Tooltip title={r.key}>{r.label}</Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map(mod => (
                <tr key={mod} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 12px', fontWeight: 500 }}>{MODULE_LABELS[mod]}</td>
                  {ROLES.map(role => {
                    const perm = permMatrix[role.key]?.[mod] || 'none'
                    return (
                      <td key={role.key} style={{ padding: '4px', textAlign: 'center' }}>
                        <Tag
                          color={permColors[perm]}
                          style={{ cursor: 'pointer', margin: 0, minWidth: 60, textAlign: 'center' }}
                          onClick={() => cyclePermission(role.key, mod)}
                        >
                          {permLabels[perm]}
                        </Tag>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },

    // --- PDF Templates ---
    {
      key: 'templates',
      label: <span><FileTextOutlined /> {t('adminPage.tabPdfTemplates')}</span>,
      children: <PDFTemplateEditor />,
    },

    // --- Audit Logs ---
    {
      key: 'audit',
      label: <span><AuditOutlined /> {t('adminPage.tabAudit')}</span>,
      children: (
        <Table
          columns={[
            { title: t('common.date'), dataIndex: 'created_at', key: 'date', render: (d: string) => dayjs(d).format('DD/MM/YYYY HH:mm:ss'), width: 170 },
            { title: t('adminPage.user'), dataIndex: 'user_email', key: 'user' },
            { title: t('adminPage.action'), dataIndex: 'action', key: 'action', render: (a: string) => <Tag>{a}</Tag> },
            { title: t('adminPage.resource'), dataIndex: 'resource', key: 'resource' },
            { title: t('adminPage.ip'), dataIndex: 'ip_address', key: 'ip', width: 130 },
          ]}
          dataSource={auditData?.logs || []}
          loading={auditLoading}
          rowKey="id"
          pagination={{ current: auditPage, total: auditData?.total || 0, pageSize: 20, onChange: setAuditPage }}
          size="small"
        />
      ),
    },
  ]

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ marginBottom: 24 }}>{t('adminPage.title')}</Title>
      <Tabs items={tabItems} />

      {/* Tenant Drawer */}
      <Drawer
        title={`${t('adminPage.tenantLabel')} : ${tenantDetail?.tenant?.name || ''}`}
        open={drawerVisible}
        onClose={closeTenantDrawer}
        width={720}
        extra={<Space>
          <Button onClick={closeTenantDrawer}>{t('common.close')}</Button>
          <Button type="primary" onClick={handleTenantSave} loading={updateTenantMut.isPending}>{t('common.save')}</Button>
        </Space>}
      >
        {tenantDetail && (
          <div>
            <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('adminPage.subdomain')}>{tenantDetail.tenant?.subdomain}</Descriptions.Item>
              <Descriptions.Item label={t('adminPage.createdAt')}>{dayjs(tenantDetail.tenant?.created_at).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
              <Descriptions.Item label={t('adminPage.usersLabel')}>{tenantDetail.tenant?.user_count}</Descriptions.Item>
              <Descriptions.Item label={t('adminPage.currentPlan')}>{tenantDetail.tenant?.plan_name}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left">{t('common.edit')}</Divider>
            <Form form={tenantForm} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="name" label={t('common.name')} rules={[{ required: true }]}><Input /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="status" label={t('common.status')} rules={[{ required: true }]}>
                    <Select options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="plan_id" label={t('adminPage.plan')}><Select options={planOptions} placeholder={t('adminPage.plan')} /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="max_users_override" label={t('adminPage.maxUsersLabel')} tooltip={t('adminPage.maxUsersTooltip')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                </Col>
              </Row>
            </Form>

            <Divider orientation="left">{t('adminPage.usersLabel')} ({tenantDetail.users?.length || 0})</Divider>
            <Table
              columns={[
                { title: t('common.email'), dataIndex: 'email', key: 'email' },
                { title: t('common.name'), key: 'name', render: (_: any, r: any) => `${r.first_name} ${r.last_name}` },
                { title: t('adminPage.roleColumn'), dataIndex: 'role', key: 'role', render: (r: string) => <Tag color="blue">{r}</Tag> },
                { title: t('common.status'), dataIndex: 'status', key: 'status', render: (s: string) => <Badge status={s === 'active' ? 'success' : 'default'} text={s === 'active' ? t('adminPage.statusActive') : s} /> },
                { title: t('adminPage.twoFactor'), dataIndex: 'two_factor_enabled', key: '2fa', render: (v: boolean) => v ? <Tag color="green">{t('common.yes')}</Tag> : <Tag>{t('common.no')}</Tag> },
              ]}
              dataSource={tenantDetail.users || []}
              rowKey="id"
              size="small"
              pagination={false}
            />

            <Divider />
            <Popconfirm title={t('adminPage.deleteTenantConfirm')} description={t('adminPage.irreversibleAction')} onConfirm={() => deleteTenantMut.mutate(selectedTenant!)} okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}>
              <Button danger type="primary" icon={<DeleteOutlined />} loading={deleteTenantMut.isPending}>{t('adminPage.deleteTenant')}</Button>
            </Popconfirm>
          </div>
        )}
      </Drawer>

      {/* Plan Modal */}
      <Modal
        title={editingPlan ? t('adminPage.editPlan') : t('adminPage.newPlan')}
        open={planModalVisible}
        onCancel={() => { setPlanModalVisible(false); setEditingPlan(null); planForm.resetFields() }}
        onOk={handlePlanSave}
        okText={editingPlan ? t('common.save') : t('common.create')}
        cancelText={t('common.cancel')}
        confirmLoading={createPlanMut.isPending || updatePlanMut.isPending}
        width={600}
      >
        <Form form={planForm} layout="vertical">
          <Row gutter={16}>
            <Col span={16}><Form.Item name="name" label={t('common.name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="is_active" label={t('adminPage.active')} valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label={t('common.description')}><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="max_users" label={t('adminPage.maxUsers')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="max_invoices_month" label={t('adminPage.maxInvoicesMonth')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="max_storage_mb" label={t('adminPage.storageMb')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="price_monthly" label={t('adminPage.priceMonthly')}><InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="price_yearly" label={t('adminPage.priceYearly')}><InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
