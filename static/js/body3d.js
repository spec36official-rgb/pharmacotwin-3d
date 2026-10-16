/**
 * PharmacoTwin 3D — Cosmic Dot-Matrix Hologram & PBPK Vascular Pipe Engine (Three.js r128)
 *
 * Features:
 * 1. High-definition 3D Dot-Matrix / Point-Cloud Anatomical Organs (Brain, Heart, Lungs, Liver,
 *    Kidneys, GI Tract, Blood/Vasculature, Ocular) with unmistakable anatomical silhouettes
 *    and floating 3D holographic callout tags. No human face photo used.
 * 2. Two Interactive 3D Modes:
 *    - "anatomy": Translucent 3D dot-matrix human silhouette + anatomical organ placement.
 *    - "pipe_circuit": Spacious 3D PBPK Vascular Pipe Network where glowing arterial, venous,
 *      and portal vein pipes connect magnified holographic organs with flowing plasma boluses.
 * 3. Cosmic Space-Flight Camera Warp (Zoom-In to Organ -> 3D AlphaFold Target Protein Hologram
 *    materializes right next to the organ in 3D space!).
 */

class PharmacoBody3D {
  constructor(containerId, onOrganClick) {
    this.container = document.getElementById(containerId);
    this.onOrganClick = onOrganClick || (() => {});
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.viewMode = "anatomy"; // "anatomy" | "pipe_circuit"
    this.rootGroup = new THREE.Group();
    this.bodyShellGroup = new THREE.Group();
    this.pipeNetworkGroup = new THREE.Group();
    this.organsGroup = new THREE.Group();
    this.adminAnimGroup = new THREE.Group();
    this.proteinHologramGroup = new THREE.Group();

    this.organNodes = {}; // organKey -> { group, dotCloud, coreGlow, ringMesh, anatomyPos, pipePos, riskPct, hitMesh }
    this.pipeBoluses = []; // { mesh, curve, progress, speed }
    this.vascularParticles = null;
    this.vascularParticleMeta = [];
    this.starfield = null;

    this.selectedOrgan = null;
    this.isZoomedIn = false;
    this.autoRotate = true;
    this.shellVisible = true;
    this.clock = new THREE.Clock();

    // Smooth Camera Flight State (Cosmic Warp)
    this.camPosNow = new THREE.Vector3(0, 1.0, 9.2);
    this.camPosTarget = new THREE.Vector3(0, 1.0, 9.2);
    this.camLookNow = new THREE.Vector3(0, 0.9, 0);
    this.camLookTarget = new THREE.Vector3(0, 0.9, 0);
    this.orbitAngle = 0;
    this.userPitch = 0.05;

    this.activeAdminAnim = null;
    this.currentProteinSpec = null;

    this._initScene();
    this._createCosmicLabEnvironment();
    this._buildDotMatrixHumanShell();
    this._buildHolographicDotOrgans();
    this._buildPBPKPipeCircuit();
    this._buildCirculatingParticles();
    this._build3DAlphaFoldProteinConstruct();
    this._bindInteractions();
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x03040b, 0.032);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.copy(this.camPosNow);
    this.camera.lookAt(this.camLookNow);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    // Futuristic Laboratory Lighting
    const ambient = new THREE.AmbientLight(0x818cf8, 0.75);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x22d3ee, 1.4);
    keyLight.position.set(6, 10, 8);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa855f7, 1.1);
    rimLight.position.set(-7, 4, -6);
    this.scene.add(rimLight);

    this.scene.add(this.rootGroup);
    this.rootGroup.add(this.bodyShellGroup);
    this.rootGroup.add(this.pipeNetworkGroup);
    this.rootGroup.add(this.organsGroup);
    this.rootGroup.add(this.adminAnimGroup);
    this.rootGroup.add(this.proteinHologramGroup);

    this.pipeNetworkGroup.visible = false;
    this.proteinHologramGroup.visible = false;
  }

  /**
   * Create glowing circular soft dot texture for crisp 3D point clouds
   */
  _createDotTexture() {
    if (this._dotTex) return this._dotTex;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    this._dotTex = new THREE.CanvasTexture(canvas);
    return this._dotTex;
  }

  /**
   * Create floating 3D hologram text sprite for clear organ & target identification
   */
  _createHoloLabelSprite(titleEn, titleKo, subText, accentHex = "#22d3ee") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 140;
    const ctx = canvas.getContext("2d");

    // Dark glass pill with glowing border
    ctx.fillStyle = "rgba(6, 10, 24, 0.82)";
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 124, 18);
    ctx.fill();
    ctx.stroke();

    ctx.font = "800 30px Oxanium, Pretendard, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${titleEn} · ${titleKo}`, 28, 54);

    ctx.font = "600 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = accentHex;
    ctx.fillText(subText, 28, 102);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      opacity: 0.92,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.45, 0.4, 1);
    return sprite;
  }

  _createCosmicLabEnvironment() {
    // 1. Floating 3D Starfield / Lab Quantum Dust (like sample_UI.html)
    const starCount = 1400;
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(starCount * 3);
    const cols = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 8 + Math.random() * 28;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const palette = [
        [0.13, 0.83, 0.93],
        [0.51, 0.55, 0.97],
        [0.66, 0.33, 0.97],
      ][i % 3];
      cols[i * 3] = palette[0];
      cols[i * 3 + 1] = palette[1];
      cols[i * 3 + 2] = palette[2];
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.08,
      map: this._createDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.starfield = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starfield);

    // 2. Futuristic Holographic Floor Rings
    const floorY = -2.65;
    const r1 = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.15, 96),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    );
    r1.rotation.x = -Math.PI / 2;
    r1.position.y = floorY;
    this.rootGroup.add(r1);

    const r2 = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.24, 96),
      new THREE.MeshBasicMaterial({ color: 0x818cf8, side: THREE.DoubleSide, transparent: true, opacity: 0.28 })
    );
    r2.rotation.x = -Math.PI / 2;
    r2.position.y = floorY;
    this.rootGroup.add(r2);

    const grid = new THREE.GridHelper(14, 28, 0x22d3ee, 0x1e293b);
    grid.position.y = floorY - 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.16;
    this.rootGroup.add(grid);
  }

  /**
   * Build 3D Dot-Matrix Cybernetic Human Silhouette (NO face photo!)
   */
  _buildDotMatrixHumanShell() {
    const pts = [];
    // Helper to sample surface points on cylinder/ellipsoid segments
    const addCylinderDots = (x0, y0, z0, rTop, rBot, height, rings, perRing, zScale = 0.65) => {
      for (let i = 0; i <= rings; i++) {
        const v = i / rings;
        const y = y0 + (v - 0.5) * height;
        const r = rBot + (rTop - rBot) * v;
        for (let j = 0; j < perRing; j++) {
          const a = (j / perRing) * Math.PI * 2;
          pts.push(x0 + Math.cos(a) * r, y, z0 + Math.sin(a) * r * zScale);
        }
      }
    };

    // Cranium / Head (pure dot-matrix silhouette, no photo)
    for (let i = 0; i < 360; i++) {
      const u = (i + 0.5) / 360;
      const y = 1 - 2 * u;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * 2.399963;
      pts.push(Math.cos(th) * rad * 0.44, 3.05 + y * 0.52, Math.sin(th) * rad * 0.48);
    }

    // Neck
    addCylinderDots(0, 2.38, 0, 0.21, 0.24, 0.34, 6, 22, 0.85);

    // Thorax & Ribcage Contour Rings
    addCylinderDots(0, 1.45, 0, 0.88, 0.72, 1.55, 22, 46, 0.58);

    // Abdomen & Pelvis
    addCylinderDots(0, 0.15, 0, 0.72, 0.66, 1.05, 14, 38, 0.58);

    // Left & Right Arms
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const cx = side * (0.98 + t * 0.34);
        const cy = 2.05 - t * 1.95;
        const r = 0.17 * (1 - t * 0.25);
        for (let j = 0; j < 14; j++) {
          const a = (j / 14) * Math.PI * 2;
          pts.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r);
        }
      }
    }

    // Left & Right Legs
    for (const side of [-1, 1]) {
      addCylinderDots(side * 0.38, -1.45, 0, 0.27, 0.17, 2.2, 22, 20, 0.88);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.042,
      map: this._createDotTexture(),
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bodyDots = new THREE.Points(geo, mat);
    this.bodyShellGroup.add(bodyDots);
  }

  /**
   * Generate unmistakable 3D Dot-Matrix Point Clouds for each of the 8 Organs
   */
  _generateOrganPointCloud(organKey) {
    const pts = [];
    const n = 1500;

    if (organKey === "brain") {
      // Bilateral cerebral hemispheres with gyri ripples + longitudinal fissure
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const u = Math.random();
        const v = Math.random();
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const r = 0.82 + 0.18 * Math.random() + 0.05 * Math.sin(theta * 6) * Math.cos(phi * 5);
        let x = Math.abs(Math.sin(phi) * Math.cos(theta)) * r * 0.34 + 0.04;
        let y = Math.cos(phi) * r * 0.28;
        let z = Math.sin(phi) * Math.sin(theta) * r * 0.38;
        if (y < -0.08) y *= 0.55; // flatter base
        pts.push(side * x, y, z);
      }
    } else if (organKey === "heart") {
      // Conical 4-chamber heart tilted toward left apex + superior aortic arch
      for (let i = 0; i < n; i++) {
        if (i < n * 0.82) {
          const t = Math.random();
          const a = Math.random() * Math.PI * 2;
          // Heart parametric profile tapering to apex at bottom-left
          const y = (t - 0.5) * 0.52;
          const radius = 0.24 * Math.sin(t * Math.PI) * (1 + 0.25 * Math.cos(a * 2));
          const x = Math.cos(a) * radius + (0.5 - t) * 0.1;
          const z = Math.sin(a) * radius * 0.85;
          pts.push(x, y, z);
        } else {
          // Aortic arch crown on top
          const s = (i - n * 0.82) / (n * 0.18);
          const archAngle = s * Math.PI;
          const a = Math.random() * Math.PI * 2;
          const tubeR = 0.055;
          const cx = Math.cos(archAngle) * 0.12;
          const cy = 0.22 + Math.sin(archAngle) * 0.15;
          pts.push(cx + Math.cos(a) * tubeR, cy + Math.sin(a) * tubeR, (Math.random() - 0.5) * 0.08);
        }
      }
    } else if (organKey === "lungs") {
      // Bilateral Left & Right Lung Lobes (wider base, tapered apex, hollow mediastinum)
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const h = Math.random(); // 0 = base, 1 = apex
        const y = (h - 0.5) * 0.82;
        const rScale = Math.sin(Math.pow(1 - h * 0.72, 0.8) * Math.PI * 0.85);
        const a = Math.random() * Math.PI * 2;
        const rad = (0.65 + 0.35 * Math.random()) * rScale;
        const x = side * (0.24 + Math.abs(Math.cos(a)) * 0.28 * rad);
        const z = Math.sin(a) * 0.26 * rad;
        pts.push(x, y, z);
      }
    } else if (organKey === "liver") {
      // Classic Wedge-shaped Hepatic Bilobed Silhouette (large right lobe, tapered left lobe)
      for (let i = 0; i < n; i++) {
        const s = Math.random(); // 0 = right lobe (x = -0.35), 1 = left lobe tip (x = +0.35)
        const x = -0.36 + s * 0.72;
        const thickness = (1 - s * 0.78) * 0.28;
        const a = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.45) * thickness;
        const y = Math.sin(a) * r + (1 - s) * 0.06 - s * 0.08;
        const z = Math.cos(a) * r * 0.85;
        pts.push(x, y, z);
      }
    } else if (organKey === "kidney") {
      // Bilateral Bean-Shaped (Reniform) Kidneys with concave medial hilum
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const t = (Math.random() - 0.5) * 2.5; // -1.25 to +1.25 along C-curve
        const a = Math.random() * Math.PI * 2;
        const tubeR = 0.11 * Math.cos(t * 0.55) * (0.65 + 0.35 * Math.random());
        const cx = side * (0.34 + Math.pow(t, 2) * 0.035);
        const cy = t * 0.14;
        pts.push(cx + Math.cos(a) * tubeR, cy, Math.sin(a) * tubeR * 0.8);
      }
    } else if (organKey === "gi") {
      // J-shaped Stomach + Coiled Intestinal Tract
      for (let i = 0; i < n; i++) {
        if (i < n * 0.45) {
          // J-shaped stomach curve
          const t = Math.random() * Math.PI * 1.15;
          const a = Math.random() * Math.PI * 2;
          const r = 0.11 * Math.sin(t * 0.85 + 0.2);
          const cx = 0.08 + Math.sin(t) * 0.16;
          const cy = 0.22 - t * 0.14;
          pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, Math.sin(a) * r);
        } else {
          // Coiled intestinal loops below
          const t = Math.random() * Math.PI * 5;
          const a = Math.random() * Math.PI * 2;
          const r = 0.055;
          const cx = Math.cos(t) * 0.22 * (0.6 + 0.4 * Math.sin(t * 0.4));
          const cy = -0.05 - (t / (Math.PI * 5)) * 0.35;
          const cz = Math.sin(t) * 0.14;
          pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz);
        }
      }
    } else if (organKey === "ocular") {
      // Bilateral Ocular Spheres + Optic Chiasm Tracts
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        if (i < n * 0.65) {
          const u = Math.random() * Math.PI * 2;
          const v = Math.acos(2 * Math.random() - 1);
          const r = 0.11;
          pts.push(
            side * 0.18 + Math.sin(v) * Math.cos(u) * r,
            Math.cos(v) * r,
            0.12 + Math.sin(v) * Math.sin(u) * r
          );
        } else {
          // Optic nerve fibers converging posteriorly to chiasm
          const s = Math.random();
          pts.push(
            side * (0.18 * (1 - s * 0.85)) + (Math.random() - 0.5) * 0.025,
            (Math.random() - 0.5) * 0.025,
            0.05 - s * 0.28
          );
        }
      }
    } else {
      // "blood": Central Aorta & Vena Cava Trunk + Bifurcating Iliac Tree
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const h = Math.random();
        const y = -0.9 + h * 1.9;
        const a = Math.random() * Math.PI * 2;
        const r = 0.045;
        const spread = y < -0.35 ? (-0.35 - y) * 0.42 : 0.06;
        pts.push(side * spread + Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }

    return pts;
  }

  _buildHolographicDotOrgans() {
    const specs = [
      {
        key: "brain",
        en: "BRAIN (CNS)",
        ko: "중추신경/뇌",
        target: "GABA-A / BBB",
        anatomyPos: new THREE.Vector3(0, 3.12, 0.02),
        pipePos: new THREE.Vector3(0, 2.85, 0),
        scale: 1.0,
        pipeScale: 1.35,
      },
      {
        key: "ocular",
        en: "OCULAR",
        ko: "안구/시신경",
        target: "Cornea / Retina",
        anatomyPos: new THREE.Vector3(0, 2.95, 0.34),
        pipePos: new THREE.Vector3(-2.55, 2.35, 0.2),
        scale: 1.0,
        pipeScale: 1.45,
      },
      {
        key: "lungs",
        en: "LUNGS",
        ko: "폐/호흡기",
        target: "Alveolar Type II",
        anatomyPos: new THREE.Vector3(0, 1.72, 0.02),
        pipePos: new THREE.Vector3(2.45, 2.15, 0.1),
        scale: 1.0,
        pipeScale: 1.3,
      },
      {
        key: "heart",
        en: "HEART (CV)",
        ko: "심장/심혈관",
        target: "hERG Kv11.1 (Q12809)",
        anatomyPos: new THREE.Vector3(0.14, 1.65, 0.22),
        pipePos: new THREE.Vector3(0, 1.45, 0.35),
        scale: 1.0,
        pipeScale: 1.55,
      },
      {
        key: "liver",
        en: "LIVER",
        ko: "간 (Zone 3)",
        target: "CYP2E1 (P05181)",
        anatomyPos: new THREE.Vector3(-0.22, 1.08, 0.16),
        pipePos: new THREE.Vector3(-2.35, 0.55, 0.2),
        scale: 1.0,
        pipeScale: 1.45,
      },
      {
        key: "gi",
        en: "GI TRACT",
        ko: "위장관 (경구흡수)",
        target: "CYP3A4 / Enterocyte",
        anatomyPos: new THREE.Vector3(0.16, 0.58, 0.15),
        pipePos: new THREE.Vector3(-2.35, -1.15, 0.2),
        scale: 1.0,
        pipeScale: 1.4,
      },
      {
        key: "kidney",
        en: "KIDNEYS",
        ko: "신장 (근위세관)",
        target: "Megalin / OCT2",
        anatomyPos: new THREE.Vector3(0, 0.68, -0.14),
        pipePos: new THREE.Vector3(2.45, 0.35, 0.15),
        scale: 1.0,
        pipeScale: 1.5,
      },
      {
        key: "blood",
        en: "BLOOD / RBC",
        ko: "혈액/적혈구",
        target: "Hemoglobin / G6PD",
        anatomyPos: new THREE.Vector3(0, 0.85, 0),
        pipePos: new THREE.Vector3(2.45, -1.2, 0.15),
        scale: 1.0,
        pipeScale: 1.25,
      },
    ];

    specs.forEach((sp) => {
      const group = new THREE.Group();
      group.position.copy(sp.anatomyPos);
      group.userData = { organKey: sp.key, spec: sp };

      // 1. High-density 3D Dot-Matrix Point Cloud
      const rawPts = this._generateOrganPointCloud(sp.key);
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(rawPts, 3));
      const dotMat = new THREE.PointsMaterial({
        color: 0x10b981,
        size: 0.055,
        map: this._createDotTexture(),
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const dotCloud = new THREE.Points(dotGeo, dotMat);
      group.add(dotCloud);

      // 2. Soft Volumetric Inner Hologram Core
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 20), coreMat);
      group.add(coreGlow);

      // 3. Orbiting Holographic Target Ring around Organ
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.32,
      });
      const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.405, 48), ringMat);
      ringMesh.rotation.x = Math.PI / 2.4;
      group.add(ringMesh);

      // 4. Invisible Raycast Hit Sphere for Easy Clicking
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitMesh.userData = { organKey: sp.key };
      group.add(hitMesh);

      // 5. Floating Hologram Label Sprite
      const labelSprite = this._createHoloLabelSprite(sp.en, sp.ko, sp.target, "#22d3ee");
      labelSprite.position.set(0, 0.52, 0);
      labelSprite.visible = false; // Visible in Pipe Mode or when selected/hovered
      group.add(labelSprite);

      this.organsGroup.add(group);
      this.organNodes[sp.key] = {
        group,
        dotCloud,
        coreGlow,
        ringMesh,
        hitMesh,
        labelSprite,
        spec: sp,
        riskPct: 5,
      };
    });
  }

  /**
   * Build Mode 2: 3D PBPK Vascular Pipe & Organ Circuit
   * Shows explicit 3D arterial & venous/portal pipes connecting the organs!
   */
  _buildPBPKPipeCircuit() {
    const routes = [
      // Oral GI -> Hepatic Portal Vein Pipe -> Liver (First-Pass Metabolism)
      {
        from: new THREE.Vector3(-2.35, -1.15, 0.2),
        mid: new THREE.Vector3(-2.85, -0.3, 0.45),
        to: new THREE.Vector3(-2.35, 0.55, 0.2),
        color: 0xf59e0b, // Portal vein amber
        radius: 0.055,
      },
      // Liver -> Hepatic Vein -> Central Heart Pump
      {
        from: new THREE.Vector3(-2.35, 0.55, 0.2),
        mid: new THREE.Vector3(-1.15, 1.15, 0.5),
        to: new THREE.Vector3(0, 1.45, 0.35),
        color: 0x38bdf8,
        radius: 0.06,
      },
      // Heart <-> Lungs (Pulmonary Circulation Loop)
      {
        from: new THREE.Vector3(0, 1.45, 0.35),
        mid: new THREE.Vector3(1.25, 2.05, 0.45),
        to: new THREE.Vector3(2.45, 2.15, 0.1),
        color: 0x22d3ee,
        radius: 0.065,
      },
      // Heart -> Carotid Artery -> Brain (CNS)
      {
        from: new THREE.Vector3(0, 1.45, 0.35),
        mid: new THREE.Vector3(0, 2.15, 0.45),
        to: new THREE.Vector3(0, 2.85, 0),
        color: 0xf43f5e, // Arterial red-magenta
        radius: 0.055,
      },
      // Heart -> Ophthalmic Artery -> Ocular
      {
        from: new THREE.Vector3(0, 1.45, 0.35),
        mid: new THREE.Vector3(-1.3, 2.1, 0.4),
        to: new THREE.Vector3(-2.55, 2.35, 0.2),
        color: 0xa855f7,
        radius: 0.045,
      },
      // Heart -> Renal Artery -> Kidneys (GFR / CrCl Clearance)
      {
        from: new THREE.Vector3(0, 1.45, 0.35),
        mid: new THREE.Vector3(1.3, 0.9, 0.4),
        to: new THREE.Vector3(2.45, 0.35, 0.15),
        color: 0x10b981,
        radius: 0.06,
      },
      // Heart -> Systemic Vascular / RBC Compartment
      {
        from: new THREE.Vector3(0, 1.45, 0.35),
        mid: new THREE.Vector3(1.1, 0.0, 0.35),
        to: new THREE.Vector3(2.45, -1.2, 0.15),
        color: 0xf43f5e,
        radius: 0.055,
      },
    ];

    routes.forEach((rt) => {
      const curve = new THREE.QuadraticBezierCurve3(rt.from, rt.mid, rt.to);
      const tubeGeo = new THREE.TubeGeometry(curve, 44, rt.radius, 14, false);
      const tubeMat = new THREE.MeshPhysicalMaterial({
        color: rt.color,
        emissive: rt.color,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.42,
        roughness: 0.2,
        metalness: 0.1,
        wireframe: false,
      });
      const pipeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      this.pipeNetworkGroup.add(pipeMesh);

      // Wireframe outer sheath for futuristic pipe look
      const wireGeo = new THREE.TubeGeometry(curve, 24, rt.radius * 1.18, 8, false);
      const wireMat = new THREE.MeshBasicMaterial({
        color: rt.color,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
      });
      this.pipeNetworkGroup.add(new THREE.Mesh(wireGeo, wireMat));

      // Create 4 glowing plasma/drug bolus spheres traveling along each pipe
      for (let b = 0; b < 4; b++) {
        const bolusMesh = new THREE.Mesh(
          new THREE.SphereGeometry(rt.radius * 1.35, 12, 12),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
          })
        );
        this.pipeNetworkGroup.add(bolusMesh);
        this.pipeBoluses.push({
          mesh: bolusMesh,
          curve,
          progress: b / 4,
          baseSpeed: 0.22 + Math.random() * 0.08,
        });
      }
    });
  }

  /**
   * Build 3D Holographic AlphaFold Target Protein Complex that materializes in 3D space
   * right next to the zoomed-in organ!
   */
  _build3DAlphaFoldProteinConstruct() {
    this.proteinHologramGroup.innerHTML = "";

    // Outer Holo Containment Sphere + Rotating Gimbal Rings (like sample_UI.html core)
    const cageRing1 = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.48, 64),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    this.proteinHologramGroup.add(cageRing1);

    const cageRing2 = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.535, 64),
      new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    );
    cageRing2.rotation.y = Math.PI / 3;
    this.proteinHologramGroup.add(cageRing2);

    // 3D Coiled Alpha-Helices Ribbon (Representing AlphaFold DB Receptor Backbone)
    const helixPts = [];
    for (let i = 0; i < 160; i++) {
      const t = (i / 160) * Math.PI * 6;
      const hx = Math.cos(t) * 0.22 + Math.sin(t * 0.3) * 0.08;
      const hy = ((i / 160) - 0.5) * 0.55;
      const hz = Math.sin(t) * 0.22;
      helixPts.push(new THREE.Vector3(hx, hy, hz));
    }
    const helixCurve = new THREE.CatmullRomCurve3(helixPts);
    const helixGeo = new THREE.TubeGeometry(helixCurve, 120, 0.024, 8, false);
    const helixMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.65,
      roughness: 0.2,
    });
    this.proteinHelixMesh = new THREE.Mesh(helixGeo, helixMat);
    this.proteinHologramGroup.add(this.proteinHelixMesh);

    // Co-Folded Drug Ligand Atoms inside the Active Pocket (Bright Lime/Magenta Spheres)
    this.ligandCluster = new THREE.Group();
    const atomOffsets = [
      [0, 0, 0, 0xb6ff3c, 0.055],
      [0.06, 0.04, 0.02, 0xb6ff3c, 0.045],
      [-0.06, -0.03, 0.03, 0xff2bd1, 0.05],
      [0.03, -0.06, -0.04, 0x22d3ee, 0.045],
      [-0.04, 0.06, -0.03, 0xfbbf24, 0.048],
    ];
    atomOffsets.forEach(([ax, ay, az, col, rad]) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(rad, 16, 16),
        new THREE.MeshBasicMaterial({ color: col })
      );
      m.position.set(ax, ay, az);
      this.ligandCluster.add(m);
    });
    this.proteinHologramGroup.add(this.ligandCluster);

    // Floating AlphaFold Target Sprite Label above the 3D Protein Construct
    this.proteinTitleSprite = this._createHoloLabelSprite(
      "ALPHAFOLD 3 POCKET",
      "타겟 수용체 결합",
      "CYP2E1 · ΔG = -7.8 kcal/mol",
      "#b6ff3c"
    );
    this.proteinTitleSprite.position.set(0, 0.68, 0);
    this.proteinTitleSprite.scale.set(1.35, 0.36, 1);
    this.proteinHologramGroup.add(this.proteinTitleSprite);
  }

  /**
   * Update the 3D AlphaFold Protein Hologram label & colors from simulation data
   */
  updateAlphaFoldTargetHologram(arg1, arg2, arg3) {
    if (!arg1) return;
    let titleText = "AF3 TARGET";
    let subText = "RECEPTOR POCKET";
    let detailText = "ALPHAFOLD 3 CO-FOLD";

    if (typeof arg1 === "string") {
      // Called as (organKey, receptorLabel, peakRiskPct)
      titleText = `AF3 · ${(arg2 || arg1).toUpperCase()}`;
      subText = `ORGAN: ${arg1.toUpperCase()}`;
      detailText = `Peak Organ Risk: ${(arg3 || 0).toFixed(1)}%`;
    } else {
      const structure3d = arg1;
      const thermodynamics = arg2;
      const protName = (structure3d.target_protein || "Receptor").split("(")[0].trim();
      const pdbId = structure3d.pdb_id || "AF3";
      const dg = thermodynamics ? `${thermodynamics.delta_g_kcal_mol} kcal/mol` : "";
      titleText = `AF3 · ${pdbId}`;
      subText = protName.slice(0, 18);
      detailText = `pLDDT ${structure3d.af3_plddt || 94.2} | ΔG ${dg}`;
    }

    if (this.proteinTitleSprite) {
      this.proteinHologramGroup.remove(this.proteinTitleSprite);
    }
    this.proteinTitleSprite = this._createHoloLabelSprite(
      titleText,
      subText,
      detailText,
      "#b6ff3c"
    );
    this.proteinTitleSprite.position.set(0, 0.68, 0);
    this.proteinTitleSprite.scale.set(1.4, 0.38, 1);
    this.proteinHologramGroup.add(this.proteinTitleSprite);
  }

  _buildCirculatingParticles() {
    const count = 420;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    this.vascularParticleMeta = [];
    for (let i = 0; i < count; i++) {
      const y = -2.2 + Math.random() * 5.2;
      const spread = y > 2.4 ? 0.22 : y > 0.2 ? 0.55 : 0.38;
      const x = (Math.random() - 0.5) * spread * 2;
      const z = (Math.random() - 0.5) * 0.35;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      colors[i * 3] = 0.13;
      colors[i * 3 + 1] = 0.83;
      colors[i * 3 + 2] = 0.93;

      this.vascularParticleMeta.push({
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
        radius: 0.08 + Math.random() * 0.42,
      });
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.075,
      map: this._createDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.vascularParticles = new THREE.Points(geo, mat);
    this.bodyShellGroup.add(this.vascularParticles);
  }

  /**
   * Switch between Mode 1 ("anatomy") and Mode 2 ("pipe_circuit")
   */
  setViewMode(mode) {
    this.viewMode = mode === "pipe_circuit" ? "pipe_circuit" : "anatomy";
    const isPipe = this.viewMode === "pipe_circuit";

    this.bodyShellGroup.visible = !isPipe && this.shellVisible;
    this.pipeNetworkGroup.visible = isPipe;

    Object.keys(this.organNodes).forEach((key) => {
      const node = this.organNodes[key];
      node.labelSprite.visible = isPipe || this.selectedOrgan === key;
    });

    if (this.isZoomedIn && this.selectedOrgan) {
      this.warpToOrgan(this.selectedOrgan, false);
    } else {
      this.resetCamera();
    }
  }

  /**
   * Cosmic Space-Flight Warp into a specific organ + materialize 3D AlphaFold Target Protein!
   */
  warpToOrgan(organKey, showBanner = true) {
    const node = this.organNodes[organKey];
    if (!node) return;

    this.selectedOrgan = organKey;
    this.isZoomedIn = true;
    this.autoRotate = false;
    this.rootGroup.rotation.y = 0;

    const targetPos =
      this.viewMode === "pipe_circuit" ? node.spec.pipePos : node.spec.anatomyPos;

    // Position camera right in front of the organ for an immersive cosmic close-up
    this.camLookTarget.copy(targetPos);
    this.camPosTarget.set(targetPos.x + 0.25, targetPos.y + 0.18, targetPos.z + 2.05);

    // Materialize the 3D AlphaFold Receptor-Ligand Hologram right next to the organ!
    this.proteinHologramGroup.visible = true;
    this.proteinHologramGroup.position.set(
      targetPos.x + (targetPos.x >= 0 ? 0.78 : -0.78),
      targetPos.y + 0.05,
      targetPos.z + 0.15
    );

    // Highlight selected organ label
    Object.keys(this.organNodes).forEach((k) => {
      const n = this.organNodes[k];
      n.labelSprite.visible = this.viewMode === "pipe_circuit" || k === organKey;
    });

    if (showBanner) {
      this._triggerWarpBanner(
        `WARP ▸ ${node.spec.en}`,
        `${node.spec.ko} · ${node.spec.target}`,
        "ALPHAFOLD 3 TARGET POCKET LOCKED"
      );
    }
  }

  _triggerWarpBanner(bearText, destText, subText) {
    const hud = document.getElementById("warp");
    if (!hud) return;
    const wl = document.getElementById("warpBear");
    const wd = document.getElementById("warpDest") || document.getElementById("warp-title");
    const wt = document.getElementById("warpType") || document.getElementById("warp-sub");
    if (wl) wl.textContent = bearText;
    if (wd) wd.textContent = bearText ? `${bearText} · ${destText}` : destText;
    if (wt) wt.textContent = subText;
    hud.classList.add("on");
    clearTimeout(this._warpTimer);
    this._warpTimer = setTimeout(() => hud.classList.remove("on"), 1350);
  }

  selectOrgan(organKey, shouldWarp = false) {
    this.selectedOrgan = organKey;
    if (shouldWarp) {
      this.warpToOrgan(organKey, true);
    }
  }

  highlightOrgan(organKey) {
    this.selectedOrgan = organKey;
  }

  resetCameraMacroView() {
    this.resetCamera();
  }

  onResize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  updateOrganStates(organRisksMap, organConcMap, plasmaRatio) {
    this.updateSimulationFrame((plasmaRatio || 0) * 25.0, organRisksMap, 25.0);
  }

  resetCamera() {
    this.isZoomedIn = false;
    this.proteinHologramGroup.visible = false;
    if (this.viewMode === "pipe_circuit") {
      this.camLookTarget.set(0, 0.85, 0);
      this.camPosTarget.set(0, 0.95, 8.8);
      this.autoRotate = false;
    } else {
      this.camLookTarget.set(0, 0.95, 0);
      this.camPosTarget.set(0, 1.1, 8.6);
      this.autoRotate = true;
    }
    this._triggerWarpBanner("WARP ▸ MACRO VIEW", "FULL SYSTEM DIGITAL TWIN", "8-ORGAN IN-SILICO OVERVIEW");
  }

  toggleShell() {
    this.shellVisible = !this.shellVisible;
    if (this.viewMode === "anatomy") {
      this.bodyShellGroup.visible = this.shellVisible;
    }
    return this.shellVisible;
  }

  toggleAutoRotate() {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
  }

  /**
   * Trigger 3D Drug Administration Animation (Oral capsule vs IV Bolus/Infusion)
   */
  triggerAdministrationAnimation(route = "oral") {
    while (this.adminAnimGroup.children.length > 0) {
      this.adminAnimGroup.remove(this.adminAnimGroup.children[0]);
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 20, 20),
      new THREE.MeshBasicMaterial({ color: route === "oral" ? 0xb6ff3c : 0x22d3ee })
    );
    this.adminAnimGroup.add(mesh);

    const isPipe = this.viewMode === "pipe_circuit";
    const startPos =
      route === "oral"
        ? isPipe
          ? new THREE.Vector3(-2.35, 0.2, 1.2)
          : new THREE.Vector3(0, 2.75, 0.65)
        : isPipe
        ? new THREE.Vector3(0, 2.5, 1.2)
        : new THREE.Vector3(-1.25, 1.55, 0.35);

    const endPos =
      route === "oral"
        ? isPipe
          ? this.organNodes.gi.spec.pipePos.clone()
          : this.organNodes.gi.spec.anatomyPos.clone()
        : isPipe
        ? this.organNodes.heart.spec.pipePos.clone()
        : this.organNodes.heart.spec.anatomyPos.clone();

    this.activeAdminAnim = {
      mesh,
      startPos,
      endPos,
      progress: 0,
    };
  }

  /**
   * Update organ colors and particle velocities at time frame t
   */
  updateSimulationFrame(plasmaConc, organRisksMap, toxicThreshold) {
    const ratio = Math.min(2.0, plasmaConc / Math.max(1.0, toxicThreshold || 25.0));

    // Update each organ's dot-matrix color based on instantaneous riskPct
    Object.keys(this.organNodes).forEach((key) => {
      const node = this.organNodes[key];
      const risk = (organRisksMap && organRisksMap[key]) || 0;
      node.riskPct = risk;

      let hex = 0x10b981; // Safe Emerald
      if (risk >= 65) {
        hex = 0xf43f5e; // Critical Rose-Red
      } else if (risk >= 35) {
        hex = 0xf59e0b; // Elevated Amber
      } else if (risk >= 15) {
        hex = 0x22d3ee; // Active Cyan
      }

      node.dotCloud.material.color.setHex(hex);
      node.coreGlow.material.color.setHex(hex);
      node.coreGlow.material.opacity = 0.08 + Math.min(0.32, (risk / 100) * 0.32);
      node.ringMesh.material.color.setHex(this.selectedOrgan === key ? 0xb6ff3c : hex);
    });

    // Update circulating bloodstream particle color
    if (this.vascularParticles) {
      const colors = this.vascularParticles.geometry.attributes.color;
      for (let i = 0; i < colors.count; i++) {
        if (ratio > 0.85 && i % 3 === 0) {
          colors.setXYZ(i, 0.96, 0.25, 0.37); // Toxic crimson particles
        } else {
          colors.setXYZ(i, 0.13, 0.83, 0.93); // Healthy cyan plasma particles
        }
      }
      colors.needsUpdate = true;
    }
  }

  _bindInteractions() {
    window.addEventListener("resize", () => this.onResize());

    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let dragDist = 0;

    const dom = this.renderer.domElement;
    dom.addEventListener("pointerdown", (e) => {
      isDragging = true;
      dragDist = 0;
      prevX = e.clientX;
      prevY = e.clientY;
    });

    window.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      prevX = e.clientX;
      prevY = e.clientY;

      this.autoRotate = false;
      this.rootGroup.rotation.y += dx * 0.0075;
      this.userPitch = Math.max(-0.6, Math.min(0.6, this.userPitch + dy * 0.004));
    });

    window.addEventListener("pointerup", (e) => {
      if (!isDragging) return;
      isDragging = false;
      if (dragDist < 6) {
        this._handleCanvasClick(e);
      }
    });

    // Mouse Wheel Cosmic Zoom-In / Zoom-Out
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = new THREE.Vector3().subVectors(this.camPosTarget, this.camLookTarget);
        const dist = dir.length();
        const newDist = Math.max(1.4, Math.min(13.5, dist + e.deltaY * 0.004));
        dir.normalize().multiplyScalar(newDist);
        this.camPosTarget.copy(this.camLookTarget).add(dir);
      },
      { passive: false }
    );
  }

  _handleCanvasClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hitMeshes = Object.values(this.organNodes).map((n) => n.hitMesh);
    const intersects = this.raycaster.intersectObjects(hitMeshes, false);

    if (intersects.length > 0) {
      const organKey = intersects[0].object.userData.organKey;
      if (organKey) {
        this.warpToOrgan(organKey, true);
        this.onOrganClick(organKey);
      }
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.getElapsedTime();

    // 1. Smooth Camera Warp Interpolation
    this.camPosNow.lerp(this.camPosTarget, 0.075);
    this.camLookNow.lerp(this.camLookTarget, 0.085);
    this.camera.position.copy(this.camPosNow);
    this.camera.lookAt(this.camLookNow);

    // 2. Gentle Auto-Rotation in Macro Anatomy View
    if (this.autoRotate && !this.isZoomedIn && this.viewMode === "anatomy") {
      this.rootGroup.rotation.y += dt * 0.22;
    }

    // 3. Interpolate Organ Positions & Scales between Mode 1 (Anatomy) and Mode 2 (Pipe Circuit)
    const isPipe = this.viewMode === "pipe_circuit";
    Object.keys(this.organNodes).forEach((key) => {
      const node = this.organNodes[key];
      const targetP = isPipe ? node.spec.pipePos : node.spec.anatomyPos;
      node.group.position.lerp(targetP, 0.09);

      const baseScale = isPipe ? node.spec.pipeScale : node.spec.scale;
      const isSelected = this.selectedOrgan === key;
      const pulse =
        key === "heart"
          ? 1 + 0.08 * Math.sin(elapsed * 6.5)
          : 1 + 0.035 * Math.sin(elapsed * 2.4);
      const s = baseScale * (isSelected ? 1.18 : 1.0) * pulse;
      node.dotCloud.scale.setScalar(s);
      node.ringMesh.rotation.z = elapsed * (isSelected ? 1.4 : 0.45);
    });

    // 4. Animate PBPK Pipe Boluses (Mode 2)
    if (isPipe) {
      this.pipeBoluses.forEach((b) => {
        b.progress = (b.progress + dt * b.baseSpeed) % 1.0;
        const pt = b.curve.getPointAt(b.progress);
        b.mesh.position.copy(pt);
      });
    }

    // 5. Animate Circulating Bloodstream Particles (Mode 1)
    if (this.vascularParticles && this.bodyShellGroup.visible) {
      const posAttr = this.vascularParticles.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i);
        const meta = this.vascularParticleMeta[i];
        y += dt * meta.speed;
        if (y > 3.1) y = -2.2;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }

    // 6. Animate In-Organ 3D AlphaFold Protein Construct when Zoomed In
    if (this.proteinHologramGroup.visible) {
      this.proteinHologramGroup.rotation.y = elapsed * 0.65;
      if (this.ligandCluster) {
        this.ligandCluster.scale.setScalar(1 + 0.08 * Math.sin(elapsed * 4.0));
      }
    }

    // 7. Animate Administration Bolus (Oral / IV)
    if (this.activeAdminAnim) {
      const anim = this.activeAdminAnim;
      anim.progress += dt * 0.85;
      if (anim.progress >= 1.0) {
        this.adminAnimGroup.remove(anim.mesh);
        this.activeAdminAnim = null;
      } else {
        anim.mesh.position.lerpVectors(anim.startPos, anim.endPos, anim.progress);
      }
    }

    // 8. Slowly drift background cosmic starfield
    if (this.starfield) {
      this.starfield.rotation.y = elapsed * 0.015;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.PharmacoBody3D = PharmacoBody3D;
window.Body3DSimulator = PharmacoBody3D;
