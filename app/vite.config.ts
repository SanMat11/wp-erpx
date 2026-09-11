/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

/**
 * Compilation de l'application pour WordPress.
 *
 * Différences avec la configuration du SaaS, et elles seules :
 *
 *  - la sortie va dans « build/ », versionnée dans le dépôt. Le serveur du
 *    client n'a ni npm ni Internet, et un plugin distribué ne peut pas exiger
 *    une étape de compilation : c'est le même parti pris que « lib/pdf ».
 *  - les fichiers portent leur empreinte dans leur NOM, et WordPress les met en
 *    file sans « ?ver= » : il lit le manifeste écrit ici. Un module ES chargé
 *    sous deux adresses est exécuté deux fois, et « ?ver= » en fabriquait une
 *    seconde (voir la note sur entryFileNames).
 *  - plus de plugin de version ni de proxy de développement : la mise à jour du
 *    bundle est celle du plugin, et il n'y a plus de serveur Go en face.
 */
function singleFileNames(): Plugin {
  return {
    name: 'amsbm-stable-filenames',
    config() {
      return {
        build: {
          rollupOptions: {
            output: {
              // ⚠️ L'EMPREINTE DANS LE NOM, PAS DANS UN « ?ver= ».
              //
              // Les morceaux réimportent l'entrée par son chemin nu. Si WordPress
              // met en file la même entrée avec un « ?ver= », le navigateur y voit
              // deux modules et exécute TOUT deux fois — mesuré : six requêtes
              // d'amorçage au lieu de trois, et deux arbres React sur la même
              // racine. Un nom porteur de version supprime la question.
              entryFileNames: 'amsbm-app-[hash].js',
              // Les morceaux portent une empreinte : c'est le module d'entrée
              // qui les nomme, pas WordPress, donc le cache du navigateur se
              // gère tout seul et une mise à jour n'oblige à retélécharger que
              // ce qui a changé.
              chunkFileNames: 'morceaux/[name]-[hash].js',
              assetFileNames: (info: { name?: string }) =>
                info.name && info.name.endsWith('.css') ? 'amsbm-app-[hash].css' : 'assets/[name][extname]',
            },
          },
        },
      }
    },
  }
}

/**
 * Le cache du navigateur, écrit dans le dossier de sortie.
 *
 * Mesuré sur ams-studio.lu : l'hébergement mutualisé répond « max-age=900 » sur
 * les fichiers du bundle. Quinze minutes. Passé ce délai le navigateur reprend
 * tout le paquet, et c'est une bonne part de la lenteur ressentie — pas le code,
 * le réseau.
 *
 * Or ces fichiers ne changent jamais sous une même adresse : TOUS portent leur
 * empreinte dans leur nom. Une mise à jour du plugin donne donc de NOUVELLES
 * adresses, et un an de cache est sans risque.
 *
 * Le même plugin dépose le manifeste que lit Shell::enqueue — les deux vont
 * ensemble : des noms à empreinte sans manifeste, et WordPress ne saurait plus
 * quoi mettre en file.
 *
 * Les fichiers sont écrits ici plutôt que déposés à la main dans build/ :
 * « emptyOutDir » efface le dossier à chaque compilation, et ils y
 * disparaîtraient au premier « npm run build » — sans que personne le remarque.
 */
function cacheNavigateur(): Plugin {
  return {
    name: 'amsbm-cache-navigateur',
    apply: 'build',
    writeBundle(_options, bundle) {
      let js = 'amsbm-app.js', css = 'amsbm-app.css'

      for (const [nom, sortie] of Object.entries(bundle)) {
        if ((sortie as { isEntry?: boolean }).isEntry) js = nom
        if (nom.endsWith('.css')) css = nom
      }

      fs.writeFileSync(
        path.resolve(__dirname, 'build/manifeste.json'),
        JSON.stringify({ js, css }, null, 2) + '\n'
      )

      const regle = `# Écrit par vite.config.ts — ne pas modifier à la main.
#
# Tous les fichiers portent leur empreinte dans leur nom : une adresse donnée
# sert toujours le même contenu, donc le navigateur peut la garder. Sans cette
# règle, l'hébergement mutualisé annonce max-age=900 et le paquet repart sur le
# réseau quatre fois par heure.
<IfModule mod_headers.c>
  <FilesMatch "\\.(js|css|woff2?|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
    Header unset Expires
    Header unset Pragma
  </FilesMatch>
</IfModule>
`
      fs.writeFileSync(path.resolve(__dirname, 'build/.htaccess'), regle)
    },
  }
}

export default defineConfig({
  plugins: [react(), singleFileNames(), cacheNavigateur()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: false,
    // ⚠️ CE COMMENTAIRE A CHANGÉ, ET LA RAISON MÉRITE D'ÊTRE DITE.
    //
    // On regroupait tout en un seul fichier parce qu'en IIFE, les morceaux
    // chargés à la demande se cherchaient sous l'URL de la PAGE —
    // wp-admin/admin.php — et non sous le dossier du plugin : le premier écran
    // ouvert demandait « /wp-admin/QuoteEditor.js » et ne trouvait rien.
    //
    // C'est vrai de l'IIFE, et FAUX des modules ES : un module résout ses
    // imports relativement à SA PROPRE URL, donc au dossier du plugin. Le
    // découpage redevient donc possible, et il compte : le bundle pesait
    // 3,1 Mo chargés d'un bloc alors qu'App.tsx déclare déjà ses pages en
    // lazy(). On ne chargeait qu'un seul écran mais on téléchargeait les vingt.
    //
    // La feuille de style reste unique : WordPress la met en file séparément.
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // Le point d'entrée est le module, pas une page HTML : c'est WordPress qui
      // rend la page d'administration et y accroche le script.
      input: path.resolve(__dirname, 'src/main.tsx'),
      output: {
        // ⚠️ REACT DANS UN SEUL MORCEAU, PARTAGÉ PAR TOUS.
        //
        // Sans cela, plusieurs morceaux embarquent chacun leur copie de React,
        // et l'application meurt sur « Minified React error #321 » — des crochets
        // appelés depuis une seconde instance. C'est le piège classique du
        // découpage, et il ne se voit qu'à l'exécution : la compilation, elle,
        // réussit très bien.
        manualChunks( id: string ) {
          if ( ! id.includes( 'node_modules/' ) ) {
            return undefined;
          }

          // Ce qui ne pèse QUE sur un écran reste avec cet écran : recharts ne
          // sert qu'au tableau de bord, jszip qu'au téléchargement groupé de la
          // GED. Les mettre en commun, ce serait les charger pour tout le monde.
          if ( /node_modules\/(recharts|jszip|d3-|victory-vendor|decimal\.js)/.test( id ) ) {
            return undefined;
          }

          // ⚠️ TOUT LE RESTE ENSEMBLE, ET C'EST VOULU.
          //
          // Une bibliothèque dupliquée entre deux morceaux casse tout ce qui
          // repose sur un contexte React : react-query répondait « No QueryClient
          // set » alors que le fournisseur était bien posé — simplement, l'écran
          // interrogeait une SECONDE copie de la bibliothèque, avec son propre
          // contexte, vide. Le même piège attend react-router, i18next et zustand.
          // Un morceau commun unique les rend indivisibles.
          //
          // Et un SEUL, pas trois. Séparer react, antd et le reste rouvre l'autre
          // piège : les morceaux s'importent en rond (antd a besoin de dayjs, qui
          // a besoin de react…), et l'ordre d'évaluation finit par utiliser une
          // classe pas encore définie — « v2 is not a constructor », sans rien
          // dans la compilation pour l'annoncer. Un morceau commun ne peut pas
          // tourner en rond avec lui-même.
          return 'vendor';
        },
        // Module ES, et la balise porte type="module" (voir Shell::enqueue).
        // Sans cet attribut, « import » est une erreur de syntaxe et la page
        // reste blanche, sans le moindre message ailleurs que dans la console.
        format: 'es',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
