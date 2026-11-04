// Small, progressive behaviour: the page reads fine without it.
// No network requests, no analytics. The effects choice is stored in localStorage on this device only.
(() => {
  const root = document.documentElement;

  // Print effects switch.
  const toggle = document.querySelector('.fx-toggle');
  if (toggle) {
    const sync = () => {
      const on = root.classList.contains('fx');
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', `Print effects: ${on ? 'on' : 'off'}`);
    };
    sync();
    toggle.addEventListener('click', () => {
      root.classList.toggle('fx');
      try {
        localStorage.setItem('lp-fx', root.classList.contains('fx') ? 'on' : 'off');
      } catch {
        // Storage can be blocked; the switch still works for this visit.
      }
      sync();
    });
  }

  // Quick start tabs (WAI-ARIA tabs pattern, automatic activation).
  for (const tabs of document.querySelectorAll('[data-tabs]')) {
    const list = [...tabs.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      for (const t of list) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) tab.focus();
    };
    for (const tab of list) {
      tab.addEventListener('click', () => select(tab, false));
      tab.addEventListener('keydown', (e) => {
        const i = list.indexOf(tab);
        const to = {
          ArrowRight: list[(i + 1) % list.length],
          ArrowLeft: list[(i - 1 + list.length) % list.length],
          Home: list[0],
          End: list[list.length - 1],
        }[e.key];
        if (to) {
          e.preventDefault();
          select(to, true);
        }
      });
    }
  }

  // Copy buttons.
  for (const btn of document.querySelectorAll('.copy')) {
    const label = btn.firstChild;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Select and copy';
      }
      setTimeout(() => {
        label.textContent = 'Copy';
      }, 2000);
    });
  }

  // Trace lines: one tab stop; arrow keys step through the function lines and show "ran N times".
  for (const list of document.querySelectorAll('.trace-lines')) {
    const rows = [...list.querySelectorAll('.t-fn')];
    let at = -1;
    const show = (i) => {
      rows[at]?.classList.remove('is-active');
      at = Math.min(Math.max(i, 0), rows.length - 1);
      rows[at].classList.add('is-active');
      rows[at].scrollIntoView({ block: 'nearest' });
    };
    list.addEventListener('keydown', (e) => {
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      show(to);
    });
    list.addEventListener('focus', () => show(at < 0 ? 0 : at));
    list.addEventListener('blur', () => rows[at]?.classList.remove('is-active'));
  }
})();
