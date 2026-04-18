import { api } from './api.js';
import { initNav } from './nav.js';

const alertEl = document.getElementById('alert');

function showAlert(message, kind = 'error') {
  alertEl.textContent = message;
  alertEl.hidden = false;
  alertEl.className = `alert ${kind}`;
}

function hideAlert() {
  alertEl.hidden = true;
}

let profileState = null;
let allSkills = [];

function parseInterestInput(text) {
  return text
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function renderCore() {
  const p = profileState.profile;
  document.getElementById('display_name').value = p?.display_name || '';
  document.getElementById('branch').value = p?.branch || '';
  document.getElementById('year').value = p?.year || '';
  document.getElementById('bio').value = p?.bio || '';
}

function renderSkills() {
  const container = document.getElementById('skill-checkboxes');
  const selected = new Set((profileState.skills || []).map((s) => s.id));
  container.innerHTML = '';
  if (allSkills.length === 0) {
    container.innerHTML =
      '<p class="section-hint">No skills in the database yet. Ask an admin to add tags, or run <code>db/seed_skills.sql</code>.</p>';
    return;
  }
  for (const s of allSkills) {
    const id = `skill-${s.id}`;
    const label = document.createElement('label');
    label.className = 'skill-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.value = String(s.id);
    if (selected.has(s.id)) input.checked = true;
    const span = document.createElement('span');
    span.textContent = s.name;
    label.append(input, span);
    container.appendChild(label);
  }
}

function renderInterests() {
  const tags = profileState.interests || [];
  document.getElementById('interests').value = tags.join(', ');
}

function renderPast() {
  const ul = document.getElementById('past-list');
  ul.innerHTML = '';
  const items = profileState.past_projects || [];
  if (items.length === 0) {
    ul.innerHTML = '<li class="past-empty">No past projects yet.</li>';
    return;
  }
  for (const p of items) {
    const li = document.createElement('li');
    li.className = 'past-item';
    li.innerHTML = `<div class="past-body">
        <strong></strong>
        <p class="past-desc"></p>
      </div>
      <button type="button" class="btn secondary past-del" data-id="${p.id}">Remove</button>`;
    li.querySelector('strong').textContent = p.title;
    const desc = li.querySelector('.past-desc');
    if (p.description) {
      desc.textContent = p.description;
    } else {
      desc.hidden = true;
    }
    ul.appendChild(li);
  }
  ul.querySelectorAll('.past-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      hideAlert();
      try {
        await api(`/api/profile/past-projects/${id}`, { method: 'DELETE' });
        await refreshProfile();
        showAlert('Removed past project.', 'success');
      } catch (e) {
        showAlert(e.body?.message || e.message);
      }
    });
  });
}

async function refreshProfile() {
  const [profileRes, skillsRes] = await Promise.all([
    api('/api/profile'),
    api('/api/skills'),
  ]);
  profileState = profileRes;
  allSkills = skillsRes.skills || [];
  renderCore();
  renderSkills();
  renderInterests();
  renderPast();
}

document.getElementById('form-core').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const fd = new FormData(e.target);
  try {
    profileState = await api('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: fd.get('display_name'),
        branch: fd.get('branch') || null,
        year: fd.get('year') || null,
        bio: fd.get('bio') || null,
      }),
    });
    renderSkills();
    renderInterests();
    renderPast();
    showAlert('Basics saved.', 'success');
  } catch (err) {
    showAlert(err.body?.message || err.message);
  }
});

document.getElementById('form-skills').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const boxes = e.target.querySelectorAll('#skill-checkboxes input[type="checkbox"]:checked');
  const skill_ids = Array.from(boxes).map((el) => Number(el.value));
  try {
    profileState = await api('/api/profile/skills', {
      method: 'PUT',
      body: JSON.stringify({ skill_ids }),
    });
    renderCore();
    renderInterests();
    renderPast();
    showAlert('Skills saved.', 'success');
  } catch (err) {
    showAlert(err.body?.message || err.message);
  }
});

document.getElementById('form-interests').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const text = document.getElementById('interests').value;
  const tags = parseInterestInput(text);
  try {
    profileState = await api('/api/profile/interests', {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    });
    renderCore();
    renderSkills();
    renderPast();
    showAlert('Interests saved.', 'success');
  } catch (err) {
    showAlert(err.body?.message || err.message);
  }
});

document.getElementById('form-past').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const title = document.getElementById('past_title').value.trim();
  const description = document.getElementById('past_desc').value;
  try {
    await api('/api/profile/past-projects', {
      method: 'POST',
      body: JSON.stringify({ title, description: description || null }),
    });
    e.target.reset();
    await refreshProfile();
    showAlert('Past project added.', 'success');
  } catch (err) {
    showAlert(err.body?.message || err.message);
  }
});

async function main() {
  const user = await initNav();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  try {
    await refreshProfile();
  } catch (err) {
    if (err.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    showAlert(err.body?.message || err.message);
  }
}

main();
