import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./styles.css";
import { HabitatScene, MODULES } from "./habitat";
import { nominalTelemetry, snapshotAt, telemetryAt } from "./simulation";
import type { MissionEvent, ModuleDefinition, ScenarioPhase, Severity, Telemetry } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root was not found.");

const icon = (name: "pulse" | "azure" | "warning" | "play" | "reset" | "cube"): string => {
  const paths = {
    pulse: '<path d="M2 12h4l2.4-6 4.2 12 2.8-8 2 2H22"/>',
    azure: '<path d="M5 18.5 10.7 3h5.1L10 18.5H5Zm6.9 0 2.5-6.6 5.6 6.6h-8.1Z"/>',
    warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/>',
    cube: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 7 9 5 9-5v10l-9 5-9-5V7Zm9 5v10"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
};

app.innerHTML = `
  <div class="command-center">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="mission-mark">A7</div>
        <div>
          <div class="brand-name">ARES-7 <span>//</span> MARS HABITAT</div>
          <div class="brand-subtitle">DIGITAL TWIN MISSION CONTROL</div>
        </div>
      </div>
      <div class="topbar-center">
        <span class="status-dot"></span>
        <span>MISSION NETWORK</span>
        <strong>NOMINAL</strong>
      </div>
      <div class="topbar-actions">
        <button class="connection-chip" id="connection-chip" type="button" title="Telemetry adapter status">
          ${icon("azure")}
          <span><small>DATA ADAPTER</small>LOCAL TWIN SIM</span>
        </button>
        <div class="mission-clock"><small>MARS RELAY / UTC</small><strong id="utc-clock">--:--:--</strong></div>
      </div>
    </header>

    <div class="workspace-grid">
      <aside class="left-rail panel-surface">
        <section class="mission-identity">
          <div class="eyebrow">MISSION OVERVIEW</div>
          <div class="sol-display"><span>SOL</span><strong>184</strong></div>
          <div class="mission-coordinates">JEZERO OUTPOST · 18.38°N 77.58°E</div>
          <div class="mission-meta-grid">
            <div><small>CREW</small><strong>06</strong></div>
            <div><small>LOCAL TIME</small><strong>14:32</strong></div>
            <div><small>RELAY</small><strong>18.2m</strong></div>
          </div>
        </section>

        <section class="scenario-card">
          <div class="section-title"><span>INCIDENT DRILL</span><small>DS-04</small></div>
          <h2>Regional dust storm</h2>
          <p>Test how the habitat responds when solar generation collapses and life support is placed at risk.</p>
          <button class="primary-action" id="inject-storm" type="button">
            ${icon("play")}
            <span>RUN DUST STORM DRILL</span>
          </button>
          <button class="secondary-action" id="reset-scenario" type="button">
            ${icon("reset")}
            <span>RESET TO NOMINAL</span>
          </button>
        </section>

        <section class="module-section">
          <div class="section-title"><span>SCENE MODULES</span><small>6 MODULES</small></div>
          <div class="module-list" id="module-list"></div>
        </section>

        <section class="provenance-card">
          <div class="provenance-icon">${icon("cube")}</div>
          <div>
            <strong>dtmi:ares7:Habitat;1</strong>
            <span>Deterministic telemetry · local twin simulator</span>
          </div>
        </section>
      </aside>

      <main class="scene-column">
        <div class="scene-stage" id="scene-stage">
          <div id="three-scene"></div>
          <div class="scan-lines" aria-hidden="true"></div>

          <div class="scene-toolbar">
            <div class="phase-chip" id="phase-chip"><span></span>NOMINAL OPERATIONS</div>
            <button type="button" id="reset-camera">RESET VIEW</button>
          </div>

          <div class="storm-alert" id="storm-alert" hidden>
            ${icon("warning")}
            <div><small>ACTIVE INCIDENT</small><strong id="alert-title">DUST FRONT APPROACHING</strong></div>
            <span id="alert-countdown">T−00:12</span>
          </div>

          <div class="scene-caption">
            <span class="reticle"></span>
            <div><strong>ARES-7 SURFACE HABITAT</strong><small>SELECT ANY MODULE TO INSPECT ITS TWIN</small></div>
          </div>

          <section class="event-console" id="event-console">
            <header>
              <div><span class="live-pulse"></span>MISSION EVENT STREAM</div>
              <div class="event-actions"><span id="event-count">00 EVENTS</span><button id="toggle-events" type="button">COLLAPSE</button></div>
            </header>
            <div class="event-list" id="event-list">
              <div class="empty-events"><span>STREAM READY</span>Run the drill to generate traceable mission events.</div>
            </div>
          </section>
        </div>
      </main>

      <aside class="right-rail panel-surface">
        <section class="system-summary">
          <div class="eyebrow">HABITAT VITALS</div>
          <div class="health-orbit" id="health-orbit">
            <div><strong id="health-score">98</strong><span>%</span><small>SYSTEM HEALTH</small></div>
          </div>
          <div class="health-caption"><span></span><strong id="health-status">ALL CRITICAL SYSTEMS STABLE</strong></div>
        </section>

        <section class="metrics-grid">
          <article class="metric-card" data-metric="solar">
            <header><span>SOLAR ARRAY</span><small>ARRAY-01</small></header>
            <div class="metric-value"><strong id="solar-value">82.4</strong><span>kW</span></div>
            <div class="metric-track"><i id="solar-track"></i></div>
            <footer><span id="solar-delta">+2.1% vs baseline</span><strong id="solar-state">NOMINAL</strong></footer>
          </article>
          <article class="metric-card" data-metric="battery">
            <header><span>ENERGY RESERVE</span><small>BUS-A</small></header>
            <div class="metric-value"><strong id="battery-value">94.2</strong><span>%</span></div>
            <div class="metric-track"><i id="battery-track"></i></div>
            <footer><span id="battery-delta">8h 42m reserve</span><strong id="battery-state">NOMINAL</strong></footer>
          </article>
          <article class="metric-card" data-metric="oxygen">
            <header><span>OXYGEN MIX</span><small>LSS-01</small></header>
            <div class="metric-value"><strong id="oxygen-value">20.90</strong><span>%</span></div>
            <div class="metric-track"><i id="oxygen-track"></i></div>
            <footer><span id="oxygen-delta">Target 20.9%</span><strong id="oxygen-state">STABLE</strong></footer>
          </article>
          <article class="metric-card" data-metric="pressure">
            <header><span>HAB PRESSURE</span><small>HAB-01</small></header>
            <div class="metric-value"><strong id="pressure-value">101.2</strong><span>kPa</span></div>
            <div class="metric-track"><i id="pressure-track"></i></div>
            <footer><span id="pressure-delta">Δ 0.0 kPa</span><strong id="pressure-state">SEALED</strong></footer>
          </article>
        </section>

        <section class="trend-card">
          <header><div><span>POWER TREND</span><small>LAST 36 SECONDS</small></div><strong id="trend-label">82.4 kW</strong></header>
          <div id="power-trend" class="sparkline" aria-label="Solar output trend"></div>
          <div class="trend-legend"><span><i class="solar-key"></i>SOLAR YIELD</span><span><i class="battery-key"></i>BATTERY</span></div>
        </section>

        <section class="decision-card" id="decision-card" hidden>
          <header>${icon("warning")}<div><small>HUMAN DECISION REQUIRED</small><strong>Containment plan ready</strong></div></header>
          <ol>
            <li>Isolate greenhouse loop</li>
            <li>Seal external airlock</li>
            <li>Shed nonessential circuits</li>
          </ol>
          <p>Generated from live twin dependencies. No command is sent until an operator approves it.</p>
          <div class="decision-actions">
            <button id="approve-plan" type="button">APPROVE PLAN</button>
            <button id="reject-plan" type="button">HOLD</button>
          </div>
        </section>

        <section class="systems-card">
          <div class="section-title"><span>AUTOMATION STATE</span><small id="automation-state">STANDBY</small></div>
          <div class="system-row"><span>External airlock</span><strong id="airlock-state">OPEN / READY</strong></div>
          <div class="system-row"><span>Greenhouse loop</span><strong id="greenhouse-state">CONNECTED</strong></div>
          <div class="system-row"><span>Power bus</span><strong id="powerbus-state">PRIMARY</strong></div>
        </section>
      </aside>
    </div>
  </div>
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
};

const moduleList = byId<HTMLDivElement>("module-list");
moduleList.innerHTML = MODULES.map(
  ({ id, label, code, criticality }) => `
    <button class="module-row" type="button" data-module="${id}">
      <span class="module-indicator"></span>
      <span><strong>${label}</strong><small>${code} · ${criticality.toUpperCase()}</small></span>
      <i>›</i>
    </button>`,
).join("");

const sceneContainer = byId<HTMLDivElement>("three-scene");
const scene = new HabitatScene({
  container: sceneContainer,
  onSelect: (module) => selectModule(module),
});

let running = false;
let missionSecond = 0;
let lastTick = performance.now();
let planReviewed = false;
let planApproved = false;
let scenarioRejected = false;
let currentTelemetry = nominalTelemetry();
let operatorEvents: MissionEvent[] = [];
const history: Array<{ solar: number; battery: number }> = Array.from({ length: 36 }, (_, index) => ({
  solar: 81.8 + Math.sin(index * 0.42) * 0.55,
  battery: 94.2,
}));

const phaseLabels: Record<ScenarioPhase, string> = {
  nominal: "NOMINAL OPERATIONS",
  watch: "WEATHER WATCH",
  storm: "DUST STORM ACTIVE",
  degraded: "SYSTEMS DEGRADED",
  containment: "CONTAINMENT ACTIVE",
  recovery: "CONTROLLED RECOVERY",
};

function selectModule(module: ModuleDefinition): void {
  document.querySelectorAll(".module-row").forEach((row) => row.classList.remove("selected"));
  document.querySelector(`[data-module="${module.id}"]`)?.classList.add("selected");
  byId<HTMLElement>("scene-stage").dataset.selectedModule = module.code;
}

document.querySelectorAll<HTMLButtonElement>(".module-row").forEach((button) => {
  button.addEventListener("click", () => {
    const module = MODULES.find(({ id }) => id === button.dataset.module);
    if (module) {
      scene.focusModule(module.id);
      selectModule(module);
    }
  });
});

function severityForMetric(metric: "solar" | "battery" | "oxygen" | "pressure", data: Telemetry): Severity {
  if (metric === "solar") return data.solarOutputKw < 20 ? "critical" : data.solarOutputKw < 50 ? "warning" : "success";
  if (metric === "battery") return data.batteryPercent < 65 ? "critical" : data.batteryPercent < 80 ? "warning" : "success";
  if (metric === "oxygen") return data.oxygenPercent < 20.15 ? "critical" : data.oxygenPercent < 20.55 ? "warning" : "success";
  return data.habitatPressureKpa < 98.5 ? "critical" : data.habitatPressureKpa < 100 ? "warning" : "success";
}

function setMetricState(metric: "solar" | "battery" | "oxygen" | "pressure", severity: Severity): void {
  const card = document.querySelector<HTMLElement>(`[data-metric="${metric}"]`);
  if (card) card.dataset.severity = severity;
}

function metricText(severity: Severity): string {
  if (severity === "critical") return "CRITICAL";
  if (severity === "warning") return "WATCH";
  return "NOMINAL";
}

function sparklineSvg(values: Array<{ solar: number; battery: number }>): string {
  const width = 276;
  const height = 72;
  const points = (field: "solar" | "battery", min: number, max: number): string =>
    values
      .map((entry, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((entry[field] - min) / (max - min)) * (height - 8) - 4;
        return `${x.toFixed(1)},${Math.max(2, Math.min(height - 2, y)).toFixed(1)}`;
      })
      .join(" ");
  const solarPoints = points("solar", 0, 90);
  const batteryPoints = points("battery", 50, 100);
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
    <defs><linearGradient id="solar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2b84b" stop-opacity=".35"/><stop offset="1" stop-color="#f2b84b" stop-opacity="0"/></linearGradient></defs>
    <path class="grid-line" d="M0 18H276M0 36H276M0 54H276"/>
    <polygon points="0,72 ${solarPoints} 276,72" fill="url(#solar-fill)"/>
    <polyline class="solar-line" points="${solarPoints}"/>
    <polyline class="battery-line" points="${batteryPoints}"/>
  </svg>`;
}

function updateEventStream(): void {
  const baseEvents = running || missionSecond > 0 ? snapshotAt(missionSecond).events : [];
  const events = [...baseEvents, ...operatorEvents].sort((a, b) => a.atSecond - b.atSecond);
  byId<HTMLElement>("event-count").textContent = `${String(events.length).padStart(2, "0")} EVENTS`;
  const list = byId<HTMLDivElement>("event-list");
  if (events.length === 0) {
    list.innerHTML = '<div class="empty-events"><span>STREAM READY</span>Run the drill to generate traceable mission events.</div>';
    return;
  }
  list.innerHTML = events
    .slice()
    .reverse()
    .map(
      ({ id, atSecond, severity, source, message, action }) => `
        <article class="event-entry" data-severity="${severity}">
          <time>T+${String(atSecond).padStart(2, "0")}s</time>
          <span class="event-marker"></span>
          <div><header><strong>${source}</strong><small>${id.toUpperCase()}</small></header><p>${message}</p>${action ? `<em>${action}</em>` : ""}</div>
        </article>`,
    )
    .join("");
}

function updateModules(data: Telemetry): void {
  document.querySelectorAll<HTMLElement>(".module-row").forEach((row) => {
    const id = row.dataset.module;
    let state: Severity | "isolated" = data.phase === "degraded" ? "critical" : data.phase === "storm" ? "warning" : "success";
    if (id === "greenhouse-01" && data.greenhouseIsolated) state = "isolated";
    if (id === "airlock-02" && data.airlockSealed) state = "success";
    row.dataset.state = state;
  });
}

function healthScore(data: Telemetry): number {
  const powerPenalty = Math.max(0, 70 - data.solarOutputKw) * 0.22;
  const batteryPenalty = Math.max(0, 85 - data.batteryPercent) * 0.3;
  const pressurePenalty = Math.max(0, 101 - data.habitatPressureKpa) * 2.1;
  return Math.max(41, Math.round(98 - powerPenalty - batteryPenalty - pressurePenalty));
}

function updateDisplay(data: Telemetry): void {
  currentTelemetry = data;
  scene.setTelemetry(data);
  updateModules(data);

  const phaseChip = byId<HTMLDivElement>("phase-chip");
  phaseChip.dataset.phase = data.phase;
  phaseChip.lastChild!.textContent = phaseLabels[data.phase];

  byId<HTMLElement>("solar-value").textContent = data.solarOutputKw.toFixed(1);
  byId<HTMLElement>("battery-value").textContent = data.batteryPercent.toFixed(1);
  byId<HTMLElement>("oxygen-value").textContent = data.oxygenPercent.toFixed(2);
  byId<HTMLElement>("pressure-value").textContent = data.habitatPressureKpa.toFixed(1);

  byId<HTMLElement>("solar-track").style.width = `${Math.min(100, (data.solarOutputKw / 85) * 100)}%`;
  byId<HTMLElement>("battery-track").style.width = `${data.batteryPercent}%`;
  byId<HTMLElement>("oxygen-track").style.width = `${Math.min(100, (data.oxygenPercent / 21.2) * 100)}%`;
  byId<HTMLElement>("pressure-track").style.width = `${Math.min(100, (data.habitatPressureKpa / 102) * 100)}%`;

  const severities = {
    solar: severityForMetric("solar", data),
    battery: severityForMetric("battery", data),
    oxygen: severityForMetric("oxygen", data),
    pressure: severityForMetric("pressure", data),
  };
  (Object.entries(severities) as Array<[keyof typeof severities, Severity]>).forEach(([metric, severity]) => {
    setMetricState(metric, severity);
    byId<HTMLElement>(`${metric}-state`).textContent = metricText(severity);
  });

  const reserveHours = Math.max(1.2, (data.batteryPercent / Math.max(1, data.crewLoadKw + data.lifeSupportLoadKw + data.nonessentialLoadKw)) * 5.2);
  byId<HTMLElement>("solar-delta").textContent = `${Math.round((data.solarOutputKw / 82.4 - 1) * 100)}% vs baseline`;
  byId<HTMLElement>("battery-delta").textContent = `${reserveHours.toFixed(1)}h modeled reserve`;
  byId<HTMLElement>("oxygen-delta").textContent = `${data.co2Ppm} ppm CO₂`;
  byId<HTMLElement>("pressure-delta").textContent = `Δ ${(data.habitatPressureKpa - 101.2).toFixed(1)} kPa`;

  const score = healthScore(data);
  byId<HTMLElement>("health-score").textContent = String(score);
  byId<HTMLElement>("health-orbit").style.setProperty("--health", `${score * 3.6}deg`);
  const statusText = score < 60 ? "CREW SYSTEMS AT RISK" : score < 82 ? "DEGRADED — ACTION REQUIRED" : "ALL CRITICAL SYSTEMS STABLE";
  byId<HTMLElement>("health-status").textContent = statusText;
  byId<HTMLElement>("health-orbit").dataset.severity = score < 60 ? "critical" : score < 82 ? "warning" : "success";

  byId<HTMLElement>("airlock-state").textContent = data.airlockSealed ? "SEALED / VERIFIED" : "OPEN / READY";
  byId<HTMLElement>("greenhouse-state").textContent = data.greenhouseIsolated ? "ISOLATED" : "CONNECTED";
  byId<HTMLElement>("powerbus-state").textContent = data.emergencyBusActive ? "EMERGENCY BUS" : "PRIMARY";
  byId<HTMLElement>("automation-state").textContent = data.loadSheddingActive ? "EXECUTING" : running ? "MONITORING" : "STANDBY";

  history.push({ solar: data.solarOutputKw, battery: data.batteryPercent });
  if (history.length > 36) history.shift();
  byId<HTMLDivElement>("power-trend").innerHTML = sparklineSvg(history);
  byId<HTMLElement>("trend-label").textContent = `${data.solarOutputKw.toFixed(1)} kW`;

  const alert = byId<HTMLDivElement>("storm-alert");
  alert.hidden = data.phase === "nominal" || data.phase === "recovery";
  if (!alert.hidden) {
    alert.dataset.severity = data.phase === "degraded" ? "critical" : "warning";
    byId<HTMLElement>("alert-title").textContent =
      data.phase === "watch" ? "DUST FRONT APPROACHING" : data.phase === "storm" ? "SOLAR YIELD COLLAPSING" : data.phase === "degraded" ? "LIFE SUPPORT AT RISK" : "CONTAINMENT IN PROGRESS";
    byId<HTMLElement>("alert-countdown").textContent = data.phase === "watch" ? `T−00:${String(Math.max(0, 12 - Math.floor(missionSecond))).padStart(2, "0")}` : `T+00:${String(Math.floor(missionSecond)).padStart(2, "0")}`;
  }

  const networkStatus = document.querySelector<HTMLElement>(".topbar-center strong");
  if (networkStatus) networkStatus.textContent = data.phase === "degraded" ? "DEGRADED" : data.phase === "nominal" ? "NOMINAL" : "INCIDENT ACTIVE";
  document.querySelector<HTMLElement>(".topbar-center")!.dataset.phase = data.phase;
  updateEventStream();
}

function runScenario(): void {
  running = true;
  missionSecond = 0;
  lastTick = performance.now();
  planReviewed = false;
  planApproved = false;
  scenarioRejected = false;
  operatorEvents = [];
  byId<HTMLButtonElement>("inject-storm").disabled = true;
  byId<HTMLDivElement>("decision-card").hidden = true;
  updateDisplay(telemetryAt(0));
}

function resetScenario(): void {
  running = false;
  missionSecond = 0;
  planReviewed = false;
  planApproved = false;
  scenarioRejected = false;
  operatorEvents = [];
  byId<HTMLButtonElement>("inject-storm").disabled = false;
  byId<HTMLDivElement>("decision-card").hidden = true;
  document.querySelector<HTMLElement>(".topbar-center")!.dataset.phase = "nominal";
  currentTelemetry = nominalTelemetry();
  updateDisplay(currentTelemetry);
  scene.resetView();
}

function requestDecision(): void {
  running = false;
  planReviewed = true;
  byId<HTMLDivElement>("decision-card").hidden = false;
  operatorEvents.push({
    id: "audit-review-001",
    atSecond: 38,
    severity: "warning",
    source: "POLICY-GATE",
    message: "Automated command paused pending human approval.",
  });
  updateEventStream();
}

byId<HTMLButtonElement>("inject-storm").addEventListener("click", runScenario);
byId<HTMLButtonElement>("reset-scenario").addEventListener("click", resetScenario);
byId<HTMLButtonElement>("reset-camera").addEventListener("click", () => scene.resetView());
byId<HTMLButtonElement>("approve-plan").addEventListener("click", () => {
  planApproved = true;
  scenarioRejected = false;
  operatorEvents.push({
    id: "audit-approval-001",
    atSecond: 39,
    severity: "success",
    source: "FLIGHT-DIRECTOR",
    message: "Containment plan approved. Command execution released.",
  });
  byId<HTMLDivElement>("decision-card").hidden = true;
  running = true;
  lastTick = performance.now();
});
byId<HTMLButtonElement>("reject-plan").addEventListener("click", () => {
  scenarioRejected = true;
  running = false;
  operatorEvents.push({
    id: "audit-hold-001",
    atSecond: 39,
    severity: "critical",
    source: "FLIGHT-DIRECTOR",
    message: "Containment plan held for manual review. No commands executed.",
  });
  byId<HTMLDivElement>("decision-card").hidden = true;
  updateEventStream();
});

byId<HTMLButtonElement>("toggle-events").addEventListener("click", (event) => {
  const consoleElement = byId<HTMLElement>("event-console");
  consoleElement.classList.toggle("collapsed");
  (event.currentTarget as HTMLButtonElement).textContent = consoleElement.classList.contains("collapsed") ? "EXPAND" : "COLLAPSE";
});

setInterval(() => {
  byId<HTMLElement>("utc-clock").textContent = new Date().toISOString().slice(11, 19);
}, 1000);

function animationLoop(now: number): void {
  if (running) {
    const deltaSeconds = (now - lastTick) / 1000;
    lastTick = now;
    const nextSecond = missionSecond + deltaSeconds * 1.35;
    if (nextSecond >= 38 && !planReviewed) {
      missionSecond = 38;
      updateDisplay(telemetryAt(missionSecond));
      requestDecision();
    } else {
      missionSecond = nextSecond;
      updateDisplay(telemetryAt(missionSecond));
      if (missionSecond >= 90) {
        running = false;
        byId<HTMLButtonElement>("inject-storm").disabled = false;
      }
    }
  } else if (!scenarioRejected && !planApproved && missionSecond === 0) {
    currentTelemetry.missionSecond = 0;
  }
  requestAnimationFrame(animationLoop);
}

updateDisplay(nominalTelemetry());
requestAnimationFrame(animationLoop);

window.addEventListener("beforeunload", () => scene.dispose());
