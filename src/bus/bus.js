import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ledTexture, labelTexture } from '../world/textures.js';
import { circleVsOBB } from '../world/spatial.js';
import { Y_ROAD } from '../world/city.js';

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
const WB = BUS.frontAxle - BUS.rearAxle;
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
    this.v = 0; this.steer = 0; this.steerIn = 0;
    this.throttle = 0; this.brake = 0;
    this.gear = 1; this.dir = 1; // 1 = D, -1 = R
    this.rpm = IDLE; this.shiftTimer = 0;
    this.parking = true;
    this.doorOpen = [0, 0, 0];
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
    this.circles = [-4.9, -2.45, 0, 2.45, 4.9];
    this.lastCollision = 0;
    this.buildModel(lineInfo);
  }

  // ---------------- modello 3D ----------------
  buildModel(lineInfo) {
    const B = this.body;
    const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    const paint = lam(0xf3f3ef);
    const stripe = lam(new THREE.Color(lineInfo.color));
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
    // intervalli lungo z esclusi (passaruota, porte)
    const arches = [BUS.frontAxle, BUS.rearAxle].map((a) => [a - 0.62, a + 0.62]);
    const pieces = (excl) => {
      const segs = [];
      let z = -L2 + 0.05;
      const ex = [...excl].sort((a, b) => a[0] - b[0]);
      for (const [a, b] of ex) { if (a > z) segs.push([z, a]); z = Math.max(z, b); }
      if (z < L2 - 0.05) segs.push([z, L2 - 0.05]);
      return segs;
    };
    const doorEx = BUS.doors.map((d) => [d.z0, d.z1]);
    for (const side of [1, -1]) {
      const x = side * (HW - 0.03);
      const excl = side < 0 ? [...arches, ...doorEx] : arches;
      // fascia bassa (0.95 - YB) continua tranne porte
      for (const [a, b] of pieces(side < 0 ? doorEx : [])) box(0.06, YB - 0.9, b - a, paint, x, (YB + 0.9) / 2, (a + b) / 2);
      // gonna (Y0-0.9) esclusi passaruota e porte
      for (const [a, b] of pieces(excl)) box(0.06, 0.9 - Y0, b - a, paint, x, (0.9 + Y0) / 2, (a + b) / 2);
      // striscia colorata
      for (const [a, b] of pieces(side < 0 ? doorEx : [])) {
        const s = box(0.02, 0.16, b - a, stripe, x + side * 0.03, 1.0, (a + b) / 2);
        s.castShadow = false;
      }
      // fascia finestre: montanti e vetri
      const glassMat = new THREE.MeshLambertMaterial({ color: 0x1d2a33, transparent: true, opacity: 0.55 });
      for (const [a, b] of pieces(side < 0 ? doorEx : [])) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(b - a, YW - YB), glassMat);
        g.position.set(x + side * 0.035, (YW + YB) / 2, (a + b) / 2);
        g.rotation.y = side * Math.PI / 2;
        B.add(g);
        // montanti ogni ~1.5 m
        const n = Math.max(1, Math.round((b - a) / 1.55));
        for (let k = 0; k <= n; k++) if (a + ((b - a) * k) / n < L2 - 0.3) box(0.08, YW - YB, 0.1, dark, x, (YW + YB) / 2, a + ((b - a) * k) / n);
      }
      // sopra le porte
      if (side < 0) for (const d of BUS.doors) box(0.06, YT - YW + 0.1, d.z1 - d.z0, paint, x, (YW + YT) / 2 - 0.05, (d.z0 + d.z1) / 2);
    }
    // tetto
    box(BUS.width, YT - YW, BUS.length - 0.1, paint, 0, (YW + YT) / 2, 0);
    box(1.6, 0.32, 2.8, lam(0xe0e0dc), 0, YT + 0.16, 0.8); // climatizzatore
    box(1.4, 0.25, 1.6, lam(0xe0e0dc), 0, YT + 0.12, -4.6);
    // pavimento
    box(BUS.width - 0.1, 0.08, BUS.length - 0.1, lam(0x4b4f55), 0, Y0 + 0.04, 0);
    // frontale
    box(BUS.width, 0.62, 0.12, paint, 0, Y0 + 0.31, L2 - 0.06);
    box(BUS.width + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, L2); // paraurti
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width - 0.1, 1.95), new THREE.MeshLambertMaterial({ color: 0x223844, transparent: true, opacity: 0.3 }));
    ws.position.set(0, 1.9, L2 - 0.02);
    ws.rotation.x = -0.04;
    B.add(ws);
    box(BUS.width, 0.26, 0.1, paint, 0, YT - 0.13, L2 - 0.05);
    // display LED frontale e laterale
    this.ledTex = ledTexture(lineInfo.id, lineInfo.dest);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.26), new THREE.MeshBasicMaterial({ map: this.ledTex }));
    led.position.set(0, YT - 0.14, L2 + 0.012);
    B.add(led);
    const ledS = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.17), new THREE.MeshBasicMaterial({ map: this.ledTex }));
    ledS.position.set(-HW - 0.02, 2.35, 3.0);
    ledS.rotation.y = -Math.PI / 2;
    B.add(ledS);
    const ledR = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.26), new THREE.MeshBasicMaterial({ map: labelTexture(lineInfo.id, { w: 128, h: 64, bg: '#080808', fg: '#ffa31a', font: 'bold 52px Courier New' }) }));
    ledR.position.set(0, 2.75, -L2 - 0.012);
    ledR.rotation.y = Math.PI;
    B.add(ledR);
    // retro
    box(BUS.width, YT - Y0, 0.1, paint, 0, (YT + Y0) / 2 - 0.3, -L2 + 0.05).scale.set(1, 0.72, 1);
    box(BUS.width + 0.04, 0.25, 0.2, dark, 0, Y0 + 0.1, -L2);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width - 0.4, 0.8), new THREE.MeshLambertMaterial({ color: 0x1d2a33, transparent: true, opacity: 0.6 }));
    rw.position.set(0, 2.35, -L2 - 0.01);
    rw.rotation.y = Math.PI;
    B.add(rw);
    // logo laterale "PADOVA"
    for (const side of [1, -1]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture('PADOVA · LINEA ' + lineInfo.id, { w: 512, h: 80, bg: '#f3f3ef', fg: lineInfo.color, font: 'bold 46px Arial' }) }));
      t.position.set(side * (HW + 0.005), 0.62, -0.9);
      t.rotation.y = side * Math.PI / 2;
      B.add(t);
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
      box(0.16, 0.4, 0.06, this.tailMat, s * 1.08, 1.0, -L2 - 0.01);
      box(0.16, 0.2, 0.06, this.brakeMat, s * 1.08, 1.45, -L2 - 0.01);
      box(0.16, 0.16, 0.06, s > 0 ? this.indMatL : this.indMatR, s * 1.08, 1.7, -L2 - 0.01);
      box(0.06, 0.08, 0.2, s > 0 ? this.indMatL : this.indMatR, s * (HW + 0.02), 1.05, 3.9);
      box(0.12, 0.1, 0.06, this.revMat, s * 0.7, 0.55, -L2 - 0.01);
    }
    // fari reali
    this.headLight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.5, 0.5, 1.2);
    this.headLight.position.set(0, 1.0, L2);
    this.headLight.target.position.set(0, 0, L2 + 25);
    B.add(this.headLight, this.headLight.target);

    // specchietti
    for (const s of [1, -1]) {
      box(0.05, 0.05, 0.5, dark, s * (HW + 0.15), 2.55, L2 + 0.05);
      box(0.08, 0.5, 0.25, dark, s * (HW + 0.3), 2.3, L2 + 0.25);
    }

    // porte (due ante ciascuna)
    this.doorLeaves = [];
    const doorGlass = new THREE.MeshLambertMaterial({ color: 0x2a3a44, transparent: true, opacity: 0.45 });
    for (const d of BUS.doors) {
      const w = (d.z1 - d.z0) / 2;
      const leaves = [];
      for (const k of [0, 1]) {
        const g = new THREE.Group();
        const zc = d.z0 + w / 2 + k * w;
        g.position.set(-HW - 0.01, 0, zc);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.28, w - 0.02), paint);
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
        const frm = new THREE.Mesh(fr, dark);
        g.add(frm, gl);
        g.userData = { z: zc, dir: k ? 1 : -1, w };
        B.add(g);
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
    for (const az of [BUS.frontAxle, BUS.rearAxle])
      for (const s of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * (HW - 0.2), BUS.wheelR, az);
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(tire, lam(0x151515)), new THREE.Mesh(rim, lam(0x9aa0a6)));
        spin.children.forEach((c) => (c.castShadow = true));
        pivot.add(spin);
        this.group.add(pivot);
        this.wheels.push({ pivot, spin, front: az > 0 });
      }
    // ombra a terra
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(BUS.width + 0.4, BUS.length + 0.4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.02;
    this.group.add(sh);

    // ---------- interni ----------
    const seatMat = lam(0x24476b);
    const poleMat = lam(0xf2c200);
    const seatG = mergeGeometries([
      new THREE.BoxGeometry(0.45, 0.1, 0.45).translate(0, 0.45, 0),
      new THREE.BoxGeometry(0.45, 0.55, 0.08).translate(0, 0.78, -0.22),
      new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0, 0.22, 0),
    ]);
    this.seats = [];
    const seatRows = [];
    for (let z = 2.9; z > -5.4; z -= 0.8) {
      if (z < BUS.doors[1].z1 + 0.3 && z > BUS.doors[1].z0 - 0.5) continue; // area carrozzine
      if (z < BUS.doors[2].z1 + 0.2 && z > BUS.doors[2].z0 - 0.3) { seatRows.push([z, [0.72, 0.27]]); continue; }
      seatRows.push([z, [0.72, 0.27, -0.72, -0.27]]);
    }
    const seatInst = new THREE.InstancedMesh(seatG, seatMat, seatRows.reduce((a, r) => a + r[1].length, 0));
    let si = 0;
    const M = new THREE.Matrix4();
    for (const [z, xs] of seatRows)
      for (const x of xs) {
        M.makeTranslation(x, Y0 + 0.08, z);
        seatInst.setMatrixAt(si++, M);
        this.seats.push({ x, z, y: Y0 + 0.08 });
      }
    B.add(seatInst);
    // corrimano e pali
    const poles = [];
    for (let z = 3.6; z > -5.5; z -= 1.6) for (const x of [0.45, -0.45]) poles.push(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6).translate(x, Y0 + 1.15, z));
    for (const x of [0.45, -0.45]) poles.push(new THREE.CylinderGeometry(0.02, 0.02, 9.6, 6).rotateX(Math.PI / 2).translate(x, YW - 0.15, -0.9));
    B.add(new THREE.Mesh(mergeGeometries(poles), poleMat));
    // luci soffitto
    this.cabinLightMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, emissive: 0xf0f4ff, emissiveIntensity: 0.3 });
    box(0.25, 0.03, 9.5, this.cabinLightMat, 0.6, YW - 0.02, -0.6).castShadow = false;
    box(0.25, 0.03, 9.5, this.cabinLightMat, -0.6, YW - 0.02, -0.6).castShadow = false;
    // pareti interne sotto finestrino (grigio chiaro)
    for (const s of [1, -1]) box(0.02, 0.75, BUS.length - 0.4, interiorWall, s * (HW - 0.08), Y0 + 0.45, 0).castShadow = false;
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
    // tergicristalli
    this.wipers = [];
    for (const s of [0.55, -0.6]) {
      const p = new THREE.Group();
      p.position.set(s, 0.95, L2 + 0.03);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.02), dark);
      arm.position.y = 0.55;
      p.add(arm);
      p.rotation.z = 1.35;
      B.add(p);
      this.wipers.push(p);
    }
    this.wiperT = 0;

    // passeggeri a bordo (instanced)
    const pg = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.SphereGeometry(0.12, 10, 8).translate(0, 0.86, 0),
    ]);
    this.paxMesh = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0xffffff }), 110);
    this.paxMesh.count = 0;
    this.paxMesh.frustumCulled = false;
    B.add(this.paxMesh);
    this.paxColors = [];
    this.standSpots = [];
    for (let z = 3.4; z > -5.0; z -= 0.55) for (const x of [0.05, -0.15]) this.standSpots.push({ x: x + (Math.random() - 0.5) * 0.2, z });
    for (const d of BUS.doors.slice(1)) for (let k = 0; k < 6; k++) this.standSpots.push({ x: -0.6 - Math.random() * 0.3, z: d.z0 + Math.random() * 1.2 });
  }

  setInnerDisplay(text) {
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
    const M = new THREE.Matrix4(), col = new THREE.Color();
    const seatCount = this.seats.length;
    const show = Math.min(n, 110);
    while (this.paxColors.length < show) this.paxColors.push(new THREE.Color().setHSL(Math.random(), 0.4 + Math.random() * 0.3, 0.3 + Math.random() * 0.35));
    for (let i = 0; i < show; i++) {
      if (i < seatCount) {
        const s = this.seats[i];
        M.makeScale(1, 0.85, 1);
        M.setPosition(s.x, s.y + 0.18, s.z + 0.05);
      } else {
        const p = this.standSpots[(i - seatCount) % this.standSpots.length];
        M.makeScale(1, 1.55, 1);
        M.setPosition(p.x, 0.4, p.z);
      }
      this.paxMesh.setMatrixAt(i, M);
      this.paxMesh.setColorAt(i, this.paxColors[i]);
    }
    this.paxMesh.count = show;
    this.paxMesh.instanceMatrix.needsUpdate = true;
    if (this.paxMesh.instanceColor) this.paxMesh.instanceColor.needsUpdate = true;
  }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.v = 0;
    this.syncTransform();
  }

  get fx() { return Math.sin(this.h); }
  get fz() { return Math.cos(this.h); }
  get speedKmh() { return Math.abs(this.v) * 3.6; }
  get doorsClosed() { return this.doorOpen.every((d) => d < 0.01); }
  get doorsAnyOpen() { return this.doorOpen.some((d) => d > 0.05); }
  get mass() { return 11800 + this.passengers * 72; }
  // punto (locale) -> mondo
  toWorld(lx, lz) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }

  // ---------------- fisica ----------------
  update(dt, input, world) {
    // input da tastiera con rampe (pedali progressivi)
    // Shift = più forza: W accelera in modo moderato, Shift+W a fondo; S frena dolce, Shift+S frena forte
    const thrTarget = input.throttle ? (input.shift ? 1 : 0.6) : 0;
    const brkTarget = input.brake ? (input.shift ? 1 : 0.45) : 0;
    this.throttle += Math.sign(thrTarget - this.throttle) * Math.min(Math.abs(thrTarget - this.throttle), dt * (thrTarget > this.throttle ? 1.3 : 3.5));
    this.brake += Math.sign(brkTarget - this.brake) * Math.min(Math.abs(brkTarget - this.brake), dt * (brkTarget > this.brake ? 1.2 : 4));
    // sterzo
    const steerTarget = input.left ? 1 : input.right ? -1 : 0;
    const sp = Math.abs(this.v);
    const rate = steerTarget !== 0 ? 0.85 : 1.25;
    this.steerIn += Math.sign(steerTarget - this.steerIn) * Math.min(Math.abs(steerTarget - this.steerIn), dt * rate * (steerTarget !== 0 && Math.sign(steerTarget) !== Math.sign(this.steerIn) ? 1.8 : 1));
    const maxSteer = 0.62 / (1 + sp * sp * 0.0045);
    this.steer = this.steerIn * maxSteer;

    // freno di fermata con porte aperte / freno di stazionamento
    const doorBrake = this.doorsAnyOpen || this.doorTarget > 0;
    let throttle = this.throttle;
    if (doorBrake || this.parking) throttle = 0;
    if (this.throttle > 0.1 && this.parking) this.parking = false; // rilascio automatico al primo gas

    // motore e cambio automatico
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
    let Fdrive = throttle * tq * (this.dir < 0 ? 3.2 * FINAL : ratio) * 0.88 / BUS.wheelR;
    if (this.shiftTimer > 0.3) Fdrive *= 0.25;
    if (sp * 3.6 > (this.dir < 0 ? 12 : 72)) Fdrive = 0; // limitatore
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
    let a = (Fdrive * this.dir) / m - 9.81 * (world.slope || 0);
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

    // collisioni
    const hit = this.collide(world);
    this.lastHit = hit;

    // porte
    for (let i = 0; i < 3; i++) {
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
    const c = Math.cos(this.h), s = Math.sin(this.h);
    for (let iter = 0; iter < 2; iter++) {
      let pushX = 0, pushZ = 0;
      for (const lz of this.circles) {
        const cx = this.x + lz * s, cz = this.z + lz * c;
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
    // porte: le ante escono e scorrono
    BUS.doors.forEach((d, i) => {
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
    this.headLight.intensity = this.lights ? 120 : 0;
    // tergicristalli
    if (input.wipers) {
      this.wiperT += dt * 2.4;
      const a = 1.35 - (Math.sin(this.wiperT) * 0.5 + 0.5) * 1.6;
      for (const w of this.wipers) w.rotation.z = a;
    }
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
    gauge(192, this.rpm, 2500, this.dir < 0 ? 'R' : 'D' + this.gear, '#ffb74d');
    if (state.doors) { x.fillStyle = '#ff5252'; x.fillRect(116, 10, 24, 14); }
    if (state.request) { x.fillStyle = '#ffeb3b'; x.fillRect(116, 30, 24, 14); }
    if (this.parking) { x.fillStyle = '#ff1744'; x.font = 'bold 16px Arial'; x.fillText('P', 128, 118); }
    this.dashTex.needsUpdate = true;
  }
}
