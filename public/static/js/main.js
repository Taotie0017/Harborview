const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
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
