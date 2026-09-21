/**
 * Contrôles de la reconnaissance du type d'une pièce d'après son contenu.
 *
 * ── D'où viennent ces cas ──
 *
 * Aucun n'est inventé. Tous sont des extraits réels du texte rendu par l'OCR sur les 239
 * pièces que la reprise avait laissées sans type, y compris leurs fautes de lecture :
 * « Parcolle », « Altiude », « Oportail », « Rinérares Enrogtrer ». Un test écrit sur du
 * texte propre ne prouve rien ici — ce n'est pas du texte propre qui arrive.
 *
 * ── Les deux erreurs qu'on ne veut pas commettre ──
 *
 * 1. **Classer à tort.** Un type faux se propage dans un dépôt et ne se voit plus. Chaque
 *    règle élargie est donc doublée d'un contre-exemple : un devis de menuiserie qui parle
 *    de « portail », une carte d'identité qui porte « RÉPUBLIQUE FRANÇAISE ».
 * 2. **Appeler « photo » ce qu'on n'a pas su lire.** C'est l'erreur déjà commise une fois :
 *    huit fichiers jamais lus rangés en photos parce qu'ils n'avaient « pas de texte ». Le
 *    type PHOTOS ne se conclut donc que d'une lecture RÉUSSIE qui n'a rien trouvé, et
 *    `indice` dit toujours sur quoi le classement repose.
 */
const { typeDuTexte, bruitOcr, formatNonDocument, REGLES } = await import('./lib/typage-contenu.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

const attendu = (type, texte, quoi) => ok(typeDuTexte(texte) === type,
  `${quoi} → ${type || 'aucun type'}${typeDuTexte(texte) === type ? '' : ` (obtenu : ${typeDuTexte(texte)})`}`)

// ═══════════════════════════════════════════════════════════
titre('Les types classiques restent reconnus')

attendu('DEVIS', 'Devis n° 1256 — fourniture et pose de luminaires extérieurs pour le client final', 'un devis')
attendu('FACTURE', 'Facture n° 2026-0042 relative aux travaux réalisés sur le site du bénéficiaire', 'une facture')
attendu('AH', "Attestation sur l'honneur relative aux travaux réalisés dans le bâtiment concerné", 'une attestation sur l\'honneur')
attendu('AFT', 'Procès-verbal de réception et attestation de fin des travaux signée par les deux parties', 'une attestation de fin de travaux')
attendu('COFRAC', "Rapport de contrôle établi par un organisme de contrôle accrédité COFRAC sur le chantier", 'un rapport COFRAC')
attendu('KBIS', 'Extrait du registre du commerce et des sociétés délivré par le greffe du tribunal de commerce', 'un Kbis')
attendu('CNI', "CARTE NATIONALE D'IDENTITÉ — RÉPUBLIQUE FRANÇAISE — nom, prénom et date de naissance", 'une carte nationale d\'identité')

// L'ordre des règles n'est pas décoratif : « attestation de fin de travaux » contient
// « attestation », et doit sortir en AFT, pas en attestation sur l'honneur.
ok(REGLES.findIndex(([c]) => c === 'AFT') < REGLES.findIndex(([c]) => c === 'AH'),
  "l'attestation de fin de travaux est examinée avant l'attestation sur l'honneur")
ok(REGLES.findIndex(([c]) => c === 'CNI') < REGLES.findIndex(([c]) => c === 'CADASTRE'),
  "la carte d'identité est examinée avant le cadastre — toutes deux portent « République française »")

// ═══════════════════════════════════════════════════════════
titre('Le cadastre, tel que l\'OCR le rend vraiment')

attendu('CADASTRE',
  'Le Bourg 18160 Touchay Parcelle : 000 / AB / 0126 Échelle 1 : 4900 relevé effectué sur place',
  'un extrait Géoportail lisible')
attendu('CADASTRE',
  'Parcolle : 000 /0F 0246 Altiude : 111.35 m relevé du terrain concerné par les travaux',
  '« Parcolle » et « Altiude », les deux fautes de lecture les plus fréquentes')
attendu('CADASTRE',
  'E nrta RÉPUBLIQUE portail Q, 114 Chemin du Grand Detche, 97480 commune de référence citée',
  'le bandeau Géoportail amputé de « Géo » et de « FRANÇAISE »')
attendu('CADASTRE',
  'Lei h RÉPUBLIQUE Oportail O, 4 Rue des Epis Bleus, 97480 Saint-Jose sur la carte affichée',
  '« Oportail », vu tel quel sur une pièce réelle')
attendu('CADASTRE',
  '45°50\'18.6"N 1°09\'11.3°W Rinérares Enrogtrer A pronmité Envoyer Partager depuis la carte',
  'la barre de Google Maps, lue de travers — trois boutons sur cinq suffisent')
attendu('CADASTRE',
  "464 IMPASSE DE KERGRAC'H Ajouter un eu manquant Suggérer une modification du lieu suivant",
  'les liens « Ajouter un lieu manquant » et « Suggérer une modification »')
attendu('CADASTRE',
  'Données cartographiques 2026 Google — 200 m — conditions d\'utilisation du service en ligne',
  'la mention « Données cartographiques »')

// ── Et ce qui ne doit SURTOUT pas devenir du cadastre ──
attendu('DEVIS',
  "Devis n° 88 : fourniture et pose d'un portail coulissant en aluminium, motorisation comprise",
  'un devis de menuiserie qui parle de portail')
ok(typeDuTexte('Le montant de la parcelle de terrain vendue est mentionné dans le contrat annexé au présent acte') !== 'CADASTRE',
  '« parcelle » sans référence chiffrée derrière ne fait pas un extrait cadastral')
ok(typeDuTexte("L'altitude du site est mentionnée dans l'étude thermique remise au client avec le rapport") !== 'CADASTRE',
  '« altitude » sans relevé chiffré non plus')

// ═══════════════════════════════════════════════════════════
titre("Le bruit de l'OCR n'est pas du texte")

const bruit = 'LOT: ar RSR ST EU LPS pr NS Etre, rs CRE ++ 2 dE. "= PES ee" ÉLUS à ne RNB AE riens GLS'
ok(bruitOcr(bruit), "une photo passée à l'OCR rend des caractères, pas des mots — et ça se reconnaît")
ok(typeDuTexte(bruit) === null, "et ce bruit ne reçoit aucun type plutôt qu'un type au hasard")
ok(bruitOcr('nd un M ur 2) + 3s Fe | 1 rx sù T- sf 14 TA o ME LP sé ; # k -# 4 Ut j'),
  'même chose sur un second échantillon réel')

const vraiTexte = "Attestation sur l'honneur — je soussigné, agissant en qualité de gérant de la société, "
  + 'certifie que les travaux décrits ci-dessus ont été réalisés conformément au devis signé.'
ok(!bruitOcr(vraiTexte), "un texte français normal n'est jamais pris pour du bruit")
ok(!bruitOcr('Le Bourg 18160 Touchay Parcelle : 000 / AB / 0126 Échelle 1 : 4900 altitude relevée'),
  "un extrait cadastral non plus, malgré ses chiffres")

// ═══════════════════════════════════════════════════════════
titre('Le format de page comme dernier indice')

ok(formatNonDocument({ largeur: 591, hauteur: 1280 }),
  "une page 591 × 1280 est une photo de téléphone, pas une feuille")
ok(formatNonDocument({ largeur: 1445, hauteur: 639 }), 'une page très large non plus')
ok(formatNonDocument({ largeur: 480, hauteur: 640 }), 'ni un format d\'appareil photo')
ok(!formatNonDocument({ largeur: 595, hauteur: 842 }), 'A4 portrait reste un document')
ok(!formatNonDocument({ largeur: 842, hauteur: 595 }), 'A4 paysage aussi')
ok(!formatNonDocument({ largeur: 612, hauteur: 792 }), 'le format Lettre américain aussi')
ok(!formatNonDocument({ largeur: 600, hauteur: 850 }), 'et une A4 légèrement rognée reste une A4')
ok(!formatNonDocument(null), "sans information de format, on ne conclut rien — surtout pas « photo »")

// ═══════════════════════════════════════════════════════════
titre('Une page vide ne reçoit jamais de type')

ok(typeDuTexte('') === null && typeDuTexte(null) === null, 'un texte absent ne donne aucun type')
ok(typeDuTexte('ab cd') === null, 'deux mots non plus : une page quasi vide reste sans type')

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
