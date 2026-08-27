// Banc de detection de presence.
// Chaque entree reproduit une technique reellement employee par des sites de
// mesure d'engagement, de proctoring ou d'anti-triche. Le champ "module"
// indique quel module de l'extension Rideau est cense la neutraliser.

export const IDLE_MS = 15000;
export const ACTIVATION_MS = 10000;
export const FRAME_GAP_MS = 500;
export const DRIFT_MS = 900;

export const MODULE_LABELS = {
  'spoof-visibility': 'Mentir sur la visibilité',
  'mute-visibility': 'Étouffer visibilitychange',
  'spoof-focus': 'Mentir sur le focus',
  'mute-focus': 'Étouffer blur / focus',
  'mute-pointer': 'Étouffer la sortie de souris',
  'mute-lifecycle': 'Étouffer le cycle de vie',
  'kill-idle-api': 'Supprimer IdleDetector',
  unthrottle: 'Anti-ralentissement',
  '': 'Aucun (limite connue)'
};

export const DETECTORS = [
  {
    id: 'visibility-event',
    momentary: true,
    name: 'Événement visibilitychange',
    api: "document.addEventListener('visibilitychange')",
    module: 'mute-visibility',
    start(ctx) {
      const onChange = () => {
        // Recevoir l'événement suffit : c'est lui le signal de départ.
        ctx.trip('événement reçu, état lu : ' + document.visibilityState);
      };
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    }
  },
  {
    id: 'visibility-poll',
    name: 'Sondage de visibilityState',
    api: 'document.visibilityState / document.hidden',
    module: 'spoof-visibility',
    start(ctx) {
      const id = setInterval(() => {
        if (document.hidden || document.visibilityState !== 'visible') {
          ctx.trip('visibilityState = ' + document.visibilityState);
        } else {
          ctx.clear('visibilityState = visible');
        }
      }, 250);
      return () => clearInterval(id);
    }
  },
  {
    id: 'window-focus',
    name: 'Perte de focus de la fenêtre',
    api: "window.addEventListener('blur' / 'focus')",
    module: 'mute-focus',
    start(ctx) {
      const onBlur = () => ctx.trip('blur sur window');
      const onFocus = () => ctx.clear('focus sur window');
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
      return () => {
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onFocus);
      };
    }
  },
  {
    id: 'has-focus-poll',
    name: 'Sondage de document.hasFocus()',
    api: 'document.hasFocus()',
    module: 'spoof-focus',
    start(ctx) {
      const id = setInterval(() => {
        if (!document.hasFocus()) ctx.trip('hasFocus() = false');
        else ctx.clear('hasFocus() = true');
      }, 250);
      return () => clearInterval(id);
    }
  },
  {
    id: 'mouse-exit',
    name: 'Souris hors de la fenêtre',
    api: 'mouseleave / mouseout sur document',
    module: 'mute-pointer',
    start(ctx) {
      const onLeave = () => ctx.trip('mouseleave sur document');
      const onOut = (event) => {
        if (event.relatedTarget == null) ctx.trip('mouseout sans relatedTarget');
      };
      const onEnter = () => ctx.clear('mouseenter sur document');
      document.addEventListener('mouseleave', onLeave);
      document.addEventListener('mouseout', onOut);
      document.addEventListener('mouseenter', onEnter);
      return () => {
        document.removeEventListener('mouseleave', onLeave);
        document.removeEventListener('mouseout', onOut);
        document.removeEventListener('mouseenter', onEnter);
      };
    }
  },
  {
    id: 'pointer-exit',
    name: 'Pointeur hors de la page',
    api: 'pointerleave sur documentElement',
    module: 'mute-pointer',
    start(ctx) {
      const root = document.documentElement;
      const onLeave = () => ctx.trip('pointerleave sur <html>');
      const onEnter = () => ctx.clear('pointerenter sur <html>');
      root.addEventListener('pointerleave', onLeave);
      root.addEventListener('pointerenter', onEnter);
      return () => {
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointerenter', onEnter);
      };
    }
  },
  {
    id: 'idle-timer',
    name: 'Minuteur d’inactivité',
    api: 'mousemove / keydown / scroll + horloge',
    module: '',
    start(ctx) {
      let last = Date.now();
      const bump = () => {
        last = Date.now();
        ctx.clear('activité détectée');
      };
      const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart', 'wheel'];
      for (const type of events) window.addEventListener(type, bump, { passive: true });
      const id = setInterval(() => {
        const idle = Date.now() - last;
        if (idle >= IDLE_MS) ctx.trip('aucune activité depuis ' + Math.round(idle / 1000) + ' s');
      }, 500);
      return () => {
        clearInterval(id);
        for (const type of events) window.removeEventListener(type, bump);
      };
    }
  }
];

DETECTORS.push(
  {
    id: 'raf-gap',
    momentary: true,
    name: 'Écart entre images (rAF)',
    api: 'requestAnimationFrame',
    module: 'unthrottle',
    start(ctx) {
      let last = performance.now();
      let alive = true;
      const tick = (now) => {
        if (!alive) return;
        const gap = now - last;
        last = now;
        if (gap > FRAME_GAP_MS) ctx.trip('image manquante pendant ' + Math.round(gap) + ' ms');
        else if (gap < 120) ctx.clear('cadence normale (' + Math.round(gap) + ' ms)');
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return () => {
        alive = false;
      };
    }
  },
  {
    id: 'interval-drift',
    momentary: true,
    name: 'Dérive de setInterval',
    api: 'setInterval(250 ms) + performance.now()',
    module: 'unthrottle',
    start(ctx) {
      let last = performance.now();
      const id = setInterval(() => {
        const now = performance.now();
        const delta = now - last;
        last = now;
        // Chromium plafonne les timers d'un onglet cache a 1 Hz : une periode
        // de 250 ms qui met une seconde a revenir trahit l'arriere-plan.
        if (delta > DRIFT_MS) ctx.trip('période de 250 ms étirée à ' + Math.round(delta) + ' ms');
        else if (delta < 400) ctx.clear('période tenue (' + Math.round(delta) + ' ms)');
      }, 250);
      return () => clearInterval(id);
    }
  },
  {
    id: 'lifecycle',
    momentary: true,
    name: 'Cycle de vie de la page',
    api: 'pagehide / freeze / resume',
    module: 'mute-lifecycle',
    start(ctx) {
      const make = (type) => () => ctx.trip('événement ' + type);
      const handlers = { pagehide: make('pagehide'), freeze: make('freeze'), resume: make('resume') };
      for (const [type, fn] of Object.entries(handlers)) window.addEventListener(type, fn);
      return () => {
        for (const [type, fn] of Object.entries(handlers)) window.removeEventListener(type, fn);
      };
    }
  },
  {
    id: 'user-activation',
    name: 'Activation utilisateur',
    api: 'navigator.userActivation.isActive',
    module: 'spoof-focus',
    start(ctx) {
      if (!navigator.userActivation) {
        ctx.info('API non disponible sur ce navigateur');
        return () => {};
      }
      let inactiveSince = Date.now();
      const id = setInterval(() => {
        if (navigator.userActivation.isActive) {
          inactiveSince = Date.now();
          ctx.clear('activation transitoire présente');
        } else if (Date.now() - inactiveSince >= ACTIVATION_MS) {
          ctx.trip('isActive = false depuis plus de ' + ACTIVATION_MS / 1000 + ' s');
        }
      }, 500);
      return () => clearInterval(id);
    }
  },
  {
    id: 'idle-detector',
    name: 'API IdleDetector',
    api: 'new IdleDetector()',
    module: 'kill-idle-api',
    start(ctx) {
      if (!('IdleDetector' in window)) {
        ctx.info('API absente : neutralisée, ou non gérée par ce navigateur');
        return () => {};
      }
      ctx.info('API présente — armez-la pour tester');
      return () => {};
    },
    action: {
      label: 'Armer IdleDetector',
      async run(ctx) {
        if (!('IdleDetector' in window)) {
          ctx.info('API absente : rien à armer');
          return;
        }
        const state = await IdleDetector.requestPermission();
        if (state !== 'granted') {
          ctx.info('permission refusée');
          return;
        }
        const detector = new IdleDetector();
        detector.addEventListener('change', () => {
          if (detector.userState === 'idle' || detector.screenState === 'locked') {
            ctx.trip('userState = ' + detector.userState + ', screenState = ' + detector.screenState);
          } else {
            ctx.clear('utilisateur actif');
          }
        });
        await detector.start({ threshold: 60000 });
        ctx.info('armé (seuil 60 s)');
      }
    }
  },
  {
    id: 'iframe-probe',
    momentary: true,
    name: 'Sonde dans une iframe',
    api: 'même batterie, exécutée dans un cadre imbriqué',
    module: 'toute la couverture allFrames',
    start(ctx) {
      const onMessage = (event) => {
        const d = event.data;
        if (!d || d.rideauTest !== 'frame') return;
        if (d.kind === 'trip') ctx.trip('dans l’iframe — ' + d.reason);
        else if (d.kind === 'clear') ctx.clear('iframe revenue au calme');
        else if (d.kind === 'ready') ctx.info('sonde chargée');
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }
  }
);
