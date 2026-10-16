# Hackathon Context — read this first

> Hand this file to the Antigravity agent at the start of the session.
> Source: the official participant guide `[External] 261016 Google DeepMind AI Hackathon 참가자 안내 가이드.pdf`.
> Anything the guide does not say is marked **NOT IN GUIDE**. Do not guess it; ask me or the onsite staff.
> `ANTIGRAVITY_CONTEXT.md` in the same folder is an **abandoned idea**. Ignore it.

---

## 0. Who I am and how I want to work with you

- I am a pharmacy student. I am joining for the experience, not to win.
- I vibe-code: I give you a step, you run it for **15–30 minutes** without needing me, and I study for exams while you work.
- **Topic: not decided yet.** First, help me pick one inside a track (§5). Then plan the build as a few self-contained steps.
- **Team or solo: not decided or confirmed yet.**
- Talk to me in **Korean**. Everything we submit (README, project description, UI text, demo script) must be in **English**.
- Before writing code:
  1. Ask clarifying questions.
  2. List architecture trade-offs and edge cases.
  3. Wait for my "go".
- After "go", run each step to completion with minimal back-and-forth.
- Write a **verification loop first** (tests, a checker, or a headless-browser check). Iterate until every check passes.
- Push to GitHub after every step. Never put an API key in code, logs, commits, or the frontend.
- Write any non-obvious setup or build quirk into `AGENTS.md`.

---

## 1. Schedule (2026-10-16, Google for Startups Campus Seoul)

| Time | Program |
|---|---|
| 10:00–10:30 | Check-in |
| 10:30–11:00 | Welcome, tech demo |
| 11:00–11:20 | Rules briefing |
| **11:20–15:20** | **Hackathon (build window, 4 h)** |
| 15:20–16:30 | Judging |
| 16:00–16:30 | Top 4 demos (the guide's table overlaps with judging as written) |
| 16:30–17:00 | Awards, closing |

- **Submission deadline: the guide only says "before the hackathon ends". The exact time is NOT IN GUIDE.** We treat **15:20** as the deadline and aim to submit by **15:10**.
- Participants may not leave the campus except to use the restroom.

---

## 2. NEVER do these (disqualification, penalty, or shutdown)

**Disqualified / penalized submissions**
- **Pre-built or resubmitted projects.** No project that was submitted to or won another competition. No project built before kickoff.
  - Open-source libraries and starter templates are OK.
  - **All demo code must be written during the hackathon (11:20–15:20).**
- **Simple chat wrappers.** No plain PDF chatbot and no simple Q&A bot.
- **Static pages.** No simple Streamlit page without autonomous reasoning, a verification loop, or a multimodal workflow.
- **Unsafe bots.** No unverified medical diagnosis, mental-health counseling, or financial-advice bot without a **human-in-the-loop** safeguard.

**Account / security violations (resources or the project can be suspended)**
- **No Autonomous Agents such as OpenClaw inside the project (strictly prohibited).**
- No unsecured HTTP ports. Secure all open ports.
- No database fully open to the internet.
- No PHP.
- No excessive resource use ("Don't abuse the system").
- No leaked API keys ("Don't leak API keys").

**Must not forget**
- All `@gcplab.me` accounts and GCP projects are **deleted immediately when the event ends, with no recovery**. Back up to GitHub and a local PC before the end.

---

## 3. Mandatory technology

- **Use Google AI tools.** For example Google AI Studio and Antigravity.
- **Deploy on Google Cloud.** The project must run as a working service for the demo and for verification. Use **Cloud Run** over HTTPS.
- **Account**
  - Each participant gets a pre-provisioned `@gcplab.me` ID/PW with a billing-enabled GCP project.
  - The same credentials work for the Cloud console, AI Studio, and Antigravity.
- **Antigravity login**
  - Specify the **project ID** when logging in, so the Agent Platform (Business) Plan applies.
  - If "Starter Quota" appears, log out and log in again.
- **API key:** in AI Studio, open "Get API key". If no key is shown, use "Import Projects" and select the only project listed.
- **SDK**
  - Python `google-genai` or JS `@google/genai`, **version ≥ 2.3.0**.
  - Use the **Interactions API**.
- **Gemini API skills for coding agents:**
  - `npx skills add google-gemini/gemini-skills --skill gemini-api-dev`
  - `--skill gemini-live-api-dev` if we use voice.
- Whether external public APIs or datasets may be used: **NOT IN GUIDE** (not prohibited either).

### Calling `gemini-4-argon` (from the guide)
- Control reasoning depth with `thinking_level`: `"low"` | `"medium"` (default) | `"high"`.
- **Do not send** `temperature`, `top_p`, `top_k`, or `thinking_budget` (deprecated or ignored).
- Remove explicit `cached_content`. Implicit caching is automatic.
- Input, thinking, and output share a **1M-token** window.
  - Default output limit is 64K tokens.
  - To generate beyond that, set `background=True` and raise `max_output_tokens` above 65536.
- For long `"high"` calls, raise HTTP timeouts to 15–20 min or run them with `background=True` and poll.

```python
from google import genai
client = genai.Client()
interaction = client.interactions.create(
    model="gemini-4-argon",
    input="...",
    generation_config={"thinking_level": "medium"},
)
print(interaction.output_text)
```

Managed agent (hosted sandbox where Argon plans, writes code, verifies, searches the web, and calls MCP tools):

```python
interaction = client.interactions.create(
    agent="antigravity-preview-09-2026",
    agent_config={"type": "antigravity", "model": "gemini-4-argon"},
    input="...",
    environment="remote",
)
```

- Register any tokens the sandbox needs with the Credentials API (`client.credentials.create`).
- Restrict the sandbox network allowlist, so secrets never enter the model context.

### Model toolkit (pick by job)

| Job | Model / agent ID |
|---|---|
| Frontier reasoning, long-horizon coding, 3D, orchestration | `gemini-4-argon` |
| Autonomous sandbox execution | `antigravity-preview-09-2026` |
| Fast parallel subagents, tool calls | `gemini-3.8-flash` |
| Low-latency routing, checks, guardrails | `gemini-3.5-flash-lite` |
| Deep web research with citations | `deep-research-preview-04-2026` |
| Real-time voice + camera | `gemini-3.8-live` (`gemini-3.8-live-extended-thinking` for deep reasoning while talking) |
| Speech-to-text / translation | `gemini-3.5-transcribe-live`, `gemini-3.5-transcribe`, `gemini-3.5-live-translate-preview` |
| TTS | `gemini-3.8-flash-tts` (`gemini-3.8-flash-lite-tts` faster) |
| Images (UI assets, sprites, 4K) | `gemini-nano-banana-2.1` (`gemini-3.1-flash-lite-image` faster) |
| Video with native audio | `gemini-omni-1.1-flash` |
| Music | `lyria-3.5` (`lyria-3-clip-preview` for 30 s loops) |
| Open / on-device | `gemma-4-31b-it`, Gemma 4 E2B / E4B |

---

## 4. Submission and judging

**Submit before the hackathon ends. Everything must be in English.**
1. Project Description
2. Public GitHub Repository link
3. Demo Video link (YouTube, Google Drive, etc.)

- Submission method (form link, etc.): **NOT IN GUIDE**.
- Video length limit: **NOT IN GUIDE**.

**Judging criteria** (weights **NOT IN GUIDE**)
1. **Working Live Demo / Demo Video**
   - Does it run with real inputs and no errors?
   - Did the team use `gemini-4-argon`, Managed Agents, or companion models **with a real verification loop**?
2. **Problem & Impact**
   - Does it solve a specific user's concrete problem within a track?
   - Could it grow into a real product or open-source tool after today?
3. **Originality & Creativity**
   - Is it a new approach?
   - Is it only possible because of Argon's 1M context, long decode, frontier reasoning, or multimodal orchestration?
4. **Clarity of Description:** do the description and video make the target user and the value clear?

**What makes a strong 1-day project (builder guide)**
- It solves a specific problem for a real person you can name.
- It does work that needed Gemini 4 Argon: long-horizon coding, autonomous verification loops, multi-file synthesis, 3D/WebGPU, or multi-agent orchestration.
- It keeps people in control of actions that affect external systems, money, or private data.
- It runs live during judging with real inputs in **under 3 minutes**.

**5 patterns that save hours**
1. Align on intent before long runs: clarifying questions, edge cases, trade-offs, then execute.
2. Give Argon a pass/fail verification loop: tests, compiler output, logs, or a headless Chrome script. Record a baseline and iterate.
3. Use multimodal references: reference images, a DESIGN.md, screen recordings for UI bugs.
4. Make Argon the lead architect and delegate leaf work to `gemini-3.8-flash` and media models.
5. Write quirks into AGENTS.md. Before the demo, generate an interactive HTML architecture diagram.

Prizes: 1st $2,000 / 2nd $1,000 / 3rd and 4th $500 each in Gemini API credits.

---

## 5. Tracks (pick one) — verbatim from the guide

### Track 1: Gemini 4 Argon in entertainment
Korea—and Seoul in particular—is a global powerhouse in entertainment. How can you use Gemini 4 Argon, Google AI Studio, Antigravity and our generative media models to create new experiences across music, TV, film, webtoons and gaming?

**What Gemini 4 Argon adds to this track**
- 3D scenes, physics and procedural worlds: Argon writes Three.js, WebGPU and Blender scripts across a shared 1M-token context window, generating complete multi-file games and interactive simulations in a single long-decode pass
- multimodal orchestration: Argon can act as the game master or showrunner while coordinating gemini-3.8-live for real-time voice characters, gemini-nano-banana-2.1 for consistent sprites and storyboard panels, gemini-omni-1.1-flash for video cutscenes, and lyria-3.5 for adaptive soundtracks and vocals
- agentic video understanding: Argon scrubs across long video cuts or gameplay recordings to match audio beats, dialogue timing and visual continuity

**1-day build ideas**
- a playable 3D browser game or procedural world built in Three.js or WebGPU where Gemini 4 Argon generates the mechanics and level geometry, gemini-3.8-live runs unscripted voice characters that trigger in-game function calls, and lyria-3.5 shifts the soundtrack dynamically
- an interactive film, K-drama or webtoon production tool that takes a script and character reference sheet, uses Argon to plan scene continuity across a 1M-token storyboard, generates consistent 4K frames with gemini-nano-banana-2.1, and renders voiced scenes with gemini-omni-1.1-flash and gemini-3.8-flash-tts
- a live music and stage visual co-producer where performers hum, speak or play a riff into gemini-3.8-live, and Argon coordinates lyria-3.5 stems with real-time WebGL visuals synchronized to the audio

### Track 2: Gemini 4 Argon in hard tech
Korea's hard tech sector is surging across semiconductors, robotics, biotech, batteries, data centers, energy and aerospace. How can you build with Gemini 4 Argon to speed up development, verification and simulation across hardware and physical systems?

**What Gemini 4 Argon adds to this track**
- long-horizon verification loops: give Argon a measurable engineering target (such as migrating legacy C++ control code to Rust, optimizing a kernel, or verifying RTL and firmware specs) inside an Antigravity sandbox (antigravity-preview-09-2026), and let it build a test harness and iterate until every check passes
- 1M-token multimodal synthesis: point Argon at dense folders mixing 500-page datasheets, CAD and PCB schematics, oscilloscope logs, laboratory videos and spreadsheets to cross-reference failure modes in a single context window
- physics and spatial simulation: combine Argon's "high" thinking mode (thinking_level="high") with Python execution and 3D visualization to model thermal loads, robotic kinematics, battery degradation or molecular pathways

**1-day build ideas**
- an autonomous firmware and datasheet verifier that reads a microcontroller reference manual PDF alongside a C or Rust driver repository, writes an automated simulation test suite in an Antigravity sandbox, and patches register-level bugs until every test passes
- a multimodal laboratory or manufacturing root-cause analyst that takes high-resolution inspection video, sensor telemetry CSVs and maintenance manuals, uses Argon's agentic video understanding to locate the exact timestamp and physical anomaly, and outputs a reproducible diagnostic report
- an interactive 3D engineering simulator (for robotic arm path planning, drone aerodynamics or data-center cooling layouts) where Argon computes the physics constraints and renders a live WebGPU view you can test on stage

### Track 3: Google AI for social good
As AI capabilities grow, using them for public benefit matters more than ever. How can you build with Gemini 4 Argon, real-time voice and translation, and on-device open models to create practical, positive outcomes in accessibility, health, education, civic services or safety?

**What Gemini 4 Argon adds to this track**
- automated accessibility and workflow verification: Argon can crawl a live web app or public service site with a headless browser, inspect the accessibility tree, group barriers by root cause, and either patch the underlying code or guide a user through the task
- zero-barrier voice and 70+ language access: combine Argon's reasoning over dense medical, legal or civic policies with gemini-3.5-live-translate-preview and gemini-3.8-live so anyone can use essential services by speaking in their own language
- privacy-first local execution: pair cloud reasoning with Gemma 4 (E2B and E4B) on the device when sensitive personal, health or accessibility data must stay on the user's phone or laptop

**1-day build ideas**
- a hands-free voice and screen navigator for blind, low-vision or motor-impaired users that combines gemini-3.8-live, Computer Use and Argon to read complex websites, fill out multi-step forms with explicit voice confirmation before submission, and generate accessibility patches for site owners
- a multilingual civic, legal or healthcare benefits guide that loads hundreds of pages of local regulations and forms into Argon's 1M-token window, interviews a resident by voice in any of 70+ languages via gemini-3.5-live-translate-preview, and prepares a cited application packet with a human review checkpoint
- a local emergency preparedness and grid or climate response planner that combines municipal hazard maps, live weather feeds, Google Maps grounding and infrastructure PDFs into clear local response plans and verifiable field checklists

### Track 4: Open innovation — autonomous agents and developer tools
(The guide gives no description sentence for this track, only build ideas.)

**1-day build ideas**
- a self-healing security and dependency migration agent that scans a repository for vulnerabilities or breaking API upgrades, writes a reproduction test in an Antigravity sandbox, patches the call sites with Argon, and outputs an interactive visual diff walkthrough
- a legacy codebase modernizer that takes an older desktop, Java or monolithic web app along with a screen recording of how it works, extracts a DESIGN.md and API specification, and rebuilds a tested modern web application in a single autonomous run
- a multi-agent research-to-prototype tool where Argon coordinates deep-research-preview-04-2026 to gather technical papers or market data, delegates parallel implementation modules to gemini-3.8-flash subagents, and compiles a live interactive dashboard or simulation

---

## 6. Time plan and checkpoints (deadline assumed 15:20)

- **Steps:** after the topic is chosen, split the build into steps of 15–30 minutes each. Each step needs a clear "done" check.
- **14:20 — feature freeze**
  - Stop adding features.
  - Run the deployed Cloud Run URL end to end with a real input and time it (< 3 min).
  - The verification loop and the human-confirmation step must be visible in the UI.
  - The repo is **Public** and fully pushed.
  - Scan for secrets (`git grep` for key patterns, no `.env` committed).
  - Draft the English README and Project Description. Draft a 3-minute demo script.
- **14:50 — lock submission**
  - Record and upload the demo video. Check the link in an incognito window.
  - Finalize the Project Description: track, target user, models used, how the verification loop works.
  - Collect the 3 links. **Submit by 15:10.**
  - Back up the repo locally.

## 7. Open questions to confirm onsite
- Exact submission deadline and submission method
- Team or solo
- Whether planning docs written before kickoff (like this file) are acceptable. This file contains **no code**, only rules from the guide.
