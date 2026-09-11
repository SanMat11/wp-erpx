import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/stores/authStore'

// Layouts (kept non-lazy to avoid flashing the app shell)
import MainLayout from '@/components/layouts/MainLayout'
import AuthLayout from '@/components/layouts/AuthLayout'

// Pages (lazy-loaded for code-splitting)
const Login = lazy(() => import('@/pages/auth/Login'))
const Register = lazy(() => import('@/pages/auth/Register'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ClientList = lazy(() => import('@/pages/clients/ClientList'))
const ClientForm = lazy(() => import('@/pages/clients/ClientForm'))
const SupplierList = lazy(() => import('@/pages/suppliers/SupplierList'))
const ArticleList = lazy(() => import('@/pages/articles/ArticleList'))
const QuoteList = lazy(() => import('@/pages/quotes/QuoteList'))
const PublicQuote = lazy(() => import('@/pages/quotes/PublicQuote'))
const QuoteVerification = lazy(() => import('@/pages/quotes/QuoteVerification'))
const InvoiceList = lazy(() => import('@/pages/invoices/InvoiceList'))
const PublicInvoice = lazy(() => import('@/pages/invoices/PublicInvoice'))
const StockList = lazy(() => import('@/pages/stock/StockList'))
const DealList = lazy(() => import('@/pages/deals/DealList'))
const PurchaseOrderList = lazy(() => import('@/pages/purchases/PurchaseOrderList'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function PageFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
      }}
    >
      <Spin size="large" />
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public quote portal (no auth required) */}
        <Route path="/devis/:token" element={<PublicQuote />} />
        {/* Facture consultée et réglée par le client, hors de toute session :
            comme le devis, elle vit AVANT PrivateRoute — la placer sous la
            coquille authentifiée renverrait le client vers /login. */}
        <Route path="/facture/:token" element={<PublicInvoice />} />
        {/* Vérification publique d'un devis signé (QR code) */}
        <Route path="/verification/:code" element={<QuoteVerification />} />

        {/* Auth routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        {/* Protected routes */}
        <Route
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Clients */}
          <Route path="/clients" element={<ClientList />} />
          <Route path="/clients/new" element={<ClientForm />} />
          <Route path="/clients/:id" element={<ClientForm />} />

          {/* Suppliers */}
          <Route path="/suppliers" element={<SupplierList />} />

          {/* Articles */}
          <Route path="/articles" element={<ArticleList />} />

          {/* Quotes */}
          <Route path="/quotes" element={<QuoteList />} />

          {/* Invoices */}
          <Route path="/invoices" element={<InvoiceList />} />

          {/* Stock */}
          <Route path="/stock" element={<StockList />} />

          {/* Deals */}
          <Route path="/deals" element={<DealList />} />

          {/* Purchase Orders */}
          <Route path="/purchase-orders" element={<PurchaseOrderList />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
