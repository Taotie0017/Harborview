function showError(input, message) {
  let note = input.parentElement.querySelector(".field-error");
  if (!input.parentElement.classList.contains("password-field")) {
    note = input.parentElement.querySelector(`[data-for="${input.id}"]`);
  }
  const slot = document.querySelector(`[data-for="${input.id}"]`);
  if (!slot) {
    return;
  }
  slot.textContent = message || "";
}

function passwordProblem(value) {
  if (value.length < 8) {
    return "Use at least 8 characters.";
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return "Include at least one letter and one number.";
  }
  return "";
}

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.getAttribute("data-toggle-password"));
    if (!input) {
      return;
    }
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    button.setAttribute("aria-pressed", String(!showing));
    if (!button.querySelector("svg")) {
      button.textContent = showing ? "Show" : "Hide";
    }
  });
});

document.querySelectorAll("form[data-validate]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    let blocked = false;
    const password = form.querySelector("input[name='password']");
    const confirm = form.querySelector("input[name='confirm_password']");

    if (form.dataset.validate === "signup" && password) {
      const problem = passwordProblem(password.value);
      showError(password, problem);
      if (problem) {
        blocked = true;
      }
    }

    if (confirm && password && confirm.value !== password.value) {
      showError(confirm, "Those passwords do not match.");
      blocked = true;
    } else if (confirm) {
      showError(confirm, "");
    }

    if (blocked) {
      event.preventDefault();
    }
  });
});
