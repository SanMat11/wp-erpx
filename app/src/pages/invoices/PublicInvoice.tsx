import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { Alert, Button, Card, Result, Space, Spin, Table, Tag, message } from 'antd'
import { CreditCardOutlined, DownloadOutlined } from '@ant-design/icons'
import { amsbmBoot } from '@/services/api'

// Page jumelle de PublicQuote : mêmes règles, même présentation. Le client doit
// reconnaître la même maison entre le devis qu'il a signé et la facture qu'il
// règle. Ce qui change ici, c'est le geste attendu : payer, pas signer.
//
// ⚠️ « /api/v1 » était l'adresse du SaaS d'origine, et elle ne répond plus rien
// ici : l'API est celle de WordPress. On reprend la base du produit — celle que
// window.amsbmBoot pose au démarrage — plutôt que d'en redéclarer une à part.
const API_URL = amsbmBoot.restUrl

/**
 * Paramètre que Stripe rajoute à l'adresse de retour.
 *
 * ⚠️ CE NOM EST UN CONTRAT AVEC LE SERVEUR. C'est lui qui fabrique les
 * « success_url » et « cancel_url » de la session Stripe ; s'il en choisit un
 * autre, le client revient sur sa facture sans message et croit que son
 * paiement s'est perdu. Attendu :
 *   succès  → https://…/facture/{jeton}?paiement=succes
 *   abandon → https://…/facture/{jeton}?paiement=annule
 */
const PARAM_RETOUR = 'paiement'
const RETOUR_SUCCES = 'succes'
const RETOUR_ANNULE = 'annule'

/** Un solde sous le centime est un solde nul : les arrondis de TVA font le reste. */
const EPSILON = 0.004

/** Toutes les quatre secondes, une minute durant. */
const ATTENTE_MS = 4000
const ATTENTE_ESSAIS = 15

// Message d'un refus du serveur.
//
// ⚠️ WordPress répond { code, message, data:{ status } } ; les routes publiques
// d'AMS Studio, elles, répondent { error }. Lire l'un sans l'autre réduit tout refus
// au libellé de repli, et le client ne sait jamais pourquoi.
function serverMessage(err: any): string {
  const data = err?.response?.data
  return data?.message || data?.error || ''
}

type InvoiceLine = {
  line_type: string
  description: string
  quantity: number
  unit?: string
  unit_price: number
  discount_percent?: number
  tva_rate?: number
  total_ht: number
}

type Invoice = {
  number: string
  date: string
  due_date?: string
  status: string
  /** « paid », « partial », « unpaid »… tel que le serveur le stocke, en anglais. */
  payment_status?: string
  subject?: string
  total_ht: number
  total_tva: number
  total_ttc: number
  paid_amount?: number
  /** Restant dû calculé par le serveur ; à défaut on le refait ici. */
  remaining?: number
  notes?: string
  conditions?: string
  payment_terms?: string
  client?: {
    name: string
    address_line1?: string
    address_line2?: string
    postal_code?: string
    city?: string
    country?: string
  }
  lines?: InvoiceLine[]
}

type PublicView = {
  invoice: Invoice
  tenant?: {
    id: string
    name: string
    primary_color?: string
  }
  status: string
  /**
   * Le serveur seul décide si le paiement en ligne est ouvert, et dit pourquoi
   * quand il ne l'est pas (déjà réglée, annulée, Stripe non configuré…). L'écran
   * ne rejoue pas ce raisonnement : il l'affiche.
   */
  paiement?: {
    possible: boolean
    motif?: string
  }
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

/**
 * Le restant dû.
 *
 * On prend celui du serveur quand il l'envoie — c'est lui qui tient les
 * règlements —, sinon on refait le calcul des listes internes : total TTC moins
 * ce qui a déjà été encaissé. Jamais de négatif à l'écran : un trop-perçu se
 * traite en avoir, il n'a rien à faire sur la page de paiement.
 */
function resteDu(f: Invoice | undefined): number {
  if (!f) return 0
  const brut =
    typeof f.remaining === 'number' && !isNaN(f.remaining)
      ? f.remaining
      : (f.total_ttc || 0) - (f.paid_amount || 0)

  return brut > 0 ? Math.round(brut * 100) / 100 : 0
}

export default function PublicInvoice() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<PublicView | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [expired, setExpired] = useState(false)
  const [paying, setPaying] = useState(false)
  /** Retour de Stripe, lu une seule fois au montage. */
  const [retour, setRetour] = useState<'' | 'succes' | 'annule'>('')
  /** Le règlement arrive par le webhook : on relit la facture en attendant. */
  const [attente, setAttente] = useState(false)
  const minuteurRef = useRef<number | null>(null)

  // loadInvoice REND la vue qu'elle vient de lire, en plus de la poser dans
  // l'état : la surveillance du webhook tourne dans un intervalle, dont la
  // fermeture ne verrait jamais le nouvel état de React.
  async function loadInvoice(silencieux = false): Promise<PublicView | null> {
    if (!token) return null
    if (!silencieux) setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/public/invoices/${token}`)
      setView(res.data)
      setExpired(false)
      setErrorMsg('')
      return res.data as PublicView
    } catch (err: any) {
      const status = err?.response?.status
      const data = err?.response?.data
      // Une relecture silencieuse ne doit pas effacer la facture affichée : le
      // client vient de payer, un réseau qui hoquette ne va pas lui annoncer que
      // son lien est mort.
      if (!silencieux) {
        if (status === 410 || data?.expired) {
          setExpired(true)
          setErrorMsg(serverMessage(err) || t('publicInvoice.errors.linkExpired', 'Ce lien a expiré.'))
        } else {
          setErrorMsg(
            serverMessage(err) ||
              t('publicInvoice.errors.invalidOrExpired', 'Ce lien est invalide ou a expiré.')
          )
        }
      }
      return null
    } finally {
      if (!silencieux) setLoading(false)
    }
  }

  function arreterAttente() {
    if (minuteurRef.current !== null) {
      window.clearInterval(minuteurRef.current)
      minuteurRef.current = null
    }
  }

  /**
   * Après le retour de Stripe, la facture n'est pas encore soldée : c'est le
   * webhook qui l'acquitte, et il peut arriver quelques secondes plus tard. On
   * relit donc en silence jusqu'à voir le solde tomber à zéro. Passé la minute,
   * on s'arrête : le paiement est pris chez Stripe de toute façon, et la page
   * le dit.
   */
  function surveillerReglement() {
    setAttente(true)
    let essais = 0
    minuteurRef.current = window.setInterval(async () => {
      essais += 1
      const vue = await loadInvoice(true)
      const solde = vue ? resteDu(vue.invoice) : null

      if ((solde !== null && solde <= EPSILON) || essais >= ATTENTE_ESSAIS) {
        arreterAttente()
        setAttente(false)
      }
    }, ATTENTE_MS)
  }

  /**
   * ⚠️ LE PARAMÈTRE DE RETOUR SE LIT DANS window.location, PAS DANS LE ROUTEUR.
   *
   * L'application monte sur un MemoryRouter, dont l'entrée est le chemin que le
   * serveur pose dans amsbmBoot.route — « /facture/{jeton} », sans la partie
   * requête (voir Front\PublicApp::serve). useSearchParams() est donc toujours
   * vide ici, et le retour de Stripe passait complètement inaperçu.
   */
  function lireRetour(): string {
    try {
      return new URLSearchParams(window.location.search).get(PARAM_RETOUR) || ''
    } catch {
      return ''
    }
  }

  /** Le paramètre consommé, on l'efface : un rechargement ne doit pas refêter un paiement déjà annoncé. */
  function nettoyerAdresse() {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete(PARAM_RETOUR)
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    } catch {
      /* Une barre d'adresse qu'on ne peut pas réécrire n'empêche rien d'important. */
    }
  }

  useEffect(() => {
    const marque = lireRetour()

    void (async () => {
      const vue = await loadInvoice()

      if (marque === RETOUR_SUCCES) {
        setRetour('succes')
        // Déjà soldée à la première lecture ? Le webhook a été plus rapide que
        // le navigateur, il n'y a rien à attendre.
        if (resteDu(vue?.invoice) > EPSILON) surveillerReglement()
      } else if (marque === RETOUR_ANNULE) {
        setRetour('annule')
      }
    })()

    if (marque) nettoyerAdresse()

    return () => arreterAttente()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const color = view?.tenant?.primary_color || '#1890ff'
  const tenantName = view?.tenant?.name || ''

  const logoUrl = useMemo(() => {
    if (!view?.tenant?.id) return ''
    return `${API_URL}/public/logo/${view.tenant.id}`
  }, [view?.tenant?.id])

  function isExpiredError(err: any): boolean {
    return err?.response?.status === 410 || err?.response?.data?.expired === true
  }

  /**
   * Le règlement.
   *
   * ⚠️ On NE crée PAS la session Stripe depuis le navigateur : la clé secrète
   * n'a rien à faire ici. Le serveur la crée et rend l'adresse d'encaissement,
   * vers laquelle on envoie le navigateur. Rien n'est encaissé sur cette page.
   */
  async function handlePay() {
    if (!token) return
    setPaying(true)
    try {
      const res = await axios.post(`${API_URL}/public/invoices/${token}/pay`)
      const url = res?.data?.url

      if (typeof url !== 'string' || url === '') {
        // Pas d'adresse, pas de redirection : mieux vaut le dire que laisser le
        // client sur un bouton qui tourne dans le vide.
        message.error(t('publicInvoice.pay.noUrl', "Le paiement en ligne n'a pas pu être ouvert."))
        setPaying(false)
        return
      }

      // Le bouton reste en attente : la page va disparaître.
      window.location.href = url
    } catch (err: any) {
      if (isExpiredError(err)) {
        setExpired(true)
        setErrorMsg(serverMessage(err) || t('publicInvoice.errors.linkExpired', 'Ce lien a expiré.'))
        setView(null)
        setPaying(false)
        return
      }
      message.error(serverMessage(err) || t('publicInvoice.pay.error', "Le paiement n'a pas pu être lancé."))
      setPaying(false)
    }
  }

  async function downloadPDF() {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/public/invoices/${token}/pdf`)
      if (res.status === 410) {
        let payload: any = null
        try { payload = await res.json() } catch { /* ignore */ }
        setExpired(true)
        setErrorMsg(payload?.message || payload?.error || t('publicInvoice.errors.linkExpired', 'Ce lien a expiré.'))
        setView(null)
        return
      }
      if (!res.ok) {
        message.error(t('publicInvoice.pdf.unavailable', 'Le PDF est indisponible pour le moment.'))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `facture_${view?.invoice?.number || 'document'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      message.error(t('publicInvoice.pdf.downloadError', 'Le téléchargement du PDF a échoué.'))
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
          title={t('publicInvoice.expiredPage.title', 'Lien expiré')}
          subTitle={
            errorMsg ||
            t('publicInvoice.expiredPage.subTitle', "Ce lien n'est plus valable. Demandez-en un nouveau à votre interlocuteur.")
          }
        />
      </div>
    )
  }

  if (errorMsg || !view) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Result
          status="404"
          title={t('publicInvoice.notFoundPage.title', 'Facture introuvable')}
          subTitle={errorMsg || t('publicInvoice.notFoundPage.subTitle', "Ce lien ne correspond à aucune facture.")}
        />
      </div>
    )
  }

  const f = view.invoice
  const reste = resteDu(f)
  const solde = reste <= EPSILON
  const paiement = view.paiement
  const peutPayer = paiement?.possible === true

  const statusTag = (() => {
    if (f.status === 'cancelled' || f.status === 'canceled') {
      return <Tag color="default">{t('publicInvoice.status.cancelled', 'Annulée')}</Tag>
    }
    if (solde) {
      return <Tag color="green">{t('publicInvoice.status.paid', 'Réglée')}</Tag>
    }
    if ((f.paid_amount || 0) > 0) {
      return <Tag color="orange">{t('publicInvoice.status.partial', 'Partiellement réglée')}</Tag>
    }
    // L'échéance dépassée se voit à la date, pas au statut stocké : le serveur
    // ne repasse pas les factures en « en retard » tout seul.
    const echeance = f.due_date ? new Date(f.due_date) : null
    if (echeance && !isNaN(echeance.getTime()) && echeance.getTime() < Date.now()) {
      return <Tag color="red">{t('publicInvoice.status.overdue', 'Échue')}</Tag>
    }
    return <Tag color="blue">{t('publicInvoice.status.due', 'À régler')}</Tag>
  })()

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px 12px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        {/* En-tête de l'émetteur */}
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
            <div style={{ fontSize: 13, opacity: 0.9 }}>{t('publicInvoice.header.transmittedBy', 'Facture transmise par')}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{tenantName}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{t('publicInvoice.header.invoiceLabel', 'Facture n°')}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{f.number}</div>
          </div>
        </div>

        <Card bordered={false} style={{ borderRadius: '0 0 8px 8px' }} bodyStyle={{ padding: 28 }}>
          {/* Retour de Stripe */}
          {retour === 'succes' && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 20 }}
              message={t('publicInvoice.return.successTitle', 'Merci, votre paiement a été accepté.')}
              description={
                attente
                  ? t('publicInvoice.return.pending', "L'enregistrement du règlement peut prendre quelques secondes. Cette page se met à jour toute seule.")
                  : solde
                    ? t('publicInvoice.return.settled', 'Cette facture est soldée.')
                    : t('publicInvoice.return.notSettledYet', "Le règlement n'apparaît pas encore sur cette facture. Il sera enregistré sous peu ; votre paiement, lui, est bien pris en compte.")
              }
            />
          )}
          {retour === 'annule' && (
            <Alert
              type="warning"
              showIcon
              closable
              style={{ marginBottom: 20 }}
              message={t('publicInvoice.return.cancelledTitle', 'Paiement interrompu')}
              description={t('publicInvoice.return.cancelledText', "Vous avez quitté la page de paiement : rien n'a été débité. Vous pouvez recommencer quand vous le souhaitez.")}
            />
          )}

          {/* Bandeau statut + dates */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 20, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>{t('publicInvoice.infoBand.status', 'Statut')}</div>
              <div style={{ marginTop: 4 }}>{statusTag}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>{t('publicInvoice.infoBand.invoiceDate', 'Date de facture')}</div>
              <div style={{ fontWeight: 500 }}>{formatDate(f.date)}</div>
            </div>
            {f.due_date && (
              <div>
                <div style={{ fontSize: 12, color: '#888' }}>{t('publicInvoice.infoBand.dueDate', 'Échéance')}</div>
                <div style={{ fontWeight: 500 }}>{formatDate(f.due_date)}</div>
              </div>
            )}
            {f.subject && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: '#888' }}>{t('publicInvoice.infoBand.subject', 'Objet')}</div>
                <div style={{ fontWeight: 500 }}>{f.subject}</div>
              </div>
            )}
          </div>

          {/* Client */}
          {f.client && (
            <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', padding: 16, borderRadius: 6, marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('publicInvoice.client.addressedTo', 'Adressée à')}</div>
              <div style={{ fontWeight: 600 }}>{f.client.name}</div>
              {f.client.address_line1 && <div>{f.client.address_line1}</div>}
              {f.client.address_line2 && <div>{f.client.address_line2}</div>}
              {(f.client.postal_code || f.client.city) && (
                <div>{f.client.postal_code} {f.client.city}</div>
              )}
              {f.client.country && <div>{f.client.country}</div>}
            </div>
          )}

          {/* Lignes */}
          <Table
            size="middle"
            pagination={false}
            rowKey={(_, idx) => String(idx)}
            dataSource={(f.lines || []).filter((l) => l.line_type === 'article' || !l.line_type)}
            columns={[
              { title: t('publicInvoice.table.designation', 'Désignation'), dataIndex: 'description', key: 'description', render: (v: string) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div> },
              { title: t('publicInvoice.table.quantity', 'Qté'), dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right', render: (v: number) => formatMoney(v) },
              { title: t('publicInvoice.table.unitPrice', 'P.U. HT'), dataIndex: 'unit_price', key: 'unit_price', width: 110, align: 'right', render: (v: number) => `${formatMoney(v)} €` },
              { title: t('publicInvoice.table.totalHt', 'Total HT'), dataIndex: 'total_ht', key: 'total_ht', width: 120, align: 'right', render: (v: number) => `${formatMoney(v)} €` },
            ]}
          />

          {/* Totaux */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <div style={{ minWidth: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{t('publicInvoice.totals.totalHt', 'Total HT')}</span>
                <span>{formatMoney(f.total_ht)} €</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{t('publicInvoice.totals.tva', 'TVA')}</span>
                <span>{formatMoney(f.total_tva)} €</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid #e8e8e8', marginTop: 4, fontWeight: 600 }}>
                <span>{t('publicInvoice.totals.totalTtc', 'Total TTC')}</span>
                <span>{formatMoney(f.total_ttc)} €</span>
              </div>
              {(f.paid_amount || 0) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#389e0d' }}>
                  <span>{t('publicInvoice.totals.alreadyPaid', 'Déjà réglé')}</span>
                  <span>− {formatMoney(f.paid_amount)} €</span>
                </div>
              )}
            </div>
          </div>

          {/* Le restant dû : c'est le chiffre pour lequel le client ouvre la page. */}
          <div
            style={{
              marginTop: 20,
              padding: '18px 24px',
              borderRadius: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              background: solde ? '#f6ffed' : '#fff7e6',
              border: `1px solid ${solde ? '#b7eb8f' : '#ffd591'}`,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {solde
                ? t('publicInvoice.balance.settled', 'Facture soldée')
                : t('publicInvoice.balance.remainingLabel', 'Restant dû')}
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, color: solde ? '#389e0d' : '#d46b08' }}>
              {formatMoney(reste)} €
            </div>
          </div>

          {(f.notes || f.conditions || f.payment_terms) && (
            <div style={{ marginTop: 24, padding: 16, background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
              {f.payment_terms && <p style={{ margin: 0 }}><strong>{t('publicInvoice.notes.paymentTermsLabel', 'Conditions de règlement :')}</strong> {f.payment_terms}</p>}
              {f.notes && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{f.notes}</p>}
              {f.conditions && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: '#666' }}>{f.conditions}</p>}
            </div>
          )}

          {/* Zone d'action */}
          <div style={{ marginTop: 32, padding: 20, borderRadius: 8, background: '#f6f9ff', border: '1px solid #d6e4ff' }}>
            {peutPayer && (
              <div style={{ fontWeight: 600, marginBottom: 12 }}>
                {t('publicInvoice.actions.prompt', 'Vous pouvez régler cette facture en ligne, par carte bancaire.')}
              </div>
            )}

            <Space wrap>
              {peutPayer && (
                <Button
                  type="primary"
                  size="large"
                  icon={<CreditCardOutlined />}
                  loading={paying}
                  onClick={handlePay}
                  style={{ background: color, borderColor: color }}
                >
                  {t('publicInvoice.actions.pay', 'Régler cette facture')}
                  {reste > EPSILON ? ` — ${formatMoney(reste)} €` : ''}
                </Button>
              )}
              <Button size="large" icon={<DownloadOutlined />} onClick={downloadPDF}>
                {t('publicInvoice.actions.downloadPdf', 'Télécharger le PDF')}
              </Button>
            </Space>

            {/* Pas de bouton ? On dit POURQUOI. Une zone d'action muette laisse le
                client chercher un moyen de payer qui n'existe pas. */}
            {!peutPayer && (
              <Alert
                type={solde ? 'success' : 'info'}
                showIcon
                style={{ marginTop: 16 }}
                message={
                  paiement?.motif ||
                  (solde
                    ? t('publicInvoice.payment.alreadySettled', 'Cette facture est réglée : il n\'y a rien à payer.')
                    : t('publicInvoice.payment.unavailable', "Le paiement en ligne n'est pas disponible pour cette facture."))
                }
              />
            )}
          </div>

          <div style={{ marginTop: 24, textAlign: 'center', color: '#999', fontSize: 12 }}>
            {t('publicInvoice.footer.note', 'Document transmis par {{tenant}}. Pour toute question, répondez au courriel qui vous a apporté ce lien.', { tenant: tenantName })}
          </div>
        </Card>
      </div>
    </div>
  )
}
