import { useState, lazy, Suspense, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, Card, Spin } from 'antd'
import { amsbmBoot } from '@/services/api'
// Note: TabPane is deprecated, using items prop instead
import {
  BankOutlined,
  FileTextOutlined,
  MailOutlined,
  BellOutlined,
  TeamOutlined,
  CloudOutlined,
  InfoCircleOutlined,
  CrownOutlined,
  PercentageOutlined,
  BgColorsOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  AlignLeftOutlined,
  AuditOutlined,
  FileProtectOutlined,
  HomeOutlined,
  ShopOutlined,
  CreditCardOutlined,
} from '@ant-design/icons'

import CompanySettings from './CompanySettings'
import BillingSettings from './BillingSettings'
import VATSettings from './VATSettings'
import PaymentTermsSettings from './PaymentTermsSettings'
import FooterSettings from './FooterSettings'
import LegalMentionsSettings from './LegalMentionsSettings'
import GeneralTermsSettings from './GeneralTermsSettings'
import EmailSettings from './EmailSettings'
import NotificationSettings from './NotificationSettings'
import UsersSettings from './UsersSettings'
import StorageSettings from './StorageSettings'
import AboutSettings from './AboutSettings'
// ⚠️ CHARGÉ À LA DEMANDE, ET C'EST STRUCTUREL. Vite en fait un morceau séparé
// dans app/build/morceaux/ ; build-zip.sh --free le supprime, et le paquet du
// dépôt ne contient alors pas même la forme d'un écran d'abonnement. Un import
// direct l'aurait fondu dans le morceau des réglages, donc rendu inséparable.
//
// ⚠️ ET PAR import.meta.glob, PAS PAR import(). build-zip.sh --free retire aussi
// la SOURCE de cet écran, et un import() nommant un fichier absent arrête la
// compilation : « TS2307: Cannot find module './SubscriptionSettings' ». Les
// sources livrées avec le paquet du dépôt ne se reconstruisaient donc PAS —
// alors que c'est précisément ce que la règle 4 exige. Un motif de glob qui ne
// trouve rien rend un objet vide : l'écran existe là où son fichier existe, et
// nulle part ailleurs, sans que la compilation s'en émeuve.
const ecranAbonnement = import.meta.glob<{ default: ComponentType }>('./SubscriptionSettings.tsx')['./SubscriptionSettings.tsx']
const SubscriptionSettings = ecranAbonnement ? lazy(ecranAbonnement) : null
import AppearanceSettings from './AppearanceSettings'
import PermissionsSettings from './PermissionsSettings'
import WarehouseSettings from './WarehouseSettings'
import WooCommerceSettings from './WooCommerceSettings'
import StripeSettings from './StripeSettings'


export default function Settings() {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState('company')

  const tabItems = [
    {
      key: 'company',
      label: (
        <span>
          <BankOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.company')}
        </span>
      ),
      children: <CompanySettings />,
    },
    {
      key: 'billing',
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.billing')}
        </span>
      ),
      children: <BillingSettings />,
    },
    {
      key: 'vat',
      label: (
        <span>
          <PercentageOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.vat')}
        </span>
      ),
      children: <VATSettings />,
    },
    {
      key: 'payment-terms',
      label: (
        <span>
          <ScheduleOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.paymentTerms')}
        </span>
      ),
      children: <PaymentTermsSettings />,
    },
    {
      key: 'footers',
      label: (
        <span>
          <AlignLeftOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.footers')}
        </span>
      ),
      children: <FooterSettings />,
    },
    {
      key: 'legal-mentions',
      label: (
        <span>
          <AuditOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.legalMentions')}
        </span>
      ),
      children: <LegalMentionsSettings />,
    },
    {
      key: 'general-terms',
      label: (
        <span>
          <FileProtectOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.generalTerms')}
        </span>
      ),
      children: <GeneralTermsSettings />,
    },
    {
      key: 'email',
      label: (
        <span>
          <MailOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.email')}
        </span>
      ),
      children: <EmailSettings />,
    },
    {
      key: 'notifications',
      label: (
        <span>
          <BellOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.notifications')}
        </span>
      ),
      children: <NotificationSettings />,
    },
    {
      key: 'users',
      label: (
        <span>
          <TeamOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.users')}
        </span>
      ),
      children: <UsersSettings />,
    },
    {
      key: 'permissions',
      label: (
        <span>
          <SafetyOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.permissions')}
        </span>
      ),
      children: <PermissionsSettings />,
    },
    {
      key: 'storage',
      label: (
        <span>
          <CloudOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.storage')}
        </span>
      ),
      children: <StorageSettings />,
    },
    // L'abonnement : seulement si cette installation porte une licence. Sans
    // elle, la route répond 404 et l'onglet n'aurait rien à montrer. Et
    // seulement si l'écran est dans le paquet — voir l'import en tête.
    ...(amsbmBoot.licence && SubscriptionSettings
      ? [
          {
            key: 'subscription',
            label: (
              <span>
                <CrownOutlined style={{ marginRight: 8 }} />
                {t('settingsPage.subscription', { defaultValue: 'Abonnement' })}
              </span>
            ),
            children: (
              <Suspense fallback={<Spin />}>
                <SubscriptionSettings />
              </Suspense>
            ),
          },
        ]
      : []),
    {
      key: 'about',
      label: (
        <span>
          <InfoCircleOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.about', { defaultValue: 'À propos' })}
        </span>
      ),
      children: <AboutSettings />,
    },
    {
      key: 'appearance',
      label: (
        <span>
          <BgColorsOutlined style={{ marginRight: 8 }} />
          {t('settingsPage.appearance')}
        </span>
      ),
      children: <AppearanceSettings />,
    },
    // ⚠️ UN ONGLET SANS SERVEUR EN FACE N'EST PAS UNE OFFRE, C'EST UNE PANNE.
    // Les entrepôts appartiennent au stock, la boutique au pont WooCommerce :
    // sans leur module, leurs routes n'existent pas, et ces deux onglets
    // s'ouvraient sur des requêtes en 404. Le menu, lui, continue de proposer
    // les modules absents — c'est là que l'offre se fait, pas ici.
    ...(amsbmBoot.modules?.stock !== false
      ? [
          {
            key: 'warehouses',
            label: (
              <span>
                <HomeOutlined style={{ marginRight: 8 }} />
                {t('settingsPage.warehouses')}
              </span>
            ),
            children: <WarehouseSettings />,
          },
        ]
      : []),
    ...(amsbmBoot.modules?.woocommerce !== false
      ? [
    {
      key: 'woocommerce',
      label: (
        <span>
          <ShopOutlined style={{ marginRight: 8 }} />
          {/* Seizième onglet, seul libellé écrit en dur : en anglais, il
              restait en français au milieu des quinze autres. */}
          {t('settingsPage.woocommerce', 'Boutique')}
        </span>
      ),
      children: <WooCommerceSettings />,
    },
        ]
      : []),
    {
      key: 'stripe',
      label: (
        <span>
          <CreditCardOutlined style={{ marginRight: 8 }} />
          {/* Libellé traduit, comme les seize autres : l'onglet « Boutique »
              avait montré ce qu'un libellé en dur donne une fois l'ERP passé en
              anglais. */}
          {t('settingsPage.stripe', 'Paiement en ligne')}
        </span>
      ),
      children: <StripeSettings />,
    },
  ]

  return (
    <div style={{ padding: '0' }}>
      <h1 style={{ marginBottom: 24 }}>{t('settingsPage.title')}</h1>
      <Card>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          tabPosition="left"
          items={tabItems}
          style={{ minHeight: 500 }}
        />
      </Card>
    </div>
  )
}
