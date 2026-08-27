// Rideau - module "mute-lifecycle"
// Etouffe les signaux de mise en veille / dechargement de la page.
(() => {
  'use strict';

  // beforeunload est volontairement epargne : c'est lui qui produit l'alerte
  // "modifications non enregistrees", utile a l'utilisateur.
  const swallow = (event) => {
    event.stopImmediatePropagation();
  };
  for (const type of ['pagehide', 'freeze', 'resume']) {
    window.addEventListener(type, swallow, true);
  }

  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'wasDiscarded');
  if (d && d.configurable) {
    try {
      Object.defineProperty(Document.prototype, 'wasDiscarded', {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          return false;
        }
      });
    } catch {
      /* ignore */
    }
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
  neutralize(window, 'onpagehide');
  neutralize(document, 'onfreeze');
  neutralize(document, 'onresume');
})();
