import { useState } from 'react'
import { Table, Select, message, Card, Typography, Tag, Spin, Alert } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { settingsAPI } from '@/services/api'
import type { ColumnsType } from 'antd/es/table'

const { Title, Text } = Typography

interface RoleInfo {
  code: string
  label: string
}

interface ModuleInfo {
  code: string
  label: string
}

interface PermissionMatrix {
  roles: RoleInfo[]
  modules: ModuleInfo[]
  permissions: Record<string, Record<string, string>>
}

export default function PermissionsSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingChanges, setPendingChanges] = useState<Record<string, Record<string, string>>>({})

  const permissionOptions = [
    { value: 'none', label: t('permissionsSettings.permNone'), color: 'default' },
    { value: 'view', label: t('permissionsSettings.permView'), color: 'blue' },
    { value: 'edit', label: t('permissionsSettings.permEdit'), color: 'orange' },
    { value: 'full', label: t('permissionsSettings.permFull'), color: 'green' },
  ]

  // Fetch permission matrix
  const { data: matrix, isLoading, error } = useQuery<PermissionMatrix>({
    queryKey: ['permissions-matrix'],
    queryFn: async () => {
      const response = await settingsAPI.getPermissionMatrix()
      return response.data
    },
  })

  // Update permission mutation
  const updatePermission = useMutation({
    mutationFn: async (data: { role: string; module: string; permission: string }) => {
      return settingsAPI.updatePermission(data)
    },
    onSuccess: () => {
      message.success(t('permissionsSettings.updateSuccess'))
      queryClient.invalidateQueries({ queryKey: ['permissions-matrix'] })
    },
    onError: () => {
      message.error(t('permissionsSettings.updateError'))
    },
  })

  // Handle permission change
  const handlePermissionChange = (role: string, module: string, permission: string) => {
    // Update local state for immediate feedback
    setPendingChanges(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [module]: permission,
      },
    }))

    // Send to server
    updatePermission.mutate({ role, module, permission })
  }

  // Get current permission value (from pending changes or matrix)
  const getPermissionValue = (role: string, module: string): string => {
    if (pendingChanges[role]?.[module]) {
      return pendingChanges[role][module]
    }
    return matrix?.permissions[role]?.[module] || 'none'
  }

  // Build table columns dynamically from roles
  const columns: ColumnsType<{ moduleCode: string; moduleLabel: string }> = [
    {
      title: t('permissionsSettings.moduleColumn'),
      dataIndex: 'moduleLabel',
      key: 'module',
      fixed: 'left',
      width: 180,
      render: (label: string) => (
        <Text strong>{label}</Text>
      ),
    },
    ...(matrix?.roles || []).map(role => ({
      title: (
        <div style={{ textAlign: 'center' }}>
          <Text strong>{role.label}</Text>
        </div>
      ),
      key: role.code,
      width: 150,
      align: 'center' as const,
      render: (_: unknown, record: { moduleCode: string; moduleLabel: string }) => {
        const permission = getPermissionValue(role.code, record.moduleCode)
        const isUpdating = updatePermission.isPending

        return (
          <Select
            size="small"
            value={permission}
            onChange={(value) => handlePermissionChange(role.code, record.moduleCode, value)}
            style={{ width: 140 }}
            // ⚠️ « administrator », pas « admin » : c'est le code que rend la
            // matrice (Settings.php). La garde ne se déclenchait donc jamais, la
            // colonne restait cliquable, et le serveur — qui refuse à juste
            // titre de toucher aux droits de l'administrateur — passait pour
            // une panne.
            disabled={isUpdating || role.code === 'administrator'}
            options={permissionOptions.map(opt => ({
              value: opt.value,
              label: (
                <Tag color={opt.color} style={{ margin: 0 }}>
                  {opt.label}
                </Tag>
              ),
            }))}
          />
        )
      },
    })),
  ]

  // Build table data from modules
  const tableData = (matrix?.modules || []).map(module => ({
    key: module.code,
    moduleCode: module.code,
    moduleLabel: module.label,
  }))

  if (error) {
    return (
      <Alert
        type="error"
        message={t('permissionsSettings.loadErrorTitle')}
        description={t('permissionsSettings.loadErrorDesc')}
        showIcon
      />
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 8 }}>{t('permissionsSettings.pageTitle')}</Title>
        <Text type="secondary">
          {t('permissionsSettings.pageSubtitle')}
        </Text>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Text strong>{t('permissionsSettings.legendLabel')}</Text>
          {permissionOptions.map(opt => (
            <Tag key={opt.value} color={opt.color} style={{ marginLeft: 8 }}>
              {opt.label}
            </Tag>
          ))}
        </div>

        <Alert
          type="info"
          message={t('permissionsSettings.levelsTitle')}
          description={
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              <li><strong>{t('permissionsSettings.permNone')}</strong> - {t('permissionsSettings.levelNoneDesc')}</li>
              <li><strong>{t('permissionsSettings.permView')}</strong> - {t('permissionsSettings.levelViewDesc')}</li>
              <li><strong>{t('permissionsSettings.permEdit')}</strong> - {t('permissionsSettings.levelEditDesc')}</li>
              <li><strong>{t('permissionsSettings.permFull')}</strong> - {t('permissionsSettings.levelFullDesc')}</li>
            </ul>
          }
          style={{ marginBottom: 16 }}
          showIcon
        />

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Table
            columns={columns}
            dataSource={tableData}
            pagination={false}
            scroll={{ x: 'max-content' }}
            bordered
            size="middle"
          />
        )}

        <div style={{ marginTop: 16 }}>
          <Text type="secondary">
            {t('permissionsSettings.adminNote')}
          </Text>
        </div>
      </Card>
    </div>
  )
}
