/**
 * PharmacoTwin 3D — application controller (v4.0)
 * - Step-by-step onboarding wizard (one question per screen) with live CrCl / Vd / t½ estimates
 * - Lab: full-screen 3D engine (body3d.js), Regimen panel, Organs panel with tabs, timeline
 * - Verification loop + human sign-off gate before export
 * - EN / KO via data-i18n keys
 */
(() => {
"use strict";

/* =========================================================================
   STATE
   ========================================================================= */
const AppState = {
  lang: "en",
  viewMode: "anatomy",
  drugs: [],               // preset drug summaries from /api/drugs
  drugDetail: {},          // id -> full drug (pk, pd, pubchem_cid)
  novelSamples: [],
  pgxLibrary: {},
  curriculum: { en: "", ko: "" },
  selectedDrugKey: "acetaminophen",
  selectedRoute: "oral",
  doseMg: 500,
  intervalHours: 8,
  numDoses: 1,
  patient: null,           // set from PRESETS.healthy at boot
  lastSimPatientKey: null,
  selectedOrgan: "liver",
  activeTab: "overview",
  simData: null,
  isNovel: false,
  approval: null,
  simBusy: false,
  af3Result: null,

  isPlaying: true,
  currentStepIdx: 0,
  playbackSpeed: 1,
  lastFrameTime: 0,

  body3d: null,
  pkChart: null,
  chartMode: "pk",
  drugViewer3D: null,
  receptorViewer3D: null,
  receptorState: { key: null, organ: null, src: "afdb", status: "idle", ligands: [] },
  af3Manifest: {},             // organKey -> AlphaFold Server prediction entry
  structSource: {},            // organKey -> "af3" | "afdb" (user choice)
  currentMolStyle: "cartoon",
  afDbCache: {},
};

const ORGAN_KEYS = ["liver", "kidney", "heart", "brain", "lungs", "blood", "ocular", "gi"];

const ORGAN_NAMES = {
  en: { liver: "Liver", kidney: "Kidneys", heart: "Heart", brain: "Brain", lungs: "Lungs", blood: "Blood", ocular: "Eyes", gi: "GI tract" },
  ko: { liver: "간", kidney: "신장", heart: "심장", brain: "뇌", lungs: "폐", blood: "혈액", ocular: "눈", gi: "위장관" },
};

// Representative AlphaFold DB v6 receptor per organ (local PDB snapshots in /static/assets/alphafold_pdb)
const ORGAN_RECEPTORS = {
  liver:  { uniprot: "P05181", afId: "AF-P05181-F1", rcsb: "1Z10", name: "CYP2E1 monooxygenase", residues: 493,  plddt: 96.13, url: "/static/assets/alphafold_pdb/liver_P05181.pdb" },
  kidney: { uniprot: "O15244", afId: "AF-O15244-F1", rcsb: "2FYL", name: "OCT2 / SLC22A2 transporter", residues: 555, plddt: 83.03, url: "/static/assets/alphafold_pdb/kidney_O15244.pdb" },
  heart:  { uniprot: "Q12809", afId: "AF-Q12809-F1", rcsb: "5VA1", name: "hERG / KCNH2 potassium channel", residues: 1159, plddt: 62.75, url: "/static/assets/alphafold_pdb/heart_Q12809.pdb" },
  brain:  { uniprot: "P14416", afId: "AF-P14416-F1", rcsb: "6CM4", name: "Dopamine D2 receptor", residues: 443, plddt: 72.45, url: "/static/assets/alphafold_pdb/brain_P14416.pdb" },
  lungs:  { uniprot: "P12821", afId: "AF-P12821-F1", rcsb: "1O8A", name: "Angiotensin-converting enzyme", residues: 1306, plddt: 90.94, url: "/static/assets/alphafold_pdb/lungs_P12821.pdb" },
  blood:  { uniprot: "P11413", afId: "AF-P11413-F1", rcsb: "2BH9", name: "G6PD dehydrogenase", residues: 515, plddt: 94.4, url: "/static/assets/alphafold_pdb/blood_P11413.pdb" },
  ocular: { uniprot: "P08100", afId: "AF-P08100-F1", rcsb: "1U19", name: "Rhodopsin", residues: 348, plddt: 88.74, url: "/static/assets/alphafold_pdb/ocular_P08100.pdb" },
  gi:     { uniprot: "P08183", afId: "AF-P08183-F1", rcsb: "3G5U", name: "P-glycoprotein / ABCB1 efflux pump", residues: 1280, plddt: 84.59, url: "/static/assets/alphafold_pdb/gi_P08183.pdb" },
};

const DRUG_BLURBS = {
  en: {
    acetaminophen: "Common pain reliever. Overdose injures the liver.",
    terfenadine: "Withdrawn antihistamine. Blocks the heart's hERG channel.",
    amiodarone: "Heart-rhythm drug. Builds up in lungs, liver and eyes.",
    gentamicin: "IV antibiotic. Can damage the kidneys and hearing.",
    vancomycin: "IV antibiotic for resistant bacteria. Kidney risk at high levels.",
    dapsone: "Antibiotic that oxidizes red blood cells; worse with G6PD deficiency.",
  },
  ko: {
    acetaminophen: "흔한 해열진통제. 과량 복용 시 간을 손상시킵니다.",
    terfenadine: "퇴출된 항히스타민제. 심장 hERG 채널을 차단합니다.",
    amiodarone: "항부정맥제. 폐, 간, 눈에 축적됩니다.",
    gentamicin: "주사 항생제. 신장과 청력을 손상시킬 수 있습니다.",
    vancomycin: "내성균 주사 항생제. 고농도에서 신장 위험이 있습니다.",
    dapsone: "적혈구를 산화시키는 항생제. G6PD 결핍 시 악화됩니다.",
  },
};

// PubChem has no 3D conformer for these CIDs (gentamicin, vancomycin); request the 2D record instead.
const PUBCHEM_2D_ONLY = new Set([3467, 14969]);

const PRESETS = {
  healthy:  { age: 26, sex: "M", weight_kg: 68, height_cm: 174, scr: 0.95, hepatic: "normal", cyp2e1: "normal", cyp3a4: "normal", herg: "wildtype", g6pd: "normal" },
  renal:    { age: 72, sex: "F", weight_kg: 54, height_cm: 158, scr: 2.1, hepatic: "normal", cyp2e1: "normal", cyp3a4: "normal", herg: "wildtype", g6pd: "normal" },
  highrisk: { age: 42, sex: "M", weight_kg: 62, height_cm: 170, scr: 1.2, hepatic: "mild_impairment", cyp2e1: "induced", cyp3a4: "inhibited", herg: "lqt2_carrier", g6pd: "deficient" },
};

// Fallback PK for the onboarding estimate before /api/drugs/{id} has loaded (acetaminophen reference values)
const FALLBACK_PK = { vc_l_per_70kg: 24, vp_l_per_70kg: 42, cl_l_h_per_70kg: 19.5, fe_renal: 0.05, cyp3a4_substrate: false };
const HEPATIC_FACTOR = { normal: 1.0, mild_impairment: 0.75, moderate_impairment: 0.5, severe_impairment: 0.28 };

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEP_MS = REDUCED_MOTION ? 0 : 380;

/* =========================================================================
   I18N
   ========================================================================= */
const I18N = {
  en: {
    "lang.other": "한국어",
    "wz.skip": "Skip to lab",
    "wz.intro.kicker": "Patient-specific pharmacology",
    "wz.intro.lede": "See where a dose travels in one patient's body, and which organs it may harm.",
    "wz.intro.start": "Start",
    "wz.intro.note": "Five short questions. About a minute.",
    "wz.presets": "Or load a preset",
    "wz.presets.alt": "Try a preset",
    "preset.healthy": "Healthy adult",
    "preset.renal": "Renal decline",
    "preset.highrisk": "High-risk genetics",
    "wz.s1.kicker": "About you",
    "wz.s1.q": "How old are you, and what is your sex?",
    "wz.s1.help": "Kidney filtration slows with age and differs by sex.",
    "wz.s2.kicker": "Body size",
    "wz.s2.q": "What are your weight and height?",
    "wz.s2.help": "Body size sets how much space a drug spreads into.",
    "wz.s3.kicker": "Kidney function",
    "wz.s3.q": "What is your serum creatinine?",
    "wz.s3.help": "It is on a routine blood test. If unsure, keep the default.",
    "wz.s3.range": "Typical adult range is 0.6–1.2 mg/dL. Higher means the kidneys filter less.",
    "wz.s4.kicker": "Liver function",
    "wz.s4.q": "How well does your liver work?",
    "wz.s4.help": "The liver breaks down most drugs.",
    "wz.s5.kicker": "Genetics",
    "wz.s5.q": "Any known gene variants?",
    "wz.s5.help": "Leave as typical if you have not been tested.",
    "wz.s6.kicker": "Summary",
    "wz.s6.q": "Your twin is ready.",
    "wz.s6.help": "Estimated for {drug} at the patient values you entered.",
    "wz.back": "Back",
    "wz.continue": "Continue",
    "wz.enter": "Enter lab",
    "wz.hint": "Enter to continue · Esc to go back",
    "wz.err.range": "Enter a value between {min} and {max}.",
    "f.age": "Age",
    "f.sex": "Biological sex",
    "f.weight": "Weight",
    "f.height": "Height",
    "f.scr": "Serum creatinine",
    "u.years": "years",
    "opt.male": "Male",
    "opt.female": "Female",
    "opt.typical": "Typical",
    "opt.induced": "Induced",
    "opt.inhibited": "Inhibited",
    "opt.poor": "Poor",
    "opt.lqt2": "LQT2 carrier",
    "opt.normal": "Normal",
    "opt.deficient": "Deficient",
    "liver.normal": "Normal",
    "liver.normal.d": "No known liver disease",
    "liver.mild": "Mildly reduced",
    "liver.mild.d": "For example fatty liver or early hepatitis",
    "liver.severe": "Severely reduced",
    "liver.severe.d": "For example cirrhosis",
    "g.cyp2e1.d": "Liver enzyme that makes acetaminophen's toxic byproduct.",
    "g.cyp3a4.d": "Clears about half of all drugs. Slow forms raise exposure.",
    "g.herg.d": "Heart potassium channel. Variants lower the arrhythmia threshold.",
    "g.g6pd.d": "Protects red blood cells from oxidative damage.",
    "ro.title": "Live estimate · {drug}",
    "sent.crcl": "Your kidneys filter about {v} mL of blood per minute ({s}).",
    "crcl.normal": "normal",
    "crcl.mild": "mildly reduced",
    "crcl.moderate": "moderately reduced",
    "crcl.severe": "severely reduced",
    "sent.vd": "{drug} spreads through about {v} L of body space. Smaller spaces mean sharper peaks.",
    "sent.thalf": "Half of each dose is cleared in about {v} hours.",

    "tb.anatomy": "Anatomy",
    "tb.circulation": "Circulation",
    "tb.reset": "Reset view",
    "tb.more": "More",
    "menu.novel": "Novel compound",
    "menu.novel.sub": "AlphaFold 3 job and PK estimate",
    "menu.notes": "Lecture notes",
    "menu.notes.sub": "Toxicology curriculum",
    "menu.patient": "Edit patient",
    "menu.patient.sub": "Reopen the setup steps",
    "panel.toggle": "Show or hide panel",

    "reg.title": "Regimen",
    "reg.drug": "Drug",
    "reg.route": "Route",
    "route.oral": "Oral",
    "route.iv_bolus": "IV bolus",
    "route.iv_infusion": "IV infusion",
    "reg.dose": "Dose",
    "mark.ther": "Therapeutic",
    "mark.high": "High",
    "mark.toxic": "Toxic",
    "reg.interval": "Every",
    "reg.doses": "Doses",
    "reg.run": "Run simulation",
    "reg.running": "Running…",
    "reg.patient": "Patient",
    "reg.edit": "Edit",
    "reg.seq": "Genotype sequences",
    "pt.line": "{age} y · {sex} · {w} kg · {h} cm · SCr {scr} mg/dL · liver {liver}",
    "pt.typical": "Typical genotypes",
    "liver.short.normal": "normal",
    "liver.short.mild_impairment": "mildly reduced",
    "liver.short.moderate_impairment": "moderately reduced",
    "liver.short.severe_impairment": "severely reduced",
    "mol.loading": "Loading structure…",
    "mol.none": "3D structure unavailable",
    "mol.3d": "PubChem {cid} · 3D",
    "mol.2d": "PubChem {cid} · 2D layout",
    "novel.badge": "Novel compound",

    "org.title": "Organs",
    "org.peak": "Peak risk over 24 h",
    "tab.overview": "Overview",
    "tab.structure": "Structure",
    "tab.curves": "Curves",
    "tab.review": "AI review",
    "level.safe": "Safe",
    "level.monitor": "Monitor",
    "level.elevated": "Elevated",
    "level.critical": "Critical",
    "safety.safe": "Within safe range",
    "safety.elevated": "Elevated risk",
    "safety.critical": "Critical risk",
    "ov.peakConc": "Peak tissue conc.",
    "ov.threshold": "Toxic EC50",
    "ov.peakAt": "Peak at",
    "ov.ratio": "Peak is {r}× the toxic EC50.",
    "ov.mech": "Mechanism",
    "ov.biomarkers": "Biomarkers",
    "st.receptor": "Target receptor",
    "st.cartoon": "Cartoon",
    "st.surface": "Surface",
    "st.pocket": "Pocket",
    "st.legend": "Model confidence",
    "st.vhigh": "Very high",
    "st.conf": "Confident",
    "st.low": "Low",
    "st.vlow": "Very low",
    "st.loading": "Loading {id}…",
    "st.loaded": "{id} · {n} residues · colored by pLDDT",
    "st.rcsb": "RCSB {id} · experimental structure",
    "st.failed": "Structure could not be loaded.",
    "st.live": "Live from AlphaFold DB (v{v})",
    "st.bundled": "Bundled AlphaFold DB snapshot",
    "st.srcApo": "AlphaFold DB (apo)",
    "st.srcAf3": "AlphaFold 3 complex",
    "st.af3caption": "AlphaFold 3 prediction via AlphaFold Server · run {date} · ipTM {iptm} · pTM {ptm}",
    "st.binding": "Drug binding estimate",
    "st.bindingNote": "From the built-in physics model, not an AlphaFold 3 run.",
    "cv.conc": "Concentration",
    "cv.risk": "Organ risk",
    "cv.plasma": "Plasma",
    "cv.effect": "Effect site",
    "cv.therMax": "Therapeutic max",
    "cv.toxic": "Toxic threshold",
    "cv.critical": "Critical (65%)",

    "rev.model": "Model",
    "rev.argonOff": "Argon not called — API key not set; deterministic template shown.",
    "rev.argonOn": "Live Argon response, checked by the verification loop.",
    "rev.fallback": "Reason: {r}",
    "rev.summary": "Summary",
    "rev.cascade": "Toxicity cascade",
    "c.step1": "Delivery",
    "c.step2": "Reaction",
    "c.step3": "Cell dysfunction",
    "c.step4": "Repair and biomarkers",
    "rev.antidote": "Antidote",
    "rev.verification": "Verification",
    "rev.verSummary": "{p}/{t} checks · {a} attempt(s)",
    "rev.attempts": "Attempts",
    "rev.attemptPass": "Attempt {n}: all checks passed",
    "rev.attemptFail": "Attempt {n}: failed {ids}",
    "rev.signoff": "Human sign-off",
    "rev.signoffHelp": "Required for every simulation before export.",
    "rev.check": "I reviewed the doses, organ risks and checks above.",
    "rev.name": "Reviewer name",
    "rev.approve": "Approve",
    "rev.approving": "Approving…",
    "rev.approved": "Approved by {n} · {t} · {id}",
    "rev.export": "Export JSON",
    "rev.disclaimer": "Research and education use only. Not medical advice.",
    "rev.empty": "Run a simulation to see the review.",

    "tl.play": "Play",
    "tl.pause": "Pause",
    "tl.restart": "Restart",
    "tl.plasma": "Plasma C(t)",
    "phase.abs": "Absorption",
    "phase.dist": "Distribution",
    "phase.met": "Metabolism and accumulation",
    "phase.elim": "Elimination",
    "hover.now": "Now",
    "hover.peak": "Peak",
    "hover.conc": "Tissue conc.",
    "hover.click": "Click to inspect",

    "af3.title": "Novel compound estimate",
    "af3.explain": "Generates an AlphaFold 3 input job (protein sequence + ligand SMILES) and a heuristic PK/PD estimate. AlphaFold 3 is not run here.",
    "af3.examples": "Examples",
    "af3.name": "Name",
    "af3.smiles": "Ligand SMILES",
    "af3.regimen": "Uses the current regimen: {r}.",
    "af3.run": "Run estimate",
    "af3.running": "Estimating…",
    "af3.target": "Target protein",
    "af3.plddt": "Reference pLDDT",
    "af3.dg": "ΔG (heuristic)",
    "af3.kd": "Kd (heuristic)",
    "af3.peak": "Highest organ risk",
    "af3.json": "Job JSON",
    "af3.download": "Download job JSON",
    "af3.open": "Show in lab",
    "af3.na": "Not available",

    "cur.title": "Lecture notes",
    "cur.sub": "Toxicology curriculum used to ground thresholds and mechanisms.",

    "err.sim": "Simulation failed. Check that the server is running.",
    "err.af3": "Estimate failed. Check the SMILES and try again.",
    "err.approve": "Approval failed: {m}",
    "toast.approved": "Approved. Export is enabled.",
    "toast.novel": "Showing {name}. Run simulation to return to presets.",
  },
  ko: {
    "lang.other": "English",
    "wz.skip": "바로 실험실로",
    "wz.intro.kicker": "환자 맞춤 약리 시뮬레이션",
    "wz.intro.lede": "한 사람의 몸에서 약이 어디로 이동하고, 어떤 장기에 부담을 주는지 확인하세요.",
    "wz.intro.start": "시작하기",
    "wz.intro.note": "짧은 질문 다섯 개, 약 1분이면 됩니다.",
    "wz.presets": "또는 예시 환자 불러오기",
    "wz.presets.alt": "예시 환자 적용",
    "preset.healthy": "건강한 성인",
    "preset.renal": "신기능 저하",
    "preset.highrisk": "고위험 유전형",
    "wz.s1.kicker": "기본 정보",
    "wz.s1.q": "나이와 생물학적 성별을 알려주세요.",
    "wz.s1.help": "신장의 여과 능력은 나이가 들수록 줄고 성별에 따라 다릅니다.",
    "wz.s2.kicker": "체격",
    "wz.s2.q": "체중과 키를 알려주세요.",
    "wz.s2.help": "체격은 약이 퍼지는 공간의 크기를 결정합니다.",
    "wz.s3.kicker": "신장 기능",
    "wz.s3.q": "혈청 크레아티닌 수치는 얼마인가요?",
    "wz.s3.help": "일반 혈액검사 결과에 나옵니다. 모르면 기본값을 유지하세요.",
    "wz.s3.range": "성인 정상 범위는 0.6–1.2 mg/dL입니다. 높을수록 신장 여과가 줄어든 상태입니다.",
    "wz.s4.kicker": "간 기능",
    "wz.s4.q": "간 기능은 어느 정도인가요?",
    "wz.s4.help": "대부분의 약은 간에서 분해됩니다.",
    "wz.s5.kicker": "유전형",
    "wz.s5.q": "알고 있는 유전자 변이가 있나요?",
    "wz.s5.help": "검사받은 적이 없다면 '일반'으로 두세요.",
    "wz.s6.kicker": "요약",
    "wz.s6.q": "디지털 트윈이 준비됐습니다.",
    "wz.s6.help": "입력한 환자 정보로 {drug} 기준 추정한 값입니다.",
    "wz.back": "이전",
    "wz.continue": "계속",
    "wz.enter": "실험실 입장",
    "wz.hint": "Enter 계속 · Esc 이전",
    "wz.err.range": "{min}에서 {max} 사이의 값을 입력하세요.",
    "f.age": "나이",
    "f.sex": "생물학적 성별",
    "f.weight": "체중",
    "f.height": "키",
    "f.scr": "혈청 크레아티닌",
    "u.years": "세",
    "opt.male": "남성",
    "opt.female": "여성",
    "opt.typical": "일반",
    "opt.induced": "유도형",
    "opt.inhibited": "억제형",
    "opt.poor": "저하형",
    "opt.lqt2": "LQT2 보인자",
    "opt.normal": "정상",
    "opt.deficient": "결핍",
    "liver.normal": "정상",
    "liver.normal.d": "알려진 간 질환 없음",
    "liver.mild": "경도 저하",
    "liver.mild.d": "예: 지방간, 초기 간염",
    "liver.severe": "중증 저하",
    "liver.severe.d": "예: 간경변",
    "g.cyp2e1.d": "아세트아미노펜의 독성 대사물을 만드는 간 효소입니다.",
    "g.cyp3a4.d": "약물의 약 절반을 분해합니다. 느린 형은 노출을 높입니다.",
    "g.herg.d": "심장 칼륨 채널입니다. 변이가 있으면 부정맥 역치가 낮아집니다.",
    "g.g6pd.d": "적혈구를 산화 손상으로부터 보호합니다.",
    "ro.title": "실시간 추정 · {drug}",
    "sent.crcl": "신장이 1분에 약 {v} mL의 혈액을 걸러냅니다({s}).",
    "crcl.normal": "정상",
    "crcl.mild": "경도 저하",
    "crcl.moderate": "중등도 저하",
    "crcl.severe": "중증 저하",
    "sent.vd": "{drug}은(는) 약 {v} L의 체내 공간에 퍼집니다. 공간이 작을수록 농도가 급격히 오릅니다.",
    "sent.thalf": "투여량의 절반이 약 {v}시간 만에 제거됩니다.",

    "tb.anatomy": "해부도",
    "tb.circulation": "순환도",
    "tb.reset": "시점 초기화",
    "tb.more": "더보기",
    "menu.novel": "신규 화합물",
    "menu.novel.sub": "AlphaFold 3 작업 파일과 PK 추정",
    "menu.notes": "강의 노트",
    "menu.notes.sub": "독성학 커리큘럼",
    "menu.patient": "환자 정보 수정",
    "menu.patient.sub": "설정 단계 다시 열기",
    "panel.toggle": "패널 열기/닫기",

    "reg.title": "투여 계획",
    "reg.drug": "약물",
    "reg.route": "투여 경로",
    "route.oral": "경구",
    "route.iv_bolus": "정맥 일시",
    "route.iv_infusion": "정맥 점적",
    "reg.dose": "용량",
    "mark.ther": "치료 용량",
    "mark.high": "고용량",
    "mark.toxic": "독성 용량",
    "reg.interval": "투여 간격",
    "reg.doses": "횟수",
    "reg.run": "시뮬레이션 실행",
    "reg.running": "실행 중…",
    "reg.patient": "환자",
    "reg.edit": "수정",
    "reg.seq": "유전형 서열",
    "pt.line": "{age}세 · {sex} · {w} kg · {h} cm · SCr {scr} mg/dL · 간 {liver}",
    "pt.typical": "일반 유전형",
    "liver.short.normal": "정상",
    "liver.short.mild_impairment": "경도 저하",
    "liver.short.moderate_impairment": "중등도 저하",
    "liver.short.severe_impairment": "중증 저하",
    "mol.loading": "구조 불러오는 중…",
    "mol.none": "3D 구조 없음",
    "mol.3d": "PubChem {cid} · 3D",
    "mol.2d": "PubChem {cid} · 2D 배치",
    "novel.badge": "신규 화합물",

    "org.title": "장기",
    "org.peak": "24시간 최고 위험도",
    "tab.overview": "개요",
    "tab.structure": "구조",
    "tab.curves": "곡선",
    "tab.review": "AI 검토",
    "level.safe": "안전",
    "level.monitor": "관찰",
    "level.elevated": "상승",
    "level.critical": "심각",
    "safety.safe": "안전 범위",
    "safety.elevated": "위험 상승",
    "safety.critical": "심각한 위험",
    "ov.peakConc": "최고 조직 농도",
    "ov.threshold": "독성 EC50",
    "ov.peakAt": "최고 시점",
    "ov.ratio": "최고 농도가 독성 EC50의 {r}배입니다.",
    "ov.mech": "기전",
    "ov.biomarkers": "바이오마커",
    "st.receptor": "표적 수용체",
    "st.cartoon": "리본",
    "st.surface": "표면",
    "st.pocket": "결합 부위",
    "st.legend": "모델 신뢰도",
    "st.vhigh": "매우 높음",
    "st.conf": "높음",
    "st.low": "낮음",
    "st.vlow": "매우 낮음",
    "st.loading": "{id} 불러오는 중…",
    "st.loaded": "{id} · 잔기 {n}개 · pLDDT 색상",
    "st.rcsb": "RCSB {id} · 실험 구조",
    "st.failed": "구조를 불러오지 못했습니다.",
    "st.live": "AlphaFold DB 실시간 조회 (v{v})",
    "st.bundled": "내장 AlphaFold DB 스냅샷",
    "st.srcApo": "AlphaFold DB (단독 구조)",
    "st.srcAf3": "AlphaFold 3 복합체",
    "st.af3caption": "AlphaFold Server로 실행한 AlphaFold 3 예측 · 실행일 {date} · ipTM {iptm} · pTM {ptm}",
    "st.binding": "약물 결합 추정",
    "st.bindingNote": "내장 물리 모델 추정값이며 AlphaFold 3 실행 결과가 아닙니다.",
    "cv.conc": "농도",
    "cv.risk": "장기 위험도",
    "cv.plasma": "혈장",
    "cv.effect": "작용 부위",
    "cv.therMax": "치료 상한",
    "cv.toxic": "독성 기준",
    "cv.critical": "심각 (65%)",

    "rev.model": "모델",
    "rev.argonOff": "Argon 미호출 — API 키가 없어 결정론적 템플릿을 표시합니다.",
    "rev.argonOn": "Argon 실시간 응답이며 검증 루프로 확인했습니다.",
    "rev.fallback": "사유: {r}",
    "rev.summary": "요약",
    "rev.cascade": "독성 발현 단계",
    "c.step1": "전달",
    "c.step2": "표적 반응",
    "c.step3": "세포 기능장애",
    "c.step4": "복구와 바이오마커",
    "rev.antidote": "해독제",
    "rev.verification": "검증",
    "rev.verSummary": "{p}/{t} 통과 · 시도 {a}회",
    "rev.attempts": "시도 이력",
    "rev.attemptPass": "{n}차 시도: 모두 통과",
    "rev.attemptFail": "{n}차 시도: 실패 {ids}",
    "rev.signoff": "사람 검토 승인",
    "rev.signoffHelp": "모든 시뮬레이션은 내보내기 전에 승인이 필요합니다.",
    "rev.check": "위의 용량, 장기 위험도, 검증 결과를 검토했습니다.",
    "rev.name": "검토자 이름",
    "rev.approve": "승인",
    "rev.approving": "승인 중…",
    "rev.approved": "{n} 승인 · {t} · {id}",
    "rev.export": "JSON 내보내기",
    "rev.disclaimer": "연구 및 교육용입니다. 의학적 조언이 아닙니다.",
    "rev.empty": "시뮬레이션을 실행하면 검토 결과가 표시됩니다.",

    "tl.play": "재생",
    "tl.pause": "일시정지",
    "tl.restart": "처음부터",
    "tl.plasma": "혈장 C(t)",
    "phase.abs": "흡수",
    "phase.dist": "분포",
    "phase.met": "대사와 조직 축적",
    "phase.elim": "배설",
    "hover.now": "현재",
    "hover.peak": "최고",
    "hover.conc": "조직 농도",
    "hover.click": "클릭하여 자세히 보기",

    "af3.title": "신규 화합물 추정",
    "af3.explain": "AlphaFold 3 입력 작업 파일(단백질 서열 + 리간드 SMILES)과 휴리스틱 PK/PD 추정을 생성합니다. 이곳에서 AlphaFold 3를 실행하지는 않습니다.",
    "af3.examples": "예시",
    "af3.name": "이름",
    "af3.smiles": "리간드 SMILES",
    "af3.regimen": "현재 투여 계획을 사용합니다: {r}.",
    "af3.run": "추정 실행",
    "af3.running": "추정 중…",
    "af3.target": "표적 단백질",
    "af3.plddt": "참조 pLDDT",
    "af3.dg": "ΔG (휴리스틱)",
    "af3.kd": "Kd (휴리스틱)",
    "af3.peak": "최고 장기 위험도",
    "af3.json": "작업 JSON",
    "af3.download": "작업 JSON 다운로드",
    "af3.open": "실험실에서 보기",
    "af3.na": "없음",

    "cur.title": "강의 노트",
    "cur.sub": "임계값과 기전의 근거가 된 독성학 강의 요약입니다.",

    "err.sim": "시뮬레이션에 실패했습니다. 서버가 실행 중인지 확인하세요.",
    "err.af3": "추정에 실패했습니다. SMILES를 확인하고 다시 시도하세요.",
    "err.approve": "승인 실패: {m}",
    "toast.approved": "승인되었습니다. 내보내기가 활성화되었습니다.",
    "toast.novel": "{name} 결과를 표시합니다. 시뮬레이션 실행 시 기본 약물로 돌아갑니다.",
  },
};

const TIPS = {
  en: {
    crcl: "<b>Creatinine clearance.</b> How many mL of blood the kidneys filter per minute (Cockcroft–Gault). Normal is 90 or more.",
    vd: "<b>Volume of distribution.</b> The apparent body volume a drug spreads into. Larger Vd means lower blood levels.",
    thalf: "<b>Half-life.</b> Time for the blood concentration to fall by half.",
    cmax: "<b>Cmax.</b> The highest concentration reached after dosing.",
    auc: "<b>AUC.</b> Area under the concentration–time curve: total drug exposure over time.",
    plddt: "<b>pLDDT.</b> AlphaFold's per-residue confidence, 0–100. Above 90 is very high; below 50 is unreliable.",
    dg: "<b>ΔG.</b> Binding free energy. More negative means tighter binding.",
    kd: "<b>Kd.</b> Dissociation constant: the concentration at which half the receptors are occupied. Lower means tighter binding.",
    ec50: "<b>Toxic EC50.</b> Tissue concentration at which toxicity risk reaches 50%.",
  },
  ko: {
    crcl: "<b>크레아티닌 청소율.</b> 신장이 1분에 걸러내는 혈액량(Cockcroft–Gault 식). 정상은 90 이상입니다.",
    vd: "<b>분포 용적.</b> 약이 퍼지는 겉보기 체내 부피. 클수록 혈중 농도가 낮아집니다.",
    thalf: "<b>반감기.</b> 혈중 농도가 절반으로 줄어드는 시간입니다.",
    cmax: "<b>Cmax.</b> 투여 후 도달하는 최고 농도입니다.",
    auc: "<b>AUC.</b> 농도-시간 곡선 아래 면적. 시간에 따른 총 약물 노출량입니다.",
    plddt: "<b>pLDDT.</b> AlphaFold의 잔기별 신뢰도(0–100). 90 이상은 매우 높음, 50 미만은 신뢰하기 어렵습니다.",
    dg: "<b>ΔG.</b> 결합 자유에너지. 더 음수일수록 강하게 결합합니다.",
    kd: "<b>Kd.</b> 해리상수. 수용체의 절반이 점유되는 농도이며, 낮을수록 강한 결합입니다.",
    ec50: "<b>독성 EC50.</b> 독성 위험이 50%에 이르는 조직 농도입니다.",
  },
};

function t(key, vars) {
  const dict = I18N[AppState.lang] || I18N.en;
  let s = dict[key] ?? I18N.en[key] ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  }
  return s;
}

/* =========================================================================
   SMALL HELPERS
   ========================================================================= */
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function fmt(n, digits) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (digits !== undefined) return v.toFixed(digits);
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return "0";
  return v.toPrecision(2);
}

function riskLevel(pct) {
  if (pct >= 65) return "danger";
  if (pct >= 18) return "caution";
  return "safe";
}

function riskLevelLabel(pct) {
  if (pct >= 65) return t("level.critical");
  if (pct >= 35) return t("level.elevated");
  if (pct >= 18) return t("level.monitor");
  return t("level.safe");
}

function organName(key) {
  return (ORGAN_NAMES[AppState.lang] || ORGAN_NAMES.en)[key] || key;
}

function drugShortName(drug) {
  if (!drug) return "";
  if (AppState.lang === "ko" && drug.korean_name) return drug.korean_name.split(" (")[0];
  return (drug.name || "").split(" (")[0];
}

function currentDrug() {
  return AppState.drugs.find((d) => d.id === AppState.selectedDrugKey) || null;
}

function routeAnimKey(route) {
  return route === "oral" ? "oral" : "iv";
}

function engine(method, ...args) {
  const e = AppState.body3d;
  if (!e || typeof e[method] !== "function") return undefined;
  try {
    return e[method](...args);
  } catch (err) {
    console.warn(`[engine] ${method} failed:`, err);
    return undefined;
  }
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("err", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setSegValue(container, attr, value) {
  if (!container) return;
  container.querySelectorAll(`[${attr}]`).forEach((b) => {
    const on = b.getAttribute(attr) === String(value);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
}

/* =========================================================================
   BOOT
   ========================================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  AppState.patient = { ...PRESETS.healthy };
  syncWizardInputs();

  initEngine();
  bindWizard();
  bindLab();
  bindInfoTips();
  setLanguage("en");
  wizardShowStep(0, false);

  await fetchInitialData();
  renderDerivedEstimates(false);
  runSimulation({ animate: true });

  requestAnimationFrame(playbackLoop);
});

function initEngine() {
  const Ctor = window.Body3DSimulator || window.PharmacoBody3D;
  if (typeof Ctor !== "function") {
    console.warn("[engine] Body3DSimulator not available");
    return;
  }
  try {
    AppState.body3d = new Ctor(
      "body3d-canvas-container",
      (organKey) => { if (organKey) selectOrgan(organKey, true); },
      { onOrganHover: handleOrganHover, lang: AppState.lang }
    );
  } catch (err) {
    console.warn("[engine] init failed:", err);
    AppState.body3d = null;
  }
}

async function fetchInitialData() {
  try {
    const res = await fetch("/api/drugs");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    AppState.drugs = data.preset_drugs || [];
    AppState.novelSamples = data.novel_drug_samples || [];
    AppState.pgxLibrary = data.pgx_genotype_library || {};
    AppState.curriculum = { en: data.curriculum_context || "", ko: data.curriculum_context_ko || "" };
  } catch (err) {
    console.warn("Could not load drug catalog:", err);
    showToast(t("err.sim"), true);
    return;
  }
  renderDrugSelect();
  renderAf3Presets();
  renderCurriculum();
  renderPgxSequences();
  fetchAf3Manifest();
  await applyDrugSelection(AppState.selectedDrugKey, { resetDose: true });
}

async function fetchDrugDetail(id) {
  if (AppState.drugDetail[id]) return AppState.drugDetail[id];
  try {
    const res = await fetch(`/api/drugs/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const d = await res.json();
    AppState.drugDetail[id] = d;
    return d;
  } catch (err) {
    console.warn("Drug detail fetch failed:", err);
    return null;
  }
}

/* =========================================================================
   PATIENT MODEL (client-side preview mirrors backend/pkpd_engine.py)
   ========================================================================= */
function derivePatient(p) {
  const detail = AppState.drugDetail[AppState.selectedDrugKey];
  const pk = detail?.pk || FALLBACK_PK;
  const age = p.age, w = p.weight_kg, scr = Math.max(0.1, p.scr);
  let crcl = ((140 - age) * w) / (72 * scr) * (p.sex === "F" ? 0.85 : 1);
  crcl = Math.max(5, Math.min(220, crcl));
  const ws = w / 70;
  const vd = (pk.vc_l_per_70kg + pk.vp_l_per_70kg) * ws;
  const clBase = pk.cl_l_h_per_70kg * Math.pow(ws, 0.75);
  let hf = HEPATIC_FACTOR[p.hepatic] ?? 1;
  if (pk.cyp3a4_substrate) {
    if (p.cyp3a4 === "inhibited") hf *= 0.22;
    else if (p.cyp3a4 === "poor") hf *= 0.45;
  }
  const cl = Math.max(0.05, clBase * pk.fe_renal * (crcl / 100) + clBase * (1 - pk.fe_renal) * hf);
  const thalf = (0.693 * vd) / cl;
  return { crcl, vd, thalf };
}

function crclStatusKey(crcl) {
  if (crcl >= 90) return "crcl.normal";
  if (crcl >= 60) return "crcl.mild";
  if (crcl >= 30) return "crcl.moderate";
  return "crcl.severe";
}

function patientKey(p) {
  return JSON.stringify(p);
}

function patientPayload(p) {
  return {
    age: Math.round(p.age),
    sex: p.sex,
    weight_kg: p.weight_kg,
    height_cm: p.height_cm,
    serum_creatinine_mg_dl: p.scr,
    hepatic_function: p.hepatic,
    cyp2e1_phenotype: p.cyp2e1,
    cyp3a4_phenotype: p.cyp3a4,
    kcnh2_herg_variant: p.herg,
    g6pd_status: p.g6pd,
  };
}

/* =========================================================================
   WIZARD
   ========================================================================= */
const Wizard = { step: 0, last: 6, busy: false, open: true };
const WZ_NUMERIC = {
  "ob-age": { key: "age", min: 1, max: 110, step: 1 },
  "ob-weight": { key: "weight_kg", min: 20, max: 250, step: 2 },
  "ob-height": { key: "height_cm", min: 100, max: 230, step: 2 },
  "ob-scr": { key: "scr", min: 0.2, max: 15, step: 3 },
};

function wizardSteps() {
  return Array.from(document.querySelectorAll(".wz-step"));
}

function bindWizard() {
  // Numeric inputs: update model live
  Object.entries(WZ_NUMERIC).forEach(([id, cfg]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v) && v >= cfg.min && v <= cfg.max) {
        AppState.patient[cfg.key] = v;
        renderDerivedEstimates(false);
      }
      if (id === "ob-scr") updateScrGauge();
    });
  });

  // Radio-like choices (segmented controls and cards)
  document.querySelectorAll("#onboarding-screen [role=radiogroup][data-field]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (!btn || !group.contains(btn)) return;
      setChoice(group, btn.dataset.value);
    });
    group.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      const opts = Array.from(group.querySelectorAll("[data-value]"));
      const idx = opts.indexOf(document.activeElement);
      if (idx < 0) return;
      e.preventDefault();
      const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const next = opts[(idx + dir + opts.length) % opts.length];
      setChoice(group, next.dataset.value);
      next.focus();
    });
  });

  document.querySelectorAll("#onboarding-screen [data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  $("btn-wz-start")?.addEventListener("click", () => wizardGo(1));
  $("btn-wz-skip")?.addEventListener("click", () => closeWizard());
  $("btn-ob-skip")?.addEventListener("click", () => closeWizard());
  $("btn-wz-back")?.addEventListener("click", () => wizardBack());
  $("btn-wz-next")?.addEventListener("click", () => wizardNext());

  document.addEventListener("keydown", (e) => {
    if (!Wizard.open) return;
    const tgt = e.target;
    const isInput = tgt instanceof HTMLInputElement;
    if (e.key === "Enter") {
      // Let real action buttons (top bar, nav, intro) handle Enter themselves.
      const isActionButton = tgt instanceof HTMLButtonElement && !tgt.hasAttribute("data-value");
      if (isActionButton) return;
      e.preventDefault();
      wizardNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      wizardBack();
    } else if (e.key === "Backspace") {
      if (isInput && tgt.value !== "") return;
      if (tgt instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      wizardBack();
    }
  });
}

function setChoice(group, value) {
  const field = group.dataset.field;
  AppState.patient[field] = value;
  group.querySelectorAll("[data-value]").forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
  renderDerivedEstimates(false);
}

function syncWizardInputs() {
  const p = AppState.patient;
  Object.entries(WZ_NUMERIC).forEach(([id, cfg]) => {
    const el = $(id);
    if (el) el.value = p[cfg.key];
  });
  document.querySelectorAll("#onboarding-screen [role=radiogroup][data-field]").forEach((group) => {
    const v = p[group.dataset.field];
    group.querySelectorAll("[data-value]").forEach((b) => {
      const on = b.dataset.value === v;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  });
  updateScrGauge();
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  AppState.patient = { ...preset };
  syncWizardInputs();
  document.querySelectorAll("#onboarding-screen [data-preset]").forEach((b) => b.classList.toggle("is-on", b.dataset.preset === name));
  if (Wizard.step !== Wizard.last) wizardGo(Wizard.last);
  else renderDerivedEstimates(true);
}

function updateScrGauge() {
  const v = parseFloat($("ob-scr")?.value);
  const marker = $("scr-marker");
  if (!marker || !Number.isFinite(v)) return;
  // Scale: 0.4 → 0 %, 4.0 → 100 %
  const pct = Math.max(0, Math.min(100, ((v - 0.4) / 3.6) * 100));
  marker.style.left = `${pct}%`;
}

function validateStep(step) {
  const errEl = document.querySelector(`[data-error-for="${step}"]`);
  const ids = { 1: ["ob-age"], 2: ["ob-weight", "ob-height"], 3: ["ob-scr"] }[step] || [];
  for (const id of ids) {
    const cfg = WZ_NUMERIC[id];
    const el = $(id);
    const v = parseFloat(el?.value);
    if (!Number.isFinite(v) || v < cfg.min || v > cfg.max) {
      if (errEl) {
        errEl.textContent = t("wz.err.range", { min: cfg.min, max: cfg.max });
        errEl.hidden = false;
      }
      el?.focus();
      el?.select?.();
      return false;
    }
    AppState.patient[cfg.key] = v;
  }
  if (errEl) errEl.hidden = true;
  return true;
}

function wizardNext() {
  if (Wizard.busy) return;
  if (Wizard.step === Wizard.last) {
    closeWizard();
    return;
  }
  if (!validateStep(Wizard.step)) return;
  wizardGo(Wizard.step + 1);
}

function wizardBack() {
  if (Wizard.busy || Wizard.step === 0) return;
  wizardGo(Wizard.step - 1);
}

function wizardGo(next) {
  if (Wizard.busy || next === Wizard.step || next < 0 || next > Wizard.last) return;
  const steps = wizardSteps();
  const cur = steps[Wizard.step];
  const nxt = steps[next];
  const forward = next > Wizard.step;
  Wizard.busy = true;

  nxt.classList.remove("leave-up", "leave-down", "is-active");
  nxt.classList.add(forward ? "enter-below" : "enter-above");
  void nxt.offsetWidth; // commit start position before transitioning
  cur.classList.remove("is-active");
  cur.classList.add(forward ? "leave-up" : "leave-down");
  cur.inert = true;
  nxt.classList.remove("enter-below", "enter-above");
  nxt.classList.add("is-active");
  nxt.inert = false;

  Wizard.step = next;
  updateWizardChrome();
  focusStep(nxt);
  if (next === Wizard.last) renderDerivedEstimates(true);

  setTimeout(() => {
    cur.classList.remove("leave-up", "leave-down");
    Wizard.busy = false;
  }, STEP_MS);
}

function wizardShowStep(step, focus = true) {
  const steps = wizardSteps();
  steps.forEach((s, i) => {
    s.classList.remove("leave-up", "leave-down", "enter-below", "enter-above");
    s.classList.toggle("is-active", i === step);
    s.inert = i !== step;
  });
  Wizard.step = step;
  updateWizardChrome();
  if (focus) focusStep(steps[step]);
  if (step === Wizard.last) renderDerivedEstimates(true);
}

function focusStep(stepEl) {
  if (!stepEl) return;
  const input = stepEl.querySelector("input");
  if (input) {
    input.focus({ preventScroll: true });
    input.select?.();
    return;
  }
  const choice = stepEl.querySelector("[data-value].is-on") || stepEl.querySelector("[data-value]");
  if (choice) {
    choice.focus({ preventScroll: true });
    return;
  }
  const primary = stepEl.querySelector(".btn-primary");
  primary?.focus({ preventScroll: true });
}

function updateWizardChrome() {
  const s = Wizard.step;
  const fill = $("wz-progress-fill");
  if (fill) fill.style.width = `${(s / Wizard.last) * 100}%`;
  $("wz-nav")?.classList.toggle("is-hidden", s === 0);
  $("wz-readout")?.classList.toggle("is-visible", s >= 1 && s < Wizard.last);
  setText("wz-next-label", s === Wizard.last ? t("wz.enter") : t("wz.continue"));
}

function openWizard(step = 1) {
  syncWizardInputs();
  const ob = $("onboarding-screen");
  if (!ob) return;
  closeMenu();
  ob.hidden = false;
  ob.classList.add("is-opening");
  void ob.offsetWidth;
  ob.classList.remove("is-opening", "is-closing");
  Wizard.open = true;
  Wizard.busy = false;
  wizardShowStep(step, true);
  renderDerivedEstimates(false);
}

function closeWizard() {
  const ob = $("onboarding-screen");
  if (!ob || !Wizard.open) return;
  // Accept whatever valid values are in the current inputs.
  Object.entries(WZ_NUMERIC).forEach(([id, cfg]) => {
    const v = parseFloat($(id)?.value);
    if (Number.isFinite(v) && v >= cfg.min && v <= cfg.max) AppState.patient[cfg.key] = v;
  });
  Wizard.open = false;
  ob.classList.add("is-closing");
  setTimeout(() => {
    ob.classList.remove("is-closing");
    if (Wizard.open) return; // reopened during the fade-out
    ob.hidden = true;
    engine("onResize");
  }, STEP_MS);
  renderPatientCard();
  if (AppState.lastSimPatientKey !== patientKey(AppState.patient) || AppState.isNovel) {
    runSimulation({ animate: true });
  } else {
    engine("triggerAdministrationAnimation", routeAnimKey(AppState.selectedRoute));
  }
}

// Live readout + summary step
const countState = new WeakMap();
function animateNumber(el, to, decimals) {
  if (!el) return;
  const from = countState.get(el) ?? 0;
  countState.set(el, to);
  if (REDUCED_MOTION || Math.abs(to - from) < 1e-9) {
    el.textContent = to.toFixed(decimals);
    return;
  }
  const start = performance.now();
  const dur = 700;
  const tick = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (to - from) * e).toFixed(decimals);
    if (k < 1 && countState.get(el) === to) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderDerivedEstimates(animateSummary) {
  if (!AppState.patient) return;
  const d = derivePatient(AppState.patient);
  const drugName = drugShortName(currentDrug()) || (AppState.lang === "ko" ? "아세트아미노펜" : "Acetaminophen");
  setText("ro-title", t("ro.title", { drug: drugName }));
  setText("ro-crcl", d.crcl.toFixed(0));
  setText("ro-vd", d.vd.toFixed(1));
  setText("ro-thalf", d.thalf.toFixed(1));

  setText("wz-summary-help", t("wz.s6.help", { drug: drugName }));
  setText("sum-crcl-text", t("sent.crcl", { v: d.crcl.toFixed(0), s: t(crclStatusKey(d.crcl)) }));
  setText("sum-vd-text", t("sent.vd", { drug: drugName, v: d.vd.toFixed(1) }));
  setText("sum-thalf-text", t("sent.thalf", { v: d.thalf.toFixed(1) }));
  const crclEl = $("sum-crcl");
  if (crclEl) crclEl.className = `mono ${d.crcl < 30 ? "txt-danger" : d.crcl < 60 ? "txt-caution" : ""}`;
  if (animateSummary) {
    animateNumber($("sum-crcl"), d.crcl, 0);
    animateNumber($("sum-vd"), d.vd, 1);
    animateNumber($("sum-thalf"), d.thalf, 1);
  } else {
    [["sum-crcl", d.crcl, 0], ["sum-vd", d.vd, 1], ["sum-thalf", d.thalf, 1]].forEach(([id, v, dp]) => {
      const el = $(id);
      if (el) { el.textContent = v.toFixed(dp); countState.set(el, v); }
    });
  }
}

/* =========================================================================
   LAB BINDINGS
   ========================================================================= */
function bindLab() {
  // View toggle
  $("view-toggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    AppState.viewMode = btn.dataset.view;
    setSegValue($("view-toggle"), "data-view", AppState.viewMode);
    engine("setViewMode", AppState.viewMode);
  });

  $("btn-camera-macro")?.addEventListener("click", () => {
    if (typeof AppState.body3d?.resetCameraMacroView === "function") engine("resetCameraMacroView");
    else engine("resetCamera");
  });

  document.querySelectorAll(".js-lang-toggle").forEach((b) =>
    b.addEventListener("click", () => setLanguage(AppState.lang === "en" ? "ko" : "en"))
  );

  // Overflow menu
  $("btn-overflow")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("overflow-menu");
    if (menu.hidden) openMenu(); else closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) closeMenu();
  });
  $("btn-alphafold-modal")?.addEventListener("click", () => { closeMenu(); openModal("modal-alphafold"); });
  $("btn-curriculum-modal")?.addEventListener("click", () => { closeMenu(); openModal("modal-curriculum"); });
  $("btn-open-onboarding")?.addEventListener("click", () => openWizard(1));
  $("btn-edit-patient")?.addEventListener("click", () => openWizard(1));

  document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal(b.dataset.close))
  );
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("mousedown", (e) => { if (e.target === m) closeModal(m.id); })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || Wizard.open) return;
    if (!$("overflow-menu").hidden) { closeMenu(); $("btn-overflow")?.focus(); return; }
    const open = document.querySelector(".modal:not([hidden])");
    if (open) closeModal(open.id);
  });

  // Panels
  document.querySelectorAll(".panel-handle").forEach((h) =>
    h.addEventListener("click", () => togglePanel(h.dataset.panel))
  );

  // Regimen
  $("drug-select")?.addEventListener("change", async (e) => {
    await applyDrugSelection(e.target.value, { resetDose: true });
    runSimulation({ animate: true });
  });

  $("route-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-route]");
    if (!btn) return;
    AppState.selectedRoute = btn.dataset.route;
    setSegValue($("route-seg"), "data-route", AppState.selectedRoute);
    renderTopSummary();
    runSimulation({ animate: true });
  });

  const slider = $("dose-slider");
  slider?.addEventListener("input", () => {
    AppState.doseMg = parseFloat(slider.value);
    updateDoseLabel();
  });
  slider?.addEventListener("change", () => runSimulation({ animate: false }));

  $("dose-marks")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mark]");
    if (!btn) return;
    const marks = doseMarks();
    if (!marks) return;
    AppState.doseMg = marks[btn.dataset.mark];
    if (slider) slider.value = AppState.doseMg;
    updateDoseLabel();
    runSimulation({ animate: true });
  });

  $("interval-select")?.addEventListener("change", (e) => {
    AppState.intervalHours = parseFloat(e.target.value);
    renderTopSummary();
    runSimulation({ animate: false });
  });
  $("num-doses-select")?.addEventListener("change", (e) => {
    AppState.numDoses = parseInt(e.target.value, 10);
    renderTopSummary();
    runSimulation({ animate: false });
  });
  $("btn-administer")?.addEventListener("click", () => runSimulation({ animate: true }));

  // Organs
  $("organ-list")?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-organ]");
    if (row) selectOrgan(row.dataset.organ, true);
  });
  $("organ-list")?.addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-organ]");
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectOrgan(row.dataset.organ, true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
      sib?.focus();
    }
  });

  document.querySelectorAll(".tabs [data-tab]").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab))
  );

  $("struct-source-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-source]");
    if (!btn) return;
    AppState.structSource[AppState.selectedOrgan] = btn.dataset.source;
    loadReceptorForOrgan(AppState.selectedOrgan);
  });

  $("mol-style-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-molstyle]");
    if (!btn) return;
    AppState.currentMolStyle = btn.dataset.molstyle;
    setSegValue($("mol-style-seg"), "data-molstyle", AppState.currentMolStyle);
    applyReceptorStyle(AppState.currentMolStyle);
  });

  $("chart-mode-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-chartmode]");
    if (!btn) return;
    AppState.chartMode = btn.dataset.chartmode;
    setSegValue($("chart-mode-seg"), "data-chartmode", AppState.chartMode);
    updatePkPdChart();
  });

  // Sign-off
  const chk = $("chk-clinical-verify");
  const name = $("reviewer-name");
  const refreshApprove = () => {
    const btn = $("btn-approve");
    if (btn) btn.disabled = !(AppState.simData && chk.checked && name.value.trim()) || !!AppState.approval;
  };
  chk?.addEventListener("change", refreshApprove);
  name?.addEventListener("input", refreshApprove);
  AppState.refreshApprove = refreshApprove;
  $("btn-approve")?.addEventListener("click", approveProtocol);
  $("btn-export-report")?.addEventListener("click", exportVerifiedProtocol);

  // Timeline
  $("btn-play-pause")?.addEventListener("click", () => setPlaying(!AppState.isPlaying));
  $("btn-reset-time")?.addEventListener("click", () => {
    AppState.currentStepIdx = 0;
    updateTimeStepView(0);
    engine("triggerAdministrationAnimation", routeAnimKey(AppState.selectedRoute));
    setPlaying(true);
  });
  $("playback-speed")?.addEventListener("change", (e) => { AppState.playbackSpeed = parseFloat(e.target.value) || 1; });
  $("time-scrubber")?.addEventListener("input", (e) => {
    setPlaying(false);
    AppState.currentStepIdx = parseInt(e.target.value, 10) || 0;
    updateTimeStepView(AppState.currentStepIdx);
  });

  // AF3 modal
  $("af3-presets")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-sample]");
    if (!chip) return;
    const s = AppState.novelSamples.find((x) => x.id === chip.dataset.sample);
    if (!s) return;
    $("af3-drug-name").value = s.name.split(" (")[0];
    $("af3-smiles").value = s.smiles;
    document.querySelectorAll("#af3-presets .chip").forEach((c) => c.classList.toggle("is-on", c === chip));
  });
  $("btn-run-af3-sim")?.addEventListener("click", runAlphaFold3Approximation);
  $("btn-af3-download")?.addEventListener("click", () => {
    const r = AppState.af3Result;
    if (!r?.af3_job_spec) return;
    downloadJson(r.af3_job_spec, `${r.af3_job_spec.name || "af3_job"}.json`);
  });
  $("btn-af3-open")?.addEventListener("click", () => {
    const r = AppState.af3Result;
    if (!r) return;
    closeModal("modal-alphafold");
    AppState.isNovel = true;
    applySimulationResult(r, true);
    showToast(t("toast.novel", { name: r.simulation?.drug_name || "" }));
  });

  window.addEventListener("resize", () => {
    engine("onResize");
    AppState.drugViewer3D?.resize();
    AppState.receptorViewer3D?.resize();
  });
}

function openMenu() {
  const menu = $("overflow-menu");
  menu.hidden = false;
  $("btn-overflow")?.setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
}

function closeMenu() {
  const menu = $("overflow-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("btn-overflow")?.setAttribute("aria-expanded", "false");
}

function openModal(id) {
  const m = $(id);
  if (!m) return;
  if (id === "modal-alphafold") renderAf3RegimenNote();
  m.hidden = false;
  m.querySelector("input, .btn-primary, button")?.focus();
}

function closeModal(id) {
  const m = $(id);
  if (m) m.hidden = true;
}

function togglePanel(id, forceOpen = false) {
  const panel = $(id);
  if (!panel) return;
  const collapse = forceOpen ? false : !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", collapse);
  panel.querySelector(".panel-handle")?.setAttribute("aria-expanded", collapse ? "false" : "true");
  const stage = $("sim-stage");
  stage?.classList.toggle(id === "panel-regimen" ? "left-collapsed" : "right-collapsed", collapse);
}

function setPlaying(on) {
  AppState.isPlaying = on;
  const btn = $("btn-play-pause");
  if (!btn) return;
  btn.innerHTML = `<svg class="ic"><use href="#${on ? "i-pause" : "i-play"}"/></svg>`;
  btn.title = on ? t("tl.pause") : t("tl.play");
  btn.setAttribute("aria-label", btn.title);
}

/* =========================================================================
   REGIMEN
   ========================================================================= */
function renderDrugSelect() {
  const sel = $("drug-select");
  if (!sel) return;
  sel.innerHTML = AppState.drugs
    .map((d) => `<option value="${d.id}">${escapeHtml(drugShortName(d))}</option>`)
    .join("");
  sel.value = AppState.selectedDrugKey;
}

async function applyDrugSelection(id, { resetDose }) {
  AppState.selectedDrugKey = id;
  const drug = currentDrug();
  if (!drug) return;
  if (resetDose) {
    AppState.doseMg = drug.recommended_dose_mg;
    AppState.selectedRoute = drug.default_route || "oral";
  }
  setSegValue($("route-seg"), "data-route", AppState.selectedRoute);
  const sel = $("drug-select");
  if (sel && sel.value !== id) sel.value = id;
  renderDrugDescription();
  configureDoseSlider();
  renderTopSummary();
  const detail = await fetchDrugDetail(id);
  renderDerivedEstimates(false);
  loadDrug3DMolecule(detail || drug);
}

function renderDrugDescription() {
  const drug = currentDrug();
  if (!drug) return;
  const blurb = (DRUG_BLURBS[AppState.lang] || DRUG_BLURBS.en)[drug.id] || drug.drug_class;
  setText("drug-desc", blurb);
}

function doseStep(rec) {
  if (rec < 100) return 5;
  if (rec < 400) return 10;
  return 50;
}

function doseMarks() {
  const drug = currentDrug();
  if (!drug) return null;
  const step = doseStep(drug.recommended_dose_mg);
  const ther = drug.recommended_dose_mg;
  const toxic = drug.toxic_demo_dose_mg;
  const high = Math.round((ther + toxic) / 2 / step) * step;
  return { ther, high, toxic, step };
}

function configureDoseSlider() {
  const drug = currentDrug();
  const slider = $("dose-slider");
  const m = doseMarks();
  if (!drug || !slider || !m) return;
  const min = Math.max(m.step, Math.round((m.ther * 0.2) / m.step) * m.step);
  const max = Math.round((m.toxic * 1.5) / m.step) * m.step;
  slider.min = min;
  slider.max = max;
  slider.step = m.step;
  slider.value = AppState.doseMg;
  const pos = (v) => ((v - min) / (max - min)) * 100;
  const track = $("dose-track");
  if (track) {
    const [a, b] = [pos(m.high), pos(m.toxic)];
    track.querySelector(".seg-safe").style.width = `${a}%`;
    track.querySelector(".seg-high").style.width = `${b - a}%`;
    track.querySelector(".seg-toxic").style.width = `${100 - b}%`;
  }
  const ticks = $("dose-ticks");
  if (ticks) {
    ticks.innerHTML = [m.ther, m.high, m.toxic]
      .map((v) => `<span class="dose-tick" style="left:${pos(v)}%">${v}</span>`)
      .join("");
  }
  updateDoseLabel();
}

function updateDoseLabel() {
  setText("dose-val-label", `${AppState.doseMg} mg`);
  const m = doseMarks();
  document.querySelectorAll("#dose-marks [data-mark]").forEach((b) =>
    b.classList.toggle("is-on", !!m && m[b.dataset.mark] === AppState.doseMg)
  );
  renderTopSummary();
}

function regimenText() {
  const route = t(`route.${AppState.selectedRoute}`);
  let s = `${AppState.doseMg} mg · ${route}`;
  if (AppState.numDoses > 1) s += ` · q${AppState.intervalHours}h ×${AppState.numDoses}`;
  return s;
}

function renderTopSummary() {
  const el = $("hud-active-summary");
  if (!el) return;
  let name;
  if (AppState.isNovel && AppState.simData?.simulation) {
    name = AppState.simData.simulation.drug_name.split(" (")[0];
  } else {
    name = drugShortName(currentDrug()) || "—";
  }
  el.innerHTML = `<span>${escapeHtml(name)}</span> · <span class="mono">${escapeHtml(regimenText())}</span>`;
}

function renderPatientCard() {
  const p = AppState.patient;
  if (!p) return;
  setText("patient-summary", t("pt.line", {
    age: Math.round(p.age),
    sex: p.sex === "F" ? t("opt.female") : t("opt.male"),
    w: p.weight_kg,
    h: p.height_cm,
    scr: p.scr,
    liver: t(`liver.short.${p.hepatic}`),
  }));
  const genes = [];
  if (p.cyp2e1 !== "normal") genes.push(`CYP2E1 · ${t("opt." + p.cyp2e1)}`);
  if (p.cyp3a4 !== "normal") genes.push(`CYP3A4 · ${t("opt." + p.cyp3a4)}`);
  if (p.herg !== "wildtype") genes.push(`hERG · ${t("opt.lqt2")}`);
  if (p.g6pd !== "normal") genes.push(`G6PD · ${t("opt.deficient")}`);
  const box = $("patient-genes");
  if (box) {
    box.innerHTML = genes.length
      ? genes.map((g) => `<span class="tag caution">${escapeHtml(g)}</span>`).join("")
      : `<span class="tag">${escapeHtml(t("pt.typical"))}</span>`;
  }
  renderPgxSequences();
}

function renderPgxSequences() {
  const box = $("pgx-sequence-detail");
  const lib = AppState.pgxLibrary;
  const p = AppState.patient;
  if (!box || !lib || !p) return;
  const isKo = AppState.lang === "ko";
  const rows = [
    ["CYP2E1", lib.cyp2e1?.[p.cyp2e1]],
    ["CYP3A4", lib.cyp3a4?.[p.cyp3a4]],
    ["hERG", lib.herg?.[p.herg]],
    ["G6PD", lib.g6pd?.[p.g6pd]],
  ].filter(([, v]) => v);
  box.innerHTML = rows
    .map(([gene, v]) => `
      <div class="seq-item">
        <b>${gene}</b> · ${escapeHtml(v.allele || "")}<br/>
        <span class="muted">${escapeHtml(v.rsid || "")}</span><br/>
        <code>${escapeHtml(v.var_seq || v.wt_seq || "")}</code><br/>
        ${escapeHtml(isKo ? v.desc_ko || v.desc_en || "" : v.desc_en || "")}
      </div>`)
    .join("");
}

/* =========================================================================
   SIMULATION
   ========================================================================= */
let simRequestToken = 0;
async function runSimulation({ animate = true } = {}) {
  if (!AppState.drugs.length || !AppState.patient) return;
  const payload = {
    drug_id: AppState.selectedDrugKey,
    route: AppState.selectedRoute,
    dose_mg: AppState.doseMg,
    interval_h: AppState.intervalHours,
    num_doses: AppState.numDoses,
    duration_h: 24,
    patient: patientPayload(AppState.patient),
  };
  const patientSnapshot = patientKey(AppState.patient);
  const token = ++simRequestToken;
  setSimBusy(true);
  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (token !== simRequestToken) return; // a newer request superseded this one
    AppState.isNovel = false;
    AppState.lastSimPatientKey = patientSnapshot;
    applySimulationResult(data, animate);
  } catch (err) {
    if (token !== simRequestToken) return;
    console.warn("Simulation request failed:", err);
    showToast(t("err.sim"), true);
  } finally {
    if (token === simRequestToken) setSimBusy(false);
  }
}

function setSimBusy(on) {
  AppState.simBusy = on;
  const btn = $("btn-administer");
  if (btn) btn.disabled = on;
  setText("lbl-btn-administer", on ? t("reg.running") : t("reg.run"));
}

function applySimulationResult(data, animate = true) {
  if (!data?.simulation) return;
  AppState.simData = data;
  AppState.approval = null;
  resetSignoff();

  const sim = data.simulation;
  const pc = sim.patient_computed || {};
  setText("stat-crcl", `${fmt(pc.crcl_ml_min, 0)} mL/min`);
  setText("stat-vd", `${fmt((pc.vc_l || 0) + (pc.vp_l || 0), 1)} L`);
  setText("stat-thalf", `${fmt(pc.t_half_eff_h, 1)} h`);

  const n = sim.timeline?.time_h?.length || 0;
  const scrub = $("time-scrubber");
  if (scrub) scrub.max = Math.max(0, n - 1);
  const tEnd = n ? sim.timeline.time_h[n - 1] : 24;
  setText("time-end-label", `${fmt(tEnd, 0)} h`);

  renderTopSummary();
  renderPatientCard();
  renderSafetyPill();
  renderOrganList();
  renderOrganDetail();
  renderReview();
  updatePkPdChart();
  if (AppState.activeTab === "structure") loadReceptorForOrgan(AppState.selectedOrgan);

  if (animate) {
    AppState.currentStepIdx = 0;
    setPlaying(true);
    engine("triggerAdministrationAnimation", routeAnimKey(sim.route || AppState.selectedRoute));
  }
  AppState.currentStepIdx = Math.min(AppState.currentStepIdx, Math.max(0, n - 1));
  updateTimeStepView(AppState.currentStepIdx);
}

function renderSafetyPill() {
  const el = $("overall-safety-pill");
  const s = AppState.simData?.simulation?.pk_summary?.overall_safety_status;
  if (!el) return;
  el.classList.remove("safe", "caution", "danger");
  if (!s) { el.textContent = "—"; return; }
  if (s.includes("CRITICAL")) { el.textContent = t("safety.critical"); el.classList.add("danger"); }
  else if (s.includes("ELEVATED")) { el.textContent = t("safety.elevated"); el.classList.add("caution"); }
  else { el.textContent = t("safety.safe"); el.classList.add("safe"); }
}

function renderOrganList() {
  const list = $("organ-list");
  const organs = AppState.simData?.simulation?.organs;
  if (!list) return;
  const keys = ORGAN_KEYS.filter((k) => !organs || organs[k]);
  const sorted = organs ? keys.sort((a, b) => (organs[b].peak_risk_pct || 0) - (organs[a].peak_risk_pct || 0)) : keys;
  list.innerHTML = sorted
    .map((k) => {
      const pct = organs?.[k]?.peak_risk_pct ?? 0;
      const lvl = riskLevel(pct);
      const on = k === AppState.selectedOrgan;
      return `<li class="organ-row${on ? " is-on" : ""}" data-organ="${k}" role="option" tabindex="0" aria-selected="${on}">
        <span class="on-name">${escapeHtml(organName(k))}</span>
        <span class="on-bar"><span class="on-fill fill-${lvl}" style="width:${Math.min(100, pct)}%"></span></span>
        <span class="on-pct mono">${fmt(pct, pct >= 10 ? 0 : 1)}%</span>
      </li>`;
    })
    .join("");
}

function selectOrgan(organKey, focusCamera = true) {
  if (!ORGAN_KEYS.includes(organKey)) return;
  AppState.selectedOrgan = organKey;
  document.querySelectorAll("#organ-list [data-organ]").forEach((r) => {
    const on = r.dataset.organ === organKey;
    r.classList.toggle("is-on", on);
    r.setAttribute("aria-selected", on ? "true" : "false");
  });
  if ($("panel-organs")?.classList.contains("is-collapsed")) togglePanel("panel-organs", true);
  renderOrganDetail();
  updatePkPdChart();
  if (AppState.activeTab === "structure") loadReceptorForOrgan(organKey);

  if (focusCamera) {
    if (typeof AppState.body3d?.focusOrgan === "function") engine("focusOrgan", organKey);
    else engine("warpToOrgan", organKey);
  }
  engine("highlightOrgan", organKey);
  const rec = ORGAN_RECEPTORS[organKey];
  const risk = AppState.simData?.simulation?.organs?.[organKey]?.peak_risk_pct || 0;
  engine("updateAlphaFoldTargetHologram", organKey, `${rec.afId} · ${rec.name}`, risk);
}

function renderOrganDetail() {
  const key = AppState.selectedOrgan;
  setText("detail-organ-name", organName(key));
  const info = AppState.simData?.simulation?.organs?.[key];
  const badge = $("detail-organ-risk-badge");
  if (!info) {
    if (badge) badge.textContent = "—";
    return;
  }
  const isKo = AppState.lang === "ko";
  const pct = info.peak_risk_pct || 0;
  const lvl = riskLevel(pct);
  if (badge) {
    badge.className = `risk-badge ${lvl}`;
    badge.textContent = riskLevelLabel(pct);
  }
  setText("detail-risk-num", fmt(pct, 1));
  const bar = $("detail-organ-risk-bar");
  if (bar) {
    bar.style.width = `${Math.min(100, pct)}%`;
    bar.style.background = `var(--${lvl === "safe" ? "safe" : lvl === "caution" ? "caution" : "danger"})`;
  }
  setText("detail-organ-cmax", `${fmt(info.peak_conc_mg_l)} mg/L`);
  setText("detail-organ-thresh", `${fmt(info.ec50_tox_mg_l)} mg/L`);
  setText("detail-organ-peak-t", `${fmt(info.peak_time_h, 1)} h`);
  const ratio = info.ec50_tox_mg_l ? info.peak_conc_mg_l / info.ec50_tox_mg_l : 0;
  const rf = $("detail-ratio-fill");
  if (rf) {
    // 50 % of the bar = EC50 (ratio 1); full bar = 2× EC50
    rf.style.width = `${Math.min(100, ratio * 50)}%`;
    rf.style.background = ratio >= 1 ? "var(--danger)" : ratio >= 0.5 ? "var(--caution)" : "var(--text-2)";
  }
  setText("detail-ratio-text", t("ov.ratio", { r: fmt(ratio, 2) }));
  setText("detail-organ-mechanism", isKo ? info.mechanism_ko || info.primary_mechanism : info.primary_mechanism);
  const bm = $("detail-organ-biomarkers");
  if (bm) bm.innerHTML = (info.biomarkers || []).map((b) => `<span class="tag">${escapeHtml(b)}</span>`).join("");
  setText("detail-organ-pathway", info.lecture_pathway || "");

  // Structure tab text (viewer loads lazily)
  setText("receptor-name", receptorTitle(key));
  const s3 = AppState.simData.simulation.structure_3d || {};
  const th = AppState.simData.simulation.thermodynamics || {};
  setText("binding-target", [s3.target_protein, s3.pdb_id ? `PDB ${s3.pdb_id}` : ""].filter(Boolean).join(" · ") || "—");
  setText("binding-dg", th.delta_g_kcal_mol !== undefined ? `${fmt(th.delta_g_kcal_mol, 2)} kcal/mol` : "—");
  setText("binding-kd", th.kd_um !== undefined ? `${fmt(th.kd_um)} µM` : "—");

  const pk = AppState.simData.simulation.pk_summary || {};
  setText("chart-stat-cmax", `${fmt(pk.cmax_mg_l)} mg/L`);
  setText("chart-stat-tmax", `${fmt(pk.tmax_h, 1)} h`);
  setText("chart-stat-auc", `${fmt(pk.auc_0_t_mg_h_l)} mg·h/L`);
}

function showTab(tab) {
  AppState.activeTab = tab;
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  ["overview", "structure", "curves", "review"].forEach((name) => {
    const pane = $(`tab-${name}`);
    if (pane) pane.hidden = name !== tab;
  });
  if (tab === "structure") loadReceptorForOrgan(AppState.selectedOrgan);
  else AppState.receptorViewer3D?.spin(false); // hidden container: stop rendering into a zero-size canvas
  if (tab === "curves") {
    if (!AppState.pkChart) initPkPdChart();
    updatePkPdChart();
    AppState.pkChart?.resize();
  }
}

/* =========================================================================
   PLAYBACK
   ========================================================================= */
function playbackLoop(timestamp) {
  if (!AppState.lastFrameTime) AppState.lastFrameTime = timestamp;
  const elapsed = timestamp - AppState.lastFrameTime;
  const total = AppState.simData?.simulation?.timeline?.time_h?.length || 0;
  if (AppState.isPlaying && total > 0 && elapsed > 85 / AppState.playbackSpeed) {
    AppState.lastFrameTime = timestamp;
    AppState.currentStepIdx = (AppState.currentStepIdx + 1) % total;
    updateTimeStepView(AppState.currentStepIdx);
  }
  requestAnimationFrame(playbackLoop);
}

function phaseKey(tH) {
  if (tH < 1.5) return "phase.abs";
  if (tH < 6) return "phase.dist";
  if (tH < 14) return "phase.met";
  return "phase.elim";
}

function updateTimeStepView(stepIdx) {
  const sim = AppState.simData?.simulation;
  const tl = sim?.timeline;
  if (!tl?.time_h?.length) return;
  const i = Math.max(0, Math.min(stepIdx, tl.time_h.length - 1));
  const tH = tl.time_h[i] || 0;
  const plasma = tl.central_conc_mg_l?.[i] || 0;

  const scrub = $("time-scrubber");
  if (scrub) {
    scrub.value = i;
    scrub.style.setProperty("--p", `${(i / Math.max(1, tl.time_h.length - 1)) * 100}%`);
  }
  setText("time-current-label", `t ${tH.toFixed(1)} h`);
  setText("live-plasma-conc", `${fmt(plasma)} mg/L`);
  setText("phase-status-label", t(phaseKey(tH)));

  const riskNow = {};
  const concNow = {};
  Object.entries(sim.organs || {}).forEach(([k, o]) => {
    riskNow[k] = o.toxicity_risk_series?.[i] || 0;
    concNow[k] = o.concentration_series?.[i] || 0;
  });
  const cmax = Math.max(1e-6, sim.pk_summary?.cmax_mg_l || 0);
  engine("updateOrganStates", riskNow, concNow, Math.max(0, Math.min(1, plasma / cmax)));
  if (hoverState.organ) renderHoverTip();
}

/* =========================================================================
   ORGAN HOVER TOOLTIP (engine callback)
   ========================================================================= */
const hoverState = { organ: null, x: 0, y: 0 };
function handleOrganHover(organKey, pos) {
  hoverState.organ = organKey || null;
  if (pos) { hoverState.x = pos.x; hoverState.y = pos.y; }
  renderHoverTip();
}

function renderHoverTip() {
  const tip = $("organ-tooltip");
  if (!tip) return;
  const key = hoverState.organ;
  if (!key) { tip.hidden = true; return; }
  const o = AppState.simData?.simulation?.organs?.[key];
  const i = AppState.currentStepIdx;
  const now = o?.toxicity_risk_series?.[i];
  const conc = o?.concentration_series?.[i];
  const peak = o?.peak_risk_pct;
  const lvl = riskLevel(peak || 0);
  tip.innerHTML = `
    <div class="ht-name"><span>${escapeHtml(organName(key))}</span>${o ? `<span class="txt-${lvl}">${escapeHtml(riskLevelLabel(peak))}</span>` : ""}</div>
    ${o ? `
      <div class="ht-row"><span>${escapeHtml(t("hover.now"))}</span><span class="mono">${fmt(now, 1)}%</span></div>
      <div class="ht-row"><span>${escapeHtml(t("hover.peak"))}</span><span class="mono">${fmt(peak, 1)}%</span></div>
      <div class="ht-row"><span>${escapeHtml(t("hover.conc"))}</span><span class="mono">${fmt(conc)} mg/L</span></div>` : ""}
    <div class="ht-foot">${escapeHtml(t("hover.click"))}</div>`;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = hoverState.x + 14, y = hoverState.y + 14;
  if (x + w > window.innerWidth - 8) x = hoverState.x - w - 14;
  if (y + h > window.innerHeight - 8) y = hoverState.y - h - 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

/* =========================================================================
   INFO TOOLTIPS
   ========================================================================= */
function bindInfoTips() {
  const pop = $("info-pop");
  const show = (btn) => {
    const key = btn.dataset.tip;
    const html = (TIPS[AppState.lang] || TIPS.en)[key] || TIPS.en[key];
    if (!html || !pop) return;
    pop.innerHTML = html;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  };
  const hide = () => { if (pop) pop.hidden = true; };
  document.addEventListener("mouseover", (e) => {
    const btn = e.target.closest?.(".info[data-tip]");
    if (btn) show(btn);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest?.(".info[data-tip]")) hide();
  });
  document.addEventListener("focusin", (e) => {
    const btn = e.target.closest?.(".info[data-tip]");
    if (btn) show(btn); else hide();
  });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".info[data-tip]");
    if (btn) { e.preventDefault(); show(btn); }
  });
  window.addEventListener("scroll", hide, true);
}

/* =========================================================================
   3DMOL VIEWERS
   ========================================================================= */
function ensureDrugViewer() {
  if (AppState.drugViewer3D || !window.$3Dmol) return AppState.drugViewer3D;
  const el = $("drug-mol-viewer");
  if (!el) return null;
  AppState.drugViewer3D = $3Dmol.createViewer(el, { backgroundColor: "#0d0d0f", antialias: true });
  return AppState.drugViewer3D;
}

let drugLoadToken = 0;
async function loadDrug3DMolecule(drug) {
  const viewer = ensureDrugViewer();
  if (!viewer || !drug) return;
  const token = ++drugLoadToken;
  setText("mol-formula-label", drug.mw_g_mol ? `${drug.mw_g_mol} g/mol` : "");
  setText("drug-mol-tag", t("mol.loading"));
  const cid = drug.pubchem_cid;
  if (!cid) {
    viewer.clear();
    viewer.render();
    setText("drug-mol-tag", t("mol.none"));
    return;
  }
  const is2d = PUBCHEM_2D_ONLY.has(cid);
  try {
    const res = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=${is2d ? "2d" : "3d"}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sdf = await res.text();
    if (token !== drugLoadToken) return;
    viewer.clear();
    viewer.resize();
    viewer.addModel(sdf, "sdf");
    viewer.setStyle({}, { stick: { radius: 0.14, colorscheme: "whiteCarbon" }, sphere: { scale: 0.22, colorscheme: "whiteCarbon" } });
    viewer.zoomTo();
    viewer.zoom(1.15);
    viewer.render();
    viewer.spin("y", 0.5);
    setText("drug-mol-tag", t(is2d ? "mol.2d" : "mol.3d", { cid }));
  } catch (err) {
    if (token !== drugLoadToken) return;
    viewer.clear();
    viewer.render();
    setText("drug-mol-tag", t("mol.none"));
  }
}

function ensureReceptorViewer() {
  if (AppState.receptorViewer3D || !window.$3Dmol) return AppState.receptorViewer3D;
  const el = $("receptor-pdb-viewer");
  if (!el || el.offsetWidth === 0) return null;
  AppState.receptorViewer3D = $3Dmol.createViewer(el, { backgroundColor: "#0d0d0f", antialias: true });
  return AppState.receptorViewer3D;
}

// AlphaFold Server (AF3) predictions are optional static assets; absent manifest = feature hidden.
async function fetchAf3Manifest() {
  try {
    const res = await fetch("/static/assets/af3_server/manifest.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== "object") return;
    AppState.af3Manifest = data;
  } catch (err) {
    return;
  }
  setText("receptor-name", receptorTitle(AppState.selectedOrgan));
  if (AppState.activeTab === "structure") loadReceptorForOrgan(AppState.selectedOrgan);
}

function af3Entry(organKey) {
  const e = AppState.af3Manifest?.[organKey];
  return e && e.cif_url ? e : null;
}

function structureSource(organKey) {
  return af3Entry(organKey) ? AppState.structSource[organKey] || "af3" : "afdb";
}

function receptorTitle(organKey) {
  const rec = ORGAN_RECEPTORS[organKey] || ORGAN_RECEPTORS.liver;
  const e = af3Entry(organKey);
  if (e?.title && structureSource(organKey) === "af3") return e.title;
  return `${rec.name} · UniProt ${rec.uniprot}`;
}

function renderStructureSourceSeg(organKey) {
  const seg = $("struct-source-seg");
  if (!seg) return;
  const has = !!af3Entry(organKey);
  seg.hidden = !has;
  if (has) setSegValue(seg, "data-source", structureSource(organKey));
}

function renderReceptorCaption() {
  const st = AppState.receptorState;
  if (!st.organ) return;
  const rec = ORGAN_RECEPTORS[st.organ] || ORGAN_RECEPTORS.liver;
  const e = af3Entry(st.organ);
  let txt;
  if (st.status === "loading") txt = t("st.loading", { id: st.src === "af3" ? e?.title || "AlphaFold 3" : rec.afId });
  else if (st.status === "failed") txt = t("st.failed");
  else if (st.src === "af3") {
    const num = (v) => (v === null || v === undefined ? "—" : fmt(v, 2));
    txt = t("st.af3caption", { date: e?.run_date || "—", iptm: num(e?.iptm), ptm: num(e?.ptm) });
  } else if (st.status === "rcsb") txt = t("st.rcsb", { id: rec.rcsb });
  else txt = t("st.loaded", { id: rec.afId, n: rec.residues });
  setText("receptor-overlay-tag", txt);
  setText("receptor-name", receptorTitle(st.organ));
  const lg = $("af3-ligand-legend");
  if (lg) {
    const show = st.src === "af3" && st.status === "loaded" && st.ligands.length > 0;
    lg.innerHTML = show
      ? st.ligands.map((l) => `<span class="lg"><i style="background:${l.color}"></i><span class="mono">${escapeHtml(l.resn)}</span></span>`).join("")
      : "";
    lg.hidden = !show;
  }
}

// Neutral first, amber second, then muted variants for any further ligands/ions.
const LIGAND_COLORS = ["#e4e4e7", "#f59e0b", "#a1a1aa", "#fcd34d", "#71717a"];
function collectLigands(viewer, entry) {
  let het = viewer.selectedAtoms({ hetflag: true }).filter((a) => a.resn && a.resn !== "HOH");
  if (!het.length && Array.isArray(entry.ligands) && entry.ligands.length) {
    het = viewer.selectedAtoms({ resn: entry.ligands });
  }
  const found = [...new Set(het.map((a) => a.resn.trim()))];
  const preferred = (entry.ligands || []).filter((r) => found.includes(r));
  const ordered = [...preferred, ...found.filter((r) => !preferred.includes(r))];
  return ordered.map((resn, i) => ({ resn, color: LIGAND_COLORS[i % LIGAND_COLORS.length] }));
}

let receptorToken = 0;
async function loadReceptorForOrgan(organKey) {
  const rec = ORGAN_RECEPTORS[organKey] || ORGAN_RECEPTORS.liver;
  const src = structureSource(organKey);
  renderStructureSourceSeg(organKey);
  fetchAlphaFoldDbMeta(organKey);
  const viewer = ensureReceptorViewer();
  if (!viewer) return;
  viewer.resize();
  const key = `${organKey}:${src}`;
  if (AppState.receptorState.key === key) {
    viewer.render();
    viewer.spin("y", 0.3);
    return;
  }
  AppState.receptorState = { key, organ: organKey, src, status: "loading", ligands: [] };
  const token = ++receptorToken;
  renderReceptorCaption();
  viewer.spin(false);
  viewer.clear();
  viewer.render();
  const finish = (status) => {
    if (token !== receptorToken) return;
    AppState.receptorState.status = status;
    renderReceptorCaption();
  };

  if (src === "af3") {
    const entry = af3Entry(organKey);
    try {
      const res = await fetch(entry.cif_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cif = await res.text();
      if (token !== receptorToken) return;
      viewer.addModel(cif, "cif");
      AppState.receptorState.ligands = collectLigands(viewer, entry);
      AppState.receptorState.status = "loaded";
      applyReceptorStyle(AppState.currentMolStyle);
      const ligSel = { resn: AppState.receptorState.ligands.map((l) => l.resn) };
      if (ligSel.resn.length) {
        viewer.zoomTo(ligSel);
        viewer.zoom(0.55);
      } else {
        viewer.zoomTo();
      }
      viewer.render();
      if (AppState.activeTab === "structure") viewer.spin("y", 0.3);
      finish("loaded");
    } catch (err) {
      finish("failed");
    }
    return;
  }

  try {
    const res = await fetch(rec.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pdb = await res.text();
    if (token !== receptorToken) return;
    viewer.addModel(pdb, "pdb");
    AppState.receptorState.status = "loaded";
    applyReceptorStyle(AppState.currentMolStyle);
    viewer.zoomTo();
    viewer.zoom(1.35);
    viewer.render();
    if (AppState.activeTab === "structure") viewer.spin("y", 0.3);
    finish("loaded");
  } catch (err) {
    if (token !== receptorToken) return;
    // Fall back to the experimental RCSB structure
    $3Dmol.download(`pdb:${rec.rcsb}`, viewer, {}, () => {
      if (token !== receptorToken) return;
      AppState.receptorState.status = "rcsb";
      applyReceptorStyle(AppState.currentMolStyle);
      viewer.zoomTo();
      viewer.render();
      finish("rcsb");
    });
  }
}

function applyReceptorStyle(mode) {
  const v = AppState.receptorViewer3D;
  if (!v) return;
  const st = AppState.receptorState;
  const ligands = st.src === "af3" ? st.ligands : [];
  const ligResn = ligands.map((l) => l.resn);
  v.removeAllSurfaces();
  v.setStyle({}, {});
  // Official AlphaFold pLDDT colors from the B-factor column (AF DB and AF3 both store pLDDT there)
  const plddtColor = (atom) => {
    const b = atom.b || 0;
    if (b >= 90) return "#0053d6";
    if (b >= 70) return "#65cbf3";
    if (b >= 50) return "#ffdb13";
    return "#ff7d45";
  };
  if (mode === "surface") {
    v.setStyle({}, { cartoon: { colorfunc: plddtColor, opacity: 0.6 } });
    v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.45, color: "#d4d4d8" }, ligResn.length ? { hetflag: false } : {});
  } else if (mode === "stick") {
    v.setStyle({}, { cartoon: { colorfunc: plddtColor, opacity: 0.25 } });
    // AF3 complex: real pocket = residues within 5 Å of the ligands; apo model: approximate active-site window
    const pocket = ligResn.length
      ? { byres: true, within: { distance: 5, sel: { resn: ligResn } } }
      : { resi: ["165-225"] };
    v.setStyle(pocket, { cartoon: { colorfunc: plddtColor, opacity: 0.25 }, stick: { radius: 0.18, colorscheme: "whiteCarbon" } });
  } else {
    v.setStyle({}, { cartoon: { colorfunc: plddtColor } });
  }
  ligands.forEach((l) => {
    v.setStyle({ resn: l.resn }, { stick: { radius: 0.28, color: l.color }, sphere: { scale: 0.22, color: l.color } });
  });
  v.render();
}

async function fetchAlphaFoldDbMeta(organKey) {
  const rec = ORGAN_RECEPTORS[organKey] || ORGAN_RECEPTORS.liver;
  const showBundled = () => {
    setText("af-ebi-id", rec.afId);
    setText("af-ebi-plddt", fmt(rec.plddt, 1));
    setText("af-ebi-source", t("st.bundled"));
  };
  showBundled();
  let meta = AppState.afDbCache[rec.uniprot];
  if (meta === undefined) {
    try {
      const res = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${rec.uniprot}`);
      meta = res.ok ? (await res.json())?.[0] || null : null;
    } catch (err) {
      meta = null;
    }
    AppState.afDbCache[rec.uniprot] = meta;
  }
  if (meta && AppState.selectedOrgan === organKey) {
    setText("af-ebi-id", meta.entryId || rec.afId);
    if (meta.globalMetricValue !== undefined) setText("af-ebi-plddt", fmt(meta.globalMetricValue, 1));
    setText("af-ebi-source", t("st.live", { v: meta.latestVersion ?? "" }));
  }
}

/* =========================================================================
   CHART
   ========================================================================= */
function initPkPdChart() {
  const ctx = $("pkpd-chart");
  if (!ctx || !window.Chart) return;
  const mono = "'JetBrains Mono', monospace";
  AppState.pkChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: REDUCED_MOTION ? 0 : 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: "#a1a1aa", font: { size: 10, family: mono }, boxWidth: 10, boxHeight: 2, padding: 10 } },
        tooltip: { backgroundColor: "#1d1d22", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1, titleFont: { family: mono, size: 11 }, bodyFont: { family: mono, size: 11 } },
      },
      scales: {
        x: { ticks: { color: "#71717a", maxTicksLimit: 7, font: { size: 10, family: mono } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#71717a", font: { size: 10, family: mono } }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

function updatePkPdChart() {
  const chart = AppState.pkChart;
  const sim = AppState.simData?.simulation;
  if (!chart || !sim?.timeline?.time_h) return;
  const tl = sim.timeline;
  const labels = tl.time_h.map((x) => `${x.toFixed(1)}h`);
  const organ = sim.organs?.[AppState.selectedOrgan];
  const flat = (v) => tl.time_h.map(() => v);
  const line = (label, data, color, extra = {}) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false, ...extra });
  chart.data.labels = labels;
  if (AppState.chartMode === "pk") {
    const pk = sim.pk_summary || {};
    const sets = [
      line(`${t("cv.plasma")} (mg/L)`, tl.central_conc_mg_l, "#ededed", { borderWidth: 2 }),
      line(`${organName(AppState.selectedOrgan)} (mg/L)`, organ?.concentration_series || [], "#a1a1aa", { borderDash: [5, 3] }),
      line(`${t("cv.effect")} (mg/L)`, tl.effect_conc_mg_l || [], "#52525b"),
    ];
    if (pk.therapeutic_max_mg_l) sets.push(line(t("cv.therMax"), flat(pk.therapeutic_max_mg_l), "rgba(74,222,128,0.7)", { borderWidth: 1, borderDash: [2, 3] }));
    if (pk.toxic_threshold_mg_l) sets.push(line(t("cv.toxic"), flat(pk.toxic_threshold_mg_l), "rgba(239,68,68,0.75)", { borderWidth: 1, borderDash: [2, 3] }));
    chart.data.datasets = sets;
    chart.options.scales.y.max = undefined;
  } else {
    const others = ORGAN_KEYS
      .filter((k) => k !== AppState.selectedOrgan && sim.organs?.[k])
      .sort((a, b) => sim.organs[b].peak_risk_pct - sim.organs[a].peak_risk_pct)
      .slice(0, 2);
    chart.data.datasets = [
      line(`${organName(AppState.selectedOrgan)} (%)`, organ?.toxicity_risk_series || [], "#ededed", { borderWidth: 2 }),
      ...others.map((k, idx) => line(`${organName(k)} (%)`, sim.organs[k].toxicity_risk_series, idx === 0 ? "#a1a1aa" : "#52525b", { borderDash: [5, 3] })),
      line(t("cv.critical"), flat(65), "rgba(239,68,68,0.7)", { borderWidth: 1, borderDash: [2, 3] }),
    ];
    chart.options.scales.y.max = 100;
  }
  chart.update();
}

/* =========================================================================
   AI REVIEW · VERIFICATION · SIGN-OFF
   ========================================================================= */
function renderReview() {
  const d = AppState.simData;
  if (!d) {
    setText("review-summary", t("rev.empty"));
    return;
  }
  const a = d.argon_analysis || {};
  const v = d.verification_loop || a.verification_loop || {};
  const isKo = AppState.lang === "ko";

  setText("review-model", a.model_used || "—");
  const note = $("review-argon-note");
  if (note) {
    if (a.argon_called === false) {
      note.textContent = t("rev.argonOff") + (a.argon_fallback_reason ? ` ${t("rev.fallback", { r: a.argon_fallback_reason })}` : "");
      note.hidden = false;
    } else if (a.argon_called === true) {
      note.textContent = t("rev.argonOn");
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  setText("review-summary", (isKo ? a.executive_summary_ko : a.executive_summary) || a.executive_summary || "—");
  const cascade = (isKo ? a.molecular_cascade_4step_ko : a.molecular_cascade_4step) || a.molecular_cascade_4step || {};
  const steps = [
    ["c.step1", cascade.step1_delivery],
    ["c.step2", cascade.step2_reaction],
    ["c.step3", cascade.step3_cellular_dysfunction],
    ["c.step4", cascade.step4_disrepair_biomarkers],
  ].filter(([, txt]) => txt);
  const ol = $("review-cascade");
  if (ol) ol.innerHTML = steps.map(([k, txt]) => `<li><span><b>${escapeHtml(t(k))}</b>${escapeHtml(txt)}</span></li>`).join("");
  setText("review-antidote", (isKo ? a.antidote_protocol_ko : a.antidote_protocol) || a.antidote_protocol || "—");

  const checks = v.checks || [];
  const total = v.total_checks ?? checks.length;
  const passed = v.passed_count ?? checks.filter((c) => c.passed).length;
  const attempts = Array.isArray(v.attempts) && v.attempts.length
    ? v.attempts
    : [{ iteration: v.iterations || 1, passed: !!v.all_passed, failed_check_ids: checks.filter((c) => !c.passed).map((c) => c.check_id) }];
  const vs = $("verify-summary");
  if (vs) {
    vs.textContent = t("rev.verSummary", { p: passed, t: total, a: attempts.length });
    vs.className = `mono verify-count ${passed === total && total > 0 ? "txt-safe" : "txt-caution"}`;
  }
  const ul = $("verify-checks");
  if (ul) {
    ul.innerHTML = checks
      .map((c) => `<li class="check-row ${c.passed ? "pass" : "fail"}">
        <svg class="ic" aria-label="${c.passed ? "pass" : "fail"}"><use href="#${c.passed ? "i-check" : "i-x"}"/></svg>
        <div><div class="check-name">${escapeHtml(isKo ? c.name_ko || c.name : c.name)}</div>
        <div class="check-detail">${escapeHtml(isKo ? c.detail_ko || c.detail : c.detail)}</div></div>
      </li>`)
      .join("");
  }
  const al = $("verify-attempts");
  if (al) {
    al.innerHTML = attempts
      .map((at, idx) => {
        const n = at.iteration ?? idx + 1;
        const failed = at.failed_check_ids || [];
        const txt = at.passed || !failed.length ? t("rev.attemptPass", { n }) : t("rev.attemptFail", { n, ids: failed.join(", ") });
        return `<li class="attempt-row"><i class="dot ${at.passed ? "safe" : "danger"}"></i><span>${escapeHtml(txt)}</span>${at.source ? `<span class="src">${escapeHtml(at.source)}</span>` : ""}</li>`;
      })
      .join("");
  }
}

function resetSignoff() {
  const chk = $("chk-clinical-verify");
  if (chk) chk.checked = false;
  const status = $("approval-status");
  if (status) { status.hidden = true; status.classList.remove("err"); }
  const exp = $("btn-export-report");
  if (exp) exp.disabled = true;
  AppState.refreshApprove?.();
}

async function approveProtocol() {
  const d = AppState.simData;
  const name = $("reviewer-name")?.value.trim();
  if (!d || !name || !$("chk-clinical-verify")?.checked) return;
  const btn = $("btn-approve");
  btn.disabled = true;
  btn.textContent = t("rev.approving");
  const v = d.verification_loop || {};
  const drugName = d.simulation?.drug_name?.split(" (")[0] || AppState.selectedDrugKey;
  try {
    const res = await fetch("/api/verify-protocol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        simulation_id: d.simulation_id || "sim-unknown",
        reviewer_name: name,
        reviewer_role: "Researcher",
        decision: "approved",
        approved: true,
        clinical_notes: `Reviewed ${drugName} ${regimenText()}; verification ${v.passed_count ?? "?"}/${v.total_checks ?? "?"} checks.`,
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) { /* keep status text */ }
      throw new Error(msg);
    }
    const out = await res.json();
    if (AppState.simData !== d) return; // a newer simulation replaced this one
    if (out.approved === false || out.status === "rejected") throw new Error(out.status || "rejected");
    AppState.approval = out.record || { reviewer_name: name, timestamp_iso: new Date().toISOString() };
    const status = $("approval-status");
    if (status) {
      const rec = AppState.approval;
      status.textContent = t("rev.approved", {
        n: rec.reviewer_name || name,
        t: (rec.timestamp_iso || "").replace("T", " ").replace("Z", " UTC"),
        id: rec.approval_id || "",
      });
      status.classList.remove("err");
      status.hidden = false;
    }
    $("btn-export-report").disabled = false;
    showToast(t("toast.approved"));
  } catch (err) {
    const status = $("approval-status");
    if (status) {
      status.textContent = t("err.approve", { m: err.message });
      status.classList.add("err");
      status.hidden = false;
    }
  } finally {
    btn.textContent = t("rev.approve");
    AppState.refreshApprove?.();
  }
}

function exportVerifiedProtocol() {
  const d = AppState.simData;
  if (!d || !AppState.approval) return;
  downloadJson(
    {
      platform: "PharmacoTwin 3D",
      disclaimer: "Research and education use only. Not medical advice.",
      exported_at: new Date().toISOString(),
      human_approval: AppState.approval,
      regimen: {
        drug_id: d.simulation?.drug_id,
        route: d.simulation?.route,
        dose_mg: d.simulation?.dose_mg,
        interval_h: d.simulation?.interval_h,
        num_doses: d.simulation?.num_doses,
      },
      patient: patientPayload(AppState.patient),
      verification_loop: d.verification_loop,
      result: d,
    },
    `pharmacotwin_${d.simulation?.drug_id || "sim"}_${d.simulation_id || Date.now()}.json`
  );
}

/* =========================================================================
   NOVEL COMPOUND (AF3 job + heuristic estimate)
   ========================================================================= */
function renderAf3Presets() {
  const box = $("af3-presets");
  if (!box) return;
  box.innerHTML = AppState.novelSamples
    .map((s) => `<button type="button" class="chip" data-sample="${s.id}">${escapeHtml(s.name.split(" (")[0])}</button>`)
    .join("");
}

function renderAf3RegimenNote() {
  setText("af3-regimen-note", t("af3.regimen", { r: regimenText() }));
}

async function runAlphaFold3Approximation() {
  const btn = $("btn-run-af3-sim");
  const name = $("af3-drug-name")?.value.trim() || "Novel compound";
  const smiles = $("af3-smiles")?.value.trim();
  if (!smiles) { $("af3-smiles")?.focus(); return; }
  btn.disabled = true;
  setText("af3-run-label", t("af3.running"));
  try {
    const res = await fetch("/api/af3-approximate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        molecule_name: name,
        smiles,
        route: AppState.selectedRoute,
        dose_mg: AppState.doseMg,
        interval_h: AppState.intervalHours,
        num_doses: AppState.numDoses,
        duration_h: 24,
        patient: patientPayload(AppState.patient),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    AppState.af3Result = data;
    renderAf3Result();
  } catch (err) {
    console.warn("AF3 estimate failed:", err);
    showToast(t("err.af3"), true);
  } finally {
    btn.disabled = false;
    setText("af3-run-label", t("af3.run"));
  }
}

function renderAf3Result() {
  const r = AppState.af3Result;
  const box = $("af3-result");
  if (!r || !box) return;
  const prof = r.approximated_drug_profile || {};
  const meta = r.af3_job_metadata || {};
  const th = prof.predicted_thermodynamics || {};
  const pk = prof.predicted_pk || {};
  const conf = prof.af3_confidence || {};
  const organs = r.simulation?.organs || {};
  const top = Object.keys(organs).sort((a, b) => organs[b].peak_risk_pct - organs[a].peak_risk_pct)[0];
  const target = meta.target_protein
    || r.af3_job_spec?.sequences?.find((s) => s.proteinChain || s.protein)?.proteinChain?.description
    || r.simulation?.structure_3d?.target_protein
    || "—";
  setText("af3-res-target", meta.uniprot ? `${target} · UniProt ${meta.uniprot}` : target);
  setText("af3-res-plddt", conf.plddt === null || conf.plddt === undefined ? t("af3.na") : fmt(conf.plddt, 1));
  setText("af3-res-dg", th.delta_g_kcal_mol !== undefined ? `${fmt(th.delta_g_kcal_mol, 2)} kcal/mol` : "—");
  setText("af3-res-kd", th.kd_um !== undefined ? `${fmt(th.kd_um)} µM` : "—");
  const vd = (pk.vc_l_per_70kg || 0) + (pk.vp_l_per_70kg || 0);
  setText("af3-res-pk", `${fmt(vd, 0)} L · ${fmt(pk.cl_l_h_per_70kg, 1)} L/h`);
  setText("af3-res-peak", top ? `${organName(top)} · ${fmt(organs[top].peak_risk_pct, 1)}%` : "—");
  setText("af3-json-pre", JSON.stringify(r.af3_job_spec || {}, null, 2));
  const note = $("af3-res-note");
  if (note) {
    const parts = [prof.method_note, conf.iptm_note].filter(Boolean);
    note.textContent = parts.join(" ");
    note.hidden = parts.length === 0;
  }
  box.hidden = false;
}

/* =========================================================================
   CURRICULUM
   ========================================================================= */
function parseCurriculum(text) {
  const cards = [];
  let cur = null;
  (text || "").split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line || /^\[.*\]$/.test(line)) return;
    const head = line.match(/^(\d+)\.\s+(.*)$/);
    const bullet = line.match(/^[-•]\s+(.*)$/);
    if (head) {
      cur = { num: head[1], title: head[2].replace(/:$/, ""), items: [] };
      cards.push(cur);
    } else if (cur && bullet) {
      cur.items.push(bullet[1]);
    } else if (cur) {
      if (cur.items.length) cur.items[cur.items.length - 1] += ` ${line}`;
      else cur.items.push(line);
    }
  });
  return cards;
}

function renderCurriculum() {
  const box = $("curriculum-cards-container");
  if (!box) return;
  const text = AppState.lang === "ko" && AppState.curriculum.ko ? AppState.curriculum.ko : AppState.curriculum.en;
  box.innerHTML = parseCurriculum(text)
    .map((c) => `<div class="curr-card">
      <span class="curr-num">${String(c.num).padStart(2, "0")}</span>
      <h4>${escapeHtml(c.title)}</h4>
      <ul>${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    </div>`)
    .join("");
}

/* =========================================================================
   LANGUAGE
   ========================================================================= */
function setLanguage(lang) {
  AppState.lang = lang === "ko" ? "ko" : "en";
  document.documentElement.lang = AppState.lang;
  engine("setLanguage", AppState.lang);

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", el.title);
  });
  document.querySelectorAll(".js-lang-label").forEach((el) => { el.textContent = t("lang.other"); });

  updateWizardChrome();
  renderDerivedEstimates(false);
  setPlaying(AppState.isPlaying);
  setText("lbl-btn-administer", AppState.simBusy ? t("reg.running") : t("reg.run"));

  if (AppState.drugs.length) {
    renderDrugSelect();
    renderDrugDescription();
    renderAf3Presets();
    renderCurriculum();
  }
  renderTopSummary();
  renderPatientCard();
  renderAf3RegimenNote();
  if (AppState.af3Result) renderAf3Result();
  if (AppState.simData) {
    renderSafetyPill();
    renderOrganList();
    renderOrganDetail();
    renderReview();
    updatePkPdChart();
    updateTimeStepView(AppState.currentStepIdx);
    if (AppState.approval) {
      const rec = AppState.approval;
      setText("approval-status", t("rev.approved", {
        n: rec.reviewer_name || "",
        t: (rec.timestamp_iso || "").replace("T", " ").replace("Z", " UTC"),
        id: rec.approval_id || "",
      }));
    }
  }
  if (AppState.receptorState.organ) {
    renderReceptorCaption();
    fetchAlphaFoldDbMeta(AppState.selectedOrgan);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Small debug/automation handle; the engine script owns its own globals.
window.PharmacoTwinApp = { state: AppState, setLanguage, selectOrgan, runSimulation, openWizard };
})();
