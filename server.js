'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const store = require('./db');

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(store.httpError(413, '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error();
        resolve(parsed);
      } catch {
        reject(store.httpError(400, '请求体必须是合法的 JSON 对象'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  let filePath = path.resolve(PUBLIC_DIR, relative || 'index.html');

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('禁止访问');
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('资源不存在');
    }
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('资源不存在');
  }
}

function currentYear() {
  return String(new Date().getFullYear());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = url;
  const method = req.method.toUpperCase();

  try {
    if (!pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('方法不允许');
      }
      return await serveStatic(res, pathname);
    }

    const year = searchParams.get('year') || currentYear();
    const month = searchParams.get('month') || 'all';

    // 记录列表
    if (pathname === '/api/records' && method === 'GET') {
      return sendJson(
        res,
        200,
        store.listRecords({
          year,
          month,
          day: searchParams.get('day'),
          type: searchParams.get('type'),
          category: searchParams.get('category'),
          keyword: searchParams.get('keyword'),
          limit: searchParams.get('limit'),
          offset: searchParams.get('offset'),
        })
      );
    }

    if (pathname === '/api/records' && method === 'POST') {
      const record = store.createRecord(await readJsonBody(req));
      return sendJson(res, 201, record);
    }

    const recordMatch = pathname.match(/^\/api\/records\/(\d+)$/);
    if (recordMatch) {
      const id = recordMatch[1];
      if (method === 'PUT') {
        return sendJson(res, 200, store.updateRecord(id, await readJsonBody(req)));
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, store.deleteRecord(id));
      }
      return sendJson(res, 405, { message: '方法不允许' });
    }

    // 统计接口
    if (pathname === '/api/summary/overview' && method === 'GET') {
      return sendJson(res, 200, store.overview(year, month));
    }
    if (pathname === '/api/summary/monthly' && method === 'GET') {
      return sendJson(res, 200, store.monthlySummary(year));
    }
    if (pathname === '/api/summary/daily' && method === 'GET') {
      return sendJson(res, 200, store.dailySummary(year, month));
    }
    if (pathname === '/api/summary/category' && method === 'GET') {
      return sendJson(res, 200, store.categorySummary(year, month, searchParams.get('type') || 'expense'));
    }

    // 分类
    if (pathname === '/api/categories' && method === 'GET') {
      return sendJson(res, 200, store.listCategories());
    }
    if (pathname === '/api/categories' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, store.addCategory(body.name, body.type));
    }

    // 批量导入
    if (pathname === '/api/import' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, store.importRecords(body.records));
    }

    // 元信息
    if (pathname === '/api/meta/years' && method === 'GET') {
      return sendJson(res, 200, store.years());
    }

    return sendJson(res, 404, { message: `接口不存在：${pathname}` });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    return sendJson(res, status, { message: err.message || '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('───────────────────────────────────────────────');
  console.log('  财务记账统计软件已启动');
  console.log(`  访问地址： http://${HOST}:${PORT}`);
  console.log(`  数据库文件： ${store.DB_PATH}`);
  console.log('───────────────────────────────────────────────');
});
