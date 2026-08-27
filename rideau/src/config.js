// Configuration partagée entre le service worker, le popup et la page d'options.
// Chaque module correspond à UN fichier de shim autonome, injecté en monde MAIN.

export const MODULES = [
  {
    id: 'spoof-visibility',
    file: 'src/shims/spoof-visibility.js',
    label: 'Mentir sur la visibilité',
    detail: "document.hidden reste false et document.visibilityState reste « visible »."
  },
  {
    id: 'mute-visibility',
    file: 'src/shims/mute-visibility.js',
    label: 'Étouffer visibilitychange',
    detail: "L'événement visibilitychange n'atteint jamais le code de la page."
  },
  {
    id: 'spoof-focus',
    file: 'src/shims/spoof-focus.js',
    label: 'Mentir sur le focus',
    detail: "document.hasFocus() renvoie toujours true, navigator.userActivation reste actif."
  },
  {
    id: 'mute-focus',
    file: 'src/shims/mute-focus.js',
    label: 'Étouffer blur / focus fenêtre',
    detail: "Bloque uniquement les blur/focus de la fenêtre. Ceux des champs de formulaire passent."
  },
  {
    id: 'mute-pointer',
    file: 'src/shims/mute-pointer.js',
    label: 'Étouffer la sortie de souris',
    detail: "Bloque mouseleave/mouseout/pointerleave seulement quand le curseur quitte la fenêtre."
  },
  {
    id: 'mute-lifecycle',
    file: 'src/shims/mute-lifecycle.js',
    label: 'Étouffer le cycle de vie',
    detail: "Bloque pagehide, freeze et resume ; document.wasDiscarded reste false."
  },
  {
    id: 'kill-idle-api',
    file: 'src/shims/kill-idle-api.js',
    label: 'Supprimer IdleDetector',
    detail: "L'API de détection d'inactivité disparaît, comme sur un navigateur qui ne la gère pas."
  },
  {
    id: 'unthrottle',
    file: 'src/shims/unthrottle.js',
    label: 'Anti-ralentissement des timers',
    detail: "Maintient la cadence de requestAnimationFrame et setTimeout/setInterval en arrière-plan. Coûte du CPU."
  }
];

export const MODULE_IDS = MODULES.map((m) => m.id);

export const BRIDGE_ID = 'ticker-bridge';
export const BRIDGE_FILE = 'src/bridge/ticker-bridge.js';

const MINIMAL = ['spoof-visibility', 'spoof-focus', 'kill-idle-api'];
const BALANCED = MINIMAL.concat(['mute-visibility', 'mute-focus', 'mute-pointer', 'mute-lifecycle']);
const STRICT = BALANCED.concat(['unthrottle']);

export const PRESETS = {
  minimal: { label: 'Minimal', modules: MINIMAL, detail: 'Mensonges passifs seulement, aucun événement bloqué.' },
  balanced: { label: 'Équilibré', modules: BALANCED, detail: 'Mensonges passifs + blocage des événements de départ.' },
  strict: { label: 'Strict', modules: STRICT, detail: "Tout, y compris l'anti-ralentissement des timers." },
  custom: { label: 'Personnalisé', modules: [], detail: 'Chaque module réglé à la main.' }
};

export const DEFAULT_PRESET = 'strict';

export const DEFAULT_SETTINGS = {
  version: 1,
  defaults: { preset: DEFAULT_PRESET, overrides: {} },
  sites: {}
};

/** Ensemble effectif de modules actifs pour une config de site. */
export function effectiveModules(siteConfig, defaults) {
  const base = siteConfig || defaults || DEFAULT_SETTINGS.defaults;
  const preset = PRESETS[base.preset] ? base.preset : DEFAULT_PRESET;
  const enabled = new Set(preset === 'custom' ? [] : PRESETS[preset].modules);
  const overrides = base.overrides || {};
  for (const id of MODULE_IDS) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      if (overrides[id]) enabled.add(id);
      else enabled.delete(id);
    }
  }
  return enabled;
}

/** Normalise une URL d'onglet en origine, ou null si la page n'est pas scriptable. */
export function toOrigin(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.origin;
}

/** Motif de correspondance / permission hôte pour une origine. */
export function originPattern(origin) {
  return origin.replace(/\/+$/, '') + '/*';
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings;
  if (!s || typeof s !== 'object') {
    return { version: 1, defaults: { preset: DEFAULT_PRESET, overrides: {} }, sites: {} };
  }
  // Une config venue d'un import manuel ou d'une version plus recente peut
  // nommer un niveau inconnu : on la ramene a une forme sure des la lecture,
  // plutot que de laisser chaque ecran s'en mefier.
  const sane = (config) => ({
    ...config,
    preset: PRESETS[config && config.preset] ? config.preset : DEFAULT_PRESET,
    overrides: config && config.overrides && typeof config.overrides === 'object' ? config.overrides : {}
  });

  const sites = {};
  if (s.sites && typeof s.sites === 'object') {
    for (const [origin, config] of Object.entries(s.sites)) {
      if (toOrigin(origin) === origin) sites[origin] = sane(config);
    }
  }
  return { version: 1, defaults: sane(s.defaults), sites };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/**
 * Range une config apres bascule d'un module : si l'ensemble obtenu correspond
 * exactement a un preset, on adopte ce preset plutot que d'accumuler des
 * exceptions, pour que l'interface reste lisible.
 */
export function normalizeConfig(config, defaults) {
  const enabled = effectiveModules(config, defaults);
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (name === 'custom') continue;
    if (preset.modules.length !== enabled.size) continue;
    if (preset.modules.every((id) => enabled.has(id))) {
      return { ...config, preset: name, overrides: {} };
    }
  }
  const overrides = {};
  for (const id of MODULE_IDS) overrides[id] = enabled.has(id);
  return { ...config, preset: 'custom', overrides };
}
