const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const isDark = theme === "dark";
    button.textContent = isDark ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
    button.setAttribute("aria-pressed", isDark ? "true" : "false");
  });
}

setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(theme);
    try {
      localStorage.setItem("harborview-theme", theme);
    } catch {
      // The selected theme remains active until this page is reloaded.
    }
  });
});

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  siteNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      siteNav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".flash-close");
  if (!button) {
    return;
  }
  const flash = button.closest(".flash");
  if (flash) {
    flash.remove();
  }
});
