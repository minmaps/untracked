// Sonde exécutée dans un cadre imbriqué : rejoue un sous-ensemble des
// détecteurs et remonte ses conclusions au parent. Si l'extension oubliait
// allFrames, ce cadre trahirait le départ que la page principale masque.
import { DETECTORS, FRAME_GAP_MS } from './detectors.js';

const WATCHED = new Set(['visibility-event', 'has-focus-poll', 'mouse-exit', 'raf-gap']);

const stateEl = document.getElementById('state');
const lastEl = document.getElementById('last');
let tripped = 0;

const report = (kind, reason) => {
  parent.postMessage({ rideauTest: 'frame', kind, reason }, '*');
};

const render = () => {
  stateEl.textContent = tripped ? 'départ détecté' : 'calme';
  stateEl.classList.toggle('tripped', tripped > 0);
};

for (const detector of DETECTORS) {
  if (!WATCHED.has(detector.id)) continue;
  detector.start({
    trip(reason) {
      tripped += 1;
      lastEl.textContent = detector.name + ' — ' + reason;
      render();
      report('trip', detector.name + ' — ' + reason);
    },
    clear() {
      render();
    },
    info(message) {
      lastEl.textContent = detector.name + ' — ' + message;
    }
  });
}

// Le seuil d'écart entre images est repris tel quel : la sonde doit se
// comporter exactement comme la page hôte.
lastEl.textContent = 'sonde armée (seuil image : ' + FRAME_GAP_MS + ' ms)';
report('ready');
render();
