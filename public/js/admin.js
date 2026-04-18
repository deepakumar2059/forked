import { api } from './api.js';
import { initNav } from './nav.js';

function show(m, k = 'error') {
  const el = document.getElementById('alert');
  el.textContent = m;
  el.hidden = false;
  el.className = `alert ${k}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function renderStats(root) {
  const s = await api('/api/admin/stats');
  root.innerHTML = `<section class="card profile-section"><h2>Activity</h2>
    <ul class="kv-list">
      <li>Total users: <strong>${s.users_total}</strong></li>
      <li>Active (7d): <strong>${s.users_active_7d}</strong></li>
      <li>Total projects: <strong>${s.projects_total}</strong></li>
      <li>Open recruitment: <strong>${s.projects_open_recruitment}</strong></li>
      <li>Open reports: <strong>${s.reports_open}</strong></li>
    </ul></section>`;
}

async function renderUsers(root) {
  const { users, page, total } = await api('/api/admin/users?limit=50');
  const rows = users
    .map(
      (u) => `<tr>
      <td>${u.id}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
      <td>${u.is_blocked ? 'blocked' : 'active'}</td>
      <td>
        <button class="btn secondary small-btn" data-block="${u.id}" data-v="${u.is_blocked ? '0' : '1'}">${
        u.is_blocked ? 'Unblock' : 'Block'
      }</button>
        <button class="btn secondary small-btn" data-del="${u.id}">Delete</button>
      </td></tr>`
    )
    .join('');
  root.innerHTML = `<section class="card profile-section"><h2>Users</h2>
    <p class="section-hint">Page ${page} — ${total} total</p>
    <table class="data-table"><thead><tr><th>ID</th><th>Email</th><th>Role</th><th>State</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
  root.querySelectorAll('[data-block]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-block');
      const isBlocked = btn.getAttribute('data-v') === '1';
      try {
        await api(`/api/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_blocked: isBlocked }),
        });
        show('Updated.', 'success');
        await renderUsers(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-del');
      if (!confirm('Delete user ' + id + '?')) return;
      try {
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        show('Deleted.', 'success');
        await renderUsers(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

async function renderReports(root) {
  const { reports } = await api('/api/admin/reports?status=open');
  const rows = reports
    .map(
      (r) => `<tr>
      <td>${r.id}</td><td>${esc(r.project_title)}</td><td>${esc(r.reason).slice(0, 80)}…</td>
      <td>
        <button class="btn secondary small-btn" data-r="${r.id}" data-s="reviewed">Reviewed</button>
        <button class="btn secondary small-btn" data-r="${r.id}" data-s="dismissed">Dismiss</button>
        <button class="btn small-btn" data-r="${r.id}" data-s="removed">Remove project</button>
      </td></tr>`
    )
    .join('');
  root.innerHTML = `<section class="card profile-section"><h2>Open reports</h2>
    <table class="data-table"><thead><tr><th>ID</th><th>Project</th><th>Reason</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">None</td></tr>'}</tbody></table></section>`;
  root.querySelectorAll('[data-r]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-r');
      const status = btn.getAttribute('data-s');
      if (status === 'removed' && !confirm('Delete reported project?')) return;
      try {
        await api(`/api/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        show('Updated.', 'success');
        await renderReports(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

async function renderSkills(root) {
  const { skills } = await api('/api/skills');
  const rows = skills.map((s) => `<tr><td>${s.id}</td><td>${esc(s.name)}</td>
    <td><button class="btn secondary small-btn" data-rn="${s.id}">Rename</button>
    <button class="btn secondary small-btn" data-ds="${s.id}">Delete</button></td></tr>`).join('');
  root.innerHTML = `<section class="card profile-section"><h2>Skills</h2>
    <form id="add-skill" class="form-stack" style="margin-bottom:1rem">
      <input name="name" placeholder="New skill name" required />
      <button class="btn" type="submit">Add</button>
    </form>
    <table class="data-table"><thead><tr><th>ID</th><th>Name</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>`;
  document.getElementById('add-skill').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    try {
      await api('/api/admin/skills', { method: 'POST', body: JSON.stringify({ name }) });
      show('Added.', 'success');
      await renderSkills(root);
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
  root.querySelectorAll('[data-rn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-rn');
      const name = prompt('New name');
      if (!name) return;
      try {
        await api(`/api/admin/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await renderSkills(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
  root.querySelectorAll('[data-ds]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-ds');
      if (!confirm('Delete skill?')) return;
      try {
        await api(`/api/admin/skills/${id}`, { method: 'DELETE' });
        await renderSkills(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

async function renderCategories(root) {
  const { categories } = await api('/api/categories');
  const rows = categories
    .map(
      (c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td>
    <td><button class="btn secondary small-btn" data-rc="${c.id}">Rename</button>
    <button class="btn secondary small-btn" data-dc="${c.id}">Delete</button></td></tr>`
    )
    .join('');
  root.innerHTML = `<section class="card profile-section"><h2>Categories</h2>
    <form id="add-cat" class="form-stack" style="margin-bottom:1rem">
      <input name="name" placeholder="New category" required />
      <button class="btn" type="submit">Add</button>
    </form>
    <table class="data-table"><thead><tr><th>ID</th><th>Name</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>`;
  document.getElementById('add-cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      show('Added.', 'success');
      await renderCategories(root);
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
  root.querySelectorAll('[data-rc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-rc');
      const name = prompt('New name');
      if (!name) return;
      try {
        await api(`/api/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await renderCategories(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
  root.querySelectorAll('[data-dc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-dc');
      if (!confirm('Delete category?')) return;
      try {
        await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
        await renderCategories(root);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

const tabs = [
  ['stats', 'Stats', renderStats],
  ['users', 'Users', renderUsers],
  ['reports', 'Reports', renderReports],
  ['skills', 'Skills', renderSkills],
  ['categories', 'Categories', renderCategories],
];

async function activate(key) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';
  const entry = tabs.find((t) => t[0] === key);
  if (!entry) return;
  const wrap = document.createElement('div');
  panel.appendChild(wrap);
  await entry[2](wrap);
}

async function main() {
  const user = await initNav();
  if (!user || user.role !== 'admin') {
    show('Admin login required.');
    return;
  }
  document.getElementById('tabs').innerHTML = tabs
    .map(([k, label]) => `<button type="button" class="btn secondary tab-btn" data-t="${k}">${label}</button>`)
    .join('');
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => activate(b.getAttribute('data-t')));
  });
  try {
    await activate('stats');
  } catch (e) {
    show(e.body?.message || e.message);
  }
}

main();
