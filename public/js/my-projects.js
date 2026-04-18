import { api } from './api.js';
import { initNav } from './nav.js';

function show(msg, k = 'error') {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.hidden = false;
  el.className = `alert ${k}`;
}

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
  try {
    const { projects } = await api('/api/projects/mine');
    const list = document.getElementById('list');
    list.innerHTML = '';
    if (projects.length === 0) {
      list.innerHTML = '<p class="section-hint">No projects yet.</p>';
      return;
    }
    for (const p of projects) {
      const sec = document.createElement('section');
      sec.className = 'card profile-section';
      sec.innerHTML = `
        <h2>${esc(p.title)}</h2>
        <p class="section-hint">${esc(p.project_type)} · ${esc(p.recruitment_status)} · workflow ${esc(
        p.workflow_status
      )}</p>
        <p><a class="btn secondary" href="/project.html?id=${p.id}">View</a>
           <a class="btn" href="/project-manage.html?id=${p.id}">Manage</a></p>`;
      list.appendChild(sec);
    }
  } catch (e) {
    show(e.body?.message || e.message);
  }
}

main();
