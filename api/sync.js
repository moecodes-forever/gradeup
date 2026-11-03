// GradeUp login helper (Vercel function, served at /api/sync)
// Logs into Genesis for the user, reads the Grade Summary page, returns it. Stores nothing and logs nothing.

const HOST = 'https://parents.sbschools.org';

class Jar {
  constructor() { this.c = {}; }
  add(res) {
    for (const line of res.headers.getSetCookie()) {
      const kv = line.split(';')[0], i = kv.indexOf('=');
      if (i > 0) this.c[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
  }
  get() { return Object.entries(this.c).map(([k, v]) => k + '=' + v).join('; '); }
}

async function go(jar, url, opt = {}) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, {
      ...opt,
      redirect: 'manual',
      headers: { ...(opt.headers || {}), Cookie: jar.get(), 'User-Agent': 'Mozilla/5.0' }
    });
    jar.add(res);
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).href;
      opt = {};
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { u, p } = body || {};
  if (!u || !p || String(u).length > 100 || String(p).length > 200) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }

  try {
    const jar = new Jar();
    await go(jar, HOST + '/genesis/sis/view?gohome=true');
    await go(jar, HOST + '/genesis/sis/j_security_check?parents=Y', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': HOST,
        'Referer': HOST + '/genesis/sis/view?gohome=true'
      },
      body: new URLSearchParams({
        idTokenString: '',
        j_username: String(u).trim().toLowerCase(),
        j_password: p
      }).toString()
    });
    const home = await go(jar, HOST + '/genesis/sis/view?gohome=true');
    const m = (await home.text()).match(/studentid=(\d+)/);
    if (!m) return res.status(401).json({ error: 'Login failed. Check your username and password.' });
    const g = await go(jar, HOST + '/genesis/parents?tab1=studentdata&tab2=gradebook&tab3=weeklysummary&action=form&studentid=' + m[1]);
    return res.status(200).json({ html: await g.text() });
  } catch (e) {
    return res.status(502).json({ error: 'Couldn’t reach Genesis. Try again.' });
  }
};
