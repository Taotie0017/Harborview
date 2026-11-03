const modal = document.createElement("div");
modal.className = "modal";
modal.hidden = true;
modal.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title">Please confirm</h2>
    <p class="confirm-copy"></p>
    <div class="button-row">
      <button class="button button-danger" type="button" data-confirm-yes>Delete</button>
      <button class="button button-ghost" type="button" data-confirm-no>Cancel</button>
    </div>
  </div>
`;
document.body.appendChild(modal);

const copy = modal.querySelector(".confirm-copy");
const yesButton = modal.querySelector("[data-confirm-yes]");
const noButton = modal.querySelector("[data-confirm-no]");
let pending = null;

function closeModal() {
  modal.hidden = true;
  pending = null;
}

noButton.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) {
    closeModal();
  }
});
yesButton.addEventListener("click", () => {
  const form = pending;
  closeModal();
  if (form) {
    form.dataset.confirmed = "yes";
    form.requestSubmit();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  const message = form.getAttribute("data-confirm");
  if (!message || form.dataset.confirmed === "yes") {
    return;
  }
  event.preventDefault();
  copy.textContent = message;
  pending = form;
  modal.hidden = false;
  noButton.focus();
});
