import {
  MODULES,
  PRESETS,
  effectiveModules,
  loadSettings,
  saveSettings,
  originPattern,
  normalizeConfig
} from '../config.js';

const $ = (id) => document.getElementById(id);
let settings = null;
let pendingOrigins = [];

function fail(err) {
  const el = $('error');
  el.textContent = String(err && err.message ? err.message : err);
  el.hidden = false;
}

async function apply() {
  await saveSettings(settings);
  const res = await chrome.runtime.sendMessage({ type: 'rideau:apply' });
  if (res && res.ok === false) fail(res.error);
}

function renderDefaults() {
  const enabled = effectiveModules(settings.defaults, settings.defaults);

  $('preset').replaceChildren(
    ...Object.entries(PRESETS).map(([name, preset]) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = preset.label + ' — ' + preset.detail;
      opt.selected = name === settings.defaults.preset;
      return opt;
    })
  );

  $('modules').replaceChildren(
    ...MODULES.map((module) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled.has(module.id);
      input.addEventListener('change', async () => {
        const next = { ...settings.defaults, overrides: { ...settings.defaults.overrides } };
        next.overrides[module.id] = input.checked;
        settings.defaults = normalizeConfig(next, settings.defaults);
        await apply();
        renderDefaults();
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
}

function renderSites() {
  const entries = Object.entries(settings.sites);
  $('count').textContent = String(entries.length);
  $('sites-empty').hidden = entries.length > 0;
  $('sites-table').hidden = entries.length === 0;

  $('sites').replaceChildren(
    ...entries.map(([origin, config]) => {
      const enabled = effectiveModules(config, settings.defaults);
      const tr = document.createElement('tr');

      const tdOrigin = document.createElement('td');
      tdOrigin.className = 'origin';
      tdOrigin.textContent = origin;

      const tdPreset = document.createElement('td');
      tdPreset.textContent = PRESETS[config.preset] ? PRESETS[config.preset].label : config.preset;

      const tdModules = document.createElement('td');
      tdModules.textContent = enabled.size + ' / ' + MODULES.length;

      const tdAction = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'remove';
      btn.textContent = 'Retirer';
      btn.addEventListener('click', () => {
        chrome.permissions
          .remove({ origins: [originPattern(origin)] })
          .catch(() => false)
          .then(async () => {
            delete settings.sites[origin];
            await apply();
            renderSites();
          })
          .catch(fail);
      });
      tdAction.append(btn);

      tr.append(tdOrigin, tdPreset, tdModules, tdAction);
      return tr;
    })
  );
}

$('preset').addEventListener('change', async (event) => {
  settings.defaults = { preset: event.target.value, overrides: {} };
  await apply();
  renderDefaults();
});

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rideau-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || typeof data.sites !== 'object') {
      throw new Error('Fichier de configuration invalide.');
    }
    settings.defaults = data.defaults || settings.defaults;
    settings.sites = data.sites;
    await apply();
    renderDefaults();
    renderSites();

    // Les permissions hote ne peuvent etre demandees que depuis un geste
    // utilisateur : la lecture du fichier a consomme le notre, on en demande
    // donc un nouveau via un bouton.
    pendingOrigins = Object.keys(settings.sites).map(originPattern);
    const missing = [];
    for (const pattern of pendingOrigins) {
      if (!(await chrome.permissions.contains({ origins: [pattern] }))) missing.push(pattern);
    }
    pendingOrigins = missing;
    $('import-status').textContent = missing.length
      ? 'Importé. ' + missing.length + ' domaine(s) attendent encore votre autorisation.'
      : 'Importé et actif.';
    $('import-status').hidden = false;
    $('btn-grant').hidden = missing.length === 0;
    $('btn-grant').textContent = 'Autoriser ' + missing.length + ' domaine(s)';
  } catch (err) {
    fail(err);
  } finally {
    event.target.value = '';
  }
});

$('btn-grant').addEventListener('click', () => {
  chrome.permissions
    .request({ origins: pendingOrigins })
    .then(async (granted) => {
      if (!granted) return;
      await apply();
      $('btn-grant').hidden = true;
      $('import-status').textContent = 'Importé et actif.';
    })
    .catch(fail);
});

(async () => {
  try {
    settings = await loadSettings();
    renderDefaults();
    renderSites();
  } catch (err) {
    fail(err);
  }
})();
