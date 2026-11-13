const byId = id => document.getElementById(id);
const root = document.documentElement;
const modal = byId('account-modal');
const toast = byId('toast');
const authForm = byId('auth-form');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let state = { user: null, donationPackages: [], donationSettings: { accepting: false, issuing: false }, donationOrders: [] };
let authMode = 'login';
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');
  return result;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2900);
}

function observeReveals() {
  const elements = document.querySelectorAll('.reveal:not([data-observed])');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    elements.forEach(element => element.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  elements.forEach((element, index) => {
    element.dataset.observed = 'true';
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(element);
  });
}

function roleLabel(role) {
  return ({ developer: 'Разработчик', admin: 'Администратор', player: 'Игрок' })[role] || 'Игрок';
}

function renderProjectSettings() {
  const presets = { maintenance: 'Тех-Работы', offline: 'Оффлайн', online: 'Онлайн', development: 'В разработке' };
  const status = state.serverStatus || { type: 'preset', value: 'development' };
  const statusDisplay = byId('server-status-display');
  statusDisplay.dataset.status = status.type === 'custom' ? 'custom' : status.value;
  byId('server-status-label').textContent = status.type === 'custom' ? status.value : (presets[status.value] || 'В разработке');
  byId('rules-content').textContent = state.rules || 'В разработке';
  renderDonation();
}

function renderDonation() {
  const settings = state.donationSettings || { accepting: false, issuing: false };
  const acceptance = byId('donation-acceptance');
  const issuance = byId('donation-issuance');
  acceptance.dataset.open = String(settings.accepting);
  issuance.dataset.open = String(settings.issuing);
  acceptance.textContent = settings.accepting ? 'Приём заявок открыт' : 'Приём заявок закрыт';
  issuance.textContent = settings.issuing ? 'Выдача статусов открыта' : 'Выдача закрыта';
  const container = byId('donation-grid');
  const packages = state.donationPackages || [];
  if (!packages.length) {
    container.innerHTML = '<div class="loading-line">Тарифы пока не настроены.</div>';
    return;
  }
  container.innerHTML = packages.map((item, index) => `<article class="donation-package reveal" data-accent="${escapeHtml(item.accent || 'mint')}"><span class="package-label">СТАТУС / 0${index + 1}</span><h3>${escapeHtml(item.name)}</h3><p class="package-description">${escapeHtml(item.description || '')}</p><ul class="package-perks">${(item.perks || []).map(perk => `<li>${escapeHtml(perk)}</li>`).join('')}</ul><div class="package-footer"><strong class="package-price">${Number(item.price)}<small>₽</small></strong><button class="button button-primary donation-request" type="button" data-donation-package="${escapeHtml(item.id)}" ${settings.accepting ? '' : 'disabled'}>${settings.accepting ? 'Оставить заявку' : 'Приём закрыт'}</button></div></article>`).join('');
  observeReveals();
}

function renderAccount() {
  const accountArea = byId('account-area');
  const adminArea = byId('admin-area');
  const accountTrigger = byId('account-trigger');
  if (!state.user) {
    accountArea.hidden = true;
    adminArea.hidden = true;
    accountTrigger.textContent = 'Личный кабинет';
    return;
  }
  accountArea.hidden = false;
  accountTrigger.textContent = state.user.username;
  byId('account-title').textContent = state.user.username.toUpperCase();
  const orders = (state.donationOrders || []).map(order => `<div class="order-row"><span>${escapeHtml(order.packageName)} · ${Number(order.amount)} ₽</span><span class="order-status ${order.status === 'completed' ? 'completed' : ''}">${order.status === 'completed' ? 'Статус выдан' : 'Заявка ожидает обработки'}</span></div>`).join('');
  byId('account-content').innerHTML = `<div class="profile-strip"><strong>${escapeHtml(state.user.username)}</strong><span class="profile-role">${escapeHtml(roleLabel(state.user.role))}</span><span class="profile-stat">С нами с ${new Date(state.user.createdAt).toLocaleDateString('ru-RU')}</span></div>${orders ? `<div class="order-list">${orders}</div>` : ''}`;
  adminArea.hidden = !['developer', 'admin'].includes(state.user.role);
}

async function loadAdmin() {
  if (!state.user || !['developer', 'admin'].includes(state.user.role)) return;
  const admin = await api('/api/admin/state');
  const users = admin.users.map(account => {
    if (account.role === 'developer') return `<div class="admin-row"><span>${escapeHtml(account.username)}<small>Разработчик</small></span><span class="profile-role">Владелец</span></div>`;
    const controls = state.user.role === 'developer'
      ? `<select aria-label="Роль ${escapeHtml(account.username)}" data-user-id="${escapeHtml(account.id)}"><option value="player" ${account.role === 'player' ? 'selected' : ''}>Игрок</option><option value="admin" ${account.role === 'admin' ? 'selected' : ''}>Администратор</option></select><button type="button" data-role-save="${escapeHtml(account.id)}">Сохранить</button>`
      : `<span class="profile-role">${escapeHtml(roleLabel(account.role))}</span>`;
    return `<div class="admin-row"><span>${escapeHtml(account.username)}<small>${escapeHtml(account.rank)}</small></span>${controls}</div>`;
  }).join('');
  const status = admin.serverStatus || { type: 'preset', value: 'development' };
  const selectedStatus = status.type === 'custom' ? 'custom' : status.value;
  const customStatus = status.type === 'custom' ? status.value : '';
  const donationSettings = admin.donationSettings || { accepting: false, issuing: false };
  const packageRows = admin.packages.map((item, index) => `<div class="donation-admin-package" data-package-row="${escapeHtml(item.id)}" data-accent="${escapeHtml(item.accent || 'mint')}"><span class="package-label">СТАТУС / 0${index + 1}</span><input class="admin-input" data-package-field="name" aria-label="Название тарифа" maxlength="40" value="${escapeHtml(item.name)}"><input class="admin-input" data-package-field="price" aria-label="Цена тарифа" type="number" min="0" max="1000000" value="${Number(item.price)}"><input class="admin-input" data-package-field="description" aria-label="Описание тарифа" maxlength="120" value="${escapeHtml(item.description || '')}"><input class="admin-input" data-package-field="perks" aria-label="Преимущества через точку с запятой" maxlength="300" value="${escapeHtml((item.perks || []).join('; '))}"><button class="text-button" type="button" data-package-remove="${escapeHtml(item.id)}">Удалить тариф</button></div>`).join('');
  const pendingOrders = (admin.orders || []).filter(order => order.status === 'pending');
  const orderRows = pendingOrders.length ? pendingOrders.map(order => `<div class="admin-row"><span>${escapeHtml(order.username)} · ${escapeHtml(order.packageName)}<small>${Number(order.amount)} ₽ · ${new Date(order.createdAt).toLocaleDateString('ru-RU')}</small></span><button type="button" data-donation-issue="${escapeHtml(order.id)}" ${donationSettings.issuing ? '' : 'disabled'}>${donationSettings.issuing ? 'Подтвердить оплату и выдать' : 'Выдача закрыта'}</button></div>`).join('') : '<div class="empty-state">Ожидающих заявок нет.</div>';
  byId('admin-content').innerHTML = `<div class="admin-grid admin-grid-compact"><section class="admin-panel"><h3>Статус сервера</h3><label class="admin-label" for="server-status-select">Выбрать статус</label><select class="admin-input" id="server-status-select"><option value="maintenance" ${selectedStatus === 'maintenance' ? 'selected' : ''}>Тех-Работы</option><option value="offline" ${selectedStatus === 'offline' ? 'selected' : ''}>Оффлайн</option><option value="online" ${selectedStatus === 'online' ? 'selected' : ''}>Онлайн</option><option value="development" ${selectedStatus === 'development' ? 'selected' : ''}>В разработке</option><option value="custom" ${selectedStatus === 'custom' ? 'selected' : ''}>Свой статус</option></select><input class="admin-input custom-status-input" id="custom-server-status" type="text" maxlength="40" placeholder="Например: Скоро открытие" value="${escapeHtml(customStatus)}" ${selectedStatus !== 'custom' ? 'hidden' : ''}></section><section class="admin-panel"><h3>Правила проекта</h3><label class="admin-label" for="project-rules-input">Текст правил</label><textarea class="admin-input rules-editor" id="project-rules-input" maxlength="12000" rows="7">${escapeHtml(admin.rules || 'В разработке')}</textarea><button class="button button-primary admin-save" id="save-project-settings" type="button">Сохранить настройки</button></section><section class="admin-panel donation-admin"><h3>Донат: приём и выдача</h3><label class="admin-toggle"><input id="donation-accept-toggle" type="checkbox" ${donationSettings.accepting ? 'checked' : ''}><span>Приём заявок открыт</span></label><label class="admin-toggle"><input id="donation-issue-toggle" type="checkbox" ${donationSettings.issuing ? 'checked' : ''}><span>Выдача статусов открыта</span></label><button class="button button-primary admin-save" id="save-donation-settings" type="button">Сохранить переключатели</button><p class="admin-note">Оплату проверь вручную до подтверждения выдачи. Карточные данные сайт не принимает.</p></section><section class="admin-panel donation-admin"><h3>Тарифы доната</h3><div class="donation-admin-packages" id="donation-admin-packages">${packageRows}</div><button class="button button-quiet admin-save" id="add-donation-package" type="button">Добавить тариф +</button><button class="button button-primary admin-save" id="save-donation-packages" type="button">Сохранить тарифы</button></section><section class="admin-panel donation-admin"><h3>Заявки на донат</h3><div class="admin-list">${orderRows}</div></section><section class="admin-panel"><h3>Доступ администраторов</h3><div class="admin-list">${users || '<div class="empty-state">Аккаунтов пока нет.</div>'}</div><p class="admin-note">Новый администратор должен сначала зарегистрировать аккаунт на сайте.</p></section><section class="admin-panel"><h3>Память проекта</h3><div class="admin-row"><span>Аккаунты<small>Сохранены в постоянном хранилище</small></span><strong>${admin.users.length}</strong></div><div class="admin-row"><span>Файл данных<small>data/site-data.json</small></span><strong>OK</strong></div></section></div>`;
}

async function refreshState() {
  state = await api('/api/state');
  renderProjectSettings();
  renderAccount();
  if (state.user && ['developer', 'admin'].includes(state.user.role)) await loadAdmin();
}

function openModal() {
  if (state.user) {
    byId('account-area').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    return;
  }
  setAuthMode('login');
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => byId('auth-username').focus(), 80);
}

function closeModal() {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.mode === mode));
  const submit = authForm.querySelector('.auth-submit');
  byId('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  byId('auth-hint').textContent = mode === 'login' ? 'Войди, чтобы продолжить.' : 'Используй свой игровой ник. Пароль хранится в зашифрованном виде.';
  byId('auth-message').textContent = '';
  submit.innerHTML = mode === 'login' ? 'Войти <span>↗</span>' : 'Создать аккаунт <span>↗</span>';
}

byId('theme-toggle').addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('heli-theme', next);
  byId('theme-toggle').querySelector('.theme-glyph').textContent = next === 'dark' ? '☼' : '☾';
  document.querySelector('meta[name="theme-color"]').content = next === 'dark' ? '#090d0a' : '#f3f2e9';
  showToast(next === 'dark' ? 'Тёмная тема включена' : 'Светлая тема включена');
});

const savedTheme = localStorage.getItem('heli-theme');
if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
byId('theme-toggle').querySelector('.theme-glyph').textContent = root.dataset.theme === 'dark' ? '☼' : '☾';
byId('menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-open'));
document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => document.body.classList.remove('menu-open')));
byId('account-trigger').addEventListener('click', openModal);
byId('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('is-open')) closeModal(); });
document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)));

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = authForm.querySelector('.auth-submit');
  const message = byId('auth-message');
  const username = byId('auth-username').value.trim();
  const password = byId('auth-password').value;
  submit.disabled = true;
  submit.textContent = 'Подожди…';
  message.textContent = '';
  try {
    const result = await api(`/api/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', body: JSON.stringify({ username, password }) });
    state.user = result.user;
    await refreshState();
    closeModal();
    authForm.reset();
    showToast(authMode === 'login' ? `С возвращением, ${result.user.username}!` : 'Аккаунт создан. Добро пожаловать!');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    setAuthMode(authMode);
  }
});

document.addEventListener('click', async event => {
  const copyButton = event.target.closest('.copy-ip');
  if (copyButton) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      showToast('Адрес heliworld.mcsh.gg скопирован');
    } catch { showToast('Адрес сервера: heliworld.mcsh.gg'); }
    return;
  }
  const donationButton = event.target.closest('[data-donation-package]');
  if (donationButton) {
    if (!state.user) {
      openModal();
      showToast('Войди, чтобы оставить заявку на статус');
      return;
    }
    donationButton.disabled = true;
    try {
      await api('/api/donations', { method: 'POST', body: JSON.stringify({ packageId: donationButton.dataset.donationPackage }) });
      await refreshState();
      showToast('Заявка отправлена администрации');
    } catch (error) { showToast(error.message); }
    return;
  }
  const issueButton = event.target.closest('[data-donation-issue]');
  if (issueButton) {
    issueButton.disabled = true;
    try {
      await api(`/api/admin/donations/orders/${issueButton.dataset.donationIssue}/issue`, { method: 'POST', body: '{}' });
      await refreshState();
      showToast('Статус выдан');
    } catch (error) { showToast(error.message); }
    return;
  }
  const roleButton = event.target.closest('[data-role-save]');
  if (!roleButton) return;
  const select = document.querySelector(`select[data-user-id="${CSS.escape(roleButton.dataset.roleSave)}"]`);
  roleButton.disabled = true;
  try {
    await api('/api/admin/users', { method: 'PUT', body: JSON.stringify({ userId: roleButton.dataset.roleSave, role: select.value }) });
    await loadAdmin();
    showToast('Доступ обновлён');
  } catch (error) { showToast(error.message); }
});

byId('logout-button').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); state.user = null; renderAccount(); showToast('Ты вышел из аккаунта'); }
  catch (error) { showToast(error.message); }
});

byId('refresh-admin').addEventListener('click', async () => {
  try { await loadAdmin(); showToast('Данные панели обновлены'); }
  catch (error) { showToast(error.message); }
});

byId('admin-content').addEventListener('change', event => {
  if (event.target.id === 'server-status-select') {
    byId('custom-server-status').hidden = event.target.value !== 'custom';
  }
});

byId('admin-content').addEventListener('click', async event => {
  if (event.target.id === 'add-donation-package') {
    const id = `custom-${Date.now().toString(36)}`;
    byId('donation-admin-packages').insertAdjacentHTML('beforeend', `<div class="donation-admin-package" data-package-row="${id}" data-accent="mint"><span class="package-label">НОВЫЙ СТАТУС</span><input class="admin-input" data-package-field="name" aria-label="Название тарифа" maxlength="40" placeholder="Название"><input class="admin-input" data-package-field="price" aria-label="Цена тарифа" type="number" min="0" max="1000000" value="0"><input class="admin-input" data-package-field="description" aria-label="Описание тарифа" maxlength="120" placeholder="Описание"><input class="admin-input" data-package-field="perks" aria-label="Преимущества через точку с запятой" maxlength="300" placeholder="Преимущества через ;"><button class="text-button" type="button" data-package-remove="${id}">Удалить тариф</button></div>`);
    return;
  }
  const removePackage = event.target.closest('[data-package-remove]');
  if (removePackage) {
    removePackage.closest('[data-package-row]').remove();
    return;
  }
  if (event.target.id === 'save-donation-settings') {
    const button = event.target;
    button.disabled = true;
    try {
      await api('/api/admin/donations/settings', {
        method: 'PUT',
        body: JSON.stringify({
          accepting: byId('donation-accept-toggle').checked,
          issuing: byId('donation-issue-toggle').checked
        })
      });
      await refreshState();
      showToast('Приём и выдача настроены');
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  if (event.target.id === 'save-donation-packages') {
    const button = event.target;
    const packages = [...document.querySelectorAll('[data-package-row]')].map(row => ({
      id: row.dataset.packageRow,
      name: row.querySelector('[data-package-field="name"]').value.trim(),
      price: Number(row.querySelector('[data-package-field="price"]').value),
      description: row.querySelector('[data-package-field="description"]').value.trim(),
      perks: row.querySelector('[data-package-field="perks"]').value.split(';').map(perk => perk.trim()).filter(Boolean),
      accent: row.dataset.accent
    }));
    button.disabled = true;
    try {
      await api('/api/admin/donations/packages', { method: 'PUT', body: JSON.stringify({ packages }) });
      await refreshState();
      showToast('Тарифы сохранены');
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  if (event.target.id !== 'save-project-settings') return;
  const select = byId('server-status-select');
  const custom = select.value === 'custom';
  const button = event.target;
  button.disabled = true;
  try {
    const result = await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        serverStatus: { type: custom ? 'custom' : 'preset', value: custom ? byId('custom-server-status').value : select.value },
        rules: byId('project-rules-input').value
      })
    });
    state.serverStatus = result.serverStatus;
    state.rules = result.rules;
    renderProjectSettings();
    await loadAdmin();
    showToast('Статус и правила сохранены');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

async function init() {
  observeReveals();
  try { await refreshState(); }
  catch (error) { showToast(error.message); }
}

init();