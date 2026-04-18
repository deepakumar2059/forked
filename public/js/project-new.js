import { api } from './api.js';
import { initNav } from './nav.js';

function show(msg, k = 'error') {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.hidden = false;
  el.className = `alert ${k}`;
}

async function main() {
  const user = await initNav();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  const [{ skills }, { categories }] = await Promise.all([api('/api/skills'), api('/api/categories')]);
  const skillBox = document.getElementById('skills');
  for (const s of skills) {
    const label = document.createElement('label');
    label.className = 'skill-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(s.id);
    const span = document.createElement('span');
    span.textContent = s.name;
    label.append(input, span);
    skillBox.appendChild(label);
  }
  const cat = document.getElementById('category_id');
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.name;
    cat.appendChild(opt);
  }

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const skill_ids = Array.from(skillBox.querySelectorAll('input:checked')).map((x) => Number(x.value));
    const catVal = document.getElementById('category_id').value;
    const body = {
      title: document.getElementById('title').value.trim(),
      description: document.getElementById('description').value.trim(),
      team_size: Number(document.getElementById('team_size').value),
      project_type: document.getElementById('project_type').value,
      team_type: document.getElementById('team_type').value.trim() || null,
      deadline: document.getElementById('deadline').value || null,
      category_id: catVal ? Number(catVal) : null,
      skill_ids,
    };
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
      window.location.href = `/project-manage.html?id=${project.id}`;
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
}

main().catch((e) => show(e.message));
