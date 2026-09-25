/* Load as a classic head script before stylesheets to restore the saved theme
 * before the page paints. First visits always use light, independent of OS. */
(() => {
  const storageKey = "worldecho-theme";
  let theme = "light";
  try {
    if (window.localStorage.getItem(storageKey) === "dark") theme = "dark";
  } catch { /* Private browsing or storage policy: retain the light default. */ }

  const apply = () => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  apply();

  function bindToggle() {
    const buttons = Array.from(document.querySelectorAll("[data-theme-toggle]"));
    const syncButtons = () => buttons.forEach((button) => {
      const dark = theme === "dark";
      const action = `Switch to ${dark ? "light" : "dark"} theme`;
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", action);
      button.setAttribute("title", action);
      const label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "Dark" : "Light";
      button.hidden = false;
    });
    buttons.forEach((button) => button.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      apply();
      syncButtons();
      try { window.localStorage.setItem(storageKey, theme); }
      catch { /* The control remains usable when persistence is unavailable. */ }
    }));
    syncButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindToggle, { once: true });
  } else bindToggle();
})();
