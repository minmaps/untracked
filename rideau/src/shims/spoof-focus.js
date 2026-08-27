// Rideau - module "spoof-focus"
// La page croit detenir le focus en permanence.
(() => {
  'use strict';

  try {
    Object.defineProperty(Document.prototype, 'hasFocus', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function hasFocus() {
        return true;
      }
    });
  } catch {
    /* non redefinissable */
  }

  // navigator.userActivation : "l'utilisateur a interagi recemment".
  // Certains scripts s'en servent comme detecteur d'inactivite.
  const proto = typeof UserActivation !== 'undefined' ? UserActivation.prototype : null;
  if (proto) {
    for (const prop of ['isActive', 'hasBeenActive']) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.configurable) continue;
      try {
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: d.enumerable,
          get() {
            return true;
          }
        });
      } catch {
        /* ignore */
      }
    }
  }
})();
