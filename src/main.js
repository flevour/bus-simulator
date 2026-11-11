import * as THREE from 'three';
import { buildNetwork, LINES, TRAM_LINES, fmtHM, toXZ, LANDMARKS } from './data/padova.js';
import { loadAreasNear } from './data/aree.js';
import { Tram, tramRoute, TRAM } from './tram/tram.js';
import { City, zoneOf } from './world/city.js';
import { TrafficLights, Traffic, Walkers, TramSim, TramSignals } from './world/traffic.js';
import { BusSim } from './world/buses.js';
import { Bus } from './bus/bus.js';
import { Mission, Transfer, scheduleFor, paceVariant, tripDuration } from './game/mission.js';
import { pointAt, projectOnRoute, startGoal, planTransfer, findPath, stopPose } from './game/routes.js';
import { turnoOf } from './game/turni.js';
import { DEPOT_NAME, depotGate, DepotGate } from './world/depot.js';
import { HUD } from './game/hud.js';
import { Audio } from './game/audio.js';
import { posthog, isPostHogConfigured, posthogGameLogger } from './posthog.js';
import { initNews } from './game/news.js';
import { Greetings } from './game/greetings.js';
import { TouchControls, isTouchDevice, MOBILE_SUPPORTED, isMobileDevice } from './game/touch.js';
import { GamepadControls } from './game/gamepad.js';
import { liveryPreviews, disposeTree } from './game/liveryPreview.js';
import { Terrain } from './world/terrain.js';
import { Chargers, CHARGE_KW } from './world/charger.js';

const $ = (id) => document.getElementById(id);
const capture = (event, properties) => {
  if (isPostHogConfigured) posthog.capture(event, properties);
};

// ------------------------------------------------------------------
// Renderer e scena
// ------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice() ? 1.25 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // aggiornata una sola volta per frame (non per gli specchietti)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
// terreno: la scena del mondo si disegna con le quote del suolo (vertex shader); la telecamera e i fari si alzano della
// quota del terreno nel loro punto, l'overlay del cruscotto resta piano
const baseRender = renderer.render.bind(renderer);
renderer.render = (sc, cam) => {
  if (sc !== scene || !terrain.ok) { terrain.enable(false); baseRender(sc, cam); return; }
  terrain.enable(true);
  if (city) city.followGround(cam.position.x, cam.position.z);
  const lifted = [cam, ...((bus && (bus.headLights || (bus.spot ? [bus.spot] : []))) || [])].flatMap((o) => (o.target ? [o, o.target] : [o]));
  const dys = lifted.map((o) => { const p = o.getWorldPosition(V3t); const dy = terrain.at(p.x, p.z); o.position.y += dy; o.updateMatrixWorld(); return dy; });
  baseRender(sc, cam);
  lifted.forEach((o, i) => { o.position.y -= dys[i]; o.updateMatrixWorld(); });
};
const V3t = new THREE.Vector3();
scene.fog = new THREE.Fog(0xcfe0ea, 250, 2600);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.35, 7000);

// cielo
const skyU = { top: { value: new THREE.Color(0x3d78c0) }, bottom: { value: new THREE.Color(0xd8e8f0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2d0) }, night: { value: 0 } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(5500, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){ float y = max(vD.y, 0.0); vec3 c = mix(bottom, top, pow(y, 0.55));
        float s = max(dot(normalize(vD), normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 600.0) * 4.0 + pow(s, 8.0) * 0.25) * (1.0 - night);
        vec3 q = floor(vD * 380.0); float st = step(0.9975, h(q)) * night * smoothstep(0.05, 0.3, vD.y);
        c += vec3(st);
        gl_FragColor = vec4(c, 1.0); }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5040, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = sun.shadow.camera;
SC.left = -110; SC.right = 110; SC.top = 110; SC.bottom = -110; SC.near = 10; SC.far = 900;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const ambient = new THREE.AmbientLight(0x8090b0, 0.15);
scene.add(ambient);

// pioggia
const RAIN_N = 5000;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 80, y = Math.random() * 35, z = (Math.random() - 0.5) * 80;
  rainPos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.45 }));
rain.frustumCulled = false;
rain.visible = false;
scene.add(rain);

// ------------------------------------------------------------------
// Mondo
// ------------------------------------------------------------------
let net, city, lights, trams, tramSignals, buses, greet, depot, depotMesh, chargers;
let terrain = new Terrain(null);
const hud = new HUD();
const audio = new Audio();

function buildWorld() {
  net = buildNetwork();
  terrain = new Terrain(net.terrain);
  // orari tra le fermate a misura di guida (il tram ha già quelli della sua sede)
  for (const L of LINES) for (const v of L.variants) paceVariant(net, v);
  // capolinea al bordo della mappa: la variante comincia o finisce dove l'export ha tagliato la strada (un solo arco)
  for (const L of LINES) for (const v of L.variants) {
    v.cutStart = net.nodes[v.nodes[0]].edges.length === 1;
    v.cutEnd = net.nodes[v.nodes[v.nodes.length - 1]].edges.length === 1;
  }
  city = new City(scene, net, { terrain });
  lights = new TrafficLights(scene, net, city);
  city.buildSigns();
  trams = new TramSim(scene, net, { track: city.tramTrack, tracks: city.tramTracks });
  // incroci con la sede: precedenza al tram e semafori a barre
  tramSignals = new TramSignals(scene, city, lights);
  trams.signals = tramSignals;
  // bus automatici delle linee urbane dall'orario
  buses = new BusSim(scene, net, city, { tramSignals });
  // deposito: da qui escono le prime corse del turno, qui rientrano le ultime
  depot = depotGate(net);
  if (depot) depotMesh = new DepotGate(scene, depot);
  // colonnine di ricarica dei bus elettrici, messe ai capolinea delle corse
  chargers = new Chargers(scene);
}

// ------------------------------------------------------------------
// Specchietti retrovisori (render target + quad specchiati)
// ------------------------------------------------------------------
const mirrorRT = [new THREE.WebGLRenderTarget(256, 360), new THREE.WebGLRenderTarget(256, 360)];
const mirrorCams = [new THREE.PerspectiveCamera(30, 256 / 360, 0.5, 900), new THREE.PerspectiveCamera(30, 256 / 360, 0.5, 900)];
const overlayScene = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const mirrorQuads = mirrorRT.map((rt) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: rt.texture, side: THREE.DoubleSide, toneMapped: false }));
  m.scale.x = -1;
  overlayScene.add(m);
  return m;
});
// specchietti regolabili: si trascinano col mouse (verso l'esterno guardano più in fuori, verso il basso più in basso),
// il doppio clic li rimette a posto; la regolazione resta in questo browser
const MIRROR_KEY = 'padova-bus-sim-specchietti';
const mirrorAdj = (() => {
  try {
    const a = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null');
    if (Array.isArray(a) && a.length === 2) return a.map((m) => ({ yaw: Number(m.yaw) || 0, pitch: Number(m.pitch) || 0 }));
  } catch (e) { /* ignorato */ }
  return [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }];
})();
const saveMirrors = () => { try { localStorage.setItem(MIRROR_KEY, JSON.stringify(mirrorAdj)); } catch (e) { /* ignorato */ } };
['mirror-frame-l', 'mirror-frame-r'].forEach((id, i) => {
  const el = $(id), s = i ? -1 : 1;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = mirrorAdj[i];
    // trascinato verso il suo lato (a sinistra il sinistro, a destra il destro) guarda più in fuori
    a.yaw = Math.max(-0.3, Math.min(0.35, a.yaw - s * (e.clientX - drag.x) * 0.002));
    a.pitch = Math.max(-0.12, Math.min(0.2, a.pitch + (e.clientY - drag.y) * 0.002));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; el.classList.remove('dragging'); saveMirrors(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { mirrorAdj[i] = { yaw: 0, pitch: 0 }; saveMirrors(); hud.toast('Specchietto rimesso a posto', 'info'); });
});
// monitor della telecamera sopra l'ultima porta: sul cruscotto, acceso da fermi e con le porte aperte (non specchiato)
const doorRT = new THREE.WebGLRenderTarget(320, 240);
const doorCam = new THREE.PerspectiveCamera(80, 4 / 3, 0.1, 200);
const doorQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: doorRT.texture, toneMapped: false }));
doorQuad.visible = false;
overlayScene.add(doorQuad);
function layoutMirrors() {
  const W = window.innerWidth, H = window.innerHeight;
  overlayCam.right = W; overlayCam.top = H; overlayCam.updateProjectionMatrix();
  // su telefono gli specchietti sono più piccoli, per lasciare spazio a volante e pedali
  const small = document.body.classList.contains('touch') && H < 600;
  const mw = small ? Math.min(90, W * 0.08) : Math.min(150, W * 0.11), mh = mw * 1.4;
  const y = small ? H * 0.34 : H * 0.42;
  // in modalità touch gli specchietti si spostano verso il centro, oltre il volante e la pulsantiera
  const inL = small ? 176 : 14, inR = small ? 232 : 14;
  const pos = [[inL + mw / 2, H - y - mh / 2], [W - inR - mw / 2, H - y - mh / 2]];
  mirrorQuads.forEach((q, i) => {
    q.position.set(pos[i][0], pos[i][1], 0);
    q.scale.set(-mw, mh, 1);
    const f = $(i === 0 ? 'mirror-frame-l' : 'mirror-frame-r');
    f.style.left = pos[i][0] - mw / 2 - 4 + 'px';
    f.style.top = H - pos[i][1] - mh / 2 - 4 + 'px';
    f.style.width = mw + 8 + 'px';
    f.style.height = mh + 8 + 'px';
  });
  // monitor in basso, a sinistra del limite di velocità e degli strumenti
  const dw = 200, dh = 150, dx = W - 470 - dw / 2, dy = 34 + dh / 2;
  doorQuad.position.set(dx, dy, 0);
  doorQuad.scale.set(dw, dh, 1);
  const f = $('door-frame');
  f.style.left = dx - dw / 2 - 4 + 'px';
  f.style.top = H - dy - dh / 2 - 4 + 'px';
  f.style.width = dw + 8 + 'px';
  f.style.height = dh + 8 + 'px';
}

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------
const keys = new Set();
const input = { throttle: false, brake: false, left: false, right: false, shift: false };
window.addEventListener('keydown', (e) => {
  // pannelli Novità e Richieste: i tasti vanno al modulo, Esc chiude
  if (news && news.open) { if (e.code === 'Escape') news.close(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) onKeyPress(e.code);
  keys.add(e.code);
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) pad.keyboardSteer();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
// comandi touch: i pulsanti passano da onKeyPress come i tasti, volante e pedali sono analogici
const touch = new TouchControls({ press: (code) => onKeyPress(code), keys });
if (MOBILE_SUPPORTED) {
  if (isTouchDevice()) touch.enable();
  window.addEventListener('touchstart', () => { if (!touch.enabled) { touch.enable(); layoutMirrors(); } }, { passive: true, once: true });
} else document.body.classList.add('solo-computer');
// telefono o tablet senza supporto: l'invito a giocare da computer al posto del gioco (la città non si costruisce)
const mobileBlocked = !MOBILE_SUPPORTED && isMobileDevice();
// gamepad e volante: anche loro passano i pulsanti da onKeyPress; levetta, volante e pedali sono analogici
const pad = new GamepadControls({ press: (code) => onKeyPress(code), keys, onChange: () => padChanged() });
function readInput(dt) {
  pad.isTram = !!(bus && bus.isTram);
  pad.poll(dt);
  const T = touch.state, P = pad.state;
  const gas = Math.max(T.gas, P.gas), brk = Math.max(T.brake, P.brake);
  const fwdKey = keys.has('KeyW') || keys.has('ArrowUp') || gas > 0, backKey = keys.has('KeyS') || keys.has('ArrowDown') || brk > 0;
  // in retromarcia, appena fermi, W rimette la marcia avanti
  if (bus && bus.dir < 0 && fwdKey && Math.abs(bus.v) < 0.15) setDirection(1);
  // in retromarcia i pedali si scambiano: S dà gas all'indietro, W frena
  const rev = bus && bus.dir < 0;
  input.throttle = rev ? backKey : fwdKey;
  input.brake = rev ? fwdKey : backKey;
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  // gas o freno del gamepad quasi a fondo valgono Shift (il manipolatore del tram va alla tacca piena)
  input.shift = keys.has('ShiftLeft') || keys.has('ShiftRight') || P.gas > 0.9 || P.brake > 0.9;
  // pedali touch e del gamepad: forza proporzionale (in retromarcia il freno dà gas all'indietro, come S)
  input.thrAxis = (rev ? brk : gas) || null;
  input.brkAxis = (rev ? gas : brk) || null;
  input.steerAxis = T.steer != null ? T.steer : P.steer;
  input.steerSens = settings.steerSens;
  if (bus) bus.horn = keys.has('KeyH');
}

// ------------------------------------------------------------------
// Stato di gioco
// ------------------------------------------------------------------
let bus = null, mission = null, traffic = null, walkers = null, news = null;
let running = false, paused = false;
let camMode = 0; // 0 cabina, 1 esterna, 2 passeggeri, 3 dall'alto
const CAM_NAMES = ['Cabina di guida', 'Esterna', 'Passeggeri', 'Dall\'alto'];
let lookYaw = 0;
// sguardo col mouse: trascina nella vista (cabina/passeggeri: gira la testa; esterna: ruota attorno al bus)
const mouseLook = { yaw: 0, pitch: 0, drag: null };
function resetLook(toast) {
  mouseLook.yaw = 0; mouseLook.pitch = 0;
  if (toast) hud.toast('Sguardo in avanti', 'info');
}
// (eventi pointer: funziona col mouse e con un dito sullo schermo; doppio tocco = sguardo in avanti)
let lastTap = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!running || paused || e.button !== 0 || mouseLook.drag) return;
  if (e.pointerType !== 'mouse') {
    const now = performance.now();
    if (now - lastTap < 320) { resetLook(true); lastTap = 0; return; }
    lastTap = now;
  }
  mouseLook.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture?.(e.pointerId);
  canvas.classList.add('dragging');
});
window.addEventListener('pointermove', (e) => {
  const d = mouseLook.drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.x = e.clientX; d.y = e.clientY;
  const k = camMode === 1 ? 0.006 : 0.0045;
  mouseLook.yaw = Math.max(-2.6, Math.min(2.6, mouseLook.yaw - dx * k));
  mouseLook.pitch = Math.max(-0.7, Math.min(0.55, mouseLook.pitch - dy * 0.0035));
});
const endLook = (e) => { if (mouseLook.drag && e.pointerId === mouseLook.drag.id) { mouseLook.drag = null; canvas.classList.remove('dragging'); } };
window.addEventListener('pointerup', endLook);
window.addEventListener('pointercancel', endLook);
canvas.addEventListener('dblclick', () => { if (running) resetLook(true); });
const L24 = LINES.find((l) => l.id === '24') || LINES[0];
// linee bus e tram nel menu
const ALL_LINES = [...LINES, ...TRAM_LINES];
// linee servite con l'autobus snodato da 18 m
const ARTICULATED_LINES = new Set(['10']);
// sensibilità dello sterzo da tastiera, salvata in questo browser: 0.7 fa girare il bus, per un colpo di tasto in città,
// quanto lo sterzo di prima del 6 novembre; 1 è lo sterzo progressivo dal 6 all'11 novembre
const STEER_KEY = 'padova-bus-sim-sterzo';
const STEER_SENS = [0.5, 0.7, 1, 1.4];
function loadSteerSens() {
  try { const v = Number(localStorage.getItem(STEER_KEY)); return STEER_SENS.includes(v) ? v : 0.7; } catch (e) { return 0.7; }
}
const settings = { line: L24, variant: 'feriale', vIdx: L24.pair[0], departure: 0, depDur: 0, weather: 'variable', mode: 'service', livery: 'moderna', vehicle: 'bus', lightHour: null, fromDepot: true, steerSens: loadSteerSens() };
// modalità: servizio di linea, giro libero (regole della strada) o esplorazione (nessuna regola, il tram non deraglia)
const FREE_VMAX = 120; // km/h al limitatore fuori servizio (giro libero, esplorazione)
const MODE_NOTE = {
  service: 'Corsa con orario, fermate, passeggeri e punteggio.',
  free: 'Niente orari, fermate né traffico, e il mezzo arriva a 120 km/h; valgono semafori, limiti e marciapiedi.',
  roam: 'Nessuna regola né punteggio e niente traffico: niente linea, limiti o semafori da rispettare, il mezzo arriva a 120 km/h e il tram non deraglia.',
};
let indAccum = 0, lastBlinkOn = false, wasMoving = false;
let showHelp = false;

function onKeyPress(code) {
  if (!running) return;
  if (tpOpen) {
    if (code === 'Escape' || code === 'KeyJ') { openTeleport(false); return; }
    const m = code.match(/^(?:Digit|Numpad)([1-9])$/);
    if (m && tpItems[Number(m[1]) - 1]) { const it = tpItems[Number(m[1]) - 1]; openTeleport(false); it.run(); }
    return;
  }
  if (code === 'KeyJ' && !paused) { openTeleport(true); return; }
  if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
  if (paused) return;
  audio.resume();
  switch (code) {
    case 'KeyF': toggleDoors(); break;
    case 'KeyQ': setIndicator(bus.indicator === -1 ? 0 : -1); break;
    case 'KeyE': setIndicator(bus.indicator === 1 ? 0 : 1); break;
    case 'KeyG': setIndicator(bus.indicator === 2 ? 0 : 2); break;
    case 'KeyL': bus.lights = !bus.lights; audio.tick(true); break;
    case 'Space': bus.parking = !bus.parking; audio.noiseBurst({ dur: 0.4, freq: 3000, gain: 0.2 }); hud.toast(bus.parking ? 'Freno di stazionamento inserito' : 'Freno di stazionamento rilasciato', 'info'); break;
    case 'KeyR':
      if (bus.isTram) { hud.toast('Il tram non ha la retromarcia: al capolinea cambia cabina (B)', 'info'); break; }
      if (Math.abs(bus.v) < 0.3) setDirection(-bus.dir);
      else hud.toast('Fermati per cambiare direzione di marcia', 'bad');
      break;
    // da fermo, premere di nuovo S inserisce la retromarcia (con le porte chiuse)
    case 'KeyS': case 'ArrowDown':
      if (!bus.isTram && bus.dir > 0 && Math.abs(bus.v) < 0.15 && bus.doorsClosed && bus.doorTarget === 0) setDirection(-1);
      break;
    // tram: pantografo (O) e cambio cabina (B)
    case 'KeyO':
      if (!bus.isTram) { chargeKey(); break; }
      audio.noiseBurst({ dur: 1.2, freq: 900, gain: 0.12 });
      hud.toast(bus.togglePantograph() ? '🔌 Alzo il pantografo' : '🔋 Abbasso il pantografo: si va a batteria', 'info');
      break;
    case 'KeyB':
      if (bus.isTram) changeTramCab();
      break;
    case 'KeyN':
      if (bus.isTram) toggleTramSwitch();
      break;
    case 'KeyK':
      if (bus.isTram) break;
      if (Math.abs(bus.v) < 0.3) { bus.kneelTarget = bus.kneelTarget ? 0 : 1; audio.noiseBurst({ dur: 1.4, freq: 2000, gain: 0.25 }); }
      break;
    case 'KeyC': camMode = (camMode + 1) % 4; resetLook(false); hud.toast('Visuale: ' + CAM_NAMES[camMode], 'info'); break;
    case 'KeyV': resetLook(true); break;
    case 'KeyM': hud.setBigMap(!hud.big); break;
    case 'KeyT': mission.skipWait(); break;
    case 'KeyU': audio.muted = !audio.muted; audio.setMuted(audio.muted); hud.toast(audio.muted ? 'Audio disattivato' : 'Audio attivo', 'info'); break;
    case 'KeyY': greet.press(); break;
    case 'KeyI': showHelp = !showHelp; $('help').style.display = showHelp ? 'block' : 'none'; break;
  }
}

// Tram: cambio cabina (B), da fermo con le porte chiuse. Il tram resta dov'è e si guida dall'altra estremità. Al capolinea
// con lo scambio (TramTrack.terminal), dalla parte del tronco e con lo scambio deviato, il binario davanti diventa quello
// dell'altro verso: ripartendo si passa dallo scambio. All'anello della stazione si riparte senza cambiare cabina. In
// servizio solo a fine corsa, e parte anche la corsa successiva del turno (tramNextRun)
let cabAfterDoors = false; // B a fine corsa con le porte aperte: si chiudono, poi si cambia cabina
function changeTramCab() {
  const service = !mission.free && !mission.transfer;
  if (service && !mission.finished) {
    hud.toast(mission.nextStop >= mission.stops.length - 1 ? 'Capolinea: fai scendere tutti (porte aperte, F), poi B per la corsa successiva' : 'Si cambia cabina solo al capolinea, a fine corsa', 'info');
    return;
  }
  if (service && Math.abs(bus.v) < 0.05 && bus.doorTarget > 0) {
    toggleDoors();
    cabAfterDoors = true;
    hud.toast('Porte in chiusura, poi si cambia cabina', 'info');
    return;
  }
  if (Math.abs(bus.v) > 0.05 || !bus.doorsClosed || bus.doorTarget > 0) { hud.toast('Fermati con le porte chiuse per cambiare cabina', 'bad'); return; }
  const P = bus.path, sf = bus.sFront, T = bus.track, d = bus.dirSig, nd = -d, np = T.path(nd);
  // capolinea ad anello (SIR3 in stazione): negli ultimi 200 m il binario dell'altro verso continua davanti al muso, si
  // riparte senza cambiare cabina
  const head = P.at(sf), pr = bus.facing > 0 && !T.terminals[d > 0 ? 1 : -1] && sf > P.len - 200 && np.projectNear(head.x, head.z, 1.5);
  if (pr && np.at(pr.s).dx * head.dx + np.at(pr.s).dz * head.dz > 0.7) {
    bus.transfer(np, nd, 0, pr.s, null, true);
    bus.parking = true;
    if (service) tramNextRun();
    else hud.toast('🔁 Fine dell\'anello: si riparte verso l\'altro capolinea, senza cambiare cabina', 'info');
    return;
  }
  // capolinea con lo scambio: in servizio lo scambio è automatico (deviato verso il binario di partenza)
  const term = bus.facing > 0 && T.terminals ? T.terminals[d > 0 ? 1 : -1] : null;
  if (term && service) setSwitch(term, 'deviato');
  const s = term && term.state === 'deviato' ? tramAtTerminal(term) : null;
  if (s != null) {
    bus.transfer(np, nd, 0, s, term.field === 'dep' ? term : null);
    bus.parking = true;
    chase.init = false;
    hud.toast('🔁 Cabina cambiata: ripartendo il tram passa dallo scambio sull\'altro binario', 'info');
    if (service) tramNextRun();
    return;
  }
  if (service) {
    hud.toast(term && term.kind === 'dopo' ? 'Vai in fondo al binario, oltre lo scambio, poi cambia cabina (B)' : term && term.kind === 'avanti' ? 'Vai in fondo al binario passando dallo scambio, poi cambia cabina (B)' : 'Si cambia cabina solo al capolinea, a fine corsa', 'info');
    return;
  }
  // giro libero ed esplorazione: si cambia solo cabina, il tram resta sul suo binario e si guida all'indietro
  bus.changeCab();
  chase.init = false;
  hud.toast('🔁 Cabina cambiata: ora guidi dall\'altra estremità, sullo stesso binario', 'info');
}
// Tram: lo scambio del capolinea più vicino (entro 120 m) nell'altra posizione. In servizio si gira da solo; non si gira
// mentre il tram ci passa sopra
function toggleTramSwitch() {
  let sw = null, bd = 120;
  for (const w of city.tramSwitches || []) { const d = Math.hypot(w.term.sig.x - bus.x, w.term.sig.z - bus.z); if (d < bd) { bd = d; sw = w; } }
  if (!sw) { hud.toast('Nessuno scambio qui vicino', 'info'); return; }
  if (!mission.free) { hud.toast('In servizio lo scambio del capolinea si gira da solo', 'info'); return; }
  if (bus.xover === sw.term || (bus.xend === sw.term && bus.pathOffset + bus.sFront > sw.term.toe - 1)) { hud.toast('Scambio bloccato: il tram ci sta passando', 'bad'); return; }
  sw.term.state = sw.term.state === 'deviato' ? 'diritto' : 'deviato';
  sw.update();
  audio.noiseBurst({ dur: 0.6, freq: 700, gain: 0.15 });
  hud.toast(sw.term.state === 'deviato' ? '↗️ Scambio deviato: col cambio cabina si passa sull\'altro binario' : '⬆️ Scambio diritto: col cambio cabina si resta sul binario', 'info');
}
function refreshSwitch(term) { for (const w of city.tramSwitches || []) if (w.term === term) w.update(); }
function setSwitch(term, state) { if (term.state !== state) { term.state = state; refreshSwitch(term); } }
// capolinea con lo scambio: se il tram è tutto dalla parte del tronco, la progressiva sul binario di partenza della coda
// di ora, che diventa il muso; altrimenti null. Con le distanze lungo i binari dello scambio (TramTrack.terminal): il
// tram resta esattamente dov'è
function tramAtTerminal(term) {
  if (bus.dirSig !== term.arr) return null;
  const tail = bus.pathOffset + bus.sFront - bus.length; // coda sul binario d'arrivo
  if (tail + bus.length > term.fondo + 0.5) return null; // oltre il fondo utile il binario di partenza non c'è
  // 'avanti': tutto oltre la comunicazione, sul tronco del binario di partenza
  if (term.field === 'arr') return tail >= term.heel ? term.other(tail) : null;
  // 'dopo' e 'prima': tutto oltre il punto dove lo scambio lascia il binario d'arrivo
  const s = term.toe - (tail - term.link);
  return tail >= term.link && s >= 0 ? s : null;
}
// tram a fine corsa, già sul binario dell'altro verso (dopo changeTramCab): la corsa successiva del turno parte dalla
// prima fermata. Il tram resta dov'è se è sul binario prima della banchina di partenza (dal tronco ci arriva passando
// dallo scambio) o già alla banchina; se è oltre, si porta alla banchina
function tramNextRun() {
  const t = nextOfTurno(), next = t && t.next;
  if (!next) { hud.toast('Era l\'ultima corsa del turno: dal menu (Esc) scegli una corsa nuova', 'info'); return; }
  $('results').classList.add('hidden');
  countRun(mission);
  Object.assign(settings, { vIdx: next.v.idx, departure: next.t, depDur: next.d });
  const L = settings.line, V = next.v, dest = V.stops[V.stops.length - 1].name, clock = mission.clock;
  const tr = tramRoute(bus.track, V, L.modules, false);
  V.trackPath = tr.path;
  const sNow = tr.sig === bus.dirSig ? bus.pathOffset + bus.sFront - tr.offset : -1;
  bus.setPath(tr.path, tr.sig, tr.offset, bus.xover && bus.xover.dep === tr.sig ? bus.xover : null);
  const tEnd = bus.track.terminals && bus.track.terminals[tr.sig > 0 ? 1 : -1];
  if (tEnd) setSwitch(tEnd, tEnd.field === 'arr' ? 'deviato' : 'diritto');
  const m = new Mission({ ...missionCommon(), route: V, departure: next.t, depDur: next.d });
  m.clock = clock;
  const at = m.stops[0].s - 0.5; // muso a fine banchina
  if (sNow >= 0 && sNow < at + 9) bus.setFront(sNow);
  else {
    bus.setFront(at);
    if (Math.abs(sNow - at) > 3) chase.init = false;
    if (sNow < 0 || sNow > at + 60) hud.toast(`🌀 Il tram è alla banchina di partenza ${m.stops[0].name}`, 'info');
  }
  bus.parking = true;
  m.s = Math.max(0, bus.sFront - TRAM.ref);
  m.dest = dest;
  switchMission(m);
  trams.exclude({ v: V, t: next.t });
  const after = nextOfTurno();
  if (after && after.next) trams.exclude({ v: after.next.v, t: after.next.t });
  bus.setDestination(L.id, dest);
  hud.setLine(L, dest);
  hud.toast(`Linea ${L.id} per ${dest} – partenza ${fmtHM(next.t)}: apri le porte (F)`, 'info');
  capture('mission_started', { vehicle_type: 'tram', mission_mode: 'service', line_id: L.id, service_day: settings.variant, weather: settings.weather, turno_run: turno.corse + 1 });
  saveGame();
}

function setDirection(d) {
  if (bus.dir === d) return;
  bus.dir = d; bus.gear = 1;
  hud.toast(d < 0 ? 'Retromarcia inserita (R): S per arretrare, W per frenare' : 'Marcia avanti (D)', 'info');
}

function setIndicator(v) {
  bus.indicator = v;
  indAccum = 0;
  audio.tick(v !== 0);
}

// ------------------------------------------------------------------
// Teletrasporto
// ------------------------------------------------------------------
const PLACES = [
  ['Stazione FS', /^Ferrovia \(Ex Catasto\)/], ['Prato della Valle', /^Prato Valle/], ['Basilica del Santo', /Santo/],
  ['Piazza Garibaldi', /Garibaldi/], ['Ospedale', /Giustiniani/], ['Arcella', /Aspetti|Arcella/],
  ['Bassanello', /Bassanello|Vittorio Emanuele/], ['Stanga', /Stanga/], ['Guizza', /Guizza/], ['Ponte di Brenta', /Ponte di Brenta/],
];
let tpOpen = false, tpItems = [];
function teleportItems() {
  const items = [];
  if (!mission.free) {
    const ns = mission.stops[mission.nextStop];
    if (ns) items.push({ label: 'Prossima fermata: ' + ns.name, run: () => teleportToStop(ns) });
    const ns2 = mission.stops[mission.nextStop + 1];
    if (ns2) items.push({ label: 'Fermata successiva: ' + ns2.name, run: () => teleportToStop(ns2) });
  }
  for (const [label, re] of PLACES) {
    const st = net.stops.find((s) => re.test(s.name));
    if (!st) continue;
    const off = !mission.free && projectOnRoute(mission.route, st.x, st.z, mission.route.length / 2, 1e9, 1e9).d > 40;
    items.push({ label: label + (off ? ' · fuori dalla tua linea' : ''), run: () => teleportTo(st.x, st.z) });
  }
  return items.slice(0, 9);
}
function openTeleport(v) {
  tpOpen = v;
  $('teleport').hidden = !v;
  if (!v) return;
  tpItems = teleportItems();
  $('teleport-list').innerHTML = tpItems.map((it, i) => `<li><button data-i="${i}"><kbd>${i + 1}</kbd>${it.label}</button></li>`).join('');
  document.querySelectorAll('#teleport-list button').forEach((b) => b.addEventListener('click', () => { const it = tpItems[Number(b.dataset.i)]; openTeleport(false); it.run(); }));
}
// porta il bus sulla corsia giusta della strada più vicina al punto
function teleportTo(x, z, dirHint = null) {
  const r = city.snapToRoad(x, z, 300);
  if (!r) { hud.toast('Nessuna strada qui vicino', 'bad'); return; }
  let dx = r.dx, dz = r.dz;
  const e = r.edge;
  if (e.oneway === -1) { dx = -dx; dz = -dz; }
  else if (!e.oneway) {
    const hx = dirHint ? dirHint.dx : bus.fx, hz = dirHint ? dirHint.dz : bus.fz;
    if (dx * hx + dz * hz < 0) { dx = -dx; dz = -dz; }
  }
  const lat = e.oneway ? 0 : e.width / 4;
  placeBusAt(r.cx - dz * lat, r.cz + dx * lat, Math.atan2(dx, dz));
  capture('teleport_used', { vehicle_type: bus.isTram ? 'tram' : 'bus', mission_mode: mission.roam ? 'roam' : mission.free ? 'free' : 'service' });
  hud.toast('🌀 Teletrasporto: ' + (e.name || 'strada senza nome'), 'info');
}
function teleportToStop(st) {
  const s = Math.max(0, st.s - 60);
  const p = pointAt(mission.route, s);
  const lat = p.seg.edge && p.seg.edge.oneway ? 0 : p.seg.hw / 2;
  placeBusAt(p.x - p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz));
  capture('teleport_used', { vehicle_type: bus.isTram ? 'tram' : 'bus', mission_mode: 'service' });
  // arrivi più o meno in orario alla fermata scelta
  if (st.sched) mission.clock = Math.max(mission.clock, st.sched - 100);
  hud.toast('🌀 Teletrasporto davanti a ' + st.name, 'info');
}
function placeBusAt(x, z, h) {
  bus.place(x, z, h);
  bus.elev = undefined; // dopo un salto vale la strada più alta sotto il bus (sopra un cavalcavia si resta sopra)
  city.ensureTiles(x, z, 600);
  bus.steerIn = 0; bus.steer = 0; bus.throttle = 0; bus.brake = 0;
  bus.doorTarget = 0; bus.doorOpen = bus.doorOpen.map(() => 0); bus.parking = true; bus.dir = 1;
  chase.init = false;
  // via le auto troppo vicine
  for (let i = traffic.cars.length - 1; i >= 0; i--) { const c = traffic.cars[i]; if (Math.hypot(c.x - x, c.z - z) < 35) traffic.cars.splice(i, 1); }
  buses.clearAround(x, z, 25);
  const m = mission;
  m.lastSigDist.clear();
  if (m.free) return;
  // aggiorna la posizione lungo la linea; le fermate scavalcate non contano come saltate
  const pr = projectOnRoute(m.route, x, z, m.route.length / 2, 1e9, 1e9);
  if (pr.d > 40) return;
  m.s = pr.s;
  let k = m.nextStop;
  while (k < m.stops.length - 1 && m.stops[k].s < pr.s + 6) {
    const st = m.stops[k];
    st.arrived = st.left = true;
    m.onboard = m.onboard.filter((d) => d !== st.idx);
    k++;
  }
  if (k !== m.nextStop) {
    m.nextStop = k;
    m.request = false;
    m.leaveCheck = null;
    bus.passengers = m.onboard.length;
    bus.setPassengerVisuals(m.onboard.length);
    bus.setInnerDisplay('Prossima: ' + m.stops[k].name);
  }
}

function toggleDoors() {
  if (bus.doorTarget === 0) {
    if (Math.abs(bus.v) > 0.5) { hud.toast('Fermati prima di aprire le porte!', 'bad'); return; }
    bus.doorTarget = 1;
    audio.doorOpen();
    const si = mission.stopInfo;
    if (!mission.free && !(si && si.inZone) && !mission.finished) mission.addScore(-30, 'Porte aperte fuori fermata!');
  } else {
    if (mission.walkingIn() > 0) mission.addScore(-20, 'Hai chiuso le porte in faccia a un passeggero!');
    bus.doorTarget = 0;
    audio.doorClose();
    mission.onDoorsClosing(bus);
  }
}

function togglePause(force) {
  paused = force != null ? force : !paused;
  $('pause').classList.toggle('hidden', !paused);
  if (paused) {
    document.querySelectorAll('#pause-weather button').forEach((x) => x.classList.toggle('sel', x.dataset.w === settings.weather));
    $('pause-hour').value = settings.lightHour == null ? '' : String(settings.lightHour);
    // cambio di autobus: solo col bus (con lo snodato le anteprime sono dello snodato)
    $('pause-bus').hidden = !bus || bus.isTram;
    if (bus && !bus.isTram) { markLivery(bus.livery); fillLiveryPreviews($('pause-livery'), !!bus.articulated); }
    updatePadBox();
    touch.release();
    const ok = saveGame();
    $('pause-info').textContent = ok ? `Progressi salvati alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: potrai riprendere da qui anche dopo aver chiuso la pagina.` : 'Salvataggio non disponibile in questo browser.';
    if ('speechSynthesis' in window) speechSynthesis.pause();
    audio.setMuted(true);
  } else if (running) {
    // impostazione di volante e pedali lasciata a metà: si riparte con quella di prima
    if (pad.learn) pad.cancelLearn();
    if ('speechSynthesis' in window) speechSynthesis.resume();
    audio.setMuted(!!audio.muted);
  }
}

// ------------------------------------------------------------------
// Salvataggio della corsa (localStorage, solo in questo browser)
// ------------------------------------------------------------------
const SAVE_KEY = 'padova-bus-sim-save-v2';
function saveGame() {
  if (!running || !mission || !bus || mission.finished || mission.transfer) return false;
  const m = mission;
  const data = {
    v: 2,
    savedAt: Date.now(),
    settings: { line: settings.line.id, variant: settings.variant, vIdx: settings.vIdx, departure: settings.departure, depDur: settings.depDur, weather: settings.weather, mode: settings.mode, livery: settings.livery },
    mission: {
      clock: m.clock, nextStop: m.nextStop, s: m.s, score: m.score, stats: m.stats, comfort: m.comfort,
      onboard: m.onboard, log: m.log.slice(-40),
      stops: m.stops.map((st) => [st.arrived ? 1 : 0, st.left ? 1 : 0, st.delay ?? null]),
    },
    bus: { x: bus.x, z: bus.z, h: bus.h, lights: bus.lights, dir: bus.dir, odo: bus.odometer, battery: bus.battery, energy: bus.energy, tram: bus.isTram ? { s: bus.sFront, panto: bus.pantoUp, battery: bus.battery } : null },
    cam: camMode,
    weather: { cloud: wx.cloud, rain: wx.rain, fog: wx.fog, wet: wx.wet, target: wx.target, phase: wx.phase, next: wx.next },
    summary: m.free ? `Giro libero · Linea ${settings.line.id}` : `Linea ${settings.line.id} → ${m.dest} · fermata ${Math.min(m.nextStop + 1, m.stops.length)}/${m.stops.length} (${m.stops[Math.min(m.nextStop, m.stops.length - 1)].name})`,
    clockText: fmtHM(m.clock),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}
function loadSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return d && d.v === 2 ? d : null; } catch (e) { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignorato */ }
  refreshResumeBox();
}
function refreshResumeBox() {
  const d = loadSave();
  const box = $('resume-box');
  if (!box) return;
  box.hidden = !d;
  if (!d) return;
  const when = new Date(d.savedAt);
  $('resume-summary').textContent = `${d.summary} · ore ${d.clockText} · ${d.settings.variant} · salvata il ${when.toLocaleDateString('it-IT')} alle ${when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}
function resumeSaved() {
  const d = loadSave();
  if (!d) return;
  const L = ALL_LINES.find((l) => l.id === d.settings.line);
  if (!L) { clearSave(); return; }
  Object.assign(settings, d.settings, { line: L, vehicle: L.tram ? 'tram' : 'bus' });
  renderLines();
  // il menu mostra le scelte della corsa ripresa
  for (const [id, attr, val] of [['livery', 'l', settings.livery || 'moderna'], ['weather', 'w', settings.weather], ['mode', 'm', settings.mode]])
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('sel', b.dataset[attr] === val));
  startMission(d);
}
function applySave(d) {
  const m = mission, s = d.mission;
  m.clock = s.clock; m.nextStop = s.nextStop; m.s = s.s; m.score = s.score; m.comfort = s.comfort;
  Object.assign(m.stats, s.stats);
  m.onboard = s.onboard.slice();
  m.log = s.log.slice();
  s.stops.forEach(([a, l, delay], i) => {
    const st = m.stops[i];
    if (!st) return;
    st.arrived = !!a; st.left = !!l; st.delay = delay;
    // le fermate già servite non generano più persone
    if (st.left || i < m.nextStop) st.spawned = true;
  });
  if (bus.isTram && d.bus.tram) {
    // salvato dopo il cambio cabina, ancora dalla parte del tronco: il tram è sul binario d'arrivo, prima dello scambio
    const t = bus.track && bus.track.terminals && bus.track.terminals[-bus.dirSig];
    if (t && bus.pathOffset === 0 && mission.stops && d.bus.tram.s < mission.stops[0].s - 2 && d.bus.tram.s < t.heel) bus.xover = t;
    bus.setFront(d.bus.tram.s);
    bus.pantoUp = d.bus.tram.panto !== false; bus.pantoPos = bus.pantoUp ? 1 : 0; bus.battery = d.bus.tram.battery ?? 1;
  } else {
    bus.place(d.bus.x, d.bus.z, d.bus.h);
    if (d.bus.battery != null) bus.battery = d.bus.battery;
    if (d.bus.energy) bus.energy = { used: d.bus.energy.used || 0, regen: d.bus.energy.regen || 0 };
  }
  bus.lights = d.bus.lights; bus.dir = d.bus.dir || 1; bus.odometer = d.bus.odo || 0;
  bus.parking = true;
  bus.passengers = m.onboard.length;
  bus.setPassengerVisuals(m.onboard.length);
  const ns = m.stops[m.nextStop];
  if (ns && !m.free) bus.setInnerDisplay('Prossima: ' + ns.name);
  camMode = d.cam || 0;
}

// ------------------------------------------------------------------
// Menu
// ------------------------------------------------------------------
function curVariant() {
  const L = settings.line;
  return L.variants[Math.min(settings.vIdx || 0, L.variants.length - 1)];
}
function hourTag(t) {
  const h = (t / 3600) % 24;
  return h < 7 ? ' 🌅 alba' : h < 9.3 ? ' 🚸 ora di punta' : h < 17 ? ' ☀️' : h < 19.5 ? ' 🚦 punta serale' : h < 20.5 ? ' 🌇 tramonto' : ' 🌙 notte';
}

// anteprime dei bus nel menu: per la linea 10 si vede lo snodato. Si disegnano dopo il primo frame del menu
let liveryT = 0;
function fillLiveryPreviews(grid, art) {
  const btns = [...grid.querySelectorAll('button')];
  const imgs = liveryPreviews(btns.map((b) => b.dataset.l), art);
  for (const b of btns) b.querySelector('img').src = imgs[b.dataset.l];
}
function refreshLiveryPreviews() {
  if ($('livery-box').hidden) return;
  const art = ARTICULATED_LINES.has(settings.line.id) && !settings.line.tram;
  clearTimeout(liveryT);
  liveryT = setTimeout(() => fillLiveryPreviews($('livery'), art), 30);
}
// la livrea scelta, evidenziata in tutti e due i selettori
function markLivery(l) {
  document.querySelectorAll('.livery-pick button').forEach((b) => b.classList.toggle('sel', b.dataset.l === l));
}
// cambio di autobus a corsa avviata (dalla pausa): si ricostruisce il modello con la nuova livrea e si ricopia lo
// stato di guida (posizione, velocità, porte, passeggeri, snodo, luci...), che è tutto fatto di numeri e booleani
function swapBusLivery(l) {
  if (!bus || bus.isTram || bus.livery === l) return;
  const old = bus, L = settings.line;
  const nb = new Bus(scene, { id: old.ledText[0], color: L.color, dest: old.ledText[1], livery: l, articulated: old.articulated });
  for (const [k, v] of Object.entries(old)) if ((typeof v === 'number' || typeof v === 'boolean') && k !== 'electric' && k !== 'articulated') nb[k] = v;
  nb.energy = old.energy;
  // le livree possono avere un numero diverso di porte
  nb.doorOpen = nb.doors.map((_, i) => old.doorOpen[Math.min(i, old.doorOpen.length - 1)]);
  nb.onShift = old.onShift;
  if (old.innerText) nb.setInnerDisplay(old.innerText);
  nb.setPassengerVisuals(old.passengers);
  nb.syncTransform();
  scene.remove(old.group);
  disposeTree(old.group);
  bus = nb;
}
function refreshMenu() {
  const L = settings.line;
  refreshLiveryPreviews();
  document.querySelectorAll('.line-card').forEach((el) => el.classList.toggle('sel', el.dataset.id === L.id));
  // direzioni principali (andata / ritorno) e tutte le varianti di percorso
  const [ia, ib] = L.pair;
  const dirBtns = document.querySelectorAll('#direction button');
  dirBtns[0].textContent = '→ ' + L.variants[ia].headsign;
  dirBtns[1].textContent = '← ' + L.variants[ib].headsign;
  dirBtns[1].disabled = ia === ib;
  dirBtns.forEach((b, k) => b.classList.toggle('sel', settings.vIdx === (k ? ib : ia)));
  const rv = $('route-variant');
  rv.innerHTML = L.variants.map((v, i) => `<option value="${i}">${v.headsign} · ${v.feriale.length} fer. / ${v.festivo.length} fest.</option>`).join('');
  rv.value = String(settings.vIdx);
  const v = curVariant();
  const deps = v[settings.variant];
  const first = v.stops[0], last = v.stops[v.stops.length - 1];
  $('dir-note').textContent = `${first.name} → ${last.name} · ${v.stops.length} fermate`;
  $('variant-note').textContent = `${settings.variant === 'feriale' ? 'Orario feriale (mercoledì tipo)' : 'Orario festivo (domenica)'} · ${deps.length} corse su questo percorso`;
  // corse reali del giorno scelto
  const sel = $('departure');
  const prev = settings.departure;
  sel.innerHTML = '';
  let best = 0, bestD = Infinity;
  deps.forEach((dp, i) => {
    const o = document.createElement('option');
    o.value = i;
    const tn = L.tram ? null : turnoOf(L, settings.variant, v, dp.t);
    o.textContent = `${fmtHM(dp.t)} → ${fmtHM(dp.t + tripDuration(v, dp.d))}${hourTag(dp.t)}${tn && tn.first && canLeaveDepot(v) ? ' · 🅿️ dal deposito' : tn && tn.last && depot ? ' · poi in deposito' : ''}`;
    sel.appendChild(o);
    const d = Math.abs(dp.t - (prev || 8.25 * 3600));
    if (d < bestD) { bestD = d; best = i; }
  });
  $('start').disabled = !deps.length;
  if (!deps.length) {
    sel.innerHTML = '<option>Nessuna corsa in questo giorno: scegli un altro percorso</option>';
    $('stop-list').innerHTML = v.stops.map((s) => `<li><span>${s.name}</span><span class="t">--:--</span></li>`).join('');
    return;
  }
  sel.selectedIndex = best;
  settings.departure = deps[best].t;
  settings.depDur = deps[best].d;
  refreshStops();
}
function refreshStops() {
  const v = curVariant();
  const times = scheduleFor(v, settings.departure, settings.depDur);
  $('stop-list').innerHTML = v.stops.map((s, i) => `<li class="${i === 0 || i === v.stops.length - 1 ? 'term' : ''}"><span>${s.name}</span><span class="t">${fmtHM(times[i])}</span></li>`).join('');
  refreshTurno();
}
// posto della corsa nel turno del bus (ricavato dall'orario); la prima del turno può uscire dal deposito
function refreshTurno() {
  const L = settings.line, tn = settings.mode !== 'service' ? null : turnoOf(L, settings.variant, curVariant(), settings.departure);
  let txt = '';
  if (tn) {
    const mezzo = L.tram ? 'tram' : 'bus';
    txt = tn.of === 1 ? `Corsa unica del turno del ${mezzo}` : `Corsa ${tn.n} di ${tn.of} del turno del ${mezzo}`;
    const out = tn.first && canLeaveDepot(curVariant());
    if (out) txt += ' · esce dal deposito della Stanga';
    if (tn.last && depot && !L.tram) txt += out ? ' e poi ci rientra' : ' · l\'ultima: poi si rientra in deposito';
    if (L.tram && !tn.last) txt += ' · al capolinea B riparte con la corsa dopo';
  }
  $('turno-note').textContent = txt;
  $('from-depot').hidden = !(tn && tn.first && canLeaveDepot(curVariant()));
}

// elenco delle linee del mezzo scelto (autobus o tram)
function renderLines() {
  const tram = settings.vehicle === 'tram';
  // le linee del tram in costruzione (SIR2, SIR3) stanno nello stesso elenco, segnate a parte
  $('line-list').innerHTML = ALL_LINES.filter((L) => !!L.tram === tram).map((L) => `<div class="line-card${L.tram ? ' tram' : ''}${L.building ? ' building' : ''}" data-id="${L.id}" tabindex="0"><div class="badge${L.tram ? ' tram' : ''}" style="background:${L.color}">${L.tram ? '🚋 ' + L.id : L.id}</div><div><div class="nm">${L.headsign}${L.building ? ' <span class="cantiere">🚧 in costruzione</span>' : ''}</div><div class="nt">${L.building ? `${L.name} · ` : ''}${L.variants.length} percors${L.variants.length > 1 ? 'i' : 'o'} · ${L.variants.reduce((a, v) => a + v.feriale.length, 0)} corse feriali · ${L.variants.reduce((a, v) => a + v.festivo.length, 0)} festive${ARTICULATED_LINES.has(L.id) && !L.tram ? ' · 🚌 snodato 18 m' : ''}</div></div></div>`).join('');
  const pick = (el) => {
    settings.line = ALL_LINES.find((l) => l.id === el.dataset.id); settings.vIdx = settings.line.pair[0];
    // lo snodato della linea 10 parte con la livrea Busitalia Veneto (si può comunque cambiare)
    if (ARTICULATED_LINES.has(settings.line.id) && !settings.line.tram) {
      settings.livery = 'veneto';
      document.querySelectorAll('#livery button').forEach((b) => b.classList.toggle('sel', b.dataset.l === 'veneto'));
    }
    refreshMenu();
  };
  document.querySelectorAll('.line-card').forEach((el) => { el.addEventListener('click', () => pick(el)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(el); }); });
  // livrea e sterzo riguardano solo l'autobus
  $('livery-box').hidden = $('steer-box').hidden = tram;
  document.querySelectorAll('#vehicle button').forEach((b) => b.classList.toggle('sel', b.dataset.k === settings.vehicle));
}
function setVehicle(k) {
  settings.vehicle = k;
  if (!!settings.line.tram !== (k === 'tram')) {
    settings.line = k === 'tram' && TRAM_LINES[0] ? TRAM_LINES[0] : L24;
    settings.vIdx = settings.line.pair[0];
  }
  renderLines();
  refreshMenu();
}

// gamepad o volante collegato: avviso in corsa e riquadro nella pausa, con l'impostazione di volante e pedali
let padToasted = null;
function padChanged() {
  if (pad.connected && running && pad.pad.id !== padToasted) {
    padToasted = pad.pad.id;
    hud.toast(pad.standard || pad.calibration ? '🎮 Gamepad collegato: levetta sinistra per sterzare, grilletti per gas e freno'
      : '🎮 Volante collegato: imposta volante e pedali dalla pausa (P)', 'info');
  }
  updatePadBox();
}
function updatePadBox() {
  $('pause-pad').hidden = !pad.connected;
  if (!pad.connected) return;
  // "Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)" → nome senza i codici
  const name = pad.pad.id.replace(/\s*\(.*\)\s*$/, '').slice(0, 48) || 'Gamepad';
  $('pad-info').classList.toggle('learn', !!pad.learn);
  $('pad-info').textContent = pad.learn ? pad.learnText()
    : pad.calibration ? `🎮 ${name}: volante e pedali impostati.`
    : pad.standard ? `🎮 ${name}: levetta sinistra per sterzare, RT gas, LT freno; gli altri pulsanti sono nell'aiuto (I). Con un volante, impostalo qui sotto.`
    : `🎮 ${name}: imposta volante e pedali per guidare; i pulsanti principali vanno già.`;
  $('pad-learn').textContent = pad.learn ? 'Annulla' : pad.calibration ? '🎮 Imposta di nuovo volante e pedali' : '🎮 Imposta volante e pedali';
}

function buildMenu() {
  renderLines();
  const seg = (id, attr, fn) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    fn(b.dataset[attr]);
  }));
  seg('variant', 'v', (v) => { settings.variant = v; refreshMenu(); });
  seg('direction', 'd', (d) => { settings.vIdx = settings.line.pair[d === '1' ? 0 : 1]; refreshMenu(); });
  $('route-variant').addEventListener('change', (e) => { settings.vIdx = Number(e.target.value); refreshMenu(); });
  seg('weather', 'w', (w) => { settings.weather = w; });
  seg('mode', 'm', (m) => { settings.mode = m; $('mode-note').textContent = MODE_NOTE[m]; refreshTurno(); });
  seg('from-depot', 'f', (f) => { settings.fromDepot = f === '1'; });
  $('mode-note').textContent = MODE_NOTE[settings.mode];
  // meteo e ora della luce, sempre modificabili dalla pausa
  document.querySelectorAll('#pause-weather button').forEach((b) => b.addEventListener('click', () => {
    settings.weather = b.dataset.w;
    setWeatherNow();
    document.querySelectorAll('#pause-weather button, #weather button').forEach((x) => x.classList.toggle('sel', x.dataset.w === settings.weather));
  }));
  $('pause-hour').addEventListener('change', (e) => {
    settings.lightHour = e.target.value === '' ? null : Number(e.target.value);
    if (mission) setupWeatherAndTime();
  });
  // sensibilità dello sterzo: stessa scelta nel menu e nella pausa, ricordata in questo browser
  const steerBtns = document.querySelectorAll('#steer-sens button, #pause-steer-sens button');
  const markSteer = () => steerBtns.forEach((x) => x.classList.toggle('sel', Number(x.dataset.s) === settings.steerSens));
  $('pad-learn').addEventListener('click', () => { if (pad.learn) pad.cancelLearn(); else pad.startLearn(); });
  steerBtns.forEach((b) => b.addEventListener('click', () => {
    settings.steerSens = Number(b.dataset.s);
    try { localStorage.setItem(STEER_KEY, String(settings.steerSens)); } catch (e) { /* ignorato */ }
    markSteer();
  }));
  markSteer();
  seg('livery', 'l', (l) => { settings.livery = l; markLivery(l); });
  // pausa: stesso selettore del menu
  $('pause-livery').innerHTML = $('livery').innerHTML;
  document.querySelectorAll('#pause-livery button').forEach((b) => b.addEventListener('click', () => {
    settings.livery = b.dataset.l;
    markLivery(settings.livery);
    swapBusLivery(settings.livery);
    saveGame();
  }));
  seg('vehicle', 'k', (k) => setVehicle(k));
  $('departure').addEventListener('change', (e) => { const dp = curVariant()[settings.variant][Number(e.target.value)]; if (dp) { settings.departure = dp.t; settings.depDur = dp.d; refreshStops(); } });
  $('start').addEventListener('click', () => { if (touch.enabled) touch.goFullscreen(); startMission(); });
  $('help-close').addEventListener('click', () => onKeyPress('KeyI'));
  $('tp-close').addEventListener('click', () => openTeleport(false));
  $('resume').addEventListener('click', () => togglePause(false));
  $('pause-btn').addEventListener('click', () => togglePause(true));
  // mappa grande: trascinando si sposta; un clic senza trascinare su una strada teletrasporta
  let mapDrag = null;
  $('minimap').addEventListener('pointerdown', (ev) => {
    if (!running || !hud.big) return;
    mapDrag = { x: ev.clientX, y: ev.clientY, moved: false };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  });
  $('minimap').addEventListener('pointermove', (ev) => {
    if (!mapDrag || !hud.bigView) return;
    const dx = ev.clientX - mapDrag.x, dy = ev.clientY - mapDrag.y;
    if (!mapDrag.moved && Math.hypot(dx, dy) < 5) return;
    mapDrag.moved = true;
    ev.currentTarget.classList.add('dragging');
    const k = hud.bigView.W / ev.currentTarget.getBoundingClientRect().width; // pixel dello schermo → del disegno
    hud.panBigMap(dx * k, dy * k);
    mapDrag.x = ev.clientX; mapDrag.y = ev.clientY;
  });
  $('minimap').addEventListener('pointerup', (ev) => {
    ev.currentTarget.classList.remove('dragging');
    const d = mapDrag;
    mapDrag = null;
    if (!d || d.moved || !running || !hud.big || !hud.bigView) return;
    const rect = ev.currentTarget.getBoundingClientRect(), v = hud.bigView;
    const px = ((ev.clientX - rect.left) / rect.width) * v.W, py = ((ev.clientY - rect.top) / rect.height) * v.H;
    teleportTo(v.cx + (px - v.W / 2) / v.scale, v.cz + (py - v.H / 2) / v.scale);
    hud.setBigMap(false);
  });
  $('minimap').addEventListener('pointercancel', (ev) => { ev.currentTarget.classList.remove('dragging'); mapDrag = null; });
  $('resume-save').addEventListener('click', () => { if (touch.enabled) touch.goFullscreen(); resumeSaved(); });
  $('discard-save').addEventListener('click', clearSave);
  $('restart').addEventListener('click', () => { clearSave(); togglePause(false); startMission(); });
  refreshResumeBox();
  $('quit').addEventListener('click', backToMenu);
  $('res-menu').addEventListener('click', backToMenu);
  $('res-next').addEventListener('click', chainNext);
  $('res-depot').addEventListener('click', toDepot);
  refreshMenu();
}

function backToMenu() {
  if (mission && !mission.finished) {
    const missionDetails = {
      vehicle_type: bus.isTram ? 'tram' : 'bus',
      mission_mode: mission.transfer ? 'transfer' : mission.roam ? 'roam' : mission.free ? 'free' : 'service',
      stops_completed: mission.nextStop,
    };
    capture('mission_abandoned', missionDetails);
    posthogGameLogger.warn('mission abandoned', missionDetails);
  }
  saveGame();
  touch.release();
  togglePause(false);
  buses.clear();
  refreshResumeBox();
  $('results').classList.add('hidden');
  $('menu').classList.remove('hidden');
  hud.show(false);
  running = false;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  audio.setMuted(true);
}

// ------------------------------------------------------------------
// Avvio di una corsa
// ------------------------------------------------------------------
function disposeMission() {
  const kill = (o) => { if (!o) return; scene.remove(o); };
  if (bus) kill(bus.group);
  if (mission) kill(mission.crowd.mesh);
  if (traffic) { kill(traffic.mesh); kill(traffic.lightMesh); }
  if (walkers) kill(walkers.mesh);
}

function startMission(resume = null) {
  audio.init();
  audio.resume();
  audio.setMuted(!!audio.muted);
  disposeMission();
  const L = settings.line;
  const V = curVariant();
  const destName = V.stops[V.stops.length - 1].name;
  if (L.tram) {
    // tram: la corsia del verso di marcia sulla sede della linea (in giro libero tutta la linea)
    const T = city.tramTracks[L.id] || city.tramTrack;
    const tr = tramRoute(T, V, L.modules, settings.mode !== 'service');
    V.trackPath = tr.path;
    bus = new Tram(scene, { line: L.id, dest: destName, modules: L.modules, path: tr.path, track: T, dir: tr.sig, offset: tr.offset });
    bus.onRerail = () => hud.toast('🛠️ Il tram è stato rimesso sulla rotaia: puoi ripartire', 'info');
    // in servizio gli scambi dei capolinea si mettono da soli per l'arrivo: diritto dove si passa sull'altro binario
    // dopo il cambio cabina (lo si gira con B), deviato dove si passa prima. In Esplorazione e Giro libero si comincia
    // con tutti deviati, come li lascia la manovra
    for (const t of Object.values(T.terminals || {})) if (t) setSwitch(t, settings.mode !== 'service' || t.field === 'arr' ? 'deviato' : 'diritto');
  } else {
    bus = new Bus(scene, { id: L.id, color: L.color, dest: destName, livery: settings.livery, articulated: ARTICULATED_LINES.has(L.id) });
  }
  resetLook(false);
  bus.onShift = () => audio.shift();
  // prima corsa del turno: si parte dal deposito, fuori servizio fino al capolinea
  const tn = !resume && settings.mode === 'service' && !L.tram && depot ? turnoOf(L, settings.variant, V, settings.departure) : null;
  mission = tn && tn.first && settings.fromDepot && canLeaveDepot(V) ? depotExit(V) : null;
  if (!mission) mission = new Mission({ ...missionCommon(), route: V, departure: settings.departure, depDur: settings.depDur, free: settings.mode !== 'service', roam: settings.mode === 'roam' });
  bus.noDerail = settings.mode === 'roam';
  // fuori servizio (giro libero, esplorazione) il limitatore arriva a 120 km/h e non c'è traffico simulato: niente auto,
  // bus e tram automatici
  const service = settings.mode === 'service';
  bus.vmax = service ? bus.vmaxService : FREE_VMAX;
  // tram automatici: quelli in servizio all'ora della corsa secondo l'orario GTFS; la corsa che guida il giocatore
  // non ha un gemello automatico
  trams.setService(service ? TRAM_LINES : [], settings.variant, bus.isTram && service ? { v: V, t: settings.departure } : null);
  // e nemmeno quella dopo del turno, che al capolinea parte con B
  const after = bus.isTram && nextOfTurno();
  if (after && after.next) trams.exclude({ v: after.next.v, t: after.next.t });
  cabAfterDoors = false;
  if (!mission.transfer) mission.dest = destName;
  const st0 = mission.stops[0];
  if (mission.transfer) {
    bus.setDestination('', 'Fuori servizio');
    clearSave(); // il fuori servizio non si salva: niente corsa vecchia da riprendere
  } else if (bus.isTram) {
    // il muso alla fine della banchina della prima fermata
    bus.setFront(st0.s - 0.5);
    mission.s = Math.max(0, st0.s - 0.5 - TRAM.ref);
  } else {
    const q = stopPose(mission.route, st0); // accostato al cordolo vero della fermata
    bus.place(q.x, q.z, q.h);
    mission.s = Math.max(0, st0.s - 6.5);
    if (settings.mode === 'service') placeChargers(mission);
  }
  // batteria all'inizio: piena uscendo dal deposito, altrimenti il 5% in meno per ogni ora di servizio dalle 5:30
  if (!bus.isTram) bus.battery = mission.transfer ? 1 : Math.max(0.15, Math.min(1, 1 - 0.05 * (settings.departure - 5.5 * 3600) / 3600));
  plug = null; chargeHint = null;
  chargers.release();
  bus.setInnerDisplay(mission.transfer ? 'Fuori servizio' : 'Linea ' + L.id + ' – ' + destName);
  if (resume) applySave(resume);
  city.ensureTiles(bus.x, bus.z, 650);
  // bus automatici: le corse in servizio a quell'ora (non quella del giocatore), prima delle auto che li evitano
  buses.setService(service ? LINES : [], settings.variant, !bus.isTram && service ? { v: V, t: settings.departure } : null);
  buses.schedule(mission.clock, bus);
  buses.updateParts();
  lights.time = mission.clock;
  const hour = (settings.departure / 3600) % 24;
  const busy = hour < 6 ? 0.3 : hour < 7 ? 0.6 : (hour > 7 && hour < 9.3) || (hour > 17 && hour < 19.5) ? 1.3 : hour < 21 ? 0.9 : 0.4;
  const count = service ? Math.round(55 * busy * (settings.variant === 'festivo' ? 0.6 : 1)) : 0;
  traffic = new Traffic(scene, net, city, lights, { count, seed: Math.floor(settings.departure) });
  traffic.bigs = buses.buses;
  walkers = new Walkers(scene, net, Math.round(140 * (settings.variant === 'festivo' ? 1.2 : 1) * (hour > 21 || hour < 6.5 ? 0.3 : 1)), city);
  for (let i = 0; i < count; i++) traffic.spawn(bus, 60, 1400);
  for (let i = 0; i < walkers.target; i++) walkers.spawn(bus);
  wireMission();
  turno = { corse: 0, score: 0, odo: bus.odometer, depot: !!mission.transfer };
  hud.setLine(mission.transfer ? { id: L.id, color: OFF_COLOR } : L, mission.transfer ? 'Fuori servizio' : destName);
  hud.show(true);
  hud.setBigMap(false);
  $('menu').classList.add('hidden');
  running = true;
  paused = false;
  $('pause').classList.add('hidden');
  if (!resume) camMode = 0;
  initWeather(resume && resume.weather);
  setupWeatherAndTime(true);
  const night = mission._night || 0;
  if (!resume) bus.lights = night > 0.3 || wx.rain > 0.3 || wx.fog > 0.3;
  saveTimer = 0;
  const missionDetails = {
    vehicle_type: bus.isTram ? 'tram' : 'bus',
    mission_mode: mission.roam ? 'roam' : mission.free ? 'free' : 'service',
    line_id: L.id,
    service_day: settings.variant,
    weather: settings.weather,
  };
  capture(resume ? 'mission_resumed' : 'mission_started', missionDetails);
  posthogGameLogger.info(resume ? 'mission resumed' : 'mission started', missionDetails);
  if (resume) {
    hud.setLine(mission.free ? { id: L.id, color: L.color } : L, mission.roam ? 'Esplorazione' : mission.free ? 'Giro libero' : destName);
    hud.toast(`Corsa ripresa alle ${fmtHM(mission.clock)}: ${resume.summary}`, 'info');
    setTimeout(() => running && hud.toast('Freno di stazionamento inserito: premi W per ripartire', 'info'), 1600);
  } else if (mission.roam) {
    hud.setLine({ id: L.id, color: L.color }, 'Esplorazione');
    hud.toast('Esplorazione: vai dove vuoi, nessuna regola né punteggio', 'info');
  } else if (mission.free) {
    hud.setLine({ id: L.id, color: L.color }, 'Giro libero');
    hud.toast('Giro libero: esplora Padova, rispetta semafori e limiti', 'info');
  } else if (mission.transfer) {
    hud.toast(`🅿️ Si esce dal deposito fuori servizio: al capolinea ${mission.dest} entro le ${fmtHM(mission.arriveBy)} (${(mission.route.length / 1000).toFixed(1).replace('.', ',')} km)`, 'info');
    setTimeout(() => running && hud.toast(`Poi la linea ${L.id} per ${destName} parte alle ${fmtHM(settings.departure)}`, 'info'), 2400);
  } else {
    hud.toast(`Linea ${L.id} per ${destName} – partenza ${fmtHM(settings.departure)}`, 'info');
    setTimeout(() => running && hud.toast('Apri le porte (F) per far salire i passeggeri', 'info'), 1800);
  }
  if (!resume && bus.isTram) setTimeout(() => running && hud.toast('🚋 Tram: W/S manipolatore · F porte · H campanello · O pantografo · B cambio cabina · N scambio', 'info'), 3200);
  if (!resume) setTimeout(() => running && hud.toast('Premi I per l\'elenco dei comandi', 'info'), 4500);
  saveGame();
}

// ------------------------------------------------------------------
// Bus elettrico: batteria, colonnine di ricarica ai capolinea, recupero in frenata
// ------------------------------------------------------------------
let plug = null; // colonnina a cui il bus è attaccato (pantografo giù o in discesa)
let chargeHint = null; // colonnina per cui si è già dato il suggerimento
let lastBattery = 1;
const fmtKwh = (k) => k.toFixed(1).replace('.', ',');
// ai capolinea veri della corsa: non dove la linea è tagliata al bordo della mappa
function placeChargers(m) {
  const V = m.route, ends = [];
  if (!V.cutStart) ends.push(m.stops[0]);
  if (!V.cutEnd) ends.push(m.stops[m.stops.length - 1]);
  for (const st of ends) chargers.add(stopPose(V, st), Math.sign(st.kl ?? st.kerb ?? st.hw) || 1);
}
// O col bus elettrico: fermo sotto la colonnina abbassa il pantografo, di nuovo O lo alza
function chargeKey() {
  if (!bus.electric) { hud.toast('Questo autobus va a gasolio: niente ricarica', 'info'); return; }
  if (plug) { plug.target = 0; plug = null; hud.toast('Pantografo della colonnina su', 'info'); return; }
  const c = chargers.at(bus);
  if (!c) { hud.toast('Qui non c\'è una colonnina: le colonnine di ricarica sono ai capolinea, sopra la fermata', 'info'); return; }
  if (Math.abs(bus.v) > 0.1) { hud.toast('Fermati sotto la colonnina prima di abbassare il pantografo', 'bad'); return; }
  plug = c; c.target = 1;
  audio.noiseBurst({ dur: 1.2, freq: 900, gain: 0.12 });
  hud.toast(`🔌 Pantografo della colonnina giù: ricarica a ${CHARGE_KW} kW`, 'info');
}
// dClock: tempo della corsa nel passo (in sosta può correre più del gioco)
function chargeStep(dt, dClock) {
  if (bus.isTram || !bus.electric) {
    if (plug) { plug.target = 0; plug = null; }
    chargers.update(dt, null);
    return;
  }
  // ripartire col pantografo giù rovina il pattino e le barre del tetto
  if (plug && Math.abs(bus.v) > 0.3) {
    if (plug.pos > 0.3) mission.addScore(-100, '⚡ Ripartito con il pantografo della colonnina abbassato!');
    plug.target = 0; plug = null;
  }
  let kw = 0;
  if (plug && plug.down) {
    // sopra il 90% la colonnina riduce la potenza; a batteria piena alza il pantografo da sola
    kw = CHARGE_KW * Math.min(1, (1 - bus.battery) / 0.1);
    if (bus.battery > 0.995) { plug.target = 0; plug = null; kw = 0; hud.toast('🔋 Batteria carica: il pantografo della colonnina si alza', 'good'); }
  }
  bus.energyTick(dClock, kw);
  chargers.update(dt, plug);
  // fermo sotto una colonnina senza caricare: un suggerimento per colonnina
  const under = !plug && Math.abs(bus.v) < 0.1 && bus.battery < 0.95 ? chargers.at(bus) : null;
  if (under && under !== chargeHint) { chargeHint = under; hud.toast('🔌 Sei sotto la colonnina di ricarica: premi O per abbassare il pantografo', 'info'); }
  if (Math.abs(bus.v) > 2) chargeHint = null;
  if (bus.battery < 0.2 && lastBattery >= 0.2) hud.toast('🔋 Batteria al 20%: ricarica alla colonnina del capolinea (O)', 'bad');
  if (bus.battery < 0.1 && lastBattery >= 0.1) hud.toast('🔋 Batteria al 10%: potenza ridotta, ricarica al capolinea', 'bad');
  lastBattery = bus.battery;
}
// a fine corsa: punti per l'energia recuperata in frenata (20 punti al kWh)
function energyBonus(m) {
  if (bus.isTram || !bus.electric) return;
  const pts = Math.round(bus.energy.regen * 20);
  if (pts > 0) m.addScore(pts, `🔋 Recupero in frenata: ${fmtKwh(bus.energy.regen)} kWh`);
}

// ------------------------------------------------------------------
// Turno: corse una dopo l'altra con lo stesso bus, dall'uscita dal deposito al rientro
// ------------------------------------------------------------------
const OFF_COLOR = '#607d8b'; // linea fuori servizio
let turno = null; // { corse, score, odo, depot }
function missionCommon() {
  return { scene, net, line: settings.line, day: settings.variant, hud, audio, lights, city };
}
function wireMission() {
  const m = mission;
  greet = new Greetings(hud, m);
  m.onFinish = m.transfer ? () => transferDone(m) : () => { energyBonus(m); setTimeout(() => mission === m && showResults(), 3500); };
  lastBattery = bus.battery;
}
// la corsa finita entra nel conto del turno (una volta sola: il tram può ripartire prima del riepilogo)
function countRun(m) {
  if (m.counted) return;
  m.counted = true;
  turno.corse++;
  turno.score += m.score;
}
function switchMission(m) {
  scene.remove(mission.crowd.mesh);
  mission = m;
  wireMission();
}
// dal deposito si arriva alla prima fermata nel verso giusto? (no dove la variante parte da una strada chiusa al bordo
// della mappa, come i "tratti in città" delle linee che escono da Padova)
const depotReach = new Map();
function canLeaveDepot(V) {
  if (!depot || V.tram) return false;
  if (!depotReach.has(V)) {
    const goal = startGoal(net, city, V);
    depotReach.set(V, !!findPath(net, depot.out, goal.node, { notFrom: depot.node, notInto: goal.notInto }));
  }
  return depotReach.get(V);
}
// il bus esce dalla sbarra del deposito, sulla corsia di destra, e va fuori servizio alla prima fermata della corsa
function depotExit(V) {
  const g = depot, lat = g.hw / 2;
  bus.place(g.x + g.dx * 9 - g.dz * lat, g.z + g.dz * 9 + g.dx * lat, Math.atan2(g.dx, g.dz));
  const goal = startGoal(net, city, V), plan = planTransfer(net, city, bus.x, bus.z, bus.h, goal);
  return plan ? new Transfer({ ...missionCommon(), kind: 'uscita', goal, plan, arriveBy: settings.departure - 120 }) : null;
}
function transferDone(m) {
  turno.score += m.score;
  if (m.transfer === 'rientro') setTimeout(showShiftEnd, 2500);
  else beginService();
}
// alla fermata di partenza (arrivando dal deposito o dalla corsa prima): comincia il servizio
function beginService() {
  const L = settings.line, V = curVariant(), dest = V.stops[V.stops.length - 1].name, clock = mission.clock;
  const m = new Mission({ ...missionCommon(), route: V, departure: settings.departure, depDur: settings.depDur });
  m.clock = clock;
  m.s = projectOnRoute(m.route, bus.x, bus.z, m.stops[0].s, 400, 400, bus.h).s;
  m.dest = dest;
  switchMission(m);
  placeChargers(m);
  bus.energy = { used: 0, regen: 0 };
  buses.exclude({ v: V, t: settings.departure });
  bus.setDestination(L.id, dest);
  bus.setInnerDisplay('Linea ' + L.id + ' – ' + dest);
  hud.setLine(L, dest);
  hud.toast(`Linea ${L.id} per ${dest} – partenza ${fmtHM(settings.departure)}: apri le porte (F)`, 'info');
  capture('mission_started', { vehicle_type: 'bus', mission_mode: 'service', line_id: L.id, service_day: settings.variant, weather: settings.weather, turno_run: turno.corse + 1 });
  saveGame();
}
function nextOfTurno() {
  if (settings.mode !== 'service') return null;
  const tn = turnoOf(settings.line, settings.variant, curVariant(), settings.departure);
  return tn ? { tn, next: tn.run.next } : null;
}
// al capolinea: la corsa successiva del turno, dalla fermata di partenza (se il bus non c'è già, fuori servizio fin lì)
function chainNext() {
  const t = nextOfTurno(), next = t && t.next;
  if (!next) return;
  // tram: si cambia cabina (B) e la corsa riparte dall'altro verso
  if (bus.isTram) { changeTramCab(); return; }
  $('results').classList.add('hidden');
  Object.assign(settings, { vIdx: next.v.idx, departure: next.t, depDur: next.d });
  const L = settings.line, V = next.v, dest = V.stops[V.stops.length - 1].name, goal = startGoal(net, city, V);
  const pr = projectOnRoute(goal.route, bus.x, bus.z, goal.s, 1e9, 1e9, bus.h);
  const atStart = pr.d < 8 && pr.s < goal.s + 8 && goal.s - pr.s < 300;
  const plan = atStart ? null : planTransfer(net, city, bus.x, bus.z, bus.h, goal);
  if (!plan) {
    // nessuna strada fin lì nel verso giusto (partenza al bordo della mappa: il giro fino al capolinea vero è fuori
    // mappa): il bus va alla fermata di partenza
    if (!atStart) {
      const q = stopPose(goal.route, goal.route.stops[0]);
      placeBusAt(q.x, q.z, q.h);
      hud.toast(V.cutStart ? `🌀 Giro al capolinea fuori mappa: riparti da ${goal.stop.name}` : `🌀 Il bus è alla fermata di partenza ${goal.stop.name}`, 'info');
    }
    beginService();
    return;
  }
  switchMission(new Transfer({ ...missionCommon(), kind: 'spostamento', goal, plan, clock: mission.clock, arriveBy: next.t - 60 }));
  bus.setDestination(L.id, dest);
  bus.setInnerDisplay('Linea ' + L.id + ' – ' + dest);
  hud.setLine({ id: L.id, color: OFF_COLOR }, 'Verso la partenza');
  hud.toast(`🚏 Raggiungi la fermata di partenza ${goal.stop.name}: la linea ${L.id} per ${dest} parte alle ${fmtHM(next.t)}`, 'info');
}
// fine turno: fuori servizio fino alla sbarra del deposito
function toDepot() {
  $('results').classList.add('hidden');
  const g = depot, goal = { node: g.node, notInto: null, tail: [], at: -10, stop: { id: 'deposito', name: DEPOT_NAME, x: g.x, z: g.z, importance: 1 } };
  const plan = planTransfer(net, city, bus.x, bus.z, bus.h, goal);
  if (!plan) { hud.toast('Il navigatore non trova la strada per il deposito', 'bad'); showShiftEnd(); return; }
  switchMission(new Transfer({ ...missionCommon(), kind: 'rientro', goal, plan, clock: mission.clock }));
  bus.setDestination('', 'Fuori servizio');
  bus.setInnerDisplay('Fuori servizio');
  hud.setLine({ id: settings.line.id, color: OFF_COLOR }, 'Fuori servizio → ' + DEPOT_NAME);
  hud.toast(`🅿️ Rientro in deposito: segui il navigatore fino alla sbarra (${(mission.route.length / 1000).toFixed(1).replace('.', ',')} km)`, 'info');
  clearSave();
}
// riepilogo del turno, al rientro in deposito
function showShiftEnd() {
  clearSave();
  const km = (bus.odometer - turno.odo) / 1000;
  $('res-title').textContent = 'Turno finito: bus in deposito';
  $('res-stars').textContent = '🅿️';
  $('res-score').textContent = turno.score + ' punti';
  const rows = [['Corse fatte', turno.corse], ['Chilometri percorsi', km.toFixed(1).replace('.', ',')], ['Rientro in deposito', fmtHM(mission.clock, true)]];
  $('res-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  $('res-turno').textContent = '';
  $('res-next').hidden = $('res-depot').hidden = true;
  $('res-menu').textContent = 'Nuova corsa';
  $('res-menu').classList.add('primary');
  $('results').classList.remove('hidden');
  capture('shift_completed', { line_id: settings.line.id, runs: turno.corse, final_score: turno.score, km: Math.round(km * 10) / 10 });
}

function showResults() {
  if (!mission) return;
  clearSave();
  countRun(mission);
  const s = mission.stats;
  const n = mission.stops.length;
  const maxPts = n * 130 + 400;
  const ratio = mission.score / maxPts;
  const stars = ratio > 0.75 ? 3 : ratio > 0.45 ? 2 : ratio > 0.15 ? 1 : 0;
  $('res-title').textContent = `Linea ${mission.line.id} – capolinea ${mission.dest}`;
  $('res-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('res-score').textContent = mission.score + ' punti';
  const rows = [
    ['Passeggeri saliti / scesi', `${s.boarded} / ${s.alighted}`],
    ['Fermate puntuali', `${s.onTime} su ${n - 1}`],
    ['Fermate in ritardo', s.late],
    ['Fermate saltate', s.skipped],
    ['Comfort medio', Math.round(mission.avgComfort || 100) + '%'],
    ['Frecce usate correttamente', s.indicatorsOk],
    ['Saluti ai colleghi', s.waves || 0],
    ['Incidenti', s.crashes],
    ['Semafori rossi', s.redLights],
    ['Multe per velocità', s.speeding],
    ['Salite sul marciapiede', s.sidewalk],
    ['Arrivo al capolinea', fmtHM(mission.clock, true)],
  ];
  if (bus.electric && !bus.isTram) rows.splice(rows.length - 1, 0, ['Energia', `${fmtKwh(bus.energy.used)} kWh usati, ${fmtKwh(bus.energy.regen)} recuperati in frenata · batteria ${Math.round(bus.battery * 100)}%`]);
  $('res-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  // al capolinea: la corsa dopo del turno, il rientro in deposito o il menu
  const t = nextOfTurno(), next = t && t.next;
  $('res-next').hidden = !next;
  if (next) {
    const wait = Math.round((next.t - mission.clock) / 60);
    const fuori = curVariant().cutEnd || next.v.cutStart; // il giro fino al capolinea vero è fuori mappa
    $('res-next').textContent = `▶ Prossima corsa${bus.isTram ? ' (B)' : ''}: ${next.v.headsign} alle ${fmtHM(next.t)} (${wait > 0 ? `${fuori ? 'giro al capolinea fuori mappa e sosta' : 'sosta'}: ${wait} min` : 'sei in ritardo: si riparte subito'})`;
  }
  $('res-depot').hidden = !t || !depot || bus.isTram; // il tram non ha ancora il suo deposito
  $('res-depot').classList.toggle('primary', !next);
  $('res-menu').classList.toggle('primary', !next && $('res-depot').hidden);
  $('res-menu').textContent = t ? 'Torna al menu' : 'Nuova corsa';
  const parts = [];
  if (turno.corse > 1 || turno.depot) parts.push(`Turno: ${turno.corse} ${turno.corse > 1 ? 'corse' : 'corsa'}, ${turno.score} punti in tutto`);
  if (t && !next && depot && !bus.isTram) parts.push('Era l\'ultima corsa del turno: il bus torna in deposito.');
  else if (t && !next) parts.push('Era l\'ultima corsa del turno.');
  $('res-turno').textContent = parts.join(' · ');
  $('results').classList.remove('hidden');
}

// ------------------------------------------------------------------
// Ora del giorno e meteo
// ------------------------------------------------------------------
// Meteo: valori continui che sfumano (nuvole, pioggia, nebbia, asfalto bagnato).
// Con "Variabile" si parte col sereno e un piccolo programma alterna pioggia o nebbia.
const wx = { cloud: 0, rain: 0, fog: 0, wet: 0, target: { cloud: 0, rain: 0, fog: 0 }, phase: 'clear', next: 0 };
const WX_PRESET = { clear: { cloud: 0, rain: 0, fog: 0 }, rain: { cloud: 1, rain: 1, fog: 0 }, fog: { cloud: 0.8, rain: 0, fog: 1 } };
const rand = (a, b) => a + Math.random() * (b - a);
// meteo scelto dalla pausa: subito, senza sfumare (con "Variabile" si riparte dal sereno)
function setWeatherNow() {
  const p = WX_PRESET[settings.weather] || WX_PRESET.clear;
  Object.assign(wx, p, { wet: p.rain, target: { ...p }, phase: 'clear', next: rand(80, 160) });
  if (mission) setupWeatherAndTime();
}
function initWeather(saved) {
  if (saved && saved.target) { Object.assign(wx, saved, { target: { ...saved.target } }); return; }
  const p = WX_PRESET[settings.weather] || WX_PRESET.clear;
  Object.assign(wx, p, { wet: p.rain, target: { ...p }, phase: 'clear', next: rand(80, 160) });
}
function updateWeather(dt) {
  if (settings.weather === 'variable' && (wx.next -= dt) <= 0) {
    if (wx.phase === 'clear') {
      wx.phase = 'clouds'; wx.target = { cloud: 0.65, rain: 0, fog: 0 }; wx.next = rand(45, 75);
      hud.toast('☁️ Il cielo si sta coprendo…', 'info');
    } else if (wx.phase === 'clouds') {
      if (Math.random() < 0.6) {
        wx.phase = 'rain'; wx.target = { cloud: 1, rain: rand(0.6, 1), fog: 0 };
        hud.toast('🌧️ Comincia a piovere: la frenata si allunga, accendi i fari (L)', 'info');
      } else {
        wx.phase = 'fog'; wx.target = { cloud: 0.8, rain: 0, fog: rand(0.75, 1) };
        hud.toast('🌫️ Arriva la nebbia: rallenta e accendi i fari (L)', 'info');
      }
      wx.next = rand(150, 300);
    } else {
      hud.toast(wx.phase === 'rain' ? '🌤️ Smette di piovere, le strade restano bagnate per un po\'' : '🌤️ La nebbia si dirada', 'info');
      wx.phase = 'clear'; wx.target = { cloud: 0, rain: 0, fog: 0 }; wx.next = rand(120, 240);
    }
  }
  // velocità delle transizioni: la pioggia arriva solo con le nuvole, la nebbia sale e si dirada lenta
  const ease = (k, up, down) => { const d = wx.target[k] - wx[k]; wx[k] += Math.sign(d) * Math.min(Math.abs(d), dt / (d > 0 ? up : down)); };
  ease('cloud', 35, 50);
  ease('rain', 25, 20);
  ease('fog', 50, 60);
  wx.rain = Math.min(wx.rain, wx.cloud + 0.05);
  // l'asfalto si bagna in fretta e asciuga piano
  wx.wet += wx.rain > wx.wet ? (wx.rain - wx.wet) * Math.min(1, dt / 8) : -Math.min(wx.wet - wx.rain, dt / 150);
  const changing = Math.abs(wx.target.cloud - wx.cloud) + Math.abs(wx.target.rain - wx.rain) + Math.abs(wx.target.fog - wx.fog) > 0.002 || Math.abs(wx.wet - wx.rain) > 0.01;
  return changing;
}

const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const lerp = THREE.MathUtils.lerp;
function setupWeatherAndTime() {
  const hour = settings.lightHour != null ? settings.lightHour : ((mission.clock / 3600) % 24 + 24) % 24;
  const t = (hour - 6.6) / (18.9 - 6.6); // 0 alba, 1 tramonto
  const elev = Math.sin(Math.PI * t);
  const az = Math.PI * t;
  const day = THREE.MathUtils.smoothstep(elev, -0.08, 0.25);
  const golden = THREE.MathUtils.smoothstep(elev, -0.1, 0.05) * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.35));
  const overcast = Math.min(1, Math.max(wx.cloud * 0.85, wx.fog * 0.7));
  const dim = Math.min(1, overcast / 0.7); // 0 sereno, 1 coperto
  const night = 1 - day;
  mission._night = night;
  // colori del cielo
  const dayTop = new THREE.Color(0x3d78c0), dayBot = new THREE.Color(0xd5e6f0);
  const nightTop = new THREE.Color(0x050914), nightBot = new THREE.Color(0x1a2238);
  const sunsetBot = new THREE.Color(0xf0a060);
  const grey = new THREE.Color(0x9aa3ab);
  tmpC.copy(nightTop).lerp(dayTop, day).lerp(grey.clone().multiplyScalar(0.25 + day * 0.6), overcast);
  tmpC2.copy(nightBot).lerp(dayBot, day).lerp(sunsetBot, golden * 0.7 * (1 - overcast)).lerp(grey.clone().multiplyScalar(0.3 + day * 0.7), overcast);
  skyU.top.value.copy(tmpC);
  skyU.bottom.value.copy(tmpC2);
  skyU.night.value = night * (1 - overcast);
  const sd = new THREE.Vector3(Math.cos(az) * Math.max(0.2, 1 - Math.abs(elev)), Math.max(0.05, elev), 0.35).normalize();
  skyU.sunDir.value.copy(sd);
  skyU.sunCol.value.set(golden > 0.3 ? 0xffb070 : 0xfff2d0);
  sun.userData.dir = sd;
  sun.intensity = day * lerp(2.6, 0.5, dim) * (1 - golden * 0.4);
  sun.color.set(golden > 0.2 ? 0xffc890 : 0xfff2e0);
  hemi.intensity = 0.18 + day * lerp(0.9, 0.75, dim);
  hemi.color.copy(tmpC2).lerp(new THREE.Color(0xffffff), 0.4);
  ambient.intensity = 0.25 + night * 0.35;
  ambient.color.set(night > 0.5 ? 0x5060a0 : 0x8090b0);
  // nebbia
  const fogCol = tmpC2.clone();
  scene.fog.color.copy(fogCol);
  // visibilità: sfuma in scala logaritmica tra sereno, pioggia e nebbia
  const farClear = night > 0.5 ? 1800 : 2800;
  scene.fog.near = lerp(lerp(300, 30, wx.rain), 5, wx.fog);
  scene.fog.far = Math.exp(lerp(lerp(Math.log(farClear), Math.log(700), wx.rain), Math.log(140), wx.fog));
  renderer.toneMappingExposure = 1.0 + night * 0.25;
  city.setNight(night, wx.wet);
  traffic && traffic.setNight(night);
  trams && trams.setNight(night);
  buses && buses.setNight(night);
  if (bus) bus.cabinLightMat.emissiveIntensity = 0.2 + night * 0.8;
}

// ------------------------------------------------------------------
// Telecamere
// ------------------------------------------------------------------
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Qt = new THREE.Quaternion(), Qy = new THREE.Quaternion(), Ex = new THREE.Euler();
const chase = { pos: new THREE.Vector3(), init: false };
function updateCamera(dt) {
  const lookTarget = (keys.has('KeyZ') ? 1.1 : 0) + (keys.has('KeyX') ? -1.1 : 0);
  lookYaw += (lookTarget - lookYaw) * Math.min(1, dt * 5);
  bus.group.updateMatrixWorld(true);
  if (camMode === 0 || camMode === 2) {
    const e = camMode === 0 ? bus.cabEye || [0.62, 2.12, 4.8] : bus.paxEye || [-0.2, 2.05, -5.2];
    const local = V.set(e[0], e[1], e[2]);
    // visuale passeggeri dello snodato: in fondo al rimorchio
    const cabin = camMode === 0 || !bus.tBody ? bus.body : bus.tBody;
    cabin.localToWorld(local);
    // piccola vibrazione del motore
    const vib = (Math.random() - 0.5) * 0.004 * (0.3 + bus.throttle);
    camera.position.copy(local).add(V2.set(0, vib, 0));
    cabin.getWorldQuaternion(Qt);
    Ex.set((camMode === 0 ? -0.13 : -0.12) + mouseLook.pitch, Math.PI + lookYaw + mouseLook.yaw, 0, 'YXZ');
    Qy.setFromEuler(Ex);
    camera.quaternion.copy(Qt).multiply(Qy);
    camera.fov = camMode === 0 ? 68 : 75;
    chase.init = false;
  } else if (camMode === 1) {
    // la visuale esterna gira attorno al bus trascinando il mouse (o con Z/X)
    const oy = mouseLook.yaw + lookYaw * 1.4, cy = Math.cos(oy), sy = Math.sin(oy);
    if (bus.isTram) {
      // tram: la telecamera sta sopra la sede alle spalle del convoglio (nelle vie strette non entra nei palazzi)
      const mid = bus.at(bus.sFront - bus.facing * bus.length * 0.5), back = bus.at(bus.sFront - bus.facing * (bus.length + 9));
      const ox = back.x - mid.x, oz = back.z - mid.z;
      const target = V.set(mid.x + ox * cy + oz * sy, 9 + mouseLook.pitch * 10, mid.z - ox * sy + oz * cy);
      if (!chase.init) { chase.pos.copy(target); chase.init = true; }
      chase.pos.lerp(target, Math.min(1, dt * 3));
      camera.position.copy(chase.pos);
      const fr = bus.at(bus.sFront);
      camera.lookAt((mid.x + fr.x) / 2, 2, (mid.z + fr.z) / 2);
      camera.fov = 60;
      camera.updateProjectionMatrix();
      return;
    }
    const f = V2.set(bus.fx * cy + bus.fz * sy, 0, -bus.fx * sy + bus.fz * cy);
    const target = V.set(bus.x, bus.elev || 0, bus.z).addScaledVector(f, -(bus.chaseDist || 17)).add(new THREE.Vector3(0, (bus.isTram ? 8.5 : 6.5) + mouseLook.pitch * 10, 0));
    if (!chase.init) { chase.pos.copy(target); chase.init = true; }
    chase.pos.lerp(target, Math.min(1, dt * 3));
    camera.position.copy(chase.pos);
    camera.lookAt(bus.x + bus.fx * 5, 2.2 + (bus.elev || 0), bus.z + bus.fz * 5);
    camera.fov = 60;
  } else {
    camera.position.set(bus.x - bus.fx * 25, 75, bus.z - bus.fz * 25);
    camera.lookAt(bus.x + bus.fx * 10, 0, bus.z + bus.fz * 10);
    camera.fov = 55;
    chase.init = false;
  }
  camera.updateProjectionMatrix();
}

// draw: ridisegna anche le immagini (a disegni alterni); le cornici si mostrano o nascondono sempre
let mirrorsShown = null;
function updateMirrors(draw) {
  const show = camMode === 0;
  if (show !== mirrorsShown) { mirrorsShown = show; ['mirror-frame-l', 'mirror-frame-r'].forEach((id) => ($(id).style.display = show ? 'block' : 'none')); }
  if (!show || !draw) return show;
  const sides = [1, -1];
  for (let i = 0; i < 2; i++) {
    const s = sides[i];
    // regolazione dello specchietto: il punto guardato, 31 m dietro, si sposta in fuori e in basso
    const a = mirrorAdj[i];
    const p = bus.toWorld(s * 1.6, 6.1);
    const t = bus.toWorld(s * (2.6 + 31 * Math.tan(a.yaw)), -25);
    const cam = mirrorCams[i];
    cam.position.set(p.x, 2.45 + (bus.elev || 0), p.z);
    cam.lookAt(t.x, 0.9 - 31 * Math.tan(a.pitch) + (bus.elev || 0), t.z);
    renderer.setRenderTarget(mirrorRT[i]);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(null);
  return true;
}
let doorOn = false, renders = 0;
function updateDoorCam() {
  const on = camMode === 0 && !!bus && !bus.isTram && (bus.doorsAnyOpen || bus.doorTarget > 0 || bus.speedKmh < 5);
  if (on !== doorOn) {
    doorOn = on; doorQuad.visible = on; $('door-frame').style.display = on ? 'block' : 'none';
    // sul 12 m a due porte l'ultima è quella centrale
    if (on) $('door-frame').firstElementChild.textContent = `📷 Porta ${bus.doors.length === 2 ? 'centrale' : 'posteriore'}`;
  }
  if (!on) return false;
  // sopra l'ultima porta, appena fuori dalla fiancata, guarda in giù verso gradini e marciapiede
  const d = bus.doors[bus.doors.length - 1], zc = (d.z0 + d.z1) / 2;
  const at = (lx, lz) => (d.u ? bus.toWorldT(lx, lz) : bus.toWorld(lx, lz));
  const p = at(-1.45, zc + 1.3), t = at(-2.4, zc - 1.0), y = bus.elev || 0;
  doorCam.position.set(p.x, y + 3.0, p.z);
  doorCam.lookAt(t.x, y + 0.2, t.z);
  renderer.setRenderTarget(doorRT);
  renderer.render(scene, doorCam);
  renderer.setRenderTarget(null);
  return true;
}

// ------------------------------------------------------------------
// Loop principale
// ------------------------------------------------------------------
const world = {
  wet: false, offRoad: false, slope: 0, grade: 0,
  obstaclesNear: (x, z, r) => city.obstacles.query(x, z, r, world._o || (world._o = [])),
  carsNear: (x, z, r) => { const a = traffic ? traffic.near(x, z, r) : []; return trams ? a.concat(trams.near(x, z, r)) : a; },
};
let envTimer = 0, frame = 0, hudStreet = '', saveTimer = 0, kerbT = 0;
let lastT = performance.now();

// posizione dei tram lungo la sede (per gli incroci): automatici e, se c'è, quello del giocatore
const playerOcc = { player: true, front: 0, dir: 1, len: 0, v: 0, dwell: false };
function tramOccupancy() {
  const occ = trams.trams.map((tr) => ({ ref: tr, front: tr.s, dir: tr.dir, track: tr.track, len: tr.L, v: tr.v, dwell: tr.wait > 0 }));
  if (bus && bus.isTram) {
    Object.assign(playerOcc, { front: bus.pathOffset + bus.sFront, dir: bus.dirSig, track: bus.track, len: bus.length, v: bus.v, dwell: bus.doorsAnyOpen });
    occ.push(playerOcc);
  }
  return occ;
}

function step(dt) {
  readInput(dt);
  const wxChanging = updateWeather(dt);
  world.wet = wx.wet > 0.35;
  // superficie
  let onSidewalk = false;
  const mid = city.roadInfo(bus.x, bus.z);
  // la sede del tram è percorribile anche dal bus: dove la strada non basta si passa sui binari
  world.offRoad = mid.off > 5 && !city.onTramway(bus.x, bus.z, 0.3);
  // marciapiede: contano le ruote, non la carrozzeria che in curva sporge sopra il cordolo.
  // Le ruote posteriori tagliano le curve: più margine, e ancora di più a incroci, curve strette e rotonde.
  let kerb = false;
  // l'asse del rimorchio dello snodato taglia le curve ancora di più
  if (!bus.isTram) for (const p of bus.wheelProbes()) {
    const rear = p.rear;
    const ri = city.roadInfo(p.x, p.z);
    if (ri.off < 0.5 || ri.off > 6 || city.onTramway(p.x, p.z, 0.3)) continue;
    const tol = [0.5, 1.0, 1.3][rear];
    if (ri.off > tol && (ri.off > tol + (rear ? 0.9 : 0.5) || !city.kerbAllowance(p.x, p.z))) kerb = true;
  }
  // un tocco di un istante non conta
  kerbT = kerb ? kerbT + dt : 0;
  onSidewalk = kerbT > 0.3;
  const pf = bus.toWorld(0, 3.3), pr = bus.toWorld(0, -2.6);
  const hF = city.heightAt(pf.x, pf.z, bus.elev), hR = city.heightAt(pr.x, pr.z, bus.elev);
  world.slope = bus.isTram ? 0 : (hF - hR) / 5.9;
  world.grade = bus.isTram ? 0 : (terrain.at(pf.x, pf.z) - terrain.at(pr.x, pr.z)) / 5.9;
  bus.elev = bus.isTram ? 0 : (hF + hR) / 2 + (hF - hR) * (0.3 / 5.9);
  const hit = bus.update(dt, { ...input, wipers: wx.rain > 0.08, rain: wx.rain }, world);
  // il tram non deve finire dentro l'auto davanti: dopo un urto resta fermo
  if (hit && bus.isTram) bus.parking = bus.parking || hit.impact > 1.2;
  if (hit && hit.impact > 1.2 && !bus._crashCd) {
    audio.crash(hit.impact / 4);
    mission.onCrash(hit);
    bus._crashCd = 0.6;
  }
  if (bus._crashCd) bus._crashCd = Math.max(0, bus._crashCd - dt);
  if (cabAfterDoors && bus.doorsClosed && bus.doorTarget === 0) { cabAfterDoors = false; changeTramCab(); }
  // sbuffo dei freni ad aria quando ci si ferma
  const moving = Math.abs(bus.v) > 0.6;
  if (wasMoving && Math.abs(bus.v) < 0.05) audio.airBrake();
  if (moving) wasMoving = true; else if (Math.abs(bus.v) < 0.05) wasMoving = false;
  // frecce: suono e auto-spegnimento dopo la curva
  const blinkOn = bus.blink % 0.8 < 0.4;
  if (bus.indicator !== 0 && blinkOn !== lastBlinkOn) audio.tick(blinkOn);
  lastBlinkOn = blinkOn;
  if (bus.indicator === 1 || bus.indicator === -1) {
    indAccum += bus.yawRate * dt;
    if (Math.abs(indAccum) > 0.9 && Math.abs(bus.steerIn) < 0.12) { bus.indicator = 0; indAccum = 0; }
  }
  lights.update(dt);
  trams.update(dt, [bus, ...buses.parts, ...(traffic ? traffic.cars : [])], mission.clock);
  // incroci col tram: chiamata dei tram in arrivo, segnali a barre, precedenza delle auto
  tramSignals.update(dt, tramOccupancy(), traffic);
  if (bus.isTram && !mission.free) for (const x of tramSignals.violations) if (mission.cooldown('tsig', 5)) mission.addScore(-60, x.ap ? '🚦 Passato col rosso!' : '🚦 Passato col segnale del tram a via impedita (barra orizzontale)!');
  city.streamTiles(bus.x, bus.z, 5);
  traffic.update(dt, bus, { busAtStop: mission.atStop || bus.doorsAnyOpen, tramSignals, trams, bigs: buses.buses });
  buses.update(dt, { player: bus, traffic, trams, lights, clock: mission.clock });
  // colleghi da salutare: bus e tram automatici vicini
  greet.update(dt, bus, trams.colleagues(buses.colleagues()));
  for (const c of traffic.honks) audio.carHorn(Math.hypot(c.x - bus.x, c.z - bus.z));
  walkers.update(dt, bus);
  // limite di velocità reale (OSM maxspeed) dove indicato, altrimenti 30 in centro e 50 fuori
  // tram: 30 in centro storico, 50 altrove (la sede non ha i limiti delle strade)
  if (bus.isTram && ((bus._curveT = (bus._curveT || 0) - dt) <= 0 || bus._curveLim == null)) { bus._curveLim = bus.curveLimit(); bus._curveT = 0.25; }
  const speedLimit = bus.isTram ? Math.min(zoneOf(bus.x, bus.z) === 0 ? 30 : 50, bus._curveLim || 70) : mid.edge && mid.edge.speed ? Math.min(90, mid.edge.speed) : zoneOf(bus.x, bus.z) === 0 ? 30 : 50;
  // fari obbligatori di notte e con scarsa visibilità (pioggia forte, nebbia)
  // dossi e attraversamenti rialzati: scossone della cassa (più forte con più velocità) e comfort nella missione
  const bump = bus.isTram ? null : city.bumpHit(bus);
  if (bump) bus.pitch -= bump.sev * Math.min(1, Math.abs(bus.v) / 8) * 0.03;
  const ctx = { speedLimit, onSidewalk, bump, night: (mission._night || 0) > 0.5 || wx.fog > 0.6 || wx.rain > 0.6 };
  const clock0 = mission.clock;
  mission.update(dt, bus, ctx);
  chargeStep(dt, mission.clock - clock0);
  city.update(dt);
  if (depotMesh) depotMesh.update(dt, bus);
  envTimer -= dt;
  if (envTimer <= 0) { setupWeatherAndTime(); envTimer = wxChanging ? 0.2 : 2; }
  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; saveGame(); }
  audio.update(dt, bus, { interior: camMode === 0 || camMode === 2, rain: wx.rain });
  const ri = frame % 6 === 0 ? city.roadInfo(bus.x, bus.z) : null;
  if (ri && ri.edge) hudStreet = ri.edge.name;
  hud.update(bus, mission, { speedLimit, net, traffic, lights, buses, street: hudStreet });
  if (frame % 10 === 0) bus.drawDash({ doors: bus.doorsAnyOpen, request: mission.request });
}

function render(dt) {
  updateCamera(dt);
  // sole e ombre seguono il bus
  const sd = sun.userData.dir || new THREE.Vector3(0.3, 1, 0.3);
  sun.position.set(bus.x + sd.x * 400, sd.y * 400, bus.z + sd.z * 400);
  sun.target.position.set(bus.x, 0, bus.z);
  sky.position.copy(camera.position);
  rain.visible = wx.rain > 0.02;
  if (rain.visible) {
    rainGeo.setDrawRange(0, Math.ceil(RAIN_N * Math.min(1, wx.rain * 1.1)) * 2);
    rain.material.opacity = 0.2 + 0.3 * wx.rain;
    rain.position.set(camera.position.x, camera.position.y - 10, camera.position.z);
    const a = rain.geometry.attributes.position.array;
    for (let i = 0; i < RAIN_N; i++) {
      let y = a[i * 6 + 1] - dt * 24;
      if (y < -2) y += 35;
      a[i * 6 + 1] = y;
      a[i * 6 + 4] = y - 0.7;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  // specchietti e monitor della porta si ridisegnano a disegni alterni
  const even = renders++ % 2 === 0;
  const mirrors = updateMirrors(even);
  if (!even) updateDoorCam();
  if (mirrors) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(overlayScene, overlayCam);
    renderer.autoClear = true;
  }
}

// vista "cartolina" dietro al menu
let menuT = 0;
function renderMenuBackdrop(dt) {
  menuT += dt * 0.04;
  const c = net.landmarks.prato;
  camera.position.set(c.x + Math.cos(menuT) * 330, 120, c.z + Math.sin(menuT) * 330);
  camera.lookAt(c.x + 60, 0, c.z - 60);
  camera.fov = 55;
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  sun.position.set(c.x + 200, 300, c.z + 150);
  sun.target.position.set(c.x, 0, c.z);
  lights.update(dt);
  city.streamTiles(camera.position.x, camera.position.z, 4);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  frame++;
  if (running && !paused && !tpOpen && !city.areasReady(bus.x, bus.z, 300)) {
    // aree della mappa attorno al bus non ancora arrivate (partenza lontano da Prato, teletrasporto): si aspetta fermi
    city.ensureTiles(bus.x, bus.z, 300);
    render(0);
  } else if (running && !paused && !tpOpen) {
    // sotto-passi per una fisica stabile
    const n = dt > 0.025 ? 2 : 1;
    for (let i = 0; i < n; i++) step(dt / n);
    render(dt);
  } else {
    // in pausa e nel menu il gamepad serve ancora: Start riprende la corsa, si impostano volante e pedali
    pad.poll(dt);
    if (running) render(0);
    else if (net) renderMenuBackdrop(dt);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !paused) togglePause(true);
});
window.addEventListener('pagehide', () => saveGame());
window.addEventListener('beforeunload', () => saveGame());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  layoutMirrors();
});

// avvio
setTimeout(async () => {
  if (mobileBlocked) {
    $('loading').style.display = 'none';
    $('solo-computer').classList.add('dispositivo');
    $('solo-computer').hidden = false;
    capture('mobile_blocked', { screen_width: screen.width, screen_height: screen.height, touch_points: navigator.maxTouchPoints });
    return;
  }
  try {
    // edifici, marciapiedi, verde e alberi arrivano per aree (src/data/aree.js): prima della città quelle attorno a Prato
    // (lo sfondo del menu), le altre quando il bus si avvicina
    const prato = toXZ(...LANDMARKS.prato);
    await loadAreasNear(prato.x, prato.z, 1500, (n, tot) => { $('loading-sub').textContent = `mappa: ${n} aree su ${tot}`; });
    $('loading-sub').textContent = 'strade, palazzi, Prato della Valle';
    await new Promise((ok) => setTimeout(ok, 0));
    buildWorld();
  } catch (e) {
    $('loading-sub').textContent = 'Errore: ' + e.message;
    throw e;
  }
  layoutMirrors();
  buildMenu();
  buses.warm(LINES, settings.variant, settings.departure);
  // novità dall'ultima visita e modulo per le richieste (con il punto della mappa se si è in corsa)
  const save = loadSave();
  news = initNews({
    savedAt: save && save.savedAt,
    context: () => (running && mission ? {
      vehicle_type: bus.isTram ? 'tram' : 'bus', line_id: settings.line.id, mission_mode: mission.roam ? 'roam' : mission.free ? 'free' : 'service',
      game_clock: fmtHM(mission.clock), x: Math.round(bus.x), z: Math.round(bus.z), street: hudStreet,
    } : { in_menu: true }),
  });
  $('loading').style.display = 'none';
  // illuminazione diurna per lo sfondo del menu
  city.setNight(0);
  window.__game = { get hud() { return hud; }, get terrain() { return terrain; }, get bus() { return bus; }, get mission() { return mission; }, get traffic() { return traffic; }, get tramSignals() { return tramSignals; }, city, net, lights, startMission, settings, keys, scene, camera, renderer, wx, lines: LINES, setCam: (m) => (camMode = m),
    teleport: (x, z) => teleportTo(x, z), get trams() { return trams; }, get buses() { return buses; }, get greet() { return greet; }, get turno() { return turno; }, depot, turnoOf, canLeaveDepot,
    pad, mirrorAdj, get chargers() { return chargers; }, sim: (sec, dt = 1 / 30, draw = true) => { for (let t = 0; t < sec - 1e-6; t += dt) step(dt); if (draw) render(dt); }, press: onKeyPress };
  loop();
}, 50);
