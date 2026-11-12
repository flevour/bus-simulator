// Gong e clacson del tram (#63): H suona il gong a rintocchi, Shift+H il clacson del tram, che non è quello del bus.
// Nel browser delle prove il gioco è muto (navigator.webdriver): la prova guarda lo stato dell'audio, cioè il volume
// chiesto a ciascun clacson e i rintocchi del gong, non quello che si sente.
import { test, expect, avviaCorsa } from './gioco.js';

// Tiene premuti i tasti, uno per fotogramma nell'ordine dato, per un secondo, poi li lascia. Dà il volume chiesto al
// clacson del bus e a quello del tram con i tasti premuti e dopo averli lasciati, e i rintocchi del gong
function suona(pagina, tasti) {
  return pagina.evaluate((tasti) => {
    const g = window.__game, a = g.audio, dt = 1 / 30, vol = {};
    const spie = ['hornG', 'tramHornG'].map((k) => {
      const p = a[k].gain, f = p.setTargetAtTime;
      p.setTargetAtTime = function (v, ...r) { vol[k] = v; return f.call(this, v, ...r); };
      return () => { p.setTargetAtTime = f; };
    });
    const bell = a.tramBell;
    let rintocchi = 0;
    a.tramBell = function () { rintocchi++; return bell.call(this); };
    for (const k of tasti) { g.keys.add(k); g.sim(dt, dt, false); }
    g.sim(1, dt, false);
    const premuti = { bus: vol.hornG, tram: vol.tramHornG, rintocchi, gong: g.bus.gong };
    for (const k of tasti) g.keys.delete(k);
    g.sim(0.2, dt, false);
    const lasciati = { bus: vol.hornG, tram: vol.tramHornG, rintocchi: rintocchi - premuti.rintocchi };
    for (const togli of spie) togli();
    a.tramBell = bell;
    return { premuti, lasciati };
  }, tasti);
}

test('tram: H suona il gong, Shift+H il clacson del tram', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: 'SIR1', tram: true, modo: 'roam' });
  const gong = await suona(pagina, ['KeyH']);
  const clacson = await suona(pagina, ['ShiftLeft', 'KeyH']);
  // Shift premuto dopo H (per esempio per il gas a fondo): resta il gong
  const gongShift = await suona(pagina, ['KeyH', 'ShiftRight']);
  console.log('tram:', JSON.stringify({ gong, clacson, gongShift }));
  // gong: un rintocco ogni 0,3 s, nessun clacson
  expect(gong.premuti.rintocchi).toBeGreaterThanOrEqual(3);
  expect(gong.premuti.tram).toBe(0);
  expect(gong.premuti.bus).toBe(0);
  // clacson del tram: suona quello del tram, non quello del bus, e il gong tace
  expect(clacson.premuti.tram).toBeGreaterThan(0);
  expect(clacson.premuti.bus).toBe(0);
  expect(clacson.premuti.rintocchi).toBe(0);
  expect(clacson.premuti.gong).toBe(false);
  expect(gongShift.premuti.rintocchi).toBeGreaterThanOrEqual(3);
  expect(gongShift.premuti.tram).toBe(0);
  // lasciati i tasti tace tutto
  for (const r of [gong, clacson, gongShift]) {
    expect(r.lasciati.tram).toBe(0);
    expect(r.lasciati.bus).toBe(0);
    expect(r.lasciati.rintocchi).toBe(0);
  }
  expect(gioco.errori()).toEqual([]);
});

test('bus: H e Shift+H suonano il clacson del bus', async ({ pagina, gioco }) => {
  await avviaCorsa(pagina, { linea: '24', modo: 'roam' });
  const h = await suona(pagina, ['KeyH']);
  const shiftH = await suona(pagina, ['ShiftLeft', 'KeyH']);
  console.log('bus:', JSON.stringify({ h, shiftH }));
  for (const r of [h, shiftH]) {
    expect(r.premuti.bus).toBeGreaterThan(0);
    expect(r.premuti.tram).toBe(0);
    expect(r.premuti.rintocchi).toBe(0);
    expect(r.lasciati.bus).toBe(0);
  }
  expect(gioco.errori()).toEqual([]);
});
