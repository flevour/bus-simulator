import * as THREE from 'three';
import { toXZ } from '../data/padova.js';
import { distToSeg } from './spatial.js';

// Sorpresa alla DonQ (#91). L'edificio della DonQ, a ovest di Corso del Popolo all'angolo con Via Niccolò Tommaseo, non
// ferma il bus: chi ci entra vede, sospesa davanti al bus, una foto dell'interno con il logo sulla parete, e uscendo
// non la vede più. La pianta è quella che contiene il punto della foto, o la più vicina entro 15 m: City.addBuildings
// la mette in un riquadro tutto suo (chiave 'sorpresa') e buildTile non mette i suoi muri tra gli ostacoli.
// La foto (public/sorpresa/donq.jpg, 1280 × 960, senza metadati) non è nel bundle: si scarica quando il bus arriva a
// 150 m. Nella pagina autosufficiente (npm run build:single) public/ non c'è e la foto nemmeno.
export const PUNTO = toXZ(45.41598, 11.87916);
const FOTO = 'sorpresa/donq.jpg';
const VICINO = 15; // m: senza una pianta che contiene il punto, la più vicina entro questa distanza
const W = 5.2, H = W * 0.75; // m, come la foto
const MUSO = 6; // m dal centro del bus al muso (anche dello snodato: BUS e ART in bus.js)
const AVANTI = 5.5; // m dal muso al centro della foto
const ALTO = 3; // m da terra al centro della foto: dal posto di guida nel parabrezza, da fuori sopra il tetto

// il punto (x, z) è dentro l'anello pts
export function dentro(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

// tra gli edifici di un'area, quello della sorpresa (o null)
export function edificioSorpresa(list) {
  let best = null, bd = VICINO;
  for (const b of list) {
    const p = b.pts[0];
    if (!p || Math.abs(p.x - PUNTO.x) > 300 || Math.abs(p.z - PUNTO.z) > 300) continue;
    if (dentro(b.pts, PUNTO.x, PUNTO.z)) return b;
    for (let i = 0; i < b.pts.length; i++) {
      const q = b.pts[i], r = b.pts[(i + 1) % b.pts.length];
      const d = distToSeg(PUNTO.x, PUNTO.z, q.x, q.z, r.x, r.z).d;
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best;
}

export class Sorpresa {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null; // la foto, fatta quando arriva l'immagine
    this.stato = null; // 'scarica', 'pronta' o 'errore'
    this.inside = false;
  }

  carica() {
    this.stato = 'scarica';
    new THREE.TextureLoader().load(FOTO, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      // senza luci, nebbia e tone mapping: uguale di giorno, di notte e col brutto tempo
      const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
      this.mesh.name = 'sorpresa-donq';
      this.mesh.visible = false;
      this.scene.add(this.mesh);
      this.stato = 'pronta';
    }, undefined, () => { this.stato = 'errore'; });
  }

  // a ogni passo, dopo City.streamTiles (che rimette visibili i riquadri vicini): con il posto di guida dentro
  // l'edificio la foto sta davanti al bus, rivolta verso chi guida, e l'edificio si nasconde perché la si veda anche
  // dalla vista da fuori
  update(bus, city) {
    const tile = city.tiles && city.tiles.get('sorpresa');
    const d = Math.hypot(bus.x - PUNTO.x, bus.z - PUNTO.z);
    if (tile && !this.stato && d < 150) this.carica();
    let inside = false;
    if (tile && !bus.isTram && d < 100) {
      const p = bus.toWorld(0, (bus.cabEye || [0, 0, 4.8])[2]);
      inside = dentro(tile.list[0].pts, p.x, p.z);
    }
    this.inside = inside;
    if (inside) for (const m of tile.meshes) m.visible = false;
    if (!this.mesh) return;
    this.mesh.visible = inside;
    if (!inside) return;
    const f = bus.toWorld(0, MUSO + AVANTI);
    this.mesh.position.set(f.x, (bus.elev || 0) + ALTO, f.z);
    this.mesh.rotation.set(0, bus.h + Math.PI, 0);
  }
}
