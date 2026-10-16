/**
 * PharmacoTwin 3D — Main Frontend Controller
 * Orchestrates Three.js 3D Body, 3Dmol.js Receptor Pocket Viewer, Chart.js PK/PD Curves,
 * Phase 2 AlphaFold 3 Novel Drug Approximator, Phase 3 PGx, and Verification Loop.
 */

const AppState = {
  presetDrugs: [],
  novelSamples: [],
  curriculumText: "",
  currentDrugId: "acetaminophen",
  currentRoute: "oral",
  simResponse: null,
  selectedOrgan: "liver",
  timeIndex: 0,
  isPlaying: false,
  playTimer: null,
  body3d: null,
  molViewer: null,
  pkChart: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize 3D Human Digital Twin
  AppState.body3d = new PharmacoBody3D("body3d-canvas-container", (organKey) => {
    selectOrganCard(organKey);
  });

  // 2. Initialize 3Dmol.js Viewer
  initMol3DViewer();

  // 3. Bind UI Events
  bindUIControls();

  // 4. Load Drug Catalog & Run Initial Simulation
  await loadDrugsCatalog();
  await runSimulation(false);
});

function initMol3DViewer() {
  const el = document.getElementById("mol3d-container");
  if (!el || typeof $3Dmol === "undefined") return;
  AppState.molViewer = $3Dmol.createViewer(el, {
    backgroundColor: "#050811",
    antialias: true,
  });
}

function renderReceptorPocket3D(structure3d) {
  if (!AppState.molViewer || !structure3d || !structure3d.pdb_block) return;
  const v = AppState.molViewer;
  v.clear();
  v.addModel(structure3d.pdb_block, "pdb");

  // Style receptor chain A as translucent cyan/indigo sticks + surface
  v.setStyle({ chain: "A" }, {
    stick: { radius: 0.16, colorscheme: "cyanCarbon" },
    sphere: { scale: 0.24, colorscheme: "cyanCarbon" },
  });

  // Style co-folded ligand chain L as bright glowing spheres + sticks
  v.setStyle({ hetflag: true }, {
    stick: { radius: 0.26, colorscheme: "greenCarbon" },
    sphere: { scale: 0.36, colorscheme: "greenCarbon" },
  });

  // Add residue labels for key binding pocket residues
  const contacts = structure3d.pocket_contacts || [];
  contacts.slice(0, 4).forEach((c) => {
    const resNumMatch = (c.residue || "").match(/(\d+)/);
    if (resNumMatch) {
      const resi = parseInt(resNumMatch[1], 10);
      v.addResLabels({ chain: "A", resi }, {
        font: "JetBrains Mono",
        fontSize: 10,
        fontColor: "#e2e8f0",
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backgroundOpacity: 0.75,
      });
    }
  });

  v.zoomTo();
  v.render();
}

async function loadDrugsCatalog() {
  try {
    const res = await fetch("/api/drugs");
    const data = await res.json();
    AppState.presetDrugs = data.preset_drugs || [];
    AppState.novelSamples = data.novel_drug_samples || [];
    AppState.curriculumText = data.curriculum_context || "";

    const sel = document.getElementById("drug-select");
    sel.innerHTML = "";
    AppState.presetDrugs.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${d.name} — ${d.korean_name}`;
      sel.appendChild(opt);
    });

    // Populate Phase 2 AlphaFold 3 sample pills
    const sampleContainer = document.getElementById("af3-sample-pills");
    if (sampleContainer) {
      sampleContainer.innerHTML = "";
      AppState.novelSamples.forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-hud-mini";
        btn.textContent = `${s.name.split("(")[0].trim()} (${s.primary_organ.toUpperCase()})`;
        btn.onclick = () => {
          document.getElementById("af3-mol-name").value = s.name;
          document.getElementById("af3-smiles").value = s.smiles;
        };
        sampleContainer.appendChild(btn);
      });
    }

    const preText = document.getElementById("curriculum-pre");
    if (preText) preText.textContent = AppState.curriculumText.trim();

    applyDrugDefaults("acetaminophen");
  } catch (err) {
    console.error("Failed to load drug catalog:", err);
  }
}

function applyDrugDefaults(drugId) {
  const d = AppState.presetDrugs.find((x) => x.id === drugId);
  if (!d) return;
  AppState.currentDrugId = d.id;
  document.getElementById("dose-input").value = d.recommended_dose_mg;
  setRouteTab(d.default_route || "oral");
}

function setRouteTab(route) {
  AppState.currentRoute = route;
  document.querySelectorAll(".route-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
}

function readPatientProfileFromUI() {
  return {
    name: "Pharmacy Researcher (Digital Twin)",
    age: parseInt(document.getElementById("pat-age").value, 10) || 24,
    sex: document.getElementById("pat-sex").value || "M",
    weight_kg: parseFloat(document.getElementById("pat-weight").value) || 68.0,
    height_cm: parseFloat(document.getElementById("pat-height").value) || 175.0,
    serum_creatinine_mg_dl: parseFloat(document.getElementById("pat-scr").value) || 0.95,
    hepatic_function: document.getElementById("pat-hepatic").value || "normal",
    albumin_g_dl: 4.2,
    cyp2e1_phenotype: document.getElementById("pgx-cyp2e1").value || "normal",
    cyp3a4_phenotype: document.getElementById("pgx-cyp3a4").value || "normal",
    kcnh2_herg_variant: document.getElementById("pgx-herg").value || "wildtype",
    g6pd_status: document.getElementById("pgx-g6pd").value || "normal",
  };
}

async function runSimulation(useToxicDemoDose = false) {
  const d = AppState.presetDrugs.find((x) => x.id === AppState.currentDrugId);
  if (useToxicDemoDose && d) {
    document.getElementById("dose-input").value = d.toxic_demo_dose_mg;
  }

  const doseMg = parseFloat(document.getElementById("dose-input").value) || 500.0;
  const intervalH = parseFloat(document.getElementById("interval-input").value) || 8.0;
  const numDoses = parseInt(document.getElementById("numdoses-input").value, 10) || 2;
  const patient = readPatientProfileFromUI();

  setLoadingState(true);
  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drug_id: AppState.currentDrugId,
        route: AppState.currentRoute,
        dose_mg: doseMg,
        infusion_duration_h: 1.0,
        interval_h: intervalH,
        num_doses: numDoses,
        duration_h: 24.0,
        thinking_level: "medium",
        patient,
      }),
    });
    const payload = await res.json();
    applySimulationPayload(payload);
  } catch (err) {
    console.error("Simulation error:", err);
  } finally {
    setLoadingState(false);
  }
}

async function runAF3NovelApproximation() {
  const molName = document.getElementById("af3-mol-name").value || "Cisplatin";
  const smiles = document.getElementById("af3-smiles").value || "N.N.Cl[Pt]Cl";
  const route = document.getElementById("af3-route").value || "iv_bolus";
  const doseMg = parseFloat(document.getElementById("af3-dose").value) || 120.0;
  const patient = readPatientProfileFromUI();

  const btn = document.getElementById("btn-run-af3-submit");
  btn.textContent = "Co-Folding & Computing ΔG / PK/PD...";
  btn.disabled = true;

  try {
    const res = await fetch("/api/af3-approximate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        molecule_name: molName,
        smiles,
        route,
        dose_mg: doseMg,
        interval_h: 12.0,
        num_doses: 2,
        duration_h: 24.0,
        patient,
      }),
    });
    const payload = await res.json();

    // Show generated AlphaFold 3 JSON job spec inside modal preview
    const jobPre = document.getElementById("af3-json-preview");
    if (jobPre && payload.af3_job_spec) {
      jobPre.textContent = JSON.stringify(payload.af3_job_spec, null, 2);
    }

    AppState.currentRoute = route;
    applySimulationPayload(payload);
    document.getElementById("af3-modal").classList.remove("open");
  } catch (err) {
    console.error("AF3 approximation error:", err);
  } finally {
    btn.textContent = "Run AlphaFold 3 Profile Approximation & 3D Simulation";
    btn.disabled = false;
  }
}

function applySimulationPayload(payload) {
  AppState.simResponse = payload;
  const sim = payload.simulation;
  if (!sim) return;

  // Trigger 3D Administration Animation (Oral pill swallow vs IV syringe injection)
  if (AppState.body3d) {
    AppState.body3d.triggerAdministrationAnimation(sim.route);
  }

  // Update CrCl & Patient PK Readout
  const pc = sim.patient_computed;
  document.getElementById("crcl-badge").textContent = `CrCl: ${pc.crcl_ml_min} mL/min`;
  document.getElementById("pk-cl-readout").textContent = `${pc.cl_total_l_h} L/h`;
  document.getElementById("pk-vd-readout").textContent = `${(pc.vc_l + pc.vp_l).toFixed(1)} L`;
  document.getElementById("pk-thalf-readout").textContent = `${pc.t_half_eff_h} h`;

  // Select primary alert organ automatically
  const alertOrgan = sim.pk_summary.primary_alert_organ || "liver";
  AppState.selectedOrgan = alertOrgan;
  if (AppState.body3d) {
    AppState.body3d.selectOrgan(alertOrgan);
  }

  // Render 3Dmol.js Receptor-Ligand Binding Pocket
  renderReceptorPocket3D(sim.structure_3d);

  // Update Thermodynamic & Receptor Metrics
  const th = sim.thermodynamics;
  const s3d = sim.structure_3d;
  document.getElementById("receptor-title").textContent = `${s3d.target_protein} (PDB: ${s3d.pdb_id})`;
  document.getElementById("af3-conf-badge").textContent = `pLDDT ${s3d.af3_plddt} | ipTM ${s3d.af3_iptm}`;
  document.getElementById("thermo-dg").textContent = `${th.delta_g_kcal_mol} kcal/mol`;
  document.getElementById("thermo-kd").textContent = `${th.kd_um} μM`;
  document.getElementById("thermo-ec50").textContent = `${th.ec50_tox_mg_l} mg/L`;

  // Render Pocket Contact Table
  const contactList = document.getElementById("pocket-contacts-list");
  if (contactList) {
    contactList.innerHTML = (s3d.pocket_contacts || [])
      .map(
        (c) =>
          `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid rgba(148,163,184,0.1);">
            <span style="color:#93c5fd;font-family:var(--font-mono);">${c.residue} ↔ ${c.atom_lig}</span>
            <span style="color:#6ee7b7;font-family:var(--font-mono);font-weight:700;">r = ${c.distance_a} Å</span>
          </div>`
      )
      .join("");
  }

  // Render 8-Organ Cards
  renderEightOrganCards(sim.organs);

  // Render Selected Organ Detail Inspector
  renderSelectedOrganInspector(AppState.selectedOrgan);

  // Render Chart.js PK/PD Curves
  renderPKPDChart(sim);

  // Render Gemini 4 Argon Reasoning & 4-Step Cascade
  renderArgonAnalysis(payload.argon_analysis, payload.drug_detail);

  // Render 5-Check Pass/Fail Verification Loop
  renderVerificationLoop(payload.verification_loop);

  // Jump slider to peak plasma concentration Tmax so user immediately sees vibrant distribution
  const times = sim.timeline.time_h;
  const tmaxIdx = times.findIndex((t) => t >= sim.pk_summary.tmax_h);
  const slider = document.getElementById("time-slider");
  slider.max = Math.max(0, times.length - 1);
  setTimeFrame(tmaxIdx >= 0 ? tmaxIdx : 10);
}

function setTimeFrame(idx) {
  if (!AppState.simResponse || !AppState.simResponse.simulation) return;
  const sim = AppState.simResponse.simulation;
  const tl = sim.timeline;
  const maxIdx = tl.time_h.length - 1;
  const safeIdx = Math.max(0, Math.min(maxIdx, idx));
  AppState.timeIndex = safeIdx;

  document.getElementById("time-slider").value = safeIdx;
  const tVal = tl.time_h[safeIdx];
  const cPlasma = tl.central_conc_mg_l[safeIdx];
  const cPeriph = tl.peripheral_conc_mg_l[safeIdx];
  const effPct = tl.efficacy_pct[safeIdx];
  const gshPct = tl.hepatic_gsh_pct[safeIdx];

  document.getElementById("time-readout").textContent = `t = ${tVal.toFixed(1)} h`;
  document.getElementById("inst-cp").textContent = `${cPlasma.toFixed(2)} mg/L`;
  document.getElementById("inst-ct").textContent = `${cPeriph.toFixed(2)} mg/L`;
  document.getElementById("inst-eff").textContent = `${effPct.toFixed(1)}%`;
  document.getElementById("inst-gsh").textContent = `${gshPct.toFixed(1)}%`;

  // Build instantaneous organ risk map at time safeIdx
  const organRiskNow = {};
  Object.keys(sim.organs).forEach((okey) => {
    const o = sim.organs[okey];
    organRiskNow[okey] = o.toxicity_risk_series[safeIdx] || 0;
  });

  if (AppState.body3d) {
    AppState.body3d.updateSimulationFrame(
      cPlasma,
      organRiskNow,
      sim.pk_summary.toxic_threshold_mg_l
    );
  }
}

function renderEightOrganCards(organsMap) {
  const container = document.getElementById("organ-grid-8");
  if (!container) return;
  container.innerHTML = "";

  const order = ["liver", "kidney", "heart", "brain", "blood", "lungs", "gi", "ocular"];
  order.forEach((key) => {
    const o = organsMap[key];
    if (!o) return;
    const risk = o.peak_risk_pct;
    const barColor =
      risk >= 65 ? "var(--accent-rose)" : risk >= 35 ? "var(--accent-amber)" : "var(--accent-emerald)";

    const card = document.createElement("div");
    card.className = `organ-chip ${AppState.selectedOrgan === key ? "selected" : ""}`;
    card.dataset.organ = key;
    card.innerHTML = `
      <div class="organ-chip-top">
        <span>${key.toUpperCase()}</span>
        <span style="color:${barColor};font-family:var(--font-mono);">${risk.toFixed(1)}%</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${o.korean_name}
      </div>
      <div class="organ-risk-bar">
        <div class="organ-risk-fill" style="width:${Math.min(100, risk)}%;background:${barColor};"></div>
      </div>
    `;
    card.onclick = () => selectOrganCard(key);
    container.appendChild(card);
  });
}

function selectOrganCard(organKey) {
  AppState.selectedOrgan = organKey;
  document.querySelectorAll(".organ-chip").forEach((el) => {
    el.classList.toggle("selected", el.dataset.organ === organKey);
  });
  if (AppState.body3d) {
    AppState.body3d.selectOrgan(organKey);
  }
  renderSelectedOrganInspector(organKey);
}

function renderSelectedOrganInspector(organKey) {
  if (!AppState.simResponse) return;
  const o = AppState.simResponse.simulation.organs[organKey];
  if (!o) return;

  document.getElementById("insp-organ-name").textContent = `${o.name} — ${o.korean_name}`;
  document.getElementById("insp-organ-metrics").textContent =
    `Peak Risk: ${o.peak_risk_pct}% at t=${o.peak_time_h}h | Peak Conc: ${o.peak_conc_mg_l} mg/L | Kp=${o.kp_partition} | EC50,tox=${o.ec50_tox_mg_l} mg/L`;
  document.getElementById("insp-organ-mech").textContent = o.primary_mechanism;
  document.getElementById("insp-organ-pathway").textContent = o.lecture_pathway;
  document.getElementById("insp-organ-biomarkers").textContent =
    "Biomarkers: " + (o.biomarkers || []).join(" · ");
}

function renderPKPDChart(sim) {
  const ctx = document.getElementById("pkpd-chart");
  if (!ctx || typeof Chart === "undefined") return;

  if (AppState.pkChart) {
    AppState.pkChart.destroy();
  }

  const tl = sim.timeline;
  const primaryOrganKey = sim.pk_summary.primary_alert_organ || "liver";
  const primaryOrganSeries = sim.organs[primaryOrganKey].concentration_series;

  AppState.pkChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: tl.time_h.map((t) => `${t}h`),
      datasets: [
        {
          label: "Central Plasma Cp(t) (mg/L)",
          data: tl.central_conc_mg_l,
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.12)",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
        {
          label: `${primaryOrganKey.toUpperCase()} Tissue Conc (mg/L)`,
          data: primaryOrganSeries,
          borderColor: "#f43f5e",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Hepatic GSH Reserve (%)",
          data: tl.hepatic_gsh_pct,
          borderColor: "#10b981",
          borderDash: [4, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          yAxisID: "yPct",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#cbd5e1", font: { size: 10 } },
        },
      },
      scales: {
        x: {
          ticks: { color: "#64748b", maxTicksLimit: 9, font: { size: 10 } },
          grid: { color: "rgba(148,163,184,0.08)" },
        },
        y: {
          position: "left",
          title: { display: true, text: "Conc (mg/L)", color: "#94a3b8", font: { size: 10 } },
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(148,163,184,0.1)" },
        },
        yPct: {
          position: "right",
          min: 0,
          max: 105,
          title: { display: true, text: "GSH / Effect (%)", color: "#10b981", font: { size: 10 } },
          ticks: { color: "#10b981", font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function renderArgonAnalysis(argon, drugDetail) {
  if (!argon) return;
  document.getElementById("argon-exec-summary").textContent = argon.executive_summary || "";
  const c = argon.molecular_cascade_4step || {};
  document.getElementById("cascade-s1").textContent = c.step1_delivery || "";
  document.getElementById("cascade-s2").textContent = c.step2_reaction || "";
  document.getElementById("cascade-s3").textContent = c.step3_cellular_dysfunction || "";
  document.getElementById("cascade-s4").textContent = c.step4_disrepair_biomarkers || "";

  const antidoteText =
    drugDetail && drugDetail.antidote
      ? `${drugDetail.antidote.name} — ${drugDetail.antidote.mechanism}`
      : argon.antidote_protocol;
  document.getElementById("gate-antidote-text").textContent = antidoteText;
}

function renderVerificationLoop(vloop) {
  if (!vloop) return;
  const badge = document.getElementById("verify-overall-badge");
  badge.textContent = `VERIFIED ${vloop.passed_count}/${vloop.total_checks} PASS`;
  badge.className = `badge-pill ${vloop.all_passed ? "badge-verified" : "badge-warning"}`;

  const list = document.getElementById("verification-list");
  list.innerHTML = (vloop.checks || [])
    .map(
      (chk) => `
      <div class="verify-item">
        <div>
          <div class="v-title">${chk.passed ? "✅" : "⚠️"} ${chk.name}</div>
          <div class="v-detail">${chk.detail}</div>
        </div>
        <span class="badge-pill badge-verified">${chk.passed ? "PASS" : "WARN"}</span>
      </div>
    `
    )
    .join("");
}

function setLoadingState(loading) {
  const btn = document.getElementById("btn-simulate");
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Solving ODEs & Argon Verification..." : "▶ Simulate 3D PK/PD & Toxicity";
}

function bindUIControls() {
  // Drug Select
  document.getElementById("drug-select").addEventListener("change", (e) => {
    applyDrugDefaults(e.target.value);
    runSimulation(false);
  });

  // Route Tabs
  document.querySelectorAll(".route-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setRouteTab(tab.dataset.route);
    });
  });

  // Simulate & Toxic Demo Buttons
  document.getElementById("btn-simulate").addEventListener("click", () => runSimulation(false));
  document.getElementById("btn-toxic-demo").addEventListener("click", () => runSimulation(true));

  // Time Slider & Play/Pause
  const slider = document.getElementById("time-slider");
  slider.addEventListener("input", (e) => {
    setTimeFrame(parseInt(e.target.value, 10));
  });

  const playBtn = document.getElementById("btn-play-timeline");
  playBtn.addEventListener("click", () => {
    AppState.isPlaying = !AppState.isPlaying;
    playBtn.textContent = AppState.isPlaying ? "⏸ Pause" : "▶ Play 24h";
    if (AppState.isPlaying) {
      AppState.playTimer = setInterval(() => {
        const max = parseInt(slider.max, 10) || 240;
        const next = (AppState.timeIndex + 2) > max ? 0 : AppState.timeIndex + 2;
        setTimeFrame(next);
      }, 65);
    } else {
      clearInterval(AppState.playTimer);
    }
  });

  // 3D Viewport Top Controls
  document.getElementById("btn-toggle-shell").addEventListener("click", (e) => {
    const visible = AppState.body3d.toggleShell();
    e.target.classList.toggle("active", !visible);
    e.target.textContent = visible ? "X-Ray Organs Only" : "Show Body Shell";
  });

  document.getElementById("btn-toggle-rotate").addEventListener("click", (e) => {
    const rot = AppState.body3d.toggleAutoRotate();
    e.target.classList.toggle("active", rot);
  });

  document.getElementById("btn-reset-cam").addEventListener("click", () => {
    AppState.body3d.resetCamera();
  });

  document.getElementById("btn-replay-admin").addEventListener("click", () => {
    AppState.body3d.triggerAdministrationAnimation(AppState.currentRoute);
  });

  // User Photo Upload -> Auto-rotate & Map to 3D Head UV Texture
  const photoInput = document.getElementById("photo-upload-input");
  photoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.avatar_url) {
        document.getElementById("user-avatar-img").src = data.avatar_url;
      }
      if (data.face_uv_url && AppState.body3d) {
        AppState.body3d.updateUserFaceTexture(data.face_uv_url);
      }
    } catch (err) {
      console.error("Photo upload error:", err);
    }
  });

  // Phase 2 AlphaFold 3 Modal Open/Close
  document.getElementById("btn-open-af3").addEventListener("click", () => {
    document.getElementById("af3-modal").classList.add("open");
  });
  document.getElementById("btn-close-af3").addEventListener("click", () => {
    document.getElementById("af3-modal").classList.remove("open");
  });
  document.getElementById("btn-run-af3-submit").addEventListener("click", runAF3NovelApproximation);

  // Lecture Curriculum Study Modal Open/Close
  document.getElementById("btn-open-curriculum").addEventListener("click", () => {
    document.getElementById("curriculum-modal").classList.add("open");
  });
  document.getElementById("btn-close-curriculum").addEventListener("click", () => {
    document.getElementById("curriculum-modal").classList.remove("open");
  });

  // Human-in-the-Loop Clinical Protocol Sign-Off
  document.getElementById("btn-approve-protocol").addEventListener("click", async () => {
    const simId = AppState.simResponse ? AppState.simResponse.simulation_id : "sim-live";
    const res = await fetch("/api/verify-protocol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        simulation_id: simId,
        reviewer_name: "PharmD Researcher",
        decision: "approved_with_antidote_standby",
        clinical_notes: "Verified organ threshold, PGx phenotype, and antidote readiness.",
      }),
    });
    const data = await res.json();
    if (data.status === "verified") {
      const statusEl = document.getElementById("gate-approval-status");
      statusEl.textContent = `✅ Verified & Signed Off (${data.record.approval_id} at ${data.record.timestamp_iso})`;
      statusEl.style.color = "#34d399";
    }
  });
}
