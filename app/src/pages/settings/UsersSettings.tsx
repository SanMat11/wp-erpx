import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  message,
  Spin,
  Space,
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
} from '@ant-design/icons'
import { settingsAPI } from '@/services/api'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  status: string
  last_login_at: string | null
  created_at: string
}

const roleColors: Record<string, string> = {
  tenant_admin: 'purple',
  manager: 'blue',
  accountant: 'green',
  sales: 'orange',
  // « purchaser » (amsbm_purchaser) est un rôle installé comme les autres, et le
  // serveur le rend dans ce vocabulaire : sans lui ici, un acheteur s'affichait
  // en étiquette grise portant son code brut.
  purchaser: 'gold',
  warehouse: 'cyan',
  readonly: 'default',
}

// Le serveur rend le code court (« sales »), mais un compte dont le rôle a été
// posé directement par l'API peut encore ressortir préfixé. On normalise avant
// de chercher l'étiquette, plutôt que d'afficher « amsbm_sales » à l'écran.
const codeRole = (role: string) => role.replace(/^amsbm_/, '').replace(/^viewer$/, 'readonly')

const statusColors: Record<string, string> = {
  active: 'success',
  inactive: 'default',
  pending: 'warning',
}

export default function UsersSettings() {
  const { t } = useTranslation()
  const roles = [
    { value: 'tenant_admin', label: t('usersSettings.roleTenantAdmin') },
    { value: 'manager', label: t('usersSettings.roleManager') },
    { value: 'accountant', label: t('usersSettings.roleAccountant') },
    { value: 'sales', label: t('usersSettings.roleSales') },
    { value: 'purchaser', label: t('usersSettings.rolePurchaser', 'Acheteur') },
    { value: 'warehouse', label: t('usersSettings.roleWarehouse') },
    { value: 'readonly', label: t('usersSettings.roleReadonly') },
  ]
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [passwordForm] = Form.useForm()

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.listUsers()
      setUsers(response.data.users || [])
    } catch (error) {
      message.error(t('usersSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (user?: User) => {
    setEditingUser(user || null)
    if (user) {
      form.setFieldsValue({
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: codeRole(user.role || ''),
        status: user.status,
      })
    } else {
      form.resetFields()
    }
    setModalVisible(true)
  }

  const handleCloseModal = () => {
    setModalVisible(false)
    setEditingUser(null)
    form.resetFields()
  }

  const handleSubmit = async (values: any) => {
    setSaving(true)
    try {
      if (editingUser) {
        await settingsAPI.updateUser(editingUser.id, values)
        message.success(t('usersSettings.userUpdated'))
      } else {
        await settingsAPI.createUser(values)
        message.success(t('usersSettings.userCreated'))
      }
      handleCloseModal()
      loadUsers()
    } catch (error: any) {
      message.error(error.response?.data?.error || t('usersSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await settingsAPI.deleteUser(id)
      message.success(t('usersSettings.userDeleted'))
      loadUsers()
    } catch (error: any) {
      message.error(error.response?.data?.error || t('usersSettings.deleteError'))
    }
  }

  const handleChangePassword = async (values: any) => {
    setSaving(true)
    try {
      await settingsAPI.changePassword(values.current_password, values.new_password)
      message.success(t('usersSettings.passwordChanged'))
      setPasswordModalVisible(false)
      passwordForm.resetFields()
    } catch (error: any) {
      message.error(error.response?.data?.error || t('usersSettings.passwordChangeError'))
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: t('common.name'),
      key: 'name',
      render: (user: User) => `${user.first_name} ${user.last_name}`,
    },
    {
      title: t('common.email'),
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: t('usersSettings.role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const code = codeRole(role || '')

        return (
          <Tag color={roleColors[code] || 'default'}>
            {roles.find(r => r.value === code)?.label || role}
          </Tag>
        )
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={statusColors[status] || 'default'}>
          {status === 'active'
            ? t('usersSettings.statusActive')
            : status === 'inactive'
              ? t('usersSettings.statusInactive')
              : t('usersSettings.statusPending')}
        </Tag>
      ),
    },
    {
      title: t('usersSettings.lastLogin'),
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      render: (date: string | null) =>
        date ? new Date(date).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) : '-',
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (user: User) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(user)}
          />
          <Popconfirm
            title={t('usersSettings.deleteConfirm')}
            onConfirm={() => handleDelete(user.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t('usersSettings.title')}</h3>
        <Space>
          <Button icon={<KeyOutlined />} onClick={() => setPasswordModalVisible(true)}>
            {t('usersSettings.changeMyPassword')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
            {t('usersSettings.newUser')}
          </Button>
        </Space>
      </div>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
      />

      {/* Modal création/édition utilisateur */}
      <Modal
        title={editingUser ? t('usersSettings.editUser') : t('usersSettings.newUser')}
        open={modalVisible}
        onCancel={handleCloseModal}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="email"
            label={t('common.email')}
            rules={[
              { required: true, message: t('usersSettings.emailRequired') },
              { type: 'email', message: t('usersSettings.emailInvalid') },
            ]}
          >
            <Input disabled={!!editingUser} />
          </Form.Item>

          {!editingUser && (
            <Form.Item
              name="password"
              label={t('usersSettings.password')}
              rules={[
                { required: true, message: t('usersSettings.passwordRequired') },
                { min: 8, message: t('usersSettings.minEightChars') },
              ]}
            >
              <Input.Password />
            </Form.Item>
          )}

          <Form.Item
            name="first_name"
            label={t('usersSettings.firstName')}
            rules={[{ required: true, message: t('usersSettings.firstNameRequired') }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="last_name"
            label={t('common.name')}
            rules={[{ required: true, message: t('usersSettings.lastNameRequired') }]}
          >
            <Input />
          </Form.Item>

          <Form.Item name="role" label={t('usersSettings.role')} rules={[{ required: true }]}>
            <Select options={roles} />
          </Form.Item>

          {editingUser && (
            <Form.Item name="status" label={t('common.status')}>
              <Select
                options={[
                  { value: 'active', label: t('usersSettings.statusActive') },
                  { value: 'inactive', label: t('usersSettings.statusInactive') },
                ]}
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space style={{ float: 'right' }}>
              <Button onClick={handleCloseModal}>{t('common.cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={saving}>
                {editingUser ? t('common.edit') : t('common.create')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal changement de mot de passe */}
      <Modal
        title={t('usersSettings.changeMyPassword')}
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false)
          passwordForm.resetFields()
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
          <Form.Item
            name="current_password"
            label={t('usersSettings.currentPassword')}
            rules={[{ required: true, message: t('usersSettings.required') }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="new_password"
            label={t('usersSettings.newPassword')}
            rules={[
              { required: true, message: t('usersSettings.required') },
              { min: 8, message: t('usersSettings.minEightChars') },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label={t('usersSettings.confirmNewPassword')}
            dependencies={['new_password']}
            rules={[
              { required: true, message: t('usersSettings.required') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('usersSettings.passwordsMismatch')))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                setPasswordModalVisible(false)
                passwordForm.resetFields()
              }}>
                {t('common.cancel')}
              </Button>
              <Button type="primary" htmlType="submit" loading={saving}>
                {t('usersSettings.changeButton')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
