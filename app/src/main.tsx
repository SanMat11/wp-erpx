import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/fr'
import 'dayjs/locale/en'

import App from './App'
import ThemeProvider from './components/ThemeProvider'
import { amsbmBoot } from './services/api'
import { langue } from './i18n/locale'
import './i18n'
import './index.css'
import { useAuthStore } from './stores/authStore'

// Les dates suivent la même langue que le reste : « 15 août » ou « August 15 ».
dayjs.locale(langue)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Sur cet hébergement, TOUTE requête WordPress coûte environ 800 ms de
      // démarrage — mesuré sur les routes natives de WordPress elles-mêmes, donc
      // rien qu'AMS Studio puisse accélérer. Ouvrir une facture demandait huit appels,
      // dont sept de référentiels qui ne changent pas d'une minute à l'autre :
      // articles, clients, fournisseurs, taux de TVA, conditions de règlement,
      // pieds de page. Sans durée de fraîcheur, React Query les redemandait à
      // chaque ouverture d'onglet.
      //
      // Une minute de fraîcheur suffit à rendre la deuxième facture immédiate,
      // et les écritures continuent d'invalider explicitement ce qu'elles
      // changent : rien ne se périme à tort.
      staleTime: 60_000,
      gcTime: 30 * 60_000,
    },
  },
})

// L'application ne s'authentifie plus elle-même : elle tourne dans
// l'administration de WordPress, donc derrière la session WordPress. On sème le
// magasin d'authentification avec l'utilisateur courant, et PrivateRoute laisse
// passer comme avant. Les écrans de connexion et d'inscription restent dans le
// dépôt mais ne sont plus atteints — c'était la porte d'entrée du SaaS.
if (amsbmBoot.user) {
  useAuthStore.getState().setAuth(amsbmBoot.user)
}

ReactDOM.createRoot(document.getElementById('amsbm-root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* MemoryRouter et non BrowserRouter : l'URL appartient à WordPress
            (wp-admin/admin.php?page=amsbm-app). Un routeur qui écrit dans la barre
            d'adresse ferait sortir l'utilisateur de l'administration au premier
            changement d'écran. La navigation réelle passe de toute façon par le
            magasin d'onglets, pas par les routes. */}
        {/* L'écran d'entrée vient du serveur quand il en impose un : c'est ainsi
            que la page publique d'un devis ouvre sur le devis, et non sur le
            tableau de bord. Voir AmsbmBoot.route. */}
        <MemoryRouter initialEntries={[amsbmBoot.route || '/dashboard']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
