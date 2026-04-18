import { api, getToken } from './api.js';
import { initNav } from './nav.js';

let currentUser = null;

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function show(msg, kind = 'error') {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.hidden = false;
  el.className = `alert ${kind}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let projectId = null;
let projectData = null;

async function loadProject() {
  const data = await api(`/api/projects/${projectId}`);
  projectData = data.project;
}

function render() {
  const p = projectData;
  const v = p.viewer;
  const canApply = Boolean(currentUser);
  const root = document.getElementById('root');
  const skills = (p.required_skills || []).map((s) => s.name).join(', ') || '—';
  const members = (p.team_members || [])
    .map((m) => `${esc(m.display_name || m.email)}`)
    .join(', ');

  let actions = '';
  if (v) {
    if (v.is_owner) {
      actions += `<p><a class="btn" href="/project-manage.html?id=${projectId}">Manage project</a></p>`;
    }
    if (v.is_team_member) {
      actions += `<p class="section-hint">You are on this team.</p>`;
      if (!v.is_owner) {
        actions += `<button type="button" class="btn secondary" id="leave-btn">Leave project</button>`;
      }
    }
    if (v.pending_invitation) {
      actions += `<p class="section-hint">You have a pending invitation.</p>
        <button type="button" class="btn" id="acc-inv">Accept invite</button>
        <button type="button" class="btn secondary" id="rej-inv">Decline</button>`;
    }
    if (!v.is_owner && !v.is_team_member && !v.pending_invitation && canApply) {
      const app = v.application;
      if (!app || app.withdrawn || app.status === 'rejected') {
        if (p.recruitment_status === 'open') {
          actions += `<button type="button" class="btn" id="apply-btn">Apply to join</button>`;
        }
      } else if (app.withdrawn === false && app.status === 'pending') {
        actions += `<p class="section-hint">Application: <strong>pending</strong></p>
          <button type="button" class="btn secondary" id="withdraw-btn">Withdraw application</button>`;
      } else {
        actions += `<p class="section-hint">Application: <strong>${app.status}</strong></p>`;
      }
    }
  } else if (p.recruitment_status === 'open') {
    actions += `<p class="section-hint"><a href="/login.html">Log in</a> to apply.</p>`;
  }

  root.innerHTML = `
    <header class="site-header">
      <h1>${esc(p.title)}</h1>
      <p class="tagline">${esc(p.project_type)} · up to ${p.team_size} teammates ·
        recruitment ${esc(p.recruitment_status)} · workflow ${esc(p.workflow_status)}</p>
    </header>
    <section class="card profile-section">
      <p>${esc(p.description)}</p>
      <p class="section-hint"><strong>Owner:</strong> ${esc(p.owner_display_name || p.owner_email)}</p>
      <p class="section-hint"><strong>Deadline:</strong> ${p.deadline || '—'}</p>
      <p class="section-hint"><strong>Team type:</strong> ${esc(p.team_type || '—')}</p>
      <p class="section-hint"><strong>Required skills:</strong> ${esc(skills)}</p>
      <p class="section-hint"><strong>Team (${p.team_member_count}/${p.team_size}):</strong> ${members || '—'}</p>
      ${actions}
      <hr style="margin:1.25rem 0;border:none;border-top:1px solid color-mix(in srgb, var(--text) 12%, transparent)" />
      <h3>Report concern</h3>
      <form id="report-form" class="form-stack">
        <div class="field">
          <textarea id="report_reason" rows="2" placeholder="Reason" required></textarea>
        </div>
        <button type="submit" class="btn secondary">Submit report</button>
      </form>
    </section>`;

  const leaveBtn = document.getElementById('leave-btn');
  if (leaveBtn) {
    leaveBtn.addEventListener('click', async () => {
      try {
        await api(`/api/projects/${projectId}/team/me`, { method: 'DELETE' });
        show('Left the project.', 'success');
        await loadProject();
        render();
        setupDiscussion();
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  }

  document.getElementById('acc-inv')?.addEventListener('click', async () => {
    try {
      await api(`/api/invitations/${v.pending_invitation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      });
      show('Invitation accepted.', 'success');
      await loadProject();
      render();
      setupDiscussion();
    } catch (e) {
      show(e.body?.message || e.message);
    }
  });

  document.getElementById('rej-inv')?.addEventListener('click', async () => {
    try {
      await api(`/api/invitations/${v.pending_invitation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      });
      show('Invitation declined.', 'success');
      await loadProject();
      render();
    } catch (e) {
      show(e.body?.message || e.message);
    }
  });

  document.getElementById('apply-btn')?.addEventListener('click', async () => {
    try {
      await api(`/api/projects/${projectId}/applications`, { method: 'POST', body: '{}' });
      show('Application submitted.', 'success');
      await loadProject();
      render();
    } catch (e) {
      show(e.body?.message || e.message);
    }
  });

  document.getElementById('withdraw-btn')?.addEventListener('click', async () => {
    try {
      await api(`/api/projects/${projectId}/applications/me`, { method: 'DELETE' });
      show('Application withdrawn.', 'success');
      await loadProject();
      render();
    } catch (e) {
      show(e.body?.message || e.message);
    }
  });

  document.getElementById('report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = document.getElementById('report_reason').value.trim();
    if (!getToken()) {
      show('Log in to report.');
      return;
    }
    try {
      await api(`/api/projects/${projectId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      show('Report submitted.', 'success');
      e.target.reset();
    } catch (err) {
      show(err.body?.message || err.message);
    }
  });
}

async function loadMessages() {
  const { messages } = await api(`/api/projects/${projectId}/messages?limit=50`);
  const box = document.getElementById('messages');
  box.innerHTML = '';
  messages.reverse().forEach((m) => {
    const div = document.createElement('div');
    div.className = 'msg-item';
    div.innerHTML = `<div class="msg-meta">${esc(m.display_name || m.email)} · ${new Date(
      m.created_at
    ).toLocaleString()}</div><div class="msg-body">${esc(m.body)}</div>`;
    box.appendChild(div);
  });
}

function setupDiscussion() {
  const p = projectData;
  const v = p.viewer;
  const sec = document.getElementById('msg-section');
  if (v && v.is_team_member) {
    sec.hidden = false;
    loadMessages().catch(() => {});
    document.getElementById('msg-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = document.getElementById('msg_body').value.trim();
      if (!body) return;
      try {
        await api(`/api/projects/${projectId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        document.getElementById('msg_body').value = '';
        await loadMessages();
      } catch (err) {
        show(err.body?.message || err.message);
      }
    };
  } else {
    sec.hidden = true;
  }
}

async function main() {
  currentUser = await initNav();
  projectId = Number(qs('id'));
  if (!projectId) {
    show('Missing project id');
    return;
  }
  try {
    await loadProject();
    render();
    setupDiscussion();
  } catch (e) {
    show(e.message || 'Failed to load');
  }
}

main();
