// Each handler has its own name so a trace's coverage shows which ones ran.
const out = document.getElementById('out');
const press = document.getElementById('press');
press.addEventListener('pointerdown', function probePointerDown() {
  out.dataset.pd = String(Number(out.dataset.pd ?? 0) + 1);
});
press.addEventListener('mousedown', function probeMouseDown() {
  out.dataset.md = String(Number(out.dataset.md ?? 0) + 1);
});
press.addEventListener('click', function probeClick() {
  fetch('/api/products').then(function probeResponse(res) {
    out.textContent = `status ${res.status}`;
  });
});
document.getElementById('local').addEventListener('click', function probeLocal() {
  out.textContent = 'local';
});
document.getElementById('nav').addEventListener('click', function probeLeaving() {
  sessionStorage.setItem('left', '1');
});
document.getElementById('form').addEventListener('submit', function probeSubmit(event) {
  event.preventDefault();
  fetch(`/api/products?q=${encodeURIComponent(document.getElementById('q').value)}`).then(
    function probeSubmitResponse(res) {
      out.textContent = `search ${res.status}`;
    },
  );
});
