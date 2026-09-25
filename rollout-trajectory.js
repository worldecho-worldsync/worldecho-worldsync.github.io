const COLORS = ["#05b3a4", "#f27936"];
const AXIS_COLORS = ["#ed4858", "#42bc71", "#448bed"];
const AXIS_SCALE = 1.45;
const HALO = "rgba(8, 14, 18, .62)";

function drawArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 4) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(length * 0.42, 10);
  const shaftX = x2 - Math.cos(angle) * head * 0.5;
  const shaftY = y2 - Math.sin(angle) * head * 0.5;
  ctx.lineCap = "round";
  for (const [stroke, width] of [[HALO, 4.4], [color, 2.6]]) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(shaftX, shaftY); ctx.stroke();
  }
  const baseX = x2 - Math.cos(angle) * head, baseY = y2 - Math.sin(angle) * head;
  const wingX = -Math.sin(angle) * head * 0.5, wingY = Math.cos(angle) * head * 0.5;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(baseX + wingX, baseY + wingY);
  ctx.lineTo(baseX - wingX, baseY - wingY);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = HALO; ctx.lineWidth = 1.2; ctx.lineJoin = "round"; ctx.stroke();
}

export function isVisiblePoint(point) {
  return Array.isArray(point) && point.length === 2
    && point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

export function containRect(width, height, sourceWidth, sourceHeight) {
  if (![width, height, sourceWidth, sourceHeight].every((n) => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function trajectoryFrameIndex(time, duration, count) {
  if (!Number.isInteger(count) || count < 1) return 0;
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  // Absorb floating-point roundoff at an exact native frame boundary.
  return Math.min(count - 1, Math.max(0, Math.floor(time / duration * count + 1e-7)));
}

export function validateTrajectory(value) {
  if (value?.version !== 1 || value.space !== "normalized-image" || !Array.isArray(value.frames) || !value.frames.length) return null;
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) return null;
  if (value.frames.some((f) => !f || !["left", "right"].every((arm) => f[arm] === null || (Array.isArray(f[arm]) && f[arm].length === 2 && f[arm].every(Number.isFinite))))) return null;
  return value;
}

function setupSlot(slot) {
  const video = slot.querySelector("video");
  const canvas = slot.querySelector("[data-rollout-trajectory]");
  if (!video || !canvas) return { update() {}, destroy() {} };
  const ctx = canvas.getContext("2d");
  let data = null;
  let requested = 0;
  let disposed = false;
  canvas.setAttribute("aria-hidden", "true");

  function draw() {
    if (disposed || !ctx) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    if (!data || video.hidden || video.readyState < 2) return;
    const rect = containRect(box.width, box.height, video.videoWidth || data.width, video.videoHeight || data.height);
    if (!rect) return;
    const index = trajectoryFrameIndex(video.currentTime, video.duration, data.frames.length);
    const pointToPixel = (p) => [rect.x + p[0] * rect.width, rect.y + p[1] * rect.height];
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ["left", "right"].forEach((arm, armIndex) => {
      const trace = (through, alpha, lineWidth) => {
        ctx.beginPath(); let connected = false;
        for (let i = 0; i <= through; i += 1) {
          const p = data.frames[i][arm];
          if (!isVisiblePoint(p)) { connected = false; continue; }
          const [x, y] = pointToPixel(p);
          if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          connected = true;
        }
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = HALO; ctx.lineWidth = lineWidth + 2.4; ctx.stroke();
        ctx.strokeStyle = COLORS[armIndex]; ctx.lineWidth = lineWidth; ctx.stroke();
      };
      trace(data.frames.length - 1, 0.35, 3.0);
      trace(index, 1, 3.4);
      const point = data.frames[index][arm];
      if (!isVisiblePoint(point)) return;
      const [x, y] = pointToPixel(point);
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[armIndex]; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.6; ctx.stroke();
      // Optional projected orientation axes are supplied only with calibrated data.
      const axes = data.frames[index][`${arm}Axes`];
      if (Array.isArray(axes) && axes.length === 3) {
        axes.forEach((end, axis) => {
          if (!isVisiblePoint(end)) return;
          const [ex, ey] = pointToPixel(end);
          drawArrow(ctx, x, y, x + (ex - x) * AXIS_SCALE, y + (ey - y) * AXIS_SCALE, AXIS_COLORS[axis]);
        });
      }
    });
    ctx.restore();
    canvas.dataset.frame = String(index);
  }

  function tick() {
    requested = 0;
    draw();
    if (!disposed && data && !video.paused && !video.ended) requested = requestAnimationFrame(tick);
  }
  function repaint() {
    if (requested) cancelAnimationFrame(requested);
    requested = 0; tick();
  }
  const events = ["loadeddata", "loadedmetadata", "play", "pause", "seeked", "timeupdate", "emptied", "error"];
  for (const event of events) video.addEventListener(event, repaint);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(repaint) : null;
  observer?.observe(canvas);
  return {
    update(clip) {
      data = validateTrajectory(clip?.trajectory);
      canvas.hidden = !data;
      canvas.dataset.method = data?.method || "";
      repaint();
    },
    destroy() {
      disposed = true;
      if (requested) cancelAnimationFrame(requested);
      for (const event of events) video.removeEventListener(event, repaint);
      observer?.disconnect();
    },
  };
}

export function setupRolloutTrajectories(root) {
  const slots = new Map(Array.from(root.querySelectorAll("[data-rollout-slot]")).map((slot) => [slot.dataset.rolloutSlot, setupSlot(slot)]));
  const toggle = root.querySelector("[data-rollout-trajectory-toggle]");
  const setVisible = () => { root.dataset.trajectoryVisible = String(toggle?.checked !== false); };
  toggle?.addEventListener("change", setVisible);
  setVisible();
  return {
    update(clips) { for (const [key, renderer] of slots) renderer.update(clips?.[key]); },
    destroy() { toggle?.removeEventListener("change", setVisible); for (const renderer of slots.values()) renderer.destroy(); },
  };
}
