import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, Card } from 'antd'
import {
  SettingOutlined,
  BookOutlined,
  FileTextOutlined,
  CalculatorOutlined,
  CloudUploadOutlined,
  BarChartOutlined,
  LinkOutlined,
  CalendarOutlined,
} from '@ant-design/icons'
import ComptaConfigTab from './ComptaConfigTab'
import PlanComptableTab from './PlanComptableTab'
import JournauxTab from './JournauxTab'
import ExercicesTab from './ExercicesTab'
import EcrituresTab from './EcrituresTab'
import LettrageTab from './LettrageTab'
import ExportSageTab from './ExportSageTab'
import EtatsTab from './EtatsTab'

export default function ComptabilitePage() {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState('ecritures')

  return (
    <Card style={{ margin: 16 }} bodyStyle={{ padding: 0 }}>
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        size="large"
        tabBarStyle={{ padding: '0 16px', marginBottom: 0 }}
        items={[
          { key: 'ecritures', label: <span><FileTextOutlined /> {t('comptaPage.tabEcritures')}</span>, children: <div style={{ padding: 16 }}><EcrituresTab /></div> },
          { key: 'lettrage', label: <span><LinkOutlined /> {t('comptaPage.tabLettrage')}</span>, children: <div style={{ padding: 16 }}><LettrageTab /></div> },
          { key: 'export', label: <span><CloudUploadOutlined /> {t('comptaPage.tabExport')}</span>, children: <div style={{ padding: 16 }}><ExportSageTab /></div> },
          { key: 'etats', label: <span><BarChartOutlined /> {t('comptaPage.tabEtats')}</span>, children: <div style={{ padding: 16 }}><EtatsTab /></div> },
          { key: 'plan', label: <span><BookOutlined /> {t('comptaPage.tabPlan')}</span>, children: <div style={{ padding: 16 }}><PlanComptableTab /></div> },
          { key: 'journaux', label: <span><CalculatorOutlined /> {t('comptaPage.tabJournaux')}</span>, children: <div style={{ padding: 16 }}><JournauxTab /></div> },
          { key: 'exercices', label: <span><CalendarOutlined /> {t('comptaPage.tabExercices')}</span>, children: <div style={{ padding: 16 }}><ExercicesTab /></div> },
          { key: 'config', label: <span><SettingOutlined /> {t('comptaPage.tabConfig')}</span>, children: <div style={{ padding: 16 }}><ComptaConfigTab /></div> },
        ]}
      />
    </Card>
  )
}
