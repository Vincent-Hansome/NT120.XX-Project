(() => {
  const base = window.MOC_API || 'http://localhost:3001/api';
  const host = base.replace(/\/api\/?$/, '');
  window.MocApi = {
    image(value) { if (!value) return ''; return /^https?:\/\//i.test(value) ? value : `${host}${value.startsWith('/') ? '' : '/'}${value}`; },
    async request(path, options = {}) {
      const res = await fetch(`${base}${path}`, { credentials: 'include', ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
      return data;
    },
    money(value) { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0); },
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  };
})();
