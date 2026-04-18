import { initNav } from './nav.js';

async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    const data = await r.json();
    if (data.ok) console.info('API healthy:', data);
    else console.warn('API unhealthy:', data);
  } catch (e) {
    console.warn('Health check failed', e);
  }
}

async function main() {
  checkHealth();
  const user = await initNav();

  const welcome = document.getElementById('welcome');
  if (welcome && user) {
    welcome.hidden = false;
    const nameEl = welcome.querySelector('strong');
    if (nameEl) nameEl.textContent = user.profile?.display_name || user.email;
  }
}

main();
