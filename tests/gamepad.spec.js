// Gamepad e volante (Gamepad API) con un controller finto: navigator.getGamepads restituisce un oggetto che la prova
// cambia a mano. Alla fine il controller sparisce e l'impostazione salvata si cancella: la pagina del worker la
// riusano le altre prove (il giro guidato non deve trovare un gamepad che sterza).
import { test, expect, avviaCorsa } from './gioco.js';

// collega un controller finto (mapping 'standard' o '' per volanti e pedaliere)
async function collega(pagina, { id, mapping, axes }) {
  await pagina.evaluate(({ id, mapping, axes }) => {
    window.__padProva = { id, index: 0, connected: true, mapping, axes, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__padProva] });
  }, { id, mapping, axes });
}

async function scollega(pagina) {
  await pagina.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
    window.__game.pad.poll(1 / 30);
    try { localStorage.removeItem('padova-bus-sim-volante'); } catch (e) { /* ignorato */ }
    window.__game.pad.cal = {};
  });
}

test('gamepad standard: levetta, grilletti e pulsanti', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'free' });
  await collega(pagina, { id: 'Gamepad di prova (STANDARD GAMEPAD Vendor: 0000)', mapping: 'standard', axes: [0, 0, 0, 0] });
  try {
    const stato = await pagina.evaluate(() => {
      const g = window.__game, P = window.__padProva, b = g.bus, out = {};
      const premi = (i) => { P.buttons[i] = { pressed: true, touched: true, value: 1 }; g.sim(0.1, 1 / 30, false); P.buttons[i] = { pressed: false, touched: false, value: 0 }; g.sim(0.1, 1 / 30, false); };
      g.sim(0.5, 1 / 30, false);
      // A: porte aperte e poi chiuse
      premi(0); out.porteAperte = b.doorTarget;
      premi(0); out.porteChiuse = b.doorTarget;
      g.sim(3, 1 / 30, false);
      // RT: gas
      P.buttons[7] = { pressed: true, touched: true, value: 1 };
      g.sim(5, 1 / 30, false);
      out.velocita = b.v;
      P.buttons[7] = { pressed: false, touched: false, value: 0 };
      // levetta a sinistra: il volante va a sinistra (positivo), lasciata torna al centro
      P.axes[0] = -1; g.sim(0.6, 1 / 30, false); out.sterzoSinistra = b.steerIn;
      P.axes[0] = 0; g.sim(0.6, 1 / 30, false); out.sterzoLasciato = b.steerIn;
      // la tastiera sterza ancora, anche con il gamepad collegato
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
      g.sim(0.5, 1 / 30, false);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
      out.sterzoTastiera = b.steerIn;
      // LT: freno fino a fermarsi
      P.buttons[6] = { pressed: true, touched: true, value: 1 };
      g.sim(6, 1 / 30, false);
      out.velocitaFrenata = b.v;
      P.buttons[6] = { pressed: false, touched: false, value: 0 };
      g.sim(0.2, 1 / 30, false);
      // Menu: pausa, con il riquadro del gamepad; di nuovo Menu: si riparte
      premi(9);
      out.pausa = !document.getElementById('pause').classList.contains('hidden');
      out.riquadro = !document.getElementById('pause-pad').hidden && document.getElementById('pad-info').textContent;
      premi(9);
      out.ripresa = document.getElementById('pause').classList.contains('hidden');
      return out;
    });
    expect(stato.porteAperte).toBe(1);
    expect(stato.porteChiuse).toBe(0);
    expect(stato.velocita).toBeGreaterThan(2);
    expect(stato.sterzoSinistra).toBeGreaterThan(0.8);
    expect(Math.abs(stato.sterzoLasciato)).toBeLessThan(0.05);
    expect(stato.sterzoTastiera).toBeLessThan(-0.05);
    expect(stato.velocitaFrenata).toBeLessThan(0.3);
    expect(stato.pausa).toBe(true);
    expect(stato.riquadro).toContain('Gamepad di prova');
    expect(stato.ripresa).toBe(true);
  } finally {
    await scollega(pagina);
  }
  expect(gioco.errori()).toEqual([]);
});

test('volante e pedaliera: si impostano dalla pausa e poi guidano', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'free' });
  // volante sull'asse 0, gas e freno sugli assi 1 e 2: lasciati valgono 1, a fondo -1
  await collega(pagina, { id: 'Volante di prova (Vendor: 1234 Product: 5678)', mapping: '', axes: [0, 1, 1, 0] });
  try {
    const stato = await pagina.evaluate(() => {
      const g = window.__game, P = window.__padProva, b = g.bus, out = {};
      // chiude le porte, se aperte, e aspetta
      if (b.doorTarget) g.press('KeyF');
      g.sim(3, 1 / 30, false);
      // prima dell'impostazione volante e pedali non fanno niente
      P.axes[0] = -1; P.axes[1] = -1;
      g.sim(2, 1 / 30, false);
      out.primaSterzo = b.steerIn; out.primaVelocita = b.v;
      P.axes[0] = 0; P.axes[1] = 1;
      // pausa e impostazione: volante a sinistra, gas a fondo e lasciato, freno a fondo e lasciato
      g.press('KeyP');
      document.getElementById('pad-learn').click();
      const tieni = (sec) => { for (let t = 0; t < sec; t += 1 / 30) g.pad.poll(1 / 30); };
      const testi = [];
      tieni(0.2);
      testi.push(document.getElementById('pad-info').textContent);
      P.axes[0] = -1; tieni(0.8); P.axes[0] = 0;
      testi.push(document.getElementById('pad-info').textContent);
      P.axes[1] = -1; tieni(0.8);
      testi.push(document.getElementById('pad-info').textContent);
      P.axes[1] = 1; tieni(0.8);
      P.axes[2] = -1; tieni(0.8); P.axes[2] = 1; tieni(0.8);
      testi.push(document.getElementById('pad-info').textContent);
      out.testi = testi;
      out.salvato = JSON.parse(localStorage.getItem('padova-bus-sim-volante') || '{}');
      g.press('KeyP');
      // gas a fondo: il bus parte; volante a metà a sinistra: lo sterzo segue
      P.axes[1] = -1;
      g.sim(5, 1 / 30, false);
      out.velocita = b.v;
      P.axes[1] = 1; P.axes[0] = -0.5;
      g.sim(0.6, 1 / 30, false);
      out.sterzo = b.steerIn;
      P.axes[0] = 0;
      return out;
    });
    expect(Math.abs(stato.primaSterzo)).toBeLessThan(0.05);
    expect(stato.primaVelocita).toBeLessThan(0.1);
    expect(stato.testi[0]).toContain('volante tutto a sinistra');
    expect(stato.testi[1]).toContain('gas');
    expect(stato.testi[2]).toContain('lascia il gas');
    expect(stato.testi[3]).toContain('impostati');
    expect(stato.salvato['Volante di prova (Vendor: 1234 Product: 5678)']).toEqual({
      steer: { axis: 0, left: -1 }, gas: { axis: 1, rest: 1, full: -1 }, brake: { axis: 2, rest: 1, full: -1 },
    });
    expect(stato.velocita).toBeGreaterThan(2);
    expect(stato.sterzo).toBeGreaterThan(0.4);
  } finally {
    await scollega(pagina);
  }
  expect(gioco.errori()).toEqual([]);
});
