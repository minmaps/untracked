// Rideau - source de tics pour le module "unthrottle".
// Les timers d'un Web Worker echappent au ralentissement applique aux pages
// d'arriere-plan : c'est ce qui permet de garder une cadence stable.
let handle = null;

self.onmessage = (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.cmd === 'start') {
    if (handle === null) {
      const period = typeof data.period === 'number' && data.period > 0 ? data.period : 4;
      handle = setInterval(() => {
        self.postMessage({ tick: 1 });
      }, period);
    }
  } else if (data.cmd === 'stop') {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  }
};
