// Rideau - module "mute-focus"
// Etouffe la perte et la reprise de focus AU NIVEAU FENETRE UNIQUEMENT.
(() => {
  'use strict';

  // Un blur sur un <input> remonte lui aussi en capture par window : le bloquer
  // casserait toute validation de formulaire. On ne filtre donc que les
  // evenements dont la cible est la fenetre ou le document.
  const isWindowLevel = (event) => event.target === window || event.target === document;

  const swallow = (event) => {
    if (isWindowLevel(event)) event.stopImmediatePropagation();
  };

  // blur ET focus : ne bloquer que le premier laisserait le site observer un
  // retour de focus sans depart, incoherence facilement detectable.
  for (const type of ['blur', 'focus']) {
    window.addEventListener(type, swallow, true);
  }

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
  neutralize(window, 'onblur');
  neutralize(window, 'onfocus');
})();
