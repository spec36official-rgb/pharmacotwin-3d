/**
 * PharmacoTwin 3D — anatomy & PBPK circuit renderer (Three.js r128 + OrbitControls).
 *
 * Two views:
 *  - "anatomy": translucent body shell with smooth organ meshes tinted by toxicity risk.
 *  - "pipe_circuit": PBPK schematic; organs become nodes joined by arterial / venous tubes.
 *
 * The engine renders nothing but its own canvas inside the container. Tooltips and labels in
 * the page are the UI's job (see `options.onOrganHover`).
 *
 * Public API (also exposed as window.Body3DSimulator):
 *   setViewMode, resetCameraMacroView / resetCamera, focusOrgan / warpToOrgan,
 *   highlightOrgan, selectOrgan, updateOrganStates, triggerAdministrationAnimation,
 *   updateAlphaFoldTargetHologram, setAutoRotate, toggleAutoRotate, setLanguage, onResize.
 */

(() => {
"use strict";

const ORGAN_KEYS = ["brain", "ocular", "lungs", "heart", "liver", "gi", "kidney", "blood"];

const ORGAN_SPECS = {
  brain: { en: "Brain", ko: "뇌", anatomyPos: [0, 3.2, -0.03], pipePos: [0, 2.3, 0] },
  ocular: { en: "Eyes", ko: "안구", anatomyPos: [0, 2.98, 0.38], pipePos: [0, 1.5, 0] },
  lungs: { en: "Lungs", ko: "폐", anatomyPos: [0, 1.66, 0.0], pipePos: [0, 3.1, 0] },
  heart: { en: "Heart", ko: "심장", anatomyPos: [0.1, 1.58, 0.16], pipePos: [0, 0.7, 0] },
  liver: { en: "Liver", ko: "간", anatomyPos: [-0.2, 1.04, 0.1], pipePos: [-0.62, -0.9, 0] },
  gi: { en: "GI tract", ko: "위장관", anatomyPos: [0.08, 0.6, 0.12], pipePos: [0.62, -0.9, 0] },
  kidney: { en: "Kidneys", ko: "신장", anatomyPos: [0, 0.66, -0.2], pipePos: [0, -0.1, 0] },
  blood: { en: "Blood", ko: "혈액", anatomyPos: [0, 0.85, 0], pipePos: [0, -1.75, 0] },
};

const FLOOR_Y = -2.65;
const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

const PIPE_TRUNK_X = 1.9;
const PIPE_NODE_RADIUS = 0.3;
const RISK_SAFE = lin(0x4ade80);
const RISK_CAUTION = lin(0xf59e0b);
const RISK_DANGER = lin(0xef4444);
const ORGAN_BASE = lin(0x8a837c);
const OUTLINE_COLOR = new THREE.Color(0xf4f4f5);

/* ------------------------------------------------------------------ geometry helpers */

/** Average normals of vertices that share a position (removes UV seams on deformed meshes). */
function smoothSeams(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const acc = new Map();
  const key = (i) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const a = acc.get(k) || [0, 0, 0];
    a[0] += nrm.getX(i);
    a[1] += nrm.getY(i);
    a[2] += nrm.getZ(i);
    acc.set(k, a);
  }
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    nrm.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  nrm.needsUpdate = true;
  return geo;
}

/** Sphere whose vertices are reshaped by fn(v: Vector3) in place. */
function deformedSphere(fn, wSeg = 48, hSeg = 32) {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return smoothSeams(geo);
}

/** Tube with radius varying along the path: radiusFn(t in 0..1). */
function variableTube(curve, segments, radialSegments, radiusFn) {
  const geo = new THREE.TubeGeometry(curve, segments, 1, radialSegments, false);
  const pos = geo.attributes.position;
  const ring = radialSegments + 1;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, c);
    const r = Math.max(0.0005, radiusFn(t));
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  return smoothSeams(geo);
}

/** Tapered capsule from point a (radius ra) to point b (radius rb). */
function taperedCapsule(a, b, ra, rb, segments = 28) {
  const len = a.distanceTo(b);
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const ang = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, ra * Math.cos(ang)), ra * Math.sin(ang)));
  }
  for (let i = 0; i <= 8; i++) {
    const ang = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, rb * Math.cos(ang)), len + rb * Math.sin(ang)));
  }
  const geo = new THREE.LatheGeometry(pts, segments);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
  return smoothSeams(geo);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smoothCurve = (pts, tension = 0.5) => new THREE.CatmullRomCurve3(pts, false, "catmullrom", tension);

/**
 * Closed, smooth limb: tube through `pts` with radius interpolated along `radii`
 * and hemispherical end caps (no visible joints on the translucent shell).
 */
function limbTube(pts, radii) {
  const curve = smoothCurve(pts);
  const len = curve.getLength();
  const r0 = radii[0];
  const r1 = radii[radii.length - 1];
  return variableTube(curve, 72, 28, (t) => {
    const f = t * (radii.length - 1);
    const i = Math.min(radii.length - 2, Math.floor(f));
    const base = radii[i] + (radii[i + 1] - radii[i]) * (f - i);
    const s = t * len;
    let cap = 1;
    if (s < r0) cap = Math.sqrt(Math.max(0, 1 - Math.pow((r0 - s) / r0, 2)));
    else if (len - s < r1) cap = Math.sqrt(Math.max(0, 1 - Math.pow((r1 - (len - s)) / r1, 2)));
    return base * cap;
  });
}

/** Polyline with quadratic rounded corners (schematic pipes). */
function roundedPath(pts, radius) {
  const path = new THREE.CurvePath();
  let prev = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const inDir = new THREE.Vector3().subVectors(p, pts[i - 1]).normalize();
    const outDir = new THREE.Vector3().subVectors(pts[i + 1], p).normalize();
    const r = Math.min(radius, p.distanceTo(pts[i - 1]) / 2, p.distanceTo(pts[i + 1]) / 2);
    const a = p.clone().addScaledVector(inDir, -r);
    const b = p.clone().addScaledVector(outDir, r);
    if (prev.distanceTo(a) > 1e-4) path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    prev = b;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1].clone()));
  return path;
}

/* ------------------------------------------------------------------ shaders */

function createShellMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(0.32, 0.32, 0.35) },
      uRim: { value: new THREE.Color(0.78, 0.79, 0.82) },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCore;
      uniform vec3 uRim;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.6);
        gl_FragColor = vec4(mix(uCore, uRim, f), mix(0.025, 0.42, f));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

function createOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: OUTLINE_COLOR.clone() },
      uThickness: { value: 0.008 },
      uOpacity: { value: 0.95 },
    },
    vertexShader: `
      uniform float uThickness;
      void main() {
        vec3 p = position + normalize(normal) * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    side: THREE.BackSide,
    transparent: true,
  });
}

/* ------------------------------------------------------------------ canvas textures */

function radialTexture(stops, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function gridTexture(size = 1024, cells = 28) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 1.5;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * step) + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "destination-in";
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.55, "rgba(0,0,0,0.5)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ engine */

class PharmacoBody3D {
  constructor(containerId, onOrganClick, options = {}) {
    this.container = document.getElementById(containerId);
    this.onOrganClick = typeof onOrganClick === "function" ? onOrganClick : () => {};
    this.onOrganHover = typeof options.onOrganHover === "function" ? options.onOrganHover : () => {};
    this.lang = options.lang === "ko" ? "ko" : "en";
    this.reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    this.viewMode = "anatomy";
    this.organNodes = {};
    this.pickables = [];
    this.selectedOrgan = null;
    this.focusedOrgan = null;
    this.hoveredOrgan = null;
    this.plasmaRatio = 0;
    this.organConc = {};
    this.alphafoldStructures = {};
    this.hologramRisk = {};
    this.pipeBoluses = [];
    this.bloodParticles = [];
    this.adminAnim = null;
    this.tween = null;
    this.clock = new THREE.Clock();

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.pointerClient = { x: 0, y: 0 };
    this.pointerInside = false;
    this.pointerDirty = false;

    this._initRenderer();
    this._buildEnvironment();
    this._buildBodyShell();
    this._buildOrgans();
    this._buildPipeCircuit();
    this._buildHologram();
    this._initControls();
    this._bindPointer();

    this.resetCameraMacroView(true);
    this._loadAlphaFoldStructures();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  /* -------------------------------------------------------------- setup */

  _size() {
    const w = (this.container && this.container.clientWidth) || window.innerWidth || 800;
    const h = (this.container && this.container.clientHeight) || window.innerHeight || 600;
    return { w, h };
  }

  _initRenderer() {
    const { w, h } = this._size();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.outline = "none";

    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x18181b, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(4, 7, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, 1, 4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-3, 4, -7);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.shellGroup = new THREE.Group();
    this.organsGroup = new THREE.Group();
    this.pipeGroup = new THREE.Group();
    this.adminGroup = new THREE.Group();
    this.hologramGroup = new THREE.Group();
    this.root.add(this.shellGroup, this.organsGroup, this.pipeGroup, this.adminGroup, this.hologramGroup);
    this.scene.add(this.root);
    this.pipeGroup.visible = false;
    this.hologramGroup.visible = false;

    this._resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.onResize()) : null;
    if (this._resizeObserver) this._resizeObserver.observe(this.container);
    window.addEventListener("resize", () => this.onResize());
  }

  _buildEnvironment() {
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false, toneMapped: false })
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = FLOOR_Y;
    this.root.add(grid);

    const stage = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 64),
      new THREE.MeshBasicMaterial({
        map: radialTexture([
          [0, "rgba(255,255,255,0.07)"],
          [0.6, "rgba(255,255,255,0.025)"],
          [1, "rgba(255,255,255,0)"],
        ]),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    );
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = FLOOR_Y + 0.002;
    this.root.add(stage);

    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshBasicMaterial({
        map: radialTexture([
          [0, "rgba(0,0,0,0.75)"],
          [0.5, "rgba(0,0,0,0.3)"],
          [1, "rgba(0,0,0,0)"],
        ]),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = FLOOR_Y + 0.004;
    this.root.add(this.contactShadow);
  }

  _buildBodyShell() {
    const mat = createShellMaterial();
    const add = (geo) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      this.shellGroup.add(m);
      return m;
    };

    // Torso: lathe profile, flattened front-to-back.
    const profile = new THREE.SplineCurve([
      new THREE.Vector2(0.001, -0.66),
      new THREE.Vector2(0.42, -0.6),
      new THREE.Vector2(0.62, -0.38),
      new THREE.Vector2(0.67, -0.05),
      new THREE.Vector2(0.62, 0.3),
      new THREE.Vector2(0.58, 0.6),
      new THREE.Vector2(0.63, 0.95),
      new THREE.Vector2(0.74, 1.35),
      new THREE.Vector2(0.84, 1.75),
      new THREE.Vector2(0.9, 2.02),
      new THREE.Vector2(0.8, 2.2),
      new THREE.Vector2(0.48, 2.32),
      new THREE.Vector2(0.2, 2.38),
      new THREE.Vector2(0.001, 2.4),
    ]).getPoints(80);
    const torso = new THREE.LatheGeometry(profile, 64);
    torso.scale(1, 1, 0.56);
    add(smoothSeams(torso));

    add(limbTube([V(0, 2.18, -0.02), V(0, 2.45, -0.01), V(0, 2.72, 0.0)], [0.2, 0.18, 0.18]));
    const head = new THREE.SphereGeometry(1, 48, 36);
    head.scale(0.42, 0.52, 0.48);
    head.translate(0, 3.06, 0.0);
    add(head);

    for (const s of [-1, 1]) {
      add(
        limbTube(
          [V(s * 0.84, 2.06, 0), V(s * 1.03, 1.6, 0.0), V(s * 1.17, 1.0, 0.02), V(s * 1.25, 0.5, 0.05), V(s * 1.3, 0.04, 0.08), V(s * 1.33, -0.3, 0.09)],
          [0.16, 0.135, 0.11, 0.09, 0.068, 0.072, 0.055]
        )
      );
      add(
        limbTube(
          [V(s * 0.3, -0.28, 0), V(s * 0.36, -0.9, 0.01), V(s * 0.38, -1.5, 0.02), V(s * 0.4, -2.0, 0), V(s * 0.4, -2.5, -0.02)],
          [0.27, 0.22, 0.16, 0.13, 0.09]
        )
      );
      const foot = new THREE.SphereGeometry(1, 24, 16);
      foot.scale(0.1, 0.065, 0.2);
      foot.translate(s * 0.41, FLOOR_Y + 0.07, 0.08);
      add(foot);
    }
  }

  /* -------------------------------------------------------------- organs */

  _organGeometries(key) {
    const g = [];
    if (key === "brain") {
      const gyri = (n) =>
        1 +
        0.022 * Math.sin(n.x * 29 + n.y * 7) * Math.sin(n.y * 31 - n.z * 6) +
        0.016 * Math.sin(n.z * 37 + n.x * 11) * Math.sin(n.y * 23 + n.z * 5);
      for (const s of [-1, 1]) {
        g.push(
          deformedSphere((v) => {
            const k = gyri(v);
            let x = v.x;
            if (x * s < 0) x *= 0.22; // flat medial face along the longitudinal fissure
            let y = v.y < 0 ? v.y * 0.62 : v.y;
            const frontTaper = 1 - 0.12 * Math.max(0, v.z);
            v.set((x * 0.17 * frontTaper + s * 0.04) * k + s * 0.006, y * 0.21 * k, v.z * 0.29 * k);
          }, 72, 56)
        );
      }
      g.push(
        deformedSphere((v) => {
          const ridge = 1 + 0.03 * Math.sin(v.y * 40);
          v.set(v.x * 0.17 * ridge, v.y * 0.08 - 0.16, v.z * 0.11 - 0.2);
        })
      );
      g.push(taperedCapsule(V(0, -0.1, -0.07), V(0, -0.4, -0.1), 0.055, 0.04));
    } else if (key === "ocular") {
      for (const s of [-1, 1]) {
        const eye = new THREE.SphereGeometry(0.065, 32, 24);
        eye.translate(s * 0.15, 0, 0);
        g.push(eye);
        const nerve = smoothCurve([V(s * 0.15, 0, -0.06), V(s * 0.1, -0.01, -0.16), V(s * 0.02, -0.02, -0.24)]);
        g.push(new THREE.TubeGeometry(nerve, 16, 0.016, 10, false));
      }
      const tract = smoothCurve([V(0.02, -0.02, -0.24), V(0, -0.02, -0.26), V(-0.02, -0.02, -0.24)]);
      g.push(new THREE.TubeGeometry(tract, 6, 0.018, 10, false));
    } else if (key === "lungs") {
      for (const s of [-1, 1]) {
        g.push(
          deformedSphere((v) => {
            const top = Math.max(0, v.y);
            const taper = 1 - 0.55 * top * top;
            let x = v.x * taper;
            if (x * s < 0) x *= 0.45; // flat medial face
            const notch = s > 0 && x < 0 && v.y < 0.1 && v.z > -0.2 ? 0.75 : 1; // cardiac notch
            const y = v.y < 0 ? v.y * 0.85 + 0.06 * v.x * v.x : v.y;
            v.set(x * 0.2 * notch + s * 0.27, y * 0.4, v.z * taper * 0.2);
          }, 48, 36)
        );
      }
      const trachea = smoothCurve([V(0, 0.68, -0.02), V(0, 0.42, 0), V(0, 0.3, 0)]);
      g.push(new THREE.TubeGeometry(trachea, 12, 0.035, 12, false));
      for (const s of [-1, 1]) {
        const bronchus = smoothCurve([V(0, 0.3, 0), V(s * 0.08, 0.22, 0), V(s * 0.18, 0.12, 0)]);
        g.push(new THREE.TubeGeometry(bronchus, 12, 0.025, 10, false));
      }
    } else if (key === "heart") {
      const body = deformedSphere((v) => {
        const t = (1 - v.y) / 2; // 0 top .. 1 apex
        const taper = 1 - 0.62 * Math.pow(t, 1.6);
        v.set(v.x * 0.15 * taper, v.y * 0.19, v.z * 0.13 * taper);
        v.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
      });
      body.userData.pulse = true;
      g.push(body);
      const arch = smoothCurve([V(-0.03, 0.12, 0.02), V(-0.02, 0.27, 0.0), V(0.08, 0.32, -0.06), V(0.14, 0.22, -0.12)]);
      g.push(variableTube(arch, 24, 14, () => 0.04));
      const pulmonary = smoothCurve([V(0.04, 0.1, 0.06), V(0.07, 0.22, 0.05), V(0.14, 0.24, 0.0)]);
      g.push(variableTube(pulmonary, 16, 12, () => 0.033));
    } else if (key === "liver") {
      g.push(
        deformedSphere((v) => {
          const t = (v.x + 1) / 2; // 0 right lobe .. 1 left tip
          const thick = 1.15 - 0.85 * t;
          let y = v.y * thick;
          if (y < 0) y *= 0.5; // flat visceral (under) surface
          y -= 0.18 * t; // left lobe tapers down to a point
          v.set(v.x * 0.34, y * 0.24, v.z * (1.0 - 0.45 * t) * 0.2);
          v.applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.1);
        }, 56, 36)
      );
    } else if (key === "kidney") {
      for (const s of [-1, 1]) {
        const arc = [];
        for (let i = 0; i <= 12; i++) {
          const a = -1.25 + (i / 12) * 2.5;
          arc.push(V(s * (0.32 + 0.09 * Math.cos(a)), 0.12 * Math.sin(a), 0));
        }
        g.push(variableTube(smoothCurve(arc), 40, 20, (t) => 0.075 * Math.pow(Math.sin(Math.PI * t), 0.55)));
        const ureter = smoothCurve([V(s * 0.25, -0.02, 0.02), V(s * 0.2, -0.2, 0.05), V(s * 0.12, -0.55, 0.12)]);
        g.push(new THREE.TubeGeometry(ureter, 16, 0.014, 8, false));
      }
    } else if (key === "gi") {
      const stomach = smoothCurve([
        V(0.02, 0.5, -0.02),
        V(0.12, 0.4, 0.0),
        V(0.24, 0.28, 0.02),
        V(0.22, 0.12, 0.04),
        V(0.06, 0.08, 0.05),
        V(-0.08, 0.14, 0.04),
      ]);
      g.push(
        variableTube(stomach, 48, 22, (t) => {
          const body = Math.sin(Math.PI * Math.min(1, t * 1.1));
          return 0.028 + 0.09 * Math.pow(Math.max(0, body), 0.8) * (1 - 0.35 * t);
        })
      );
      const colon = smoothCurve([
        V(-0.36, -0.42, 0.0),
        V(-0.4, -0.1, 0.0),
        V(-0.34, 0.02, 0.02),
        V(0.0, 0.0, 0.06),
        V(0.3, 0.02, 0.02),
        V(0.36, -0.12, 0.0),
        V(0.34, -0.42, 0.0),
        V(0.14, -0.52, 0.0),
      ]);
      g.push(variableTube(colon, 80, 14, () => 0.05));
      const coil = [];
      for (let row = 0; row < 5; row++) {
        const y = -0.1 - row * 0.085;
        const dir = row % 2 === 0 ? 1 : -1;
        for (let i = 0; i <= 6; i++) {
          const x = dir * (-0.22 + (i / 6) * 0.44);
          coil.push(V(x, y + 0.02 * Math.sin(i * 1.7), 0.08 + 0.04 * Math.cos(i * 1.3 + row)));
        }
      }
      g.push(new THREE.TubeGeometry(smoothCurve(coil), 220, 0.03, 10, false));
    } else if (key === "blood") {
      Object.values(this._bloodCurves()).forEach(({ curve, radius }) => {
        g.push(new THREE.TubeGeometry(curve, 64, radius, 10, false));
      });
    }
    return g;
  }

  /** Vessel curves for the blood organ, in its local frame (origin at anatomyPos). */
  _bloodCurves() {
    if (this._bloodCurveCache) return this._bloodCurveCache;
    const aortaTop = [V(0.1, 0.95, 0.12), V(0.08, 1.17, 0.06), V(0.13, 1.2, -0.06), V(0.08, 1.0, -0.12), V(0.05, 0.4, -0.12), V(0.04, -0.4, -0.1), V(0.03, -0.92, -0.06)];
    const c = {
      aorta: { curve: smoothCurve(aortaTop), radius: 0.024 },
      cava: {
        curve: smoothCurve([V(-0.08, -0.92, -0.04), V(-0.09, -0.3, -0.06), V(-0.08, 0.4, -0.04), V(-0.06, 0.82, 0.04)]),
        radius: 0.027,
      },
    };
    for (const s of [-1, 1]) {
      const n = s < 0 ? "R" : "L";
      c[`iliacA${n}`] = {
        curve: smoothCurve([V(0.03, -0.92, -0.06), V(s * 0.2, -1.2, -0.02), V(s * 0.34, -1.55, 0.02), V(s * 0.38, -2.3, 0.04)]),
        radius: 0.014,
      };
      c[`iliacV${n}`] = {
        curve: smoothCurve([V(s * 0.42, -2.3, -0.03), V(s * 0.4, -1.55, -0.05), V(s * 0.24, -1.2, -0.06), V(-0.08, -0.92, -0.04)]),
        radius: 0.015,
      };
      c[`carotid${n}`] = {
        curve: smoothCurve([V(0.06 + s * 0.02, 1.2, -0.04), V(s * 0.08, 1.5, -0.02), V(s * 0.1, 1.95, 0.0)]),
        radius: 0.012,
      };
    }
    this._bloodCurveCache = c;
    return c;
  }

  _buildOrgans() {
    ORGAN_KEYS.forEach((key) => {
      const spec = ORGAN_SPECS[key];
      const group = new THREE.Group();
      group.position.fromArray(spec.anatomyPos);
      const material = new THREE.MeshPhysicalMaterial({
        color: ORGAN_BASE.clone(),
        roughness: 0.48,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        transparent: true,
        opacity: 1,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 1,
      });
      const meshes = [];
      const outlines = [];
      let pulseMesh = null;
      this._organGeometries(key).forEach((geo) => {
        const mesh = new THREE.Mesh(geo, material);
        mesh.userData.organKey = key;
        group.add(mesh);
        meshes.push(mesh);
        this.pickables.push(mesh);
        if (geo.userData.pulse) pulseMesh = mesh;
        const outline = new THREE.Mesh(geo, createOutlineMaterial());
        // Thin vessels/ducts get a proportionally thinner outline so they don't turn into white bars.
        const tubeR = geo.type === "TubeGeometry" ? geo.parameters.radius : Infinity;
        outline.userData.thicknessScale = Math.min(1, (tubeR * 0.3) / 0.008);
        outline.visible = false;
        outline.renderOrder = 1;
        mesh.add(outline);
        outlines.push(outline);
      });

      const box = new THREE.Box3();
      meshes.forEach((m) => {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox);
      });
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const pipeScale = THREE.MathUtils.clamp(PIPE_NODE_RADIUS / radius, 0.15, 2.2);

      const label = this._makeLabelSprite(spec[this.lang]);
      label.visible = false;
      this.organsGroup.add(group);
      this.organsGroup.add(label);

      this.organNodes[key] = {
        key,
        spec,
        group,
        material,
        meshes,
        outlines,
        pulseMesh,
        label,
        center,
        radius,
        pipeScale,
        anatomyPos: new THREE.Vector3().fromArray(spec.anatomyPos),
        pipePos: new THREE.Vector3().fromArray(spec.pipePos),
        riskPct: null,
        hoverK: 1,
        dimK: 1,
        colorTarget: ORGAN_BASE.clone(),
        emissiveTarget: new THREE.Color(0, 0, 0),
      };
    });

    this._buildBloodParticles();
  }

  _buildBloodParticles() {
    const curves = Object.values(this._bloodCurves());
    const count = 90;
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const lengths = curves.map((c) => c.curve.getLength());
    const total = lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      let pick = Math.random() * total;
      let ci = 0;
      while (ci < curves.length - 1 && pick > lengths[ci]) pick -= lengths[ci++];
      this.bloodParticles.push({ c: curves[ci], len: lengths[ci], u: Math.random(), jitter: 0.6 + Math.random() * 0.8 });
    }
    const mat = new THREE.PointsMaterial({
      color: lin(0xe25c5c),
      size: 0.045,
      map: radialTexture([
        [0, "rgba(255,255,255,1)"],
        [0.45, "rgba(255,255,255,0.9)"],
        [1, "rgba(255,255,255,0)"],
      ], 64),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.bloodPoints = new THREE.Points(geo, mat);
    this.bloodPoints.frustumCulled = false;
    this.organNodes.blood.group.add(this.bloodPoints);
  }

  _makeLabelSprite(text) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = "500 40px Inter, Pretendard, system-ui, sans-serif";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.width = w;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = "#d4d4d8";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    const h = 0.17;
    sprite.scale.set((h * w) / 64, h, 1);
    sprite.renderOrder = 10;
    sprite.center.set(0, 0.5);
    return sprite;
  }

  _disposeSprite(sprite) {
    if (!sprite) return;
    if (sprite.parent) sprite.parent.remove(sprite);
    if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.dispose();
  }

  /* -------------------------------------------------------------- PBPK circuit */

  /**
   * Classic PBPK schematic: venous trunk (left) -> lungs (top) -> arterial trunk (right) -> blood pool
   * (bottom); each tissue sits on its own row between the trunks. GI drains into the liver via the portal vein.
   */
  _buildPipeCircuit() {
    const arterial = new THREE.MeshStandardMaterial({ color: lin(0x8f8079), roughness: 0.5, metalness: 0 });
    const venous = new THREE.MeshStandardMaterial({ color: lin(0x6f7682), roughness: 0.5, metalness: 0 });
    const bolusArt = new THREE.MeshBasicMaterial({ color: lin(0xf4f4f5), transparent: true, opacity: 0.6, toneMapped: false });
    const bolusVen = new THREE.MeshBasicMaterial({ color: lin(0xb4b8c0), transparent: true, opacity: 0.6, toneMapped: false });
    this.bolusMaterials = [bolusArt, bolusVen];
    const bolusGeo = new THREE.SphereGeometry(0.032, 14, 10);

    const P = (k) => new THREE.Vector3().fromArray(ORGAN_SPECS[k].pipePos);
    const X = PIPE_TRUNK_X;
    const pipe = (pts, kind, radius = 0.02) => {
      const curve = roundedPath(pts, 0.3);
      const len = curve.getLength();
      const segs = Math.max(16, Math.round(len * 40));
      this.pipeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 10, false), kind === "a" ? arterial : venous));
      const n = Math.max(1, Math.round(len / 0.9));
      for (let i = 0; i < n; i++) {
        const bm = new THREE.Mesh(bolusGeo, kind === "a" ? bolusArt : bolusVen);
        this.pipeGroup.add(bm);
        this.pipeBoluses.push({ mesh: bm, curve, len, u: i / n, speed: 0.22 });
      }
    };

    const lungs = P("lungs");
    const blood = P("blood");
    pipe([lungs, V(X, lungs.y, 0), V(X, blood.y, 0), blood], "a", 0.028);
    pipe([blood, V(-X, blood.y, 0), V(-X, lungs.y, 0), lungs], "v", 0.028);

    ["brain", "ocular", "heart", "kidney"].forEach((k) => {
      const p = P(k);
      pipe([V(X, p.y, 0), p], "a");
      pipe([p, V(-X, p.y, 0)], "v");
    });

    const gi = P("gi");
    const liver = P("liver");
    pipe([V(X, gi.y, 0), gi], "a");
    pipe([gi, liver], "v"); // portal vein
    pipe([liver, V(-X, liver.y, 0)], "v"); // hepatic vein
    const lift = PIPE_NODE_RADIUS + 0.1;
    pipe([V(X, liver.y + lift, 0), V(liver.x, liver.y + lift, 0), liver], "a", 0.016); // hepatic artery
  }

  /* -------------------------------------------------------------- AlphaFold hologram */

  _buildHologram() {
    this.backboneGroup = new THREE.Group();
    this.hologramGroup.add(this.backboneGroup);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.506, 128),
      new THREE.MeshBasicMaterial({ color: lin(0x52525b), transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.4;
    this.hologramGroup.add(ring);
    this.hologramOrgan = null;
  }

  async _loadAlphaFoldStructures() {
    try {
      const res = await fetch("/static/assets/alphafold_pdb/alphafold_structures.json");
      if (!res.ok) return;
      this.alphafoldStructures = await res.json();
      if (this.focusedOrgan) {
        this._rebuildRealAlphaFoldBackbone(this.focusedOrgan);
        this.hologramGroup.visible = !!this.hologramOrgan;
      }
    } catch (e) {
      // Network unavailable: hologram simply stays hidden.
    }
  }

  /** Official AlphaFold pLDDT confidence bands -> linear RGB. */
  _plddtColor(plddt) {
    if (plddt >= 90) return lin(0x0053d6);
    if (plddt >= 70) return lin(0x65cbf3);
    if (plddt >= 50) return lin(0xffdb13);
    return lin(0xff7d45);
  }

  _clearBackbone() {
    while (this.backboneGroup.children.length) {
      const c = this.backboneGroup.children[0];
      this.backboneGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    this._disposeSprite(this.hologramLabel);
    this.hologramLabel = null;
    this.hologramOrgan = null;
  }

  /** Builds the real AlphaFold DB C-alpha trace (coloured by per-residue pLDDT) for an organ target. */
  _rebuildRealAlphaFoldBackbone(organKey) {
    const af = this.alphafoldStructures && this.alphafoldStructures[organKey];
    if (!af || !af.backbone_ca || af.backbone_ca.length < 10) {
      this._clearBackbone();
      return false;
    }
    if (this.hologramOrgan === organKey) {
      this._refreshHologramLabel();
      return true;
    }
    this._clearBackbone();

    const ca = af.backbone_ca; // [[x, y, z, plddt], ...] normalised to ~±0.45
    const pts = ca.map(([x, y, z]) => new THREE.Vector3(x * 0.96, y * 0.96, z * 0.96));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const segs = Math.min(1200, ca.length * 3);
    const radial = 6;
    const geo = new THREE.TubeGeometry(curve, segs, 0.0085, radial, false);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const ring = radial + 1;
    for (let i = 0; i <= segs; i++) {
      const idx = Math.min(ca.length - 1, Math.round((i / segs) * (ca.length - 1)));
      const c = this._plddtColor(ca[idx][3]);
      for (let j = 0; j < ring; j++) {
        const v = (i * ring + j) * 3;
        colors[v] = c.r;
        colors[v + 1] = c.g;
        colors[v + 2] = c.b;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 }));
    this.backboneGroup.add(mesh);
    this.hologramOrgan = organKey;
    this._refreshHologramLabel();
    return true;
  }

  _refreshHologramLabel() {
    const organKey = this.hologramOrgan;
    const af = organKey && this.alphafoldStructures[organKey];
    if (!af) return;
    this._disposeSprite(this.hologramLabel);
    const risk = this.hologramRisk[organKey];
    const lines = [
      { text: `${af.gene} · ${af.entry_id}`, font: "600 34px Inter, Pretendard, system-ui, sans-serif", color: "#ededed" },
      {
        text: `${af.residue_count} aa · pLDDT ${Number(af.mean_plddt).toFixed(1)}${
          Number.isFinite(risk) ? ` · risk ${Math.round(risk)}%` : ""
        }`,
        font: "400 26px 'JetBrains Mono', ui-monospace, monospace",
        color: "#a1a1aa",
      },
    ];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let w = 0;
    lines.forEach((l) => {
      ctx.font = l.font;
      w = Math.max(w, ctx.measureText(l.text).width);
    });
    canvas.width = Math.ceil(w) + 48;
    canvas.height = 96;
    lines.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(l.text, canvas.width / 2, i === 0 ? 30 : 72);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    const h = 0.17;
    sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
    sprite.position.set(0, 0.52, 0);
    sprite.renderOrder = 11;
    this.hologramLabel = sprite;
    this.hologramGroup.add(sprite);
  }

  /**
   * Show the AlphaFold structure for an organ target next to the focused organ.
   * Accepts (organKey, label, riskPct). The label shown is the AlphaFold DB entry actually rendered.
   */
  updateAlphaFoldTargetHologram(organKey, label, riskPct) {
    if (typeof organKey !== "string" || !this.organNodes[organKey]) return;
    if (Number.isFinite(riskPct)) this.hologramRisk[organKey] = riskPct;
    if (this.focusedOrgan !== organKey) return;
    if (this._rebuildRealAlphaFoldBackbone(organKey)) {
      this._refreshHologramLabel();
      this.hologramGroup.visible = true;
    }
  }

  /* -------------------------------------------------------------- controls & camera */

  _initControls() {
    const controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.6;
    controls.maxDistance = 30;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.9;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("start", () => {
      this.tween = null;
    });
    this.controls = controls;
  }

  _fitView() {
    const isPipe = this.viewMode === "pipe_circuit";
    const center = isPipe ? V(0, 0.68, 0) : V(0, 0.45, 0);
    const halfH = isPipe ? 2.75 : 3.3;
    const halfW = isPipe ? 2.6 : 1.7;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(halfH / tanV, halfW / (tanV * this.camera.aspect)) * 1.08;
    const dir = isPipe ? V(0, 0.05, 1).normalize() : V(0.16, 0.1, 1).normalize();
    this.controls.maxDistance = Math.max(30, dist * 1.8);
    return { pos: center.clone().addScaledVector(dir, dist), target: center };
  }

  _flyTo(pos, target, immediate = false) {
    if (immediate || this.reducedMotion) {
      this.tween = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos.clone(),
      toTarget: target.clone(),
      t0: performance.now(),
      dur: 700,
    };
  }

  _stepTween(now) {
    const tw = this.tween;
    if (!tw) return;
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    const e = EASE_OUT(k);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (k >= 1) this.tween = null;
  }

  _organTargetCenter(node) {
    const isPipe = this.viewMode === "pipe_circuit";
    const s = isPipe ? node.pipeScale : 1;
    return (isPipe ? node.pipePos : node.anatomyPos).clone().addScaledVector(node.center, s);
  }

  resetCameraMacroView(immediate = false) {
    this.focusedOrgan = null;
    this.hologramGroup.visible = false;
    const { pos, target } = this._fitView();
    this._flyTo(pos, target, immediate === true);
  }

  resetCamera() {
    this.resetCameraMacroView();
  }

  /** Smooth fly-to an organ; the user keeps full orbit/pan/zoom control afterwards. */
  focusOrgan(organKey) {
    const node = this.organNodes[organKey];
    if (!node) return;
    this.highlightOrgan(organKey);
    this.focusedOrgan = organKey;

    const isPipe = this.viewMode === "pipe_circuit";
    const R = node.radius * (isPipe ? node.pipeScale : 1);
    const P = this._organTargetCenter(node);

    const dir = isPipe
      ? new THREE.Vector3(0, 0.08, 1)
      : new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    dir.y = THREE.MathUtils.clamp(dir.y, -0.3, 0.55);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();

    const hasStructure = this._rebuildRealAlphaFoldBackbone(organKey);
    const holoOffset = Math.min(R, 0.9) + 0.6;
    this.hologramGroup.position.copy(P).addScaledVector(right, holoOffset).addScaledVector(dir, isPipe ? 0.5 : 0);
    this.hologramGroup.visible = hasStructure;

    const target = P.clone().addScaledVector(right, hasStructure ? holoOffset * 0.5 : 0);
    const span = hasStructure ? Math.min(R, 0.9) + 0.6 + holoOffset * 0.5 : R;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = span / (tanV * Math.min(1, this.camera.aspect));
    const dist = THREE.MathUtils.clamp(fit * 1.15, 1.2, 7);
    this._flyTo(target.clone().addScaledVector(dir, dist), target);
  }

  /** Legacy alias; extra arguments are ignored. */
  warpToOrgan(organKey) {
    this.focusOrgan(organKey);
  }

  highlightOrgan(organKey) {
    this.selectedOrgan = organKey && this.organNodes[organKey] ? organKey : null;
    Object.values(this.organNodes).forEach((n) => {
      const on = n.key === this.selectedOrgan;
      n.outlines.forEach((o) => (o.visible = on));
    });
  }

  selectOrgan(organKey, shouldFocus = false) {
    if (shouldFocus) this.focusOrgan(organKey);
    else this.highlightOrgan(organKey);
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = !!enabled && !this.reducedMotion;
    return this.controls.autoRotate;
  }

  toggleAutoRotate() {
    return this.setAutoRotate(!this.controls.autoRotate);
  }

  setLanguage(lang) {
    this.lang = lang === "ko" ? "ko" : "en";
    Object.values(this.organNodes).forEach((n) => {
      const visible = n.label.visible;
      const pos = n.label.position.clone();
      this._disposeSprite(n.label);
      n.label = this._makeLabelSprite(n.spec[this.lang]);
      n.label.visible = visible;
      n.label.position.copy(pos);
      this.organsGroup.add(n.label);
    });
  }

  setViewMode(mode) {
    this.viewMode = mode === "pipe_circuit" ? "pipe_circuit" : "anatomy";
    const isPipe = this.viewMode === "pipe_circuit";
    this.shellGroup.visible = !isPipe;
    this.contactShadow.visible = !isPipe;
    this.pipeGroup.visible = isPipe;
    Object.values(this.organNodes).forEach((n) => (n.label.visible = isPipe));
    if (this.focusedOrgan) this.focusOrgan(this.focusedOrgan);
    else this.resetCameraMacroView();
  }

  onResize() {
    if (!this.container || !this.renderer) return;
    const { w, h } = this._size();
    if (w === this._lastW && h === this._lastH) return;
    this._lastW = w;
    this._lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* -------------------------------------------------------------- simulation state */

  _riskColor(risk, out) {
    if (risk <= 35) return out.copy(RISK_SAFE).lerp(RISK_CAUTION, Math.max(0, risk) / 35);
    return out.copy(RISK_CAUTION).lerp(RISK_DANGER, Math.min(1, (risk - 35) / 35));
  }

  /** riskPctMap {organ: 0..100}, concMap {organ: mg/L}, plasmaRatio 0..1 (plasma / Cmax). */
  updateOrganStates(riskPctMap, concMap, plasmaRatio) {
    const tmp = new THREE.Color();
    Object.values(this.organNodes).forEach((n) => {
      const r = riskPctMap && Number(riskPctMap[n.key]);
      n.riskPct = Number.isFinite(r) ? THREE.MathUtils.clamp(r, 0, 100) : null;
      if (n.riskPct === null) {
        n.colorTarget.copy(ORGAN_BASE);
        n.emissiveTarget.setRGB(0, 0, 0);
        return;
      }
      this._riskColor(n.riskPct, tmp);
      // Low risk stays mostly neutral grey; tint and glow strengthen toward the danger end.
      n.colorTarget.copy(ORGAN_BASE).lerp(tmp, 0.15 + 0.75 * Math.min(1, n.riskPct / 70));
      n.emissiveTarget.copy(tmp).multiplyScalar(0.02 + 0.42 * (n.riskPct / 100));
    });
    this.organConc = concMap || {};
    const p = Number(plasmaRatio);
    this.plasmaRatio = Number.isFinite(p) ? THREE.MathUtils.clamp(p, 0, 1) : 0;
  }

  /** Dose entry animation: 'oral' (capsule to stomach), 'iv' (arm vein to heart), 'sc' (abdominal skin to blood). */
  triggerAdministrationAnimation(route = "oral") {
    this._clearAdmin();
    const isPipe = this.viewMode === "pipe_circuit";
    const r = route === "iv" || route === "sc" ? route : "oral";
    let pts;
    if (isPipe) {
      const dest = this._organTargetCenter(this.organNodes[r === "oral" ? "gi" : r === "iv" ? "heart" : "blood"]);
      const start = dest.clone().add(r === "oral" ? V(-1.3, 0.4, 0.6) : r === "iv" ? V(0, 1.0, 0.8) : V(1.2, 0.3, 0.6));
      pts = [start, start.clone().lerp(dest, 0.5).add(V(0, 0.15, 0.2)), dest];
    } else if (r === "oral") {
      const gi = this.organNodes.gi.anatomyPos;
      pts = [V(0, 2.82, 0.44), V(0, 2.55, 0.12), V(0.02, 2.2, -0.02), V(0.04, 1.7, -0.04), V(0.1, 1.3, 0.0), gi.clone().add(V(0.14, 0.3, 0.02))];
    } else if (r === "iv") {
      const heart = this.organNodes.heart.anatomyPos;
      pts = [V(-1.24, 0.9, 0.16), V(-1.1, 1.6, 0.06), V(-0.82, 2.02, 0.02), V(-0.35, 2.05, 0.0), heart.clone()];
    } else {
      pts = [V(0.32, 0.38, 0.62), V(0.24, 0.4, 0.4), V(0.12, 0.45, 0.12), V(0.05, 0.6, -0.1)];
    }
    const curve = smoothCurve(pts);

    const mat = new THREE.MeshStandardMaterial({ color: lin(0xf4f4f5), roughness: 0.3, metalness: 0, transparent: true });
    let geo;
    if (r === "oral") {
      geo = taperedCapsule(V(0, -0.06, 0), V(0, 0.06, 0), 0.04, 0.04, 20);
    } else {
      geo = new THREE.SphereGeometry(0.045, 20, 14);
    }
    const mesh = new THREE.Mesh(geo, mat);
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.058, 64),
      new THREE.MeshBasicMaterial({ color: lin(0xf4f4f5), transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
    );
    ripple.position.copy(curve.getPointAt(1));
    this.adminGroup.add(mesh, ripple);
    this.adminAnim = { mesh, ripple, curve, t: 0, dur: this.reducedMotion ? 0.01 : 1.7 };
  }

  _clearAdmin() {
    while (this.adminGroup.children.length) {
      const c = this.adminGroup.children[0];
      this.adminGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    this.adminAnim = null;
  }

  /* -------------------------------------------------------------- pointer */

  _bindPointer() {
    const dom = this.renderer.domElement;
    let down = null;
    const toNdc = (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.pointerClient = { x: e.clientX, y: e.clientY };
    };

    dom.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    window.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const wasLeft = down.button === 0;
      down = null;
      if (!wasLeft || moved >= 5 || e.target !== dom) return;
      toNdc(e);
      const key = this._pick();
      if (key) {
        this.focusOrgan(key);
        this.onOrganClick(key);
      }
    });
    dom.addEventListener("dblclick", (e) => {
      toNdc(e);
      if (!this._pick()) this.resetCameraMacroView();
    });
    dom.addEventListener("pointermove", (e) => {
      toNdc(e);
      this.pointerInside = true;
      this.pointerDirty = !down || e.buttons === 0;
    });
    dom.addEventListener("pointerleave", () => {
      this.pointerInside = false;
      this._setHover(null);
    });
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? hit.object.userData.organKey : null;
  }

  _setHover(key) {
    const changed = key !== this.hoveredOrgan;
    this.hoveredOrgan = key;
    this.renderer.domElement.style.cursor = key ? "pointer" : "";
    if (changed || key) this.onOrganHover(key, { x: this.pointerClient.x, y: this.pointerClient.y });
  }

  /* -------------------------------------------------------------- frame loop */

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const now = performance.now();

    this._stepTween(now);
    this.controls.update();

    if (this.pointerDirty && this.pointerInside) {
      this.pointerDirty = false;
      this._setHover(this._pick());
    }

    const isPipe = this.viewMode === "pipe_circuit";
    const kPos = 1 - Math.exp(-dt * 7);
    const kCol = 1 - Math.exp(-dt * 6);
    const anySelected = !!this.selectedOrgan;
    const motion = this.reducedMotion ? 0 : 1;

    Object.values(this.organNodes).forEach((n) => {
      const targetPos = isPipe ? n.pipePos : n.anatomyPos;
      n.group.position.lerp(targetPos, kPos);
      n.hoverK += ((this.hoveredOrgan === n.key ? 1.05 : 1) - n.hoverK) * (1 - Math.exp(-dt * 14));
      const base = isPipe ? n.pipeScale : 1;
      const s = n.group.scale.x + (base - n.group.scale.x) * kPos;
      n.group.scale.setScalar(s);
      n.meshes.forEach((m) => m.scale.setScalar(n.hoverK));
      if (n.pulseMesh && motion) {
        const beat = Math.pow(Math.max(0, Math.sin(t * 7.2)), 6);
        n.pulseMesh.scale.setScalar(n.hoverK * (1 + 0.035 * beat));
      }
      if (n.key === "lungs" && motion) {
        const breath = 1 + 0.018 * Math.sin(t * 1.4);
        n.meshes.forEach((m) => m.scale.set(n.hoverK * breath, n.hoverK * breath, n.hoverK * breath));
      }

      const dimmed = anySelected && this.selectedOrgan !== n.key;
      n.dimK += ((dimmed ? 0.6 : 1) - n.dimK) * kCol;
      n.material.opacity += ((dimmed ? 0.35 : 1) - n.material.opacity) * kCol;
      n.material.depthWrite = !dimmed || n.material.opacity > 0.98;
      const col = n.material.color;
      col.r += (n.colorTarget.r * n.dimK - col.r) * kCol;
      col.g += (n.colorTarget.g * n.dimK - col.g) * kCol;
      col.b += (n.colorTarget.b * n.dimK - col.b) * kCol;
      const em = n.material.emissive;
      em.r += (n.emissiveTarget.r * n.dimK - em.r) * kCol;
      em.g += (n.emissiveTarget.g * n.dimK - em.g) * kCol;
      em.b += (n.emissiveTarget.b * n.dimK - em.b) * kCol;

      if (isPipe) n.label.position.copy(n.group.position).add(V(PIPE_NODE_RADIUS + 0.08, 0.14, 0));
    });
    if (this.selectedOrgan) {
      const sel = this.organNodes[this.selectedOrgan];
      const base = 0.008 / Math.max(0.15, sel.group.scale.x);
      sel.outlines.forEach((o) => (o.material.uniforms.uThickness.value = base * o.userData.thicknessScale));
    }

    // Blood particles: speed and opacity follow plasma concentration.
    if (this.bloodPoints.visible) {
      const pr = this.plasmaRatio;
      this.bloodPoints.material.opacity = (0.18 + 0.6 * pr) * this.organNodes.blood.material.opacity;
      const attr = this.bloodPoints.geometry.attributes.position;
      const p = new THREE.Vector3();
      const speed = (0.08 + 0.3 * pr) * motion;
      this.bloodParticles.forEach((bp, i) => {
        bp.u = (bp.u + (dt * speed * bp.jitter) / Math.max(0.3, bp.len)) % 1;
        bp.c.curve.getPointAt(bp.u, p);
        attr.setXYZ(i, p.x, p.y, p.z);
      });
      attr.needsUpdate = true;
    }

    if (isPipe) {
      const pr = this.plasmaRatio;
      this.bolusMaterials.forEach((m) => (m.opacity = 0.3 + 0.65 * pr));
      const sp = (0.4 + 1.2 * pr) * motion;
      this.pipeBoluses.forEach((b) => {
        b.u = (b.u + (dt * b.speed * sp) / b.len) % 1;
        b.curve.getPointAt(b.u, b.mesh.position);
      });
    }

    if (this.hologramGroup.visible && motion) this.backboneGroup.rotation.y += dt * 0.35;

    if (this.adminAnim) {
      const a = this.adminAnim;
      a.t += dt / a.dur;
      const k = Math.min(1, a.t);
      a.curve.getPointAt(EASE_OUT(Math.min(1, k * 1.15)), a.mesh.position);
      a.mesh.material.opacity = k < 0.85 ? 1 : Math.max(0, 1 - (k - 0.85) / 0.15);
      const rk = Math.max(0, (k - 0.8) / 0.2);
      a.ripple.scale.setScalar(1 + rk * 3);
      a.ripple.material.opacity = rk > 0 ? 0.7 * (1 - rk) : 0;
      a.ripple.lookAt(this.camera.position);
      if (a.t >= 1.2) this._clearAdmin();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.PharmacoBody3D = PharmacoBody3D;
window.Body3DSimulator = PharmacoBody3D;
})();
