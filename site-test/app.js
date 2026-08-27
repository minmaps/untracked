import { DETECTORS, MODULE_LABELS } from './detectors.js';

const $ = (id) => document.getElementById(id);

// Un détecteur événementiel signale un instant, pas un état : son voyant
// retombe seul, sinon le verdict resterait « absent » pour toujours.
const MOMENTARY_RESET_MS = 4000;

const sessionStart = Date.now();
const entries = new Map();
let logLines = [];
let stopFns = [];
let renderQueued = false;

function initEntries() {
  entries.clear();
  for (const detector of DETECTORS) {
    entries.set(detector.id, {
      detector,
      triggered: false,
      episodes: 0,
      lastAt: null,
      lastReason: '',
      info: '',
      timer: null
    });
  }
}

function stamp(t) {
  const d = new Date(t);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds()) +
    '.' +
    pad(d.getMilliseconds(), 3)
  );
}

function addLog(level, source, message) {
  logLines.unshift({ t: Date.now(), level, source, message });
  if (logLines.length > 300) logLines.pop();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function makeCtx(detector) {
  const get = () => entries.get(detector.id);
  return {
    trip(reason) {
      const s = get();
      s.lastAt = Date.now();
      s.lastReason = reason;
      if (!s.triggered) {
        s.triggered = true;
        s.episodes += 1;
        addLog('alert', detector.name, reason);
      }
      if (detector.momentary) {
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
          s.triggered = false;
          scheduleRender();
        }, MOMENTARY_RESET_MS);
      }
      scheduleRender();
    },
    clear(reason) {
      const s = get();
      if (!s.triggered) return;
      s.triggered = false;
      s.lastReason = reason;
      clearTimeout(s.timer);
      addLog('ok', detector.name, reason);
      scheduleRender();
    },
    info(message) {
      const s = get();
      s.info = message;
      addLog('info', detector.name, message);
      scheduleRender();
    }
  };
}

function startAll() {
  stopFns = DETECTORS.map((detector) => detector.start(makeCtx(detector)) || (() => {}));
}

function stopAll() {
  for (const stop of stopFns) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  stopFns = [];
  for (const s of entries.values()) clearTimeout(s.timer);
}

// ---------------------------------------------------------------------------
// Empreinte des APIs : montre directement quels shims sont en place.
// ---------------------------------------------------------------------------

const isNative = (fn) => {
  try {
    return Function.prototype.toString.call(fn).includes('[native code]');
  } catch {
    return false;
  }
};

const accessorState = (target, prop) => {
  // Un shim definit sa propriete sur l'instance et masque donc celle du
  // prototype : on retient la premiere definition rencontree, exactement ce que
  // resoudrait une lecture de la propriete.
  for (let obj = target; obj; obj = Object.getPrototypeOf(obj)) {
    const d = Object.getOwnPropertyDescriptor(obj, prop);
    if (!d) continue;
    if (!d.get) return 'intacte';
    return isNative(d.get) ? 'intacte' : 'remplacée';
  }
  return 'absente';
};

const FINGERPRINTS = [
  { label: 'document.hasFocus()', module: 'spoof-focus', probe: () => (isNative(Document.prototype.hasFocus) ? 'intacte' : 'remplacée') },
  { label: 'document.hidden', module: 'spoof-visibility', probe: () => accessorState(Document.prototype, 'hidden') },
  { label: 'document.visibilityState', module: 'spoof-visibility', probe: () => accessorState(Document.prototype, 'visibilityState') },
  { label: 'document.onvisibilitychange', module: 'mute-visibility', probe: () => accessorState(document, 'onvisibilitychange') },
  { label: 'window.onblur', module: 'mute-focus', probe: () => accessorState(window, 'onblur') },
  { label: 'document.onmouseleave', module: 'mute-pointer', probe: () => accessorState(document, 'onmouseleave') },
  { label: 'window.onpagehide', module: 'mute-lifecycle', probe: () => accessorState(window, 'onpagehide') },
  { label: 'requestAnimationFrame', module: 'unthrottle', probe: () => (isNative(window.requestAnimationFrame) ? 'intacte' : 'remplacée') },
  { label: 'setTimeout', module: 'unthrottle', probe: () => (isNative(window.setTimeout) ? 'intacte' : 'remplacée') },
  { label: 'IdleDetector', module: 'kill-idle-api', probe: () => ('IdleDetector' in window ? 'intacte' : 'absente') }
];

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  const list = [...entries.values()];
  const active = list.filter((s) => s.triggered);
  const verdict = $('verdict');
  verdict.textContent = active.length ? 'Absent' : 'Présent';
  verdict.className = 'verdict ' + (active.length ? 'absent' : 'present');

  $('alerts').textContent = String(list.reduce((sum, s) => sum + s.episodes, 0));
  $('armed').textContent = String(DETECTORS.length);

  $('rows').replaceChildren(
    ...list.map((s) => {
      const tr = document.createElement('tr');
      if (s.triggered) tr.className = 'hit';

      const name = document.createElement('td');
      const title = document.createElement('strong');
      title.textContent = s.detector.name;
      const api = document.createElement('span');
      api.className = 'api';
      api.textContent = s.detector.api;
      const module = document.createElement('span');
      module.className = 'module';
      module.textContent = 'neutralisé par : ' + (MODULE_LABELS[s.detector.module] || s.detector.module);
      name.append(title, api, module);

      const state = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'pill ' + (s.triggered ? 'bad' : 'good');
      pill.textContent = s.triggered ? 'déclenché' : 'armé';
      state.append(pill);
      if (s.lastReason || s.info) {
        const why = document.createElement('span');
        why.className = 'why';
        why.textContent = s.lastReason || s.info;
        state.append(why);
      }

      const count = document.createElement('td');
      count.className = 'num';
      count.textContent = String(s.episodes);

      tr.append(name, state, count);
      return tr;
    })
  );

  $('log').replaceChildren(
    ...logLines.slice(0, 120).map((line) => {
      const li = document.createElement('li');
      li.className = line.level;
      const t = document.createElement('time');
      t.textContent = stamp(line.t);
      const src = document.createElement('b');
      src.textContent = line.source;
      const msg = document.createElement('span');
      msg.textContent = line.message;
      li.append(t, src, msg);
      return li;
    })
  );
}

function renderFingerprint() {
  $('fingerprint').replaceChildren(
    ...FINGERPRINTS.map((item) => {
      const state = item.probe();
      const li = document.createElement('li');
      const label = document.createElement('code');
      label.textContent = item.label;
      const pill = document.createElement('span');
      pill.className = 'pill ' + (state === 'intacte' ? 'neutral' : 'good');
      pill.textContent = state;
      li.append(label, pill);
      return li;
    })
  );
}

function tickClock() {
  const seconds = Math.floor((Date.now() - sessionStart) / 1000);
  $('elapsed').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Scénarios guidés
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: 'tab',
    title: 'Changer d’onglet',
    instruction: 'Passez sur un autre onglet, attendez 4 secondes, puis revenez ici.',
    duration: 10000
  },
  {
    id: 'mouse',
    title: 'Sortir la souris',
    instruction: 'Sortez le curseur de la fenêtre du navigateur pendant 4 secondes, sans changer d’onglet.',
    duration: 10000
  },
  {
    id: 'window',
    title: 'Cliquer sur une autre fenêtre',
    instruction: 'Cliquez sur une autre application. L’onglet reste visible mais perd le focus.',
    duration: 10000
  },
  {
    id: 'minimize',
    title: 'Réduire la fenêtre',
    instruction: 'Réduisez Brave, attendez 5 secondes, puis restaurez la fenêtre.',
    duration: 12000
  },
  {
    id: 'still',
    title: 'Rester immobile',
    instruction: 'Ne touchez plus ni souris ni clavier pendant 20 secondes. Restez sur la page.',
    duration: 22000
  }
];

const scenarioResults = new Map();
let running = null;

function renderScenarios() {
  $('scenarios').replaceChildren(
    ...SCENARIOS.map((scenario, index) => {
      const card = document.createElement('article');
      card.className = 'scenario';

      const h3 = document.createElement('h3');
      h3.textContent = index + 1 + '. ' + scenario.title;

      const p = document.createElement('p');
      p.textContent = scenario.instruction;

      const button = document.createElement('button');
      const isRunning = running && running.id === scenario.id;
      button.disabled = Boolean(running);
      button.textContent = isRunning ? running.remaining + ' s…' : 'Lancer';
      button.addEventListener('click', () => runScenario(scenario));

      card.append(h3, p, button);

      const result = scenarioResults.get(scenario.id);
      if (result) {
        const box = document.createElement('div');
        box.className = 'result ' + (result.fired.length ? 'bad' : 'good');
        const verdict = document.createElement('strong');
        verdict.textContent = result.fired.length
          ? 'Détecté par ' + result.fired.length + ' détecteur(s)'
          : 'Aucun détecteur n’a réagi';
        box.append(verdict);
        if (result.fired.length) {
          const ul = document.createElement('ul');
          for (const item of result.fired) {
            const li = document.createElement('li');
            li.textContent = item.name + ' (' + item.episodes + ')';
            ul.append(li);
          }
          box.append(ul);
        }
        card.append(box);
      }
      return card;
    })
  );
}

function runScenario(scenario) {
  if (running) return;
  const before = new Map([...entries].map(([id, s]) => [id, s.episodes]));
  const endsAt = Date.now() + scenario.duration;
  running = { id: scenario.id, remaining: Math.ceil(scenario.duration / 1000) };
  addLog('info', 'Scénario', scenario.title + ' — démarré');
  renderScenarios();

  // Décompte fondé sur l'horloge murale, jamais sur un compteur de tics : le
  // scénario reste juste même si les timers sont ralentis (extension inactive).
  const timer = setInterval(() => {
    const left = endsAt - Date.now();
    if (left > 0) {
      running.remaining = Math.ceil(left / 1000);
      renderScenarios();
      return;
    }
    clearInterval(timer);
    const fired = [];
    for (const [id, s] of entries) {
      const delta = s.episodes - (before.get(id) || 0);
      if (delta > 0) fired.push({ id, name: s.detector.name, module: s.detector.module, episodes: delta });
    }
    scenarioResults.set(scenario.id, { at: Date.now(), fired });
    addLog(
      fired.length ? 'alert' : 'ok',
      'Scénario',
      scenario.title + ' — ' + (fired.length ? fired.length + ' détecteur(s) ont réagi' : 'silence complet')
    );
    running = null;
    renderScenarios();
    render();
  }, 250);
}

// ---------------------------------------------------------------------------
// Rapport, réinitialisation, démarrage
// ---------------------------------------------------------------------------

function buildReport() {
  return {
    generatedAt: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    sessionSeconds: Math.round((Date.now() - sessionStart) / 1000),
    fingerprint: FINGERPRINTS.map((f) => ({ api: f.label, module: f.module, state: f.probe() })),
    detectors: [...entries.values()].map((s) => ({
      id: s.detector.id,
      name: s.detector.name,
      api: s.detector.api,
      neutralizedBy: s.detector.module || null,
      episodes: s.episodes,
      triggered: s.triggered,
      lastReason: s.lastReason || null,
      lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null
    })),
    scenarios: SCENARIOS.map((scenario) => {
      const result = scenarioResults.get(scenario.id);
      return {
        id: scenario.id,
        title: scenario.title,
        run: Boolean(result),
        detectedBy: result ? result.fired : null
      };
    }),
    log: logLines.map((l) => ({ at: new Date(l.t).toISOString(), level: l.level, source: l.source, message: l.message }))
  };
}

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildReport(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rapport-surveillance-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-reset').addEventListener('click', () => {
  stopAll();
  logLines = [];
  scenarioResults.clear();
  running = null;
  initEntries();
  startAll();
  renderFingerprint();
  renderScenarios();
  render();
  addLog('info', 'Banc', 'compteurs remis à zéro');
});

initEntries();
startAll();
renderFingerprint();
renderScenarios();
render();
addLog('info', 'Banc', DETECTORS.length + ' détecteurs armés');
setInterval(tickClock, 1000);
tickClock();
