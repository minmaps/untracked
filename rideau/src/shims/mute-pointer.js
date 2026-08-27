// Rideau - module "mute-pointer"
// Etouffe la sortie du curseur hors de la fenetre, sans toucher au survol interne.
(() => {
  'use strict';

  const LEAVING = ['mouseleave', 'mouseout', 'pointerleave', 'pointerout'];
  const ENTERING = ['mouseenter', 'mouseover', 'pointerenter', 'pointerover'];

  // La signature d'une traversee de la frontiere du viewport est l'ABSENCE
  // d'element lie : un deplacement interne va toujours d'un element vers un
  // autre, donc relatedTarget est renseigne. La cible, elle, ne dit rien -
  // mouseout part de l'element survole au moment de la sortie (une cellule, un
  // bouton) et remonte ensuite jusqu'a document.
  const crossesBoundary = (event) => event.relatedTarget == null;

  // Une entree n'est etouffee que si elle repond a une sortie que nous avons
  // masquee. Sans cette memoire, on bloquerait aussi le tout premier survol
  // apres le chargement - lui aussi depourvu de relatedTarget - et les effets
  // de survol pilotes en JavaScript ne partiraient jamais.
  let outside = false;

  const onLeaving = (event) => {
    if (!crossesBoundary(event)) return;
    outside = true;
    event.stopImmediatePropagation();
  };

  const onEntering = (event) => {
    if (!outside || !crossesBoundary(event)) return;
    event.stopImmediatePropagation();
  };

  for (const type of LEAVING) window.addEventListener(type, onLeaving, true);
  for (const type of ENTERING) window.addEventListener(type, onEntering, true);

  // mousemove ne se produit que curseur a l'interieur : c'est le signal le plus
  // sur pour considerer la rentree terminee. Il arrive apres la rafale
  // d'evenements d'entree, qui sont donc tous couverts.
  window.addEventListener(
    'mousemove',
    () => {
      outside = false;
    },
    true
  );

  const neutralize = (target, prop) => {
    if (!(prop in target)) return;
    let stored = null;
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: true,
        get() {
          return stored;
        },
        set(v) {
          stored = typeof v === 'function' ? v : null;
        }
      });
    } catch {
      /* non redefinissable */
    }
  };
  for (const prop of ['onmouseleave', 'onmouseout', 'onpointerleave', 'onpointerout']) {
    neutralize(document, prop);
    neutralize(window, prop);
  }
})();
