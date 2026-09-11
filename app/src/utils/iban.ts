/**
 * Contrôle d'IBAN : format, puis clé modulo 97.
 *
 * Les mêmes règles que le serveur, mot pour mot. Un écran plus sévère que le
 * serveur enferme l'utilisateur — il voit « IBAN invalide » sur une saisie
 * juste et n'a aucun moyen d'aller plus loin ; un écran plus permissif fait
 * l'inverse, on remplit tout et l'erreur ne tombe qu'à l'envoi.
 *
 * Les ESPACES sont tolérés : c'est ainsi qu'un IBAN s'écrit sur un relevé, et
 * c'est ce que montre l'exemple affiché dans le champ. Ils sont retirés avant
 * contrôle, comme le fait déjà l'envoi du formulaire.
 */
export function normaliserIban(valeur: string): string {
  return valeur.replace(/\s/g, '').toUpperCase();
}

export function ibanEstValide(valeur: string): boolean {
  const iban = normaliserIban(valeur);

  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return false;
  }

  // Les quatre premiers caractères passent à la fin, les lettres deviennent des
  // nombres (A = 10), et le tout doit valoir 1 modulo 97.
  const chiffres = (iban.slice(4) + iban.slice(0, 4))
    .split('')
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');

  let reste = 0;

  for (const chiffre of chiffres) {
    reste = (reste * 10 + Number(chiffre)) % 97;
  }

  return reste === 1;
}
