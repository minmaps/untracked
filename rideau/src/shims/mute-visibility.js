// Rideau - module "mute-visibility"
// Etouffe visibilitychange avant que le moindre code de la page ne le voie.
(() => {
  'use strict';

  // Ecouteur en phase de capture sur window : a document_start nous sommes
  // enregistres avant tout script du site, donc premiers dans l'ordre
  // window -> document -> cible. stopImmediatePropagation() coupe la suite,
  // y compris le handler document.onvisibilitychange (phase cible jamais atteinte).
  const swallow = (event) => {
    event.stopImmediatePropagation();
  };
  for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
    window.addEventListener(type, swallow, true);
  }

  // Un site peut aussi assigner directement le handler. On memorise la valeur
  // pour que la relecture reste coherente, mais on ne la cable jamais.
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
  neutralize(document, 'onvisibilitychange');
  neutralize(document, 'onwebkitvisibilitychange');
})();
