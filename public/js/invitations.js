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

async function main() {
  const user = await initNav();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  const { invitations } = await api('/api/invitations/inbox');
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (invitations.length === 0) {
    list.innerHTML = '<p class="section-hint">No pending invitations.</p>';
    return;
  }
  for (const inv of invitations) {
    const sec = document.createElement('section');
    sec.className = 'card profile-section';
    sec.innerHTML = `
      <h2>${esc(inv.title)}</h2>
      <p class="section-hint">From ${esc(inv.inviter_name || inv.inviter_email)}</p>
      <button class="btn" data-id="${inv.id}" data-a="acc">Accept</button>
      <button class="btn secondary" data-id="${inv.id}" data-a="rej">Decline</button>`;
    list.appendChild(sec);
  }
  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const acc = btn.getAttribute('data-a') === 'acc';
      try {
        await api(`/api/invitations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: acc ? 'accepted' : 'rejected' }),
        });
        show(acc ? 'Accepted.' : 'Declined.', 'success');
        window.location.reload();
      } catch (e) {
        show(e.body?.message || e.message);
      }
    });
  });
}

main().catch((e) => show(e.body?.message || e.message));
