const METRICS = { gated: "gated error", raw: "raw NDTW", visual: "visual pass" };

// Competition ranks preserve ties (1, 2, 2, 4), regardless of sort direction.
export function rankModels(models, metric) {
  const direction = metric === "visual" ? -1 : 1;
  let previous;
  let rank = 0;
  return [...models]
    .sort((a, b) => direction * (a[metric] - b[metric]))
    .map((model, index) => {
      if (model[metric] !== previous) rank = index + 1;
      previous = model[metric];
      return { model, rank };
    });
}

export function setupLeaderboard(root) {
  if (!root) return [];
  const body = root.querySelector("[data-lb-rows]");
  const rows = Array.from(body.rows);
  const models = rows.map((row) => {
    const name = row.querySelector("[data-lb-name]").textContent.trim();
    return {
      id: name,
      name,
      gated: Number(row.dataset.gated),
      raw: Number(row.dataset.raw),
      visual: Number(row.dataset.visual),
      ours: row.classList.contains("ours"),
      logo: row.querySelector(".lb-model-credit img, .lb-model-credit svg"),
    };
  });
  const rowById = new Map(models.map((model, index) => [model.id, rows[index]]));
  const sort = root.querySelector("[data-lb-sort]");
  const medals = ["🥇", "🥈", "🥉"];

  function update() {
    const metric = sort.value;
    for (const { model, rank } of rankModels(models, metric)) {
      const row = rowById.get(model.id);
      const cell = row.querySelector("[data-lb-rank]");
      cell.querySelector(".sr-only").textContent = `Rank ${rank}`;
      cell.querySelector(".lb-rank-mark").textContent = medals[rank - 1] || String(rank).padStart(2, "0");
      row.querySelectorAll("td").forEach((td) => td.classList.remove("lb-primary"));
      row.cells[{ gated: 2, raw: 3, visual: 4 }[metric]].classList.add("lb-primary");
      body.append(row);
    }
    root.querySelectorAll("[data-lb-column]").forEach((header) => {
      if (header.dataset.lbColumn === metric) header.setAttribute("aria-sort", metric === "visual" ? "descending" : "ascending");
      else header.removeAttribute("aria-sort");
    });
    root.querySelector("caption").textContent = `WorldEcho main comparison: ${models.length} configurations across 50 RoboTwin tasks, ranked by ${METRICS[metric]}.`;
  }
  sort.addEventListener("change", update);
  const vmToggle = root.querySelector("[data-lb-vm-toggle]");
  vmToggle?.addEventListener("change", () => root.classList.toggle("lb-show-vm", vmToggle.checked));
  update();
  root.querySelector("[data-lb-controls]").hidden = false;
  return models;
}
