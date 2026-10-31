// The oracle: a sculpted, hand-painted sugar skull. Everything is generated in code, no 3D assets.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const TEAL = "#1fc8b8";
const MARIGOLD = "#ff8a00";
const GOLD = "#ffc21a";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- Sculpting ----------

const EYE = new THREE.Vector3(0.38, -0.06, 0.92).normalize();
const EYE_RADIUS = 0.3;
const MOUTH_DIR_Y = 0.7; // where the mouth groove is carved, in sphere directions
const mouthY = (x) => -0.755 + 0.25 * x * x; // the same line in the final skull: a gentle smile

// Signed (approximate) distance to an upside-down heart (lobes below, point up), in the face plane.
function heartDistance(x, y) {
  const lobe = Math.min(Math.hypot(x - 0.05, y + 0.5), Math.hypot(x + 0.05, y + 0.5)) - 0.06;
  const tri = Math.max(Math.abs(x) - (0.11 * (-0.34 - y)) / 0.16, y + 0.34, -(y + 0.5));
  return Math.min(lobe, tri);
}

function sculptSkull() {
  const geometry = new THREE.SphereGeometry(1, 220, 160);
  const pos = geometry.attributes.position;
  const cavity = new Float32Array(pos.count);
  const d = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const gauss = (v, c, s) => Math.exp(-v.distanceToSquared(c) / (2 * s * s));

  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const front = smooth(0.2, 0.7, d.z);
    let r = 1;

    // Cheekbones out, temples in, a soft brow ridge.
    for (const side of [-1, 1]) {
      r += 0.04 * gauss(d, new THREE.Vector3(side * 0.62, -0.36, 0.69), 0.16);
      r -= 0.06 * gauss(d, new THREE.Vector3(side * 0.9, 0.12, 0.35), 0.2);
      r += 0.025 * gauss(d, new THREE.Vector3(side * 0.36, 0.22, 0.9), 0.12);
    }

    // Eye sockets: deep, smooth bowls.
    let cav = 0;
    for (const side of [-1, 1]) {
      eye.set(side * EYE.x, EYE.y, EYE.z);
      const s = 1 - smooth(0, EYE_RADIUS, d.distanceTo(eye));
      r -= 0.2 * s;
      cav = Math.max(cav, smooth(0.08, 0.55, s));
    }

    // A shallow dip for the nose; its crisp black heart is painted on top.
    if (d.z > 0.5) r -= 0.035 * (1 - smooth(-0.04, 0.02, heartDistance(d.x, d.y)));

    // The mouth: a groove where the teeth sit, dark inside.
    const groove = Math.exp(-(((d.y + MOUTH_DIR_Y) / 0.035) ** 2)) * front;
    r -= 0.07 * groove;
    cav = Math.max(cav, 0.85 * groove);

    let x = d.x * r;
    let y = d.y * r;
    let z = d.z * r;
    if (y < -0.55) y = -0.55 + (y + 0.55) * (1 + 0.45 * front); // a proper chin below the mouth
    if (y < -0.8) y = -0.8 + (y + 0.8) * (1 + 0.9 * front); // and room on it for the chin flower
    x *= 0.95 * (1 - 0.22 * smooth(-0.2, -0.95, y) - 0.2 * front * smooth(-0.75, -1.15, y));
    z *= z < 0 ? 1.06 : 0.96;
    pos.setXYZ(i, x, y, z);
    cavity[i] = cav;
  }
  geometry.setAttribute("aCavity", new THREE.BufferAttribute(cavity, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// Cut the one sculpted skull along the mouth: the front below the line becomes the jaw. Both halves
// share vertices and normals, so at rest they read as a single seamless skull.
function splitAtMouth(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index.array;
  const upper = [];
  const lower = [];
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    (cy < mouthY(cx) && cz > -0.15 ? lower : upper).push(a, b, c);
  }
  const part = (indices) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
    g.setIndex(indices);
    return g;
  };
  return { upper: part(upper), lower: part(lower) };
}

// ---------- Painting ----------
// The tattoos follow a classic calavera: scalloped marigold rings round the eyes, a monarch butterfly
// and a red flower on the brow, leafy vines with curls and rosebuds, a heart-shaped nose with flourishes.

const LEAF = "#43a047";
const LEAF_DARK = "#2e7d32";
const RED = "#e53935";
const ORANGE = "#f5a524";
const ORANGE_LIGHT = "#ffc94d";
const BLACK = "#161114";
const FACE_SCALE = 0.4; // the painting spans x and y in [-1.25, 1.25], chin included

function canvasPainter(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const u = size * FACE_SCALE; // one face unit in pixels
  const P = (x, y) => [(x * FACE_SCALE + 0.5) * size, (0.5 - y * FACE_SCALE) * size];
  g.lineCap = g.lineJoin = "round";

  const paint = {
    canvas,
    dot(cx, cy, r, fill, stroke) {
      const [x, y] = P(cx, cy);
      g.beginPath();
      g.arc(x, y, r * u, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (stroke) { g.lineWidth = 0.006 * u; g.strokeStyle = stroke; g.stroke(); }
    },
    leaf(cx, cy, angle, length, width) {
      const [x, y] = P(cx, cy);
      g.save();
      g.translate(x, y);
      g.rotate(-angle);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(length * 0.5 * u, -width * u, length * u, 0);
      g.quadraticCurveTo(length * 0.5 * u, width * u, 0, 0);
      g.fillStyle = LEAF;
      g.fill();
      g.lineWidth = 0.005 * u;
      g.strokeStyle = LEAF_DARK;
      g.stroke();
      g.beginPath(); // midrib
      g.moveTo(0, 0);
      g.lineTo(length * 0.8 * u, 0);
      g.stroke();
      g.restore();
    },
    curl(cx, cy, r, turns, dir, colour = LEAF_DARK, width = 0.008) {
      g.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const a = dir * t * turns * Math.PI * 2;
        const rr = r * (1 - t * 0.9);
        const [x, y] = P(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = colour;
      g.lineWidth = width * u;
      g.stroke();
    },
    // A vine along a cubic Bézier with alternating leaves and a curl at its tip.
    vine(p0, p1, p2, p3, leaves, side) {
      const at = (t) => {
        const m = 1 - t;
        return [
          m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
          m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
        ];
      };
      g.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const [x, y] = P(...at(t));
        t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = LEAF_DARK;
      g.lineWidth = 0.016 * u;
      g.stroke();
      for (let i = 1; i <= leaves; i++) {
        const t = i / (leaves + 1);
        const [x, y] = at(t);
        const [nx, ny] = at(Math.min(1, t + 0.02));
        const along = Math.atan2(ny - y, nx - x);
        const flip = i % 2 ? 1 : -1;
        paint.leaf(x, y, along + flip * 0.9, 0.1, 0.04);
        if (i % 3 === 0) paint.curl(x, y, 0.035, 1.1, flip, LEAF_DARK, 0.01); // tendrils
      }
      const [ex, ey] = at(1);
      paint.curl(ex, ey, 0.05, 1.2, side, LEAF_DARK, 0.012);
    },
    // Scalloped marigold petals round the eye, golden inside, the way Jorge liked them.
    scallopRing(cx, cy) {
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        paint.dot(cx + Math.cos(a) * 0.3, cy + Math.sin(a) * 0.3, 0.068, ORANGE, BLACK);
      }
      paint.dot(cx, cy, 0.3, ORANGE_LIGHT);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        paint.dot(cx + Math.cos(a) * 0.335, cy + Math.sin(a) * 0.335, 0.012, "#ffffff");
      }
    },
    flower(cx, cy, r, petals, fill, centre) {
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + Math.PI / 2;
        paint.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.85, fill, BLACK);
      }
      paint.dot(cx, cy, r * 0.75, centre, BLACK);
    },
    // A monarch: pointed forewings, rounded hindwings, black veins. Shapes are in units of s, body at 0,0.
    butterfly(cx, cy, s) {
      const Q = (x, y) => P(cx + x * s, cy + y * s);
      const path = (points) => { // [start, [c1, c2, end], ...] cubic Béziers
        g.beginPath();
        g.moveTo(...Q(...points[0]));
        for (const [c1, c2, end] of points.slice(1)) g.bezierCurveTo(...Q(...c1), ...Q(...c2), ...Q(...end));
        g.closePath();
      };
      for (const side of [-1, 1]) {
        const m = ([x, y]) => [x * side, y];
        const fore = [[0.04, 0.04], [[0.2, 0.42], [0.62, 0.62], [0.78, 0.5]],
          [[0.8, 0.3], [0.62, 0.02], [0.42, -0.02]], [[0.25, -0.02], [0.1, 0], [0.04, 0.04]]];
        const hind = [[0.04, -0.02], [[0.3, -0.02], [0.55, -0.12], [0.5, -0.36]],
          [[0.44, -0.55], [0.18, -0.55], [0.08, -0.38]], [[0.03, -0.25], [0.02, -0.1], [0.04, -0.02]]];
        for (const wing of [hind, fore]) {
          path([m(wing[0]), ...wing.slice(1).map((seg) => seg.map(m))]);
          const [x0, y0] = Q(0, 0);
          const [x1, y1] = Q(side * 0.6, 0.3);
          const grad = g.createLinearGradient(x0, y0, x1, y1);
          grad.addColorStop(0, "#e65100");
          grad.addColorStop(1, "#ffb300");
          g.fillStyle = grad;
          g.fill();
          g.lineWidth = 0.07 * s * u;
          g.strokeStyle = BLACK;
          g.stroke();
        }
        g.lineWidth = 0.028 * s * u;
        for (const [ex, ey] of [[0.7, 0.45], [0.66, 0.2], [0.5, 0.05], [0.42, -0.3], [0.2, -0.45]]) { // veins
          const [x0, y0] = Q(side * 0.04, 0);
          const [xm, ym] = Q(side * ex * 0.55, ey * 0.7);
          const [x1, y1] = Q(side * ex * 0.95, ey * 0.95);
          g.beginPath();
          g.moveTo(x0, y0);
          g.quadraticCurveTo(xm, ym, x1, y1);
          g.stroke();
        }
      }
      const [bx, by] = P(cx, cy);
      g.beginPath();
      g.ellipse(bx, by, 0.06 * s * u, 0.42 * s * u, 0, 0, Math.PI * 2);
      g.fillStyle = BLACK;
      g.fill();
      for (const side of [-1, 1]) { // antennae
        g.beginPath();
        g.moveTo(bx, by - 0.38 * s * u);
        g.quadraticCurveTo(bx + side * 0.12 * s * u, by - 0.62 * s * u, bx + side * 0.24 * s * u, by - 0.66 * s * u);
        g.lineWidth = 0.025 * s * u;
        g.strokeStyle = BLACK;
        g.stroke();
      }
    },
    heart(cx, cy, s) { // upside down: lobes below, point up
      g.beginPath();
      for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.02) {
        const hx = 16 * Math.sin(t) ** 3;
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const [x, y] = P(cx + hx * s, cy - hy * s);
        t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.fillStyle = BLACK;
      g.fill();
    },
    texture() {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    },
  };
  return paint;
}

function paintFace(size = 2048) {
  const p = canvasPainter(size);
  // Brow: vines sweeping from the centre over each eye to the temples, then down the cheeks.
  for (const side of [-1, 1]) {
    // One bold branch per side: up from the brow flower, arching over the eye, down the edge of the
    // face and round the cheek to a rosebud.
    p.vine([side * 0.06, 0.3], [side * 0.18, 0.62], [side * 0.62, 0.62], [side * 0.74, 0.24], 7, side);
    p.vine([side * 0.74, 0.24], [side * 0.84, -0.1], [side * 0.74, -0.46], [side * 0.5, -0.62], 7, -side);
    p.flower(side * 0.49, -0.63, 0.032, 5, RED, ORANGE);
  }
  for (const side of [-1, 1]) p.scallopRing(side * 0.36, -0.06);
  p.flower(0, 0.24, 0.036, 6, RED, ORANGE); // between the eyes, above the nose
  for (const side of [-1, 1]) p.leaf(side * 0.06, 0.2, side < 0 ? Math.PI + 0.35 : -0.35, 0.08, 0.026);
  p.butterfly(0, 0.58, 0.27);
  p.heart(0, -0.44, 0.0082); // the nose: a crisp upside-down heart, below the eye rings
  // Chin: a marigold with leaves.
  for (const side of [-1, 1]) {
    p.leaf(side * 0.06, -1.02, side < 0 ? Math.PI - 0.1 : 0.1, 0.16, 0.042);
    p.leaf(side * 0.05, -1.06, side < 0 ? Math.PI + 0.45 : -0.45, 0.13, 0.036);
  }
  p.flower(0, -1.01, 0.05, 7, ORANGE, RED);
  return p.texture();
}

// Bone material with the painting projected from the front and dark cavities.
function boneMaterial(faceMap) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xfbf6ee,
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xffd6e6),
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.faceMap = { value: faceMap };
    shader.uniforms.usePaint = { value: faceMap ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aCavity;\nvarying float vCavity;\nvarying vec3 vObj;\nvarying vec3 vObjN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCavity = aCavity;\nvObj = position;\nvObjN = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D faceMap;\nuniform float usePaint;\nvarying float vCavity;\nvarying vec3 vObj;\nvarying vec3 vObjN;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (usePaint > 0.5) {
          vec4 paint = texture2D(faceMap, vObj.xy * ${FACE_SCALE.toFixed(3)} + 0.5);
          float facing = smoothstep(-0.1, 0.2, normalize(vObjN).z) * (1.0 - smoothstep(0.2, 0.5, vCavity));
          diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb, paint.a * facing);
        }
        diffuseColor.rgb *= mix(1.0, 0.05, vCavity);`
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.rgb *= mix(1.0, 0.06, vCavity);"
      );
  };
  return material;
}

// ---------- Details ----------

function surfaceZ(mesh, x, y) {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObject(mesh, false)[0];
  return hit ? hit.point.z : 0;
}

// A row of big friendly teeth that meet along the mouth line (offset > 0: upper row).
function teethRow(mesh, offset, count, spread) {
  const group = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({ color: 0xfffdf8, roughness: 0.25, clearcoat: 0.9 });
  const geometry = new THREE.CapsuleGeometry(0.042, 0.05, 6, 12);
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * 2 - 1;
    const x = t * spread;
    const y = mouthY(x) + offset * (1 - Math.abs(t) * 0.25);
    const tooth = new THREE.Mesh(geometry, material);
    tooth.scale.set(1.05 - Math.abs(t) * 0.25, 0.95 - Math.abs(t) * 0.3, 0.55);
    tooth.position.set(x, y, surfaceZ(mesh, x, y) - 0.012);
    tooth.rotation.set(-Math.sign(offset) * 0.12, t * 0.75, 0);
    group.add(tooth);
  }
  return group;
}

function marigoldCrown(skull) {
  const petalGeo = new THREE.SphereGeometry(1, 10, 6);
  petalGeo.scale(0.05, 0.012, 0.028);
  petalGeo.translate(0.045, 0, 0);
  const flowers = 13;
  const perFlower = 70;
  const mesh = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowers * perFlower);
  const leafGeo = new THREE.SphereGeometry(1, 10, 6);
  leafGeo.scale(0.06, 0.008, 0.026);
  leafGeo.translate(0.08, 0, 0);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x2f9e5b, roughness: 0.5 }), flowers * 3);
  const palettes = [[MARIGOLD, GOLD], [MARIGOLD, GOLD], ["#e0218a", "#ff6fb5"]];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const colour = new THREE.Color();
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let k = 0;
  for (let f = 0; f < flowers; f++) {
    const a = Math.PI * (0.08 + (f / (flowers - 1)) * 0.84);
    normal.set(Math.cos(a) * 0.88, 0.5 + Math.sin(a) * 0.4, 0.12 + Math.sin(a) * 0.22).normalize();
    centre.copy(normal).multiplyScalar(1.04);
    const scale = 1.5 + Math.random() * 0.4;
    const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const [main, accent] = palettes[f % 3];
    for (let l = 0; l < 3; l++) {
      e.set(0, (l / 3) * Math.PI * 2 + f, 0.08); // tucked under the petals
      q.setFromEuler(e).premultiply(up);
      m.compose(centre, q, new THREE.Vector3(scale, scale, scale));
      leaves.setMatrixAt(f * 3 + l, m);
    }
    for (let p = 0; p < perFlower; p++) {
      const layer = Math.floor(p / 18);
      e.set(0, Math.random() * Math.PI * 2, -(0.15 + layer * 0.38 + Math.random() * 0.15));
      q.setFromEuler(e).premultiply(up);
      const s = scale * (1 - layer * 0.16);
      m.compose(centre, q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(k, m);
      colour.set(layer >= 3 || Math.random() < 0.3 ? accent : main).offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.1);
      mesh.setColorAt(k, colour);
      k++;
    }
  }
  skull.add(mesh, leaves);
}

function glowTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCandles(scene) {
  const flameTex = glowTexture("rgba(255,250,220,1)", "rgba(255,140,30,0.6)");
  const wax = new THREE.MeshPhysicalMaterial({ color: 0xf3e2c0, roughness: 0.5, transmission: 0.0, sheen: 0.4 });
  const flames = [];
  const spots = [[-2.1, -2.3, 0.4], [2.1, -2.3, 0.4], [-1.35, -2.5, 1.3], [1.35, -2.5, 1.3], [0, -2.6, 1.8]];
  for (const [x, y, z] of spots) {
    const h = 0.55 + Math.random() * 0.55;
    const profile = [
      new THREE.Vector2(0, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0.145, h * 0.9),
      new THREE.Vector2(0.155, h - 0.02), new THREE.Vector2(0.13, h), new THREE.Vector2(0.06, h - 0.03),
      new THREE.Vector2(0, h - 0.02),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), wax);
    body.position.set(x, y, z);
    scene.add(body);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const len = 0.08 + Math.random() * 0.18;
      const drip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, len, 4, 8), wax);
      drip.position.set(x + Math.cos(a) * 0.15, y + h - len / 2 - 0.02, z + Math.sin(a) * 0.15);
      scene.add(drip);
    }
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    flame.position.set(x, y + h + 0.12, z);
    flame.scale.set(0.22, 0.38, 1);
    scene.add(flame);
    const light = new THREE.PointLight(0xff8a2a, 0.9, 5, 2);
    light.position.set(x, y + h + 0.15, z);
    scene.add(light);
    flames.push({ flame, light, seed: Math.random() * 10 });
  }
  return flames;
}

function buildPetals(scene, count = 220) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.translate(32, 32);
  g.rotate(0.6);
  g.beginPath();
  g.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2);
  const grad = g.createLinearGradient(-26, 0, 26, 0);
  grad.addColorStop(0, "#ffb000");
  grad.addColorStop(1, "#ff6a00");
  g.fillStyle = grad;
  g.fill();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = Math.random() * 8 - 3.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 5 - 0.5;
    speeds[i] = 0.12 + Math.random() * 0.3;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    map, size: 0.13, transparent: true, alphaTest: 0.2, depthWrite: false,
  }));
  scene.add(points);
  return { points, speeds };
}

function backdrop() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(256, 230, 20, 256, 256, 360);
  grad.addColorStop(0, "#3a1660");
  grad.addColorStop(0.55, "#170a2b");
  grad.addColorStop(1, "#08040f");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- The oracle ----------

export function createOracle(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const scene = new THREE.Scene();
  scene.background = backdrop();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.18;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  camera.position.set(0, -0.15, 7.6);

  scene.add(new THREE.HemisphereLight(0xb69bff, 0x2a0f18, 0.35));
  const key = new THREE.DirectionalLight(0xffe6c8, 0.9);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8b5cf6, 2.2);
  rim.position.set(-3, 2, -4);
  scene.add(rim);

  // Skull.
  const faceMap = paintFace();
  const skull = new THREE.Group();
  const bone = boneMaterial(faceMap);
  const { upper, lower } = splitAtMouth(sculptSkull());
  const cranium = new THREE.Mesh(upper, bone);
  skull.add(cranium);

  // Big friendly eyes: glowing iris, dark pupil, two sparkles. They blink.
  const irisMaterial = new THREE.MeshStandardMaterial({ color: 0x0a2a28, emissive: new THREE.Color(TEAL), emissiveIntensity: 2 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x06030a, roughness: 0.2 });
  const sparkleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes = [];
  for (const side of [-1, 1]) {
    const x = side * 0.36;
    const eye = new THREE.Group();
    eye.position.set(x, -0.06, surfaceZ(cranium, x, -0.06) + 0.05);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.115, 40, 28), irisMaterial);
    iris.scale.z = 0.45;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 20), pupilMaterial);
    pupil.scale.z = 0.4;
    pupil.position.z = 0.035;
    const big = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), sparkleMaterial);
    big.position.set(-0.035, 0.04, 0.06);
    const small = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), sparkleMaterial);
    small.position.set(0.04, -0.035, 0.06);
    eye.add(iris, pupil, big, small);
    skull.add(eye);
    eyes.push(eye);
  }

  // Inside of the mouth, seen when the jaw drops.
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050208 }));
  mouth.scale.set(1.0, 0.45, 0.8);
  mouth.position.set(0, -0.8, 0.32);
  skull.add(mouth);

  // The jaw hinges near the back; its geometry stays in skull space, so the pivot offsets it back.
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.72, -0.2);
  const jawPivot = new THREE.Group();
  jawPivot.position.copy(hinge.position).negate();
  const jaw = new THREE.Mesh(lower, bone);
  jawPivot.add(jaw);
  hinge.add(jawPivot);
  skull.add(hinge);
  skull.updateMatrixWorld(true);
  skull.add(teethRow(cranium, 0.062, 8, 0.3));
  jawPivot.add(teethRow(jaw, -0.062, 8, 0.28));

  marigoldCrown(skull);
  scene.add(skull);

  const flames = buildCandles(scene);
  const petals = buildPetals(scene);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.45, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const pointer = new THREE.Vector2();
  window.addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  });

  const state = { thinking: false, mood: "asleep", jaw: 0, jawTarget: 0, blinkStart: -1, nextBlink: 2 };

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    skull.position.y = 0.2 + Math.sin(t * 1.1) * 0.1;
    skull.rotation.y += (pointer.x * 0.45 - skull.rotation.y) * 0.05;
    skull.rotation.x += (pointer.y * 0.22 - skull.rotation.x) * 0.05;
    skull.rotation.z = Math.sin(t * 0.7) * 0.06; // a curious little head tilt

    // Blink every few seconds.
    if (t > state.nextBlink) {
      state.blinkStart = t;
      state.nextBlink = t + 2.5 + Math.random() * 3.5;
    }
    const phase = (t - state.blinkStart) / 0.16; // time-based, so slow frames never freeze it half shut
    const lid = phase >= 0 && phase < 1 ? 1 - Math.sin(phase * Math.PI) * 0.92 : 1;
    for (const eye of eyes) eye.scale.y = lid;

    state.jawTarget *= Math.pow(0.02, dt);
    state.jaw += (state.jawTarget - state.jaw) * Math.min(1, dt * 18);
    hinge.rotation.x = state.jaw;

    const base = state.mood === "asleep" ? 0.25 : state.mood === "speaking" ? 1.5 : 1.0;
    const glow = state.thinking ? base + 1.0 + Math.sin(t * 9) * 0.6 : base + Math.sin(t * 2) * 0.12;
    irisMaterial.emissiveIntensity = 1.1 * glow; // bright enough to bloom a little, never to flood the face

    for (const f of flames) {
      const flicker = 0.85 + Math.sin(t * 13 + f.seed) * 0.08 + Math.sin(t * 29 + f.seed * 3) * 0.05;
      f.light.intensity = 0.9 * flicker;
      f.flame.scale.set(0.22 * (2 - flicker), 0.38 * flicker, 1);
    }

    const pos = petals.points.geometry.attributes.position;
    for (let i = 0; i < petals.speeds.length; i++) {
      let y = pos.getY(i) - petals.speeds[i] * dt;
      if (y < -3.5) y = 4.5;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t + i) * 0.002);
    }
    pos.needsUpdate = true;

    composer.render();
  });

  return {
    setThinking(on) { state.thinking = on; },
    pulseJaw() { state.jawTarget = 0.16 + Math.random() * 0.2; },
    setMood(mood) { state.mood = mood; },
  };
}
