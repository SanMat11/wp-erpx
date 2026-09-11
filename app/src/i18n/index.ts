import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './locales/fr.json'
import en from './locales/en.json'
import { DEFAUT, langue } from './locale'

// Plus de détection par le navigateur : elle passait avant tout le reste, si
// bien qu'un poste configuré en anglais affichait AMS Studio en anglais sur un
// WordPress français. C'est WordPress qui décide.
i18n
  .use(initReactI18next)
  .init({
    lng: langue,
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: DEFAUT,
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
