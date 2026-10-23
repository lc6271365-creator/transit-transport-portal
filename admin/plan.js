"use strict";

const busCount = document.querySelector("[data-bus-count]");
const estimate = document.querySelector("[data-estimate]");

busCount?.addEventListener("input", () => {
  const count = Number.parseInt(busCount.value, 10);
  if (!Number.isInteger(count) || count < 0 || count > 500) {
    estimate.textContent = "Enter 0–500 buses";
    return;
  }
  estimate.textContent = `₹${(count * 100).toLocaleString("en-IN")}`;
});
