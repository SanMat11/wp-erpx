import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import {
  Button,
  Card,
  Modal,
  Input,
  Space,
  Spin,
  Table,
  Tag,
  message,
  Result,
} from 'antd'
import { CheckOutlined, CloseOutlined, DownloadOutlined } from '@ant-design/icons'
import { amsbmBoot } from '@/services/api'

// ⚠️ « /api/v1 » était l'adresse du SaaS d'origine, et elle ne répond plus rien
// ici : l'API est celle de WordPress. On reprend la base du produit — celle que
// window.amsbmBoot pose au démarrage — plutôt que d'en redéclarer une à part.
const API_URL = amsbmBoot.restUrl

// Message d'un refus du serveur.
//
// ⚠️ WordPress répond { code, message, data:{ status } } ; les routes publiques
// d'AMS Studio, elles, répondent { error }. Les écrans ne lisaient QUE « error » : un
// refus de WordPress se réduisait au libellé de repli, et le client ne savait
// jamais pourquoi sa signature n'avait pas été prise.
function serverMessage(err: any): string {
  const data = err?.response?.data
  return data?.message || data?.error || ''
}

type QuoteLine = {
  line_type: string
  description: string
  quantity: number
  unit?: string
  unit_price: number
  discount_percent?: number
  tva_rate?: number
  total_ht: number
}

type Quote = {
  number: string
  date: string
  validity_date?: string
  status: string
  subject?: string
  total_ht: number
  total_tva: number
  total_ttc: number
  discount_percent?: number
  discount_amount?: number
  notes?: string
  conditions?: string
  payment_terms?: string
  public_accepted_at?: string
  public_refused_at?: string
  public_signature_name?: string
  public_client_comment?: string
  public_signature_hash?: string
  public_verification_code?: string
  client?: {
    name: string
    address_line1?: string
    address_line2?: string
    postal_code?: string
    city?: string
    country?: string
  }
  lines?: QuoteLine[]
}

type PublicView = {
  quote: Quote
  tenant?: {
    id: string
    name: string
    primary_color?: string
  }
  status: string
  can_respond: boolean
  is_expired: boolean
  accepted_at?: string
  refused_at?: string
}

function formatMoney(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '0,00'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR')
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Adjust resolution for crisp rendering
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111'
  }, [])

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    drawingRef.current = true
    lastRef.current = getPoint(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const p = getPoint(e)
    const last = lastRef.current!
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    if (empty) setEmpty(false)
  }

  function handleUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastRef.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'))
    }
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
    onChange('')
  }

  return (
    <div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, background: '#fafafa', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          style={{ width: '100%', height: 140, touchAction: 'none', display: 'block', cursor: 'crosshair' }}
        />
        {empty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bfbfbf', pointerEvents: 'none', fontSize: 13 }}>
            {t('publicQuote.signaturePad.placeholder')}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', marginTop: 4 }}>
        <Button size="small" type="link" onClick={clear} disabled={empty}>
          {t('publicQuote.signaturePad.clear')}
        </Button>
      </div>
    </div>
  )
}

export default function PublicQuote() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<PublicView | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [expired, setExpired] = useState(false)

  const [acceptOpen, setAcceptOpen] = useState(false)
  const [refuseOpen, setRefuseOpen] = useState(false)
  const [signatureName, setSignatureName] = useState('')
  const [signatureImg, setSignatureImg] = useState('')
  const [comment, setComment] = useState('')
  // ⚠️ LA MENTION SE RECOPIE À LA MAIN, ELLE NE SE COCHE PAS.
  //
  // « Bon pour accord » n'a de valeur que si le client l'a ÉCRITE : une case
  // cochée se clique sans lire, et ne prouve pas grand-chose devant un juge.
  // On la compare sans tenir compte de la casse, des accents ni des espaces en
  // trop — on demande un accord, pas une dictée.
  const [mention, setMention] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadQuote() {
    if (!token) return
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/public/quotes/${token}`)
      setView(res.data)
      setExpired(false)
    } catch (err: any) {
      const status = err?.response?.status
      const data = err?.response?.data
      if (status === 410 || data?.expired) {
        setExpired(true)
        setErrorMsg(serverMessage(err) || t('publicQuote.errors.linkExpired'))
      } else {
        setErrorMsg(serverMessage(err) || t('publicQuote.errors.invalidOrExpired'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const color = view?.tenant?.primary_color || '#1890ff'
  const tenantName = view?.tenant?.name || ''

  const logoUrl = useMemo(() => {
    if (!view?.tenant?.id) return ''
    return `${API_URL}/public/logo/${view.tenant.id}`
  }, [view?.tenant?.id])

  // markExpiredAndClear purge l'état local quand le backend signale que le lien a expiré
  // (la page peut être restée ouverte pendant que le token expirait côté serveur).
  function markExpiredAndClear(msg?: string) {
    setExpired(true)
    setErrorMsg(msg || t('publicQuote.errors.linkExpired'))
    setView(null)
    setAcceptOpen(false)
    setRefuseOpen(false)
  }

  function isExpiredError(err: any): boolean {
    return err?.response?.status === 410 || err?.response?.data?.expired === true
  }

  const MENTION_ATTENDUE = 'bon pour accord'

  /** Sans casse, sans accents, sans espaces superflus. */
  const normaliser = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()

  const mentionValide = normaliser(mention).startsWith(MENTION_ATTENDUE)

  async function handleAcceptConfirm() {
    if (!signatureName.trim()) {
      message.error(t('publicQuote.accept.nameRequired'))
      return
    }
    if (!mentionValide) {
      message.error(
        t('publicQuote.accept.mentionRequired', 'Recopiez la mention « Bon pour accord » pour valider votre accord.')
      )
      return
    }
    setSubmitting(true)
    try {
      await axios.post(`${API_URL}/public/quotes/${token}/accept`, {
        signature_name: signatureName.trim(),
        signature_image: signatureImg,
        comment: comment.trim(),
        mention: mention.trim(),
      })
      setAcceptOpen(false)
      message.success(t('publicQuote.accept.success'))
      await loadQuote()
    } catch (err: any) {
      if (isExpiredError(err)) {
        markExpiredAndClear(serverMessage(err))
        return
      }
      message.error(serverMessage(err) || t('publicQuote.accept.error'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRefuseConfirm() {
    setSubmitting(true)
    try {
      await axios.post(`${API_URL}/public/quotes/${token}/refuse`, {
        comment: comment.trim(),
      })
      setRefuseOpen(false)
      message.success(t('publicQuote.refuse.success'))
      await loadQuote()
    } catch (err: any) {
      if (isExpiredError(err)) {
        markExpiredAndClear(serverMessage(err))
        return
      }
      message.error(serverMessage(err) || t('publicQuote.refuse.error'))
    } finally {
      setSubmitting(false)
    }
  }

  function openAccept() {
    setSignatureName('')
    setSignatureImg('')
    setComment('')
    setAcceptOpen(true)
  }

  function openRefuse() {
    setComment('')
    setRefuseOpen(true)
  }

  async function downloadPDF() {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/public/quotes/${token}/pdf`)
      if (res.status === 410) {
        let payload: any = null
        try { payload = await res.json() } catch { /* ignore */ }
        markExpiredAndClear(payload?.message || payload?.error)
        return
      }
      if (!res.ok) {
        message.error(t('publicQuote.pdf.unavailable'))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `devis_${view?.quote?.number || 'document'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      message.error(t('publicQuote.pdf.downloadError'))
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (expired) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Result
          status="warning"
          title={t('publicQuote.expiredPage.title')}
          subTitle={t('publicQuote.expiredPage.subTitle')}
        />
      </div>
    )
  }

  if (errorMsg || !view) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Result status="404" title={t('publicQuote.notFoundPage.title')} subTitle={errorMsg || t('publicQuote.notFoundPage.subTitle')} />
      </div>
    )
  }

  const q = view.quote
  const statusTag = (() => {
    switch (q.status) {
      case 'accepted':
        return <Tag color="green">{t('publicQuote.status.accepted')}</Tag>
      case 'refused':
        return <Tag color="red">{t('publicQuote.status.refused')}</Tag>
      case 'expired':
        return <Tag color="default">{t('publicQuote.status.expired')}</Tag>
      case 'sent':
        return <Tag color="blue">{t('publicQuote.status.pending')}</Tag>
      default:
        return <Tag>{q.status}</Tag>
    }
  })()

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px 12px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        {/* Header tenant */}
        <div style={{ background: color, color: '#fff', padding: '24px 28px', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt={tenantName}
              style={{ height: 48, background: '#fff', padding: 4, borderRadius: 4 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{t('publicQuote.header.transmittedBy')}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{tenantName}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{t('publicQuote.header.quoteLabel')}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{q.number}</div>
          </div>
        </div>

        <Card bordered={false} style={{ borderRadius: '0 0 8px 8px' }} bodyStyle={{ padding: 28 }}>
          {/* Bandeau statut + dates */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 20, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>{t('publicQuote.infoBand.status')}</div>
              <div style={{ marginTop: 4 }}>{statusTag}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>{t('publicQuote.infoBand.quoteDate')}</div>
              <div style={{ fontWeight: 500 }}>{formatDate(q.date)}</div>
            </div>
            {q.validity_date && (
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>{t('publicQuote.infoBand.validUntil')}</div>
                <div style={{ fontWeight: 500 }}>{formatDate(q.validity_date)}</div>
              </div>
            )}
            {q.subject && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: '#888' }}>{t('publicQuote.infoBand.subject')}</div>
                <div style={{ fontWeight: 500 }}>{q.subject}</div>
              </div>
            )}
          </div>

          {/* Client */}
          {q.client && (
            <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', padding: 16, borderRadius: 6, marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('publicQuote.client.addressedTo')}</div>
              <div style={{ fontWeight: 600 }}>{q.client.name}</div>
              {q.client.address_line1 && <div>{q.client.address_line1}</div>}
              {q.client.address_line2 && <div>{q.client.address_line2}</div>}
              {(q.client.postal_code || q.client.city) && (
                <div>{q.client.postal_code} {q.client.city}</div>
              )}
              {q.client.country && <div>{q.client.country}</div>}
            </div>
          )}

          {/* Lines */}
          <Table
            size="middle"
            pagination={false}
            rowKey={(_, idx) => String(idx)}
            dataSource={(q.lines || []).filter((l) => l.line_type === 'article' || !l.line_type)}
            columns={[
              { title: t('publicQuote.table.designation'), dataIndex: 'description', key: 'description', render: (v: string) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div> },
              { title: t('publicQuote.table.quantity'), dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right', render: (v: number) => formatMoney(v) },
              { title: t('publicQuote.table.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 110, align: 'right', render: (v: number) => `${formatMoney(v)} €` },
              { title: t('publicQuote.table.totalHt'), dataIndex: 'total_ht', key: 'total_ht', width: 120, align: 'right', render: (v: number) => `${formatMoney(v)} €` },
            ]}
          />

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <div style={{ minWidth: 280 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{t('publicQuote.totals.totalHt')}</span>
                <span>{formatMoney(q.total_ht)} €</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{t('publicQuote.totals.tva')}</span>
                <span>{formatMoney(q.total_tva)} €</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid ' + color, marginTop: 4, fontWeight: 700, fontSize: 18, color }}>
                <span>{t('publicQuote.totals.totalTtc')}</span>
                <span>{formatMoney(q.total_ttc)} €</span>
              </div>
            </div>
          </div>

          {(q.notes || q.conditions || q.payment_terms) && (
            <div style={{ marginTop: 24, padding: 16, background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
              {q.payment_terms && <p style={{ margin: 0 }}><strong>{t('publicQuote.notes.paymentTermsLabel')}</strong> {q.payment_terms}</p>}
              {q.notes && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{q.notes}</p>}
              {q.conditions && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: '#666' }}>{q.conditions}</p>}
            </div>
          )}

          {/* Action zone */}
          <div style={{ marginTop: 32, padding: 20, borderRadius: 8, background: '#f6f9ff', border: '1px solid #d6e4ff' }}>
            {view.can_respond ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('publicQuote.actions.prompt')}</div>
                <Space wrap>
                  <Button type="primary" size="large" icon={<CheckOutlined />} onClick={openAccept} style={{ background: color, borderColor: color }}>
                    {t('publicQuote.actions.acceptQuote')}
                  </Button>
                  <Button danger size="large" icon={<CloseOutlined />} onClick={openRefuse}>
                    {t('publicQuote.actions.refuse')}
                  </Button>
                  <Button size="large" icon={<DownloadOutlined />} onClick={downloadPDF}>
                    {t('publicQuote.actions.downloadPdf')}
                  </Button>
                </Space>
              </>
            ) : q.status === 'accepted' ? (
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}>
                  {t('publicQuote.accepted.heading', { date: formatDate(q.public_accepted_at) })}
                </div>
                {q.public_signature_name && (
                  <p style={{ marginTop: 8 }}>{t('publicQuote.accepted.signedBy')} <strong>{q.public_signature_name}</strong></p>
                )}
                {q.public_client_comment && (
                  <p style={{ marginTop: 4, color: '#666', whiteSpace: 'pre-wrap' }}>« {q.public_client_comment} »</p>
                )}
                <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, color: '#389e0d' }}>
                    {q.client?.name ? t('publicQuote.accepted.emailSentToYou') : t('publicQuote.accepted.emailSent')}
                  </div>
                  {q.public_verification_code && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <a href={`/verification/${q.public_verification_code}`} target="_blank" rel="noreferrer">
                        {t('publicQuote.accepted.verifyLink')}
                      </a>
                    </div>
                  )}
                  {q.public_signature_hash && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#888', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                      {t('publicQuote.accepted.fingerprintLabel')}&nbsp;: {q.public_signature_hash}
                    </div>
                  )}
                </div>
                <Button icon={<DownloadOutlined />} onClick={downloadPDF} style={{ marginTop: 12 }}>
                  {t('publicQuote.actions.downloadPdf')}
                </Button>
              </div>
            ) : q.status === 'refused' ? (
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#ff4d4f' }}>
                  {t('publicQuote.refused.heading', { date: formatDate(q.public_refused_at) })}
                </div>
                {q.public_client_comment && (
                  <p style={{ marginTop: 4, color: '#666', whiteSpace: 'pre-wrap' }}>« {q.public_client_comment} »</p>
                )}
              </div>
            ) : (
              <Button icon={<DownloadOutlined />} onClick={downloadPDF}>
                {t('publicQuote.actions.downloadPdf')}
              </Button>
            )}
          </div>

          <div style={{ marginTop: 24, textAlign: 'center', color: '#999', fontSize: 12 }}>
            {t('publicQuote.footer.note', { tenant: tenantName })}
          </div>
        </Card>
      </div>

      {/* Accept modal */}
      <Modal
        title={t('publicQuote.acceptModal.title')}
        open={acceptOpen}
        onCancel={() => !submitting && setAcceptOpen(false)}
        onOk={handleAcceptConfirm}
        okText={t('publicQuote.acceptModal.okText')}
        cancelText={t('publicQuote.common.cancel')}
        confirmLoading={submitting}
        okButtonProps={{
          style: { background: color, borderColor: color },
          disabled: !signatureName.trim() || !mentionValide,
        }}
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div style={{ background: '#f6f9ff', padding: 12, borderRadius: 4, border: '1px solid #d6e4ff' }}>
            {t('publicQuote.acceptModal.confirmIntro')} <strong>{formatMoney(q.total_ttc)} {t('publicQuote.acceptModal.amountTtc')}</strong>.
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              {t('publicQuote.acceptModal.mentionLabel', 'Recopiez : « Bon pour accord et acceptation des CGV »')}
            </label>
            <Input
              value={mention}
              onChange={(e) => setMention(e.target.value)}
              placeholder={t('publicQuote.acceptModal.mentionPlaceholder', 'Bon pour accord et acceptation des CGV')}
              size="large"
              status={mention.length > 0 && !mentionValide ? 'error' : undefined}
            />
            {mention.length > 0 && !mentionValide && (
              <div style={{ color: '#cf1322', fontSize: 12, marginTop: 4 }}>
                {t('publicQuote.acceptModal.mentionHelp', 'La mention doit commencer par « Bon pour accord ».')}
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('publicQuote.acceptModal.fullNameLabel')}</label>
            <Input
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder={t('publicQuote.acceptModal.fullNamePlaceholder')}
              size="large"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('publicQuote.acceptModal.signatureLabel')}</label>
            <SignaturePad onChange={setSignatureImg} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('publicQuote.acceptModal.commentLabel')}</label>
            <Input.TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={t('publicQuote.acceptModal.commentPlaceholder')}
            />
          </div>
        </Space>
      </Modal>

      {/* Refuse modal */}
      <Modal
        title={t('publicQuote.refuseModal.title')}
        open={refuseOpen}
        onCancel={() => !submitting && setRefuseOpen(false)}
        onOk={handleRefuseConfirm}
        okText={t('publicQuote.refuseModal.okText')}
        cancelText={t('publicQuote.common.cancel')}
        confirmLoading={submitting}
        okButtonProps={{ danger: true }}
        width={500}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <p style={{ margin: 0 }}>{t('publicQuote.refuseModal.intro')}</p>
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder={t('publicQuote.refuseModal.commentPlaceholder')}
          />
        </Space>
      </Modal>
    </div>
  )
}
