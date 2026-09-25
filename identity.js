import { ANONYMOUS, IDENTITY } from "./site.config.js";

/* Renders the hero identity block from site.config.js. See that file for the
 * anonymous/public switch. In public mode, author affiliation markers are
 * 1-based indices into IDENTITY.affiliations. */
export function setupIdentity() {
  const anonymousSlot = document.querySelector("[data-anonymous-authors]");
  const teamSlot = document.querySelector("[data-hero-team]");
  const actionsSlot = document.querySelector("[data-hero-actions]");
  const institutionsSlot = document.querySelector("[data-institutions]");

  if (anonymousSlot) anonymousSlot.hidden = !ANONYMOUS;
  if (teamSlot) {
    teamSlot.hidden = ANONYMOUS;
    if (!ANONYMOUS) renderTeam(teamSlot);
  }
  if (actionsSlot) renderLinks(actionsSlot);
  if (institutionsSlot) renderInstitutions(institutionsSlot);
}

function renderTeam(teamSlot) {
  const authorList = teamSlot.querySelector("[data-author-list]");
  const notes = teamSlot.querySelector("[data-author-notes]");
  const affiliationList = teamSlot.querySelector("[data-affiliation-list]");

  if (authorList) {
    authorList.replaceChildren(...IDENTITY.authors.map((author) => {
      const item = document.createElement("li");
      item.append(author.name);
      const marks = [
        ...author.affiliations.map(String),
        ...(author.core ? ["*"] : []),
        ...(author.corresponding ? ["†"] : []),
      ];
      if (marks.length) {
        const sup = document.createElement("sup");
        sup.textContent = marks.join(",");
        item.append(sup);
      }
      return item;
    }));
  }
  if (notes) {
    notes.replaceChildren(...IDENTITY.notes.map((note) => {
      const span = document.createElement("span");
      span.textContent = note;
      return span;
    }));
    notes.hidden = IDENTITY.notes.length === 0;
  }
  if (affiliationList) {
    affiliationList.replaceChildren(...IDENTITY.affiliations.map((affiliation, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.className = "affiliation-number";
      number.textContent = String(index + 1);
      item.append(number, affiliation.name);
      return item;
    }));
    affiliationList.hidden = IDENTITY.affiliations.length === 0;
  }
}

function renderInstitutions(section) {
  section.hidden = ANONYMOUS || IDENTITY.affiliations.length === 0;
  if (section.hidden) return;
  const list = section.querySelector(".affiliation-list");
  if (!list) return;
  list.replaceChildren(...IDENTITY.affiliations.map((affiliation, index) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "affiliation-link";
    if (affiliation.url) { link.href = affiliation.url; link.target = "_blank"; link.rel = "noopener"; }
    const logoBox = document.createElement("span");
    logoBox.className = "affiliation-logo";
    if (affiliation.logoWidth) logoBox.style.setProperty("--logo-width", `${affiliation.logoWidth}px`);
    if (affiliation.logo) {
      const img = document.createElement("img");
      img.src = affiliation.logo;
      img.alt = "";
      img.loading = "lazy";
      logoBox.append(img);
    }
    const caption = document.createElement("span");
    caption.className = "affiliation-caption";
    const number = document.createElement("span");
    number.className = "affiliation-number";
    number.textContent = String(index + 1);
    const name = document.createElement("span");
    name.textContent = affiliation.name;
    caption.append(number, name);
    link.append(logoBox, caption);
    item.append(link);
    return item;
  }));
}

function renderLinks(actionsSlot) {
  const links = IDENTITY.links.filter((link) => link.label && link.href);
  actionsSlot.hidden = links.length === 0;
  actionsSlot.replaceChildren(...links.map((link, index) => {
    const anchor = document.createElement("a");
    anchor.className = "button " + (index === 0 ? "button-primary" : "button-secondary");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = link.label;
    return anchor;
  }));
}
