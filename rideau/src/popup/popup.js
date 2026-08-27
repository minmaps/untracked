import {
  MODULES,
  PRESETS,
  effectiveModules,
  loadSettings,
  saveSettings,
  toOrigin,
  originPattern,
  normalizeConfig
} from '../config.js';

const $ = (id) => document.getElementById(id);
const views = {
  unsupported: $('view-unsupported'),
  off: $('view-off'),
  on: $('view-on')
};

let tabId = null;
let origin = null;
let settings = null;

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function fail(err) {
  const el = $('error');
  el.textContent = String(err && err.message ? err.message : err);
  el.hidden = false;
}

function needsReload() {
  $('reload-hint').hidden = false;
}

function siteConfig() {
  return settings.sites[origin];
}

async function persist(config) {
  settings.sites[origin] = config;
  await saveSettings(settings);
  const res = await chrome.runtime.sendMessage({ type: 'rideau:apply' });
  if (res && res.ok === false) fail(res.error);
  needsReload();
}

function renderProtected() {
  const config = siteConfig();
  const enabled = effectiveModules(config, settings.defaults);

  const select = $('preset');
  select.replaceChildren(
    ...Object.entries(PRESETS).map(([name, preset]) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = preset.label;
      opt.selected = name === config.preset;
      return opt;
    })
  );
  $('preset-detail').textContent = PRESETS[config.preset].detail;
  $('modules-count').textContent = String(enabled.size);

  $('modules').replaceChildren(
    ...MODULES.map((module) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled.has(module.id);
      input.addEventListener('change', async () => {
        const next = { ...siteConfig(), overrides: { ...(siteConfig().overrides || {}) } };
        next.overrides[module.id] = input.checked;
        await persist(normalizeConfig(next, settings.defaults));
        renderProtected();
      });
      const text = document.createElement('span');
      text.append(module.label);
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = module.detail;
      text.append(detail);
      label.append(input, text);
      li.append(label);
      return li;
    })
  );

  show('on');
}

$('preset').addEventListener('change', async (event) => {
  await persist({ ...siteConfig(), preset: event.target.value, overrides: {} });
  renderProtected();
});

// chrome.permissions.request exige un geste utilisateur : l'appel doit partir
// du gestionnaire de clic sans le moindre await avant lui.
$('btn-protect').addEventListener('click', () => {
  chrome.permissions
    .request({ origins: [originPattern(origin)] })
    .then(async (granted) => {
      if (!granted) return;
      settings.sites[origin] = {
        preset: settings.defaults.preset,
        overrides: { ...settings.defaults.overrides },
        addedAt: Date.now()
      };
      await saveSettings(settings);
      const res = await chrome.runtime.sendMessage({ type: 'rideau:apply' });
      if (res && res.ok === false) fail(res.error);
      renderProtected();
      needsReload();
    })
    .catch(fail);
});

$('btn-forget').addEventListener('click', () => {
  chrome.permissions
    .remove({ origins: [originPattern(origin)] })
    .catch(() => false)
    .then(async () => {
      delete settings.sites[origin];
      await saveSettings(settings);
      await chrome.runtime.sendMessage({ type: 'rideau:apply' });
      show('off');
      needsReload();
    })
    .catch(fail);
});

$('btn-reload').addEventListener('click', () => {
  if (tabId !== null) chrome.tabs.reload(tabId);
  window.close();
});

$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    origin = toOrigin(tab && tab.url);
    settings = await loadSettings();

    $('origin').textContent = origin || (tab && tab.url) || '—';
    if (!origin) return show('unsupported');
    if (Object.prototype.hasOwnProperty.call(settings.sites, origin)) return renderProtected();
    show('off');
  } catch (err) {
    fail(err);
  }
})();
