/**
 * Ce que le SERVEUR a répondu, et rien d'autre.
 *
 * ⚠️ Un refus qui ne s'affiche pas est un clic manqué aux yeux de l'utilisateur :
 * la corbeille d'un exercice ouvert recevait un 403 et la ligne restait là, sans
 * un mot. Et un refus remplacé par « Erreur » n'apprend rien de plus.
 *
 * Les routes de comptabilité répondent `{ error: "…" }` (this->fail()), mais un
 * refus posé par WordPress lui-même — permission, nonce périmé, route absente —
 * répond `{ code, message, data: { status } }`. Les deux formes se lisent ici,
 * pour qu'aucun motif ne se perde selon l'étage qui a refusé.
 */
export function motifRefus(e: any, repli: string): string {
  const corps = e?.response?.data

  if (corps && 'string' === typeof corps.error && '' !== corps.error) {
    return corps.error
  }

  if (corps && 'string' === typeof corps.message && '' !== corps.message) {
    return corps.message
  }

  return repli
}
