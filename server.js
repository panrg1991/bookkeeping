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

const MAX_BODY_BYTES = 1e6;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(store.httpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object') throw new Error();
        resolve(parsed);
      } catch {
        reject(store.httpError(400, '请求体必须是合法的 JSON 对象'));
      }
    });
    req.on('error', reject);
  });
}

/** 归一化后判断目标文件是否确实位于 PUBLIC_DIR 内（避免前缀相同的兄弟目录绕过） */
function isInsidePublic(filePath) {
  const relative = path.relative(PUBLIC_DIR, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function serveStatic(res, pathname, method) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('请求路径不合法');
  }
  // 统一反斜杠，防止 Windows 下 %5c 绕过
  const relative = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  let filePath = path.resolve(PUBLIC_DIR, relative || 'index.html');

  if (!isInsidePublic(filePath)) {
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
    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);
    // HEAD 只返回响应头，不带响应体
    res.end(method === 'HEAD' ? undefined : data);
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
      return await serveStatic(res, pathname, method);
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

    // 每月支出预警额度
    if (pathname === '/api/budgets' && method === 'GET') {
      return sendJson(res, 200, store.getBudgets(year));
    }
    if (pathname === '/api/budgets' && method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, store.setBudget(body.month, body.amount));
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
    if (status >= 500) {
      // 内部错误只记录日志，不把细节返回给客户端（避免泄露路径 / SQL 等信息）
      console.error(`[error] ${method} ${pathname}`, err);
      return sendJson(res, 500, { message: '服务器内部错误' });
    }
    return sendJson(res, status, { message: err.message || '请求不合法' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('───────────────────────────────────────────────');
  console.log('  财务记账统计软件已启动');
  console.log(`  访问地址： http://${HOST}:${PORT}`);
  console.log(`  数据库文件： ${store.DB_PATH}`);
  console.log('───────────────────────────────────────────────');
});
