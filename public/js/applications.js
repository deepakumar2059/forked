import { api } from './api.js';
import { initNav } from './nav.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function main() {
  const user = await initNav();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  const { applications } = await api('/api/my/applications');
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (applications.length === 0) {
    list.innerHTML = '<p class="section-hint">No applications yet.</p>';
    return;
  }
  for (const a of applications) {
    const sec = document.createElement('section');
    sec.className = 'card profile-section';
    const st = a.withdrawn ? 'withdrawn' : a.status;
    sec.innerHTML = `
      <h2><a href="/project.html?id=${a.project.id}">${esc(a.project.title)}</a></h2>
      <p class="section-hint">Status: <strong>${esc(st)}</strong> · ${esc(a.project.project_type)} · recruitment ${esc(
      a.project.recruitment_status
    )}</p>`;
    list.appendChild(sec);
  }
}

main().catch((e) => {
  const el = document.getElementById('alert');
  el.textContent = e.body?.message || e.message;
  el.hidden = false;
});
