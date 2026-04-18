import { loadSession, logoutSession } from './session.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function roleLinks(user) {
  if (!user) {
    return `<a href="/projects.html">Browse projects</a>`;
  }
  let links = `<a href="/projects.html">Browse projects</a>`;
  links += `<a href="/project-new.html">New project</a>`;
  links += `<a href="/my-projects.html">My projects</a>`;
  links += `<a href="/recommended.html">Recommended</a>`;
  links += `<a href="/applications.html">My applications</a>`;
  links += `<a href="/invitations.html">Invitations</a>`;
  if (user.role === 'admin') links += `<a href="/admin.html">Admin</a>`;
  return links;
}

export async function initNav() {
  const nav = document.getElementById('top-nav');
  if (!nav) return null;

  const user = await loadSession();
  const roleTag = user?.role === 'admin' ? ' · admin' : '';
  const roleBar = user
    ? `<span class="session-bar">${esc(user.email)}${roleTag}</span>
       <button type="button" class="btn secondary" id="logout-btn">Log out</button>`
    : `<a href="/login.html">Log in</a>
       <a href="/register.html">Register</a>`;

  nav.innerHTML = `
    <a href="/">Home</a>
    ${roleLinks(user)}
    <a href="/profile.html">Profile</a>
    <span class="spacer"></span>
    ${roleBar}
  `;

  const btn = document.getElementById('logout-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      await logoutSession();
      window.location.href = '/';
    });
  }

  return user;
}
