// Rideau - module "unthrottle"
// Chromium arrete requestAnimationFrame et plafonne setTimeout/setInterval a
// 1 Hz dans un onglet d'arriere-plan. Un site mesure cet ecart pour deduire
// que vous etes parti, meme si document.hidden lui ment.
//
// Principe : DOUBLE ARMEMENT. Chaque echeance est armee a la fois sur le timer
// natif et sur un tic de Web Worker (non ralenti). Le premier arrive gagne et
// desarme l'autre. Onglet visible -> le natif gagne toujours, la cadence reste
// exactement celle du navigateur. Onglet cache -> le natif se tait, le worker
// prend le relais sans le moindre trou.
(() => {
  'use strict';

  const W = window;

  const nativeRAF = W.requestAnimationFrame;
  const nativeCAF = W.cancelAnimationFrame;
  const nativeSetTimeout = W.setTimeout;
  const nativeClearTimeout = W.clearTimeout;
  const nativeSetInterval = W.setInterval;
  const nativeClearInterval = W.clearInterval;

  if (typeof nativeRAF !== 'function' || typeof nativeSetTimeout !== 'function') return;

  const nowMs = () => performance.now();

  // Une exception dans un callback ne doit pas interrompre la boucle, mais doit
  // rester visible en console : on la relance dans une tache separee.
  const reportError = (err) => {
    nativeSetTimeout.call(W, () => {
      throw err;
    }, 0);
  };

  // =====================================================================
  // Source de tics non ralentie
  // =====================================================================

  const TICK_PERIOD = 8;
  const CHANNEL = 'rideau-' + Math.random().toString(36).slice(2, 10);

  const ticker = (() => {
    const waiters = new Map();
    let nextId = 1;
    let sources = null;
    let running = false;

    const fire = () => {
      if (waiters.size === 0) {
        stop();
        return;
      }
      const t = nowMs();
      let due = null;
      for (const entry of waiters) {
        if (t >= entry[1].due) (due || (due = [])).push(entry);
      }
      if (!due) return;
      for (const pair of due) {
        const id = pair[0];
        const w = pair[1];
        if (w.repeat) w.due = t + w.delay;
        else waiters.delete(id);
        try {
          w.fn();
        } catch (err) {
          reportError(err);
        }
      }
      if (waiters.size === 0) stop();
    };

    // 1er choix : Worker cree depuis un Blob, dans le monde de la page.
    const blobSource = () => {
      try {
        const src =
          'let h=null;self.onmessage=function(e){var d=e.data;if(!d)return;' +
          'if(d.cmd==="start"){if(h===null)h=setInterval(function(){self.postMessage(1);},d.period);}' +
          'else if(d.cmd==="stop"){clearInterval(h);h=null;}};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = fire;
        return {
          start: () => worker.postMessage({ cmd: 'start', period: TICK_PERIOD }),
          stop: () => worker.postMessage({ cmd: 'stop' })
        };
      } catch {
        // CSP worker-src stricte : on passera par le pont.
        return null;
      }
    };

    // 2e choix : le content script en monde isole possede le worker et relaie
    // les tics. Le monde isole n'est pas soumis a la CSP de la page.
    const bridgeSource = () => {
      let ready = false;
      let wanted = false;
      const send = (rideau, extra) => {
        W.postMessage(Object.assign({ rideau, channel: CHANNEL }, extra || {}), '*');
      };
      W.addEventListener(
        'message',
        (event) => {
          if (event.source !== W) return;
          const d = event.data;
          if (!d || typeof d !== 'object' || typeof d.rideau !== 'string') return;
          if (d.rideau === 'bridge-ready') {
            send('hello');
            return;
          }
          if (d.channel !== CHANNEL) return;
          if (d.rideau === 'ack') {
            ready = true;
            if (wanted) send('start', { period: TICK_PERIOD });
          } else if (d.rideau === 'tick') {
            fire();
          }
        },
        true
      );
      send('hello');
      return {
        start: () => {
          wanted = true;
          if (ready) send('start', { period: TICK_PERIOD });
        },
        stop: () => {
          wanted = false;
          if (ready) send('stop');
        }
      };
    };

    // Filet de securite : exact tant que l'onglet est visible, ralenti sinon.
    // Garantit un comportement au pire identique a l'absence de module.
    const nativeSource = () => {
      let handle = 0;
      return {
        start: () => {
          if (!handle) handle = nativeSetInterval.call(W, fire, TICK_PERIOD);
        },
        stop: () => {
          if (handle) {
            nativeClearInterval.call(W, handle);
            handle = 0;
          }
        }
      };
    };

    const ensureSources = () => {
      if (sources) return;
      sources = [blobSource() || bridgeSource(), nativeSource()].filter(Boolean);
    };

    const start = () => {
      if (running) return;
      ensureSources();
      running = true;
      for (const s of sources) s.start();
    };

    function stop() {
      if (!running) return;
      running = false;
      for (const s of sources) s.stop();
    }

    return {
      after: (delay, fn) => {
        const id = nextId++;
        waiters.set(id, { due: nowMs() + delay, delay, fn, repeat: false });
        start();
        return id;
      },
      clear: (id) => {
        waiters.delete(id);
      }
    };
  })();

  // =====================================================================
  // requestAnimationFrame
  // =====================================================================

  // Le bras de secours est volontairement plus lent qu'une image a 60 Hz :
  // tant que le rAF natif vit, il gagne toujours et rien ne change. Une fois
  // l'onglet cache, ces ~30 images/s passent largement sous les seuils de
  // detection (typiquement 500 ms d'ecart entre deux images).
  const FRAME_FALLBACK = 32;

  let rafSeq = 1000000000;
  let pendingFrames = new Map();
  let frameScheduled = false;
  let frameNativeId = 0;
  let frameToken = null;

  const disarmFrame = () => {
    if (frameNativeId) {
      try {
        nativeCAF.call(W, frameNativeId);
      } catch {
        /* ignore */
      }
      frameNativeId = 0;
    }
    if (frameToken !== null) {
      ticker.clear(frameToken);
      frameToken = null;
    }
  };

  const runFrame = () => {
    if (!frameScheduled) return;
    frameScheduled = false;
    disarmFrame();
    const batch = pendingFrames;
    pendingFrames = new Map();
    const ts = nowMs();
    for (const cb of batch.values()) {
      try {
        cb(ts);
      } catch (err) {
        reportError(err);
      }
    }
    if (pendingFrames.size) scheduleFrame();
  };

  function scheduleFrame() {
    if (frameScheduled) return;
    frameScheduled = true;
    try {
      frameNativeId = nativeRAF.call(W, () => {
        frameNativeId = 0;
        runFrame();
      });
    } catch {
      frameNativeId = 0;
    }
    frameToken = ticker.after(FRAME_FALLBACK, () => {
      frameToken = null;
      runFrame();
    });
  }

  const patchedRAF = function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Failed to execute requestAnimationFrame: parameter 1 is not a Function.');
    }
    const id = ++rafSeq;
    pendingFrames.set(id, callback);
    scheduleFrame();
    return id;
  };

  const patchedCAF = function cancelAnimationFrame(handle) {
    if (pendingFrames.delete(handle)) return;
    try {
      nativeCAF.call(W, handle);
    } catch {
      /* ignore */
    }
  };

  W.requestAnimationFrame = patchedRAF;
  W.cancelAnimationFrame = patchedCAF;
  if ('webkitRequestAnimationFrame' in W) {
    W.webkitRequestAnimationFrame = patchedRAF;
    W.webkitCancelAnimationFrame = patchedCAF;
  }

  // =====================================================================
  // setTimeout / setInterval
  // =====================================================================

  // Au-dela d'une seconde, le plafonnement de Chromium ne change plus rien de
  // mesurable : on laisse ces echeances au natif pour ne rien couter.
  const MAX_MANAGED_DELAY = 1000;
  const TICK_MARGIN = TICK_PERIOD;

  let timerSeq = 2000000000;
  const timers = new Map();

  const disarmTimer = (entry) => {
    if (entry.nativeId) {
      nativeClearTimeout.call(W, entry.nativeId);
      entry.nativeId = 0;
    }
    if (entry.token !== null) {
      ticker.clear(entry.token);
      entry.token = null;
    }
  };

  // L'attente est recalculee depuis l'echeance absolue : sans cela, le cout de
  // chaque re-armement s'accumulerait et un setInterval(250) finirait par tourner
  // sensiblement trop lentement - une signature mesurable par le site.
  const armTimer = (entry) => {
    const wait = Math.max(0, entry.next - nowMs());
    entry.nativeId = nativeSetTimeout.call(
      W,
      () => {
        entry.nativeId = 0;
        entry.fire();
      },
      wait
    );
    entry.token = ticker.after(wait + TICK_MARGIN, () => {
      entry.token = null;
      entry.fire();
    });
  };

  const createTimer = (handler, delay, args, repeat) => {
    const id = ++timerSeq;
    const entry = { id, delay, next: nowMs() + delay, nativeId: 0, token: null, fire: null };
    entry.fire = () => {
      disarmTimer(entry);
      // Un intervalle est une chaine de delais re-armes : cela evite qu'un
      // setInterval natif et un tic worker declenchent deux fois la meme periode.
      if (repeat) {
        const t = nowMs();
        entry.next += delay;
        // Retard important (onglet gele) : on repart de maintenant plutot que
        // de rattraper les periodes manquees en rafale.
        if (entry.next <= t) entry.next = t + delay;
        armTimer(entry);
      } else {
        timers.delete(id);
      }
      try {
        handler.apply(W, args);
      } catch (err) {
        reportError(err);
      }
    };
    timers.set(id, entry);
    armTimer(entry);
    return id;
  };

  // La forme setTimeout("du code") garde la semantique native, tout comme les
  // delais aberrants : on ne s'en melange pas.
  const shouldManage = (handler, delay) => {
    if (typeof handler !== 'function') return false;
    const ms = Number(delay);
    if (Number.isNaN(ms)) return true;
    return ms >= 0 && ms <= MAX_MANAGED_DELAY;
  };

  W.setTimeout = function setTimeout(handler, delay, ...args) {
    if (!shouldManage(handler, delay)) return nativeSetTimeout.call(W, handler, delay, ...args);
    return createTimer(handler, Number(delay) || 0, args, false);
  };

  W.setInterval = function setInterval(handler, delay, ...args) {
    if (!shouldManage(handler, delay)) return nativeSetInterval.call(W, handler, delay, ...args);
    return createTimer(handler, Number(delay) || 0, args, true);
  };

  W.clearTimeout = function clearTimeout(id) {
    const entry = timers.get(id);
    if (entry) {
      disarmTimer(entry);
      timers.delete(id);
      return;
    }
    nativeClearTimeout.call(W, id);
  };

  W.clearInterval = function clearInterval(id) {
    const entry = timers.get(id);
    if (entry) {
      disarmTimer(entry);
      timers.delete(id);
      return;
    }
    nativeClearInterval.call(W, id);
  };
})();
