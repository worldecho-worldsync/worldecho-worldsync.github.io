/* Policy improvement charts, rendered from the paper's reported success rates.
 * Source of record: figures/figure6_selfevo/figure6_policy_improvement_data.csv
 * (external data directory). The historical Expanded-coverage condition is
 * retained in that CSV but intentionally not shown here. */
const TASKS = [
  { task: "Bin Dumping", platform: "RoboTwin simulation", rounds: ["Init.", "R1", "R2"], worldsync: [52, 57, 65], ctrlworld: [52, 54, 57] },
  { task: "Cup Stacking", platform: "Dual TianJi-Sharpa", rounds: ["Init.", "R1", "R2"], worldsync: [48, 60, 68], ctrlworld: [48, 52, 56] },
  { task: "Box Packing", platform: "Simplexity i7 Pro", rounds: ["Init.", "R1"], worldsync: [40, 60], ctrlworld: [40, 40] },
  { task: "Bread Placement", platform: "Franka FR3", rounds: ["Init.", "R1"], worldsync: [76, 96], ctrlworld: [76, 84] },
  { task: "Pen Collection", platform: "Franka FR3", rounds: ["Init.", "R1"], worldsync: [72, 88], ctrlworld: [72, 64] },
];

export function setupPolicyImprovement(grid) {
  if (!grid) return;
  grid.replaceChildren(...TASKS.map(renderCard));

  const section = grid.closest("[aria-labelledby='policy-heading']") || grid.parentElement;
  const legend = section?.querySelector("[data-pi-legend]");
  if (legend) {
    const setFocus = (value) => { grid.dataset.focus = value; };
    legend.querySelectorAll("[data-pi-focus]").forEach((button) => {
      const value = button.dataset.piFocus;
      button.addEventListener("pointerenter", () => setFocus(value));
      button.addEventListener("focus", () => setFocus(value));
      button.addEventListener("pointerleave", () => setFocus(""));
      button.addEventListener("blur", () => setFocus(""));
    });
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    grid.classList.add("pi-in");
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      grid.classList.add("pi-in");
      observer.disconnect();
    }
  }, { threshold: 0.2 });
  observer.observe(grid);
}

function renderCard(task) {
  const card = document.createElement("article");
  card.className = "pi-card";

  const head = document.createElement("header");
  head.className = "pi-head";
  const title = document.createElement("h3");
  title.textContent = task.task;
  const platform = document.createElement("p");
  platform.textContent = task.platform;
  head.append(title, platform);

  const finalGap = task.worldsync.at(-1) - task.ctrlworld.at(-1);
  const chart = document.createElement("div");
  chart.className = "pi-chart";
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `${task.task} policy success rates. WorldSync: ${task.worldsync.join("%, ")}%. CtrlWorld: ${task.ctrlworld.join("%, ")}%.`);
  task.rounds.forEach((round, index) => {
    const group = document.createElement("div");
    group.className = "pi-round";
    const bars = document.createElement("div");
    bars.className = "pi-bars";
    bars.append(
      makeBar("pi-cw", task.ctrlworld[index]),
      makeBar("pi-ws", task.worldsync[index]),
    );
    const name = document.createElement("span");
    name.className = "pi-round-name";
    name.textContent = round;
    group.append(bars, name);
    chart.append(group);
  });

  const foot = document.createElement("footer");
  foot.className = "pi-foot";
  const gap = document.createElement("strong");
  gap.textContent = `+${finalGap} pts`;
  const detail = document.createElement("span");
  detail.textContent = `final · WorldSync ${task.worldsync.at(-1)}% · CtrlWorld ${task.ctrlworld.at(-1)}%`;
  foot.append(gap, detail);

  card.append(head, chart, foot);
  return card;
}

function makeBar(kind, value) {
  const bar = document.createElement("span");
  bar.className = `pi-bar ${kind}`;
  bar.style.setProperty("--h", `${value}%`);
  const label = document.createElement("i");
  label.textContent = String(value);
  bar.append(label);
  return bar;
}
