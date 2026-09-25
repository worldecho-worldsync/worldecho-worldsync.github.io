const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES = new Set(["circle", "triangle", "square", "diamond"]);
const COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function fail(path, message) {
  throw new TypeError(`Action coverage: ${path} ${message}`);
}

function label(value, path) {
  if (typeof value !== "string" || !value.trim()) fail(path, "must be a non-empty string.");
  return value.trim();
}

function contourPaths(paths, path) {
  if (!Array.isArray(paths) || !paths.length) fail(path, "must contain exported contour paths.");
  return paths.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every((point) =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
      fail(path, "must contain finite coordinate rings.");
    }
    // Matplotlib can emit the closing vertex with a final-bit float difference.
    if (ring[0].some((value, axis) => Math.abs(value - ring.at(-1)[axis]) > 1e-12)) fail(path, "must contain closed rings.");
    return ring.map((point) => [...point]);
  });
}

// Validate real exported coordinates before touching the page. No samples,
// densities, projection fits, or missing values are inferred here.
export function validateActionCoverage(data) {
  if (!data || typeof data !== "object") fail("data", "must be an object.");
  if (!Array.isArray(data.groups) || !data.groups.length) fail("groups", "must be a non-empty array.");
  const ids = new Set();
  const groups = data.groups.map((group, index) => {
    const path = `groups[${index}]`;
    if (!group || typeof group !== "object") fail(path, "must be an object.");
    const id = label(group.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, `duplicates "${id}".`);
    ids.add(id);
    const name = label(group.label, `${path}.label`);
    if (typeof group.color !== "string" || !COLOR.test(group.color)) fail(`${path}.color`, "must be a hexadecimal CSS color.");
    if (!SHAPES.has(group.shape)) fail(`${path}.shape`, "must be circle, triangle, square, or diamond.");
    if (!Array.isArray(group.points) || !group.points.length) fail(`${path}.points`, "must be a non-empty array.");
    const points = group.points.map((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
        fail(`${path}.points[${pointIndex}]`, "must contain exactly two finite numbers.");
      }
      return [point[0], point[1]];
    });
    const result = { id, label: name, color: group.color, shape: group.shape, points };
    if (group.totalCount !== undefined) {
      if (!Number.isInteger(group.totalCount) || group.totalCount < points.length) fail(`${path}.totalCount`, "must include every displayed point.");
      result.totalCount = group.totalCount;
    }
    if (group.hdrPaths !== undefined) result.hdrPaths = contourPaths(group.hdrPaths, `${path}.hdrPaths`);
    return result;
  });
  const projection = {
    xLabel: label(data.projection?.xLabel, "projection.xLabel"),
    yLabel: label(data.projection?.yLabel, "projection.yLabel"),
  };
  if (data.projection.explainedVariance !== undefined) {
    const variance = data.projection.explainedVariance;
    if (!Array.isArray(variance) || variance.length !== 2 ||
        !variance.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
        variance[0] + variance[1] > 1 + 1e-10) {
      fail("projection.explainedVariance", "must contain two variance ratios between 0 and 1 whose sum is at most 1.");
    }
    projection.explainedVariance = [...variance];
  }
  if (data.projection.domain !== undefined) {
    projection.domain = {};
    for (const axis of ["x", "y"]) {
      const bounds = data.projection.domain[axis];
      if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[1]) {
        fail(`projection.domain.${axis}`, "must contain increasing finite bounds.");
      }
      projection.domain[axis] = [...bounds];
    }
  }
  const source = { label: label(data.source?.label, "source.label") };
  if (data.source.url !== undefined) {
    const url = label(data.source.url, "source.url");
    if (/^[\w+.-]+:/.test(url)) {
      let parsed;
      try { parsed = new URL(url); } catch { fail("source.url", "must be a valid URL."); }
      if (!["https:", "http:"].includes(parsed.protocol)) fail("source.url", "must use HTTP or HTTPS.");
    } else if (url.startsWith("//") || /[\\\u0000-\u0020]/.test(url)) {
      fail("source.url", "must be a normal relative path or an HTTP(S) URL.");
    }
    source.url = url;
  }
  const result = { groups, projection, source };
  if (data.regions !== undefined) {
    if (!Array.isArray(data.regions) || !data.regions.length) fail("regions", "must be a non-empty array.");
    const regionIds = new Set();
    result.regions = data.regions.map((region, index) => {
      const path = `regions[${index}]`;
      const id = label(region.id, `${path}.id`);
      if (regionIds.has(id)) fail(`${path}.id`, "must be unique.");
      regionIds.add(id);
      if (!COLOR.test(region.color)) fail(`${path}.color`, "must be a hexadecimal CSS color.");
      if (!Array.isArray(region.groupIds) || !region.groupIds.length || !region.groupIds.every((groupId) => ids.has(groupId))) fail(`${path}.groupIds`, "must reference known categories.");
      return { id, label: label(region.label, `${path}.label`), color: region.color,
        groupIds: [...region.groupIds], paths: contourPaths(region.paths, `${path}.paths`) };
    });
  }
  return result;
}

// null is the All selection. Selecting the same category restores all groups.
export function nextActionCoverageSelection(current, clicked, groupIds) {
  const ids = new Set(groupIds);
  for (const value of [current, clicked]) {
    if (value !== null && !ids.has(value)) throw new RangeError(`Action coverage: unknown category "${value}".`);
  }
  return clicked === null || clicked === current ? null : clicked;
}

function extent(groups, dimension) {
  let min = Infinity;
  let max = -Infinity;
  for (const group of groups) {
    for (const point of group.points) {
      min = Math.min(min, point[dimension]);
      max = Math.max(max, point[dimension]);
    }
  }
  const span = max - min;
  if (!Number.isFinite(span)) fail("points", "have a coordinate range too large to display.");
  // A fixed domain is calculated once. Selection only changes emphasis.
  return { min, span };
}

function insideContours({ x, y }, paths) {
  let inside = false;
  // Parity over all rings matches the SVG evenodd fill, including holes.
  for (const ring of paths ?? []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// The same geometry drives both views; picking never depends on SVG draw order.
export function pickActionCoverageGroup(groups, location, { pointRadius = 12, includePoints = true } = {}) {
  let nearby = null;
  let nearbyDistance = Infinity;
  let containing = null;
  let containingDistance = Infinity;
  for (const group of groups) {
    let distance = Infinity;
    for (const [x, y] of group.points) {
      distance = Math.min(distance, (x - location.x) ** 2 + (y - location.y) ** 2);
    }
    if (includePoints && distance <= pointRadius ** 2 && distance < nearbyDistance) {
      nearby = group.id;
      nearbyDistance = distance;
    }
    if (distance < containingDistance && insideContours(location, group.hdrPaths)) {
      containing = group.id;
      containingDistance = distance;
    }
  }
  return nearby ?? containing;
}

export function setupActionCoverage(root, payload) {
  if (!root) throw new TypeError("Action coverage: a root element is required.");
  const data = validateActionCoverage(payload);
  const domainExtent = (axis, dimension) => data.projection.domain
    ? { min: data.projection.domain[axis][0], span: data.projection.domain[axis][1] - data.projection.domain[axis][0] }
    : extent(data.groups, dimension);
  const xExtent = domainExtent("x", 0);
  const yExtent = domainExtent("y", 1);
  const doc = root.ownerDocument;
  const svg = (name, attributes = {}) => {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const text = (parent, content, attributes) => {
    const element = svg("text", attributes);
    element.textContent = content;
    parent.append(element);
  };
  const marker = (shape, x, y, radius) => {
    if (shape === "circle") return svg("circle", { cx: x, cy: y, r: radius });
    if (shape === "square") return svg("rect", { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
    const points = shape === "triangle"
      ? `${x},${y - radius * 1.2} ${x + radius * 1.05},${y + radius * .8} ${x - radius * 1.05},${y + radius * .8}`
      : `${x},${y - radius * 1.3} ${x + radius * 1.3},${y} ${x},${y + radius * 1.3} ${x - radius * 1.3},${y}`;
    return svg("polygon", { points });
  };

  const axisLabel = (name, index) => data.projection.explainedVariance && !name.includes("%")
    ? `${name} (${(data.projection.explainedVariance[index] * 100).toFixed(1)}% variance)`
    : name;
  const xLabel = axisLabel(data.projection.xLabel, 0);
  const yLabel = axisLabel(data.projection.yLabel, 1);
  const chart = svg("svg", { class: "ac-plot", viewBox: "0 0 760 500", role: "img" });
  chart.append(svg("rect", { x: 0, y: 0, width: 760, height: 500, fill: "transparent", "pointer-events": "all", "aria-hidden": "true" }));
  const axes = svg("g", { class: "ac-axes", fill: "currentColor" });
  if (!data.projection.domain) axes.append(svg("path", { d: "M 88 20 V 446 H 740", fill: "none", stroke: "currentColor", "stroke-width": 1 }));
  text(axes, xLabel, { x: 414, y: 487, "text-anchor": "middle", class: "ac-axis-label" });
  text(axes, yLabel, { x: 18, y: 235, transform: "rotate(-90 18 235)", "text-anchor": "middle", class: "ac-axis-label" });
  chart.append(axes);

  const clouds = new Map();
  const scale = (value, domain, start, end) => domain.span === 0
    ? (start + end) / 2
    : start + (value - domain.min) / domain.span * (end - start);
  const toPlot = ([x, y]) => [scale(x, xExtent, 104, 724), scale(y, yExtent, 430, 36)];
  const hitGroups = data.groups.map((group) => ({
    id: group.id,
    points: group.points.map(toPlot),
    hdrPaths: group.hdrPaths?.map((ring) => ring.map(toPlot)),
  }));
  const ticks = (domain) => domain.span === 0
    ? [domain.min]
    : Array.from({ length: 5 }, (_, index) => domain.min + domain.span * index / 4);
  const tickLabel = (value) => {
    const absolute = Math.abs(value);
    if (absolute !== 0 && (absolute < .001 || absolute >= 10000)) return value.toExponential(2);
    return String(Number(value.toPrecision(4)));
  };
  for (const value of data.projection.domain ? [] : ticks(xExtent)) {
    const x = scale(value, xExtent, 104, 724);
    axes.append(svg("path", { d: `M ${x} 446 v 5`, stroke: "currentColor", fill: "none" }));
    text(axes, tickLabel(value), { x, y: 465, "text-anchor": "middle", "font-size": 11, class: "ac-axis-tick" });
  }
  for (const value of data.projection.domain ? [] : ticks(yExtent)) {
    const y = scale(value, yExtent, 430, 36);
    axes.append(svg("path", { d: `M 83 ${y} h 5`, stroke: "currentColor", fill: "none" }));
    text(axes, tickLabel(value), { x: 76, y: y + 4, "text-anchor": "end", "font-size": 11, class: "ac-axis-tick" });
  }
  const supports = svg("g", { class: "ac-supports", "aria-hidden": "true" });
  chart.append(supports);
  const regions = new Map();
  const familyRegions = new Map();
  const contour = (paths, color, className) => svg("path", {
    class: className,
    d: paths.map((ring) => ring.map(([x, y], i) => `${i ? "L" : "M"}${scale(x, xExtent, 104, 724)},${scale(y, yExtent, 430, 36)}`).join(" ") + " Z").join(" "),
    fill: color, stroke: color, "fill-rule": "evenodd", "stroke-width": 1.6, "stroke-dasharray": "5 3",
  });
  for (const region of [...(data.regions ?? [])].reverse()) {
    const path = contour(region.paths, region.color, "ac-region");
    path.setAttribute("data-ac-region", region.id);
    regions.set(region.id, path);
    supports.append(path);
  }
  for (const group of data.groups) {
    if (group.hdrPaths) {
      const path = contour(group.hdrPaths, group.color, "ac-family-region");
      path.setAttribute("data-ac-family-region", group.id);
      familyRegions.set(group.id, path);
      supports.append(path);
    }
  }
  // Match the paper's draw order: off-expert families first, expert last.
  for (const group of [...data.groups.slice(1), data.groups[0]]) {
    const cloud = svg("g", { class: "ac-cloud", "data-ac-group": group.id, fill: group.color, "aria-hidden": "true" });
    for (const [x, y] of group.points) {
      const point = marker(group.shape, scale(x, xExtent, 104, 724), scale(y, yExtent, 430, 36), 3.6);
      point.setAttribute("class", "ac-point");
      const title = svg("title");
      title.textContent = `${group.label} · PC1 ${x.toFixed(3)}, PC2 ${y.toFixed(3)}`;
      point.append(title);
      cloud.append(point);
    }
    clouds.set(group.id, cloud);
    chart.append(cloud);
  }

  const buttons = new Map();
  const controls = doc.createDocumentFragment();
  function makeButton(id, name, group) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "ac-category";
    button.setAttribute("aria-pressed", "false");
    if (group) {
      button.dataset.acGroup = id;
      const icon = svg("svg", { class: "ac-category-mark", viewBox: "0 0 20 20", width: 20, height: 20, fill: group.color, "aria-hidden": "true", focusable: "false" });
      icon.append(marker(group.shape, 10, 10, 4.5));
      button.append(icon);
    } else button.dataset.acAll = "";
    const nameElement = doc.createElement("span");
    nameElement.textContent = name;
    button.append(nameElement);
    buttons.set(id, button);
    controls.append(button);
    return button;
  }
  makeButton(null, "All");
  for (const group of data.groups) makeButton(group.id, group.label, group);

  const host = (attribute, className) => {
    let element = root.querySelector(`[${attribute}]`);
    if (!element) {
      element = doc.createElement("div");
      element.setAttribute(attribute, "");
      element.className = className;
      root.append(element);
    }
    return element;
  };
  const plotHost = host("data-ac-plot", "ac-plot-host");
  const legend = host("data-ac-legend", "ac-legend");
  plotHost.replaceChildren(chart);
  legend.replaceChildren(controls);
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", "Highlight an action category");
  const hasDensity = regions.size > 0 && familyRegions.size === data.groups.length;
  if (hasDensity) {
    const key = host("data-ac-support-key", "ac-support-key");
    key.replaceChildren();
    for (const region of data.regions) {
      const item = doc.createElement("span");
      const icon = svg("svg", { width: 28, height: 12, "aria-hidden": "true" });
      icon.append(svg("path", { d: "M 0 6 H 28", stroke: region.color, "stroke-width": 2, "stroke-dasharray": "5 3" }));
      const name = doc.createElement("span");
      name.textContent = region.label;
      item.append(icon, name);
      key.append(item);
    }
  }
  let selected = null;
  const ids = data.groups.map((group) => group.id);
  const count = data.groups.reduce((sum, group) => sum + group.points.length, 0);

  function renderSelection() {
    for (const group of data.groups) {
      const cloud = clouds.get(group.id);
      const muted = selected !== null && selected !== group.id;
      cloud.classList.toggle("is-muted", muted);
      cloud.classList.toggle("is-selected", selected === group.id);
      cloud.setAttribute("opacity", muted ? ".12" : "1");
      chart.append(cloud);
    }
    if (selected === null) chart.append(clouds.get(data.groups[0].id));
    if (selected !== null) chart.append(clouds.get(selected));
    for (const path of regions.values()) {
      path.setAttribute("opacity", selected === null ? "1" : ".22");
      path.setAttribute("fill-opacity", ".045");
    }
    for (const [id, path] of familyRegions) {
      path.setAttribute("visibility", selected === id ? "visible" : "hidden");
      path.setAttribute("fill-opacity", ".06");
    }
    chart.classList.toggle("has-highlight", selected !== null);
    for (const [id, button] of buttons) {
      button.setAttribute("aria-pressed", String(id === selected));
      button.classList.toggle("is-selected", id === selected);
    }
    const group = data.groups.find((item) => item.id === selected);
    const statusText = group
      ? `${group.label}: ${group.points.length} points highlighted${group.totalCount ? ` from ${group.totalCount} samples` : ""}. Other categories are dimmed.`
      : `All ${data.groups.length} categories shown · ${count} points${data.groups.every((item) => item.totalCount) ? ` from ${data.groups.reduce((sum, item) => sum + item.totalCount, 0)} samples` : ""}.`;
    chart.setAttribute("aria-label", `${data.source.label}. ${xLabel}; ${yLabel}. ${statusText}`);
  }
  function select(category) {
    selected = nextActionCoverageSelection(selected, category, ids);
    renderSelection();
    return selected;
  }
  function highlight(category) {
    if (category === selected) return;
    selected = category;
    renderSelection();
  }
  for (const [id, button] of buttons) button.addEventListener("click", () => select(id));
  for (const [id, cloud] of clouds) cloud.addEventListener("click", (event) => {
    if (event.pointerType === "touch") select(id);
    else highlight(id);
  });
  chart.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || event.buttons > 0) return;
    const matrix = chart.getScreenCTM();
    if (!matrix) return;
    const point = chart.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const position = point.matrixTransform(matrix.inverse());
    highlight(pickActionCoverageGroup(hitGroups, position, {
      pointRadius: 12 / Math.hypot(matrix.a, matrix.b),
      includePoints: true,
    }));
  });
  for (const eventName of ["pointerleave", "pointercancel"]) {
    chart.addEventListener(eventName, (event) => {
      if (event.pointerType !== "touch") highlight(null);
    });
  }
  renderSelection();
  root.hidden = false;
  return { select, getSelection: () => selected, data };
}
