import { api } from './api.js';
import { initNav } from './nav.js';

function showError(msg) {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.hidden = false;
  el.className = 'alert error';
}

async function loadSkillsFilter() {
  const { skills } = await api('/api/skills');
  const box = document.getElementById('skill-filters');
  box.innerHTML = '';
  for (const s of skills) {
    const id = `sf-${s.id}`;
    const label = document.createElement('label');
    label.className = 'skill-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'skill_id';
    input.value = String(s.id);
    input.id = id;
    const span = document.createElement('span');
    span.textContent = s.name;
    label.append(input, span);
    box.appendChild(label);
  }
}

function selectedSkillIds() {
  return Array.from(document.querySelectorAll('#skill-filters input:checked')).map((el) => el.value);
}

async function loadList() {
  const params = new URLSearchParams();
  const pt = document.getElementById('project_type').value;
  const tt = document.getElementById('team_type').value.trim();
  if (pt) params.set('project_type', pt);
  if (tt) params.set('team_type', tt);
  for (const sid of selectedSkillIds()) {
    params.append('skill_id', sid);
  }
  const { projects } = await api(`/api/projects?${params.toString()}`);
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (projects.length === 0) {
    list.innerHTML = '<p class="section-hint">No projects match these filters.</p>';
    return;
  }
  for (const p of projects) {
    const card = document.createElement('section');
    card.className = 'card profile-section';
    const skills = (p.required_skills || []).map((s) => s.name).join(', ') || '—';
    card.innerHTML = `
      <h2><a href="/project.html?id=${p.id}">${p.title}</a></h2>
      <p class="section-hint">${p.project_type} · team up to ${p.team_size} · ${p.team_type || 'team type not set'}</p>
      <p>${p.description.slice(0, 280)}${p.description.length > 280 ? '…' : ''}</p>
      <p class="section-hint"><strong>Skills:</strong> ${skills}</p>`;
    list.appendChild(card);
  }
}

document.getElementById('filters').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('alert').hidden = true;
  try {
    await loadList();
  } catch (err) {
    showError(err.body?.message || err.message);
  }
});

async function main() {
  await initNav();
  try {
    await loadSkillsFilter();
    await loadList();
  } catch (err) {
    showError(err.body?.message || err.message);
  }
}

main();
