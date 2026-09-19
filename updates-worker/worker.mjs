// api.ruzgaryazilim.com.tr
//   /updates/...   -> electron-updater icin (latest.yml, Setup exe, blockmap) — range destekli
//   /download/...  -> tarayici indirmesi icin (Setup + Portable) — Content-Disposition: attachment
//   /download/setup | /download/portable -> latest.yml'deki surume otomatik cozulur

const UPDATE_FILE = /^(?:latest(?:-mac)?\.yml|RuzgarDesk-.*?\.(?:exe(?:\.blockmap)?|zip|dmg))$/;
const DOWNLOAD_FILE = /^RuzgarDesk-.*?\.(?:exe|zip|dmg)$/;

function decodePath(pathname) {
  try { return decodeURIComponent(pathname); } catch (e) { return null; }
}

function stripPrefix(path, prefix) {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\//, '');
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// latest.yml icindeki "version: x.y.z" satirini okur
async function latestVersion(env) {
  const object = await env.UPDATES.get('latest.yml');
  if (!object) return null;
  const match = /^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m.exec(await object.text());
  return match ? match[1] : null;
}

async function resolveRequest(url, env) {
  const path = decodePath(url.pathname);
  if (path === null) return null;

  if (path === '/' || path === '') return null;

  // --- Tarayici indirmeleri ---
  if (path === '/download' || path.startsWith('/download/')) {
    const name = stripPrefix(path, '/download/');

    // Surumden bagimsiz kisayollar: /download/setup, /download/portable, /download/mac, /download/dmg
    const alias = /^(setup|portable|mac|mac-arm64|mac-x64|dmg)$/i.exec(name);
    if (alias) {
      const version = await latestVersion(env);
      if (!version) return null;
      const a = alias[1].toLowerCase();
      let key;
      if (a === 'setup') key = `RuzgarDesk-Setup-${version}.exe`;
      else if (a === 'portable') key = `RuzgarDesk-Portable-${version}.exe`;
      else if (a === 'mac-x64') key = `RuzgarDesk-${version}-x64.dmg`;
      else if (a === 'mac-arm64' || a === 'dmg' || a === 'mac') key = `RuzgarDesk-${version}-arm64.dmg`;
      else key = `RuzgarDesk-${version}-arm64.dmg`;
      return { key, attachment: true, immutable: false };
    }

    if (!DOWNLOAD_FILE.test(name)) return null;
    return { key: name, attachment: true, immutable: true };
  }

  // --- electron-updater ---
  const name = stripPrefix(path, '/updates/');
  if (!UPDATE_FILE.test(name)) return null;
  return { key: name, attachment: false, immutable: name !== 'latest.yml' };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const target = await resolveRequest(new URL(request.url), env);
    if (!target) return notFound();

    const rangeRequested = request.method === 'GET' && request.headers.has('range');
    const object = request.method === 'HEAD'
      ? await env.UPDATES.head(target.key)
      : await env.UPDATES.get(target.key, rangeRequested ? { range: request.headers } : undefined);
    if (!object) return notFound();

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition, ETag');

    if (target.key === 'latest.yml') {
      headers.set('Content-Type', 'text/yaml; charset=utf-8');
    } else {
      headers.set('Content-Type', 'application/octet-stream');
    }

    if (target.immutable) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    // Tarayicinin adrese gitmek yerine dosyayi indirmesini garantiler
    if (target.attachment) {
      headers.set('Content-Disposition', `attachment; filename="${target.key}"`);
      headers.set('X-Content-Type-Options', 'nosniff');
    }

    let status = 200;
    if (rangeRequested && object.range && Number.isInteger(object.range.offset) && Number.isInteger(object.range.length)) {
      const start = object.range.offset;
      const end = start + object.range.length - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      headers.set('Content-Length', String(object.range.length));
      status = 206;
    } else if (Number.isInteger(object.size)) {
      headers.set('Content-Length', String(object.size));
    }

    return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
  }
};
