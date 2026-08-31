# Rideau

Extension Brave qui empêche un site web de savoir que vous ne le regardez plus,
accompagnée d'un banc de test qui reproduit les techniques de détection réelles.

Beaucoup de sites surveillent en continu votre présence : ils écoutent la sortie
du curseur hors de la fenêtre, le changement d'onglet, la perte de focus, et
mesurent le ralentissement des animations quand un onglet passe en arrière-plan.
Rideau intercepte ces signaux avant que le code du site ne les voie.

```
rideau/      l'extension (Manifest V3)
site-test/   le banc de test : un site qui essaie de vous surveiller
```

## Installation

1. Ouvrez `brave://extensions`
2. Activez **Mode développeur** (en haut à droite)
3. **Charger l'extension non empaquetée** → choisissez le dossier `rideau/`

L'installation ne demande aucune permission : Rideau fonctionne en **liste
blanche**. Tant qu'un domaine n'a pas été ajouté, l'extension ne lit ni ne
modifie rien.

## Utilisation

Sur le site à protéger, cliquez sur l'icône Rideau puis **Protéger ce site**.
Brave demande alors l'autorisation pour ce domaine uniquement. **Rechargez la
page** : la protection s'installe au tout début du chargement, elle ne peut donc
pas s'appliquer à une page déjà ouverte.

Le popup permet ensuite de choisir un niveau, ou d'activer les modules un par un.

| Niveau | Contenu |
| --- | --- |
| Minimal | Mensonges passifs seulement, aucun événement bloqué |
| Équilibré | + blocage des événements de départ |
| **Strict** (défaut) | + anti-ralentissement des timers |

### Les huit modules

| Module | Ce qu'il fait |
| --- | --- |
| `spoof-visibility` | `document.hidden` reste `false`, `visibilityState` reste `visible` |
| `mute-visibility` | l'événement `visibilitychange` n'atteint jamais la page |
| `spoof-focus` | `document.hasFocus()` renvoie toujours `true` |
| `mute-focus` | bloque les `blur`/`focus` **de la fenêtre** |
| `mute-pointer` | bloque `mouseleave`/`pointerleave` **de sortie de fenêtre** |
| `mute-lifecycle` | bloque `pagehide`, le `pageshow` de retour, `freeze`, `resume` |
| `kill-idle-api` | fait disparaître `IdleDetector` |
| `unthrottle` | garde `rAF` et les timers à cadence normale en arrière-plan |

Les deux modules `mute-focus` et `mute-pointer` sont volontairement sélectifs.
Un `blur` sur un champ de formulaire et un `mouseleave` sur un menu déroulant
passent intacts : les bloquer casserait la validation des formulaires et les
menus au survol. Seuls les événements dont la cible est la fenêtre ou le
document, sans élément lié, sont interceptés.

## Vérifier que ça marche

Lancez le banc de test :

```bash
cd site-test && ./serve.cmd
```

Puis ouvrez <http://localhost:8000>. (`localhost` est un « contexte sécurisé »,
c'est ce qui rend `IdleDetector` testable — un simple `file://` ne le
permettrait pas.)

La page arme **14 détecteurs** et affiche un verdict *Présent* / *Absent*, un
journal horodaté, et un panneau **Empreinte des APIs** qui indique directement
quels modules sont en place.

1. **Avant.** Sans protection, jouez les 5 scénarios guidés. Tous les détecteurs
   doivent réagir. *Exporter le rapport JSON* → c'est votre référence.
2. Cliquez sur l'icône Rideau → **Protéger ce site** → **rechargez**.
   Le panneau d'empreinte doit basculer de `intacte` à `remplacée`.
3. **Après.** Rejouez les 5 scénarios. Chaque carte doit annoncer
   « Aucun détecteur n'a réagi » — **sauf le scénario 5**, voir plus bas.
4. Contrôle de la granularité : passez le niveau à *Minimal* et rechargez. Les
   détecteurs événementiels (1, 5, 6, 10) redeviennent déclenchables, les
   sondages (2, 4, 11) restent muets.

Le banc inclut une sonde dans une `iframe` qui rejoue la même batterie : si la
protection oubliait les cadres imbriqués, ce cadre trahirait le départ que la
page principale masque.

## Ce qui a été mesuré

Les shims ont été testés dans un onglet réellement caché et défocalisé :

| Mesure | Sans Rideau | Avec Rideau |
| --- | --- | --- |
| `document.visibilityState` | `hidden` | `visible` |
| `document.hasFocus()` | `false` | `true` |
| Images rAF sur 2 s | **0** | **58** (écart max 39 ms) |
| Période d'un `setInterval(250)` | étirée à 1003 ms | 259 ms au pire |
| Verdict du banc | Absent | **Présent, 0 alerte** |

Sélectivité vérifiée : `visibilitychange`, `blur` fenêtre, `pagehide` et
`mouseleave` document sont bloqués, tandis que `blur` sur un champ et
`mouseleave` sur un menu passent normalement.

## Limites connues

**L'immobilité réelle n'est pas masquée.** Un site qui conclut « absent après
N secondes sans `mousemove` ni `keydown` » vous verra toujours inactif si vous
ne touchez effectivement à rien. Rideau empêche la détection du **départ**
(souris sortie, onglet caché, fenêtre défocalisée), pas celle de
l'**immobilité**. C'est le scénario 5 du banc de test, conservé précisément pour
montrer cette limite. La combler demanderait d'injecter une fausse activité,
module volontairement écarté.

**Pas de furtivité.** `document.hasFocus.toString()` révèle une fonction non
native : un site déterminé peut détecter qu'une extension le trompe. C'est
d'ailleurs ce que le panneau *Empreinte des APIs* du banc de test exploite.

**Tout se joue en JavaScript.** Il existe une approche plus profonde
(`chrome.debugger` + `Emulation.setFocusEmulationEnabled`, qui rend le focus vrai
au niveau du moteur), écartée ici car elle impose un bandeau permanent
« Brave est en cours de débogage par une extension ».

**Casse possible.** `unthrottle` fait tourner les animations même onglet caché,
ce qui consomme du CPU ; certains lecteurs vidéo ou jeux comptent sur la mise en
veille. D'où la liste blanche, le réglage par site et les huit interrupteurs.

## Comment c'est construit

Un content script ordinaire s'exécute dans un « monde isolé » : il ne peut pas
modifier `document.visibilityState` tel que la page le voit. Il faut injecter
dans le **monde MAIN**, à **`document_start`**, dans **toutes les frames** —
donc avant le premier `<script>` du site.

Conséquence : à cet instant, `chrome.storage` est inaccessible et aucune lecture
synchrone de la configuration n'est possible. Une lecture asynchrone ouvrirait
une fenêtre pendant laquelle le site s'exécuterait sans protection.

**La configuration est donc portée par l'enregistrement lui-même.** Chaque
module est un fichier autonome, sans configuration à l'exécution, enregistré par
`chrome.scripting.registerContentScripts()` avec sa propre liste `matches`
calculée par le service worker. Activer un module sur un domaine revient à
l'ajouter à ces `matches`. Aucune course, rien à transmettre, et une granularité
par site et par module.

Le blocage d'événement repose sur un écouteur en phase de **capture sur
`window`** : à `document_start` nous sommes enregistrés avant tout script du
site, donc premiers dans l'ordre `window → document → cible`, et
`stopImmediatePropagation()` coupe la suite — y compris les handlers
`document.onvisibilitychange`, dont la phase cible n'est jamais atteinte.

`unthrottle` utilise un **double armement** : chaque échéance est armée à la fois
sur le timer natif et sur un tic de Web Worker (que Chromium ne ralentit pas).
Le premier arrivé gagne et désarme l'autre. Onglet visible, le natif gagne
toujours et la cadence reste exactement celle du navigateur ; onglet caché, le
worker prend le relais sans le moindre trou. Sur les sites dont la CSP interdit
les Workers issus d'un `Blob`, un pont en monde isolé — non soumis à cette CSP —
fournit les tics à la place.

```
rideau/
  manifest.json
  src/
    config.js              modules, niveaux, accès au stockage
    background.js          liste blanche -> enregistrements de content scripts
    shims/                 monde MAIN, un fichier par module
    bridge/                pont de tics, monde isolé (repli CSP)
    popup/  options/
  tools/make-icons.py      génère les icônes (zlib pur, sans dépendance)
site-test/
  index.html  app.js       banc, verdict, scénarios, journal, rapport
  detectors.js             les 13 techniques de détection
  frame.html  frame.js     sonde en cadre imbriqué
  serve.cmd                python -m http.server 8000
```
