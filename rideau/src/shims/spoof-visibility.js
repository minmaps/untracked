// Rideau - module "spoof-visibility"
// Monde MAIN, document_start. La page voit un onglet eternellement visible.
(() => {
  'use strict';

  const fake = (proto, prop, value) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.configurable) return;
    try {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          return value;
        }
      });
    } catch {
      /* propriete verrouillee : on laisse le natif */
    }
  };

  // Les accesseurs vivent sur le prototype, pas sur l'instance : on redefinit la
  // pour couvrir aussi bien document.hidden que iframe.contentDocument.hidden.
  fake(Document.prototype, 'hidden', false);
  fake(Document.prototype, 'visibilityState', 'visible');
  fake(Document.prototype, 'webkitHidden', false);
  fake(Document.prototype, 'webkitVisibilityState', 'visible');

  // Page pre-rendue : certains sites s'en servent comme second avis.
  fake(Document.prototype, 'prerendering', false);
})();
