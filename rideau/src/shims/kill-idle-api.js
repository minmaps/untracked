// Rideau - module "kill-idle-api"
// Fait disparaitre l'API de detection d'inactivite systeme.
(() => {
  'use strict';

  if (!('IdleDetector' in window)) return;

  // delete reussit sur une propriete configurable du global : 'IdleDetector' in
  // window redevient false, exactement comme sur un navigateur sans l'API.
  try {
    delete window.IdleDetector;
  } catch {
    /* on tente le repli ci-dessous */
  }

  if ('IdleDetector' in window) {
    try {
      Object.defineProperty(window, 'IdleDetector', {
        configurable: true,
        enumerable: false,
        get() {
          return undefined;
        }
      });
    } catch {
      /* rien de plus a faire */
    }
  }
})();
