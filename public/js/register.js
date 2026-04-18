import { api, setToken } from './api.js';
import { initNav } from './nav.js';

initNav();

const form = document.getElementById('form');
const alertEl = document.getElementById('alert');

function showError(msg) {
  alertEl.textContent = msg;
  alertEl.hidden = false;
  alertEl.className = 'alert error';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.hidden = true;
  const fd = new FormData(form);
  const displayName = String(fd.get('display_name') || '').trim();
  const body = {
    email: fd.get('email'),
    password: fd.get('password'),
  };
  if (displayName) body.display_name = displayName;
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setToken(data.token);
    window.location.href = '/';
  } catch (err) {
    showError(err.body?.message || err.message || 'Registration failed');
  }
});
