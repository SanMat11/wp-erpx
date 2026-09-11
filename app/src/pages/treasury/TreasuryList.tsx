import { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Input,
  Space,
  Card,
  Modal,
  Form,
  Select,
  InputNumber,
  message,
  Tag,
  Popconfirm,
  Switch,
  Typography,
  Statistic,
  Row,
  Col,
  Checkbox,
} from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  BankOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { bankAccountAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'
import {
  europeanCountries,
  getBanksByCountry,
  Bank,
} from '@/data/europeanBanks'
import { ibanEstValide } from '@/utils/iban'

const { Title } = Typography

/**
 * Un montant, en français.
 *
 * ⚠️ LE FORMATEUR PAR DÉFAUT D'ANTD GROUPE À L'ANGLAISE. La carte « Solde
 * total » affichait « EUR112,115.74 » juste au-dessus d'un tableau qui écrit
 * « 1 170,00 € » : deux graphies du même montant sur le même écran. Le tableau
 * avait raison — on aligne tout dessus.
 */
const montantFr = (valeur: number | null | undefined): string =>
  Number(valeur ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

interface BankAccount {
  id: string
  country: string
  country_code: string
  bank_name: string
  bic: string
  iban: string
  initial_balance: number
  current_balance: number
  statement_number: number
  label: string
  is_default: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
}

interface BankAccountFormData {
  country: string
  country_code: string
  bank_name: string
  bic: string
  iban: string
  initial_balance: number
  statement_number: number
  label: string
  is_default: boolean
}

export default function TreasuryList() {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [modalVisible, setModalVisible] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<string>('')
  const [availableBanks, setAvailableBanks] = useState<Bank[]>([])
  const [showArchivéd, setShowArchivéd] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [form] = Form.useForm()
  const queryClient = useQueryClient()
  const { openDocumentTab } = useDocumentTabsStore()

  // ⚠️ LES BOUTONS MENTAIENT AUX RÔLES QUI N'ONT PAS LE DROIT.
  //
  // Tenir la trésorerie demande « amsbm_reconcile_bank » : Treasury::register()
  // l'exige sur toute écriture — créer, corriger, supprimer, archiver un compte.
  // Le serveur s'est fermé, l'écran ne l'avait pas appris : le commercial se
  // voyait offrir « Nouveau compte » et les crayons de ligne, et récoltait un
  // bandeau rouge au clic. La LECTURE, elle, reste ouverte à tous — c'est
  // pourquoi rien d'autre ne bouge ici.
  //
  // Dans la matrice, le module est « treasury », et le niveau « edit » suffit :
  // c'est lui que Settings::applyLevel() traduit en amsbm_reconcile_bank.
  const droitsConnus = usePermissionsChargees()
  const peutTenirLaTresorerie = usePermissionStore((etat) => etat.canEdit('treasury'))

  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN. La matrice arrive par un appel ;
  // masquer avant sa réponse ferait clignoter les boutons à chaque chargement.
  const montrerLesEcritures = !droitsConnus || peutTenirLaTresorerie

  const handleOpenAccount = (account: BankAccount) => {
    openDocumentTab('bank-account', account.id, account.label || account.bank_name)
  }

  // Fetch bank accounts
  const { data, isLoading } = useQuery({
    queryKey: ['bank-accounts', searchText, showArchivéd],
    queryFn: async () => {
      const response = await bankAccountAPI.list({ search: searchText, show_archived: showArchivéd })
      return response.data
    },
  })

  // ⚠️ La liste ne rend JAMAIS les deux moitiés à la fois : /bank-accounts
  // filtre sur is_archived, actifs OU archivés. La carte « Comptes actifs » et
  // la carte « Nombre de comptes » se nourrissaient donc de la même variable et
  // affichaient éternellement le même chiffre. On va chercher l'autre moitié.
  const { data: otherHalf } = useQuery({
    queryKey: ['bank-accounts', searchText, !showArchivéd],
    queryFn: async () => {
      const response = await bankAccountAPI.list({ search: searchText, show_archived: !showArchivéd })
      return response.data
    },
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (values: BankAccountFormData) => bankAccountAPI.create(values),
    onSuccess: () => {
      message.success(t('treasury.message.created'))
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      setModalVisible(false)
      form.resetFields()
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { error?: string } }; message?: string }
      const errorMsg = err.response?.data?.error || err.message || t('treasury.message.unknownError')
      message.error(`${t('treasury.message.errorPrefix')}: ${errorMsg}`)
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: BankAccountFormData }) =>
      bankAccountAPI.update(id, values),
    onSuccess: () => {
      message.success(t('treasury.message.updated'))
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      setModalVisible(false)
      setEditingAccount(null)
      form.resetFields()
    },
    onError: (error: Error) => {
      message.error(`${t('treasury.message.errorPrefix')}: ${error.message}`)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => bankAccountAPI.delete(id),
    onSuccess: () => {
      message.success(t('treasury.message.deleted'))
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
    },
    onError: (error: Error) => {
      message.error(`${t('treasury.message.errorPrefix')}: ${error.message}`)
    },
  })

  // Archivé bulk mutation
  const archiveBulkMutation = useMutation({
    mutationFn: ({ ids, archived }: { ids: string[]; archived: boolean }) =>
      bankAccountAPI.archiveBulk(ids, archived),
    onSuccess: (_, variables) => {
      message.success(
        variables.archived
          ? t('treasury.message.archivedCount', { count: variables.ids.length })
          : t('treasury.message.unarchivedCount', { count: variables.ids.length })
      )
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      setSelectedRowKeys([])
    },
    onError: (error: Error) => {
      message.error(`${t('treasury.message.errorPrefix')}: ${error.message}`)
    },
  })

  // Update available banks when country changes
  useEffect(() => {
    if (selectedCountry) {
      const banks = getBanksByCountry(selectedCountry)
      setAvailableBanks(banks)
    } else {
      setAvailableBanks([])
    }
  }, [selectedCountry])

  const handleOpenModal = (account?: BankAccount) => {
    if (account) {
      setEditingAccount(account)
      setSelectedCountry(account.country_code)
      form.setFieldsValue({
        country: account.country_code,
        country_code: account.country_code,
        bank_name: account.bank_name,
        bic: account.bic,
        iban: account.iban,
        initial_balance: account.initial_balance,
        statement_number: account.statement_number,
        label: account.label,
        is_default: account.is_default,
        is_archived: account.is_archived,
      })
    } else {
      setEditingAccount(null)
      setSelectedCountry('')
      form.resetFields()
    }
    setModalVisible(true)
  }

  const handleCountryChange = (countryCode: string) => {
    setSelectedCountry(countryCode)
    // ⚠️ NE PAS réécrire « country » avec le nom du pays. Ce champ EST le
    // sélecteur, dont les options valent le code ISO ; y mettre « Luxembourg »
    // à la place de « LU » faisait ensuite échouer la recherche du pays à
    // l'envoi, et le code partait au serveur sous la forme du nom — dans une
    // colonne de deux caractères. L'insertion échouait, sans que rien ne le
    // dise. Le nom est reconstitué au moment de l'envoi, à partir du code.
    form.setFieldsValue({
      country_code: countryCode,
      bank_name: undefined,
      bic: '',
    })
  }

  const handleBankChange = (bankName: string) => {
    const bank = availableBanks.find((b) => b.name === bankName)
    if (bank) {
      form.setFieldsValue({
        bic: bank.bic,
      })
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const country = europeanCountries.find((c) => c.code === values.country)

      const formData: BankAccountFormData = {
        country: country?.name || values.country,
        country_code: values.country,
        bank_name: values.bank_name,
        bic: values.bic,
        iban: values.iban.replace(/\s/g, '').toUpperCase(),
        initial_balance: values.initial_balance || 0,
        statement_number: values.statement_number || 1,
        label: values.label || '',
        // ⚠️ Un compte archivé ne peut pas être le compte par défaut.
        //
        // La modale laisse l'interrupteur « par défaut » sur ON quand on
        // archive : l'écran archivait (ce qui remet is_default à 0 côté
        // serveur) puis renvoyait aussitôt is_default:true. Le compte ressortait
        // archivé ET par défaut, et la règle d'exclusivité retirait la qualité
        // au seul compte actif qui la portait — plus aucun compte par défaut
        // visible.
        is_default: values.is_archived ? false : (values.is_default || false),
      }

      if (editingAccount) {
        // Check if archive status changed
        const archiveChanged = values.is_archived !== editingAccount.is_archived
        if (archiveChanged) {
          await bankAccountAPI.archive(editingAccount.id, values.is_archived)
        }
        updateMutation.mutate({ id: editingAccount.id, values: formData })
      } else {
        createMutation.mutate(formData)
      }
    } catch (error) {
      // Sans ceci, un champ obligatoire resté vide plus bas dans la fenêtre ne
      // produisait RIEN à l'écran : le bouton ne réagissait pas, la console
      // seule disait pourquoi. On nomme les champs manquants, et on remonte au
      // premier d'entre eux.
      const details = error as { errorFields?: Array<{ name: (string | number)[]; errors: string[] }> }
      const manquants = details.errorFields ?? []

      if (manquants.length > 0) {
        message.error(manquants.map((champ) => champ.errors[0]).join(' · '))
        form.scrollToField(manquants[0].name)
      } else {
        console.error('Validation failed:', error)
      }
    }
  }

  // Calculate totals
  const accounts: BankAccount[] = data?.data || []
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.current_balance, 0)
  // « Nombre de comptes » les compte TOUS, la troisième carte ne compte que la
  // moitié affichée : les deux chiffres disent enfin deux choses différentes.
  const shownCount = accounts.length
  const accountCount = shownCount + ((otherHalf?.data as BankAccount[] | undefined)?.length ?? 0)

  // Row selection
  const rowSelection: TableRowSelection<BankAccount> = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys)
    },
  }

  const handleArchivéSelected = (archived: boolean) => {
    archiveBulkMutation.mutate({
      ids: selectedRowKeys as string[],
      archived,
    })
  }

  const columns = [
    {
      title: t('treasury.column.label'),
      dataIndex: 'label',
      key: 'label',
      // Aucune colonne n'était triable : combiné au champ de recherche, qui ne
      // l'était pas davantage, le tableau des comptes ne se manipulait pas du
      // tout. Le tri porte sur la liste rendue, que la route donne entière.
      sorter: (a: BankAccount, b: BankAccount) =>
        (a.label || a.bank_name).localeCompare(b.label || b.bank_name, 'fr'),
      render: (text: string, record: BankAccount) => (
        <Space>
          {record.is_default && (
            <Tag color="green" icon={<CheckCircleOutlined />}>
              {t('treasury.tag.default')}
            </Tag>
          )}
          {record.is_archived && (
            <Tag color="default" icon={<InboxOutlined />}>
              {t('treasury.tag.archived')}
            </Tag>
          )}
          {text || record.bank_name}
        </Space>
      ),
    },
    {
      title: t('treasury.column.bank'),
      dataIndex: 'bank_name',
      key: 'bank_name',
      sorter: (a: BankAccount, b: BankAccount) => a.bank_name.localeCompare(b.bank_name, 'fr'),
    },
    {
      title: t('treasury.column.country'),
      dataIndex: 'country',
      key: 'country',
      width: 150,
    },
    {
      title: t('treasury.column.iban'),
      dataIndex: 'iban',
      key: 'iban',
      // ⚠️ SANS LARGEUR, LA COLONNE SE RÉTRÉCIT ET L'IBAN SE CASSE EN SIX
      // MORCEAUX EMPILÉS. Les espaces posés tous les quatre signes deviennent
      // alors autant de points de rupture, et un numéro de compte illisible
      // s'étale sur six lignes — au point de faire grandir toute la ligne du
      // tableau. On réserve la place qu'il faut, et on interdit la rupture :
      // un IBAN se lit d'un trait ou ne se lit pas.
      width: 220,
      render: (iban: string) => {
        if ( ! iban ) {
          return <span style={{ color: '#bfbfbf' }}>—</span>
        }

        // ⚠️ ON RETIRE LES ESPACES AVANT D'EN POSER. Le regroupement par quatre
        // s'appliquait à la chaîne telle quelle : un IBAN déjà espacé — saisi
        // ainsi, importé ainsi — ressortait « LU28 001 9 40 06 4 475 0000 »,
        // c'est-à-dire faux. Le formulaire, lui, nettoie à l'enregistrement ;
        // l'affichage ne peut pas compter là-dessus pour les données qui
        // viennent d'ailleurs.
        const formatted = iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()
        return <code style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatted}</code>
      },
    },
    {
      title: t('treasury.column.bic'),
      dataIndex: 'bic',
      key: 'bic',
      width: 120,
      // Un compte de caisse n'a ni IBAN ni BIC : une pastille grise vide se lit
      // comme un défaut d'affichage, un tiret se lit comme « rien ».
      render: (bic: string) => ( bic ? <code>{bic}</code> : <span style={{ color: '#bfbfbf' }}>—</span> ),
    },
    {
      title: t('treasury.column.currentBalance'),
      dataIndex: 'current_balance',
      key: 'current_balance',
      width: 150,
      align: 'right' as const,
      sorter: (a: BankAccount, b: BankAccount) => a.current_balance - b.current_balance,
      render: (balance: number) => (
        <span style={{ color: balance >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
          {montantFr(balance)}
        </span>
      ),
    },
    {
      title: t('treasury.column.statementNumber'),
      dataIndex: 'statement_number',
      key: 'statement_number',
      width: 100,
      align: 'center' as const,
    },
    // La colonne d'actions ne paraît pas du tout à qui ne tient pas la
    // trésorerie : une colonne vide de 120 px valait mieux que des boutons
    // refusés, mais pas de colonne du tout vaut mieux que les deux.
    ...(montrerLesEcritures
      ? [
          {
            title: t('treasury.column.actions'),
            key: 'actions',
            width: 120,
            render: (_: unknown, record: BankAccount) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenModal(record)}
                />
                <Popconfirm
                  title={t('treasury.confirm.delete')}
                  onConfirm={() => deleteMutation.mutate(record.id)}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ]

  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BankOutlined style={{ marginRight: 8 }} />
          {t('treasury.title')}
        </Title>
      </div>

      {/* Statistics */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={t('treasury.stat.accountCount')}
              value={accountCount}
              prefix={<BankOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={t('treasury.stat.totalBalance')}
              value={totalBalance}
              formatter={(valeur) => montantFr(Number(valeur))}
              valueStyle={{ color: totalBalance >= 0 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={showArchivéd ? t('treasury.stat.archivedAccounts') : t('treasury.stat.activeAccounts')}
              value={shownCount}
            />
          </Card>
        </Col>
      </Row>

      {/* Search and Add */}
      <Card style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Input
              placeholder={t('treasury.searchPlaceholder')}
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 300 }}
              allowClear
            />
            <Checkbox
              checked={showArchivéd}
              onChange={(e) => setShowArchivéd(e.target.checked)}
            >
              {t('treasury.showArchives')}
            </Checkbox>
          </Space>
          <Space>
            {montrerLesEcritures && selectedRowKeys.length > 0 && (
              showArchivéd ? (
                <Popconfirm
                  title={t('treasury.confirm.unarchive', { count: selectedRowKeys.length })}
                  onConfirm={() => handleArchivéSelected(false)}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                >
                  <Button
                    icon={<UndoOutlined />}
                    loading={archiveBulkMutation.isPending}
                  >
                    {t('treasury.button.unarchive', { count: selectedRowKeys.length })}
                  </Button>
                </Popconfirm>
              ) : (
                <Popconfirm
                  title={t('treasury.confirm.archive', { count: selectedRowKeys.length })}
                  onConfirm={() => handleArchivéSelected(true)}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                >
                  <Button
                    icon={<InboxOutlined />}
                    loading={archiveBulkMutation.isPending}
                  >
                    {t('treasury.button.archive', { count: selectedRowKeys.length })}
                  </Button>
                </Popconfirm>
              )
            )}
            {montrerLesEcritures && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => handleOpenModal()}
              >
                {t('treasury.button.newAccount')}
              </Button>
            )}
          </Space>
        </Space>
      </Card>

      {/* Table */}
      <Card>
        {/* Les cases à cocher ne servent qu'à l'archivage groupé : sans le droit
            d'archiver, elles ne mènent nulle part. */}
        <Table
          rowSelection={montrerLesEcritures ? rowSelection : undefined}
          columns={columns}
          dataSource={accounts}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          onRow={(record) => ({
            onClick: () => handleOpenAccount(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* Modal */}
      <Modal
        title={editingAccount ? t('treasury.modal.editTitle') : t('treasury.modal.newTitle')}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false)
          setEditingAccount(null)
          form.resetFields()
        }}
        width={700}
        okText={editingAccount ? t('treasury.button.update') : t('common.create')}
        cancelText={t('common.cancel')}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="country"
                label={t('treasury.form.country')}
                rules={[{ required: true, message: t('treasury.validation.country') }]}
              >
                <Select
                  showSearch
                  placeholder={t('treasury.form.countryPlaceholder')}
                  optionFilterProp="children"
                  onChange={handleCountryChange}
                  filterOption={(input, option) =>
                    (option?.children as unknown as string)
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                >
                  {europeanCountries.map((country) => (
                    <Select.Option key={country.code} value={country.code}>
                      {country.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="bank_name"
                label={t('treasury.form.bank')}
                rules={[{ required: true, message: t('treasury.validation.bank') }]}
              >
                <Select
                  showSearch
                  placeholder={selectedCountry ? t('treasury.form.bankPlaceholder') : t('treasury.form.bankPlaceholderNoCountry')}
                  disabled={!selectedCountry}
                  optionFilterProp="children"
                  onChange={handleBankChange}
                  filterOption={(input, option) =>
                    (option?.children as unknown as string)
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                >
                  {availableBanks.map((bank) => (
                    <Select.Option key={bank.bic} value={bank.name}>
                      {bank.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="iban"
                label={t('treasury.form.iban')}
                rules={[
                  { required: true, message: t('treasury.validation.ibanRequired') },
                  {
                    // Un motif refusant les espaces enfermait l'utilisateur :
                    // l'exemple affiche « FR76 1234 … », l'envoi retire bien
                    // les espaces — mais la validation passe AVANT lui, sur la
                    // valeur brute. Un IBAN correctement recopié d'un relevé
                    // etait donc declare invalide, sans recours.
                    validator: (_, value) =>
                      !value || ibanEstValide(String(value))
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('treasury.validation.ibanInvalid'))),
                  },
                ]}
              >
                <Input
                  placeholder="FR76 1234 5678 9012 3456 7890 123"
                  style={{ textTransform: 'uppercase' }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="bic"
                label={t('treasury.form.bic')}
                rules={[{ required: true, message: t('treasury.validation.bicRequired') }]}
              >
                <Input placeholder="BNPAFRPP" readOnly style={{ backgroundColor: '#f5f5f5' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="initial_balance"
                label={t('treasury.form.initialBalance')}
                initialValue={0}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  formatter={(value) =>
                    `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                  }
                  parser={(value) => value!.replace(/\s/g, '') as unknown as number}
                  addonAfter="EUR"
                  precision={2}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="statement_number"
                label={t('treasury.form.statementNumber')}
                initialValue={1}
              >
                <InputNumber style={{ width: '100%' }} min={1} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="label"
            label={t('treasury.form.label')}
            rules={[{ required: true, message: t('treasury.validation.labelRequired') }]}
          >
            <Input placeholder={t('treasury.form.labelPlaceholder')} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="is_default"
                label={t('treasury.form.isDefault')}
                valuePropName="checked"
                initialValue={false}
              >
                <Switch />
              </Form.Item>
            </Col>
            {editingAccount && (
              <Col span={12}>
                <Form.Item
                  name="is_archived"
                  label={t('treasury.form.isArchived')}
                  valuePropName="checked"
                  initialValue={false}
                >
                  <Switch />
                </Form.Item>
              </Col>
            )}
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
