// renderer.js
// Updates the clock inside the island (HH:MM:SS)

(function () {
  const el = document.getElementById("clock");
  function update() {
    if (!el) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    el.textContent = `${hh}:${mm}:${ss}`;
  }
  update();
  setInterval(update, 1000);
})();
