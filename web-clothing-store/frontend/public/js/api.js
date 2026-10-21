(() => {
  const configuredApiUrl = document.querySelector('meta[name="moc-api"]')?.content || '/api';
  window.MOC_API = configuredApiUrl;
  const base = configuredApiUrl.replace(/\/$/, '');
  const host = base.replace(/\/api$/, '');
  const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  let csrfToken = null;
  let csrfTokenExpiresAt = 0;
  let csrfTokenRequest = null;

  async function getCsrfToken() {
    if (csrfToken && Date.now() < csrfTokenExpiresAt - 30000) return csrfToken;

    if (!csrfTokenRequest) {
      csrfTokenRequest = fetch(`${base}/auth/csrf`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.csrfToken || !data.expiresAt) {
            throw new Error(data.message || 'Không thể xác thực yêu cầu. Vui lòng thử lại.');
          }
          csrfToken = data.csrfToken;
          csrfTokenExpiresAt = data.expiresAt;
          return csrfToken;
        })
        .finally(() => { csrfTokenRequest = null; });
    }

    return csrfTokenRequest;
  }

  window.MocApi = {
    image(value) { if (!value) return ''; return /^https?:\/\//i.test(value) ? value : `${host}${value.startsWith('/') ? '' : '/'}${value}`; },
    async request(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const headers = {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
      };

      if (unsafeMethods.has(method)) {
        headers['X-CSRF-Token'] = await getCsrfToken();
      }

      const res = await fetch(`${base}${path}`, {
        credentials: 'include',
        ...options,
        method,
        headers
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
      return data;
    },
    money(value) { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0); },
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  };
})();
