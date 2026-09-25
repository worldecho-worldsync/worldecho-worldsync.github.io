import { VideoGroup } from "./video-playback.js";
import { setupRolloutTrajectories } from "./rollout-trajectory.js";

const COMPARISON_IDS = ["cosmos3_coverage", "cosmos_predict25_coverage", "ctrlworld_coverage", "dreamdojo_coverage", "motus_coverage", "lingbotva_coverage"];
const DEFAULT_MODEL = "motus_coverage";
const DEFAULT_CASE = "random_feasible_uniform_put_object_cabinet_ep0001_start0082_seed0012_s0249_cw32";
const GATES = [
  { id: "image_quality", label: "Image quality" },
  { id: "motion_smoothness", label: "Smoothness" },
  { id: "eef_visibility", label: "EEF visibility" },
  { id: "arm_integrity", label: "Arm integrity" },
];
const GATE_STATUS = {
  pass: { icon: "✓", label: "Passed" },
  fail: { icon: "×", label: "Failed" },
  unavailable: { icon: "?", label: "Unavailable" },
  skipped: { icon: "−", label: "Skipped" },
};
const instances = new WeakMap();
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Keep each gate's own units: these scores are not interchangeable probabilities. */
export function formatGateScore(record) {
  const empty = { valueText: "—", thresholdText: "", detail: "Score unavailable" };
  if (!record || !["pass", "fail"].includes(record.status) || !finite(record.score)) return empty;
  const score = record.score;
  const thresholdText = finite(record.threshold) ? `≥${record.threshold.toFixed(3)}` : "";
  if (record.id === "arm_integrity") {
    if (![0, 1].includes(score)) return empty;
    return { valueText: String(score), thresholdText: "", detail: `Binary judgment: ${score}; 1 = intact, 0 = failed. Not a confidence score. No numeric threshold was reported.` };
  }
  if (record.id === "eef_visibility") {
    const { numerator, denominator, thresholdCount } = record;
    const countsValid = [numerator, denominator, thresholdCount].every(Number.isInteger)
      && denominator > 0 && numerator >= 0 && numerator <= denominator && thresholdCount >= 0 && thresholdCount <= denominator
      && Math.abs(numerator / denominator - score) < 1e-9
      && finite(record.threshold) && Math.abs(thresholdCount / denominator - record.threshold) < 1e-9;
    if (countsValid) return { valueText: `${numerator}/${denominator}`, thresholdText: `≥${thresholdCount}f`, detail: `${numerator} of ${denominator} frames satisfy the visibility rule; at least ${thresholdCount} required. Raw ratio ${score.toFixed(6)}, threshold ${record.threshold.toFixed(6)}.` };
    return { valueText: score.toFixed(3), thresholdText, detail: `Recorded visibility ratio ${score}; threshold ${record.threshold ?? "unreported"}. Frame counts unavailable.` };
  }
  let decimals = 3;
  // Preserve a visible threshold failure when rounding would make the values equal.
  while (decimals < 8 && finite(record.threshold) && score < record.threshold && score.toFixed(decimals) === record.threshold.toFixed(decimals)) decimals += 1;
  return {
    valueText: score.toFixed(decimals), thresholdText,
    detail: record.id === "image_quality" ? `MUSIQ / 100: ${score}; threshold ${record.threshold ?? "unreported"}. Not a probability.`
      : `VFIMamba smoothness: ${score}; threshold ${record.threshold ?? "unreported"}. This score can exceed 1.`,
  };
}

/** A mismatch with either displayed video's identity invalidates the comparison. */
export function getTrajectoryComparison(clip, reference) {
  const metric = clip?.trajectoryComparison;
  if (metric?.version !== 1 || metric.metricId !== "pose_dtw_rot005_path_mean") return null;
  if (![metric.poseDtw, metric.positionCm, metric.rotationDeg].every((v) => finite(v) && v >= 0)) return null;
  if (!clip?.trajectory?.videoSha256 || !reference?.trajectory?.videoSha256) return null;
  if (metric.videoSha256 !== clip.trajectory.videoSha256 || metric.referenceVideoSha256 !== reference.trajectory.videoSha256) return null;
  if (metric.checkpointSha256 !== clip.trajectory.checkpointSha256 || metric.checkpointSha256 !== reference.trajectory.checkpointSha256) return null;
  for (const [side, track] of [["prediction", clip.trajectory], ["reference", reference.trajectory]]) {
    for (const key of ["xyz", "rotmat"]) {
      if (!metric.trajectoryHashes?.[side]?.[key] || metric.trajectoryHashes[side][key] !== track.projection?.[`${key}Sha256`]) return null;
    }
  }
  return metric;
}

export function caseOptionLabel(sample) {
  return sample.label || String(sample.task || "Task").replaceAll("_", " ");
}

function assetPath(value) {
  return typeof value === "string" && value.startsWith("assets/") && !value.split("/").includes("..") ? value : "";
}

/** The full catalog remains intact; the gallery exposes only reviewed examples. */
export function getDemoCases(catalog) {
  return catalog.cases.filter((sample) => sample.review?.status === "recommend");
}

export function getComparisonModels(catalog) {
  return COMPARISON_IDS.map((id) => catalog.models.find((model) => model.id === id)).filter(Boolean);
}

/** Missing, ambiguous or malformed records must never appear as passed gates. */
export function getVisualGates(clip) {
  const records = Array.isArray(clip?.visualGates) ? clip.visualGates : [];
  return GATES.map((gate) => {
    const matches = records.filter((record) => record?.id === gate.id);
    const record = matches.length === 1 ? matches[0] : null;
    const status = record && Object.hasOwn(GATE_STATUS, record.status) ? record.status : "unavailable";
    return { ...gate, status, icon: GATE_STATUS[status].icon, ...formatGateScore(record && { ...record, id: gate.id, status }) };
  });
}

/** Keep catalog errors separate from an individual missing recording. */
export function validateCatalog(catalog) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.models) || !Array.isArray(catalog.cases)) {
    throw new TypeError("Unsupported rollout catalog.");
  }
  for (const [items, kind] of [[catalog.models, "model"], [catalog.cases, "sample"]]) {
    if (!items.length || items.some((item) => !item || typeof item.id !== "string" || !item.id)) {
      throw new TypeError(`The catalog needs named ${kind}s.`);
    }
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new TypeError(`The catalog has duplicate ${kind} IDs.`);
    }
  }
  if (!catalog.models.some((model) => model.id === "worldsync") || !getComparisonModels(catalog).length) {
    throw new TypeError("The catalog needs WorldSync and a supported comparison model.");
  }
  return catalog;
}

/** Keep the chosen baseline when its recording is missing; never substitute it. */
export function selectComparison(catalog, caseId, modelId = DEFAULT_MODEL) {
  const cases = getDemoCases(catalog);
  const sample = cases.find((item) => item.id === caseId) || cases.find((item) => item.id === DEFAULT_CASE) || cases[0];
  if (!sample) return null;
  const baselines = getComparisonModels(catalog);
  const baseline = baselines.find((model) => model.id === modelId) || baselines.find((model) => model.id === DEFAULT_MODEL) || baselines[0];
  return {
    sample,
    baseline,
    worldsync: catalog.models.find((model) => model.id === "worldsync"),
    clips: { gt: sample.gt, baseline: sample.outputs?.[baseline.id], worldsync: sample.outputs?.worldsync },
  };
}

// Keep the common synchronization behavior; only shorten this gallery's labels.
class RolloutVideoGroup extends VideoGroup {
  render() {
    super.render();
    if (this.toggle) {
      this.toggle.textContent = this.wanted ? "Pause" : "Play";
      this.toggle.setAttribute("aria-label", this.wanted ? "Pause all videos" : "Play all videos");
    }
    if (this.status && this.errorMessage) this.status.textContent = this.errorMessage.replaceAll("Play comparison", "Play");
  }
}

/** Owns its VideoGroup; this root deliberately has no data-video-group attribute. */
export function setupRolloutDemo(root) {
  if (!root) return null;
  if (instances.has(root)) return instances.get(root);
  const query = (selector) => root.querySelector(selector);
  const caseSelect = query("[data-rollout-case]");
  const modelSelect = query("[data-rollout-model]");
  const loadPanel = query("[data-rollout-load]");
  const loadMessage = query("[data-rollout-load-message]");
  const retry = query("[data-rollout-retry]");
  const content = query("[data-rollout-content]");
  const comparison = query("[data-rollout-comparison]");
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const slots = new Map(Array.from(root.querySelectorAll("[data-rollout-slot]")).map((slot) => [slot.dataset.rolloutSlot, {
    video: slot.querySelector("video"),
    error: slot.querySelector(".rollout-media-error"),
    gates: slot.querySelector("[data-rollout-gates]"),
  }]));
  let catalog;
  let group;
  let observer;
  let loading = false;
  let selected;
  let trajectoryGroup;
  let inViewport = !("IntersectionObserver" in window);

  function renderGates(slot, clip, isReference) {
    const gates = getVisualGates(clip);
    if (isReference && gates.every((gate) => gate.status === "unavailable")) {
      const reference = document.createElement("li");
      reference.className = "rollout-gate-reference";
      reference.textContent = "GT reference";
      slot.gates.replaceChildren(reference);
      slot.gates.setAttribute("aria-label", "Ground-truth reference");
      return;
    }
    slot.gates.setAttribute("aria-label", isReference ? "GT visual gates" : "Model visual gates");
    slot.gates.replaceChildren(...gates.map((gate) => {
      const item = document.createElement("li");
      const statusLabel = GATE_STATUS[gate.status].label;
      item.dataset.gate = gate.id;
      item.dataset.status = gate.status;
      item.title = `${gate.label}: ${statusLabel}. ${gate.detail} Recorded sample-pack check.`;
      item.setAttribute("aria-label", item.title);
      const icon = document.createElement("span");
      icon.className = "rollout-gate-icon";
      icon.textContent = gate.icon;
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "rollout-gate-label";
      label.textContent = gate.label;
      const score = document.createElement("strong");
      score.className = "rollout-gate-score";
      score.textContent = gate.valueText;
      const threshold = document.createElement("span");
      threshold.className = "rollout-gate-threshold";
      threshold.textContent = gate.thresholdText;
      item.append(icon, label, score, threshold);
      return item;
    }));
  }

  function renderComparison(clips, baseline) {
    if (!comparison) return;
    const table = document.createElement("table");
    table.className = "rollout-trajectory-table";
    const caption = table.createCaption();
    caption.className = "sr-only";
    caption.textContent = `SE(3) trajectory errors against GT: ${baseline.label || baseline.id} and WorldSync. Lower is better.`;
    table.title = "AnyPos estimates compared with the reference-video AnyPos estimate, not simulator pose truth. NDTW is path-normalized pose DTW: sqrt(position_m² + (0.05 × rotation_rad)²), averaged over each arm's FastDTW alignment path, then averaged over both arms. Not a 0–1 navigation similarity. Position and rotation use the same alignment paths. Recomputed from the displayed tracks; not the published benchmark score.";
    const header = table.createTHead().insertRow();
    for (const [label, fullLabel] of [["SE(3) ↓", "Trajectory error against GT; lower is better"], [baseline.label || baseline.id, baseline.label || baseline.id], ["WorldSync", "WorldSync"]]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      cell.title = fullLabel;
      cell.setAttribute("aria-label", fullLabel);
      header.append(cell);
    }
    const metrics = ["baseline", "worldsync"].map((key) => [key, getTrajectoryComparison(clips[key], clips.gt)]);
    const body = table.createTBody();
    for (const [key, label, places, fullLabel] of [["poseDtw", "NDTW", 5, "Path-normalized SE(3) pose DTW"], ["positionCm", "Pos. (cm)", 2, "Position error in centimetres, along the pose-DTW path"], ["rotationDeg", "Rot. (°)", 2, "Rotation error in degrees, along the pose-DTW path"]]) {
      const row = body.insertRow();
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = label;
      name.title = fullLabel;
      name.setAttribute("aria-label", fullLabel);
      row.append(name);
      for (const [model, metric] of metrics) {
        const cell = row.insertCell();
        cell.dataset.comparisonModel = model;
        cell.dataset.metric = key;
        cell.textContent = metric ? metric[key].toFixed(places) : "—";
      }
    }
    comparison.replaceChildren(table);
  }

  function renderSelection() {
    selected = selectComparison(catalog, caseSelect.value, modelSelect.value);
    if (!selected) return;
    const { sample, baseline, clips } = selected;
    caseSelect.value = sample.id;
    modelSelect.value = baseline.id;
    query("[data-rollout-model-name]").textContent = baseline.label || baseline.id;
    const updateSources = () => {
      for (const [key, slot] of slots) {
        const clip = clips[key];
        const available = !!assetPath(clip?.src);
        slot.video.hidden = !available;
        slot.error.hidden = available;
        slot.error.textContent = "Recording unavailable. Choose another task or model.";
        renderGates(slot, clip, key === "gt");
        if (available) slot.video.src = clip.src;
        else slot.video.removeAttribute("src");
        if (assetPath(clip?.poster)) slot.video.poster = clip.poster;
        else slot.video.removeAttribute("poster");
        const modelName = key === "gt" ? "Ground truth" : key === "baseline" ? baseline.label || baseline.id : "WorldSync";
        slot.video.setAttribute("aria-label", `${modelName}: ${caseOptionLabel(sample)}`);
      }
      renderComparison(clips, baseline);
    };
    group.replaceSources(updateSources);
    if (Object.values(clips).some((clip) => !assetPath(clip?.src))) {
      group.fail("A recording is unavailable. Choose another task or model.");
    }
    trajectoryGroup.update(clips);
    root.dispatchEvent(new CustomEvent("rollout:selectionchange", { detail: selected }));
  }

  function connectPlayback() {
    if (group) return;
    group = new RolloutVideoGroup(root, {
      reducedMotion: mediaQuery.matches,
      documentVisible: !document.hidden,
      visible: inViewport,
    });
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          inViewport = entry.isIntersecting;
          group.setVisible(inViewport);
        }
      }, { threshold: 0.01 });
      observer.observe(root);
    }
    document.addEventListener("visibilitychange", () => group.setDocumentVisible(!document.hidden));
    mediaQuery.addEventListener("change", (event) => group.setReducedMotion(event.matches));
    for (const [key, slot] of slots) {
      slot.video.addEventListener("error", () => {
        if (!slot.video.error || group.replacing) return;
        slot.error.textContent = "Video unavailable. Select Play to retry.";
        slot.error.hidden = false;
      });
      slot.video.addEventListener("loadstart", () => {
        if (assetPath(selected?.clips[key]?.src)) slot.error.hidden = true;
      });
    }
  }

  async function loadCatalog() {
    if (loading) return;
    loading = true;
    retry.hidden = true;
    loadPanel.hidden = false;
    loadMessage.textContent = "Loading videos…";
    root.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(root.dataset.catalog, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Catalog returned ${response.status}.`);
      catalog = validateCatalog(await response.json());
      const cases = getDemoCases(catalog);
      if (!cases.length) {
        group?.setVisible(false);
        content.hidden = true;
        loadMessage.textContent = "No videos are available yet.";
        retry.hidden = false;
        return;
      }
      const previousModel = modelSelect.value;
      const previousCase = caseSelect.value;
      modelSelect.replaceChildren(...getComparisonModels(catalog).map((model) => new Option(model.label || model.id, model.id)));
      caseSelect.replaceChildren(...cases.map((sample) => new Option(caseOptionLabel(sample), sample.id)));
      const initial = selectComparison(catalog, previousCase, previousModel);
      modelSelect.value = initial.baseline.id;
      caseSelect.value = initial.sample.id;
      // The first assignment also uses load() to clear the empty video's old
      // NETWORK_NO_SOURCE state without suppressing subsequent real errors.
      const firstLoad = !group;
      connectPlayback();
      renderSelection();
      group.setVisible(inViewport);
      if (firstLoad && !mediaQuery.matches && !group.errorMessage) group.play();
      content.hidden = false;
      loadPanel.hidden = true;
    } catch (error) {
      loadMessage.textContent = "Videos could not load. Please retry.";
      retry.hidden = false;
      console.warn("Rollout demo catalog is unavailable.", error);
    } finally {
      loading = false;
      root.setAttribute("aria-busy", "false");
    }
  }

  caseSelect.addEventListener("change", renderSelection);
  modelSelect.addEventListener("change", renderSelection);
  retry.addEventListener("click", loadCatalog);
  trajectoryGroup = setupRolloutTrajectories(root);
  // Personal shortlist storage from the review UI is intentionally untouched.
  const instance = { load: loadCatalog, get selection() { return selected; } };
  instances.set(root, instance);
  loadCatalog();
  return instance;
}
