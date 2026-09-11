/**
 * La marque d'AMS Studio.
 *
 * « Le lettrage » : deux chevrons qui se font face sans se toucher, et le X se
 * forme dans le vide entre les deux. C'est le geste du lettrage comptable —
 * rapprocher deux écritures — et c'est le seul dessin de la marque.
 *
 * ⚠️ UN SEUL ENDROIT LA DESSINE. Elle apparaît dans la barre latérale, sur
 * l'écran de connexion, dans le menu de WordPress et sur les documents : quatre
 * copies du même tracé finissent toujours par diverger d'un demi-pixel, et l'on
 * ne s'en aperçoit que sur une capture d'écran, des mois plus tard.
 */

type Props = {
  /** Côté du carré, en pixels. */
  taille?: number
  /** Le chevron prend la couleur du texte environnant, sauf indication. */
  couleur?: string
  /** Avec son fond bleu et ses coins arrondis, ou seul. */
  cartouche?: boolean
}

export default function MarqueAmsbm({ taille = 40, couleur, cartouche = true }: Props) {
  // Le trait s'épaissit quand la marque rapetisse : à 20 px un trait de 6,4
  // unités disparaît, et le X cesse de se lire.
  const epaisseur = taille <= 24 ? 8 : taille <= 40 ? 7 : 6.4

  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 64 64"
      role="img"
      aria-label="AMS Studio"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {cartouche && <rect width="64" height="64" rx={taille <= 24 ? 6 : 12} fill="#16457A" />}
      <g
        stroke={couleur ?? (cartouche ? '#FFFFFF' : 'currentColor')}
        strokeWidth={epaisseur}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {cartouche ? (
          <>
            <path d="M14 15 28 32 14 49" />
            <path d="M50 15 36 32l14 17" />
          </>
        ) : (
          <>
            <path d="M10 12 26 32 10 52" />
            <path d="M54 12 38 32l16 20" />
          </>
        )}
      </g>
    </svg>
  )
}
