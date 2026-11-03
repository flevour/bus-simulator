import * as THREE from 'three';
import { buildNetwork, LINES, parseHM, fmtHM } from './data/padova.js';
import { City, zoneOf } from './world/city.js';
import { TrafficLights, Traffic, Walkers } from './world/traffic.js';
import { Bus } from './bus/bus.js';
import { Mission, scheduleFor } from './game/mission.js';
import { buildRoute, pointAt } from './game/routes.js';
import { HUD } from './game/hud.js';
import { Audio } from './game/audio.js';

const $ = (id) => document.getElementById(id);

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
let net, city, lights;
const hud = new HUD();
const audio = new Audio();

function buildWorld() {
  net = buildNetwork();
  city = new City(scene, net);
  lights = new TrafficLights(scene, net);
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
  input.throttle = keys.has('KeyW') || keys.has('ArrowUp');
  input.brake = keys.has('KeyS') || keys.has('ArrowDown');
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
const settings = { line: LINES.find((l) => l.id === '24') || LINES[0], variant: 'feriale', direction: 1, departure: 0, weather: 'clear', mode: 'service' };
let indAccum = 0, lastBlinkOn = false, wasMoving = false;
let showHelp = false;

function onKeyPress(code) {
  if (!running) return;
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
      if (Math.abs(bus.v) < 0.3) { bus.dir *= -1; bus.gear = 1; hud.toast(bus.dir < 0 ? 'Retromarcia inserita (R)' : 'Marcia avanti (D)', 'info'); }
      else hud.toast('Fermati per cambiare direzione di marcia', 'bad');
      break;
    case 'KeyK':
      if (Math.abs(bus.v) < 0.3) { bus.kneelTarget = bus.kneelTarget ? 0 : 1; audio.noiseBurst({ dur: 1.4, freq: 2000, gain: 0.25 }); }
      break;
    case 'KeyC': camMode = (camMode + 1) % 4; hud.toast('Visuale: ' + CAM_NAMES[camMode], 'info'); break;
    case 'KeyM': hud.setBigMap(!hud.big); break;
    case 'KeyT': mission.skipWait(); break;
    case 'KeyU': audio.muted = !audio.muted; audio.setMuted(audio.muted); hud.toast(audio.muted ? 'Audio disattivato' : 'Audio attivo', 'info'); break;
    case 'KeyI': showHelp = !showHelp; $('help').style.display = showHelp ? 'block' : 'none'; break;
  }
}

function setIndicator(v) {
  bus.indicator = v;
  indAccum = 0;
  audio.tick(v !== 0);
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
const SAVE_KEY = 'padova-bus-sim-save-v1';
function saveGame() {
  if (!running || !mission || !bus || mission.finished) return false;
  const m = mission;
  const data = {
    v: 1,
    savedAt: Date.now(),
    settings: { line: settings.line.id, variant: settings.variant, direction: settings.direction, departure: settings.departure, weather: settings.weather, mode: settings.mode },
    mission: {
      clock: m.clock, nextStop: m.nextStop, s: m.s, score: m.score, stats: m.stats, comfort: m.comfort,
      onboard: m.onboard, log: m.log.slice(-40),
      stops: m.stops.map((st) => [st.arrived ? 1 : 0, st.left ? 1 : 0, st.delay ?? null]),
    },
    bus: { x: bus.x, z: bus.z, h: bus.h, lights: bus.lights, dir: bus.dir, odo: bus.odometer },
    cam: camMode,
    summary: m.free ? `Giro libero · Linea ${settings.line.id}` : `Linea ${settings.line.id} → ${m.dest} · fermata ${Math.min(m.nextStop + 1, m.stops.length)}/${m.stops.length} (${m.stops[Math.min(m.nextStop, m.stops.length - 1)].name})`,
    clockText: fmtHM(m.clock),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}
function loadSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return d && d.v === 1 ? d : null; } catch (e) { return null; }
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
  const L = LINES.find((l) => l.id === d.settings.line);
  if (!L) { clearSave(); return; }
  Object.assign(settings, d.settings, { line: L });
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
  bus.place(d.bus.x, d.bus.z, d.bus.h);
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
function departuresFor(line, variant) {
  const v = line[variant];
  const out = [];
  for (let t = parseHM(v.first); t <= parseHM(v.last); t += v.headway * 60) out.push(t);
  return out;
}

function refreshMenu() {
  const L = settings.line;
  document.querySelectorAll('.line-card').forEach((el) => el.classList.toggle('sel', el.dataset.id === L.id));
  $('variant-note').textContent = `${settings.variant === 'feriale' ? 'Lun–Sab' : 'Domenica e festivi'} · ogni ${L[settings.variant].headway} min · ${L.note}`;
  const seq = settings.direction === 1 ? L[settings.variant].nodes : [...L[settings.variant].nodes].reverse();
  const r = buildRoute(net, seq);
  $('dir-note').textContent = `${r.stops[0].name} → ${r.stops[r.stops.length - 1].name} · ${(r.length / 1000).toFixed(1)} km`;
  // corse
  const sel = $('departure');
  const deps = departuresFor(L, settings.variant);
  const prev = settings.departure;
  sel.innerHTML = '';
  let best = 0, bestD = Infinity;
  deps.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = t;
    const h = t / 3600;
    const tag = h < 7 ? ' 🌅 alba' : h < 9.3 ? ' 🚸 ora di punta' : h < 17 ? ' ☀️' : h < 19.5 ? ' 🚦 punta serale' : h < 20.5 ? ' 🌇 tramonto' : ' 🌙 notte';
    o.textContent = fmtHM(t) + tag;
    sel.appendChild(o);
    const d = Math.abs(t - (prev || 8.25 * 3600));
    if (d < bestD) { bestD = d; best = i; }
  });
  sel.selectedIndex = best;
  settings.departure = deps[best];
  refreshStops(r);
}
function refreshStops(r) {
  const seq = settings.direction === 1 ? settings.line[settings.variant].nodes : [...settings.line[settings.variant].nodes].reverse();
  r = r || buildRoute(net, seq);
  const times = scheduleFor(r, settings.departure, settings.variant);
  $('stop-list').innerHTML = r.stops.map((s, i) => `<li class="${s.terminal ? 'term' : ''}"><span>${s.name}</span><span class="t">${fmtHM(times[i])}</span></li>`).join('');
}

function buildMenu() {
  $('line-list').innerHTML = LINES.map((L) => `<div class="line-card" data-id="${L.id}"><div class="badge" style="background:${L.color}">${L.id}</div><div><div class="nm">${L.name}</div><div class="nt">via ${L.via}</div></div></div>`).join('');
  document.querySelectorAll('.line-card').forEach((el) => el.addEventListener('click', () => { settings.line = LINES.find((l) => l.id === el.dataset.id); refreshMenu(); }));
  const seg = (id, attr, fn) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    fn(b.dataset[attr]);
  }));
  seg('variant', 'v', (v) => { settings.variant = v; refreshMenu(); });
  seg('direction', 'd', (d) => { settings.direction = Number(d); refreshMenu(); });
  seg('weather', 'w', (w) => { settings.weather = w; });
  seg('mode', 'm', (m) => { settings.mode = m; });
  $('departure').addEventListener('change', (e) => { settings.departure = Number(e.target.value); refreshStops(); });
  $('start').addEventListener('click', () => startMission());
  $('resume').addEventListener('click', () => togglePause(false));
  $('pause-btn').addEventListener('click', () => togglePause(true));
  $('resume-save').addEventListener('click', resumeSaved);
  $('discard-save').addEventListener('click', clearSave);
  $('restart').addEventListener('click', () => { clearSave(); togglePause(false); startMission(); });
  refreshResumeBox();
  $('quit').addEventListener('click', backToMenu);
  $('res-menu').addEventListener('click', backToMenu);
  refreshMenu();
}

function backToMenu() {
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
  const seq = settings.direction === 1 ? L[settings.variant].nodes : [...L[settings.variant].nodes].reverse();
  const destName = net.nodes[seq[seq.length - 1]].name.replace(' Capolinea', '');
  bus = new Bus(scene, { id: L.id, color: L.color, dest: destName });
  bus.onShift = () => audio.shift();
  mission = new Mission({ scene, net, line: L, variant: settings.variant, direction: settings.direction, departure: settings.departure, hud, audio, lights, city, free: settings.mode === 'free' });
  mission.dest = destName;
  const st0 = mission.stops[0];
  const p = pointAt(mission.route, st0.s - 6.5);
  const lat = st0.hw - 1.7;
  bus.place(p.x + -p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz));
  bus.setInnerDisplay('Linea ' + L.id + ' – ' + destName);
  if (resume) applySave(resume);
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
  rain.visible = settings.weather === 'rain';
  setupWeatherAndTime(true);
  const night = mission._night || 0;
  if (!resume) bus.lights = night > 0.3 || settings.weather !== 'clear';
  saveTimer = 0;
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
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
function setupWeatherAndTime() {
  const hour = ((mission.clock / 3600) % 24 + 24) % 24;
  const t = (hour - 6.6) / (18.9 - 6.6); // 0 alba, 1 tramonto
  const elev = Math.sin(Math.PI * t);
  const az = Math.PI * t;
  const day = THREE.MathUtils.smoothstep(elev, -0.08, 0.25);
  const golden = THREE.MathUtils.smoothstep(elev, -0.1, 0.05) * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.35));
  const w = settings.weather;
  const overcast = w === 'rain' ? 0.85 : w === 'fog' ? 0.7 : 0;
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
  sun.intensity = day * (w === 'clear' ? 2.6 : 0.5) * (1 - golden * 0.4);
  sun.color.set(golden > 0.2 ? 0xffc890 : 0xfff2e0);
  hemi.intensity = 0.18 + day * (w === 'clear' ? 0.9 : 0.75);
  hemi.color.copy(tmpC2).lerp(new THREE.Color(0xffffff), 0.4);
  ambient.intensity = 0.25 + night * 0.35;
  ambient.color.set(night > 0.5 ? 0x5060a0 : 0x8090b0);
  // nebbia
  const fogCol = tmpC2.clone();
  scene.fog.color.copy(fogCol);
  if (w === 'fog') { scene.fog.near = 5; scene.fog.far = 140; }
  else if (w === 'rain') { scene.fog.near = 30; scene.fog.far = 700; }
  else { scene.fog.near = 300; scene.fog.far = night > 0.5 ? 1800 : 2800; }
  renderer.toneMappingExposure = 1.0 + night * 0.25;
  city.setNight(night, w === 'rain' ? 1 : 0);
  traffic && traffic.setNight(night);
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
    const local = camMode === 0 ? V.set(0.62, 2.12, 4.8) : V.set(-0.2, 2.05, -5.2);
    bus.body.localToWorld(local);
    // piccola vibrazione del motore
    const vib = (Math.random() - 0.5) * 0.004 * (0.3 + bus.throttle);
    camera.position.copy(local).add(V2.set(0, vib, 0));
    bus.body.getWorldQuaternion(Qt);
    Ex.set(camMode === 0 ? -0.13 : -0.12, Math.PI + lookYaw, 0, 'YXZ');
    Qy.setFromEuler(Ex);
    camera.quaternion.copy(Qt).multiply(Qy);
    camera.fov = camMode === 0 ? 68 : 75;
    chase.init = false;
  } else if (camMode === 1) {
    const f = V2.set(bus.fx, 0, bus.fz);
    const target = V.set(bus.x, bus.elev || 0, bus.z).addScaledVector(f, -17).add(new THREE.Vector3(0, 6.5, 0));
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
  carsNear: (x, z, r) => (traffic ? traffic.near(x, z, r) : []),
};
let envTimer = 0, frame = 0, hudStreet = '', saveTimer = 0;
let lastT = performance.now();

function step(dt) {
  readInput();
  world.wet = settings.weather === 'rain';
  // superficie
  let onSidewalk = false;
  const mid = city.roadInfo(bus.x, bus.z);
  world.offRoad = mid.off > 5;
  for (const [lx, lz] of [[1.15, 5.6], [-1.15, 5.6], [1.15, -5.6], [-1.15, -5.6]]) {
    const p = bus.toWorld(lx, lz);
    const ri = city.roadInfo(p.x, p.z);
    if (ri.off > 0.35 && ri.off < 6) onSidewalk = true;
  }
  const pf = bus.toWorld(0, 3.3), pr = bus.toWorld(0, -2.6);
  const hF = city.heightAt(pf.x, pf.z), hR = city.heightAt(pr.x, pr.z);
  world.slope = (hF - hR) / 5.9;
  bus.elev = (hF + hR) / 2 + (hF - hR) * (0.3 / 5.9);
  const hit = bus.update(dt, { ...input, wipers: settings.weather === 'rain' }, world);
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
  traffic.update(dt, bus, { busAtStop: mission.atStop || bus.doorsAnyOpen });
  for (const c of traffic.honks) audio.carHorn(Math.hypot(c.x - bus.x, c.z - bus.z));
  walkers.update(dt, bus);
  const speedLimit = zoneOf(bus.x, bus.z) === 0 ? 30 : 50;
  const ctx = { speedLimit, onSidewalk, night: (mission._night || 0) > 0.5 };
  mission.update(dt, bus, ctx);
  city.update(dt);
  envTimer -= dt;
  if (envTimer <= 0) { setupWeatherAndTime(); envTimer = 2; }
  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; saveGame(); }
  audio.update(dt, bus, { interior: camMode === 0 || camMode === 2, rain: settings.weather === 'rain' });
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
  if (rain.visible) {
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
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  frame++;
  if (running && !paused) {
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
  window.__game = { get bus() { return bus; }, get mission() { return mission; }, get traffic() { return traffic; }, city, net, lights, startMission, settings, keys, scene, camera, renderer, setCam: (m) => (camMode = m),
    sim: (sec, dt = 1 / 30, draw = true) => { for (let t = 0; t < sec - 1e-6; t += dt) step(dt); if (draw) render(dt); }, press: onKeyPress };
  loop();
}, 50);
