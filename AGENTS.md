# AGENTS.md

Notes pour un agent qui reprend ce dépôt. Le `README.md` s'adresse à
l'utilisateur ; ce fichier décrit les contraintes qui ne se devinent pas en
lisant le code.

## Ce que contient le dépôt

Deux projets qui se répondent, sans outillage commun :

- `rideau/` — extension Brave / Chromium (Manifest V3) qui empêche un site de
  détecter que l'utilisateur ne le regarde plus.
- `site-test/` — un site qui *essaie* de le détecter, avec 13 techniques
  réelles. C'est l'outil de validation : toute modification de `rideau/` se
  vérifie ici.

**Aucune dépendance, aucune étape de build, pas de `package.json`.** Node n'est
pas installé sur la machine de développement. N'introduisez ni bundler, ni
transpileur, ni gestionnaire de paquets : les fichiers sont chargés tels quels
par le navigateur, et c'est une propriété voulue.

Commentaires et interface en français. Les commentaires des shims sont sans
accents (contrainte d'outillage historique) ; ceux du reste du code et toute
l'interface en portent.

## Les cinq invariants à ne pas casser

**1. Un shim est autonome.** Chaque fichier de `rideau/src/shims/` est une IIFE
qui ne lit aucune configuration, n'importe rien, et n'expose rien sur `window`.
Ne créez jamais d'espace de noms partagé entre shims : le helper `neutralize`
est volontairement dupliqué dans plusieurs fichiers. C'est ce qui permet de les
activer indépendamment.

**2. La configuration est portée par l'enregistrement.** Les shims tournent en
monde MAIN à `document_start`, où `chrome.storage` est inaccessible et où toute
lecture asynchrone ouvrirait une fenêtre pendant laquelle le site s'exécuterait
sans protection. `src/background.js` calcule donc, pour chaque module, la liste
`matches` des domaines qui l'activent. Activer un module = l'ajouter à ses
`matches`. **Ne jamais** ajouter de canal de configuration à l'exécution.

**3. Le blocage d'événement doit rester sélectif.** C'est là que l'on casse des
sites, et c'est là qu'un bug est déjà passé :

- `mute-focus` ne bloque un `blur`/`focus` que si `event.target` est `window` ou
  `document`. Un `blur` de champ de formulaire remonte aussi en capture par
  `window` ; le bloquer casserait toute validation.
- `mute-pointer` reconnaît une sortie de fenêtre à `relatedTarget == null`,
  **et à rien d'autre**. Une version antérieure exigeait en plus une cible de
  niveau document : c'était faux, `mouseout` part de l'élément réellement
  survolé et remonte ensuite. Le module bloquait donc `mouseleave` sur
  `document` mais laissait passer `mouseout`, et la détection fonctionnait
  encore. Ne réintroduisez pas de condition sur la cible.
- `mute-pointer` ne bloque une *entrée* que si elle répond à une sortie qu'il a
  masquée (drapeau `outside`, remis à zéro au premier `mousemove`). Sans cette
  mémoire, le tout premier survol après chargement — lui aussi sans
  `relatedTarget` — serait bloqué et les effets de survol en JavaScript ne
  partiraient jamais.
- `beforeunload` est volontairement épargné : c'est l'alerte « modifications non
  enregistrées », utile à l'utilisateur.

**4. Aucune permission à l'installation.** Le manifeste ne déclare que
`storage`, `scripting`, `activeTab`, et des `optional_host_permissions`. Les
permissions hôtes sont demandées site par site depuis le popup. `chrome.permissions.request`
exige un geste utilisateur : l'appel doit partir du gestionnaire de clic **sans
aucun `await` avant lui**.

**5. `unthrottle` fonctionne par double armement.** Chaque échéance est armée à
la fois sur le timer natif et sur un tic de Web Worker. Le premier arrivé
désarme l'autre : onglet visible, le natif gagne toujours et la cadence reste
celle du navigateur ; onglet caché, le worker prend le relais. Les échéances
sont ancrées sur une horloge absolue (`entry.next`), sinon le coût de chaque
re-armement s'accumule et un `setInterval(250)` devient mesurablement lent.

## Ajouter un module

1. `rideau/src/shims/<id>.js`, IIFE autonome.
2. Entrée dans `MODULES` de `rideau/src/config.js` (`id`, `file`, `label`, `detail`).
3. Ajout aux niveaux voulus (`MINIMAL` / `BALANCED` / `STRICT`) dans le même fichier.
4. Un détecteur correspondant dans `site-test/detectors.js`, avec son champ
   `module` — sans quoi le module n'est pas testable.
5. Une sonde dans `FINGERPRINTS` de `site-test/app.js`, pour que le panneau
   d'empreinte montre si le module est en place.

Le service worker et les deux interfaces se mettent à jour tout seuls : ils
itèrent sur `MODULES`.

## Vérifier une modification

Pas de suite de tests automatisée. Deux niveaux :

**Contrôle rapide, sans installer l'extension.** Servez la racine du dépôt
(`python -m http.server 8001`), ouvrez `http://localhost:8001/site-test/` dans
un onglet, et injectez les shims dans la page :

```js
for (const f of ['spoof-visibility', 'mute-pointer' /* … */]) {
  new Function(await (await fetch('/rideau/src/shims/' + f + '.js')).text())();
}
document.getElementById('btn-reset').click();
```

Le panneau « Empreinte des APIs » doit passer de `intacte` à `remplacée`. Un
onglet d'arrière-plan est le meilleur banc d'essai : `rAF` y est réellement à
l'arrêt, `hasFocus()` réellement `false`.

Node étant absent, le contrôle de syntaxe passe aussi par le navigateur :
`new Function(source)` compile sans exécuter ; pour un module ES, un
`import()` échoue en `SyntaxError` si et seulement si le fichier est mal formé.

**Validation réelle.** `site-test/serve.cmd`, chargement de `rideau/` via
`brave://extensions` en mode développeur, puis les 5 scénarios guidés avant et
après. Après toute modification d'un fichier de l'extension, **rechargez
l'extension** : recharger la page ne suffit pas.

## Limite assumée

Le minuteur d'inactivité du banc de test (scénario 5) **doit** rester
détectable. Rideau masque le *départ*, pas l'*immobilité* ; le module de fausse
activité a été écarté délibérément. Ne le « corrigez » pas sans demander.
