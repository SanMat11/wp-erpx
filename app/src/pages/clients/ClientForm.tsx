import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Form, Input, Button, Card, Row, Col, Switch, InputNumber, message, Spin, Space } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { clientAPI } from '@/services/api'

export default function ClientForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const isEdit = !!id

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const response = await clientAPI.get(id!)
      return response.data
    },
    enabled: isEdit,
  })

  // Fiche neuve : le code est un numéro d'ordre attribué par le serveur, pas un
  // champ à inventer — deux fiches ne peuvent pas porter le même.
  const { data: nextCode } = useQuery({
    queryKey: ['clients', 'next-code'],
    queryFn: async () => {
      const response = await clientAPI.getNextCode()
      return String(response.data?.code || '')
    },
    enabled: !isEdit,
    staleTime: 0,
    gcTime: 0,
  })

  useEffect(() => {
    if (!isEdit && nextCode && !form.getFieldValue('code')) {
      form.setFieldsValue({ code: nextCode })
    }
  }, [isEdit, nextCode, form])

  useEffect(() => {
    if (client) {
      form.setFieldsValue({
        code: client.code,
        name: client.name,
        email: client.email,
        phone: client.phone,
        mobile: client.mobile,
        addressLine1: client.address_line1,
        addressLine2: client.address_line2,
        postalCode: client.postal_code,
        city: client.city,
        country: client.country || 'France',
        siret: client.siret,
        tvaIntra: client.tva_intra,
        // ⚠️ « ?? » et non « || » : 0 est un délai de paiement valable — c'est
        // le comptant. Avec « || », il se réaffichait à 30 jours puis repartait
        // à 30 : le comptant était impossible à saisir depuis cet écran.
        paymentTerms: client.payment_terms ?? 30,
        notes: client.notes,
        isActive: client.is_active ?? true,
      })
    }
  }, [client, form])

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => clientAPI.create(data),
    onSuccess: () => {
      message.success(t('clientForm.createSuccess'))
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients')
    },
    // Le serveur dit précisément ce qui coince — un code déjà pris, une valeur
    // trop longue, un numéro mal formé : « Erreur lors de la création » tout
    // court laisserait chercher au hasard.
    onError: (e: any) => {
      message.error(e?.message || t('clientForm.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => clientAPI.update(id!, data),
    onSuccess: () => {
      message.success(t('clientForm.updateSuccess'))
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      navigate('/clients')
    },
    // Le motif du refus vient du serveur (un code déjà pris, par exemple).
    onError: (e: any) => {
      message.error(e?.message || t('clientForm.updateError'))
    },
  })

  const onFinish = (values: Record<string, unknown>) => {
    const data = {
      code: values.code,
      name: values.name,
      email: values.email || '',
      phone: values.phone || '',
      mobile: values.mobile || '',
      address_line1: values.addressLine1 || '',
      address_line2: values.addressLine2 || '',
      postal_code: values.postalCode || '',
      city: values.city || '',
      country: values.country || 'France',
      siret: values.siret || '',
      tva_intra: values.tvaIntra || '',
      // ⚠️ Voir plus haut : « || » renvoyait un comptant (0) à 30 jours au
      // moment même de l'enregistrement.
      payment_terms: values.paymentTerms ?? 30,
      notes: values.notes || '',
      is_active: values.isActive ?? true,
    }

    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  if (isEdit && isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/clients')}>
          {t('common.back')}
        </Button>
      </div>

      <Card title={isEdit ? t('clientForm.editTitle') : t('clientForm.newTitle')}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ country: 'France', paymentTerms: 30, isActive: true }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="code"
                label={t('clientForm.code')}
                rules={[{ required: true, message: t('clientForm.codeRequired') }]}
              >
                <Input placeholder="CLI001" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="name"
                label={t('clientForm.name')}
                rules={[{ required: true, message: t('clientForm.nameRequired') }]}
              >
                <Input placeholder={t('clientForm.namePlaceholder')} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="email" label={t('clientForm.email')} rules={[{ type: 'email', message: t('clientForm.emailInvalid') }]}>
                <Input placeholder="email@exemple.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label={t('clientForm.phone')}>
                <Input placeholder="01 23 45 67 89" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mobile" label={t('clientForm.mobile')}>
                <Input placeholder="06 12 34 56 78" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="addressLine1" label={t('clientForm.address')}>
                <Input placeholder={t('clientForm.addressPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="addressLine2" label={t('clientForm.addressComplement')}>
                <Input placeholder={t('clientForm.addressComplementPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="postalCode" label={t('clientForm.postalCode')}>
                <Input placeholder="75001" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="city" label={t('clientForm.city')}>
                <Input placeholder="Paris" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="country" label={t('clientForm.country')}>
                <Input placeholder="France" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="siret" label={t('clientForm.siret')}>
                <Input placeholder="123 456 789 00012" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tvaIntra" label={t('clientForm.tvaIntra')}>
                <Input placeholder="FR12345678901" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="paymentTerms" label={t('clientForm.paymentTerms')}>
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="notes" label={t('clientForm.notes')}>
            <Input.TextArea rows={3} placeholder={t('clientForm.notesPlaceholder')} />
          </Form.Item>

          <Form.Item name="isActive" label={t('clientForm.active')} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>
                {isEdit ? t('clientForm.update') : t('common.create')}
              </Button>
              <Button onClick={() => navigate('/clients')}>{t('common.cancel')}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
