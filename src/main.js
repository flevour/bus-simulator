import * as THREE from 'three';
import { buildNetwork, LINES, TRAM_LINES, fmtHM } from './data/padova.js';
import { Tram, tramRoute, TRAM } from './tram/tram.js';
import { City, zoneOf } from './world/city.js';
import { TrafficLights, Traffic, Walkers, TramSim, TramSignals } from './world/traffic.js';
import { Bus } from './bus/bus.js';
import { Mission, scheduleFor, paceVariant, tripDuration } from './game/mission.js';
import { pointAt, projectOnRoute } from './game/routes.js';
import { HUD } from './game/hud.js';
import { Audio } from './game/audio.js';
import { posthog, isPostHogConfigured, posthogGameLogger } from './posthog.js';

const $ = (id) => document.getElementById(id);
const capture = (event, properties) => {
  if (isPostHogConfigured) posthog.capture(event, properties);
};

// ------------------------------------------------------------------
// Renderer e scena
// ------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // aggiornata una sola volta per frame (non per gli specchietti)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
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
let net, city, lights, trams, tramSignals;
const hud = new HUD();
const audio = new Audio();

function buildWorld() {
  net = buildNetwork();
  // orari tra le fermate a misura di guida (il tram ha già quelli della sua sede)
  for (const L of LINES) for (const v of L.variants) paceVariant(net, v);
  city = new City(scene, net);
  lights = new TrafficLights(scene, net);
  city.buildSigns();
  trams = new TramSim(scene, net, { track: city.tramTrack });
  // incroci con la sede: precedenza al tram e semafori a barre
  tramSignals = new TramSignals(scene, city, lights);
  trams.signals = tramSignals;
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
function layoutMirrors() {
  const W = window.innerWidth, H = window.innerHeight;
  overlayCam.right = W; overlayCam.top = H; overlayCam.updateProjectionMatrix();
  const mw = Math.min(150, W * 0.11), mh = mw * 1.4;
  const y = H * 0.42;
  const pos = [[14 + mw / 2, H - y - mh / 2], [W - 14 - mw / 2, H - y - mh / 2]];
  mirrorQuads.forEach((q, i) => {
    q.position.set(pos[i][0], pos[i][1], 0);
    q.scale.set(-mw, mh, 1);
    const f = $(i === 0 ? 'mirror-frame-l' : 'mirror-frame-r');
    f.style.left = pos[i][0] - mw / 2 - 4 + 'px';
    f.style.top = H - pos[i][1] - mh / 2 - 4 + 'px';
    f.style.width = mw + 8 + 'px';
    f.style.height = mh + 8 + 'px';
  });
}

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------
const keys = new Set();
const input = { throttle: false, brake: false, left: false, right: false, shift: false };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) onKeyPress(e.code);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function readInput() {
  const fwdKey = keys.has('KeyW') || keys.has('ArrowUp'), backKey = keys.has('KeyS') || keys.has('ArrowDown');
  // in retromarcia, appena fermi, W rimette la marcia avanti
  if (bus && bus.dir < 0 && fwdKey && Math.abs(bus.v) < 0.15) setDirection(1);
  // in retromarcia i pedali si scambiano: S dà gas all'indietro, W frena
  const rev = bus && bus.dir < 0;
  input.throttle = rev ? backKey : fwdKey;
  input.brake = rev ? fwdKey : backKey;
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  input.shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (bus) bus.horn = keys.has('KeyH');
}

// ------------------------------------------------------------------
// Stato di gioco
// ------------------------------------------------------------------
let bus = null, mission = null, traffic = null, walkers = null;
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
canvas.addEventListener('mousedown', (e) => {
  if (!running || paused || e.button !== 0) return;
  mouseLook.drag = { x: e.clientX, y: e.clientY };
  canvas.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  const d = mouseLook.drag;
  if (!d) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.x = e.clientX; d.y = e.clientY;
  const k = camMode === 1 ? 0.006 : 0.0045;
  mouseLook.yaw = Math.max(-2.6, Math.min(2.6, mouseLook.yaw - dx * k));
  mouseLook.pitch = Math.max(-0.7, Math.min(0.55, mouseLook.pitch - dy * 0.0035));
});
window.addEventListener('mouseup', () => { mouseLook.drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('dblclick', () => { if (running) resetLook(true); });
const L24 = LINES.find((l) => l.id === '24') || LINES[0];
// linee bus e tram nel menu
const ALL_LINES = [...LINES, ...TRAM_LINES];
const settings = { line: L24, variant: 'feriale', vIdx: L24.pair[0], departure: 0, depDur: 0, weather: 'variable', mode: 'service', livery: 'moderna', vehicle: 'bus' };
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
      if (!bus.isTram) break;
      audio.noiseBurst({ dur: 1.2, freq: 900, gain: 0.12 });
      hud.toast(bus.togglePantograph() ? '🔌 Alzo il pantografo' : '🔋 Abbasso il pantografo: si va a batteria', 'info');
      break;
    case 'KeyB':
      if (bus.isTram) changeTramCab();
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
    case 'KeyI': showHelp = !showHelp; $('help').style.display = showHelp ? 'block' : 'none'; break;
  }
}

// Tram: cambio cabina. Al capolinea (o in giro libero alle estremità) si passa alla corsia del verso opposto.
function changeTramCab() {
  if (Math.abs(bus.v) > 0.05 || !bus.doorsClosed || bus.doorTarget > 0) { hud.toast('Fermati con le porte chiuse per cambiare cabina', 'bad'); return; }
  const P = bus.path, sf = bus.sFront;
  if (sf < P.len - 70 && sf > 70) { hud.toast('Si cambia cabina solo al capolinea', 'info'); return; }
  // binario dell'altro verso (lungo tutta la linea), col muso dove ora c'è la coda: si passa dallo scambio
  const T = city.tramTrack, tail = P.at(sf - bus.length), nd = -bus.dirSig, np = T.path(nd);
  bus.setPath(np, nd, 0);
  bus.setFront(np.project(tail.x, tail.z).s);
  bus.parking = true;
  chase.init = false;
  hud.toast('🔁 Cabina cambiata: ora guidi dall\'altra estremità', 'info');
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
  capture('teleport_used', { vehicle_type: bus.isTram ? 'tram' : 'bus', mission_mode: mission.free ? 'free' : 'service' });
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
    const ok = saveGame();
    $('pause-info').textContent = ok ? `Progressi salvati alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: potrai riprendere da qui anche dopo aver chiuso la pagina.` : 'Salvataggio non disponibile in questo browser.';
    if ('speechSynthesis' in window) speechSynthesis.pause();
    audio.setMuted(true);
  } else if (running) {
    if ('speechSynthesis' in window) speechSynthesis.resume();
    audio.setMuted(!!audio.muted);
  }
}

// ------------------------------------------------------------------
// Salvataggio della corsa (localStorage, solo in questo browser)
// ------------------------------------------------------------------
const SAVE_KEY = 'padova-bus-sim-save-v2';
function saveGame() {
  if (!running || !mission || !bus || mission.finished) return false;
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
    bus: { x: bus.x, z: bus.z, h: bus.h, lights: bus.lights, dir: bus.dir, odo: bus.odometer, tram: bus.isTram ? { s: bus.sFront, panto: bus.pantoUp, battery: bus.battery } : null },
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
    bus.setFront(d.bus.tram.s);
    bus.pantoUp = d.bus.tram.panto !== false; bus.pantoPos = bus.pantoUp ? 1 : 0; bus.battery = d.bus.tram.battery ?? 1;
  } else bus.place(d.bus.x, d.bus.z, d.bus.h);
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

function refreshMenu() {
  const L = settings.line;
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
    o.textContent = `${fmtHM(dp.t)} → ${fmtHM(dp.t + tripDuration(v, dp.d))}${hourTag(dp.t)}`;
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
}

// elenco delle linee del mezzo scelto (autobus o tram)
function renderLines() {
  const tram = settings.vehicle === 'tram';
  $('line-list').innerHTML = ALL_LINES.filter((L) => !!L.tram === tram).map((L) => `<div class="line-card${L.tram ? ' tram' : ''}" data-id="${L.id}" tabindex="0"><div class="badge${L.tram ? ' tram' : ''}" style="background:${L.color}">${L.tram ? '🚋 ' + L.id : L.id}</div><div><div class="nm">${L.headsign}</div><div class="nt">${L.variants.length} percors${L.variants.length > 1 ? 'i' : 'o'} · ${L.variants.reduce((a, v) => a + v.feriale.length, 0)} corse feriali · ${L.variants.reduce((a, v) => a + v.festivo.length, 0)} festive</div></div></div>`).join('');
  const pick = (el) => { settings.line = ALL_LINES.find((l) => l.id === el.dataset.id); settings.vIdx = settings.line.pair[0]; refreshMenu(); };
  document.querySelectorAll('.line-card').forEach((el) => { el.addEventListener('click', () => pick(el)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(el); }); });
  // la livrea riguarda solo l'autobus
  $('livery-box').hidden = tram;
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
  seg('mode', 'm', (m) => { settings.mode = m; });
  seg('livery', 'l', (l) => { settings.livery = l; });
  seg('vehicle', 'k', (k) => setVehicle(k));
  $('departure').addEventListener('change', (e) => { const dp = curVariant()[settings.variant][Number(e.target.value)]; if (dp) { settings.departure = dp.t; settings.depDur = dp.d; refreshStops(); } });
  $('start').addEventListener('click', () => startMission());
  $('resume').addEventListener('click', () => togglePause(false));
  $('pause-btn').addEventListener('click', () => togglePause(true));
  $('minimap').addEventListener('click', (ev) => {
    if (!running || !hud.big || !hud.bigView) return;
    const rect = ev.currentTarget.getBoundingClientRect(), v = hud.bigView;
    const px = ((ev.clientX - rect.left) / rect.width) * v.W, py = ((ev.clientY - rect.top) / rect.height) * v.H;
    teleportTo(v.cx + (px - v.W / 2) / v.scale, v.cz + (py - v.H / 2) / v.scale);
    hud.setBigMap(false);
  });
  $('resume-save').addEventListener('click', resumeSaved);
  $('discard-save').addEventListener('click', clearSave);
  $('restart').addEventListener('click', () => { clearSave(); togglePause(false); startMission(); });
  refreshResumeBox();
  $('quit').addEventListener('click', backToMenu);
  $('res-menu').addEventListener('click', backToMenu);
  refreshMenu();
}

function backToMenu() {
  if (mission && !mission.finished) {
    const missionDetails = {
      vehicle_type: bus.isTram ? 'tram' : 'bus',
      mission_mode: mission.free ? 'free' : 'service',
      stops_completed: mission.nextStop,
    };
    capture('mission_abandoned', missionDetails);
    posthogGameLogger.warn('mission abandoned', missionDetails);
  }
  saveGame();
  togglePause(false);
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
    // tram: la corsia del verso di marcia (in giro libero tutta la linea)
    const T = city.tramTrack;
    const tr = tramRoute(T, V, L.modules, settings.mode === 'free');
    V.trackPath = tr.path;
    bus = new Tram(scene, { line: L.id, dest: destName, modules: L.modules, path: tr.path, track: T, dir: tr.sig, offset: tr.offset });
    bus.onRerail = () => hud.toast('🛠️ Il tram è stato rimesso sulla rotaia: puoi ripartire', 'info');
  } else {
    bus = new Bus(scene, { id: L.id, color: L.color, dest: destName, livery: settings.livery });
  }
  resetLook(false);
  bus.onShift = () => audio.shift();
  mission = new Mission({ scene, net, line: L, route: V, day: settings.variant, departure: settings.departure, depDur: settings.depDur, hud, audio, lights, city, free: settings.mode === 'free' });
  // tram automatici: quelli in servizio all'ora della corsa secondo l'orario GTFS; la corsa che guida il giocatore
  // non ha un gemello automatico
  trams.setService(TRAM_LINES, settings.variant, bus.isTram && settings.mode !== 'free' ? { v: V, t: settings.departure } : null);
  mission.dest = destName;
  const st0 = mission.stops[0];
  if (bus.isTram) {
    // il muso alla fine della banchina della prima fermata
    bus.setFront(st0.s - 0.5);
    mission.s = Math.max(0, st0.s - 0.5 - TRAM.ref);
  } else {
    const p = pointAt(mission.route, st0.s - 6.5);
    const lat = st0.hw - 1.7;
    bus.place(p.x + -p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz));
    mission.s = Math.max(0, st0.s - 6.5);
  }
  bus.setInnerDisplay('Linea ' + L.id + ' – ' + destName);
  if (resume) applySave(resume);
  city.ensureTiles(bus.x, bus.z, 650);
  lights.time = resume ? resume.mission.clock : settings.departure;
  const hour = (settings.departure / 3600) % 24;
  const busy = hour < 6 ? 0.3 : hour < 7 ? 0.6 : (hour > 7 && hour < 9.3) || (hour > 17 && hour < 19.5) ? 1.3 : hour < 21 ? 0.9 : 0.4;
  const count = Math.round(55 * busy * (settings.variant === 'festivo' ? 0.6 : 1));
  traffic = new Traffic(scene, net, city, lights, { count, seed: Math.floor(settings.departure) });
  walkers = new Walkers(scene, net, Math.round(140 * (settings.variant === 'festivo' ? 1.2 : 1) * (hour > 21 || hour < 6.5 ? 0.3 : 1)), city);
  for (let i = 0; i < count; i++) traffic.spawn(bus, 60, 1400);
  for (let i = 0; i < walkers.target; i++) walkers.spawn(bus);
  mission.onFinish = () => setTimeout(showResults, 3500);
  hud.setLine(L, destName);
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
    mission_mode: mission.free ? 'free' : 'service',
    line_id: L.id,
    service_day: settings.variant,
    weather: settings.weather,
  };
  capture(resume ? 'mission_resumed' : 'mission_started', missionDetails);
  posthogGameLogger.info(resume ? 'mission resumed' : 'mission started', missionDetails);
  if (resume) {
    hud.setLine(mission.free ? { id: L.id, color: L.color } : L, mission.free ? 'Giro libero' : destName);
    hud.toast(`Corsa ripresa alle ${fmtHM(mission.clock)}: ${resume.summary}`, 'info');
    setTimeout(() => running && hud.toast('Freno di stazionamento inserito: premi W per ripartire', 'info'), 1600);
  } else if (mission.free) {
    hud.setLine({ id: L.id, color: L.color }, 'Giro libero');
    hud.toast('Giro libero: esplora Padova, rispetta semafori e limiti', 'info');
  } else {
    hud.toast(`Linea ${L.id} per ${destName} – partenza ${fmtHM(settings.departure)}`, 'info');
    setTimeout(() => running && hud.toast('Apri le porte (F) per far salire i passeggeri', 'info'), 1800);
  }
  if (!resume && bus.isTram) setTimeout(() => running && hud.toast('🚋 Tram: W/S manipolatore · F porte · H campanello · O pantografo · B cambio cabina al capolinea', 'info'), 3200);
  if (!resume) setTimeout(() => running && hud.toast('Premi I per l\'elenco dei comandi', 'info'), 4500);
  saveGame();
}

function showResults() {
  if (!mission) return;
  clearSave();
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
    ['Incidenti', s.crashes],
    ['Semafori rossi', s.redLights],
    ['Multe per velocità', s.speeding],
    ['Salite sul marciapiede', s.sidewalk],
    ['Arrivo al capolinea', fmtHM(mission.clock, true)],
  ];
  $('res-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
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
  const hour = ((mission.clock / 3600) % 24 + 24) % 24;
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
    bus.body.localToWorld(local);
    // piccola vibrazione del motore
    const vib = (Math.random() - 0.5) * 0.004 * (0.3 + bus.throttle);
    camera.position.copy(local).add(V2.set(0, vib, 0));
    bus.body.getWorldQuaternion(Qt);
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
      const mid = bus.path.at(bus.sFront - bus.facing * bus.length * 0.5), back = bus.path.at(bus.sFront - bus.facing * (bus.length + 9));
      const ox = back.x - mid.x, oz = back.z - mid.z;
      const target = V.set(mid.x + ox * cy + oz * sy, 9 + mouseLook.pitch * 10, mid.z - ox * sy + oz * cy);
      if (!chase.init) { chase.pos.copy(target); chase.init = true; }
      chase.pos.lerp(target, Math.min(1, dt * 3));
      camera.position.copy(chase.pos);
      const fr = bus.path.at(bus.sFront);
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

function updateMirrors() {
  const show = camMode === 0;
  ['mirror-frame-l', 'mirror-frame-r'].forEach((id) => ($(id).style.display = show ? 'block' : 'none'));
  if (!show) return false;
  const sides = [1, -1];
  for (let i = 0; i < 2; i++) {
    const s = sides[i];
    const p = bus.toWorld(s * 1.6, 6.1);
    const t = bus.toWorld(s * 2.6, -25);
    const cam = mirrorCams[i];
    cam.position.set(p.x, 2.45 + (bus.elev || 0), p.z);
    cam.lookAt(t.x, 0.9 + (bus.elev || 0), t.z);
    renderer.setRenderTarget(mirrorRT[i]);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(null);
  return true;
}

// ------------------------------------------------------------------
// Loop principale
// ------------------------------------------------------------------
const world = {
  wet: false, offRoad: false, slope: 0,
  obstaclesNear: (x, z, r) => city.obstacles.query(x, z, r, world._o || (world._o = [])),
  carsNear: (x, z, r) => { const a = traffic ? traffic.near(x, z, r) : []; return trams ? a.concat(trams.near(x, z, r)) : a; },
};
let envTimer = 0, frame = 0, hudStreet = '', saveTimer = 0, kerbT = 0;
let lastT = performance.now();

// posizione dei tram lungo la sede (per gli incroci): automatici e, se c'è, quello del giocatore
const playerOcc = { player: true, front: 0, dir: 1, len: 0, v: 0, dwell: false };
function tramOccupancy() {
  const occ = trams.trams.map((tr) => ({ front: tr.s, dir: tr.dir, len: trams.L, v: tr.v, dwell: tr.wait > 0 }));
  if (bus && bus.isTram) {
    Object.assign(playerOcc, { front: bus.pathOffset + bus.sFront, dir: bus.dirSig, len: bus.length, v: bus.v, dwell: bus.doorsAnyOpen });
    occ.push(playerOcc);
  }
  return occ;
}

function step(dt) {
  readInput();
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
  if (!bus.isTram) for (const [lx, lz, rear] of [[1.05, 3.3, 0], [-1.05, 3.3, 0], [1.05, -2.6, 1], [-1.05, -2.6, 1]]) {
    const p = bus.toWorld(lx, lz);
    const ri = city.roadInfo(p.x, p.z);
    if (ri.off < 0.5 || ri.off > 6 || city.onTramway(p.x, p.z, 0.3)) continue;
    const tol = rear ? 1.0 : 0.5;
    if (ri.off > tol && (ri.off > tol + (rear ? 0.9 : 0.5) || !city.kerbAllowance(p.x, p.z))) kerb = true;
  }
  // un tocco di un istante non conta
  kerbT = kerb ? kerbT + dt : 0;
  onSidewalk = kerbT > 0.3;
  const pf = bus.toWorld(0, 3.3), pr = bus.toWorld(0, -2.6);
  const hF = city.heightAt(pf.x, pf.z, bus.elev), hR = city.heightAt(pr.x, pr.z, bus.elev);
  world.slope = bus.isTram ? 0 : (hF - hR) / 5.9;
  bus.elev = bus.isTram ? 0 : (hF + hR) / 2 + (hF - hR) * (0.3 / 5.9);
  const hit = bus.update(dt, { ...input, wipers: wx.rain > 0.08 }, world);
  // il tram non deve finire dentro l'auto davanti: dopo un urto resta fermo
  if (hit && bus.isTram) bus.parking = bus.parking || hit.impact > 1.2;
  if (hit && hit.impact > 1.2 && !bus._crashCd) {
    audio.crash(hit.impact / 4);
    mission.onCrash(hit);
    bus._crashCd = 0.6;
  }
  if (bus._crashCd) bus._crashCd = Math.max(0, bus._crashCd - dt);
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
  trams.update(dt, bus, mission.clock);
  // incroci col tram: chiamata dei tram in arrivo, segnali a barre, precedenza delle auto
  tramSignals.update(dt, tramOccupancy(), traffic);
  if (bus.isTram && !mission.free) for (const x of tramSignals.violations) if (mission.cooldown('tsig', 5)) mission.addScore(-60, '🚦 Passato col segnale del tram a via impedita (barra orizzontale)!');
  city.streamTiles(bus.x, bus.z, 5);
  traffic.update(dt, bus, { busAtStop: mission.atStop || bus.doorsAnyOpen, tramSignals });
  for (const c of traffic.honks) audio.carHorn(Math.hypot(c.x - bus.x, c.z - bus.z));
  walkers.update(dt, bus);
  // limite di velocità reale (OSM maxspeed) dove indicato, altrimenti 30 in centro e 50 fuori
  // tram: 30 in centro storico, 50 altrove (la sede non ha i limiti delle strade)
  if (bus.isTram && ((bus._curveT = (bus._curveT || 0) - dt) <= 0 || bus._curveLim == null)) { bus._curveLim = bus.curveLimit(); bus._curveT = 0.25; }
  const speedLimit = bus.isTram ? Math.min(zoneOf(bus.x, bus.z) === 0 ? 30 : 50, bus._curveLim || 70) : mid.edge && mid.edge.speed ? Math.min(90, mid.edge.speed) : zoneOf(bus.x, bus.z) === 0 ? 30 : 50;
  // fari obbligatori di notte e con scarsa visibilità (pioggia forte, nebbia)
  const ctx = { speedLimit, onSidewalk, night: (mission._night || 0) > 0.5 || wx.fog > 0.6 || wx.rain > 0.6 };
  mission.update(dt, bus, ctx);
  city.update(dt);
  envTimer -= dt;
  if (envTimer <= 0) { setupWeatherAndTime(); envTimer = wxChanging ? 0.2 : 2; }
  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; saveGame(); }
  audio.update(dt, bus, { interior: camMode === 0 || camMode === 2, rain: wx.rain });
  const ri = frame % 6 === 0 ? city.roadInfo(bus.x, bus.z) : null;
  if (ri && ri.edge) hudStreet = ri.edge.name;
  hud.update(bus, mission, { speedLimit, net, traffic, lights, street: hudStreet });
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
  const mirrors = frame % 2 === 0 ? updateMirrors() : camMode === 0;
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
  if (running && !paused && !tpOpen) {
    // sotto-passi per una fisica stabile
    const n = dt > 0.025 ? 2 : 1;
    for (let i = 0; i < n; i++) step(dt / n);
    render(dt);
  } else if (running) {
    render(0);
  } else if (net) {
    renderMenuBackdrop(dt);
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
setTimeout(() => {
  try {
    buildWorld();
  } catch (e) {
    $('loading-sub').textContent = 'Errore: ' + e.message;
    throw e;
  }
  layoutMirrors();
  buildMenu();
  $('loading').style.display = 'none';
  // illuminazione diurna per lo sfondo del menu
  city.setNight(0);
  window.__game = { get bus() { return bus; }, get mission() { return mission; }, get traffic() { return traffic; }, get tramSignals() { return tramSignals; }, city, net, lights, startMission, settings, keys, scene, camera, renderer, wx, lines: LINES, setCam: (m) => (camMode = m),
    teleport: (x, z) => teleportTo(x, z), get trams() { return trams; },
    sim: (sec, dt = 1 / 30, draw = true) => { for (let t = 0; t < sec - 1e-6; t += dt) step(dt); if (draw) render(dt); }, press: onKeyPress };
  loop();
}, 50);
