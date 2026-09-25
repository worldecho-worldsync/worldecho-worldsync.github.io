

import { setupVideoGroups } from "./video-playback.js";
import { setupRolloutDemo } from "./rollout-demo.js";
import { setupRealWorldDemos } from "./real-world-demo.js";
import { setupIdentity } from "./identity.js";


import { setupLeaderboard } from "./leaderboard.js";
import { setupActionCoverage } from "./action-coverage.js";
import { setupPolicyImprovement } from "./policy-improvement.js";


setupIdentity();
setupRealWorldDemos();


setupLeaderboard(document.querySelector("[data-leaderboard]"));
setupPolicyImprovement(document.querySelector("[data-policy-grid]"));

// Enable only when a verified Figure 5 point export is attached to the section.
async function loadActionCoverage() {
  const section = document.querySelector("[data-action-coverage]");
  const source = section?.dataset.acSource;
  if (!source) return;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Action coverage returned ${response.status}`);
  setupActionCoverage(section.querySelector("[data-ac-interactive]"), await response.json());
  section.querySelector("[data-ac-fallback]").hidden = true;
}

loadActionCoverage().catch((error) => {
  console.warn("Action coverage is showing the original paper figure.", error);
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Scroll progress and section-aware navigation */
const progressBar = document.getElementById("progress-bar");
const navLinks = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));

/* Assigned by the reveal block below; a no-op until then. */
let revealPending = () => {};

function updateScrollState() {
  const trackedSections = navLinks
    .filter((link) => !link.hidden)
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter((section) => section && !section.hidden);
  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  const scrollable = documentHeight - viewportHeight;

  revealPending();

  if (progressBar) {
    const progress = scrollable > 0 ? scrollY / scrollable : 0;
    progressBar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
  }

  if (!trackedSections.length) return;
  const activationLine = viewportHeight * 0.34;
  let activeSection = null;
  trackedSections.forEach((section) => {
    if (section.getBoundingClientRect().top <= activationLine) activeSection = section;
  });
  if (scrollY + viewportHeight >= documentHeight - 2) {
    activeSection = trackedSections[trackedSections.length - 1];
  }
  const activeId = activeSection ? activeSection.id : "";
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${activeId}`);
  });
}

let scrollFramePending = false;
function requestScrollUpdate() {
  if (scrollFramePending) return;
  scrollFramePending = true;
  window.requestAnimationFrame(() => {
    updateScrollState();
    scrollFramePending = false;
  });
}

window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", requestScrollUpdate);
updateScrollState();

/* Compact navigation */
const menuToggle = document.querySelector(".menu-toggle");
const navPanel = document.getElementById("nav-links");

if (menuToggle && navPanel) {
  const setMenuOpen = (open) => {
    navPanel.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
  };

  menuToggle.addEventListener("click", () => {
    setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  navPanel.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });
}

/* Reveal content once, while respecting reduced motion */
const revealSelectors = [
  ".section-heading",
  ".metric-card",
  ".case-tabs",
  ".sync-step",
  ".abstract-copy",
];

if (!prefersReducedMotion) {
  const groupCounts = new Map();
  let waiting = Array.from(document.querySelectorAll(revealSelectors.join(",")));

  waiting.forEach((element) => {
    element.classList.add("reveal");
    const parent = element.parentElement;
    const index = groupCounts.get(parent) || 0;
    if (index > 0 && index < 4) element.classList.add(`delay-${index}`);
    groupCounts.set(parent, index + 1);
  });

  /* Anything already at or above the fold reveals, so jumping straight to a
     deep anchor never strands content at opacity zero. */
  revealPending = () => {
    if (!waiting.length) return;
    const line = window.innerHeight * 0.93;
    waiting = waiting.filter((element) => {
      if (element.getBoundingClientRect().top > line) return true;
      element.classList.add("in");
      return false;
    });
  };

  requestAnimationFrame(revealPending);
}


/* Shared timeline for the three recorded failure-comparison outputs. */
const videoGroups = setupVideoGroups();
setupRolloutDemo(document.querySelector("[data-rollout-demo]"));

/* Failure-case switcher */
const caseData = {
  grab: {
    label: "Grab roller",
    input: "assets/inputs/grab-start.png",
    gt: ["assets/videos/grab-gt.mp4", "assets/posters/grab-gt.png"],
    collapse: ["assets/videos/grab-collapse.mp4", "assets/posters/grab-collapse.png"],
    mismatch: ["assets/videos/grab-mismatch.mp4", "assets/posters/grab-mismatch.png"],
  },
  handover: {
    label: "Handover block",
    input: "assets/inputs/handover-start.png",
    gt: ["assets/videos/handover-gt.mp4", "assets/posters/handover-gt.png"],
    collapse: ["assets/videos/handover-collapse.mp4", "assets/posters/handover-collapse.png"],
    mismatch: ["assets/videos/handover-mismatch.mp4", "assets/posters/handover-mismatch.png"],
  },
  bread: {
    label: "Place bread in basket",
    input: "assets/inputs/bread-start.png",
    gt: ["assets/videos/bread-gt.mp4", "assets/posters/bread-gt.png"],
    collapse: ["assets/videos/bread-collapse.mp4", "assets/posters/bread-collapse.png"],
    mismatch: ["assets/videos/bread-mismatch.mp4", "assets/posters/bread-mismatch.png"],
  },
};

const caseTabs = Array.from(document.querySelectorAll(".case-tab"));
const failurePanel = document.querySelector(".failure-console");
const failurePlayback = videoGroups.get(failurePanel?.closest("[data-video-group]"));

function replaceVideo(videoId, sourceData, description) {
  const video = document.getElementById(videoId);
  if (!video) return;
  const source = video.querySelector("source");
  if (!source) return;
  source.src = sourceData[0];
  video.poster = sourceData[1];
  video.setAttribute("aria-label", description);
}

function selectCase(tab) {
  const key = tab.dataset.case;
  const data = caseData[key];
  if (!data) return;

  caseTabs.forEach((candidate) => {
    const selected = candidate === tab;
    candidate.classList.toggle("active", selected);
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
  });

  if (failurePanel) failurePanel.setAttribute("aria-labelledby", tab.id);
  const inputFrame = document.getElementById("failure-input");
  if (inputFrame) {
    inputFrame.src = data.input;
    inputFrame.alt = `First recorded simulator frame for ${data.label}`;
  }
  const inputTask = document.getElementById("input-task");
  if (inputTask) inputTask.textContent = data.label;
  const updateSources = () => {
    replaceVideo("video-gt", data.gt, `${data.label} simulator ground-truth rollout`);
    replaceVideo("video-collapse", data.collapse, `${data.label} world-model rollout with visual collapse`);
    replaceVideo("video-mismatch", data.mismatch, `${data.label} plausible world-model rollout with action mismatch`);
  };
  if (failurePlayback) failurePlayback.replaceSources(updateSources);
  else updateSources();
}

caseTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectCase(tab));
  tab.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % caseTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + caseTabs.length) % caseTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = caseTabs.length - 1;
    caseTabs[nextIndex].focus();
    selectCase(caseTabs[nextIndex]);
  });
});

const initialCaseTab = caseTabs.find((tab) => tab.classList.contains("active"));
if (initialCaseTab) selectCase(initialCaseTab);


/* Accessible figure enlargement */
const figureDialog = document.getElementById("figure-dialog");
if (figureDialog) {
  const dialogImage = figureDialog.querySelector("img");
  const dialogCaption = figureDialog.querySelector("p");
  const dialogClose = figureDialog.querySelector(".dialog-close");
  const dialogFullsize = figureDialog.querySelector(".dialog-fullsize");
  const dialogSource = figureDialog.querySelector(".dialog-source");
  let lastFigureTrigger = null;

  document.querySelectorAll("[data-zoom] .figure-button").forEach((button) => {
    button.addEventListener("click", () => {
      const figure = button.closest("figure");
      const image = button.querySelector("img");
      const caption = figure ? figure.querySelector("figcaption") : null;
      if (!image || !dialogImage) return;
      dialogImage.src = image.currentSrc || image.src;
      dialogImage.alt = image.alt;
      if (dialogFullsize) dialogFullsize.href = dialogImage.src;
      const sourceLink = caption?.querySelector('a[href$=".pdf"]');
      if (dialogSource) {
        dialogSource.hidden = !sourceLink;
        if (sourceLink) dialogSource.href = sourceLink.href;
      }
      if (dialogCaption) {
        dialogCaption.textContent = caption
          ? Array.from(caption.childNodes).filter((node) => node.nodeName !== "A").map((node) => node.textContent).join("").trim()
          : "";
      }
      lastFigureTrigger = button;
      figureDialog.showModal();
    });
  });

  const closeDialog = () => {
    figureDialog.close();
    if (lastFigureTrigger) lastFigureTrigger.focus();
  };

  if (dialogClose) dialogClose.addEventListener("click", closeDialog);
  figureDialog.addEventListener("click", (event) => {
    if (event.target === figureDialog) closeDialog();
  });
}

