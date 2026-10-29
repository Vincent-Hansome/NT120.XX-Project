const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const apiSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/api.js'), 'utf8');
const storeSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/js/store.js'), 'utf8');

function element(selectors = {}) {
  return {
    dataset: {}, textContent: '', disabled: false, children: [], listeners: {},
    querySelector(selector) { return selectors[selector] || null; },
    setAttribute() {}, removeAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    appendChild(child) { this.children.push(child); selectors['[data-quick-add-message]'] = child; }
  };
}
function store(roots = {}, request = async route => route === '/cart' ? [] : {}, FormType = FormData, options = {}) {
  const events = {}, navigations = [], timers = [];
  const document = {
    querySelector(selector) { return roots[selector] || (selector === '#cart-count' ? element() : null); },
    addEventListener(type, handler) { events[type] = handler; }, createElement() { return element(); }
  };
  const location = { search: '', assign(url) { navigations.push(url); } };
  const api = { request, escape: String, image: String, money: String };
  const storage=options.storage || new Map();
  const sessionStorage=options.sessionStorage || {
    getItem: key=>storage.get(key) ?? null, setItem: (key,value)=>storage.set(key,String(value)), removeItem: key=>storage.delete(key)
  };
  vm.runInNewContext(storeSource, { window: { MocApi: api, location, sessionStorage, crypto: require('node:crypto').webcrypto }, document, location, URLSearchParams,
    FormData: FormType, setTimeout(fn) { timers.push(fn); } });
  return { events, navigations, timers };
}

function checkoutRoot() {
  const button=element(), message=element();
  const root=element({ '[data-place-order]':button, '[data-checkout-message]':message,
    '[data-checkout-count]':element(), '[data-checkout-subtotal]':element(), '[data-checkout-total]':element() });
  return {root,button,message};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('checkout retains its key across a lost response, reload and changed cart; success clears it',async()=>{
  const storage=new Map(), submitted=[];
  const api=async(route,options)=>{
    if(route==='/users/me')return {id:1};
    if(route==='/cart')return [{price:'10.00',quantity:1}];
    if(route==='/orders'){
      submitted.push(options.headers['Idempotency-Key']);
      if(submitted.length===1)throw new Error('Network response lost');
      return {orderId:1};
    }
    return {};
  };
  const a=checkoutRoot();
  store({'[data-checkout-page]':a.root},api,FormData,{storage});await flush();
  await a.button.listeners.click();
  assert.equal(a.button.disabled,false);
  assert.equal(storage.get('moc-checkout:1'),submitted[0]);
  assert.match(submitted[0],/^[a-f0-9-]{36}$/);
  const b=checkoutRoot();
  const state=store({'[data-checkout-page]':b.root},api,FormData,{storage});await flush();
  assert.match(b.message.textContent,/hệ thống sẽ trả lại đơn cũ/);
  await b.button.listeners.click();
  assert.equal(submitted[1],submitted[0]);
  assert.equal(storage.has('moc-checkout:1'),false);
  assert.deepEqual(state.navigations,['/orders']);
  const c=checkoutRoot();
  store({'[data-checkout-page]':c.root},api,FormData,{storage});await flush();
  await c.button.listeners.click();
  assert.notEqual(submitted[2],submitted[0]);
});

test('pending checkout can be resolved after reload even with an empty cart',async()=>{
  const key=require('node:crypto').randomUUID(),storage=new Map([['moc-checkout:1',key]]);
  const a=checkoutRoot();let sent;
  const state=store({'[data-checkout-page]':a.root},async(route,options)=>{
    if(route==='/users/me')return {id:1};
    if(route==='/cart')return [];
    if(route==='/orders'){sent=options.headers['Idempotency-Key'];return {orderId:1};}
    return {};
  },FormData,{storage});await flush();
  assert.equal(a.button.disabled,false);
  await a.button.listeners.click();
  assert.equal(sent,key);assert.deepEqual(state.navigations,['/orders']);
});

test('checkout double click sends only one request',async()=>{
  const a=checkoutRoot();let finish,sent=0;
  const pending=new Promise(resolve=>{finish=resolve;});
  store({'[data-checkout-page]':a.root},async(route)=>{
    if(route==='/users/me')return {id:1};
    if(route==='/cart')return [{price:10,quantity:1}];
    if(route==='/orders'){sent++;return pending;}
    return {};
  });await flush();
  const first=a.button.listeners.click();
  await a.button.listeners.click();await flush();
  assert.equal(sent,1);finish({orderId:1});await first;
});

test('checkout fails closed when intent storage is unavailable or account changes',async()=>{
  for(const failure of ['storage','identity']){
    const a=checkoutRoot();let owner=1,sent=0;
    store({'[data-checkout-page]':a.root},async(route)=>{
      if(route==='/users/me')return {id:owner};
      if(route==='/cart')return [{price:10,quantity:1}];
      if(route==='/orders')sent++;
      return {};
    },FormData,{sessionStorage:{getItem(){return null;},setItem(){throw new Error('Storage unavailable');},removeItem(){}}});
    await flush();if(failure==='identity')owner=2;
    await a.button.listeners.click();
    assert.equal(sent,0);assert.equal(a.button.disabled,false);
  }
});

test('pending keys are scoped to the signed-in user',async()=>{
  const oldKey=require('node:crypto').randomUUID();
  const storage=new Map([['moc-checkout:1',oldKey]]),a=checkoutRoot();let sent;
  store({'[data-checkout-page]':a.root},async(route,options)=>{
    if(route==='/users/me')return {id:2};
    if(route==='/cart')return [{price:10,quantity:1}];
    if(route==='/orders'){sent=options.headers['Idempotency-Key'];return {orderId:2};}
    return {};
  },FormData,{storage});await flush();await a.button.listeners.click();
  assert.notEqual(sent,oldKey);assert.equal(storage.get('moc-checkout:1'),oldKey);
});

for (const status of [400, 401, 403, 409, 413, 500, 502]) {
  test(`API client preserves HTTP ${status}, including non-JSON error bodies`, async () => {
    const window = {};
    vm.runInNewContext(apiSource, { window, document: { querySelector: () => null }, FormData,
      fetch: async () => ({ status, ok: false, async json() { if (status === 502) throw new Error('HTML gateway'); return { message: 'Controlled failure' }; } }) });
    await assert.rejects(window.MocApi.request('/cart'), error => {
      assert.equal(error.status, status);
      assert.equal(typeof error.message, 'string');
      if (status >= 500) assert.match(error.message, /Máy chủ/);
      return true;
    });
  });
}
test('CSRF acquisition preserves a 403 and never submits the mutation', async () => {
  const window = {}, urls = [];
  vm.runInNewContext(apiSource, { window, document: { querySelector: () => null }, FormData,
    fetch: async url => { urls.push(url); return { status: 403, ok: false, json: async () => ({ message: 'CSRF denied' }) }; } });
  await assert.rejects(window.MocApi.request('/cart', { method: 'POST' }), error => error.status === 403);
  assert.deepEqual(urls, ['/api/auth/csrf']);
});
test('API success returns data and sends CSRF proof for mutations', async () => {
  const window = {}, calls = [];
  vm.runInNewContext(apiSource, { window, document: { querySelector: () => null }, FormData,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, ok: true, json: async () => url.endsWith('/csrf') ? { csrfToken: 'proof', expiresAt: Date.now() + 60000 } : { message: 'ok' } };
    } });
  assert.equal((await window.MocApi.request('/cart', { method: 'POST' })).message, 'ok');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'proof');
  assert.equal(calls[1].options.credentials, 'include');
  assert.match(window.MocApi.money('12.34'), /12,34/);
  assert.match(window.MocApi.money('0.30'), /0,3/);
});
for (const status of [401, 403, 409, 500, undefined]) {
  test(`quick-add ${status || 'network error'} only redirects on 401 and enables retry otherwise`, async () => {
    const button = element(); button.dataset.addProduct = '1'; button.parentElement = element();
    const error = Object.assign(new Error(status === 409 ? 'Quantity exceeds stock' : 'Failure'), { status });
    const state = store({}, async (route, options) => {
      if (options?.method === 'POST') throw error;
      return route === '/cart' ? [] : {};
    });
    await state.events.click({ target: { closest: () => button } });
    if (status === 401) assert.deepEqual(state.navigations, ['/login']);
    else {
      assert.deepEqual(state.navigations, []);
      assert.equal(button.disabled, false);
      assert.match(button.parentElement.children[0].textContent, status === 403 ? /CSRF/ : status === 409 ? /stock/ : /Failure/);
    }
  });
}
test('quick-add success updates the badge and returns the button to usable state', async () => {
  const button = element(); button.dataset.addProduct = '1'; button.isConnected = true; button.parentElement = element();
  const state = store();
  await state.events.click({ target: { closest: () => button } });
  assert.match(button.textContent, /Đã thêm/);
  state.timers[0]();
  assert.equal(button.disabled, false);
  assert.deepEqual(state.navigations, []);
});
test('quick-add retry clears the previous error after success', async () => {
  const button = element(); button.dataset.addProduct = '1'; button.parentElement = element();
  let fails = true;
  const state = store({}, async (route, options) => {
    if (options?.method && fails) throw Object.assign(new Error('Quantity exceeds stock'), { status: 409 });
    return route === '/cart' ? [] : {};
  });
  const event = { target: { closest: () => button } };
  await state.events.click(event);
  const message = button.parentElement.children[0];
  assert.match(message.textContent, /stock/);
  fails = false;
  await state.events.click(event);
  assert.equal(message.textContent, '');
});
test('admin form submits its revision, preserves a stale draft and saves a freshly loaded form', async () => {
  const target = element(), message = element(), button = element(), toggle = element();
  const form = element({ '[type="submit"]': button });
  const fields = ['name', 'description', 'price', 'stock', 'size', 'color', 'category_id'];
  form.elements = Object.fromEntries(fields.map(key => [key, { value: '', focus() {} }]));
  form.querySelector = selector => selector === '[type="submit"]' ? button : form.elements.name;
  form.hidden = true; form.scrollIntoView = () => {};
  form.reset = () => fields.forEach(key => { form.elements[key].value = ''; });
  const root = element({ '[data-admin-product-list]': target, '[data-admin-message]': message,
    '[data-product-form]': form, '[data-toggle-product-form]': toggle,
    '[data-category-select]': element(), '[data-cancel-product-form]': element() });
  let revision = 'old-revision', stock = 10, submitted;
  const api = async (route, options) => {
    if (options?.method === 'PUT') {
      submitted = options.body;
      if (submitted.get('revision') !== revision) throw Object.assign(new Error('Stale'), { status: 409 });
      return {};
    }
    if (route === '/products') return [{ id: 1, name: 'Product', price: '12.34', stock, revision }];
    return route === '/cart' || route === '/categories' ? [] : {};
  };
  class ProductFormData extends Map {
    constructor(value) { super(fields.map(key => [key, value.elements[key].value])); }
  }
  store({ '[data-admin-products]': root }, api, ProductFormData);
  const edit = { dataset: { editProduct: '1', revision, name: 'Product', price: '12.34', stock: '10',
    description: '', size: '', color: '', category: '' } };
  const event = { target: { closest: selector => selector === '[data-edit-product]' ? edit : null } };
  await target.listeners.click(event);
  form.elements.name.value = 'My draft';
  stock = 9; revision = 'new-revision';
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(submitted.get('revision'), 'old-revision');
  assert.equal(form.elements.name.value, 'My draft');
  assert.equal(form.hidden, false);
  assert.match(message.textContent, /tồn kho đã thay đổi/);
  assert.match(target.innerHTML, /Còn 9 món/);
  edit.dataset.revision = revision; edit.dataset.stock = '9';
  await target.listeners.click(event);
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(submitted.get('revision'), 'new-revision');
  assert.equal(submitted.get('stock'), '9');
  assert.equal(form.hidden, true);
  assert.match(message.textContent, /Đã cập nhật/);
});
test('password UI sends the change then redirects to a login notice; failure keeps the form usable', async () => {
  for (const success of [true, false]) {
    const message = element(), button = element();
    const form = element({ '[data-password-message]': message, 'button[type="submit"]': button });
    form.reset = () => {};
    const profile = element({ '[data-password-change-form]': form, '[data-profile-message]': element(),
      '[data-profile-name]': element(), '[data-profile-email]': element(), '[data-profile-created]': element(),
      '.profile-loading': element(), '.profile-content': element() });
    const context = { window: { MocApi: { request: async (route, options) => {
      if (options && !success) throw new Error('Current password is incorrect');
      return route === '/cart' ? [] : {};
    } } }, document: { querySelector: s => s === '[data-profile-page]' ? profile : s === '#cart-count' ? element() : null,
      addEventListener() {} }, location: { assign(url) { context.destination = url; } },
      FormData: class { entries() { return [['currentPassword', 'old'], ['newPassword', 'new']]; } } };
    vm.runInNewContext(storeSource, context);
    await form.listeners.submit({ preventDefault() {} });
    assert.equal(context.destination, success ? '/login?reason=password-changed' : undefined);
    assert.match(message.textContent, success ? /đăng nhập lại/ : /incorrect/);
    assert.equal(button.disabled, false);
  }
});
