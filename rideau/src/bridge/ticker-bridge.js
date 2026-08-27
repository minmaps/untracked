// Rideau - pont de tics (monde ISOLE).
// Injecte uniquement aux cotes du module "unthrottle". Sur les sites dont la
// CSP interdit les Workers issus d'un Blob, la page ne peut pas creer sa source
// de tics elle-meme. Le monde isole, lui, n'est pas soumis a la CSP de la page :
// il cree le worker depuis une URL chrome-extension:// et relaie les tics.
(() => {
  'use strict';

  let worker = null;
  let channel = null;
  let period = 8;

  const ensureWorker = () => {
    if (worker) return worker;
    try {
      worker = new Worker(chrome.runtime.getURL('src/shims/ticker-worker.js'));
      worker.onmessage = () => {
        if (channel) window.postMessage({ rideau: 'tick', channel }, '*');
      };
    } catch {
      worker = null;
    }
    return worker;
  };

  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || typeof d !== 'object' || typeof d.rideau !== 'string') return;

      if (d.rideau === 'hello') {
        channel = d.channel;
        window.postMessage({ rideau: 'ack', channel }, '*');
        return;
      }
      if (!channel || d.channel !== channel) return;

      if (d.rideau === 'start') {
        if (typeof d.period === 'number' && d.period > 0) period = d.period;
        const w = ensureWorker();
        if (w) w.postMessage({ cmd: 'start', period });
      } else if (d.rideau === 'stop') {
        if (worker) worker.postMessage({ cmd: 'stop' });
      }
    },
    true
  );

  // Le monde MAIN et le monde ISOLE sont injectes tous deux a document_start,
  // sans ordre garanti : chacun annonce sa presence, le premier arrive attend.
  window.postMessage({ rideau: 'bridge-ready' }, '*');
})();
