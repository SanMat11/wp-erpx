import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Card, Table, Button, Space, Tag, Input, Switch, Select,
  InputNumber, Row, Col, message, Popconfirm,
  Divider, Typography, Tooltip, Modal, Checkbox,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined,
  SaveOutlined, ArrowLeftOutlined,
  ZoomInOutlined, ZoomOutOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminAPI } from '@/services/api'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// =============================================================================
// Types
// =============================================================================

interface FieldProps {
  x: number
  y: number
  width: number
  height?: number
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  align?: 'L' | 'C' | 'R'
  bgColor?: string
  textColor?: string
  enabled?: boolean
  text?: string
}

interface FieldsMap {
  [key: string]: FieldProps
}

interface TemplateData {
  pageSize: string
  margins: { top: number; right: number; bottom: number; left: number }
  headerColor: string
  fields: FieldsMap
  documentTypes?: string[]
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string

function getDocumentTypes(t: TFunc) {
  return [
    { value: 'invoice', label: t('pdfTemplateEditor.documentTypes.invoice') },
    { value: 'supplier_invoice', label: t('pdfTemplateEditor.documentTypes.supplier_invoice') },
    { value: 'quote', label: t('pdfTemplateEditor.documentTypes.quote') },
    { value: 'purchase_order', label: t('pdfTemplateEditor.documentTypes.purchase_order') },
    { value: 'deal', label: t('pdfTemplateEditor.documentTypes.deal') },
    { value: 'amendment', label: t('pdfTemplateEditor.documentTypes.amendment') },
  ]
}

interface PDFTemplate {
  id?: string
  name: string
  description: string
  is_default: boolean
  is_active: boolean
  template_data: TemplateData
  created_at?: string
  updated_at?: string
}

// =============================================================================
// Constants
// =============================================================================

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
const CANVAS_WIDTH_PX = 595
const MM_TO_PX = CANVAS_WIDTH_PX / A4_WIDTH_MM // ~2.833

// FIELD_GROUPS structure: keys + colors are static; group/field labels are
// resolved via i18n (groupKey / fieldKey reference translation key suffixes).
const FIELD_GROUPS: { groupKey: string; color: string; fields: { key: string }[] }[] = [
  {
    groupKey: 'company',
    color: '#1890ff',
    fields: [
      { key: 'logo' },
      { key: 'company_name' },
      { key: 'company_address' },
      { key: 'company_postal_city' },
      { key: 'company_phone' },
      { key: 'company_email' },
    ],
  },
  {
    groupKey: 'client',
    color: '#52c41a',
    fields: [
      { key: 'client_name' },
      { key: 'client_address' },
      { key: 'client_postal_city' },
      { key: 'client_country' },
    ],
  },
  {
    groupKey: 'document',
    color: '#fa8c16',
    fields: [
      { key: 'doc_title' },
      { key: 'info_band' },
      { key: 'items_table' },
    ],
  },
  {
    groupKey: 'totalsDelivery',
    color: '#eb2f96',
    fields: [
      { key: 'totals' },
      { key: 'delivery_address' },
      { key: 'legal_mentions' },
    ],
  },
  {
    groupKey: 'special',
    color: '#722ed1',
    fields: [
      { key: 'badge' },
      { key: 'footer' },
      { key: 'custom_text' },
    ],
  },
]

const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key))

function getFieldLabel(t: TFunc, key: string): string {
  if (ALL_FIELD_KEYS.includes(key)) return t(`pdfTemplateEditor.fieldLabels.${key}`)
  return key
}

function getFieldColor(key: string): string {
  for (const g of FIELD_GROUPS) {
    if (g.fields.some((f) => f.key === key)) return g.color
  }
  return '#999'
}

const DEFAULT_FIELDS: FieldsMap = {
  logo: { x: 10, y: 8.8, width: 49, height: 25 },
  company_name: { x: 110, y: 9, width: 85, fontSize: 13, fontWeight: 'bold', align: 'R' },
  company_address: { x: 110, y: 16, width: 85, fontSize: 8, align: 'R' },
  company_postal_city: { x: 110, y: 20, width: 85, fontSize: 8, align: 'R' },
  company_phone: { x: 110, y: 24, width: 85, fontSize: 8, align: 'R' },
  company_email: { x: 110, y: 28, width: 85, fontSize: 8, align: 'R' },
  client_name: { x: 110, y: 42, width: 85, fontSize: 10, fontWeight: 'bold' },
  client_address: { x: 110, y: 48, width: 85, fontSize: 9 },
  client_postal_city: { x: 110, y: 53, width: 85, fontSize: 9 },
  client_country: { x: 110, y: 58, width: 85, fontSize: 9 },
  doc_title: { x: 9, y: 70, width: 100, height: 12, fontSize: 16, fontWeight: 'bold' },
  info_band: { x: 9, y: 82, width: 192, height: 14, fontSize: 8 },
  items_table: { x: 9, y: 100, width: 192, height: 120, fontSize: 8, bgColor: 'primary', textColor: '#ffffff' },
  totals: { x: 121, y: 225, width: 80, height: 53, fontSize: 9, align: 'R' },
  delivery_address: { x: 9, y: 225, width: 80, height: 20, fontSize: 9 },
  legal_mentions: { x: 9, y: 248, width: 80, height: 20, fontSize: 7 },
  badge: { x: 2, y: 38, width: 7, height: 30, bgColor: 'primary', textColor: '#ffffff' },
  footer: { x: 9, y: 280, width: 192, height: 10, fontSize: 7 },
  custom_text: { x: 9, y: 265, width: 192, height: 10, fontSize: 8, enabled: false },
}

const DEFAULT_TEMPLATE_DATA: TemplateData = {
  pageSize: 'A4',
  margins: { top: 9, right: 9, bottom: 15, left: 9 },
  headerColor: 'primary',
  fields: { ...DEFAULT_FIELDS },
}

// =============================================================================
// Backward compat: convert old blocks format to new fields format
// =============================================================================

function convertBlocksToFields(data: any): FieldsMap {
  const blockMapping: Record<string, string> = {
    header_left: 'logo',
    header_right: 'company_name',
    client_block: 'client_name',
    title_block: 'doc_title',
    info_band: 'info_band',
    table_block: 'items_table',
    badge_block: 'badge',
    footer_block: 'footer',
  }

  const fields: FieldsMap = {}

  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      const fieldKey = blockMapping[block.id] || blockMapping[block.name] || block.id
      if (ALL_FIELD_KEYS.includes(fieldKey)) {
        fields[fieldKey] = {
          x: block.x ?? 0,
          y: block.y ?? 0,
          width: block.width ?? 50,
          height: block.height,
          fontSize: block.config?.fontSize,
          fontWeight: block.config?.fontWeight as any,
          align: block.config?.align === 'left' ? 'L' : block.config?.align === 'right' ? 'R' : block.config?.align === 'center' ? 'C' : undefined,
          bgColor: block.config?.bgColor,
          textColor: block.config?.textColor,
        }
      }
    }
  }

  // Fill missing fields with defaults
  for (const key of ALL_FIELD_KEYS) {
    if (!fields[key] && DEFAULT_FIELDS[key]) {
      fields[key] = { ...DEFAULT_FIELDS[key] }
    }
  }

  return fields
}

function normalizeTemplateData(raw: any): TemplateData {
  if (!raw) return { ...DEFAULT_TEMPLATE_DATA, fields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)) }

  // Already new format
  if (raw.fields && !raw.blocks) {
    const fields: FieldsMap = {}
    for (const key of ALL_FIELD_KEYS) {
      fields[key] = raw.fields[key] ? { ...raw.fields[key] } : { ...DEFAULT_FIELDS[key] }
    }
    return {
      pageSize: raw.pageSize || 'A4',
      margins: raw.margins || { top: 9, right: 9, bottom: 15, left: 9 },
      headerColor: raw.headerColor || 'primary',
      fields,
    }
  }

  // Old blocks format
  if (raw.blocks) {
    return {
      pageSize: raw.pageSize || 'A4',
      margins: raw.margins || { top: 9, right: 9, bottom: 15, left: 9 },
      headerColor: 'primary',
      fields: convertBlocksToFields(raw),
    }
  }

  return { ...DEFAULT_TEMPLATE_DATA, fields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)) }
}

// =============================================================================
// Main Component
// =============================================================================

export default function PDFTemplateEditor() {
  const { t } = useTranslation()
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingTemplate, setEditingTemplate] = useState<PDFTemplate | null>(null)
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateId, setDuplicateId] = useState<string>('')
  const [duplicateName, setDuplicateName] = useState('')
  const queryClient = useQueryClient()

  // ---- List View ----
  if (view === 'list') {
    return (
      <TemplateList
        onEdit={(tpl) => {
          setEditingTemplate(tpl)
          setView('editor')
        }}
        onCreate={() => {
          setEditingTemplate({
            name: '',
            description: '',
            is_default: false,
            is_active: true,
            template_data: { ...DEFAULT_TEMPLATE_DATA, fields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)) },
          })
          setView('editor')
        }}
        onDuplicate={(id, currentName) => {
          setDuplicateId(id)
          setDuplicateName(currentName + t('pdfTemplateEditor.duplicate.copySuffix'))
          setDuplicateModalOpen(true)
        }}
        queryClient={queryClient}
      />
    )
  }

  // ---- Editor View ----
  return (
    <>
      <TemplateEditorView
        template={editingTemplate!}
        onBack={() => {
          setView('list')
          setEditingTemplate(null)
          queryClient.invalidateQueries({ queryKey: ['pdf-templates'] })
        }}
        queryClient={queryClient}
      />
      <Modal
        title={t('pdfTemplateEditor.duplicate.modalTitle')}
        open={duplicateModalOpen}
        onOk={async () => {
          try {
            await adminAPI.duplicatePDFTemplate(duplicateId, duplicateName)
            message.success(t('pdfTemplateEditor.messages.duplicated'))
            queryClient.invalidateQueries({ queryKey: ['pdf-templates'] })
          } catch {
            message.error(t('pdfTemplateEditor.messages.duplicateError'))
          }
          setDuplicateModalOpen(false)
        }}
        onCancel={() => setDuplicateModalOpen(false)}
      >
        <Input
          value={duplicateName}
          onChange={(e) => setDuplicateName(e.target.value)}
          placeholder={t('pdfTemplateEditor.duplicate.namePlaceholder')}
        />
      </Modal>
    </>
  )
}

// =============================================================================
// Template List
// =============================================================================

function TemplateList({
  onEdit,
  onCreate,
  onDuplicate,
  queryClient,
}: {
  onEdit: (tpl: PDFTemplate) => void
  onCreate: () => void
  onDuplicate: (id: string, name: string) => void
  queryClient: any
}) {
  const { t } = useTranslation()
  const documentTypes = getDocumentTypes(t)
  const { data, isLoading } = useQuery({
    queryKey: ['pdf-templates'],
    queryFn: async () => {
      const res = await adminAPI.listPDFTemplates()
      const d = res.data
      return Array.isArray(d) ? d : (d?.templates || d?.data || [])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminAPI.deletePDFTemplate(id),
    onSuccess: () => {
      message.success(t('pdfTemplateEditor.messages.deleted'))
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] })
    },
    onError: () => message.error(t('pdfTemplateEditor.messages.deleteError')),
  })

  const columns = [
    {
      title: t('pdfTemplateEditor.columns.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <Space>
          <Text strong>{name}</Text>
          {record.is_default && <Tag color="blue">{t('pdfTemplateEditor.tags.default')}</Tag>}
          {!record.is_active && <Tag color="red">{t('pdfTemplateEditor.tags.inactive')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('pdfTemplateEditor.columns.description'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: t('pdfTemplateEditor.columns.documents'),
      key: 'documents',
      width: 250,
      render: (_: any, record: any) => {
        const types = record.template_data?.documentTypes || []
        if (types.length === 0) return <Text type="secondary">{t('pdfTemplateEditor.columns.allDocuments')}</Text>
        return (
          <Space size={[0, 4]} wrap>
            {types.map((typeValue: string) => {
              const dt = documentTypes.find((d) => d.value === typeValue)
              return <Tag key={typeValue} color="blue">{dt?.label || typeValue}</Tag>
            })}
          </Space>
        )
      },
    },
    {
      title: t('pdfTemplateEditor.columns.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '-',
    },
    {
      title: t('pdfTemplateEditor.columns.updatedAt'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '-',
    },
    {
      title: t('pdfTemplateEditor.columns.actions'),
      key: 'actions',
      width: 200,
      render: (_: any, record: any) => (
        <Space>
          <Tooltip title={t('pdfTemplateEditor.buttons.edit')}>
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => {
                const templateData = normalizeTemplateData(
                  record.template_data || record.sections
                )
                onEdit({
                  id: record.id,
                  name: record.name,
                  description: record.description || '',
                  is_default: record.is_default || false,
                  is_active: record.is_active !== false,
                  template_data: templateData,
                  created_at: record.created_at,
                  updated_at: record.updated_at,
                })
              }}
            />
          </Tooltip>
          <Tooltip title={t('pdfTemplateEditor.buttons.duplicate')}>
            <Button
              icon={<CopyOutlined />}
              size="small"
              onClick={() => onDuplicate(record.id, record.name)}
            />
          </Tooltip>
          <Popconfirm
            title={t('pdfTemplateEditor.confirm.deleteTemplate')}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText={t('pdfTemplateEditor.confirm.yes')}
            cancelText={t('pdfTemplateEditor.confirm.no')}
          >
            <Tooltip title={t('pdfTemplateEditor.buttons.delete')}>
              <Button icon={<DeleteOutlined />} size="small" danger />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title={<Title level={4} style={{ margin: 0 }}>{t('pdfTemplateEditor.list.title')}</Title>}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          {t('pdfTemplateEditor.buttons.newTemplate')}
        </Button>
      }
    >
      <Table
        dataSource={data || []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={false}
      />
    </Card>
  )
}

// =============================================================================
// Template Editor View
// =============================================================================

function TemplateEditorView({
  template,
  onBack,
  queryClient,
}: {
  template: PDFTemplate
  onBack: () => void
  queryClient: any
}) {
  const { t } = useTranslation()
  const documentTypes = getDocumentTypes(t)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [isDefault, setIsDefault] = useState(template.is_default)
  const [isActive, setIsActive] = useState(template.is_active)
  const [templateData, setTemplateData] = useState<TemplateData>(() =>
    JSON.parse(JSON.stringify(template.template_data))
  )
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showGrid, setShowGrid] = useState(false)
  const [saving, setSaving] = useState(false)

  const updateField = useCallback((key: string, props: Partial<FieldProps>) => {
    setTemplateData((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [key]: { ...prev.fields[key], ...props },
      },
    }))
  }, [])

  const handleSave = async () => {
    if (!name.trim()) {
      message.error(t('pdfTemplateEditor.messages.nameRequired'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        name,
        description,
        is_default: isDefault,
        is_active: isActive,
        template_data: templateData,
      }
      if (template.id) {
        await adminAPI.updatePDFTemplate(template.id, payload)
        message.success(t('pdfTemplateEditor.messages.updated'))
      } else {
        await adminAPI.createPDFTemplate(payload)
        message.success(t('pdfTemplateEditor.messages.created'))
      }
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] })
    } catch {
      message.error(t('pdfTemplateEditor.messages.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* Top bar */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            {t('pdfTemplateEditor.buttons.back')}
          </Button>
          <Input
            style={{ width: 220 }}
            placeholder={t('pdfTemplateEditor.fields.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            style={{ width: 300 }}
            placeholder={t('pdfTemplateEditor.fields.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            mode="multiple"
            style={{ minWidth: 250 }}
            placeholder={t('pdfTemplateEditor.fields.documentTypesPlaceholder')}
            value={templateData.documentTypes || []}
            onChange={(v) => setTemplateData((prev) => ({ ...prev, documentTypes: v }))}
            options={documentTypes}
            maxTagCount="responsive"
            size="small"
          />
          <Space>
            <Text>{t('pdfTemplateEditor.fields.defaultLabel')}</Text>
            <Switch checked={isDefault} onChange={setIsDefault} size="small" />
          </Space>
          <Space>
            <Text>{t('pdfTemplateEditor.fields.activeLabel')}</Text>
            <Switch checked={isActive} onChange={setIsActive} size="small" />
          </Space>
          <div style={{ flex: 1 }} />
          <Space>
            <Tooltip title={t('pdfTemplateEditor.buttons.zoomOut')}>
              <Button
                icon={<ZoomOutOutlined />}
                size="small"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              />
            </Tooltip>
            <Text style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Text>
            <Tooltip title={t('pdfTemplateEditor.buttons.zoomIn')}>
              <Button
                icon={<ZoomInOutlined />}
                size="small"
                onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              />
            </Tooltip>
            <Checkbox checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)}>
              {t('pdfTemplateEditor.fields.grid')}
            </Checkbox>
          </Space>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            {t('pdfTemplateEditor.buttons.save')}
          </Button>
        </div>
      </Card>

      {/* Three-column layout */}
      <div style={{ display: 'flex', flex: 1, gap: 12, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Field list */}
        <Card
          size="small"
          title={t('pdfTemplateEditor.sections.fields')}
          bodyStyle={{ padding: 8, overflowY: 'auto' }}
          style={{ width: 200, flexShrink: 0 }}
        >
          <FieldListPanel
            fields={templateData.fields}
            selectedField={selectedField}
            onSelect={setSelectedField}
          />
        </Card>

        {/* Center: Canvas */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#f0f0f0',
            display: 'flex',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <A4Canvas
            templateData={templateData}
            zoom={zoom}
            showGrid={showGrid}
            selectedField={selectedField}
            onSelectField={setSelectedField}
            onUpdateField={updateField}
          />
        </div>

        {/* Right: Properties */}
        <Card
          size="small"
          title={t('pdfTemplateEditor.sections.properties')}
          bodyStyle={{ padding: 12, overflowY: 'auto' }}
          style={{ width: 250, flexShrink: 0 }}
        >
          {selectedField ? (
            <FieldPropertiesPanel
              fieldKey={selectedField}
              field={templateData.fields[selectedField]}
              onChange={(props) => updateField(selectedField, props)}
            />
          ) : (
            <Text type="secondary">{t('pdfTemplateEditor.sections.selectFieldHint')}</Text>
          )}
        </Card>
      </div>
    </div>
  )
}

// =============================================================================
// Field List Panel (left)
// =============================================================================

function FieldListPanel({
  fields,
  selectedField,
  onSelect,
}: {
  fields: FieldsMap
  selectedField: string | null
  onSelect: (key: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      {FIELD_GROUPS.map((group) => (
        <div key={group.groupKey} style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 11, color: group.color, textTransform: 'uppercase' }}>
            {t(`pdfTemplateEditor.fieldGroups.${group.groupKey}`)}
          </Text>
          {group.fields.map((f) => {
            const isEnabled = fields[f.key]?.enabled !== false
            const isSelected = selectedField === f.key
            return (
              <div
                key={f.key}
                onClick={() => onSelect(f.key)}
                style={{
                  padding: '4px 8px',
                  marginTop: 2,
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: isSelected ? group.color + '20' : 'transparent',
                  border: isSelected ? `1px solid ${group.color}` : '1px solid transparent',
                  opacity: isEnabled ? 1 : 0.4,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: group.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{getFieldLabel(t, f.key)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// A4 Canvas
// =============================================================================

function A4Canvas({
  templateData,
  zoom,
  showGrid,
  selectedField,
  onSelectField,
  onUpdateField,
}: {
  templateData: TemplateData
  zoom: number
  showGrid: boolean
  selectedField: string | null
  onSelectField: (key: string | null) => void
  onUpdateField: (key: string, props: Partial<FieldProps>) => void
}) {
  const { t } = useTranslation()
  const canvasWidth = CANVAS_WIDTH_PX * zoom
  const canvasHeight = (A4_HEIGHT_MM * MM_TO_PX) * zoom
  const scale = MM_TO_PX * zoom

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    key: string
    mode: 'move' | 'resize'
    startMouseX: number
    startMouseY: number
    startX: number
    startY: number
    startWidth: number
    startHeight: number
  } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, key: string, mode: 'move' | 'resize') => {
      e.stopPropagation()
      e.preventDefault()
      onSelectField(key)
      const field = templateData.fields[key]
      if (!field) return
      dragRef.current = {
        key,
        mode,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: field.x,
        startY: field.y ?? 0,
        startWidth: field.width,
        startHeight: field.height ?? 8,
      }
    },
    [templateData.fields, onSelectField]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { key, mode, startMouseX, startMouseY, startX, startY, startWidth, startHeight } = dragRef.current
      const dx = (e.clientX - startMouseX) / scale
      const dy = (e.clientY - startMouseY) / scale

      if (mode === 'move') {
        const newX = Math.max(0, Math.min(A4_WIDTH_MM - 5, Math.round((startX + dx) * 10) / 10))
        const newY = Math.max(0, Math.min(A4_HEIGHT_MM - 5, Math.round((startY + dy) * 10) / 10))
        onUpdateField(key, { x: newX, y: newY })
      } else {
        const newW = Math.max(5, Math.round((startWidth + dx) * 10) / 10)
        // Minimum height: 53mm for totals (max possible lines), 3mm for others
        const minH = key === 'totals' ? 53 : 3
        const newH = Math.max(minH, Math.round((startHeight + dy) * 10) / 10)
        onUpdateField(key, { width: newW, height: newH })
      }
    }

    const handleMouseUp = () => {
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [scale, onUpdateField])

  // Margin guides
  const margins = templateData.margins

  return (
    <div
      ref={canvasRef}
      onClick={() => onSelectField(null)}
      style={{
        width: canvasWidth,
        height: canvasHeight,
        background: '#fff',
        position: 'relative',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Margin guides */}
      <div
        style={{
          position: 'absolute',
          left: margins.left * scale,
          top: margins.top * scale,
          right: margins.right * scale,
          bottom: margins.bottom * scale,
          border: '1px dashed #d9d9d9',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Grid */}
      {showGrid && (
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
        >
          <defs>
            <pattern id="grid10mm" width={10 * scale} height={10 * scale} patternUnits="userSpaceOnUse">
              <path d={`M ${10 * scale} 0 L 0 0 0 ${10 * scale}`} fill="none" stroke="#eee" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid10mm)" />
        </svg>
      )}

      {/* Fixed tenant footer zone indicator (IBAN/SIRET - hardcoded at 15mm from bottom) */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: (297 - 15) * scale,
          width: '100%',
          height: 15 * scale,
          background: 'rgba(0, 0, 0, 0.04)',
          borderTop: '1px dashed #ff4d4f',
          pointerEvents: 'none',
          zIndex: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: Math.max(7, 9 * zoom), color: '#ff4d4f', opacity: 0.7, fontStyle: 'italic' }}>
          {t('pdfTemplateEditor.canvas.tenantFooterZone')}
        </span>
      </div>

      {/* Fields */}
      {ALL_FIELD_KEYS.map((key) => {
        const field = templateData.fields[key]
        if (!field || field.enabled === false) return null
        const color = getFieldColor(key)
        const isSelected = selectedField === key
        const x = (field.x ?? 0) * scale
        const y = (field.y ?? 0) * scale
        const w = (field.width ?? 40) * scale
        const h = (field.height ?? 8) * scale

        return (
          <div
            key={key}
            onMouseDown={(e) => handleMouseDown(e, key, 'move')}
            onClick={(e) => {
              e.stopPropagation()
              onSelectField(key)
            }}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              background: color + '15',
              border: isSelected ? `2px solid #1677ff` : `1px solid ${color}60`,
              borderRadius: 2,
              cursor: 'grab',
              zIndex: isSelected ? 10 : 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 4px',
              overflow: 'hidden',
              boxSizing: 'border-box',
              userSelect: 'none',
            }}
          >
            <div
              style={{
                fontSize: Math.max(8, 10 * zoom),
                fontWeight: 600,
                color: color,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {getFieldLabel(t, key)}
            </div>

            {/* Resize handle */}
            {isSelected && (
              <div
                onMouseDown={(e) => handleMouseDown(e, key, 'resize')}
                style={{
                  position: 'absolute',
                  right: -4,
                  bottom: -4,
                  width: 10,
                  height: 10,
                  background: '#1677ff',
                  borderRadius: 2,
                  cursor: 'nwse-resize',
                  zIndex: 11,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// Field Properties Panel (right)
// =============================================================================

function FieldPropertiesPanel({
  fieldKey,
  field,
  onChange,
}: {
  fieldKey: string
  field: FieldProps
  onChange: (props: Partial<FieldProps>) => void
}) {
  const { t } = useTranslation()
  const label = getFieldLabel(t, fieldKey)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text strong style={{ fontSize: 14 }}>{label}</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 11 }}>{fieldKey}</Text>
      </div>

      <Divider style={{ margin: '4px 0' }} />

      {/* Enabled */}
      <Row align="middle">
        <Col span={10}><Text>{t('pdfTemplateEditor.props.enabled')}</Text></Col>
        <Col span={14}>
          <Switch
            checked={field.enabled !== false}
            onChange={(v) => onChange({ enabled: v })}
            size="small"
          />
        </Col>
      </Row>

      <Divider style={{ margin: '4px 0' }} />

      {/* Position */}
      <Text strong style={{ fontSize: 12 }}>{t('pdfTemplateEditor.props.position')}</Text>
      <Row gutter={8}>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.x')}</Text>
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={field.x}
            min={0}
            max={A4_WIDTH_MM}
            step={0.5}
            onChange={(v) => v !== null && onChange({ x: v })}
          />
        </Col>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.y')}</Text>
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={field.y}
            min={0}
            max={A4_HEIGHT_MM}
            step={0.5}
            onChange={(v) => v !== null && onChange({ y: v })}
          />
        </Col>
      </Row>

      {/* Size */}
      <Text strong style={{ fontSize: 12 }}>{t('pdfTemplateEditor.props.size')}</Text>
      <Row gutter={8}>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.width')}</Text>
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={field.width}
            min={5}
            max={A4_WIDTH_MM}
            step={1}
            onChange={(v) => v !== null && onChange({ width: v })}
          />
        </Col>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.height')}</Text>
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={field.height}
            min={fieldKey === 'totals' ? 53 : 3}
            max={A4_HEIGHT_MM}
            step={1}
            onChange={(v) => v !== null && onChange({ height: v })}
          />
          {fieldKey === 'totals' && (
            <Text type="secondary" style={{ fontSize: 10 }}>{t('pdfTemplateEditor.props.totalsMinHeight')}</Text>
          )}
        </Col>
      </Row>

      <Divider style={{ margin: '4px 0' }} />

      {/* Typography */}
      <Text strong style={{ fontSize: 12 }}>{t('pdfTemplateEditor.props.typography')}</Text>
      <Row gutter={8}>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.fontSize')}</Text>
          <InputNumber
            size="small"
            style={{ width: '100%' }}
            value={field.fontSize}
            min={5}
            max={36}
            step={1}
            onChange={(v) => v !== null && onChange({ fontSize: v })}
          />
        </Col>
        <Col span={12}>
          <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.fontWeight')}</Text>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={field.fontWeight || 'normal'}
            onChange={(v) => onChange({ fontWeight: v as any })}
            options={[
              { value: 'normal', label: t('pdfTemplateEditor.props.fontWeightNormal') },
              { value: 'bold', label: t('pdfTemplateEditor.props.fontWeightBold') },
            ]}
          />
        </Col>
      </Row>

      <div>
        <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.alignment')}</Text>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={field.align || 'L'}
          onChange={(v) => onChange({ align: v as any })}
          options={[
            { value: 'L', label: t('pdfTemplateEditor.props.alignLeft') },
            { value: 'C', label: t('pdfTemplateEditor.props.alignCenter') },
            { value: 'R', label: t('pdfTemplateEditor.props.alignRight') },
          ]}
        />
      </div>

      <Divider style={{ margin: '4px 0' }} />

      {/* Colors */}
      <Text strong style={{ fontSize: 12 }}>{t('pdfTemplateEditor.props.colors')}</Text>
      <div>
        <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.bgColor')}</Text>
        <Input
          size="small"
          value={field.bgColor || ''}
          onChange={(e) => onChange({ bgColor: e.target.value || undefined })}
          placeholder={t('pdfTemplateEditor.props.bgColorPlaceholder')}
        />
      </div>
      <div>
        <Text style={{ fontSize: 11 }}>{t('pdfTemplateEditor.props.textColor')}</Text>
        <Input
          size="small"
          value={field.textColor || ''}
          onChange={(e) => onChange({ textColor: e.target.value || undefined })}
          placeholder={t('pdfTemplateEditor.props.textColorPlaceholder')}
        />
      </div>

      {/* Custom text content (only for custom_text field) */}
      {fieldKey === 'custom_text' && (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <Text strong style={{ fontSize: 12 }}>{t('pdfTemplateEditor.props.customTextContent')}</Text>
          <Input.TextArea
            rows={3}
            size="small"
            value={field.text || ''}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={t('pdfTemplateEditor.props.customTextPlaceholder')}
          />
        </>
      )}
    </div>
  )
}
