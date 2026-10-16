/**
 * PharmacoTwin 3D — Interactive Three.js Human Digital Twin,
 * User Photo 3D UV Head Avatar, 8 Internal Organs, Vascular Particle System,
 * and Oral / IV Drug Administration Animations.
 */

class PharmacoBody3D {
  constructor(containerId, onOrganClick) {
    this.container = document.getElementById(containerId);
    this.onOrganClick = onOrganClick || (() => {});
    this.organMeshes = {};     // organKey -> Group / Array of Meshes
    this.organMaterials = {};  // organKey -> MeshPhysicalMaterial
    this.selectedOrgan = "liver";
    this.shellVisible = true;
    this.autoRotate = false;

    // Administration animation state
    this.adminAnim = {
      active: false,
      route: "oral",
      startTime: 0,
      durationSec: 3.6,
    };

    // Current simulation state at time index
    this.currentPlasmaConc = 0;
    this.currentOrganRisks = {};

    this._initScene();
    this._buildHumanShellAndPhotoHead();
    this._buildEightOrgans();
    this._buildVascularParticles();
    this._buildAdminProps();
    this._initInteraction();
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth || 560;
    const h = this.container.clientHeight || 460;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(0, 1.1, 7.6);
    this.camera.lookAt(0, 0.7, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.85);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
    keyLight.position.set(4, 7, 6);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x818cf8, 0.9);
    rimLight.position.set(-5, 3, -4);
    this.scene.add(rimLight);

    const frontWarm = new THREE.PointLight(0xffffff, 0.75, 15);
    frontWarm.position.set(0, 2.8, 3.8);
    this.scene.add(frontWarm);

    // Root character group
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = -0.35;
    this.scene.add(this.bodyGroup);

    // Subtle sci-fi floor platform grid
    const ringGeo = new THREE.RingGeometry(1.3, 1.55, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
    });
    const floorRing = new THREE.Mesh(ringGeo, ringMat);
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = -1.95;
    this.bodyGroup.add(floorRing);

    window.addEventListener("resize", () => this.resize());
  }

  _buildHumanShellAndPhotoHead() {
    this.shellGroup = new THREE.Group();
    this.bodyGroup.add(this.shellGroup);

    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x1e3a8a,
      emissive: 0x09152b,
      specular: 0x38bdf8,
      shininess: 80,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });

    // 1. 3D Head Mesh with User's Real Photo UV Texture (/static/assets/user_face_uv.jpg)
    const headGeo = new THREE.SphereGeometry(0.46, 48, 48);
    headGeo.scale(0.88, 1.08, 0.94);

    const texLoader = new THREE.TextureLoader();
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.05,
    });

    texLoader.load(
      "/static/assets/user_face_uv.jpg",
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // Align spherical UV seam so the front of the face points forward (+Z)
        tex.offset.x = -0.25;
        tex.wrapS = THREE.RepeatWrapping;
        this.headMat.map = tex;
        this.headMat.needsUpdate = true;
      },
      undefined,
      () => {
        this.headMat.color.setHex(0xe2b897);
      }
    );

    this.headMesh = new THREE.Mesh(headGeo, this.headMat);
    this.headMesh.position.set(0, 2.55, 0);
    // Rotate sphere so UV center faces +Z camera
    this.headMesh.rotation.y = -Math.PI / 2;
    this.bodyGroup.add(this.headMesh);

    // Translucent cranial visor ring around head for sci-fi medical twin aesthetic
    const haloGeo = new THREE.RingGeometry(0.52, 0.56, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    this.headHalo = new THREE.Mesh(haloGeo, haloMat);
    this.headHalo.position.set(0, 2.55, 0);
    this.bodyGroup.add(this.headHalo);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.36, 24);
    const neckMesh = new THREE.Mesh(neckGeo, glassMat);
    neckMesh.position.set(0, 2.02, 0);
    this.shellGroup.add(neckMesh);

    // Upper Torso / Ribcage Shell
    const chestGeo = new THREE.CylinderGeometry(0.66, 0.54, 1.35, 32);
    chestGeo.scale(1.08, 1.0, 0.66);
    const chestMesh = new THREE.Mesh(chestGeo, glassMat);
    chestMesh.position.set(0, 1.22, 0);
    this.shellGroup.add(chestMesh);
    this.shellGroup.add(new THREE.Mesh(chestGeo, wireMat).translateY(1.22));

    // Abdomen / Pelvis Shell
    const abdGeo = new THREE.CylinderGeometry(0.54, 0.48, 1.05, 32);
    abdGeo.scale(1.04, 1.0, 0.64);
    const abdMesh = new THREE.Mesh(abdGeo, glassMat);
    abdMesh.position.set(0, 0.04, 0);
    this.shellGroup.add(abdMesh);

    // Shoulders & Arms
    [-1, 1].forEach((side) => {
      const shoulderGeo = new THREE.SphereGeometry(0.22, 20, 20);
      const shoulder = new THREE.Mesh(shoulderGeo, glassMat);
      shoulder.position.set(side * 0.82, 1.72, 0);
      this.shellGroup.add(shoulder);

      const upperArmGeo = new THREE.CylinderGeometry(0.15, 0.13, 1.05, 20);
      const upperArm = new THREE.Mesh(upperArmGeo, glassMat);
      upperArm.position.set(side * 0.92, 1.15, 0);
      upperArm.rotation.z = side * 0.12;
      this.shellGroup.add(upperArm);

      const forearmGeo = new THREE.CylinderGeometry(0.12, 0.10, 0.95, 20);
      const forearm = new THREE.Mesh(forearmGeo, glassMat);
      forearm.position.set(side * 1.04, 0.22, 0.08);
      forearm.rotation.z = side * 0.08;
      this.shellGroup.add(forearm);
    });

    // Upper Legs
    [-1, 1].forEach((side) => {
      const legGeo = new THREE.CylinderGeometry(0.21, 0.15, 1.45, 22);
      const leg = new THREE.Mesh(legGeo, glassMat);
      leg.position.set(side * 0.28, -1.18, 0);
      this.shellGroup.add(leg);
    });
  }

  updateUserFaceTexture(faceUvUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(faceUvUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.headMat.map = tex;
      this.headMat.needsUpdate = true;
    });
  }

  _createOrganMaterial(baseColorHex) {
    return new THREE.MeshPhongMaterial({
      color: baseColorHex,
      emissive: baseColorHex,
      emissiveIntensity: 0.28,
      specular: 0xffffff,
      shininess: 65,
      transparent: true,
      opacity: 0.88,
    });
  }

  _registerOrganGroup(organKey, group, mat) {
    group.userData = { organKey };
    group.traverse((child) => {
      if (child.isMesh) {
        child.userData = { organKey };
      }
    });
    this.organMeshes[organKey] = group;
    this.organMaterials[organKey] = mat;
    this.bodyGroup.add(group);
  }

  _buildEightOrgans() {
    // 1. BRAIN (CNS — inside cranial vault, visible above/through semi-transparent head)
    const brainMat = this._createOrganMaterial(0x38bdf8);
    const brainGroup = new THREE.Group();
    [-0.12, 0.12].forEach((xOff) => {
      const hemiGeo = new THREE.SphereGeometry(0.23, 24, 24);
      hemiGeo.scale(0.85, 0.78, 1.12);
      const hemi = new THREE.Mesh(hemiGeo, brainMat);
      hemi.position.set(xOff, 2.72, 0.02);
      brainGroup.add(hemi);
    });
    this._registerOrganGroup("brain", brainGroup, brainMat);

    // 2. OCULAR (Paired Eyes on Face)
    const eyeMat = this._createOrganMaterial(0x22d3ee);
    const eyeGroup = new THREE.Group();
    [-0.14, 0.14].forEach((xOff) => {
      const eyeGeo = new THREE.SphereGeometry(0.058, 18, 18);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(xOff, 2.58, 0.39);
      eyeGroup.add(eye);
    });
    this._registerOrganGroup("ocular", eyeGroup, eyeMat);

    // 3. LUNGS (Paired Left & Right Pulmonary Lobes)
    const lungMat = this._createOrganMaterial(0x60a5fa);
    const lungGroup = new THREE.Group();
    [-0.28, 0.28].forEach((xOff) => {
      const lungGeo = new THREE.SphereGeometry(0.26, 24, 24);
      lungGeo.scale(0.78, 1.45, 0.75);
      const lung = new THREE.Mesh(lungGeo, lungMat);
      lung.position.set(xOff, 1.38, 0.02);
      lungGroup.add(lung);
    });
    this._registerOrganGroup("lungs", lungGroup, lungMat);

    // 4. HEART (Central/Left Ventricular Myocardium)
    const heartMat = this._createOrganMaterial(0xf43f5e);
    const heartGroup = new THREE.Group();
    const heartGeo = new THREE.SphereGeometry(0.17, 24, 24);
    heartGeo.scale(0.95, 1.18, 0.92);
    const heartMesh = new THREE.Mesh(heartGeo, heartMat);
    heartMesh.position.set(0.08, 1.32, 0.16);
    heartMesh.rotation.z = -0.25;
    heartGroup.add(heartMesh);
    this._registerOrganGroup("heart", heartGroup, heartMat);

    // 5. LIVER (Right Upper Quadrant — Bilobed Hepatic Parenchyma)
    const liverMat = this._createOrganMaterial(0x10b981);
    const liverGroup = new THREE.Group();
    const rightLobeGeo = new THREE.SphereGeometry(0.26, 24, 24);
    rightLobeGeo.scale(1.25, 0.78, 0.82);
    const rightLobe = new THREE.Mesh(rightLobeGeo, liverMat);
    rightLobe.position.set(-0.20, 0.78, 0.12);
    rightLobe.rotation.z = 0.22;
    liverGroup.add(rightLobe);

    const leftLobeGeo = new THREE.SphereGeometry(0.17, 20, 20);
    leftLobeGeo.scale(1.15, 0.65, 0.75);
    const leftLobe = new THREE.Mesh(leftLobeGeo, liverMat);
    leftLobe.position.set(0.05, 0.83, 0.15);
    liverGroup.add(leftLobe);
    this._registerOrganGroup("liver", liverGroup, liverMat);

    // 6. GI TRACT (Stomach + Intestinal Loop)
    const giMat = this._createOrganMaterial(0xf59e0b);
    const giGroup = new THREE.Group();
    const stomachGeo = new THREE.TorusGeometry(0.14, 0.065, 16, 32, Math.PI * 1.35);
    const stomach = new THREE.Mesh(stomachGeo, giMat);
    stomach.position.set(0.18, 0.66, 0.10);
    stomach.rotation.z = 0.6;
    giGroup.add(stomach);

    const gutGeo = new THREE.TorusKnotGeometry(0.16, 0.045, 48, 12, 2, 3);
    gutGeo.scale(1.15, 0.85, 0.6);
    const gut = new THREE.Mesh(gutGeo, giMat);
    gut.position.set(0.0, 0.12, 0.10);
    giGroup.add(gut);
    this._registerOrganGroup("gi", giGroup, giMat);

    // 7. KIDNEYS (Paired Retroperitoneal Left & Right Kidneys)
    const kidneyMat = this._createOrganMaterial(0xa855f7);
    const kidneyGroup = new THREE.Group();
    [-0.26, 0.26].forEach((xOff) => {
      const kGeo = new THREE.SphereGeometry(0.12, 20, 20);
      kGeo.scale(0.75, 1.32, 0.68);
      const kMesh = new THREE.Mesh(kGeo, kidneyMat);
      kMesh.position.set(xOff, 0.42, -0.10);
      kidneyGroup.add(kMesh);
    });
    this._registerOrganGroup("kidney", kidneyGroup, kidneyMat);

    // 8. BLOOD / SYSTEMIC VASCULAR TREE (Aorta, Vena Cava, Carotid, Iliac & Brachial Vessels)
    const bloodMat = this._createOrganMaterial(0xec4899);
    const bloodGroup = new THREE.Group();

    const aortaGeo = new THREE.CylinderGeometry(0.038, 0.032, 1.85, 16);
    const aorta = new THREE.Mesh(aortaGeo, bloodMat);
    aorta.position.set(-0.03, 0.85, -0.02);
    bloodGroup.add(aorta);

    const venaGeo = new THREE.CylinderGeometry(0.038, 0.032, 1.85, 16);
    const vena = new THREE.Mesh(venaGeo, bloodMat);
    vena.position.set(0.05, 0.85, -0.02);
    bloodGroup.add(vena);

    // Brachial vessel to left arm (IV injection conduit)
    const armVeinGeo = new THREE.CylinderGeometry(0.018, 0.015, 1.15, 12);
    const armVein = new THREE.Mesh(armVeinGeo, bloodMat);
    armVein.position.set(0.65, 1.15, 0.05);
    armVein.rotation.z = -1.05;
    bloodGroup.add(armVein);

    this._registerOrganGroup("blood", bloodGroup, bloodMat);
  }

  _buildVascularParticles() {
    // 320 glowing drug/blood particles circulating through heart -> brain -> liver -> kidneys -> periphery
    const count = 320;
    const positions = new Float32Array(count * 3);
    this.particlePhases = new Float32Array(count);
    this.particlePaths = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      this.particlePhases[i] = Math.random();
      this.particlePaths[i] = i % 5; // 0: aorta-kidney, 1: heart-brain, 2: portal-liver, 3: pulmonary, 4: peripheral limbs
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.particleMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.055,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
    });

    this.particleSystem = new THREE.Points(pGeo, this.particleMat);
    this.bodyGroup.add(this.particleSystem);
  }

  _buildAdminProps() {
    // 1. Oral Pill Capsule (descends mouth -> esophagus -> stomach)
    this.pillGroup = new THREE.Group();
    const pillGeo = new THREE.SphereGeometry(0.075, 16, 16);
    pillGeo.scale(0.8, 1.6, 0.8);
    const pillMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const pillMesh = new THREE.Mesh(pillGeo, pillMat);
    this.pillGroup.add(pillMesh);
    this.pillGroup.visible = false;
    this.bodyGroup.add(this.pillGroup);

    // 2. IV Syringe at Left Forearm/Brachial Vein
    this.syringeGroup = new THREE.Group();
    const barrelGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 16);
    const barrelMat = new THREE.MeshPhongMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.85,
    });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);

    const fluidGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.32, 16);
    const fluidMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.syringeFluid = new THREE.Mesh(fluidGeo, fluidMat);

    this.syringeGroup.add(barrel);
    this.syringeGroup.add(this.syringeFluid);
    this.syringeGroup.position.set(1.22, 0.92, 0.25);
    this.syringeGroup.rotation.z = 0.85;
    this.syringeGroup.visible = false;
    this.bodyGroup.add(this.syringeGroup);
  }

  triggerAdministrationAnimation(route) {
    this.adminAnim.active = true;
    this.adminAnim.route = route || "oral";
    this.adminAnim.startTime = performance.now() * 0.001;
    this.pillGroup.visible = this.adminAnim.route === "oral";
    this.syringeGroup.visible = this.adminAnim.route !== "oral";
  }

  _riskToColor(riskPct) {
    // 0% -> #10b981 (Emerald Safe), 35% -> #f59e0b (Amber Warning), 75%+ -> #f43f5e (Rose Critical)
    const cSafe = new THREE.Color(0x10b981);
    const cWarn = new THREE.Color(0xf59e0b);
    const cCrit = new THREE.Color(0xf43f5e);

    if (riskPct <= 35) {
      return cSafe.lerp(cWarn, Math.max(0, riskPct / 35));
    }
    return cWarn.lerp(cCrit, Math.min(1, (riskPct - 35) / 40));
  }

  updateSimulationFrame(plasmaConcMgL, organRiskMap, toxicThresholdMgL) {
    this.currentPlasmaConc = plasmaConcMgL || 0;
    this.currentOrganRisks = organRiskMap || {};

    // Update each of the 8 organs' 3D color, emissive glow, and scale
    Object.keys(this.organMaterials).forEach((organKey) => {
      const mat = this.organMaterials[organKey];
      const risk = this.currentOrganRisks[organKey] || 0;
      const col = this._riskToColor(risk);

      mat.color.copy(col);
      mat.emissive.copy(col);
      const isSelected = organKey === this.selectedOrgan;
      mat.emissiveIntensity = (0.25 + (risk / 100) * 0.75) + (isSelected ? 0.35 : 0);
      mat.opacity = isSelected ? 0.98 : 0.84;
    });

    // Update bloodstream particle color & size based on plasma concentration relative to threshold
    const ratio = Math.min(2.0, this.currentPlasmaConc / Math.max(1.0, toxicThresholdMgL || 20));
    if (ratio > 1.0) {
      this.particleMat.color.setHex(0xf43f5e);
    } else if (ratio > 0.5) {
      this.particleMat.color.setHex(0xf59e0b);
    } else {
      this.particleMat.color.setHex(0x38bdf8);
    }
    this.particleMat.size = 0.045 + Math.min(0.045, ratio * 0.03);
  }

  selectOrgan(organKey) {
    this.selectedOrgan = organKey;
    this.updateSimulationFrame(this.currentPlasmaConc, this.currentOrganRisks, 20);
  }

  toggleShell() {
    this.shellVisible = !this.shellVisible;
    this.shellGroup.visible = this.shellVisible;
    this.headMesh.material.transparent = !this.shellVisible;
    this.headMesh.material.opacity = this.shellVisible ? 1.0 : 0.35;
    return this.shellVisible;
  }

  toggleAutoRotate() {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
  }

  resetCamera() {
    this.bodyGroup.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.1, 7.6);
    this.camera.lookAt(0, 0.7, 0);
  }

  _initInteraction() {
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let downX = 0;
    let downY = 0;

    const dom = this.renderer.domElement;

    dom.addEventListener("pointerdown", (e) => {
      isDragging = true;
      prevX = downX = e.clientX;
      prevY = downY = e.clientY;
    });

    window.addEventListener("pointerup", (e) => {
      if (!isDragging) return;
      isDragging = false;
      const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moveDist < 6) {
        this._handleRayClick(e);
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;

      this.bodyGroup.rotation.y += dx * 0.008;
      this.bodyGroup.rotation.x = Math.max(-0.35, Math.min(0.35, this.bodyGroup.rotation.x + dy * 0.004));
    });

    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.camera.position.z = Math.max(4.2, Math.min(11.0, this.camera.position.z + e.deltaY * 0.004));
      },
      { passive: false }
    );
  }

  _handleRayClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const clickableMeshes = [];
    Object.values(this.organMeshes).forEach((grp) => {
      grp.traverse((ch) => {
        if (ch.isMesh) clickableMeshes.push(ch);
      });
    });

    const hits = raycaster.intersectObjects(clickableMeshes, false);
    if (hits.length > 0) {
      const organKey = hits[0].object.userData.organKey;
      if (organKey) {
        this.selectOrgan(organKey);
        this.onOrganClick(organKey);
      }
    }
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth || 560;
    const h = this.container.clientHeight || 460;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const now = performance.now() * 0.001;

    if (this.autoRotate) {
      this.bodyGroup.rotation.y += 0.0045;
    }

    // Heartbeat & high-risk organ pulsing
    Object.keys(this.organMeshes).forEach((organKey) => {
      const grp = this.organMeshes[organKey];
      const risk = this.currentOrganRisks[organKey] || 0;
      if (organKey === "heart") {
        const beat = 1.0 + Math.sin(now * (6.5 + risk * 0.05)) * 0.055;
        grp.scale.set(beat, beat, beat);
      } else if (risk >= 45) {
        const pulse = 1.0 + Math.sin(now * 5.0) * 0.04;
        grp.scale.set(pulse, pulse, pulse);
      } else {
        grp.scale.set(1, 1, 1);
      }
    });

    // Update Administration Animation (Oral pill swallowing vs IV syringe bolus)
    if (this.adminAnim.active) {
      const elapsed = now - this.adminAnim.startTime;
      const p = elapsed / this.adminAnim.durationSec;
      if (p >= 1.0) {
        this.adminAnim.active = false;
        this.pillGroup.visible = false;
        this.syringeGroup.visible = false;
      } else if (this.adminAnim.route === "oral") {
        // Descend from mouth (y=2.35, z=0.35) -> esophagus (y=1.5, z=0.08) -> stomach (y=0.66, x=0.18) -> liver portal
        if (p < 0.65) {
          const t = p / 0.65;
          this.pillGroup.position.set(0.18 * t, 2.35 - 1.69 * t, 0.32 * (1 - t) + 0.12);
          this.pillGroup.scale.setScalar(1.0);
        } else {
          // Dissolve & travel along portal vein to Liver (-0.20, 0.78, 0.12)
          const t = (p - 0.65) / 0.35;
          this.pillGroup.position.set(0.18 * (1 - t) - 0.20 * t, 0.66 + 0.12 * t, 0.12);
          this.pillGroup.scale.setScalar(1.2 - 0.8 * t);
        }
      } else {
        // IV Syringe plunger compression & bolus pulse into left brachial vein
        const compress = Math.max(0.1, 1.0 - p);
        this.syringeFluid.scale.set(1, compress, 1);
      }
    }

    // Update Bloodstream Particles
    if (this.particleSystem) {
      const posAttr = this.particleSystem.geometry.attributes.position;
      const arr = posAttr.array;
      const speed = 0.22 + Math.min(0.45, this.currentPlasmaConc * 0.008);

      for (let i = 0; i < this.particlePhases.length; i++) {
        let u = (this.particlePhases[i] + now * speed) % 1.0;
        const pathType = this.particlePaths[i];
        let x = 0, y = 0, z = 0;

        if (pathType === 0) {
          // Heart (1.32) -> Descending Aorta -> Kidneys (0.42) -> Iliac (-0.8)
          y = 1.35 - u * 2.15;
          x = Math.sin(u * Math.PI * 2) * 0.12;
          z = -0.02 + Math.cos(u * Math.PI) * 0.06;
        } else if (pathType === 1) {
          // Heart (1.32) -> Carotid -> Brain (2.72)
          y = 1.32 + u * 1.42;
          x = Math.sin(u * Math.PI) * 0.14 * (i % 2 === 0 ? 1 : -1);
          z = 0.05;
        } else if (pathType === 2) {
          // GI (0.4) -> Portal Vein -> Liver (-0.20, 0.78) -> Hepatic Vein -> Heart (1.32)
          y = 0.35 + u * 0.98;
          x = 0.18 * (1 - u) - 0.22 * Math.sin(u * Math.PI);
          z = 0.10;
        } else if (pathType === 3) {
          // Heart -> Left & Right Lungs (1.38)
          const side = i % 2 === 0 ? 1 : -1;
          x = side * Math.sin(u * Math.PI) * 0.34;
          y = 1.32 + Math.cos(u * Math.PI * 2) * 0.15;
          z = 0.08;
        } else {
          // Brachial / Arm circulation
          const side = i % 2 === 0 ? 1 : -1;
          x = side * (0.1 + u * 0.85);
          y = 1.65 - u * 1.15;
          z = 0.04;
        }

        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      posAttr.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.PharmacoBody3D = PharmacoBody3D;
