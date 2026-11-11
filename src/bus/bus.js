import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ledTexture, labelTexture } from '../world/textures.js';
import { circleVsOBB } from '../world/spatial.js';
import { Y_ROAD } from '../world/city.js';
import { RainGlass, WIPER_PARK, wiperPhase } from './rainglass.js';

// Dimensioni (sistema locale: +z avanti, +x sinistra (lato autista), -x destra (porte))
export const BUS = {
  length: 12, width: 2.55, height: 3.1,
  frontAxle: 3.3, rearAxle: -2.6,
  wheelR: 0.5,
  doors: [
    { z0: 4.25, z1: 5.45 }, // anteriore
    { z0: 0.2, z1: 1.4 },  // centrale
    { z0: -4.4, z1: -3.2 }, // posteriore
  ],
};
// snodato da 18 m: motrice (fino a -3.8) + rimorchio agganciato alla ralla in z = -4.4 (coordinate della motrice).
// Le coordinate del rimorchio hanno origine nella ralla: soffietto tra +0.6 e -0.6, coda a -7.6, asse a -5.2.
export const ART = { joint: -4.4, frontEnd: -3.8, trailerFront: -0.6, trailerRear: -7.6, trailerAxle: -5.2, maxAngle: 0.87,
  doors: [
    { z0: 4.25, z1: 5.45, u: 0 },
    { z0: 0.2, z1: 1.4, u: 0 },
    { z0: -2.0, z1: -0.8, u: 1 },
    { z0: -4.3, z1: -3.1, u: 1 },
  ] };
const WB = BUS.frontAxle - BUS.rearAxle;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const HW = BUS.width / 2;

const GEARS = [3.43, 2.01, 1.42, 1.0, 0.83, 0.59];
const FINAL = 4.6;
const IDLE = 650, MAXRPM = 2300;

function torqueAt(rpm) {
  if (rpm < 1000) return 650 + (Math.max(rpm, IDLE) - IDLE) * 0.75;
  if (rpm < 1600) return 900;
  return Math.max(250, 900 - (rpm - 1600) * 0.9);
}

export class Bus {
  constructor(scene, lineInfo) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // inclinazione (rollio/beccheggio)
    this.group.add(this.body);
    scene.add(this.group);
    // stato fisico
    this.x = 0; this.z = 0; this.h = 0;
    this.v = 0; this.steer = 0; this.steerIn = 0; this.steerKey = 0; this.steerHold = 0;
    this.throttle = 0; this.brake = 0;
    this.gear = 1; this.dir = 1; // 1 = D, -1 = R
    this.rpm = IDLE; this.shiftTimer = 0; this.powerKw = 0;
    this.parking = true;
    this.articulated = !!lineInfo.articulated;
    this.ht = 0; this.tax = 0; this.taz = 0; // rimorchio: direzione e posizione dell'asse
    this.doorTarget = 0;
    this.kneel = 0; this.kneelTarget = 0;
    this.indicator = 0; // -1 sx, 1 dx, 2 emergenza
    this.lights = false;
    this.horn = false;
    this.aLong = 0; this.aLat = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.odometer = 0;
    this.passengers = 0;
    this.wheelSpin = 0;
    this.blink = 0;
    this.circles = this.articulated ? [-2.55, -0.3, 1.95, 4.2, 4.9] : [-4.9, -2.45, 0, 2.45, 4.9];
    this.tCircles = [-1.0, -3.3, -5.6, -6.3]; // rimorchio
    // visuale esterna più lontana e visuale passeggeri in fondo al rimorchio (coordinate del rimorchio)
    if (this.articulated) { this.chaseDist = 22; this.paxEye = [-0.2, 2.05, -6.8]; }
    this.lastCollision = 0;
    this.buildModel(lineInfo);
  }

  // ---------------- modello 3D ----------------
  buildModel(lineInfo) {
    const B = this.body;
    const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    // livree ispirate ai bus urbani di Padova: moderna elettrica (argento, tetto blu, verde lime), storica (arancio e bianco)
    // rosso e bianco, ispirata ad APS Mobilità (bianco sotto, fascia finestre e porte nere, tetto e fascia alta rossi, clima bianco sul tetto);
    // elettrica blu (bianco argento, tetto e fascia alta blu, porte rosse, filetti blu e giallo in basso)
    // elettrica verde lime, ispirata ai bus Busitalia (bianco, fascia alta e filetti verde lime, onda verde sulla fiancata)
    // e blu e argento, ispirata agli snodati Busitalia Veneto della linea 10 (argento, fascia alta e tetto blu, filetti blu e giallo).
    // Come da CLAUDE.md si riprendono colori e stile, non loghi o marchi aziendali.
    // Campi facoltativi: belt (filetto sotto i finestrini), roofBand (fascia sotto il tetto), accent2 (secondo filetto basso),
    // glass (vetri scuri), logo (scritta sulla fascia alta), wave (decorazione a onda), electric, threeDoors (terza porta in coda).
    const LIV = {
      moderna: { lower: 0xc3c7cc, upper: 0xd8dbdf, stripe: 0xa6d22e, door: 0x7a1f2b, accent: 0x1d3b8f, roof: 0x2a56c6, electric: true, label: '100% ELETTRICO', fleet: '46' + String(100 + ((lineInfo.id.charCodeAt(0) * 7) % 900)).padStart(3, '0') },
      storica: { lower: 0xf2992b, upper: 0xebebe7, stripe: 0xf2992b, door: 0xf2992b, accent: 0x5a5f66, roof: 0xe0e0dc, threeDoors: true, label: '', fleet: String(800 + ((lineInfo.id.charCodeAt(0) * 3) % 90)) },
      aps: { lower: 0xf4f4f2, upper: 0xd42430, stripe: 0x141517, door: 0x141517, accent: 0x141517, roof: 0xf0f0ee, threeDoors: true, label: '', fleet: String(600 + ((lineInfo.id.charCodeAt(0) * 5) % 60)),
        glass: 0x0c0d0f, logo: { text: 'Padova', y: 2.84, z: 2.6, bg: '#d42430', fg: '#ffffff' } },
      blu: { lower: 0xe4e7ec, upper: 0x2a44c4, stripe: 0x2a44c4, belt: 0x141517, door: 0xc22a30, accent: 0x2a44c4, accent2: 0xf2c200, roof: 0x2a44c4, electric: true, doorColors: [0x3aa845, 0xc22a30],
        glass: 0x0c0d0f, label: 'ELETTRICO', labelFg: '#2a44c4', fleet: String(80 + ((lineInfo.id.charCodeAt(0) * 3) % 20)) },
      busitalia: { lower: 0xf3f3f0, upper: 0xa9cf2c, stripe: 0xa9cf2c, belt: 0xa9cf2c, roofBand: 0x141517, door: 0x24272b, accent: 0xa9cf2c, roof: 0xeeeeea, electric: true,
        glass: 0x0c0d0f, label: 'ELETTRICO', labelFg: '#4a7d1a', fleet: '7' + String((lineInfo.id.charCodeAt(0) * 11) % 100).padStart(2, '0'),
        logo: { text: '100% Elettrico  |  Zero Emissioni', y: 2.84, z: 0.5, w: 4.2, bg: '#a9cf2c', fg: '#ffffff' }, wave: '#a9cf2c' },
      veneto: { lower: 0xc7cbd2, upper: 0x2c3fbf, stripe: 0x2c3fbf, belt: 0x23262c, roofBand: 0x2c3fbf, door: 0x2a2d33, accent: 0x2c3fbf, accent2: 0xf2c200, roof: 0x3550d6, electric: true,
        glass: 0x0b0c10, label: 'PADOVA', labelFg: '#1d2f8f', fleet: '9' + String((lineInfo.id.charCodeAt(0) * 7) % 100).padStart(2, '0'),
        logo: { text: 'Padova', y: 2.84, z: 2.4, w: 2.4, bg: '#2c3fbf', fg: '#ffffff' } },
    };
    const liv = LIV[lineInfo.livery] || LIV.moderna;
    this.livery = lineInfo.livery || 'moderna';
    this.electric = !!liv.electric;
    // porte: u = 0 motrice, 1 rimorchio. Il 12 m ha solo anteriore (salita) e centrale (discesa), tranne le livree
    // arancio (storica) e rossa (aps) che hanno anche la porta posteriore
    this.doors = this.articulated ? ART.doors : BUS.doors.slice(0, liv.threeDoors ? 3 : 2).map((d) => ({ ...d, u: 0 }));
    this.doorOpen = this.doors.map(() => 0);
    const paint = lam(liv.upper);
    const lower = lam(liv.lower);
    const doorPaint = lam(liv.door);
    const stripe = lam(liv.stripe);
    const dark = lam(0x1d1f22);
    const grey = lam(0x6d7278);
    const interiorWall = lam(0xd9dcdf);
    this.mats = { paint, stripe };
    const box = (w, h, d, mat, x, y, z, parent = B) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const L2 = BUS.length / 2;
    const Y0 = 0.32, YB = 1.12, YW = 2.62, YT = 3.05;
    const art = this.articulated;
    // sezioni della carrozzeria: motrice ed eventuale rimorchio
    this.trailer = null; this.tBody = null; this.bellows = null;
    const units = [{ P: B, G: this.group, zMin: art ? ART.frontEnd : -L2, zMax: L2, axles: [BUS.frontAxle, BUS.rearAxle] }];
    if (art) {
      this.trailer = new THREE.Group();
      this.trailer.position.z = ART.joint;
      this.tBody = new THREE.Group();
      this.trailer.add(this.tBody);
      this.group.add(this.trailer);
      units.push({ P: this.tBody, G: this.trailer, zMin: ART.trailerRear, zMax: ART.trailerFront, axles: [ART.trailerAxle] });
    }
    units.forEach((u, k) => { u.doors = this.doors.filter((d) => d.u === k); u.front = k === 0; u.rear = k === units.length - 1; });
    this.units = units;
    const glassMat = new THREE.MeshLambertMaterial({ color: liv.glass ?? 0x1d2a33, transparent: true, opacity: liv.glass ? 0.7 : 0.55 });
    const beltMat = liv.belt != null ? lam(liv.belt) : stripe;
    const roofMat = lam(liv.roof);
    const floorMat = lam(0x4b4f55);
    const shell = (u) => {
      const P = u.P, len = u.zMax - u.zMin, zc = (u.zMax + u.zMin) / 2;
      // intervalli lungo z esclusi (passaruota, porte)
      const arches = u.axles.map((a) => [a - 0.62, a + 0.62]);
      const pieces = (excl) => {
        const segs = [];
        let z = u.zMin + 0.05;
        const ex = [...excl].sort((a, b) => a[0] - b[0]);
        for (const [a, b] of ex) { if (a > z) segs.push([z, a]); z = Math.max(z, b); }
        if (z < u.zMax - 0.05) segs.push([z, u.zMax - 0.05]);
        return segs;
      };
      const doorEx = u.doors.map((d) => [d.z0, d.z1]);
      for (const side of [1, -1]) {
        const x = side * (HW - 0.03);
        const excl = side < 0 ? [...arches, ...doorEx] : arches;
        // fascia bassa (0.95 - YB) continua tranne porte
        for (const [a, b] of pieces(side < 0 ? doorEx : [])) box(0.06, YB - 0.9, b - a, lower, x, (YB + 0.9) / 2, (a + b) / 2, P);
        // gonna (Y0-0.9) esclusi passaruota e porte
        for (const [a, b] of pieces(excl)) box(0.06, 0.9 - Y0, b - a, lower, x, (0.9 + Y0) / 2, (a + b) / 2, P);
        // striscia colorata
        for (const [a, b] of pieces(side < 0 ? doorEx : [])) box(0.02, 0.16, b - a, beltMat, x + side * 0.03, 1.0, (a + b) / 2, P).castShadow = false;
        // fascia finestre: montanti e vetri
        for (const [a, b] of pieces(side < 0 ? doorEx : [])) {
          const g = new THREE.Mesh(new THREE.PlaneGeometry(b - a, YW - YB), glassMat);
          g.position.set(x + side * 0.035, (YW + YB) / 2, (a + b) / 2);
          g.rotation.y = side * Math.PI / 2;
          P.add(g);
          // montanti ogni ~1.5 m
          const n = Math.max(1, Math.round((b - a) / 1.55));
          for (let k = 0; k <= n; k++) if (a + ((b - a) * k) / n < u.zMax - 0.3) box(0.08, YW - YB, 0.1, dark, x, (YW + YB) / 2, a + ((b - a) * k) / n, P);
        }
        // sopra le porte
        if (side < 0) for (const d of u.doors) box(0.06, YT - YW + 0.1, d.z1 - d.z0, paint, x, (YW + YT) / 2 - 0.05, (d.z0 + d.z1) / 2, P);
      }
      // tetto
      box(BUS.width, YT - YW, len - 0.1, paint, 0, (YW + YT) / 2, zc, P);
      if (this.electric) {
        // carenatura con le batterie sul tetto
        const p0 = u.zMin + 0.6, p1 = u.zMax - (u.front ? 1.8 : 0.3);
        box(2.2, 0.5, p1 - p0, roofMat, 0, YT + 0.25, (p0 + p1) / 2, P);
        if (u.front) box(2.0, 0.35, 1.2, roofMat, 0, YT + 0.17, u.zMax - 1.4, P);
        const band = lam(liv.roofBand ?? liv.stripe);
        for (const sd of [1, -1]) box(0.02, 0.18, len - 0.6, band, sd * (HW + 0.01), YW - 0.12, zc, P).castShadow = false; // fascia sotto il tetto
        for (const sd of [1, -1]) box(0.02, 0.12, len - 0.4, lam(liv.accent), sd * (HW + 0.01), Y0 + 0.1, zc, P).castShadow = false;
        if (liv.accent2 != null) for (const sd of [1, -1]) box(0.02, 0.05, len - 0.4, lam(liv.accent2), sd * (HW + 0.012), Y0 + 0.2, zc, P).castShadow = false;
      } else {
        const big = this.livery === 'aps';
        if (u.front) box(big ? 1.9 : 1.6, big ? 0.36 : 0.32, big ? 3.2 : 2.8, roofMat, 0, YT + (big ? 0.18 : 0.16), big ? 1.6 : 0.8, P); // climatizzatore
        else box(1.6, 0.32, 2.4, roofMat, 0, YT + 0.16, zc + 0.6, P);
        if (u.rear) box(1.4, 0.25, 1.6, lam(big ? 0xc9ccd0 : liv.roof), 0, YT + 0.12, u.zMin + 1.4, P);
      }
      // pavimento
      box(BUS.width - 0.1, 0.08, len - 0.1, floorMat, 0, Y0 + 0.04, zc, P);
      // ombra a terra
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width + 0.4, len + 0.4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(0, 0.02, zc);
      u.G.add(sh);
    };
    units.forEach(shell);
    if (art) {
      // soffietto e piattaforma girevole tra motrice e rimorchio (ruota di metà dell'angolo di snodo)
      this.bellows = new THREE.Group();
      this.bellows.position.z = ART.joint;
      B.add(this.bellows);
      const bm = [lam(0x2b2d31), lam(0x3a3d42)];
      for (let i = 0; i < 6; i++) box(BUS.width - 0.12, YT - Y0 - 0.1, 0.2, bm[i % 2], 0, (YT + Y0) / 2, -0.5 + i * 0.2, this.bellows);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 28), lam(0x55595f));
      plate.position.y = Y0 + 0.11;
      this.bellows.add(plate);
    }
    // frontale
    box(BUS.width, 0.62, 0.12, lower, 0, Y0 + 0.31, L2 - 0.06);
    box(BUS.width + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, L2); // paraurti
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width - 0.1, 1.95), new THREE.MeshLambertMaterial({ color: 0x223844, transparent: true, opacity: 0.3 }));
    ws.position.set(0, 1.9, L2 - 0.02);
    ws.rotation.x = -0.04;
    B.add(ws);
    // gocce di pioggia, appena dietro il parabrezza
    this.rainGlass = new RainGlass(BUS.width - 0.1, 1.95);
    this.rainGlass.mesh.position.set(0, 1.9, L2 - 0.035);
    this.rainGlass.mesh.rotation.x = -0.04;
    B.add(this.rainGlass.mesh);
    box(BUS.width, 0.26, 0.1, paint, 0, YT - 0.13, L2 - 0.05);
    // display LED frontale e laterale
    this.ledTex = ledTexture(lineInfo.id, lineInfo.dest);
    this.ledText = [lineInfo.id, lineInfo.dest]; // per ricostruire il bus con un'altra livrea
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.26), new THREE.MeshBasicMaterial({ map: this.ledTex }));
    led.position.set(0, YT - 0.14, L2 + 0.012);
    B.add(led);
    const ledS = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.17), new THREE.MeshBasicMaterial({ map: this.ledTex }));
    ledS.position.set(-HW - 0.02, 2.35, 3.0);
    ledS.rotation.y = -Math.PI / 2;
    B.add(ledS);
    this.ledMats = [led.material, ledS.material];
    const RU = units[units.length - 1], RP = RU.P, RZ = RU.zMin; // coda (motrice o rimorchio)
    const ledR = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.26), new THREE.MeshBasicMaterial({ map: labelTexture(lineInfo.id, { w: 128, h: 64, bg: '#080808', fg: '#ffa31a', font: 'bold 52px Courier New' }) }));
    ledR.position.set(0, 2.75, RZ - 0.012);
    ledR.rotation.y = Math.PI;
    RP.add(ledR);
    // retro
    box(BUS.width, YT - Y0, 0.1, lower, 0, (YT + Y0) / 2 - 0.3, RZ + 0.05, RP).scale.set(1, 0.72, 1);
    box(BUS.width + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, RZ, RP);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width - 0.4, 0.8), new THREE.MeshLambertMaterial({ color: 0x1d2a33, transparent: true, opacity: 0.6 }));
    rw.position.set(0, 2.35, RZ - 0.01);
    rw.rotation.y = Math.PI;
    RP.add(rw);
    // logo laterale "PADOVA" (APS: logo bianco sulla fascia rossa alta e numero di matricola in basso)
    for (const side of [1, -1]) {
      const hex = '#' + new THREE.Color(liv.lower).getHexString();
      const txt = liv.label ? liv.label + '  ' + liv.fleet : liv.logo ? liv.fleet : 'PADOVA  ' + liv.fleet;
      const fg = liv.labelFg || (this.electric ? '#1d3b8f' : liv.logo ? '#2b2d31' : '#ffffff');
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.8, liv.wave ? 0.24 : 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(txt, { w: 512, h: 80, bg: hex, fg, font: 'bold 46px Arial' }) }));
      t.position.set(side * (HW + 0.005), liv.wave ? 0.58 : 0.62, -0.9);
      t.rotation.y = side * Math.PI / 2;
      B.add(t);
      if (liv.logo) {
        const lw = liv.logo.w || 1.6;
        const lg = new THREE.Mesh(new THREE.PlaneGeometry(lw, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(liv.logo.text, { w: Math.round(lw * 320), h: 96, bg: liv.logo.bg, fg: liv.logo.fg, font: 'bold italic 54px Arial' }) }));
        lg.position.set(side * (HW + 0.005), liv.logo.y, liv.logo.z);
        lg.rotation.y = side * Math.PI / 2;
        B.add(lg);
      }
    }
    if (liv.wave) {
      // onda verde lungo la fiancata (dietro la porta centrale)
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
      x.strokeStyle = liv.wave; x.lineWidth = 14; x.lineCap = 'round';
      x.beginPath();
      for (let i = 0; i <= 200; i++) { const u = i / 200; x.lineTo(20 + u * 984, 64 + Math.sin(u * Math.PI * 6) * 40 * (0.35 + 0.65 * u)); }
      x.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      for (const side of [1, -1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.22), new THREE.MeshLambertMaterial({ map: tex }));
        w.position.set(side * (HW + 0.006), 0.82, -1.55);
        w.rotation.y = side * Math.PI / 2;
        if (side < 0) w.scale.x = -1; // l'onda cresce verso il retro su entrambi i lati
        B.add(w);
      }
    }
    if (liv.logo) {
      // matricola sul frontale, sotto il parabrezza
      const fn = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), new THREE.MeshBasicMaterial({ map: labelTexture(liv.fleet, { w: 128, h: 64, bg: '#' + new THREE.Color(liv.lower).getHexString(), fg: '#141517', font: 'bold 48px Arial' }) }));
      fn.position.set(-0.45, Y0 + 0.32, L2 + 0.005);
      B.add(fn);
    }

    // luci
    const emiss = (c) => new THREE.MeshLambertMaterial({ color: 0x222222, emissive: c, emissiveIntensity: 0 });
    this.headMat = emiss(0xfff3d6);
    this.tailMat = emiss(0xff1a1a);
    this.brakeMat = emiss(0xff2020);
    this.indMatL = emiss(0xffa000);
    this.indMatR = emiss(0xffa000);
    this.revMat = emiss(0xffffff);
    for (const s of [1, -1]) {
      box(0.42, 0.16, 0.06, this.headMat, s * 0.9, 0.78, L2 + 0.01);
      box(0.18, 0.12, 0.06, s > 0 ? this.indMatL : this.indMatR, s * 1.17, 0.78, L2 + 0.01);
      box(0.16, 0.4, 0.06, this.tailMat, s * 1.08, 1.0, RZ - 0.01, RP);
      box(0.16, 0.2, 0.06, this.brakeMat, s * 1.08, 1.45, RZ - 0.01, RP);
      box(0.16, 0.16, 0.06, s > 0 ? this.indMatL : this.indMatR, s * 1.08, 1.7, RZ - 0.01, RP);
      box(0.06, 0.08, 0.2, s > 0 ? this.indMatL : this.indMatR, s * (HW + 0.02), 1.05, 3.9);
      box(0.12, 0.1, 0.06, this.revMat, s * 0.7, 0.55, RZ - 0.01, RP);
    }
    // fari reali: due proiettori, ognuno davanti al suo gruppo ottico, appena divergenti
    this.headLights = [1, -1].map((s) => {
      const l = new THREE.SpotLight(0xfff1d0, 0, 90, 0.42, 0.5, 1.2);
      l.position.set(s * 0.9, 0.85, L2);
      l.target.position.set(s * 1.6, 0, L2 + 25);
      B.add(l, l.target);
      return l;
    });

    // specchietti
    for (const s of [1, -1]) {
      box(0.05, 0.05, 0.5, dark, s * (HW + 0.15), 2.55, L2 + 0.05);
      box(0.08, 0.5, 0.25, dark, s * (HW + 0.3), 2.3, L2 + 0.25);
    }

    // porte (due ante ciascuna)
    this.doorLeaves = [];
    const doorGlass = new THREE.MeshLambertMaterial({ color: 0x2a3a44, transparent: true, opacity: 0.45 });
    for (const [di, d] of this.doors.entries()) {
      const w = (d.z1 - d.z0) / 2;
      const frameMat = liv.doorColors ? lam(liv.doorColors[Math.min(di, liv.doorColors.length - 1)]) : dark;
      const DP = units[d.u].P;
      const leaves = [];
      for (const k of [0, 1]) {
        const g = new THREE.Group();
        const zc = d.z0 + w / 2 + k * w;
        g.position.set(-HW - 0.01, 0, zc);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.28, w - 0.02), doorPaint);
        frame.position.y = Y0 + 1.16;
        frame.scale.set(1, 1, 1);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, 1.9), doorGlass);
        gl.position.set(-0.03, Y0 + 1.25, 0);
        gl.rotation.y = -Math.PI / 2;
        // telaio a cornice: 4 barre
        const fr = mergeGeometries([
          new THREE.BoxGeometry(0.05, 0.1, w - 0.02).translate(0, Y0 + 0.08, 0),
          new THREE.BoxGeometry(0.05, 0.1, w - 0.02).translate(0, Y0 + 2.22, 0),
          new THREE.BoxGeometry(0.05, 0.3, w - 0.02).translate(0, Y0 + 0.25, 0),
          new THREE.BoxGeometry(0.05, 2.28, 0.07).translate(0, Y0 + 1.16, -(w - 0.02) / 2 + 0.035),
          new THREE.BoxGeometry(0.05, 2.28, 0.07).translate(0, Y0 + 1.16, (w - 0.02) / 2 - 0.035),
        ]);
        const frm = new THREE.Mesh(fr, frameMat);
        g.add(frm, gl);
        g.userData = { z: zc, dir: k ? 1 : -1, w };
        DP.add(g);
        leaves.push(g);
      }
      this.doorLeaves.push(leaves);
    }

    // ruote
    this.wheels = [];
    const tire = new THREE.CylinderGeometry(BUS.wheelR, BUS.wheelR, 0.34, 20);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.3, 0.3, 0.36, 12);
    rim.rotateZ(Math.PI / 2);
    for (const [az, G] of [[BUS.frontAxle, this.group], [BUS.rearAxle, this.group], ...(art ? [[ART.trailerAxle, this.trailer]] : [])])
      for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * (HW - 0.2), BUS.wheelR, az);
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(tire, lam(0x151515)), new THREE.Mesh(rim, lam(0x9aa0a6)));
        spin.children.forEach((c) => (c.castShadow = true));
        pivot.add(spin);
        G.add(pivot);
        this.wheels.push({ pivot, spin, front: G === this.group && az > 0 });
      }

    // ---------- interni ----------
    const seatMat = lam(0x24476b);
    this.cabinLightMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, emissive: 0xf0f4ff, emissiveIntensity: 0.3 });
    const poleMat = lam(0xf2c200);
    const seatG = mergeGeometries([
      new THREE.BoxGeometry(0.45, 0.1, 0.45).translate(0, 0.45, 0),
      new THREE.BoxGeometry(0.45, 0.55, 0.08).translate(0, 0.78, -0.22),
      new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0, 0.22, 0),
    ]);
    this.seats = [];
    const M = new THREE.Matrix4();
    for (const [k, u] of units.entries()) {
      const seatRows = [];
      const mid = this.doors[1];
      for (let z = u.front ? 2.9 : u.zMax - 0.6; z > u.zMin + 0.6; z -= 0.8) {
        if (u.doors.includes(mid) && z < mid.z1 + 0.3 && z > mid.z0 - 0.5) continue; // area carrozzine
        if (u.doors.some((d) => d !== mid && d !== this.doors[0] && z < d.z1 + 0.2 && z > d.z0 - 0.3)) { seatRows.push([z, [0.72, 0.27]]); continue; }
        seatRows.push([z, [0.72, 0.27, -0.72, -0.27]]);
      }
      const seatInst = new THREE.InstancedMesh(seatG, seatMat, seatRows.reduce((a, r) => a + r[1].length, 0));
      let si = 0;
      for (const [z, xs] of seatRows)
        for (const x of xs) {
          M.makeTranslation(x, Y0 + 0.08, z);
          seatInst.setMatrixAt(si++, M);
          this.seats.push({ x, z, y: Y0 + 0.08, u: k });
        }
      u.P.add(seatInst);
      // corrimano e pali
      const top = u.front ? 3.6 : u.zMax - 0.5;
      const poles = [];
      for (let z = top; z > u.zMin + 0.5; z -= 1.6) for (const x of [0.45, -0.45]) poles.push(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6).translate(x, Y0 + 1.15, z));
      const r0 = u.zMin + 0.3, r1 = u.front ? 3.9 : u.zMax - 0.3;
      for (const x of [0.45, -0.45]) poles.push(new THREE.CylinderGeometry(0.02, 0.02, r1 - r0, 6).rotateX(Math.PI / 2).translate(x, YW - 0.15, (r0 + r1) / 2));
      u.P.add(new THREE.Mesh(mergeGeometries(poles), poleMat));
      // luci soffitto
      const c0 = u.zMin + 0.65, c1 = u.front ? 4.15 : u.zMax - 0.3;
      for (const x of [0.6, -0.6]) box(0.25, 0.03, c1 - c0, this.cabinLightMat, x, YW - 0.02, (c0 + c1) / 2, u.P).castShadow = false;
      // pareti interne sotto finestrino (grigio chiaro)
      for (const sd of [1, -1]) box(0.02, 0.75, u.zMax - u.zMin - 0.4, interiorWall, sd * (HW - 0.08), Y0 + 0.45, (u.zMax + u.zMin) / 2, u.P).castShadow = false;
    }
    // display interno "prossima fermata"
    this.innerCanvas = document.createElement('canvas');
    this.innerCanvas.width = 512; this.innerCanvas.height = 96;
    this.innerTex = new THREE.CanvasTexture(this.innerCanvas);
    this.innerTex.colorSpace = THREE.SRGBColorSpace;
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.2), new THREE.MeshBasicMaterial({ map: this.innerTex }));
    inner.position.set(0, YW - 0.2, 3.95);
    inner.rotation.y = Math.PI;
    B.add(inner);
    const inner2 = inner.clone();
    inner2.position.z = -1.5;
    B.add(inner2);
    this.setInnerDisplay('Benvenuti a bordo');

    // ---------- posto guida ----------
    const cab = new THREE.Group();
    B.add(cab);
    box(1.15, 0.62, 0.75, lam(0x2a2d31), 0.62, 1.21, 5.45, cab); // cruscotto
    box(1.15, 0.06, 0.7, lam(0x111214), 0.62, 1.54, 5.5, cab);
    box(BUS.width - 0.1, 0.18, 0.4, lam(0x2a2d31), 0, 1.0, 5.7, cab);
    // quadro strumenti (texture dinamica)
    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 256; this.dashCanvas.height = 128;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: this.dashTex }));
    dash.position.set(0.62, 1.58, 5.5);
    dash.rotation.x = -1.1;
    dash.rotation.y = Math.PI;
    dash.rotation.order = 'YXZ';
    cab.add(dash);
    this.dash = dash;
    // volante
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.set(0.62, 1.78, 5.15);
    this.wheelPivot.rotation.x = -1.2;
    const wheelRot = new THREE.Group();
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 8, 28), lam(0x18191b));
    wheelRot.add(rimM);
    for (const a of [0, 2.1, 4.2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.02), lam(0x2a2b2d));
      sp.position.set(Math.sin(a) * 0.11, Math.cos(a) * 0.11, 0);
      sp.rotation.z = -a;
      wheelRot.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), lam(0x2a2b2d));
    hub.rotation.x = Math.PI / 2;
    wheelRot.add(hub);
    this.wheelPivot.add(wheelRot);
    this.wheelRot = wheelRot;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 8), lam(0x18191b));
    col.position.set(0, 0, -0.22);
    col.rotation.x = Math.PI / 2;
    this.wheelPivot.add(col);
    cab.add(this.wheelPivot);
    // separatore cabina e validatrice
    const sep = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshLambertMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    sep.position.set(0.75, 1.6, 4.2);
    cab.add(sep);
    box(0.25, 0.4, 0.2, lam(0xf2c200), -0.8, 1.5, 3.9, cab);
    // montanti A
    for (const s of [1, -1]) box(0.07, 2.0, 0.07, dark, s * (HW - 0.05), 1.9, L2 - 0.06, cab);
    // sedile autista
    box(0.5, 0.12, 0.5, lam(0x333333), 0.62, 0.95, 4.45, cab);
    box(0.5, 0.75, 0.1, lam(0x333333), 0.62, 1.4, 4.15, cab);
    // tergicristalli contrapposti: perni negli angoli in basso, a riposo distesi lungo il bordo verso il centro, salgono
    // fino ai montanti e puliscono quasi tutto il parabrezza (resta un triangolo in alto al centro)
    this.wipers = [];
    this.wiperArms = []; // perni e spazzole nel piano del parabrezza (per pulire le gocce)
    for (const [side, y, z] of [[1, 0.95, 0.03], [-1, 0.98, 0.05]]) {
      const p = new THREE.Group();
      p.position.set(side * 1.1, y, L2 + z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.8, 0.02), dark);
      arm.position.y = 0.9;
      p.add(arm);
      p.rotation.z = (side * Math.PI) / 2;
      p.userData.side = side;
      B.add(p);
      this.wipers.push(p);
      this.wiperArms.push({ x: side * 1.1, y: y - 1.9, len: 1.8, a: p.rotation.z });
    }
    this.wiperT = WIPER_PARK;

    // passeggeri a bordo (instanced)
    const pg = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.SphereGeometry(0.12, 10, 8).translate(0, 0.86, 0),
    ]);
    const paxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.paxMeshes = units.map((u) => {
      const m = new THREE.InstancedMesh(pg, paxMat, 110);
      m.count = 0;
      m.frustumCulled = false;
      u.P.add(m);
      return m;
    });
    this.paxColors = [];
    this.standSpots = [];
    for (const [k, u] of units.entries())
      for (let z = u.front ? 3.4 : u.zMax - 0.4; z > u.zMin + 1.0; z -= 0.55) for (const x of [0.05, -0.15]) this.standSpots.push({ x: x + (Math.random() - 0.5) * 0.2, z, u: k });
    for (const d of this.doors.slice(1)) for (let k = 0; k < 6; k++) this.standSpots.push({ x: -0.6 - Math.random() * 0.3, z: d.z0 + Math.random() * 1.2, u: d.u });
  }

  // indicatore di linea frontale e laterale (fuori servizio senza numero)
  setDestination(line, dest) {
    this.ledText = [line, dest];
    const tex = ledTexture(line, dest);
    for (const m of this.ledMats) { m.map = tex; m.needsUpdate = true; }
    this.ledTex.dispose();
    this.ledTex = tex;
  }

  setInnerDisplay(text) {
    this.innerText = text;
    const c = this.innerCanvas, x = c.getContext('2d');
    x.fillStyle = '#050505';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#ffa31a';
    let size = 46;
    x.font = `bold ${size}px Arial`;
    while (x.measureText(text).width > c.width - 20 && size > 16) { size -= 2; x.font = `bold ${size}px Arial`; }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height / 2);
    this.innerTex.needsUpdate = true;
  }

  setPassengerVisuals(n) {
    const M = new THREE.Matrix4();
    const seatCount = this.seats.length;
    const show = Math.min(n, 110);
    const counts = this.paxMeshes.map(() => 0);
    while (this.paxColors.length < show) this.paxColors.push(new THREE.Color().setHSL(Math.random(), 0.4 + Math.random() * 0.3, 0.3 + Math.random() * 0.35));
    for (let i = 0; i < show; i++) {
      let u;
      if (i < seatCount) {
        const s = this.seats[i];
        M.makeScale(1, 0.85, 1);
        M.setPosition(s.x, s.y + 0.18, s.z + 0.05);
        u = s.u;
      } else {
        const p = this.standSpots[(i - seatCount) % this.standSpots.length];
        M.makeScale(1, 1.55, 1);
        M.setPosition(p.x, 0.4, p.z);
        u = p.u;
      }
      const mesh = this.paxMeshes[u];
      mesh.setMatrixAt(counts[u], M);
      mesh.setColorAt(counts[u]++, this.paxColors[i]);
    }
    this.paxMeshes.forEach((mesh, u) => {
      mesh.count = counts[u];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.v = 0;
    this.ht = h;
    const a = this.toWorldT(0, ART.trailerAxle);
    this.tax = a.x; this.taz = a.z;
    this.syncTransform();
  }

  get fx() { return Math.sin(this.h); }
  get fz() { return Math.cos(this.h); }
  get speedKmh() { return Math.abs(this.v) * 3.6; }
  get doorsClosed() { return this.doorOpen.every((d) => d < 0.01); }
  get doorsAnyOpen() { return this.doorOpen.some((d) => d > 0.05); }
  get mass() { return (this.articulated ? 17800 : 11800) + this.passengers * 72; }
  // angolo di snodo (rimorchio rispetto alla motrice, 0 se rigido)
  get artAngle() { return this.articulated ? wrapA(this.ht - this.h) : 0; }
  // punto (locale) -> mondo
  toWorld(lx, lz) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }
  // punto nelle coordinate del rimorchio (origine nella ralla) -> mondo; senza snodo coincide con la motrice
  toWorldT(lx, lz) {
    if (!this.articulated) return this.toWorld(lx, lz);
    const j = this.toWorld(0, ART.joint);
    const c = Math.cos(this.ht), s = Math.sin(this.ht);
    return { x: j.x + lx * c + lz * s, z: j.z - lx * s + lz * c };
  }
  // punto davanti a una porta (lx < 0 = lato porte)
  doorWorld(i, lx) {
    const d = this.doors[i], zc = (d.z0 + d.z1) / 2;
    return d.u ? this.toWorldT(lx, zc) : this.toWorld(lx, zc);
  }
  // punto a "dist" metri dietro la coda del bus
  behind(lx, dist) {
    return this.articulated ? this.toWorldT(lx, ART.trailerRear - dist) : this.toWorld(lx, -BUS.length / 2 - dist);
  }
  // cerchi di ingombro in coordinate mondo (lz: posizione lungo la motrice, approssimata per il rimorchio)
  worldCircles(out = []) {
    out.length = 0;
    for (const lz of this.circles) { const p = this.toWorld(0, lz); out.push({ x: p.x, z: p.z, lz }); }
    if (this.articulated) for (const tz of this.tCircles) { const p = this.toWorldT(0, tz); out.push({ x: p.x, z: p.z, lz: ART.joint + tz }); }
    return out;
  }
  // ruote per il controllo del cordolo: rear 0 anteriori, 1 posteriori, 2 rimorchio
  wheelProbes() {
    const out = [];
    for (const s of [1.05, -1.05]) {
      out.push({ ...this.toWorld(s, BUS.frontAxle), rear: 0 });
      out.push({ ...this.toWorld(s, BUS.rearAxle), rear: 1 });
      if (this.articulated) out.push({ ...this.toWorldT(s, ART.trailerAxle), rear: 2 });
    }
    return out;
  }
  // il rimorchio segue la ralla: l'asse viene trascinato verso il punto di aggancio
  updateTrailer() {
    if (!this.articulated) return;
    const j = this.toWorld(0, ART.joint);
    const L = -ART.trailerAxle;
    let dx = j.x - this.tax, dz = j.z - this.taz;
    if (dx * dx + dz * dz < 1e-6) { dx = Math.sin(this.ht); dz = Math.cos(this.ht); }
    const ht = Math.atan2(dx, dz);
    // in retromarcia lo smorzatore anti-sbandamento frena la rotazione dello snodo (come sugli snodati a spinta)
    this.ht = this.v < 0 ? this.ht + wrapA(ht - this.ht) * 0.3 : ht;
    const a = wrapA(this.ht - this.h);
    if (Math.abs(a) > ART.maxAngle) this.ht = this.h + Math.sign(a) * ART.maxAngle;
    this.tax = j.x - Math.sin(this.ht) * L;
    this.taz = j.z - Math.cos(this.ht) * L;
  }

  // ---------------- fisica ----------------
  update(dt, input, world) {
    // input da tastiera con rampe (pedali progressivi)
    // Shift = più forza: W accelera in modo moderato, Shift+W a fondo; S frena dolce, Shift+S frena forte
    // i pedali touch danno direttamente la forza (thrAxis / brkAxis, 0..1)
    const thrTarget = input.thrAxis ? input.thrAxis : input.throttle ? (input.shift ? 1 : 0.6) : 0;
    const brkTarget = input.brkAxis ? input.brkAxis : input.brake ? (input.shift ? 1 : 0.45) : 0;
    this.throttle += Math.sign(thrTarget - this.throttle) * Math.min(Math.abs(thrTarget - this.throttle), dt * (thrTarget > this.throttle ? 1.3 : 3.5));
    this.brake += Math.sign(brkTarget - this.brake) * Math.min(Math.abs(brkTarget - this.brake), dt * (brkTarget > this.brake ? 1.2 : 4));
    // sterzo: i tasti girano il volante, non lo mettono in una posizione. Un colpetto lo sposta di poco, tenendo premuto
    // la mano accelera; lasciato, il volante torna al centro da solo tanto più in fretta quanto più si va veloci
    // (autoallineamento delle ruote), da fermo resta quasi dov'è. Le ruote seguono il volante con un piccolo ritardo.
    // Il volante touch (steerAxis, -1..1) invece dà la posizione: il volante la raggiunge in fretta.
    const touchSteer = input.steerAxis != null;
    const steerKey = touchSteer ? 0 : input.left ? 1 : input.right ? -1 : 0;
    const sp = Math.abs(this.v);
    if (steerKey !== this.steerKey) { this.steerKey = steerKey; this.steerHold = 0; }
    if (touchSteer) {
      const d = input.steerAxis - this.steerIn;
      this.steerIn += Math.sign(d) * Math.min(Math.abs(d), dt * 2.5);
    } else if (steerKey) {
      this.steerHold += dt;
      // sensibilità scelta nel menu (input.steerSens): scala la velocità con cui i tasti girano il volante.
      // Il controsterzo, più svelto, non rallenta: si riporta il volante verso il centro.
      const sens = input.steerSens || 1;
      const back = this.steerIn * steerKey < 0 ? 1.6 * Math.max(1, sens) : sens;
      const rate = (0.22 + Math.min(1, this.steerHold / 0.6) * 0.75) * back;
      this.steerIn = Math.max(-1, Math.min(1, this.steerIn + steerKey * rate * dt));
    } else this.steerIn -= this.steerIn * Math.min(1, dt * (0.4 + 0.1 * sp));
    const maxSteer = 0.62 / (1 + sp * sp * 0.0045);
    this.steer += (this.steerIn * maxSteer - this.steer) * Math.min(1, dt * 7);

    // freno di fermata con porte aperte / freno di stazionamento
    const doorBrake = this.doorsAnyOpen || this.doorTarget > 0;
    let throttle = this.throttle;
    if (doorBrake || this.parking) throttle = 0;
    if (this.throttle > 0.1 && this.parking) this.parking = false; // rilascio automatico al primo gas

    // motore e cambio automatico (diesel) oppure motore elettrico a presa diretta
    let Fdrive;
    if (this.electric) {
      this.gear = 1;
      // coppia piena da fermo, poi potenza costante (200 kW)
      Fdrive = throttle * Math.min(30000, 200000 / Math.max(1, sp)) * (this.dir < 0 ? 0.4 : 1);
      this.rpm += (300 + sp * 170 - this.rpm) * Math.min(1, dt * 6);
    } else {
    const wheelRpm = (sp / BUS.wheelR) * 60 / (2 * Math.PI);
    const ratio = GEARS[this.gear - 1] * FINAL;
    let rpmGear = wheelRpm * ratio;
    if (this.dir < 0) rpmGear = wheelRpm * 3.2 * FINAL;
    // convertitore di coppia: a basse velocità il motore sale di giri
    const stall = IDLE + throttle * 950;
    const tcFactor = Math.max(0, 1 - rpmGear / 1100);
    const targetRpm = Math.max(rpmGear, IDLE + (stall - IDLE) * tcFactor);
    this.rpm += (Math.min(MAXRPM, targetRpm) - this.rpm) * Math.min(1, dt * 6);
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (this.dir > 0) {
      const up = 1450 + throttle * 450;
      if (rpmGear > up && this.gear < 6) { this.gear++; this.shiftTimer = 0.55; this.onShift && this.onShift(1); }
      else if (rpmGear < 800 && this.gear > 1) { this.gear--; this.shiftTimer = 0.4; this.onShift && this.onShift(-1); }
    }
    const tq = torqueAt(this.rpm) * (1 + tcFactor * 0.7);
    Fdrive = throttle * tq * (this.dir < 0 ? 3.2 * FINAL : ratio) * 0.88 / BUS.wheelR;
    if (this.shiftTimer > 0.3) Fdrive *= 0.25;
    }
    if (sp * 3.6 > (this.dir < 0 ? 12 : 72)) Fdrive = 0; // limitatore
    // potenza erogata (kW), negativa in recupero di energia quando si frena
    this.powerKw += ((Fdrive * sp - (this.electric ? this.brake * Math.min(1, sp / 2) * 90000 : 0)) / 1000 - this.powerKw) * Math.min(1, dt * 5);
    const m = this.mass;
    const grip = world.wet ? 0.75 : 1;
    const surface = world.offRoad ? 2.5 : 1;
    const Froll = 0.010 * m * 9.81 * surface;
    const Fdrag = 2.9 * sp * sp;
    // risposta progressiva del pedale: frenate dolci a metà corsa, piena potenza a fondo
    const bEff = this.brake * this.brake * 0.65 + this.brake * 0.35;
    let Fbrake = bEff * 6.5 * m * grip;
    if (doorBrake || this.parking) Fbrake = Math.max(Fbrake, 3.5 * m);
    if (throttle < 0.02 && sp > 1 && this.dir > 0) Fbrake += 0.22 * m * Math.min(1, sp / 6); // freno motore / retarder
    // integrazione longitudinale (v con segno = direzione di marcia)
    const vPrev = this.v;
    const sgn = this.v !== 0 ? Math.sign(this.v) : this.dir;
    // pendenza: rampe dei cavalcavia (slope) e terreno (grade, salite e discese su ponti e argini)
    let a = (Fdrive * this.dir) / m - 9.81 * ((world.slope || 0) + (world.grade || 0));
    const resist = (Froll + Fdrag + Fbrake) / m;
    let vNew = this.v + a * dt;
    // le resistenze si oppongono al moto senza invertire il segno
    if (Math.abs(vNew) > 0.001 || Math.abs(a) > 0.001) {
      const s2 = vNew !== 0 ? Math.sign(vNew) : sgn;
      const mag = Math.abs(vNew) - resist * dt;
      vNew = mag > 0 ? s2 * mag : 0;
    }
    if (this.dir > 0 && vNew < 0 && Fdrive === 0) vNew = 0;
    if (this.dir < 0 && vNew > 0 && Fdrive === 0) vNew = 0;
    this.v = vNew;
    const aLong = (this.v - vPrev) / dt;
    this.aLong += (aLong - this.aLong) * Math.min(1, dt * 8);

    // cinematica a bicicletta sull'asse posteriore
    this._slope = world.slope || 0;
    const yaw = (this.v * Math.tan(this.steer)) / WB;
    this.yawRate = yaw;
    const rx = this.x + Math.sin(this.h) * BUS.rearAxle, rz = this.z + Math.cos(this.h) * BUS.rearAxle;
    this.h += yaw * dt;
    const nrx = rx + Math.sin(this.h) * this.v * dt, nrz = rz + Math.cos(this.h) * this.v * dt;
    this.x = nrx - Math.sin(this.h) * BUS.rearAxle;
    this.z = nrz - Math.cos(this.h) * BUS.rearAxle;
    this.aLat += (this.v * yaw - this.aLat) * Math.min(1, dt * 8);
    this.odometer += Math.abs(this.v) * dt;

    this.updateTrailer();
    // collisioni
    const hit = this.collide(world);
    this.lastHit = hit;
    if (hit) this.updateTrailer();

    // porte
    for (let i = 0; i < this.doors.length; i++) {
      const target = this.doorTarget;
      const d = target - this.doorOpen[i];
      this.doorOpen[i] += Math.sign(d) * Math.min(Math.abs(d), dt / (target > 0 ? 1.1 : 1.4));
    }
    this.kneel += (this.kneelTarget - this.kneel) * Math.min(1, dt * 2);
    this.blink += dt;
    this.syncTransform(dt, input);
    return hit;
  }

  collide(world) {
    let hit = null;
    const circ = this._circ || (this._circ = []);
    for (let iter = 0; iter < 2; iter++) {
      let pushX = 0, pushZ = 0;
      for (const pc of this.worldCircles(circ)) {
        const cx = pc.x, cz = pc.z, lz = pc.lz;
        const obs = world.obstaclesNear(cx, cz, 4);
        for (const b of obs) {
          if (b.dead) continue;
          const p = circleVsOBB(cx, cz, HW + 0.05, b);
          if (p) {
            pushX += p.x; pushZ += p.z;
            if (!hit) hit = { kind: b.kind, x: cx, z: cz, lz, nx: p.x, nz: p.z };
          }
        }
        // auto del traffico
        for (const car of world.carsNear(cx, cz, 8)) {
          const dx = cx - car.x, dz = cz - car.z;
          for (const k of [-1.3, 1.3]) {
            const px = car.x + Math.sin(car.h) * k, pz = car.z + Math.cos(car.h) * k;
            const ddx = cx - px, ddz = cz - pz;
            const d = Math.hypot(ddx, ddz), r = HW + 1.0;
            if (d < r && d > 0.001) {
              const pen = r - d;
              pushX += (ddx / d) * pen * 0.6; pushZ += (ddz / d) * pen * 0.6;
              car.bump = (car.bump || 0) + pen;
              if (!hit) hit = { kind: 'car', car, x: cx, z: cz, lz, nx: ddx, nz: ddz };
            }
          }
          void dx; void dz;
        }
      }
      if (pushX === 0 && pushZ === 0) break;
      this.x += pushX * 0.8;
      this.z += pushZ * 0.8;
    }
    if (hit) {
      const impact = Math.abs(this.v);
      // componente della velocità verso l'ostacolo
      const n = Math.hypot(hit.nx, hit.nz) || 1;
      const dot = (this.fx * hit.nx + this.fz * hit.nz) / n * Math.sign(this.v || 1);
      if (dot < -0.55) this.v *= 0.1; // urto frontale/posteriore
      else this.v *= 0.97; // strisciata laterale
      hit.impact = impact * Math.max(0.2, -dot);
    }
    return hit;
  }

  syncTransform(dt = 0, input = {}) {
    this.group.position.set(this.x, Y_ROAD + (this.elev || 0), this.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.h;
    this.slopeVis = (this.slopeVis || 0) + ((this._slope || 0) - (this.slopeVis || 0)) * Math.min(1, dt * 6);
    this.group.rotation.x = -Math.atan(this.slopeVis);
    // sospensioni: beccheggio e rollio
    const tp = -this.aLong * 0.006, tr = this.aLat * 0.008;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 3);
    this.roll += (tr - this.roll) * Math.min(1, dt * 3);
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = -this.roll + this.kneel * 0.035;
    this.body.position.y = -this.kneel * 0.06;
    // ruote
    this.wheelSpin += (this.v / BUS.wheelR) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer;
    }
    this.wheelRot.rotation.z = -this.steer * 14;
    if (this.articulated) {
      const art = this.artAngle;
      this.trailer.rotation.y = art;
      this.bellows.rotation.y = art / 2;
      this.tBody.rotation.x = this.pitch * 0.6;
      this.tBody.rotation.z = this.body.rotation.z;
      this.tBody.position.y = this.body.position.y;
    }
    // porte: le ante escono e scorrono
    this.doors.forEach((d, i) => {
      const o = this.doorOpen[i];
      for (const g of this.doorLeaves[i]) {
        const u = g.userData;
        const t1 = Math.min(1, o * 2.2), t2 = Math.max(0, (o - 0.3) / 0.7);
        g.position.x = -HW - 0.01 - t1 * 0.12;
        g.position.z = u.z + u.dir * t2 * (u.w * 0.85);
      }
    });
    // luci
    const on = this.blink % 0.8 < 0.4;
    const L = this.indicator === -1 || this.indicator === 2, R = this.indicator === 1 || this.indicator === 2;
    this.indMatL.emissiveIntensity = L && on ? 2.2 : 0;
    this.indMatR.emissiveIntensity = R && on ? 2.2 : 0;
    this.headMat.emissiveIntensity = this.lights ? 2 : 0.15;
    this.tailMat.emissiveIntensity = this.lights ? 0.9 : 0.05;
    this.brakeMat.emissiveIntensity = this.brake > 0.05 || this.doorsAnyOpen ? 2.5 : 0;
    this.revMat.emissiveIntensity = this.dir < 0 ? 2 : 0;
    for (const l of this.headLights) l.intensity = this.lights ? 75 : 0;
    // tergicristalli e gocce sul parabrezza
    this.wiperT = wiperPhase(this.wiperT, !!input.wipers, dt);
    const up = Math.sin(this.wiperT) * 0.5 + 0.5; // 0 a riposo, 1 contro il montante
    this.wipers.forEach((w, i) => (w.rotation.z = this.wiperArms[i].a = (w.userData.side * Math.PI) / 2 * (1 - up)));
    if (dt > 0) this.rainGlass.update(dt, input.rain || 0, Math.abs(this.v), this.wiperArms);
  }

  drawDash(state) {
    const c = this.dashCanvas, x = c.getContext('2d');
    x.fillStyle = '#0a0b0d';
    x.fillRect(0, 0, 256, 128);
    const gauge = (cx, val, max, label, color) => {
      x.strokeStyle = '#333';
      x.lineWidth = 6;
      x.beginPath();
      x.arc(cx, 70, 44, Math.PI * 0.8, Math.PI * 2.2);
      x.stroke();
      x.strokeStyle = color;
      x.beginPath();
      x.arc(cx, 70, 44, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * Math.min(1, val / max)));
      x.stroke();
      x.fillStyle = '#eee';
      x.font = 'bold 24px Arial';
      x.textAlign = 'center';
      x.fillText(label, cx, 78);
    };
    gauge(64, this.speedKmh, 80, Math.round(this.speedKmh), '#4fc3f7');
    if (this.electric) gauge(192, Math.max(0, this.powerKw), 200, this.dir < 0 ? 'R' : this.powerKw < -2 ? 'REC' : 'E', this.powerKw < -2 ? '#66bb6a' : '#a6d22e');
    else gauge(192, this.rpm, 2500, this.dir < 0 ? 'R' : 'D' + this.gear, '#ffb74d');
    if (state.doors) { x.fillStyle = '#ff5252'; x.fillRect(116, 10, 24, 14); }
    if (state.request) { x.fillStyle = '#ffeb3b'; x.fillRect(116, 30, 24, 14); }
    if (this.parking) { x.fillStyle = '#ff1744'; x.font = 'bold 16px Arial'; x.fillText('P', 128, 118); }
    this.dashTex.needsUpdate = true;
  }
}
