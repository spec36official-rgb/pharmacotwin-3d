/**
 * PharmacoTwin 3D — Main Application Controller (Overhauled v2.0)
 * - #1 Interactive Onboarding Screen with Live Plain-Language CrCl, Vd & t½ Explanations
 * - #2 2-Mode 3D Holographic Engine (Mode 1: 3D Dot-Matrix Human Anatomy | Mode 2: PBPK Vascular Pipe Circuit)
 *      + Space-Flight Camera Warp to Organs + In-Scene 3D AlphaFold Protein-Ligand Hologram (No face photo)
 * - #3 Fullscreen 3D Simulation Background + Selective Dark-Gray Glass Overlay Windows
 * - Bilingual UI Toggle (Default: English for Hackathon Submission | 1-Click Korean Translation)
 */

const AppState = {
  lang: "en", // "en" (default) | "ko"
  viewMode: "anatomy", // "anatomy" | "pipe_circuit"
  drugsCatalog: {},
  pgxLibrary: {},
  alphafoldEbiCache: {},
  curriculum: [],
  curriculumKo: [],
  selectedDrugKey: "acetaminophen",
  selectedRoute: "oral",
  doseMg: 2500,
  intervalHours: 24,
  numDoses: 1,
  selectedOrgan: "liver",
  simData: null,

  // Playback state
  isPlaying: true,
  currentStepIdx: 0,
  playbackSpeed: 1.0,
  lastFrameTime: 0,

  // 3D & Chart instances
  body3d: null,
  pkChart: null,
  chartMode: "pk", // 'pk' or 'tox'
  drugViewer3D: null,
  receptorViewer3D: null,
  currentPdbId: null,
  currentMolStyle: "cartoon",
};

const ORGAN_LABELS = {
  liver: "Liver (Hepatic Centrilobular Zone 3)",
  kidney: "Kidney (Renal Cortex S2/S3 Tubules)",
  heart: "Heart (Myocardium & hERG K+ Channel)",
  brain: "Brain / CNS (Blood-Brain Barrier)",
  lungs: "Lungs (Alveolar Type I/II & Clara Cells)",
  blood: "Blood / RBC (Erythrocyte & Bone Marrow)",
  ocular: "Ocular (Cornea, Retina & Optic Nerve)",
  gi: "GI Tract (Stomach & Small Intestine Lumen)",
};

const ORGAN_LABELS_KO = {
  liver: "간 (중심소엽 Zone 3 · CYP2E1 대사)",
  kidney: "신장 (근위세뇨관 S2/S3 · 사구체 여과)",
  heart: "심장 (심근세포 & hERG 칼륨 채널)",
  brain: "중추신경계 / 뇌 (혈뇌장벽 BBB)",
  lungs: "폐 / 호흡기 (폐포 I/II형 & 클라라 세포)",
  blood: "혈액 / 적혈구 (헤모글로빈 & 골수 조혈계)",
  ocular: "안구 / 망막 (각막 미세침착 & 시신경)",
  gi: "위장관 (위·소장 점막 흡수 루멘)",
};

const ORGAN_DEFAULT_PDB = {
  liver: {
    pdb: "AF-P05181-F1",
    rcsb: "1Z10",
    name: "CYP2E1 Monooxygenase (493 aa · AlphaFold DB v6)",
    uniprot: "P05181",
    afId: "AF-P05181-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/liver_P05181.pdb",
    residues: 493,
    plddt: 96.13,
    dg: -7.8,
  },
  kidney: {
    pdb: "AF-O15244-F1",
    rcsb: "2FYL",
    name: "SLC22A2 / OCT2 Renal Transporter (555 aa · AlphaFold DB v6)",
    uniprot: "O15244",
    afId: "AF-O15244-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/kidney_O15244.pdb",
    residues: 555,
    plddt: 83.03,
    dg: -6.9,
  },
  heart: {
    pdb: "AF-Q12809-F1",
    rcsb: "5VA1",
    name: "hERG / KCNH2 Cardiac K+ Channel (1159 aa · AlphaFold DB v6)",
    uniprot: "Q12809",
    afId: "AF-Q12809-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/heart_Q12809.pdb",
    residues: 1159,
    plddt: 62.75,
    dg: -9.1,
  },
  brain: {
    pdb: "AF-P14416-F1",
    rcsb: "6CM4",
    name: "DRD2 Dopamine D2 Receptor (443 aa · AlphaFold DB v6)",
    uniprot: "P14416",
    afId: "AF-P14416-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/brain_P14416.pdb",
    residues: 443,
    plddt: 72.45,
    dg: -8.9,
  },
  lungs: {
    pdb: "AF-P12821-F1",
    rcsb: "1O8A",
    name: "Pulmonary ACE Metalloprotease (1306 aa · AlphaFold DB v6)",
    uniprot: "P12821",
    afId: "AF-P12821-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/lungs_P12821.pdb",
    residues: 1306,
    plddt: 90.94,
    dg: -7.4,
  },
  blood: {
    pdb: "AF-P11413-F1",
    rcsb: "2BH9",
    name: "G6PD Dehydrogenase (515 aa · AlphaFold DB v6)",
    uniprot: "P11413",
    afId: "AF-P11413-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/blood_P11413.pdb",
    residues: 515,
    plddt: 94.40,
    dg: -7.9,
  },
  ocular: {
    pdb: "AF-P08100-F1",
    rcsb: "1U19",
    name: "Retinal Rhodopsin RHO (348 aa · AlphaFold DB v6)",
    uniprot: "P08100",
    afId: "AF-P08100-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/ocular_P08100.pdb",
    residues: 348,
    plddt: 88.74,
    dg: -7.2,
  },
  gi: {
    pdb: "AF-P08183-F1",
    rcsb: "3G5U",
    name: "Intestinal P-gp / ABCB1 Efflux Pump (1280 aa · AlphaFold DB v6)",
    uniprot: "P08183",
    afId: "AF-P08183-F1-v6",
    afPdbUrl: "/static/assets/alphafold_pdb/gi_P08183.pdb",
    residues: 1280,
    plddt: 84.59,
    dg: -6.8,
  },
};

const ORGAN_SHORT_KO = {
  liver: "🟤 간 (CYP2E1)",
  kidney: "🫘 신장 (S2/S3)",
  heart: "❤️ 심장 (hERG)",
  brain: "🧠 뇌 / 중추신경",
  lungs: "🫁 폐 / 호흡기",
  blood: "🩸 혈액 / 적혈구",
  ocular: "👁️ 안구 / 망막",
  gi: "🧪 위장관",
};

const ORGAN_SHORT_EN = {
  liver: "🟤 Liver (CYP2E1)",
  kidney: "🫘 Kidney (S2/S3)",
  heart: "❤️ Heart (hERG)",
  brain: "🧠 CNS / Brain",
  lungs: "🫁 Lungs",
  blood: "🩸 Blood / RBC",
  ocular: "👁️ Ocular / Retina",
  gi: "🧪 GI Tract",
};

// 3D Conformer SDF/XYZ fallback structures for instant rendering
const DRUG_3D_FALLBACK_SDF = {
  acetaminophen: `20
Acetaminophen 3D
  C  -1.8200   0.0400   0.0100
  C  -1.1200   1.2500   0.0200
  C   0.2700   1.2500   0.0200
  C   0.9700   0.0400   0.0100
  C   0.2700  -1.1700   0.0000
  C  -1.1200  -1.1700   0.0000
  O  -3.1800   0.0400   0.0100
  N   2.3900   0.0400   0.0100
  C   3.1800   1.1500   0.0200
  O   2.7200   2.2900   0.0300
  C   4.6700   0.9200   0.0200
  H  -1.6600   2.1900   0.0300
  H   0.8100   2.1900   0.0300
  H   0.8100  -2.1100  -0.0100
  H  -1.6600  -2.1100  -0.0100
  H  -3.5500  -0.8500   0.0100
  H   2.8400  -0.8600   0.0000
  H   5.1800   1.8800   0.0300
  H   4.9600   0.3600   0.9100
  H   4.9600   0.3600  -0.8700
`,
};

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize 3D Holographic Body & Vascular Pipe Scene
  AppState.body3d = new Body3DSimulator("body3d-canvas-container", (organKey) => {
    selectOrgan(organKey, true);
  });

  // 2. Initialize 3Dmol Viewers & Chart.js
  initMolecularViewers();
  initPkPdChart();

  // 3. Bind UI Events (Onboarding, Mode Switcher, Selective Overlays, Drug/Patient/PGx)
  bindOnboardingEvents();
  bindStageAndOverlayEvents();

  // 4. Calculate initial Onboarding Plain-Language metrics
  updateOnboardingPlainMetrics();

  // 5. Load Initial Catalog & Run First Simulation in Background
  await fetchInitialData();
  await runSimulation(true);

  // 6. Start 24-Hour Time-Lapse Animation Loop
  requestAnimationFrame(playbackLoop);
});

/**
 * ============================================================================
 * #1 ONBOARDING PAGE & PLAIN-LANGUAGE PK/PD EXPLANATION BUILDER
 * ============================================================================
 */
function bindOnboardingEvents() {
  const obInputs = [
    "ob-age", "ob-sex", "ob-weight", "ob-height",
    "ob-scr", "ob-hepatic", "ob-cyp2e1", "ob-herg",
  ];
  obInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => updateOnboardingPlainMetrics());
      el.addEventListener("change", () => updateOnboardingPlainMetrics());
    }
  });

  // Preset buttons in Onboarding
  const btnHealthy = document.getElementById("btn-ob-preset-healthy");
  if (btnHealthy) {
    btnHealthy.addEventListener("click", () => {
      document.getElementById("ob-age").value = 26;
      document.getElementById("ob-sex").value = "male";
      document.getElementById("ob-weight").value = 68;
      document.getElementById("ob-height").value = 174;
      document.getElementById("ob-scr").value = 0.95;
      document.getElementById("ob-hepatic").value = "1.0";
      document.getElementById("ob-cyp2e1").value = "normal";
      document.getElementById("ob-herg").value = "normal";
      updateOnboardingPlainMetrics();
    });
  }

  const btnRenal = document.getElementById("btn-ob-preset-renal");
  if (btnRenal) {
    btnRenal.addEventListener("click", () => {
      document.getElementById("ob-age").value = 68;
      document.getElementById("ob-sex").value = "female";
      document.getElementById("ob-weight").value = 54;
      document.getElementById("ob-height").value = 158;
      document.getElementById("ob-scr").value = 2.10;
      document.getElementById("ob-hepatic").value = "1.0";
      document.getElementById("ob-cyp2e1").value = "normal";
      document.getElementById("ob-herg").value = "normal";
      updateOnboardingPlainMetrics();
    });
  }

  const btnHighRisk = document.getElementById("btn-ob-preset-highrisk");
  if (btnHighRisk) {
    btnHighRisk.addEventListener("click", () => {
      document.getElementById("ob-age").value = 42;
      document.getElementById("ob-sex").value = "male";
      document.getElementById("ob-weight").value = 62;
      document.getElementById("ob-height").value = 170;
      document.getElementById("ob-scr").value = 1.35;
      document.getElementById("ob-hepatic").value = "0.65";
      document.getElementById("ob-cyp2e1").value = "ultrametabolizer";
      document.getElementById("ob-herg").value = "sensitive";
      updateOnboardingPlainMetrics();
    });
  }

  // Enter Lab / Skip Onboarding buttons
  const enterLab = async () => {
    syncOnboardingToMainForm();
    const obScreen = document.getElementById("onboarding-screen");
    if (obScreen) obScreen.classList.add("hidden");
    if (AppState.body3d) {
      setTimeout(() => AppState.body3d.onResize(), 60);
    }
    await runSimulation(true);
  };

  const btnEnterLab = document.getElementById("btn-enter-lab");
  if (btnEnterLab) btnEnterLab.addEventListener("click", enterLab);

  const btnSkipOb = document.getElementById("btn-ob-skip");
  if (btnSkipOb) btnSkipOb.addEventListener("click", enterLab);

  const btnOpenOb = document.getElementById("btn-open-onboarding");
  if (btnOpenOb) {
    btnOpenOb.addEventListener("click", () => {
      syncMainFormToOnboarding();
      updateOnboardingPlainMetrics();
      const obScreen = document.getElementById("onboarding-screen");
      if (obScreen) obScreen.classList.remove("hidden");
    });
  }

  // Language toggle inside Onboarding
  const btnObLang = document.getElementById("btn-ob-lang-toggle");
  if (btnObLang) {
    btnObLang.addEventListener("click", () => {
      setLanguage(AppState.lang === "en" ? "ko" : "en");
    });
  }
}

function syncOnboardingToMainForm() {
  const copyVal = (srcId, dstId) => {
    const s = document.getElementById(srcId);
    const d = document.getElementById(dstId);
    if (s && d) d.value = s.value;
  };
  copyVal("ob-age", "patient-age");
  copyVal("ob-sex", "patient-sex");
  copyVal("ob-weight", "patient-weight");
  copyVal("ob-height", "patient-height");
  copyVal("ob-scr", "patient-scr");
  copyVal("ob-hepatic", "hepatic-factor");
  copyVal("ob-cyp2e1", "pgx-cyp2e1");
  copyVal("ob-herg", "pgx-herg");
}

function syncMainFormToOnboarding() {
  const copyVal = (srcId, dstId) => {
    const s = document.getElementById(srcId);
    const d = document.getElementById(dstId);
    if (s && d) d.value = s.value;
  };
  copyVal("patient-age", "ob-age");
  copyVal("patient-sex", "ob-sex");
  copyVal("patient-weight", "ob-weight");
  copyVal("patient-height", "ob-height");
  copyVal("patient-scr", "ob-scr");
  copyVal("hepatic-factor", "ob-hepatic");
  copyVal("pgx-cyp2e1", "ob-cyp2e1");
  copyVal("pgx-herg", "ob-herg");
}

/**
 * Calculates live Cockcroft-Gault CrCl, Vd, and Half-Life in Onboarding
 * and explains them in crystal-clear non-expert language (EN & KO).
 */
function updateOnboardingPlainMetrics() {
  const age = parseFloat(document.getElementById("ob-age")?.value) || 26;
  const sex = document.getElementById("ob-sex")?.value || "male";
  const weight = parseFloat(document.getElementById("ob-weight")?.value) || 68;
  const scr = Math.max(0.4, parseFloat(document.getElementById("ob-scr")?.value) || 0.95);
  const hepatic = parseFloat(document.getElementById("ob-hepatic")?.value) || 1.0;
  const cyp2e1 = document.getElementById("ob-cyp2e1")?.value || "normal";
  const herg = document.getElementById("ob-herg")?.value || "normal";

  // 1. Cockcroft-Gault CrCl (mL/min)
  let crcl = ((140 - age) * weight) / (72 * scr);
  if (sex === "female") crcl *= 0.85;
  crcl = Math.max(8.0, Math.min(180.0, crcl));

  // 2. Volume of Distribution Vd (L) — using standard 0.95 L/kg reference (Acetaminophen)
  const vd = weight * (sex === "female" ? 0.88 : 0.95);

  // 3. Clearance & Half-Life (t½ = 0.693 * Vd / CL)
  const renalFactor = crcl / 100.0;
  const cl = 18.0 * (0.85 * hepatic + 0.15 * renalFactor);
  const thalf = (0.693 * vd) / Math.max(1.5, cl);

  // Genetic risk multiplier
  let pgxMult = 1.0;
  if (cyp2e1 === "ultrametabolizer") pgxMult *= 1.85;
  if (herg === "sensitive") pgxMult *= 1.90;

  // Update DOM numbers
  const crclValEl = document.getElementById("ob-crcl-val");
  const vdValEl = document.getElementById("ob-vd-val");
  const thalfValEl = document.getElementById("ob-thalf-val");
  if (crclValEl) crclValEl.textContent = crcl.toFixed(1);
  if (vdValEl) vdValEl.textContent = vd.toFixed(1);
  if (thalfValEl) thalfValEl.textContent = thalf.toFixed(1);

  // Progress bars
  const crclBar = document.getElementById("ob-crcl-bar");
  if (crclBar) {
    const pct = Math.min(100, Math.max(10, (crcl / 130) * 100));
    crclBar.style.width = `${pct}%`;
    crclBar.style.background = crcl < 60
      ? "linear-gradient(90deg,#ff4d6d,#ffb347)"
      : "linear-gradient(90deg,#00f2fe,#00f5a0)";
  }
  const vdBar = document.getElementById("ob-vd-bar");
  if (vdBar) {
    const pct = Math.min(100, Math.max(15, (vd / 110) * 100));
    vdBar.style.width = `${pct}%`;
  }
  const thalfBar = document.getElementById("ob-thalf-bar");
  if (thalfBar) {
    const pct = Math.min(100, Math.max(15, (thalf / 8.0) * 100));
    thalfBar.style.width = `${pct}%`;
  }

  // Plain-language explanations in EN or KO
  const crclDesc = document.getElementById("ob-crcl-desc");
  const vdDesc = document.getElementById("ob-vd-desc");
  const thalfDesc = document.getElementById("ob-thalf-desc");

  const isKo = AppState.lang === "ko";
  if (crclDesc) {
    const statusText = isKo
      ? (crcl >= 90 ? "정상 여과 속도(≥90 mL/min)" : crcl >= 60 ? "경도 신장 여과 감소(60~89)" : "⚠️ 신장 배설 저하 위험(<60 mL/min — 약물이 혈액에 오래 남음)")
      : (crcl >= 90 ? "Normal filtration (≥90 mL/min)" : crcl >= 60 ? "Mild filtration decline (60–89)" : "⚠️ Reduced renal clearance (<60 mL/min — drug stays trapped longer)");
    crclDesc.innerHTML = isKo
      ? `<b>쉬운 비유 (정수기 필터 속도):</b> 신장은 혈액 속 약물과 노폐물을 걸러내는 정수기입니다. 입력하신 연령(${age}세), 체중(${weight}kg), 혈중 크레아티닌(<code>SCr ${scr}</code>)으로 계산한 결과, 회원님의 신장은 <b>1분당 ${crcl.toFixed(1)} mL의 혈액</b>을 깨끗하게 걸러냅니다 (<b>${statusText}</b>).`
      : `<b>Easy Analogy (Water Purifier Speed):</b> Your kidneys act like a blood purifier. From your age (${age}y), weight (${weight}kg), and creatinine (<code>SCr ${scr}</code>), your kidneys clean <b>${crcl.toFixed(1)} mL of blood per minute</b> (<b>${statusText}</b>).`;
  }

  if (vdDesc) {
    vdDesc.innerHTML = isKo
      ? `<b>쉬운 비유 (체내 물탱크 크기):</b> 같은 약 한 알을 먹어도 체내 수분·지방 공간(물탱크)이 작으면 약물 농도가 훨씬 진해집니다. 현재 체중(${weight}kg) 기준 약물이 퍼지는 가상 공간 크기는 <b>${vd.toFixed(1)} 리터(L)</b>입니다.`
      : `<b>Easy Analogy (Body Fish-Tank Size):</b> Dropping the same pill into a smaller tank makes the water much more concentrated. Based on your ${weight}kg weight, the drug spreads across a <b>${vd.toFixed(1)} L virtual body tank</b>.`;
  }

  if (thalfDesc) {
    thalfDesc.innerHTML = isKo
      ? `<b>쉬운 비유 (약물 청소 시간 & 유전자 방패):</b> 간 대사 기능(<b>${Math.round(hepatic * 100)}%</b>)과 신장 여과 속도를 합산하면, 체내 약물 절반이 청소되는 데 <b>${thalf.toFixed(1)}시간</b>이 걸립니다. 유전형(PGx) 독성 민감도 배수는 <b>${pgxMult.toFixed(2)}배</b>입니다.`
      : `<b>Easy Analogy (Cleanup Time & Genetic Shield):</b> Combining your liver capacity (<b>${Math.round(hepatic * 100)}%</b>) and kidney speed, your body cleans up 50% of the drug every <b>${thalf.toFixed(1)} hours</b>. Your AlphaGenome PGx sensitivity multiplier is <b>${pgxMult.toFixed(2)}×</b>.`;
  }
}

/**
 * ============================================================================
 * #2 & #3 STAGE, 2-MODE SWITCHER & SELECTIVE OVERLAY WINDOWS
 * ============================================================================
 */
function bindStageAndOverlayEvents() {
  // 1. 2-Mode 3D Switcher (Mode 1: Anatomy Hologram | Mode 2: Vascular Pipe Circuit)
  const btnAnatomy = document.getElementById("btn-mode-anatomy");
  const btnPipe = document.getElementById("btn-mode-pipe");

  if (btnAnatomy && btnPipe) {
    btnAnatomy.addEventListener("click", () => {
      AppState.viewMode = "anatomy";
      btnAnatomy.classList.add("active");
      btnPipe.classList.remove("active");
      if (AppState.body3d) AppState.body3d.setViewMode("anatomy");
    });

    btnPipe.addEventListener("click", () => {
      AppState.viewMode = "pipe_circuit";
      btnPipe.classList.add("active");
      btnAnatomy.classList.remove("active");
      if (AppState.body3d) AppState.body3d.setViewMode("pipe_circuit");
    });
  }

  // 2. Camera Macro View Reset (Zoom Out from Space-Flight Organ View)
  const btnMacro = document.getElementById("btn-camera-macro");
  if (btnMacro) {
    btnMacro.addEventListener("click", () => {
      if (AppState.body3d) AppState.body3d.resetCameraMacroView();
    });
  }

  // 3. Close All Overlays -> Pure 3D Simulation View ("모두 닫으면 시뮬레이션 UI만 남음")
  const btnCloseAll = document.getElementById("btn-close-all-overlays");
  if (btnCloseAll) {
    btnCloseAll.addEventListener("click", () => {
      const leftWin = document.getElementById("ov-left-config");
      const rightWin = document.getElementById("ov-right-inspector");
      const bothClosed = leftWin?.classList.contains("closed") && rightWin?.classList.contains("closed");
      if (bothClosed) {
        // Re-open both if user clicks again while in pure 3D view
        leftWin?.classList.remove("closed");
        rightWin?.classList.remove("closed");
      } else {
        leftWin?.classList.add("closed");
        rightWin?.classList.add("closed");
      }
      updateQuickDockActiveState();
    });
  }

  // Individual Overlay Close Buttons (✕)
  document.querySelectorAll("[data-close-overlay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.closeOverlay;
      const win = document.getElementById(targetId);
      if (win) win.classList.add("closed");
      updateQuickDockActiveState();
    });
  });

  // Left Quick Dock Triggers (selectively pop open gray overlay window & tab)
  const dockDrug = document.getElementById("dock-btn-drug");
  if (dockDrug) {
    dockDrug.addEventListener("click", () => {
      openLeftOverlayTab("tab-drug");
    });
  }
  const dockPatient = document.getElementById("dock-btn-patient");
  if (dockPatient) {
    dockPatient.addEventListener("click", () => {
      openLeftOverlayTab("tab-patient");
    });
  }
  const dockOrgan = document.getElementById("dock-btn-organ");
  if (dockOrgan) {
    dockOrgan.addEventListener("click", () => {
      openRightOverlayTab("rtab-organ");
    });
  }
  const dockPkChart = document.getElementById("dock-btn-pkchart");
  if (dockPkChart) {
    dockPkChart.addEventListener("click", () => {
      openRightOverlayTab("rtab-pkpd");
    });
  }

  // Internal Sub-Tabs inside Left Overlay Window
  document.querySelectorAll("[data-left-tab]").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      openLeftOverlayTab(tabBtn.dataset.leftTab);
    });
  });

  // Internal Sub-Tabs inside Right Overlay Window
  document.querySelectorAll("[data-right-tab]").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      openRightOverlayTab(tabBtn.dataset.rightTab);
    });
  });

  // Bottom Organ Ribbon Pills (Click to Warp Camera + Open Organ Overlay)
  document.querySelectorAll("#organ-ribbon .organ-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const organ = pill.dataset.organ;
      if (organ) selectOrgan(organ, true);
    });
  });

  // Drug selector
  const drugSelect = document.getElementById("drug-select");
  if (drugSelect) {
    drugSelect.addEventListener("change", async (e) => {
      AppState.selectedDrugKey = e.target.value;
      const drug = AppState.drugsCatalog[AppState.selectedDrugKey];
      if (drug) {
        AppState.doseMg = drug.supratherapeutic_dose_mg || drug.therapeutic_dose_mg;
        const slider = document.getElementById("dose-slider");
        if (slider) {
          slider.max = Math.max(1000, Math.round(drug.toxic_dose_mg * 1.4));
          slider.min = Math.max(10, Math.round(drug.therapeutic_dose_mg * 0.2));
          slider.step = drug.therapeutic_dose_mg < 100 ? 5 : 50;
          slider.value = AppState.doseMg;
        }
        updateDoseLabel();
        updateDrugMetadataBadges(drug);
        loadDrug3DMolecule(AppState.selectedDrugKey, drug);
      }
      await runSimulation(true);
    });
  }

  // Administration Route Buttons
  document.querySelectorAll(".route-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".route-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.selectedRoute = btn.dataset.route;
      await runSimulation(true);
    });
  });

  // Dose Slider
  const doseSlider = document.getElementById("dose-slider");
  if (doseSlider) {
    doseSlider.addEventListener("input", (e) => {
      AppState.doseMg = parseFloat(e.target.value);
      updateDoseLabel();
    });
    doseSlider.addEventListener("change", async () => {
      await runSimulation(false);
    });
  }

  // Dose Preset Chips
  document.getElementById("btn-therapeutic-dose")?.addEventListener("click", async () => {
    const drug = AppState.drugsCatalog[AppState.selectedDrugKey];
    if (!drug) return;
    AppState.doseMg = drug.therapeutic_dose_mg;
    document.getElementById("dose-slider").value = AppState.doseMg;
    updateDoseLabel();
    await runSimulation(true);
  });

  document.getElementById("btn-supratherapeutic-dose")?.addEventListener("click", async () => {
    const drug = AppState.drugsCatalog[AppState.selectedDrugKey];
    if (!drug) return;
    AppState.doseMg = drug.supratherapeutic_dose_mg;
    document.getElementById("dose-slider").value = AppState.doseMg;
    updateDoseLabel();
    await runSimulation(true);
  });

  document.getElementById("btn-toxic-dose")?.addEventListener("click", async () => {
    const drug = AppState.drugsCatalog[AppState.selectedDrugKey];
    if (!drug) return;
    AppState.doseMg = drug.toxic_dose_mg;
    document.getElementById("dose-slider").value = AppState.doseMg;
    updateDoseLabel();
    await runSimulation(true);
  });

  // Regimen & Patient Physiology / PGx Inputs
  ["interval-select", "num-doses-select", "patient-age", "patient-sex", "patient-weight", "patient-height", "patient-scr", "hepatic-factor", "pgx-cyp2e1", "pgx-cyp3a4", "pgx-herg", "pgx-g6pd"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", async () => {
        AppState.intervalHours = parseFloat(document.getElementById("interval-select").value);
        AppState.numDoses = parseInt(document.getElementById("num-doses-select").value, 10);
        updatePgxSequenceInspector();
        await runSimulation(false);
      });
    }
  });

  // Main Administer Button
  document.getElementById("btn-administer")?.addEventListener("click", async () => {
    await runSimulation(true);
  });

  // Timeline Controls
  document.getElementById("btn-play-pause")?.addEventListener("click", () => {
    AppState.isPlaying = !AppState.isPlaying;
    document.getElementById("btn-play-pause").textContent = AppState.isPlaying ? "⏸" : "▶";
  });

  document.getElementById("btn-reset-time")?.addEventListener("click", () => {
    AppState.currentStepIdx = 0;
    updateTimeStepView(0);
    if (AppState.body3d) AppState.body3d.triggerAdministrationAnimation(AppState.selectedRoute);
  });

  document.getElementById("playback-speed")?.addEventListener("change", (e) => {
    AppState.playbackSpeed = parseFloat(e.target.value);
  });

  document.getElementById("time-scrubber")?.addEventListener("input", (e) => {
    AppState.isPlaying = false;
    document.getElementById("btn-play-pause").textContent = "▶";
    AppState.currentStepIdx = parseInt(e.target.value, 10);
    updateTimeStepView(AppState.currentStepIdx);
  });

  // Chart Mode Tabs
  document.querySelectorAll(".chart-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".chart-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      AppState.chartMode = tab.dataset.chartmode;
      updatePkPdChart();
    });
  });

  // 3Dmol Protein Style Buttons
  document.querySelectorAll(".style-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.currentMolStyle = btn.dataset.molstyle;
      applyReceptorStyle(AppState.currentMolStyle);
    });
  });

  // Gemini 4 Argon AI Consultation
  document.getElementById("btn-run-argon")?.addEventListener("click", async () => {
    await runArgonConsultation();
  });

  // Clinical Verification Gate
  const chkVerify = document.getElementById("chk-clinical-verify");
  const btnExport = document.getElementById("btn-export-report");
  if (chkVerify && btnExport) {
    chkVerify.addEventListener("change", (e) => {
      btnExport.disabled = !e.target.checked;
    });
    btnExport.addEventListener("click", () => {
      exportVerifiedProtocol();
    });
  }

  // Modals (AlphaFold 3 & Curriculum)
  document.getElementById("btn-alphafold-modal")?.addEventListener("click", () => {
    document.getElementById("modal-alphafold").classList.remove("hidden");
  });

  document.getElementById("btn-curriculum-modal")?.addEventListener("click", () => {
    document.getElementById("modal-curriculum").classList.remove("hidden");
  });

  document.querySelectorAll(".btn-close-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  // AlphaFold 3 Modal Quick Presets
  document.querySelectorAll(".smiles-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("af3-smiles").value = chip.dataset.smiles;
      document.getElementById("af3-drug-name").value = chip.dataset.name;
      document.getElementById("af3-dg").value = chip.dataset.dg;
      document.getElementById("af3-mw").value = chip.dataset.mw;
      document.getElementById("af3-logp").value = chip.dataset.logp;
    });
  });

  document.getElementById("btn-run-af3-sim")?.addEventListener("click", async () => {
    await runAlphaFold3Approximation();
  });

  // Top Bar Language Toggle
  document.getElementById("btn-lang-toggle")?.addEventListener("click", () => {
    setLanguage(AppState.lang === "en" ? "ko" : "en");
  });
}

function openLeftOverlayTab(tabId) {
  const leftWin = document.getElementById("ov-left-config");
  if (leftWin) leftWin.classList.remove("closed");

  document.querySelectorAll("[data-left-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.leftTab === tabId);
  });
  document.querySelectorAll(".left-tab-pane").forEach((pane) => {
    pane.classList.toggle("hidden", pane.id !== tabId);
  });

  if (tabId === "tab-drug" && AppState.drugViewer3D) {
    setTimeout(() => {
      AppState.drugViewer3D.resize();
      AppState.drugViewer3D.render();
    }, 60);
  }
  updateQuickDockActiveState();
}

function openRightOverlayTab(tabId) {
  const rightWin = document.getElementById("ov-right-inspector");
  if (rightWin) rightWin.classList.remove("closed");

  document.querySelectorAll("[data-right-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rightTab === tabId);
  });
  document.querySelectorAll(".right-tab-pane").forEach((pane) => {
    pane.classList.toggle("hidden", pane.id !== tabId);
  });

  if (tabId === "rtab-organ" && AppState.receptorViewer3D) {
    setTimeout(() => {
      AppState.receptorViewer3D.resize();
      AppState.receptorViewer3D.render();
    }, 60);
  } else if (tabId === "rtab-pkpd" && AppState.pkChart) {
    setTimeout(() => AppState.pkChart.resize(), 60);
  }
  updateQuickDockActiveState();
}

function updateQuickDockActiveState() {
  const leftOpen = !document.getElementById("ov-left-config")?.classList.contains("closed");
  const rightOpen = !document.getElementById("ov-right-inspector")?.classList.contains("closed");
  const activeLeftTab = document.querySelector("[data-left-tab].active")?.dataset.leftTab;
  const activeRightTab = document.querySelector("[data-right-tab].active")?.dataset.rightTab;

  document.getElementById("dock-btn-drug")?.classList.toggle("active-win", leftOpen && activeLeftTab === "tab-drug");
  document.getElementById("dock-btn-patient")?.classList.toggle("active-win", leftOpen && (activeLeftTab === "tab-patient" || activeLeftTab === "tab-pgx"));
  document.getElementById("dock-btn-organ")?.classList.toggle("active-win", rightOpen && activeRightTab === "rtab-organ");
  document.getElementById("dock-btn-pkchart")?.classList.toggle("active-win", rightOpen && (activeRightTab === "rtab-pkpd" || activeRightTab === "rtab-argon"));

  const btnCloseAll = document.getElementById("lbl-pure-3d");
  if (btnCloseAll) {
    const bothClosed = !leftOpen && !rightOpen;
    if (AppState.lang === "ko") {
      btnCloseAll.textContent = bothClosed ? "🪟 오버레이 설정창 다시 열기" : "👁️ 순수 3D 화면만 보기 (창 모두 닫기)";
    } else {
      btnCloseAll.textContent = bothClosed ? "🪟 Restore Overlay Windows" : "👁️ Pure 3D View (Close Windows)";
    }
  }
}

/**
 * ============================================================================
 * DATA FETCHING & SIMULATION API
 * ============================================================================
 */
async function fetchInitialData() {
  try {
    const [drugsRes, currRes, pgxRes] = await Promise.all([
      fetch("/api/drugs"),
      fetch("/api/curriculum"),
      fetch("/api/pgx-genotypes"),
    ]);
    const drugsJson = await drugsRes.json();
    const currJson = await currRes.json();
    const pgxJson = await pgxRes.json();

    AppState.drugsCatalog = drugsJson.drugs || {};
    AppState.curriculum = currJson.curriculum || [];
    AppState.curriculumKo = currJson.curriculum_ko || [];
    AppState.pgxLibrary = pgxJson.genotypes || {};

    renderCurriculumCards();
    updatePgxSequenceInspector();

    const initialDrug = AppState.drugsCatalog[AppState.selectedDrugKey];
    if (initialDrug) {
      updateDrugMetadataBadges(initialDrug);
      loadDrug3DMolecule(AppState.selectedDrugKey, initialDrug);
      loadReceptor3DPDB(initialDrug.primary_receptor_pdb, initialDrug.primary_target);
      fetchAndDisplayLiveAlphaFoldEbi(AppState.selectedOrgan);
    }
  } catch (err) {
    console.error("Error fetching initial catalog:", err);
  }
}

async function runSimulation(triggerAnim = true) {
  const payload = {
    drug_key: AppState.selectedDrugKey,
    route: AppState.selectedRoute,
    dose_mg: AppState.doseMg,
    interval_hours: AppState.intervalHours,
    num_doses: AppState.numDoses,
    duration_hours: 24.0,
    patient: {
      age: parseFloat(document.getElementById("patient-age").value) || 26,
      sex: document.getElementById("patient-sex").value,
      weight_kg: parseFloat(document.getElementById("patient-weight").value) || 68,
      height_cm: parseFloat(document.getElementById("patient-height").value) || 174,
      scr_mg_dl: parseFloat(document.getElementById("patient-scr").value) || 0.95,
      hepatic_function: parseFloat(document.getElementById("hepatic-factor").value) || 1.0,
      cyp2e1_genotype: document.getElementById("pgx-cyp2e1").value,
      cyp3a4_genotype: document.getElementById("pgx-cyp3a4").value,
      herg_genotype: document.getElementById("pgx-herg").value,
      g6pd_status: document.getElementById("pgx-g6pd").value,
    },
  };

  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    applySimulationResult(data, triggerAnim);
  } catch (err) {
    console.error("Simulation API error:", err);
  }
}

function applySimulationResult(data, triggerAnim = true) {
  AppState.simData = data;

  // Update Patient Derived PK Stats
  const p = data.patient_derived;
  document.getElementById("stat-crcl").textContent = `${p.crcl_ml_min} mL/min`;
  document.getElementById("stat-vd").textContent = `${p.vd_l} L`;
  document.getElementById("stat-cl").textContent = `${p.cl_l_h} L/h`;
  document.getElementById("stat-thalf").textContent = `${p.t_half_h} h`;

  // Update Top Bar Active Summary Pill
  const hudSum = document.getElementById("hud-active-summary");
  if (hudSum && data.drug) {
    hudSum.textContent = `${data.drug.name.split(" ")[0].toUpperCase()} · ${AppState.doseMg}mg ${AppState.selectedRoute.toUpperCase()} · CrCl ${p.crcl_ml_min} mL/min`;
  }

  // Plain-language insight box inside Left Patient Tab
  const plainBox = document.getElementById("patient-plain-explain");
  if (plainBox) {
    if (AppState.lang === "ko") {
      plainBox.innerHTML = `💡 <b>비전공자용 직관적 해석:</b> 현재 신장 여과 속도(CrCl)는 <b>${p.crcl_ml_min} mL/min</b>, 체내 약물 물탱크 크기(Vd)는 <b>${p.vd_l} L</b>, 반감기(t½)는 <b>${p.t_half_h}시간</b>입니다.`;
    } else {
      plainBox.innerHTML = `💡 <b>Plain-Language Insight:</b> Your kidneys filter <b>${p.crcl_ml_min} mL/min</b> of blood, your body drug tank (Vd) is <b>${p.vd_l} L</b>, and 50% of the drug is cleared every <b>${p.t_half_h} hours</b>.`;
    }
  }

  // Chart summary stats
  const ts = data.time_series;
  if (ts) {
    document.getElementById("chart-stat-cmax").textContent = `${ts.cmax_mg_l} mg/L`;
    document.getElementById("chart-stat-auc").textContent = `${ts.auc_mg_h_l} mg·h/L`;
  }

  // Overall Safety Pill
  const safetyPill = document.getElementById("overall-safety-pill");
  if (safetyPill) {
    safetyPill.textContent = data.overall_safety_status;
    safetyPill.style.color =
      data.overall_safety_status === "CRITICAL TOXICITY" ? "var(--accent-red)" :
      data.overall_safety_status === "CAUTION / ELEVATED" ? "var(--accent-amber)" : "var(--accent-emerald)";
  }

  // Update Bottom Organ Ribbon Risk Numbers
  renderBottomOrganRibbon();

  // Refresh Selected Organ Inspector & Chart
  updateSelectedOrganDetail(AppState.selectedOrgan);
  updatePkPdChart();

  if (triggerAnim && AppState.body3d) {
    AppState.currentStepIdx = 0;
    AppState.isPlaying = true;
    document.getElementById("btn-play-pause").textContent = "⏸";
    AppState.body3d.triggerAdministrationAnimation(AppState.selectedRoute);
  }

  updateTimeStepView(AppState.currentStepIdx);
}

/**
 * ============================================================================
 * ORGAN SELECTION, SPACE-FLIGHT CAMERA WARP & ALPHAFOLD 3D HOLOGRAM
 * ============================================================================
 */
function selectOrgan(organKey, warpCamera = true) {
  AppState.selectedOrgan = organKey;

  // Highlight in Bottom Organ Ribbon
  document.querySelectorAll("#organ-ribbon .organ-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.organ === organKey);
  });

  // Update Right Overlay Title & Content
  updateSelectedOrganDetail(organKey);

  // Open Right Overlay Window on Organ Selection so user immediately sees explanation & 3D receptor
  openRightOverlayTab("rtab-organ");

  // Trigger 3D Space-Flight Camera Warp + In-Scene 3D AlphaFold Protein Hologram
  if (AppState.body3d && warpCamera) {
    const recInfo = ORGAN_DEFAULT_PDB[organKey] || ORGAN_DEFAULT_PDB.liver;
    const peakRisk = AppState.simData?.organ_toxicity?.[organKey]?.peak_risk_pct || 0;
    AppState.body3d.warpToOrgan(
      organKey,
      `${recInfo.name} (${recInfo.pdb})`,
      AppState.lang
    );
    AppState.body3d.updateAlphaFoldTargetHologram(
      organKey,
      `${recInfo.pdb} · ${recInfo.name.split(" ")[0]}`,
      peakRisk
    );
  }
  if (AppState.body3d) {
    AppState.body3d.highlightOrgan(organKey);
  }
}

function updateSelectedOrganDetail(organKey) {
  if (!AppState.simData || !AppState.simData.organ_toxicity) return;
  const info = AppState.simData.organ_toxicity[organKey];
  if (!info) return;

  const isKo = AppState.lang === "ko";
  const organTitle = isKo ? (ORGAN_LABELS_KO[organKey] || organKey) : (ORGAN_LABELS[organKey] || organKey);
  const recInfo = ORGAN_DEFAULT_PDB[organKey] || ORGAN_DEFAULT_PDB.liver;

  const ovRightTitle = document.getElementById("ov-right-title");
  if (ovRightTitle) ovRightTitle.textContent = `${organTitle.split("(")[0].trim()} · ${recInfo.pdb}`;

  document.getElementById("detail-organ-name").textContent = organTitle;
  document.getElementById("detail-organ-biomarker").textContent = isKo
    ? `핵심 바이오마커: ${info.biomarker_ko || info.biomarker}`
    : `Biomarkers: ${info.biomarker}`;

  const badge = document.getElementById("detail-organ-risk-badge");
  const statusLabel = isKo
    ? (info.status === "DANGER" ? "위험 (독성 발현)" : info.status === "WARNING" ? "주의 (축적 상승)" : "안전 (정상 범위)")
    : info.status;
  badge.textContent = `${info.peak_risk_pct.toFixed(1)}% ${statusLabel}`;

  if (info.status === "DANGER") {
    badge.style.background = "rgba(255, 77, 109, 0.2)";
    badge.style.color = "#ff4d6d";
  } else if (info.status === "WARNING") {
    badge.style.background = "rgba(255, 179, 71, 0.2)";
    badge.style.color = "#ffb347";
  } else {
    badge.style.background = "rgba(0, 245, 160, 0.16)";
    badge.style.color = "#00f5a0";
  }

  document.getElementById("detail-organ-risk-bar").style.width = `${Math.min(100, info.peak_risk_pct)}%`;
  document.getElementById("detail-organ-cmax").textContent = `${info.peak_conc_mg_l} mg/L`;
  document.getElementById("detail-organ-thresh").textContent = `${info.tox_threshold_mg_l} mg/L`;
  document.getElementById("detail-organ-mechanism").textContent = isKo
    ? (info.mechanism_ko || info.mechanism)
    : info.mechanism;

  // Load Real AlphaFold DB 3D Receptor PDB in 3Dmol Viewer
  loadReceptor3DPDB(recInfo.pdb, recInfo.name, organKey);
  fetchAndDisplayLiveAlphaFoldEbi(organKey);
}

function renderBottomOrganRibbon() {
  if (!AppState.simData || !AppState.simData.organ_toxicity) return;
  const orgTox = AppState.simData.organ_toxicity;
  const isKo = AppState.lang === "ko";

  Object.keys(ORGAN_SHORT_EN).forEach((organKey) => {
    const pill = document.querySelector(`#organ-ribbon .organ-pill[data-organ="${organKey}"]`);
    if (!pill) return;
    const info = orgTox[organKey];
    const riskPct = info ? info.peak_risk_pct : 0;

    const labelSpan = pill.querySelector("span");
    const riskB = pill.querySelector(".risk-num");
    if (labelSpan) labelSpan.textContent = isKo ? ORGAN_SHORT_KO[organKey] : ORGAN_SHORT_EN[organKey];
    if (riskB) {
      riskB.textContent = `${riskPct.toFixed(0)}%`;
      riskB.style.color = riskPct >= 65 ? "var(--accent-red)" : riskPct >= 30 ? "var(--accent-amber)" : "var(--accent-emerald)";
    }
  });
}

/**
 * ============================================================================
 * 24-HOUR PLAYBACK LOOP & LIVE HUD UPDATES
 * ============================================================================
 */
function playbackLoop(timestamp) {
  if (!AppState.lastFrameTime) AppState.lastFrameTime = timestamp;
  const elapsed = timestamp - AppState.lastFrameTime;

  if (AppState.isPlaying && AppState.simData && elapsed > 85 / AppState.playbackSpeed) {
    AppState.lastFrameTime = timestamp;
    const totalSteps = AppState.simData.time_series.time_h.length;
    AppState.currentStepIdx = (AppState.currentStepIdx + 1) % totalSteps;
    updateTimeStepView(AppState.currentStepIdx);
  }

  requestAnimationFrame(playbackLoop);
}

function updateTimeStepView(stepIdx) {
  if (!AppState.simData || !AppState.simData.time_series) return;
  const ts = AppState.simData.time_series;
  const t = ts.time_h[stepIdx] || 0;
  const plasmaC = ts.plasma_conc_mg_l[stepIdx] || 0;
  const occupancy = ts.receptor_occupancy_pct[stepIdx] || 0;

  document.getElementById("time-scrubber").value = stepIdx;
  document.getElementById("time-current-label").textContent = `t = ${t.toFixed(1)} h`;
  document.getElementById("live-plasma-conc").textContent = `${plasmaC.toFixed(2)} mg/L`;
  document.getElementById("live-occupancy").textContent = `${occupancy.toFixed(1)}%`;

  // Phase status label
  const phaseLabel = document.getElementById("phase-status-label");
  const isKo = AppState.lang === "ko";
  if (t < 1.5) {
    phaseLabel.textContent = isKo ? "투여 및 초기 흡수 단계" : "Administration & Rapid Absorption";
  } else if (t < 6.0) {
    phaseLabel.textContent = isKo ? "전신 조직 분포 & 수용체 결합 단계" : "Systemic Distribution & Target Engagement";
  } else if (t < 14.0) {
    phaseLabel.textContent = isKo ? "간 대사 (CYP450) & 장기 축적 단계" : "Hepatic Biotransformation & Tissue Accumulation";
  } else {
    phaseLabel.textContent = isKo ? "신장 배설 (CrCl) & 후기 조직 잔류 단계" : "Renal Elimination & Late Tissue Clearance";
  }

  // Current step organ risk & conc snapshot
  const organRiskNow = {};
  const organConcNow = {};
  let maxRiskVal = -1;
  let maxRiskOrgan = "liver";

  Object.entries(AppState.simData.organ_toxicity).forEach(([organ, info]) => {
    const r = info.risk_series_pct[stepIdx] || 0;
    const c = info.conc_series_mg_l[stepIdx] || 0;
    organRiskNow[organ] = r;
    organConcNow[organ] = c;
    if (r > maxRiskVal) {
      maxRiskVal = r;
      maxRiskOrgan = organ;
    }
  });

  document.getElementById("live-peak-organ").textContent =
    maxRiskOrgan.charAt(0).toUpperCase() + maxRiskOrgan.slice(1);

  if (AppState.body3d) {
    const maxPlasma = Math.max(1.0, ts.cmax_mg_l);
    AppState.body3d.updateOrganStates(organRiskNow, organConcNow, plasmaC / maxPlasma);
  }
}

/**
 * ============================================================================
 * 3DMOL.JS MOLECULAR & ALPHAFOLD PDB VIEWERS + CHART.JS
 * ============================================================================
 */
function initMolecularViewers() {
  const drugContainer = document.getElementById("drug-mol-viewer");
  const recContainer = document.getElementById("receptor-pdb-viewer");

  if (window.$3Dmol && drugContainer) {
    AppState.drugViewer3D = $3Dmol.createViewer(drugContainer, {
      backgroundColor: "#040610",
    });
  }
  if (window.$3Dmol && recContainer) {
    AppState.receptorViewer3D = $3Dmol.createViewer(recContainer, {
      backgroundColor: "#040610",
    });
  }
}

async function loadDrug3DMolecule(drugKey, drugObj) {
  if (!AppState.drugViewer3D) return;
  const tagEl = document.getElementById("drug-mol-tag");
  const formulaEl = document.getElementById("mol-formula-label");
  if (formulaEl) formulaEl.textContent = drugObj.formula || "";
  if (tagEl) tagEl.textContent = `Loading ${drugObj.name.split(" ")[0]} 3D...`;

  AppState.drugViewer3D.clear();
  const cid = drugObj.pubchem_cid;

  if (cid) {
    try {
      const sdfUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
      const res = await fetch(sdfUrl);
      if (res.ok) {
        const sdfText = await res.text();
        AppState.drugViewer3D.addModel(sdfText, "sdf");
        AppState.drugViewer3D.setStyle({}, {
          stick: { radius: 0.18, colorscheme: "cyanCarbon" },
          sphere: { scale: 0.28, colorscheme: "cyanCarbon" },
        });
        AppState.drugViewer3D.zoomTo();
        AppState.drugViewer3D.render();
        AppState.drugViewer3D.spin("y", 0.6);
        if (tagEl) tagEl.textContent = `PubChem CID: ${cid} (3D Conformer)`;
        return;
      }
    } catch (e) {
      // Fallback below
    }
  }

  const xyz = DRUG_3D_FALLBACK_SDF.acetaminophen;
  AppState.drugViewer3D.addModel(xyz, "xyz");
  AppState.drugViewer3D.setStyle({}, {
    stick: { radius: 0.18, colorscheme: "cyanCarbon" },
    sphere: { scale: 0.28, colorscheme: "cyanCarbon" },
  });
  AppState.drugViewer3D.zoomTo();
  AppState.drugViewer3D.render();
  AppState.drugViewer3D.spin("y", 0.6);
  if (tagEl) tagEl.textContent = `${drugObj.name.split(" ")[0]} 3D Structure`;
}

async function loadReceptor3DPDB(pdbId, targetDescription, organKey = null) {
  if (!AppState.receptorViewer3D || !pdbId) return;
  const orgKey = organKey || AppState.selectedOrgan || "liver";
  const recInfo = ORGAN_DEFAULT_PDB[orgKey] || ORGAN_DEFAULT_PDB.liver;

  document.getElementById("receptor-pdb-badge").textContent = `${recInfo.pdb} (pLDDT ${recInfo.plddt})`;
  document.getElementById("receptor-caption").innerHTML = `<strong>AlphaFold DB v6:</strong> ${targetDescription}`;

  if (AppState.currentPdbId === recInfo.pdb) return;
  AppState.currentPdbId = recInfo.pdb;

  const tagEl = document.getElementById("receptor-overlay-tag");
  if (tagEl) tagEl.textContent = `Loading AlphaFold DB ${recInfo.pdb}...`;

  AppState.receptorViewer3D.clear();

  // 1. Load Real Local AlphaFold DB v6 .pdb Structure directly
  if (recInfo.afPdbUrl) {
    try {
      const res = await fetch(recInfo.afPdbUrl);
      if (res.ok) {
        const pdbText = await res.text();
        AppState.receptorViewer3D.addModel(pdbText, "pdb");
        applyReceptorStyle(AppState.currentMolStyle);
        AppState.receptorViewer3D.zoomTo();
        AppState.receptorViewer3D.render();
        AppState.receptorViewer3D.spin("y", 0.35);
        if (tagEl) {
          tagEl.textContent = `${recInfo.afId} · ${recInfo.residues} aa · pLDDT Colored`;
        }
        return;
      }
    } catch (e) {
      // Fallback to RCSB below if local fetch fails
    }
  }

  // 2. Fallback to RCSB PDB download
  const fallbackPdb = recInfo.rcsb || "1Z10";
  $3Dmol.download(`pdb:${fallbackPdb}`, AppState.receptorViewer3D, {}, () => {
    applyReceptorStyle(AppState.currentMolStyle);
    AppState.receptorViewer3D.zoomTo();
    AppState.receptorViewer3D.render();
    AppState.receptorViewer3D.spin("y", 0.35);
    if (tagEl) tagEl.textContent = `${fallbackPdb} · Interactive 3D Receptor`;
  });
}

function applyReceptorStyle(styleMode) {
  if (!AppState.receptorViewer3D) return;
  AppState.receptorViewer3D.removeAllSurfaces();
  AppState.receptorViewer3D.setStyle({}, {});

  // Official AlphaFold pLDDT confidence coloring from PDB B-factor (atom.b)
  const afPlddtColor = function (atom) {
    const b = atom.b || 0;
    if (b >= 90) return "#0053d6"; // Very high (pLDDT >= 90)
    if (b >= 70) return "#65cbf3"; // Confident (70 - 90)
    if (b >= 50) return "#ffdb13"; // Low (50 - 70)
    return "#ff7d45";              // Very low (< 50)
  };

  if (styleMode === "cartoon") {
    AppState.receptorViewer3D.setStyle({}, { cartoon: { colorfunc: afPlddtColor } });
    // Highlight catalytic pocket center residues (resi 180-210) as active binding site sticks
    AppState.receptorViewer3D.setStyle(
      { resi: ["180-205"] },
      {
        cartoon: { colorfunc: afPlddtColor },
        stick: { radius: 0.22, colorscheme: "greenCarbon" },
      }
    );
  } else if (styleMode === "surface") {
    AppState.receptorViewer3D.setStyle({}, { cartoon: { colorfunc: afPlddtColor, opacity: 0.7 } });
    AppState.receptorViewer3D.addSurface(
      $3Dmol.SurfaceType.VDW,
      { opacity: 0.52, color: "#38bdf8" },
      {}
    );
  } else if (styleMode === "stick") {
    AppState.receptorViewer3D.setStyle({}, { cartoon: { colorfunc: afPlddtColor, opacity: 0.28 } });
    AppState.receptorViewer3D.setStyle(
      { resi: ["165-225"] },
      {
        stick: { radius: 0.28, colorscheme: "magentaCarbon" },
        sphere: { scale: 0.32, colorscheme: "magentaCarbon" },
      }
    );
  }
  AppState.receptorViewer3D.render();
}

async function fetchAndDisplayLiveAlphaFoldEbi(organKey) {
  const recInfo = ORGAN_DEFAULT_PDB[organKey] || ORGAN_DEFAULT_PDB.liver;
  const idEl = document.getElementById("af-ebi-id");
  const plddtEl = document.getElementById("af-ebi-plddt");
  if (idEl) idEl.textContent = recInfo.afId;
  if (plddtEl) plddtEl.textContent = `pLDDT: ${recInfo.plddt} · ΔG: ${recInfo.dg} kcal/mol`;

  const uniprot = recInfo.uniprot;
  if (!uniprot) return;
  try {
    if (!AppState.alphafoldEbiCache[uniprot]) {
      const res = await fetch(`/api/alphafold-db/${uniprot}`);
      if (res.ok) {
        AppState.alphafoldEbiCache[uniprot] = await res.json();
      }
    }
    const meta = AppState.alphafoldEbiCache[uniprot];
    if (meta && meta.entry_id) {
      if (idEl) idEl.textContent = `${meta.entry_id} (${meta.uniprot_accession})`;
      if (plddtEl) plddtEl.textContent = `Live EBI pLDDT: ${meta.global_plddt || recInfo.plddt} · ΔG: ${recInfo.dg} kcal/mol`;
    }
  } catch (e) {
    // Keep default fallback values
  }
}

function initPkPdChart() {
  const ctx = document.getElementById("pkpd-chart");
  if (!ctx || !window.Chart) return;

  AppState.pkChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#9db4d0", font: { size: 10, family: "'JetBrains Mono', monospace" }, boxWidth: 10 },
        },
      },
      scales: {
        x: {
          ticks: { color: "#58708c", maxTicksLimit: 9, font: { size: 9 } },
          grid: { color: "rgba(30, 45, 74, 0.3)" },
        },
        y: {
          ticks: { color: "#9db4d0", font: { size: 9 } },
          grid: { color: "rgba(30, 45, 74, 0.3)" },
          beginAtZero: true,
        },
      },
    },
  });
}

function updatePkPdChart() {
  if (!AppState.pkChart || !AppState.simData) return;
  const ts = AppState.simData.time_series;
  const orgTox = AppState.simData.organ_toxicity;
  const labels = ts.time_h.map((t) => `${t.toFixed(1)}h`);
  const selOrgan = AppState.selectedOrgan;
  const selOrganInfo = orgTox[selOrgan];

  if (AppState.chartMode === "pk") {
    AppState.pkChart.data.labels = labels;
    AppState.pkChart.data.datasets = [
      {
        label: "Plasma C(t) (mg/L)",
        data: ts.plasma_conc_mg_l,
        borderColor: "#00f2fe",
        backgroundColor: "rgba(0, 242, 254, 0.12)",
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: `${selOrgan.toUpperCase()} Conc (mg/L)`,
        data: selOrganInfo ? selOrganInfo.conc_series_mg_l : [],
        borderColor: "#c77dff",
        borderWidth: 2,
        borderDash: [4, 2],
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: "Effect Site Ce(t) (mg/L)",
        data: ts.effect_site_conc_mg_l,
        borderColor: "#00f5a0",
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
    ];
  } else {
    AppState.pkChart.data.labels = labels;
    AppState.pkChart.data.datasets = [
      {
        label: "Liver Risk (%)",
        data: orgTox.liver?.risk_series_pct || [],
        borderColor: "#ff6b6b",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: "Kidney Risk (%)",
        data: orgTox.kidney?.risk_series_pct || [],
        borderColor: "#ffb347",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: "Heart Risk (%)",
        data: orgTox.heart?.risk_series_pct || [],
        borderColor: "#c77dff",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: "Target Occupancy (%)",
        data: ts.receptor_occupancy_pct,
        borderColor: "#00f2fe",
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.3,
      },
    ];
  }
  AppState.pkChart.update();
}

/**
 * ============================================================================
 * HELPERS: PGX INSPECTOR, ALPHAFOLD 3 CO-FOLD, ARGON AI & BILINGUAL TOGGLE
 * ============================================================================
 */
function updateDoseLabel() {
  const lbl = document.getElementById("dose-val-label");
  if (lbl) lbl.textContent = `${AppState.doseMg} mg`;
}

function updateDrugMetadataBadges(drug) {
  const container = document.getElementById("drug-meta-badges");
  if (!container) return;
  container.innerHTML = `
    <span class="meta-badge">MW: ${drug.mw} g/mol</span>
    <span class="meta-badge">f_u: ${drug.fu}</span>
    <span class="meta-badge">PDB: ${drug.primary_receptor_pdb}</span>
  `;
}

function updatePgxSequenceInspector() {
  const box = document.getElementById("pgx-sequence-detail");
  if (!box || !AppState.pgxLibrary) return;

  const cyp2e1Val = document.getElementById("pgx-cyp2e1")?.value || "normal";
  const cyp3a4Val = document.getElementById("pgx-cyp3a4")?.value || "normal";
  const hergVal = document.getElementById("pgx-herg")?.value || "normal";
  const g6pdVal = document.getElementById("pgx-g6pd")?.value || "normal";

  const cyp2e1Obj = AppState.pgxLibrary.cyp2e1?.alleles?.[cyp2e1Val];
  const hergObj = AppState.pgxLibrary.herg?.alleles?.[hergVal];
  const g6pdObj = AppState.pgxLibrary.g6pd?.alleles?.[g6pdVal];

  const lines = [];
  if (cyp2e1Obj) {
    lines.push(`<div><b style="color:#00f2fe;">CYP2E1 (${cyp2e1Obj.allele_label}):</b> <code>${cyp2e1Obj.dna_sequence_5to3}</code> → Act: <b>${cyp2e1Obj.activity_multiplier}×</b></div>`);
  }
  if (hergObj) {
    lines.push(`<div><b style="color:#c77dff;">KCNH2/hERG (${hergObj.allele_label}):</b> <code>${hergObj.dna_sequence_5to3}</code> → Risk: <b>${hergObj.sensitivity_multiplier}×</b></div>`);
  }
  if (g6pdObj) {
    lines.push(`<div><b style="color:#00f5a0;">G6PD (${g6pdObj.allele_label}):</b> <code>${g6pdObj.dna_sequence_5to3}</code> → Hemolysis: <b>${g6pdObj.hemolysis_multiplier}×</b></div>`);
  }
  if (lines.length > 0) box.innerHTML = lines.join("");
}

async function runAlphaFold3Approximation() {
  const btn = document.getElementById("btn-run-af3-sim");
  const origText = btn.textContent;
  btn.textContent = "⏳ Running AlphaFold 3 Thermodynamic Approximation...";
  btn.disabled = true;

  const payload = {
    drug_name: document.getElementById("af3-drug-name").value,
    smiles_or_formula: document.getElementById("af3-smiles").value,
    mw: parseFloat(document.getElementById("af3-mw").value) || 385,
    logP: parseFloat(document.getElementById("af3-logp").value) || 3.8,
    polar_surface_area: 68.0,
    alphafold_delta_g_kcal_mol: parseFloat(document.getElementById("af3-dg").value) || -9.5,
    alphafold_plddt: parseFloat(document.getElementById("af3-plddt").value) || 91.0,
    target_receptor: document.getElementById("af3-target-select").value,
    route: AppState.selectedRoute,
    dose_mg: AppState.doseMg,
    patient: {
      age: parseFloat(document.getElementById("patient-age").value) || 26,
      sex: document.getElementById("patient-sex").value,
      weight_kg: parseFloat(document.getElementById("patient-weight").value) || 68,
      height_cm: parseFloat(document.getElementById("patient-height").value) || 174,
      scr_mg_dl: parseFloat(document.getElementById("patient-scr").value) || 0.95,
      hepatic_function: parseFloat(document.getElementById("hepatic-factor").value) || 1.0,
      cyp2e1_genotype: document.getElementById("pgx-cyp2e1").value,
      cyp3a4_genotype: document.getElementById("pgx-cyp3a4").value,
      herg_genotype: document.getElementById("pgx-herg").value,
      g6pd_status: document.getElementById("pgx-g6pd").value,
    },
  };

  try {
    const res = await fetch("/api/alphafold-approximate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    document.getElementById("modal-alphafold").classList.add("hidden");
    applySimulationResult(data, true);
  } catch (err) {
    console.error("AlphaFold 3 approximation failed:", err);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function runArgonConsultation() {
  if (!AppState.simData) return;
  const btn = document.getElementById("btn-run-argon");
  const box = document.getElementById("argon-output-box");
  btn.disabled = true;
  btn.textContent = "⏳ Thinking (Argon)...";
  box.innerHTML = `<div class="argon-placeholder">🧠 Invoking <strong>gemini-4-argon</strong> Interactions API (thinking_level="high") with 7-Week Toxicology Curriculum & AlphaFold 3 context...</div>`;

  try {
    const res = await fetch("/api/argon-consult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        simulation_summary: AppState.simData,
        language: AppState.lang,
      }),
    });
    const data = await res.json();
    const formatted = formatSimpleMarkdown(data.analysis_markdown || "No response received.");
    box.innerHTML = `
      <div style="font-size:0.65rem;color:#c77dff;margin-bottom:6px;font-family:var(--font-mono);">
        Model: ${data.model} | Mode: ${data.mode}
      </div>
      <div>${formatted}</div>
    `;
  } catch (e) {
    box.innerHTML = `<div class="argon-placeholder" style="color:#ff4d6d;">Error contacting Gemini 4 Argon endpoint.</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = AppState.lang === "ko" ? `✨ <span>Argon AI 심층 자문</span>` : `✨ <span>Consult Argon AI</span>`;
  }
}

function formatSimpleMarkdown(md) {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    .replace(/^\- (.*$)/gim, "• $1<br/>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

function renderCurriculumCards() {
  const container = document.getElementById("curriculum-cards-container");
  if (!container) return;
  const list = AppState.lang === "ko" && AppState.curriculumKo.length
    ? AppState.curriculumKo
    : AppState.curriculum;

  container.innerHTML = list
    .map(
      (c) => `
    <div class="curr-card">
      <span class="curr-week">${c.week} · ${c.file}</span>
      <h4>${c.title}</h4>
      <ul>
        ${(c.core_concepts || []).map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
  `
    )
    .join("");
}

function exportVerifiedProtocol() {
  if (!AppState.simData) return;
  const exportPayload = {
    platform: "PharmacoTwin 3D — Gemini 4 Argon & AlphaFold 3 Simulator",
    verified_by_researcher: true,
    verified_timestamp: new Date().toISOString(),
    simulation_result: AppState.simData,
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pharmacotwin_verified_${AppState.selectedDrugKey}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ============================================================================
 * BILINGUAL UI SWITCHER (EN <-> KO)
 * ============================================================================
 */
function setLanguage(lang) {
  AppState.lang = lang;
  const isKo = lang === "ko";

  // Toggle buttons text
  const btnLang = document.getElementById("btn-lang-toggle");
  const btnObLang = document.getElementById("btn-ob-lang-toggle");
  const labelText = isKo ? "🇰🇷 한국어 모드 (🌐 Switch to EN)" : "🌐 EN | 🇰🇷 한국어 번역 보기";
  if (btnLang) {
    btnLang.textContent = labelText;
    btnLang.classList.toggle("active-ko", isKo);
  }
  if (btnObLang) {
    btnObLang.textContent = labelText;
    btnObLang.classList.toggle("active-ko", isKo);
  }

  // Onboarding translations
  const setTxt = (id, en, ko) => {
    const el = document.getElementById(id);
    if (el) el.textContent = isKo ? ko : en;
  };
  const setHtml = (id, en, ko) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = isKo ? ko : en;
  };

  setTxt("ob-skip-label", "⚡ Skip to 3D Lab →", "⚡ 바로 3D 시뮬레이션 연구실 입장 →");
  setTxt(
    "ob-hero-title",
    "Why Do Safe Drugs Cause Unexpected Organ Toxicity in Real Patients?",
    "왜 같은 약을 먹어도 사람마다 체내 약물 이동과 장기 독성이 다를까요?"
  );
  setHtml(
    "ob-hero-desc",
    `Standard drug dosing assumes an "average textbook human." In reality, your kidney filtration speed (<b>CrCl</b>), body distribution volume (<b>Vd</b>), and genetic enzyme variants (<b>CYP450 / hERG / G6PD</b>) dramatically alter how fast a drug builds up and where it triggers molecular toxicity. Build your personalized <b>Human Digital Twin</b> below and travel inside your organs in 3D.`,
    `표준 약물 용량은 '교과서적인 평균 성인'을 가정합니다. 하지만 실제로는 개인의 신장 혈액 여과 속도(<b>CrCl</b>), 약물이 퍼지는 체내 물탱크 크기(<b>Vd</b>), 그리고 유전자 변이(<b>CYP450 / hERG / G6PD</b>)에 따라 특정 장기에 약물이 치명적으로 축적될 수 있습니다. 아래에서 <b>나만의 휴먼 디지털 트윈</b>을 만들고 3D 우주 여행처럼 장기 내부와 단백질 타겟을 탐험해 보세요.`
  );

  setTxt("ob-p1-title", "Static Prescriptions Ignore Dynamic Organ Accumulation", "혈액 농도만으로는 장기 내부의 축적을 알 수 없습니다");
  setTxt("ob-p1-desc", "Even when blood concentrations look safe, lipophilic or actively transported drugs can accumulate 3×–10× higher inside the liver, kidney cortex, heart, or retina over 24 hours.", "혈중 농도가 안전해 보여도 지용성이거나 능동수송되는 약물은 24시간 동안 간, 신장 피질, 심장, 망막 내부에 3~10배 이상 높게 농축될 수 있습니다.");

  setTxt("ob-p2-title", "Unseen Protein-Drug Collisions (AlphaFold 3 Scale)", "장기 독성의 시작점: 단백질 타겟과 약물의 3D 충돌 (AlphaFold 3)");
  setHtml("ob-p2-desc", "Organ injury begins when drug molecules or reactive metabolites bind off-target receptors (like <b>hERG K+ channels</b> in the heart or <b>CYP2E1</b> in liver cells). We bridge 3D protein structures directly into differential equations.", "독성은 약물 분자나 반응성 대사물(NAPQI 등)이 심장 <b>hERG 채널</b>이나 간 <b>CYP2E1</b> 같은 표적 단백질 포켓에 결합할 때 시작됩니다. AlphaFold 3 구조 에너지를 PK/PD 미분방정식에 직접 연결했습니다.");

  setTxt("ob-p3-title", "Single DNA Letter Changes Shift Toxicity Thresholds", "단 하나의 유전자(SNP) 차이가 해독 속도를 바꿉니다 (AlphaGenome)");
  setHtml("ob-p3-desc", "A single SNP in <b>CYP2E1</b>, <b>CYP3A4</b>, or <b>G6PD</b> can double toxic metabolite formation or halve clearance. AlphaGenome regulatory multipliers personalize your digital twin before a single pill is taken.", "<b>CYP2E1</b>, <b>CYP3A4</b>, <b>G6PD</b> 유전자의 단일염기다형성(SNP) 하나가 독성 대사물 생성을 2배로 늘리거나 배설을 절반으로 줄입니다. 투약 전 인실리코로 먼저 예측합니다.");

  setTxt("ob-form-title", "STEP 1 · Build Your Human Digital Twin Profile", "STEP 1 · 휴먼 디지털 트윈 프로필 하나씩 입력하기");
  setTxt("ob-derived-title", "STEP 2 · What Your Body Numbers Mean (Plain-Language Guide)", "STEP 2 · 내 신체로부터 계산된 핵심 약동학 지표 (비전공자용 쉬운 설명)");
  setTxt("ob-cta-title", "Ready to Enter the 3D Holographic Simulation Lab?", "진정한 인실리코(In-Silico) 3D 실험실로 입장할 준비가 되셨나요?");
  setTxt("ob-cta-sub", "Explore 2 3D modes (Human Dot-Matrix Hologram & PBPK Vascular Pipe Circuit), click any organ to warp inside its AlphaFold 3 target receptor, or close all windows for a pure 3D experience.", "2가지 3D 모드(인체 홀로그램 & 혈관 파이프 순환 모드)를 전환하고, 원하는 장기를 클릭해 우주 여행하듯 줌인하여 AlphaFold 3 단백질 타겟을 관찰하세요.");
  setTxt("btn-enter-lab-text", "🚀 Launch 3D In-Silico Simulation Lab", "🚀 3D 인실리코 시뮬레이션 연구실 입장하기");

  // Main HUD & Overlay Window Titles
  setTxt("lbl-btn-onboarding", "👤 Human Twin Profile", "👤 온보딩 / 휴먼 프로필");
  setTxt("lbl-mode-anatomy", "🧍 Mode 1: 3D Human Hologram", "🧍 모드 1: 3D 인체 도트 홀로그램");
  setTxt("lbl-mode-pipe", "🔀 Mode 2: Vascular Pipe Circuit", "🔀 모드 2: 혈류 파이프 & 장기 순환 구조");
  setTxt("lbl-camera-macro", "🔭 Full-Body Macro View", "🔭 전신 뷰로 줌아웃");
  setTxt("lbl-btn-af3", "🧬 Phase 2: AlphaFold 3 Co-Fold", "🧬 Phase 2: AlphaFold 3 신약 예측");
  setTxt("lbl-btn-curriculum", "📚 Tox Lectures", "📚 독성학 강의록");

  setTxt("lbl-dock-drug", "💊 Drug, Route & Regimen Settings", "💊 투여 약물 · 경로 · 용량 설정창");
  setTxt("lbl-dock-patient", "🧬 Patient CrCl & AlphaGenome PGx", "🧬 환자 신체(CrCl) & 유전체 설정창");
  setTxt("lbl-dock-organ", "🔬 Organ & AlphaFold 3 Target Inspector", "🔬 선택 장기 & AlphaFold 3 단백질 창");
  setTxt("lbl-dock-pkchart", "📈 PK/PD Curves & Gemini 4 Argon AI", "📈 시간별 농도 그래프 & Argon AI 창");

  setTxt("ov-left-title", "Drug Regimen & Human Twin Parameters", "투여 약물 및 휴먼 디지털 트윈 설정");
  setTxt("btn-ltab-drug", "💊 Drug & Route", "💊 약물 & 투여경로");
  setTxt("btn-ltab-patient", "🧍 Physiology (CrCl/Vd)", "🧍 신체 지표 (CrCl/Vd)");
  setTxt("btn-ltab-pgx", "🧬 AlphaGenome PGx", "🧬 유전체 (PGx)");

  setTxt("btn-rtab-organ", "🔬 Organ & AlphaFold 3D", "🔬 장기 독성 & AlphaFold 3D");
  setTxt("btn-rtab-pkpd", "📈 PK/PD Time Curves", "📈 시간축 PK/PD 그래프");
  setTxt("btn-rtab-argon", "🧠 Gemini 4 Argon AI", "🧠 Gemini 4 Argon 자문");

  setTxt("lbl-btn-administer", "Administer Dose & Launch 3D Simulation", "약물 투여 애니메이션 및 3D 시뮬레이션 실행");

  updateOnboardingPlainMetrics();
  updateQuickDockActiveState();
  renderBottomOrganRibbon();
  renderCurriculumCards();
  if (AppState.simData) {
    applySimulationResult(AppState.simData, false);
  }
}
