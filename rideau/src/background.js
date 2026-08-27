// Rideau - service worker.
// Son unique role : traduire la liste blanche en enregistrements de content
// scripts. La configuration est ainsi PORTEE PAR L'ENREGISTREMENT lui-meme,
// ce qui evite d'avoir a la lire depuis le monde MAIN a document_start (ou
// chrome.storage est inaccessible et ou toute lecture asynchrone ouvrirait une
// fenetre pendant laquelle le site s'executerait sans protection).

import {
  MODULES,
  BRIDGE_ID,
  BRIDGE_FILE,
  effectiveModules,
  loadSettings,
  saveSettings,
  toOrigin,
  originPattern
} from './config.js';

const FILE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m.file]));

// Les appels s'enchainent : deux applications concurrentes se marcheraient
// dessus entre le diff et l'ecriture.
let chain = Promise.resolve();
function queueApply() {
  chain = chain.then(applyRegistrations).catch((err) => console.error('[Rideau]', err));
  return chain;
}

function buildSpec(id, matches) {
  const isBridge = id === BRIDGE_ID;
  return {
    id,
    js: [isBridge ? BRIDGE_FILE : FILE_BY_ID[id]],
    matches,
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: 'document_start',
    world: isBridge ? 'ISOLATED' : 'MAIN',
    persistAcrossSessions: true
  };
}

async function grantedOrigins(origins) {
  const out = [];
  for (const origin of origins) {
    try {
      if (await chrome.permissions.contains({ origins: [originPattern(origin)] })) out.push(origin);
    } catch {
      /* motif invalide : on ignore ce site */
    }
  }
  return out;
}

async function applyRegistrations() {
  const settings = await loadSettings();
  const origins = await grantedOrigins(Object.keys(settings.sites));

  // Un module actif sur zero origine doit etre DESENREGISTRE : l'API refuse
  // un enregistrement dont matches est vide.
  const wanted = new Map();
  for (const origin of origins) {
    const pattern = originPattern(origin);
    for (const id of effectiveModules(settings.sites[origin], settings.defaults)) {
      if (!FILE_BY_ID[id]) continue;
      if (!wanted.has(id)) wanted.set(id, []);
      wanted.get(id).push(pattern);
    }
  }
  // Le pont suit exactement le module qui s'en sert.
  if (wanted.has('unthrottle')) wanted.set(BRIDGE_ID, wanted.get('unthrottle').slice());

  const existing = await chrome.scripting.getRegisteredContentScripts();
  const existingIds = new Set(existing.map((s) => s.id));

  const toRegister = [];
  const toUpdate = [];
  for (const [id, matches] of wanted) {
    (existingIds.has(id) ? toUpdate : toRegister).push(buildSpec(id, matches));
  }
  const toRemove = [...existingIds].filter((id) => !wanted.has(id));

  if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
}

// Sans la permission "tabs", tab.url n'est lisible que sur les origines dont
// nous detenons la permission hote : le badge est donc naturellement vide
// partout ailleurs, ce qui est exactement le comportement voulu.
async function refreshBadge(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  const origin = toOrigin(tab.url);
  const settings = await loadSettings();
  const active = origin !== null && Object.prototype.hasOwnProperty.call(settings.sites, origin);
  try {
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
    if (active) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
  } catch {
    /* onglet disparu entre-temps */
  }
}

chrome.runtime.onInstalled.addListener(() => queueApply());
chrome.runtime.onStartup.addListener(() => queueApply());

// L'utilisateur peut retirer une permission depuis brave://extensions sans
// passer par notre interface : sans ce nettoyage, l'enregistrement echouerait
// au demarrage suivant.
chrome.permissions.onRemoved.addListener(async (permissions) => {
  const removed = new Set(permissions.origins || []);
  if (removed.size === 0) return;
  const settings = await loadSettings();
  let changed = false;
  for (const origin of Object.keys(settings.sites)) {
    if (removed.has(originPattern(origin))) {
      delete settings.sites[origin];
      changed = true;
    }
  }
  if (changed) await saveSettings(settings);
  queueApply();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status) refreshBadge(tabId);
});
chrome.tabs.onActivated.addListener(({ tabId }) => refreshBadge(tabId));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'rideau:apply') return false;
  queueApply()
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; // reponse asynchrone
});
