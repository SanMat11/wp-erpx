import { ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider } from 'antd'
import frFR from 'antd/locale/fr_FR'
import enUS from 'antd/locale/en_US'
import { useThemeStore, getAntdTheme } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { settingsAPI } from '@/services/api'

interface ThemeProviderProps {
  children: ReactNode
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  // ⚠️ LA LANGUE COURANTE VIENT D'i18n, PAS DE LA CONSTANTE DE MODULE.
  //
  // `langue` (i18n/locale.ts) est évaluée une seule fois, à l'amorçage, depuis
  // la locale de WordPress. Le sélecteur FR/EN de l'en-tête n'appelle que
  // i18n.changeLanguage : la constante ne bougeait donc jamais, ConfigProvider
  // ne rendait pas à nouveau, et tout ce qui vient d'antd — sélecteurs de date,
  // « No data », pagination, filtres — restait dans la langue de WordPress
  // pendant que le reste de l'écran basculait. useTranslation() abonne bien le
  // composant au changement de langue.
  const { i18n } = useTranslation()
  const themeMode = useThemeStore((state) => state.themeMode)
  const primaryColor = useThemeStore((state) => state.primaryColor)
  const setTheme = useThemeStore((state) => state.setTheme)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  // Load theme from API when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      settingsAPI.getAppearance()
        .then((response) => {
          const { theme_mode, primary_color } = response.data
          // ⚠️ NE PAS APPLIQUER TELLE QUELLE UNE APPARENCE VENUE DU SERVEUR.
          //
          // PUT /settings/appearance accepte aujourd'hui n'importe quoi — un
          // « chartreuse » et un « pas-une-couleur » sont enregistrés puis
          // relus, et la chaîne partait droit dans colorPrimary d'antd. Le
          // contrôle qui compte reste à poser côté serveur, pour tous les
          // appelants ; celui-ci évite au moins qu'un réglage aberrant abîme
          // l'affichage. Une valeur refusée laisse la précédente en place.
          const modeValide = 'light' === theme_mode || 'dark' === theme_mode
          const couleurValide = 'string' === typeof primary_color && /^#[0-9a-f]{6}$/i.test(primary_color)

          if (!modeValide || !couleurValide) {
            console.warn('Apparence ignorée, valeur hors liste :', { theme_mode, primary_color })
          }

          if (modeValide || couleurValide) {
            const actuel = useThemeStore.getState()
            setTheme(
              modeValide ? (theme_mode as 'light' | 'dark') : actuel.themeMode,
              couleurValide ? primary_color : actuel.primaryColor
            )
          }
        })
        .catch((error) => {
          console.error('Failed to load theme settings:', error)
        })
    }
  }, [isAuthenticated, setTheme])

  // Apply dark mode to body for CSS variables
  useEffect(() => {
    if (themeMode === 'dark') {
      document.body.classList.add('dark-mode')
      document.body.style.backgroundColor = '#141414'
    } else {
      document.body.classList.remove('dark-mode')
      document.body.style.backgroundColor = '#f0f2f5'
    }
  }, [themeMode])

  const antdTheme = getAntdTheme(themeMode, primaryColor)

  return (
    <ConfigProvider locale={i18n.language?.startsWith('en') ? enUS : frFR} theme={antdTheme}>
      {children}
    </ConfigProvider>
  )
}
