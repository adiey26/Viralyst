const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
const button = document.getElementById('login-button');

document.getElementById('password').focus();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (response.ok) {
      window.location.replace('/');
      return;
    }
    const body = await response.json().catch(() => ({}));
    error.textContent = body.error ?? 'Could not sign in.';
    error.hidden = false;
  } catch {
    error.textContent = 'Could not reach the server. Check your connection.';
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});
