import { api } from './api.js';
import { initNav } from './nav.js';

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

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

let projectId = null;
let proj = null;

async function refreshProject() {
  const { project } = await api(`/api/projects/${projectId}`);
  proj = project;
}

function tab(name, label) {
  return `<button type="button" class="btn secondary tab-btn" data-tab="${name}">${label}</button>`;
}

async function renderOverview(container) {
  const p = proj;
  const open = p.recruitment_status === 'open';
  const [{ skills }, { categories }] = await Promise.all([api('/api/skills'), api('/api/categories')]);
  const skillChecks = skills
    .map((s) => {
      const on = (p.required_skills || []).some((x) => x.id === s.id);
      return `<label class="skill-item"><input type="checkbox" value="${s.id}" ${on ? 'checked' : ''}/><span>${esc(
        s.name
      )}</span></label>`;
    })
    .join('');
  const catOpts = categories
    .map((c) => {
      const sel = p.category_id === c.id ? 'selected' : '';
      return `<option value="${c.id}" ${sel}>${esc(c.name)}</option>`;
    })
    .join('');

  container.innerHTML = `
    <section class="card profile-section">
      <h2>Details</h2>
      <form id="edit-form" class="form-stack">
        <div class="field"><label>Title</label><input name="title" ${open ? '' : 'disabled'} /></div>
        <div class="field"><label>Description</label><textarea name="description" rows="4" ${
          open ? '' : 'disabled'
        }></textarea></div>
        <div class="field"><label>Team size</label><input name="team_size" type="number" value="${p.team_size}" ${
    open ? '' : 'disabled'
  } /></div>
        <div class="field"><label>Project type</label>
          <select name="project_type" ${open ? '' : 'disabled'}>
            <option value="hobby" ${p.project_type === 'hobby' ? 'selected' : ''}>Hobby</option>
            <option value="startup" ${p.project_type === 'startup' ? 'selected' : ''}>Startup</option>
            <option value="academic" ${p.project_type === 'academic' ? 'selected' : ''}>Academic</option>
          </select>
        </div>
        <div class="field"><label>Team type</label><input name="team_type" value="${esc(
          p.team_type || ''
        )}" ${open ? '' : 'disabled'} /></div>
        <div class="field"><label>Deadline</label><input name="deadline" type="date" value="${
          p.deadline || ''
        }" ${open ? '' : 'disabled'} /></div>
        <div class="field"><label>Category</label>
          <select name="category_id" ${open ? '' : 'disabled'}>
            <option value="">—</option>${catOpts}
          </select>
        </div>
        <div class="field full-width"><label>Required skills</label><div class="skill-grid" id="ov-skills">${skillChecks}</div></div>
        ${open ? '<button class="btn" type="submit">Save changes</button>' : ''}
      </form>
      ${
        open
          ? `<p style="margin-top:1rem"><button type="button" class="btn secondary" id="del-proj">Delete project</button></p>`
          : ''
      }
    </section>
    <section class="card profile-section">
      <h2>Workflow status</h2>
      <form id="wf-form" class="form-stack">
        <select name="workflow_status" id="wf-sel">
          <option value="open" ${p.workflow_status === 'open' ? 'selected' : ''}>Open</option>
          <option value="in_progress" ${p.workflow_status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="completed" ${p.workflow_status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
        <button class="btn" type="submit">Update status</button>
      </form>
    </section>
    <section class="card profile-section">
      <h2>Recruitment</h2>
      <p class="section-hint">Status: <strong>${esc(p.recruitment_status)}</strong></p>
      ${
        open
          ? '<button type="button" class="btn" id="finalize-btn">Finalize team & close recruitment</button>'
          : '<p class="section-hint">Recruitment closed. Pending applications were rejected.</p>'
      }
    </section>`;

  const ef = container.querySelector('#edit-form');
  if (ef) {
    ef.title.value = p.title;
    ef.description.value = p.description;
  }

  container.querySelector('#edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const skill_ids = Array.from(document.querySelectorAll('#ov-skills input:checked')).map((x) => Number(x.value));
    const body = {
      title: fd.get('title'),
      description: fd.get('description'),
      team_size: Number(fd.get('team_size')),
      project_type: fd.get('project_type'),
      team_type: fd.get('team_type') || null,
      deadline: fd.get('deadline') || null,
      category_id: fd.get('category_id') ? Number(fd.get('category_id')) : null,
      skill_ids,
    };
    try {
      await api(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) });
      show('Saved.', 'success');
      await refreshProject();
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });

  container.querySelector('#wf-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ws = document.getElementById('wf-sel').value;
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: 'PATCH',
        body: JSON.stringify({ workflow_status: ws }),
      });
      show('Workflow updated.', 'success');
      await refreshProject();
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });

  container.querySelector('#finalize-btn')?.addEventListener('click', async () => {
    if (!confirm('Finalize team? Pending applications will be rejected.')) return;
    try {
      await api(`/api/projects/${projectId}/finalize`, { method: 'POST', body: '{}' });
      show('Recruitment closed.', 'success');
      await refreshProject();
      activate('overview');
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });

  container.querySelector('#del-proj')?.addEventListener('click', async () => {
    if (!confirm('Delete this project permanently?')) return;
    try {
      await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      window.location.href = '/my-projects.html';
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
}

async function renderApplications(container) {
  const { applications } = await api(`/api/projects/${projectId}/applications`);
  const rows = applications
    .filter((a) => !a.withdrawn)
    .map(
      (a) => `<tr>
      <td>${esc(a.display_name || a.email)}</td>
      <td>${esc(a.branch || '—')}</td>
      <td>${esc(a.year || '—')}</td>
      <td>${esc((a.skills || []).map((s) => s.name).join(', '))}</td>
      <td><strong>${esc(a.status)}</strong></td>
      <td>
        ${
          proj.recruitment_status === 'open' && a.status !== 'accepted'
            ? `<button class="btn small-btn" data-aid="${a.id}" data-st="accepted">Accept</button>
               <button class="btn secondary small-btn" data-aid="${a.id}" data-st="waitlisted">Waitlist</button>
               <button class="btn secondary small-btn" data-aid="${a.id}" data-st="rejected">Reject</button>`
            : ''
        }
      </td>
    </tr>`
    )
    .join('');
  container.innerHTML = `<section class="card profile-section"><h2>Applications</h2>
    <table class="data-table"><thead><tr><th>Name</th><th>Branch</th><th>Year</th><th>Skills</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">No active applications.</td></tr>'}</tbody></table></section>`;
  container.querySelectorAll('button[data-aid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-aid');
      const st = btn.getAttribute('data-st');
      try {
        await api(`/api/projects/${projectId}/applications/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: st }),
        });
        show('Updated.', 'success');
        await refreshProject();
        await renderApplications(container);
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

async function renderSuggestions(container) {
  container.innerHTML = `<section class="card profile-section"><h2>Suggested candidates</h2>
    <button type="button" class="btn" id="load-sug">Load matches</button><div id="sug-out"></div></section>`;
  document.getElementById('load-sug').addEventListener('click', async () => {
    const out = document.getElementById('sug-out');
    try {
      const { candidates } = await api(`/api/projects/${projectId}/suggested-candidates`);
      out.innerHTML = candidates
        .map(
          (c) => `<div class="cand-row"><div><strong>${esc(c.display_name || c.email)}</strong>
          <span class="section-hint">(${c.match_score} skill matches)</span><br/>
          ${esc((c.skills || []).map((s) => s.name).join(', '))}</div>
          <button class="btn secondary small-btn" data-inv="${c.user_id}">Invite</button></div>`
        )
        .join('');
      out.querySelectorAll('[data-inv]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const uid = Number(btn.getAttribute('data-inv'));
          try {
            await api(`/api/projects/${projectId}/invitations`, {
              method: 'POST',
              body: JSON.stringify({ invitee_id: uid }),
            });
            show('Invitation sent.', 'success');
          } catch (e) {
            show(e.body?.message || e.message);
          }
        });
      });
    } catch (e) {
      show(e.body?.message || e.message);
    }
  });
}

async function renderSearch(container) {
  const { skills } = await api('/api/skills');
  const boxes = skills
    .map(
      (s) =>
        `<label class="skill-item"><input type="checkbox" name="sf" value="${s.id}"/><span>${esc(
          s.name
        )}</span></label>`
    )
    .join('');
  container.innerHTML = `<section class="card profile-section"><h2>Search people</h2>
    <form id="cand-f" class="form-stack">
      <div class="field full-width"><div class="skill-grid">${boxes}</div></div>
      <div class="field"><label>Search text</label><input name="q" /></div>
      <div class="field"><label>Branch</label><input name="branch" /></div>
      <div class="field"><label>Year</label><input name="year" /></div>
      <button class="btn" type="submit">Search</button>
    </form>
    <div id="cand-out"></div></section>`;
  document.getElementById('cand-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const params = new URLSearchParams();
    if (fd.get('q')) params.set('q', fd.get('q'));
    if (fd.get('branch')) params.set('branch', fd.get('branch'));
    if (fd.get('year')) params.set('year', fd.get('year'));
    e.target.querySelectorAll('input[name="sf"]:checked').forEach((el) => params.append('skill_id', el.value));
    try {
      const { candidates } = await api(`/api/candidates?${params.toString()}`);
      const out = document.getElementById('cand-out');
      out.innerHTML = candidates
        .map(
          (c) => `<div class="cand-row"><div><strong>${esc(c.display_name || c.email)}</strong><br/>
          ${esc((c.skills || []).map((s) => s.name).join(', '))}</div>
          <button class="btn secondary small-btn" data-inv="${c.user_id}">Invite</button></div>`
        )
        .join('');
      out.querySelectorAll('[data-inv]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const uid = Number(btn.getAttribute('data-inv'));
          try {
            await api(`/api/projects/${projectId}/invitations`, {
              method: 'POST',
              body: JSON.stringify({ invitee_id: uid }),
            });
            show('Invitation sent.', 'success');
          } catch (err) {
            show(err.body?.message || err.message);
          }
        });
      });
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
}

async function renderMessages(container) {
  container.innerHTML = `<section class="card profile-section"><h2>Discussion</h2>
    <div id="mthread" class="msg-thread"></div>
    <form id="mform" class="form-stack"><textarea name="body" rows="2" required></textarea>
    <button class="btn" type="submit">Send</button></form></section>`;
  async function load() {
    const { messages } = await api(`/api/projects/${projectId}/messages?limit=80`);
    const box = document.getElementById('mthread');
    box.innerHTML = '';
    messages.reverse().forEach((m) => {
      const d = document.createElement('div');
      d.className = 'msg-item';
      d.innerHTML = `<div class="msg-meta">${esc(m.display_name || m.email)} · ${new Date(
        m.created_at
      ).toLocaleString()}</div><div class="msg-body">${esc(m.body)}</div>`;
      box.appendChild(d);
    });
  }
  await load();
  document.getElementById('mform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new FormData(e.target).get('body').trim();
    try {
      await api(`/api/projects/${projectId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      e.target.reset();
      await load();
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
}

const panels = {
  overview: renderOverview,
  applications: renderApplications,
  suggestions: renderSuggestions,
  search: renderSearch,
  messages: renderMessages,
};

let active = 'overview';

async function activate(name) {
  active = name;
  const root = document.getElementById('panels');
  root.innerHTML = '<div id="panel-inner"></div>';
  const inner = document.getElementById('panel-inner');
  await panels[name](inner);
}

async function main() {
  const user = await initNav();
  projectId = Number(qs('id'));
  if (!user || !projectId) {
    window.location.href = '/login.html';
    return;
  }
  try {
    await refreshProject();
    if (!proj.viewer?.is_owner) {
      show('You are not the owner of this project.');
      return;
    }
    document.getElementById('toolbar').innerHTML = `
      ${tab('overview', 'Overview')}
      ${tab('applications', 'Applications')}
      ${tab('suggestions', 'Suggestions')}
      ${tab('search', 'Find people')}
      ${tab('messages', 'Discussion')}
      <a class="btn secondary" href="/project.html?id=${projectId}">Public view</a>`;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => activate(b.getAttribute('data-tab')));
    });
    await activate('overview');
  } catch (e) {
    show(e.body?.message || e.message);
  }
}

main();
