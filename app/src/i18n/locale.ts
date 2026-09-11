/**
 * La langue d'AMS Studio est celle de WordPress.
 *
 * Elle arrive dans l'amorçage, sous la forme d'une locale WordPress complète
 * — « fr_FR », « fr_BE », « en_US »… — dont on ne garde que les deux premières
 * lettres : AMS Studio n'est traduit qu'en français et en anglais, et « fr_BE » doit
 * évidemment donner du français.
 *
 * Le sélecteur de langue de l'application reste utilisable : il bascule
 * l'affichage sur-le-champ. Mais il ne se souvient de rien, et c'est voulu —
 * si le choix persistait dans le navigateur, AMS Studio cesserait de suivre
 * WordPress dès la première utilisation du menu, ce qui est précisément ce
 * qu'on ne veut plus. Pour changer durablement la langue : réglages généraux
 * de WordPress, ou la langue du profil pour un seul utilisateur.
 */

const CONNUES = ['fr', 'en'] as const;

/**
 * Le nom de chaque langue, écrit DANS cette langue.
 *
 * On n'écrit pas « Allemand » à un germanophone : dans un menu de langues, la
 * seule entrée qu'il sait lire à coup sûr est celle qui est dans la sienne.
 * Ces libellés-là ne passent donc jamais par i18n.
 */
export const NOMS: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
};

/**
 * Les langues à proposer, telles que le serveur les annonce.
 *
 * ⚠️ C'EST LE SERVEUR QUI DÉCIDE, parce que c'est lui qui porte les catalogues
 * .mo. Offrir ici une langue qu'il ne sait pas parler donnerait un écran
 * traduit devant un serveur qui répond en français, et ce n'est pas un défaut
 * qu'on voit en relisant : il faut une installation dans cette langue-là.
 */
export function languesOffertes(): string[] {
  const annoncees = window.amsbmBoot?.langues;

  if (Array.isArray(annoncees) && annoncees.length > 0) {
    return annoncees.filter((code) => code in NOMS);
  }

  return [...CONNUES];
}

export type Langue = (typeof CONNUES)[number];

export const DEFAUT: Langue = 'fr';

/**
 * La langue retenue, d'après la locale que WordPress a transmise.
 *
 * ⚠️ C'est la langue de DÉPART, pas la langue courante.
 *
 * `langue` est une constante de module : elle est évaluée une seule fois, à
 * l'amorçage. Le sélecteur FR/EN n'appelle que i18n.changeLanguage et ne la
 * touche pas. Un composant qui s'en sert pour choisir quoi afficher — c'était
 * le cas de ThemeProvider pour la locale d'antd — reste bloqué dans la langue
 * de WordPress pendant que le reste de l'écran bascule. Pour la langue
 * courante : `const { i18n } = useTranslation()` puis `i18n.language`.
 */
export function langueDeWordPress(): Langue {
  const locale = String(window.amsbmBoot?.locale ?? '')
    .toLowerCase()
    .slice(0, 2);

  return (CONNUES as readonly string[]).includes(locale) ? (locale as Langue) : DEFAUT;
}

export const langue: Langue = langueDeWordPress();
