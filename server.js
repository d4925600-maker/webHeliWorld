const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'site-data.json');
const sessions = new Map();
const loginAttempts = new Map();
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const serverStatusPresets = new Set(['maintenance', 'offline', 'online', 'development']);
const defaultServerStatus = { type: 'preset', value: 'development' };
const defaultRules = 'В разработке';
const defaultDonationSettings = { accepting: false, issuing: false };
const defaultDonationPackages = [
  { id: 'scout', name: 'Путник', price: 99, description: 'Первый шаг в большую политику', perks: ['Цветной префикс', 'Особый набор эмодзи'], accent: 'mint' },
  { id: 'mayor', name: 'Градоначальник', price: 249, description: 'Для тех, кто строит города', perks: ['Дополнительные слоты города'], accent: 'blue' }
];

function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadEnv();

function saveData(data) {
  return fs.promises.mkdir(dataDir, { recursive: true }).then(async () => {
    const temporary = `${dataFile}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.promises.rename(temporary, dataFile);
  });
}

async function readData() {
  try {
    const data = JSON.parse(await fs.promises.readFile(dataFile, 'utf8'));
    data.serverStatus ||= defaultServerStatus;
    data.rules ||= defaultRules;
    data.packages ||= defaultDonationPackages;
    data.donationSettings ||= defaultDonationSettings;
    data.orders ||= [];
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const username = process.env.DEVELOPER_USERNAME;
    const password = process.env.DEVELOPER_PASSWORD;
    if (!username || !password) throw new Error('Для первого запуска задайте DEVELOPER_USERNAME и DEVELOPER_PASSWORD в .env.');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const data = {
      users: [{ id: crypto.randomUUID(), username, salt, passwordHash, role: 'developer', rank: 'Разработчик', createdAt: new Date().toISOString() }],
      serverStatus: defaultServerStatus,
      rules: defaultRules,
      packages: defaultDonationPackages,
      donationSettings: defaultDonationSettings,
      orders: []
    };
    await saveData(data);
    return data;
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 32_768) reject(Object.assign(new Error('Запрос слишком большой.'), { status: 413 }));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Некорректный JSON.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function safeUser(user) {
  return { id: user.id, username: user.username, role: user.role, rank: user.rank, createdAt: user.createdAt };
}

function getSession(request, data) {
  const cookie = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('heli_session='));
  const token = cookie?.slice('heli_session='.length);
  return { token, user: data.users.find(entry => entry.id === sessions.get(token)) };
}

function isAdmin(user) {
  return user && ['developer', 'admin'].includes(user.role);
}

function validUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(username);
}

function sessionCookie(token, request) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  return `heli_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`;
}

async function handleApi(request, response, url) {
  const data = await readData();
  const { user, token } = getSession(request, data);
  const route = url.pathname;

  if (route === '/api/state' && request.method === 'GET') {
    return sendJson(response, 200, {
      user: user ? safeUser(user) : null,
      serverStatus: data.serverStatus || defaultServerStatus,
      rules: data.rules || defaultRules,
      donationPackages: data.packages || defaultDonationPackages,
      donationSettings: data.donationSettings || defaultDonationSettings,
      donationOrders: user ? data.orders.filter(order => order.userId === user.id) : []
    });
  }

  if (route === '/api/register' && request.method === 'POST') {
    const body = await readBody(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!validUsername(username)) return sendJson(response, 400, { error: 'Ник должен содержать 3–16 латинских букв, цифр или знаков _.' });
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return sendJson(response, 400, { error: 'Пароль должен содержать от 8 до 128 символов.' });
    if (data.users.some(account => account.username.toLowerCase() === username.toLowerCase())) return sendJson(response, 409, { error: 'Этот ник уже зарегистрирован.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(body.password, salt, 64)).toString('hex');
    const newUser = { id: crypto.randomUUID(), username, salt, passwordHash, role: 'player', rank: 'Игрок', createdAt: new Date().toISOString() };
    data.users.push(newUser);
    await saveData(data);
    const newToken = crypto.randomBytes(32).toString('hex');
    sessions.set(newToken, newUser.id);
    return sendJson(response, 201, { user: safeUser(newUser) }, { 'Set-Cookie': sessionCookie(newToken, request) });
  }

  if (route === '/api/login' && request.method === 'POST') {
    const address = request.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(address) || { count: 0, until: Date.now() + 60_000 };
    if (Date.now() > attempt.until) { attempt.count = 0; attempt.until = Date.now() + 60_000; }
    if (attempt.count >= 10) return sendJson(response, 429, { error: 'Слишком много попыток. Попробуйте через минуту.' });
    const body = await readBody(request);
    const account = data.users.find(entry => entry.username.toLowerCase() === String(body.username || '').trim().toLowerCase());
    const candidate = account ? (await scrypt(String(body.password || ''), account.salt, 64)).toString('hex') : '';
    const matches = account && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(account.passwordHash, 'hex'));
    if (!matches) {
      attempt.count += 1;
      loginAttempts.set(address, attempt);
      return sendJson(response, 401, { error: 'Неверный ник или пароль.' });
    }
    loginAttempts.delete(address);
    const newToken = crypto.randomBytes(32).toString('hex');
    sessions.set(newToken, account.id);
    return sendJson(response, 200, { user: safeUser(account) }, { 'Set-Cookie': sessionCookie(newToken, request) });
  }

  if (route === '/api/logout' && request.method === 'POST') {
    if (token) sessions.delete(token);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'heli_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (route === '/api/donations' && request.method === 'POST') {
    if (!user) return sendJson(response, 401, { error: 'Войди или зарегистрируйся, чтобы оставить заявку.' });
    if (!data.donationSettings?.accepting) return sendJson(response, 409, { error: 'Приём заявок на донат сейчас закрыт.' });
    const body = await readBody(request);
    const item = (data.packages || []).find(entry => entry.id === body.packageId);
    if (!item) return sendJson(response, 404, { error: 'Этот статус больше недоступен.' });
    const order = {
      id: crypto.randomUUID(), userId: user.id, username: user.username,
      packageId: item.id, packageName: item.name, amount: item.price,
      status: 'pending', createdAt: new Date().toISOString()
    };
    data.orders.unshift(order);
    await saveData(data);
    return sendJson(response, 201, { order });
  }

  if (!route.startsWith('/api/admin/')) return sendJson(response, 404, { error: 'Маршрут не найден.' });
  if (!isAdmin(user)) return sendJson(response, 403, { error: 'Доступ только для администраторов.' });

  if (route === '/api/admin/state' && request.method === 'GET') {
    return sendJson(response, 200, {
      users: data.users.map(safeUser),
      serverStatus: data.serverStatus || defaultServerStatus,
      rules: data.rules || defaultRules,
      donationSettings: data.donationSettings || defaultDonationSettings,
      packages: data.packages || defaultDonationPackages,
      orders: data.orders || []
    });
  }

  if (route === '/api/admin/donations/settings' && request.method === 'PUT') {
    const body = await readBody(request);
    if (typeof body.accepting !== 'boolean' || typeof body.issuing !== 'boolean') {
      return sendJson(response, 400, { error: 'Укажи состояние приёма заявок и выдачи статусов.' });
    }
    data.donationSettings = { accepting: body.accepting, issuing: body.issuing };
    await saveData(data);
    return sendJson(response, 200, { donationSettings: data.donationSettings });
  }

  if (route === '/api/admin/donations/packages' && request.method === 'PUT') {
    const body = await readBody(request);
    if (!Array.isArray(body.packages) || body.packages.length < 1 || body.packages.length > 12) {
      return sendJson(response, 400, { error: 'Добавь от одного до двенадцати статусов.' });
    }
    const ids = new Set();
    const packages = [];
    for (const entry of body.packages) {
      if (!/^[a-z0-9_-]{1,32}$/.test(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 40 || !Number.isInteger(Number(entry.price)) || Number(entry.price) < 0 || Number(entry.price) > 1_000_000) {
        return sendJson(response, 400, { error: 'Проверь уникальный ID, название и цену каждого статуса.' });
      }
      ids.add(entry.id);
      packages.push({
        id: entry.id,
        name: entry.name.trim(),
        price: Number(entry.price),
        description: String(entry.description || '').slice(0, 120),
        perks: Array.isArray(entry.perks) ? entry.perks.slice(0, 5).map(perk => String(perk).slice(0, 60)) : [],
        accent: ['mint', 'blue', 'gold'].includes(entry.accent) ? entry.accent : 'mint'
      });
    }
    data.packages = packages;
    await saveData(data);
    return sendJson(response, 200, { packages: data.packages });
  }

  const donationOrderMatch = route.match(/^\/api\/admin\/donations\/orders\/([0-9a-f-]+)\/issue$/i);
  if (donationOrderMatch && request.method === 'POST') {
    if (!data.donationSettings?.issuing) return sendJson(response, 409, { error: 'Выдача донат-статусов закрыта.' });
    const order = data.orders.find(entry => entry.id === donationOrderMatch[1]);
    if (!order || order.status !== 'pending') return sendJson(response, 404, { error: 'Заявка не найдена или уже обработана.' });
    const target = data.users.find(account => account.id === order.userId);
    if (!target) return sendJson(response, 404, { error: 'Аккаунт игрока не найден.' });
    order.status = 'completed';
    order.approvedBy = user.username;
    order.issuedAt = new Date().toISOString();
    target.rank = order.packageName;
    await saveData(data);
    return sendJson(response, 200, { order, user: safeUser(target) });
  }

  if (route === '/api/admin/settings' && request.method === 'PUT') {
    const body = await readBody(request);
    const status = body.serverStatus;
    if (!status || !['preset', 'custom'].includes(status.type)) {
      return sendJson(response, 400, { error: 'Выберите готовый статус или укажите свой.' });
    }
    if (status.type === 'preset' && !serverStatusPresets.has(status.value)) {
      return sendJson(response, 400, { error: 'Неизвестный статус сервера.' });
    }
    const customStatus = typeof status.value === 'string' ? status.value.trim() : '';
    if (status.type === 'custom' && (!customStatus || customStatus.length > 40)) {
      return sendJson(response, 400, { error: 'Свой статус должен содержать от 1 до 40 символов.' });
    }
    if (typeof body.rules !== 'string' || body.rules.length > 12000) {
      return sendJson(response, 400, { error: 'Правила должны быть текстом не длиннее 12 000 символов.' });
    }
    data.serverStatus = { type: status.type, value: status.type === 'custom' ? customStatus : status.value };
    data.rules = body.rules.trim() || defaultRules;
    await saveData(data);
    return sendJson(response, 200, { serverStatus: data.serverStatus, rules: data.rules });
  }

  if (route === '/api/admin/users' && request.method === 'PUT') {
    if (user.role !== 'developer') return sendJson(response, 403, { error: 'Только разработчик может менять доступ администраторов.' });
    const body = await readBody(request);
    const target = data.users.find(account => account.id === body.userId);
    if (!target || target.role === 'developer' || !['admin', 'player'].includes(body.role)) return sendJson(response, 400, { error: 'Нельзя изменить эту роль.' });
    target.role = body.role;
    await saveData(data);
    return sendJson(response, 200, { user: safeUser(target) });
  }

  return sendJson(response, 404, { error: 'Маршрут не найден.' });
}

async function serveStatic(request, response, url) {
  let requested;
  try { requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); }
  catch { return sendJson(response, 400, { error: 'Некорректный путь.' }); }
  const file = path.resolve(publicDir, `.${requested}`);
  if (!file.startsWith(`${publicDir}${path.sep}`)) return sendJson(response, 403, { error: 'Доступ запрещён.' });
  try {
    const contents = await fs.promises.readFile(file);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(contents);
  } catch (error) {
    sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Файл не найден.' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else if (['GET', 'HEAD'].includes(request.method)) await serveStatic(request, response, url);
    else sendJson(response, 405, { error: 'Метод не поддерживается.' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'Внутренняя ошибка сервера.' });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`HeliWorld доступен: http://localhost:${port}`));