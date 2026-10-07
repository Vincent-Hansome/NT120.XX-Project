(() => {
  const A = window.MocApi;
  const fallback = [
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85',
    'https://images.unsplash.com/photo-1548624149-f6b6b8b6d7b0?auto=format&fit=crop&w=900&q=85'
  ];
  const productImage = (p, i) => A.image(p.image_url) || fallback[i % fallback.length];
  const setMessage = (el, msg, error = false) => { if (!el) return; el.textContent = msg; el.className = `form-message${error ? ' is-error' : ''}`; };
  const refreshBadge = async () => { try { const rows = await A.request('/cart'); document.querySelector('#cart-count').textContent = rows.reduce((n, row) => n + Number(row.quantity), 0); } catch { document.querySelector('#cart-count').textContent = '0'; } };
  refreshBadge();
  A.request('/users/me').then(user => {
    document.querySelector('[data-auth-links]')?.setAttribute('hidden','');
    document.querySelector('[data-profile-nav]')?.removeAttribute('hidden');
    if (user.role === 'admin') document.querySelector('[data-admin-nav]')?.removeAttribute('hidden');
  }).catch(() => {});
  document.querySelector('#menu-toggle')?.addEventListener('click', () => document.querySelector('#site-nav')?.classList.toggle('is-open'));
  document.querySelector('.back-top')?.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  async function loadProducts() {
    const grid = document.querySelector('[data-products]'); if (!grid) return;
    try {
      const products = await A.request('/products');
      const count = document.querySelector('[data-product-count]'); if (count) count.textContent = `${products.length} món`;
      const limit = Number(grid.dataset.limit) || products.length;
      if (!products.length) { grid.innerHTML = '<div class="notice">Bộ sưu tập sẽ sớm được cập nhật.</div>'; return; }
      grid.innerHTML = products.slice(0, limit).map((p, i) => `<article class="product-card card-${i % 4}"><a class="product-image" href="/products/${encodeURIComponent(p.id)}"><img src="${A.escape(productImage(p, i))}" alt="${A.escape(p.name)}"><small>0${i + 1} / MỘC</small></a><div class="product-meta"><div><a href="/products/${encodeURIComponent(p.id)}" class="product-name">${A.escape(p.name)}</a><span>${A.escape(p.color || 'Chất liệu tự nhiên')}${p.size ? ` · ${A.escape(p.size)}` : ''}</span></div><b>${A.money(p.price)}</b></div><button class="quick-add" data-add-product="${A.escape(p.id)}">＋ Thêm vào giỏ</button></article>`).join('');
      const first = products[0]; const hero = document.querySelector('[data-hero-image]'); if (first && hero?.hasAttribute('data-hero-image')) hero.src = productImage(first, 0);
    } catch (e) { grid.innerHTML = `<div class="notice error">${A.escape(e.message)} · Kiểm tra API tại ${A.escape(window.MOC_API)}.</div>`; }
  }
  loadProducts();
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-add-product]'); if (!button) return;
    button.disabled = true;
    try { await A.request('/cart', { method: 'POST', body: JSON.stringify({ product_id: button.dataset.addProduct, quantity: 1 }) }); button.textContent = '✓ Đã thêm'; await refreshBadge(); setTimeout(() => { if (button.isConnected) { button.textContent = '＋ Thêm vào giỏ'; button.disabled = false; } }, 1300); }
    catch { window.location.href = '/login'; }
  });

  const detail = document.querySelector('[data-product-detail]');
  if (detail) (async () => {
    const id = detail.dataset.productId, msg = detail.querySelector('[data-detail-message]'); let qty = 1, stock = 99;
    try {
      const p = await A.request(`/products/${encodeURIComponent(id)}`); stock = Number(p.stock) || 0;
      detail.querySelector('[data-detail-name]').textContent = p.name;
      detail.querySelector('[data-detail-price]').textContent = A.money(p.price);
      detail.querySelector('[data-detail-description]').textContent = p.description || 'Một thiết kế tối giản được hoàn thiện từ chất liệu tự nhiên, để đồng hành cùng bạn qua nhiều mùa.';
      detail.querySelector('[data-detail-color]').textContent = p.color || 'Sợi tự nhiên'; detail.querySelector('[data-detail-size]').textContent = p.size || 'S / M / L'; detail.querySelector('[data-detail-stock]').textContent = stock ? `${stock} sản phẩm` : 'Hết hàng';
      const img = detail.querySelector('[data-detail-image]'); img.src = productImage(p, Number(id) || 0); img.alt = p.name;
      const quantity = detail.querySelector('[data-quantity]'), add = detail.querySelector('[data-add-detail]'); quantity.textContent = qty; add.disabled = !stock;
      detail.querySelector('[data-quantity-minus]').onclick = () => { qty = Math.max(1, qty - 1); quantity.textContent = qty; };
      detail.querySelector('[data-quantity-plus]').onclick = () => { qty = Math.min(stock || 99, qty + 1); quantity.textContent = qty; };
      add.onclick = async () => { try { await A.request('/cart', { method: 'POST', body: JSON.stringify({ product_id: p.id, quantity: qty }) }); add.textContent = '✓ Đã thêm vào giỏ'; await refreshBadge(); setMessage(msg, 'Sản phẩm đã được thêm vào túi đồ.'); setTimeout(() => { add.textContent = 'Thêm vào giỏ →'; }, 1200); } catch (e) { setMessage(msg, `${e.message} · Hãy đăng nhập để tiếp tục.`, true); } };
    } catch (e) { setMessage(msg, e.message, true); }
  })();

  const cartRoot = document.querySelector('[data-cart-page]');
  if (cartRoot) (async () => {
    const list = cartRoot.querySelector('[data-cart-items]'), message = cartRoot.querySelector('[data-cart-message]');
    const load = async () => {
      try {
        const rows = await A.request('/cart'); cartRoot.querySelector('[data-cart-item-count]').textContent = `${rows.length} món`;
        const total = rows.reduce((n, p) => n + Number(p.price) * Number(p.quantity), 0);
        cartRoot.querySelector('[data-cart-subtotal]').textContent = A.money(total); cartRoot.querySelector('[data-cart-total]').textContent = A.money(total);
        document.querySelector('.checkout-button').href = rows.length ? '/checkout' : '/products';
        if (!rows.length) { list.innerHTML = '<div class="empty-state"><p>Chưa có điều gì trong túi.</p><a class="button button-dark" href="/products">Trở về bộ sưu tập →</a></div>'; }
        else list.innerHTML = rows.map((p,i) => `<article class="cart-item"><a class="cart-thumb" href="/products/${encodeURIComponent(p.product_id)}"><img src="${A.escape(productImage(p,i))}" alt="${A.escape(p.name)}"></a><div class="cart-info"><span class="eyebrow">MỘC / 0${p.product_id}</span><a class="product-name" href="/products/${encodeURIComponent(p.product_id)}">${A.escape(p.name)}</a><small>Chất liệu tự nhiên</small><div class="cart-quantity"><button data-cart-qty="${p.id}" data-value="${Number(p.quantity)-1}">−</button><span>${p.quantity}</span><button data-cart-qty="${p.id}" data-value="${Number(p.quantity)+1}">＋</button><button class="remove-link" data-cart-remove="${p.id}">Xóa</button></div></div><b class="cart-line-price">${A.money(p.price*p.quantity)}</b></article>`).join('');
      } catch (e) { list.innerHTML = `<div class="notice error">${A.escape(e.message)} — <a href="/login">Đăng nhập để xem giỏ hàng</a></div>`; setMessage(message, e.message, true); }
    };
    await load();
    list.addEventListener('click', async e => {
      const qty = e.target.closest('[data-cart-qty]'), remove = e.target.closest('[data-cart-remove]');
      try { if (qty) { const value = Number(qty.dataset.value); if (value <= 0) await A.request(`/cart/${qty.dataset.cartQty}`, { method: 'DELETE' }); else await A.request(`/cart/${qty.dataset.cartQty}`, { method: 'PUT', body: JSON.stringify({ quantity: value }) }); await load(); await refreshBadge(); } if (remove) { await A.request(`/cart/${remove.dataset.cartRemove}`, { method: 'DELETE' }); await load(); await refreshBadge(); } } catch (err) { setMessage(message, err.message, true); }
    });
  })();
  const authForm = document.querySelector('[data-auth-form]');
  if (authForm) authForm.addEventListener('submit', async e => {
    e.preventDefault(); const message = authForm.querySelector('[data-auth-message]'), button = authForm.querySelector('button[type=submit]'); button.disabled = true; setMessage(message, '');
    const form = new FormData(authForm), payload = Object.fromEntries(form.entries()), mode = authForm.dataset.mode;
    try { const result = await A.request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) }); if (mode === 'register') { setMessage(message, 'Tài khoản đã tạo. Đang chuyển đến đăng nhập…'); setTimeout(() => location.assign('/login'), 900); } else { location.assign(result.user?.role === 'admin' ? '/admin' : '/profile'); } }
    catch (err) { setMessage(message, err.message, true); button.disabled = false; }
  });

  const orders = document.querySelector('[data-orders-page]');
  if (orders) (async () => {
    const list = orders.querySelector('[data-orders-list]'), message = orders.querySelector('[data-orders-message]');
    try {
      const rows = await A.request('/orders');
      if (!rows.length) { list.innerHTML = '<div class="empty-state"><p>Bạn chưa có đơn hàng nào.</p><a class="button button-dark" href="/products">Tìm món đồ đầu tiên →</a></div>'; return; }
      list.innerHTML = rows.map(o => `<article class="order-row"><button class="order-head" data-order-id="${A.escape(o.id)}"><span><small class="eyebrow">MÃ ĐƠN</small><b>MC-${String(o.id).padStart(5,'0')}</b></span><span><small class="eyebrow">NGÀY ĐẶT</small><b>${new Date(o.created_at).toLocaleDateString('vi-VN')}</b></span><span><small class="eyebrow">TRẠNG THÁI</small><b>${A.escape(o.status)}</b></span><strong>${A.money(o.total)}</strong><span>⌄</span></button><div class="order-detail" id="order-${A.escape(o.id)}" hidden></div></article>`).join('');
      list.addEventListener('click', async e => { const btn = e.target.closest('[data-order-id]'); if (!btn) return; const detail = document.querySelector(`#order-${CSS.escape(btn.dataset.orderId)}`); if (!detail.hidden) { detail.hidden = true; return; } detail.hidden = false; if (detail.dataset.loaded) return; try { const data = await A.request(`/orders/${encodeURIComponent(btn.dataset.orderId)}`); detail.innerHTML = data.items.map((it,i)=>`<div class="order-item"><img src="${A.escape(productImage(it,i))}" alt="${A.escape(it.name)}"><span>${A.escape(it.name)} <small>× ${it.quantity}</small></span><b>${A.money(it.price*it.quantity)}</b></div>`).join(''); detail.dataset.loaded='true'; } catch(err) { detail.innerHTML = `<p class="form-message is-error">${A.escape(err.message)}</p>`; } });
    } catch (err) { setMessage(message, `${err.message} — Đăng nhập để xem đơn hàng.`, true); list.innerHTML = '<a class="button button-dark" href="/login">Đăng nhập →</a>'; }
  })();

  const profile = document.querySelector('[data-profile-page]');
  if (profile) (async () => {
    const message=profile.querySelector('[data-profile-message]');
    try { const user=await A.request('/users/me'); profile.querySelector('[data-profile-name]').textContent=user.name; profile.querySelector('[data-profile-email]').textContent=user.email; profile.querySelector('[data-profile-created]').textContent=user.created_at?new Date(user.created_at).toLocaleDateString('vi-VN'):'MỘC member'; profile.querySelector('.profile-loading').hidden=true; profile.querySelector('.profile-content').hidden=false; }
    catch(err) { setMessage(message, `${err.message} — Vui lòng đăng nhập để xem tài khoản.`, true); profile.querySelector('.profile-loading').innerHTML='<a href="/login" class="button button-dark">Đăng nhập →</a>'; }
    profile.querySelector('[data-logout]')?.addEventListener('click', async () => { try { await A.request('/users/logout',{method:'POST',body:JSON.stringify({})}); location.assign('/'); } catch(err) { setMessage(message,err.message,true); } });
  })();

  const checkout = document.querySelector('[data-checkout-page]');
  if (checkout) (async () => {
    const message=checkout.querySelector('[data-checkout-message]'), button=checkout.querySelector('[data-place-order]');
    try { const rows=await A.request('/cart'); const total=rows.reduce((n,p)=>n+Number(p.price)*Number(p.quantity),0); checkout.querySelector('[data-checkout-count]').textContent=`${rows.reduce((n,p)=>n+Number(p.quantity),0)} món`; checkout.querySelector('[data-checkout-subtotal]').textContent=A.money(total); checkout.querySelector('[data-checkout-total]').textContent=A.money(total); if(!rows.length){button.disabled=true;setMessage(message,'Giỏ hàng đang trống. Hãy chọn vài món trước nhé.');} }
    catch(err){button.disabled=true;setMessage(message,`${err.message} — Vui lòng đăng nhập trước.`,true);}
    button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Đang tạo đơn…';try{await A.request('/orders',{method:'POST',body:JSON.stringify({})});location.assign('/orders');}catch(err){setMessage(message,err.message,true);button.disabled=false;button.textContent='Xác nhận đặt hàng →';}});
  })();

  const adminProducts=document.querySelector('[data-admin-products]');
  if(adminProducts) {
    const target=adminProducts.querySelector('[data-admin-product-list]');
    const message=adminProducts.querySelector('[data-admin-message]');
    const form=adminProducts.querySelector('[data-product-form]');
    const toggle=adminProducts.querySelector('[data-toggle-product-form]');
    const categorySelect=adminProducts.querySelector('[data-category-select]');
    const submitButton=form.querySelector('[type="submit"]');
    let editingId=null;
    const renderProducts=async()=>{
      try {
        const rows=await A.request('/products');
        target.innerHTML=rows.map((p,i)=>`<div class="admin-product"><img src="${A.escape(productImage(p,i))}" alt=""><span>${A.escape(p.name)}</span><b>${A.money(p.price)}</b><small>Còn ${A.escape(p.stock)} món</small><div class="admin-product-actions-row"><button type="button" data-edit-product="${p.id}" data-name="${A.escape(p.name)}" data-description="${A.escape(p.description||'')}" data-price="${p.price}" data-stock="${p.stock}" data-size="${A.escape(p.size||'')}" data-color="${A.escape(p.color||'')}" data-category="${p.category_id||''}">Sửa</button><button type="button" data-delete-product="${p.id}">Xoá</button></div></div>`).join('')||'<p>Chưa có sản phẩm.</p>';
      } catch(err) { setMessage(message,err.message,true); }
    };
    renderProducts();
    A.request('/categories').then(rows=>{
      categorySelect.innerHTML='<option value="">Không phân loại</option>'+rows.map(c=>`<option value="${A.escape(c.id)}">${A.escape(c.name)}</option>`).join('');
    }).catch(err=>{ setMessage(message,`Không thể tải danh mục: ${err.message}`,true); });
    const openForm=()=>{ form.hidden=false; toggle.setAttribute('aria-expanded','true'); form.querySelector('[name="name"]').focus(); };
    const closeForm=()=>{ form.reset(); form.hidden=true; toggle.setAttribute('aria-expanded','false'); editingId=null; submitButton.textContent='Lưu sản phẩm →'; };
    toggle.addEventListener('click',()=>{ if(!form.hidden){ closeForm(); return; } editingId=null; openForm(); });
    adminProducts.querySelector('[data-cancel-product-form]').addEventListener('click',closeForm);
    target.addEventListener('click', async e => {
      const editBtn=e.target.closest('[data-edit-product]');
      const delBtn=e.target.closest('[data-delete-product]');
      if (editBtn) {
        editingId=editBtn.dataset.editProduct;
        form.elements.name.value=editBtn.dataset.name;
        form.elements.description.value=editBtn.dataset.description;
        form.elements.price.value=editBtn.dataset.price;
        form.elements.stock.value=editBtn.dataset.stock;
        form.elements.size.value=editBtn.dataset.size;
        form.elements.color.value=editBtn.dataset.color;
        form.elements.category_id.value=editBtn.dataset.category;
        submitButton.textContent='Cập nhật sản phẩm →';
        openForm();
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (delBtn) {
        if (!confirm('Xoá sản phẩm này? Hành động không thể hoàn tác.')) return;
        try { await A.request(`/products/${delBtn.dataset.deleteProduct}`,{method:'DELETE'}); setMessage(message,'Đã xoá sản phẩm.'); await renderProducts(); }
        catch(err) { setMessage(message,err.message,true); }
      }
    });
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      submitButton.disabled=true; setMessage(message,'');
      const payload=new FormData(form);
      if(!payload.get('category_id')) payload.delete('category_id');
      try {
        if (editingId) {
          await A.request(`/products/${editingId}`,{method:'PUT',body:payload});
          setMessage(message,'Đã cập nhật sản phẩm.');
        } else {
          await A.request('/products',{method:'POST',body:payload});
          setMessage(message,'Đã thêm sản phẩm.');
        }
        closeForm();
        await renderProducts();
      } catch(err) { setMessage(message,err.message,true); }
      finally { submitButton.disabled=false; }
    });
  }
})();

