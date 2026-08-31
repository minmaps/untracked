// Rideau - module "mute-lifecycle"
// Etouffe les signaux de mise en veille / dechargement de la page.
(() => {
  'use strict';

  // beforeunload est volontairement epargne : c'est lui qui produit l'alerte
  // "modifications non enregistrees", utile a l'utilisateur.
  const swallow = (event) => {
    event.stopImmediatePropagation();
  };
  for (const type of ['freeze', 'resume']) {
    window.addEventListener(type, swallow, true);
  }

  // Une page conservee dans le back-forward cache recoit pagehide, puis un
  // pageshow lors du retour. Masquer uniquement le depart laisserait passer un
  // signal de reprise sans signal d'aller, incoherence directement observable.
  // Le pageshow initial reste intact : on ne masque que celui qui repond a un
  // pagehide effectivement intercepte dans ce meme contexte JavaScript.
  let pageHidden = false;
  window.addEventListener(
    'pagehide',
    (event) => {
      pageHidden = true;
      event.stopImmediatePropagation();
    },
    true
  );
  window.addEventListener(
    'pageshow',
    (event) => {
      if (!pageHidden) return;
      pageHidden = false;
      event.stopImmediatePropagation();
    },
    true
  );

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
