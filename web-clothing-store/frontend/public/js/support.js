(() => {
  const root = document.querySelector('[data-support-customer], [data-support-admin]');
  if (!root) return;
  const api = window.MocApi;
  const admin = root.hasAttribute('data-support-admin');
  const endpoint = admin ? '/support/admin/tickets' : '/support/tickets';
  const list = root.querySelector('[data-support-list]');
  const content = root.querySelector('[data-support-content]');
  const pageMessage = root.querySelector('[data-support-page-message]');
  const listMessage = root.querySelector('[data-support-list-message]');
  const more = root.querySelector('[data-support-more]');
  const refresh = root.querySelector('[data-support-refresh]');
  const form = root.querySelector('[data-support-form]');
  const labels = { open: 'Đã tiếp nhận', in_progress: 'Đang xử lý', resolved: 'Đã giải quyết' };
  let nextCursor = null;
  let loading = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // All ticket/customer/reply content is plain text, including HTML-like input.
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function feedback(node, text, error = false) {
    node.textContent = text;
    node.classList.toggle('is-error', error);
    node.setAttribute('role', error ? 'alert' : 'status');
  }
  function date(value) {
    const parsed = new Date(value);
    return value && !Number.isNaN(parsed.valueOf()) ? parsed.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '';
  }
  function showAuthentication(error) {
    if (error.status !== 401 && error.status !== 403) return false;
    content.hidden = true;
    root.querySelector('[data-support-signin]').hidden = false;
    feedback(pageMessage, admin ? 'Bạn cần quyền quản trị để xem hộp thư hỗ trợ.' : 'Bạn cần đăng nhập để sử dụng hỗ trợ.', true);
    return true;
  }
  function ticketCard(ticket) {
    const card = element('details', 'support-ticket');
    card.dataset.ticketId = ticket.id;
    const summary = element('summary');
    const top = element('span', 'support-ticket-top');
    const badge = element('span', `support-status support-status-${Object.hasOwn(labels, ticket.status) ? ticket.status : 'open'}`, labels[ticket.status] || 'Đã tiếp nhận');
    top.append(element('span', 'support-ticket-id', `HT-${String(ticket.id).padStart(5, '0')}`), badge);
    // INSECURE DEMO VARIANT: render subject bằng innerHTML thay vì textContent
    const subjectNode = element('span', 'support-ticket-subject');
    subjectNode.innerHTML = String(ticket.subject ?? '');
    summary.append(top, subjectNode);
    const meta = element('span', 'support-ticket-meta', date(ticket.created_at));
    if (admin) meta.append(element('span', '', `${ticket.customer_name} · ${ticket.customer_email}`));
    summary.append(meta);
    const body = element('div', 'support-ticket-content');
    // INSECURE DEMO VARIANT: render message bằng innerHTML thay vì textContent
    const messageNode = element('p', 'support-ticket-body');
    messageNode.innerHTML = String(ticket.message ?? '');
    body.append(messageNode);
    const reply = element('div', 'support-ticket-reply');
    const replyText = element('p', 'support-ticket-reply-text', ticket.admin_reply);
    const replyTime = element('time', '', date(ticket.replied_at));
    reply.append(element('h3', '', 'Phản hồi từ MỘC'), replyText, replyTime);
    reply.hidden = !ticket.admin_reply;
    body.append(reply);
    if (admin) {
      const editor = element('form', 'support-form support-admin-form');
      const statusId = `support-status-${ticket.id}`;
      const replyId = `support-reply-${ticket.id}`;
      const statusLabel = element('label', '', 'Trạng thái xử lý');
      statusLabel.htmlFor = statusId;
      const status = element('select');
      status.id = statusId;
      status.name = 'status';
      for (const [value, title] of Object.entries(labels)) {
        const option = element('option', '', title);
        option.value = value;
        status.append(option);
      }
      status.value = ticket.status;
      const replyLabel = element('label', '', 'Phản hồi cho khách hàng');
      replyLabel.htmlFor = replyId;
      const input = element('textarea');
      input.id = replyId;
      input.name = 'reply';
      input.rows = 4;
      input.maxLength = 4000;
      input.value = ticket.admin_reply || '';
      const hint = element('small', '', 'Tối đa 4.000 ký tự. Có thể chỉ cập nhật trạng thái; để trống sẽ giữ phản hồi đã có.');
      hint.id = `${replyId}-hint`;
      input.setAttribute('aria-describedby', hint.id);
      const message = element('p', 'support-feedback');
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      const save = element('button', 'button button-dark', 'Lưu phản hồi →');
      save.type = 'submit';
      editor.append(statusLabel, status, element('small', '', 'Khách hàng sẽ thấy trạng thái và phản hồi này.'), replyLabel, input, hint, message, save);
      editor.addEventListener('submit', async event => {
        event.preventDefault();
        if (save.disabled || !editor.reportValidity()) return;
        const payload = { status: status.value };
        if (input.value.trim()) payload.reply = input.value.trim();
        save.disabled = true;
        save.textContent = 'Đang lưu…';
        feedback(message, '');
        try {
          const updated = await api.request(`${endpoint}/${encodeURIComponent(ticket.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
          Object.assign(ticket, updated);
          badge.textContent = labels[updated.status];
          badge.className = `support-status support-status-${updated.status}`;
          replyText.textContent = updated.admin_reply || '';
          replyTime.textContent = date(updated.replied_at);
          reply.hidden = !updated.admin_reply;
          input.value = updated.admin_reply || '';
          feedback(message, 'Đã lưu cập nhật hỗ trợ.');
        } catch (error) {
          if (!showAuthentication(error)) feedback(message, error.message, true);
        } finally {
          save.disabled = false;
          save.textContent = 'Lưu phản hồi →';
        }
      });
      body.append(editor);
    }
    card.append(summary, body);
    return card;
  }

  async function load(append = false) {
    if (loading) return;
    loading = true;
    more.disabled = true;
    refresh.disabled = true;
    list.setAttribute('aria-busy', 'true');
    feedback(listMessage, 'Đang tải yêu cầu…');
    try {
      const data = await api.request(`${endpoint}${append && nextCursor ? `?before=${encodeURIComponent(nextCursor)}` : ''}`);
      if (!append) list.replaceChildren();
      for (const ticket of data.tickets) list.append(ticketCard(ticket));
      if (!append && !data.tickets.length) list.append(element('p', 'support-empty', admin ? 'Chưa có yêu cầu hỗ trợ nào.' : 'Bạn chưa có yêu cầu nào. Gửi lời nhắn đầu tiên để MỘC hỗ trợ bạn.'));
      nextCursor = data.nextCursor;
      more.hidden = !nextCursor;
      content.hidden = false;
      root.querySelector('[data-support-signin]').hidden = true;
      feedback(pageMessage, '');
      feedback(listMessage, '');
    } catch (error) {
      if (!showAuthentication(error)) {
        content.hidden = false;
        feedback(pageMessage, '');
        feedback(listMessage, `${error.message} Bạn có thể bấm Làm mới để thử lại.`, true);
      }
    } finally {
      loading = false;
      more.disabled = false;
      refresh.disabled = false;
      list.setAttribute('aria-busy', 'false');
    }
  }

  more.addEventListener('click', () => load(true));
  refresh.addEventListener('click', () => load());
  if (form) form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const message = form.querySelector('[data-support-form-message]');
    if (button.disabled || !form.reportValidity()) return;
    const subject = form.elements.subject.value.trim();
    const body = form.elements.message.value.trim();
    if (!subject || !body) {
      feedback(message, 'Vui lòng nhập tiêu đề và nội dung hỗ trợ.', true);
      (!subject ? form.elements.subject : form.elements.message).focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Đang gửi…';
    feedback(message, '');
    try {
      const result = await api.request(endpoint, { method: 'POST', body: JSON.stringify({ subject, message: body }) });
      form.reset();
      feedback(message, `Đã gửi yêu cầu HT-${String(result.id).padStart(5, '0')}. Bạn có thể theo dõi phản hồi bên dưới.`);
      await load();
    } catch (error) {
      if (!showAuthentication(error)) feedback(message, error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Gửi yêu cầu →';
    }
  });
  load();
})();
