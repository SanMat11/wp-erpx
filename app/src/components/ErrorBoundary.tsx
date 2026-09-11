import { Component, ErrorInfo, ReactNode } from 'react'
import { Alert, Button, theme } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorFallbackProps {
  error: Error | null
  errorInfo: ErrorInfo | null
  onRetry: () => void
}

function ErrorFallback({ error, errorInfo, onRetry }: ErrorFallbackProps) {
  const { t } = useTranslation()
  // ⚠️ PAS DE COULEUR EN DUR DANS UN ÉCRAN. Les deux blocs de trace étaient
  // peints en #f5f5f5 : en thème sombre, du texte clair sur un fond presque
  // blanc — l'écran illisible étant précisément celui qui explique la panne.
  // Les jetons du thème suivent le mode choisi dans Réglages → Apparence.
  const { token } = theme.useToken()

  const traceStyle = {
    fontSize: 11,
    maxHeight: 200,
    overflow: 'auto',
    background: token.colorFillTertiary,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadius,
    padding: 8,
  } as const

  return (
    <div style={{ padding: 24 }}>
      <Alert
        type="error"
        message={t('errorBoundary.heading')}
        description={
          <div>
            <p><strong>{t('errorBoundary.labels.error')}</strong> {error?.message}</p>
            <p><strong>{t('errorBoundary.labels.stack')}</strong></p>
            <pre style={traceStyle}>
              {error?.stack}
            </pre>
            {errorInfo && (
              <>
                <p><strong>{t('errorBoundary.labels.componentStack')}</strong></p>
                <pre style={traceStyle}>
                  {errorInfo.componentStack}
                </pre>
              </>
            )}
            <Button
              type="primary"
              onClick={onRetry}
              style={{ marginTop: 16 }}
            >
              {t('errorBoundary.retry')}
            </Button>
          </div>
        }
      />
    </div>
  )
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={() => this.setState({ hasError: false, error: null, errorInfo: null })}
        />
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
