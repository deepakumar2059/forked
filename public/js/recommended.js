import { api } from './api.js';
import { initNav } from './nav.js';

function showError(msg) {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.hidden = false;
  el.className = 'alert error';
}

async function main() {
  const user = await initNav();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  try {
    const { projects } = await api('/api/projects/recommended');
    const list = document.getElementById('list');
    list.innerHTML = '';
    if (projects.length === 0) {
      list.innerHTML =
        '<p class="card section-hint">Add skills on your <a href="/profile.html">profile</a> to get recommendations.</p>';
      return;
    }
    for (const p of projects) {
      const card = document.createElement('section');
      card.className = 'card profile-section';
      const skills = (p.required_skills || []).map((s) => s.name).join(', ');
      card.innerHTML = `
        <h2><a href="/project.html?id=${p.id}">${p.title}</a></h2>
        <p class="section-hint">Match score: ${p.match_score} overlapping required skills</p>
        <p>${p.description.slice(0, 240)}…</p>
        <p class="section-hint">${skills}</p>`;
      list.appendChild(card);
    }
  } catch (e) {
    showError(e.body?.message || e.message);
  }
}

main();
