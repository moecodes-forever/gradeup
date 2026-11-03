// GradeUp Genesis sync endpoint for Vercel: /api/sync
// Reads a student's own Genesis gradebook for MP1-MP4 during this request only.
// Credentials, cookies, and raw HTML are never persisted or returned.

const HOST = 'https://parents.sbschools.org';
const GENESIS_ORIGIN = new URL(HOST).origin;

class CookieJar {
  constructor() { this.cookies = new Map(); }

  add(response) {
    let lines = [];
    if (typeof response.headers.getSetCookie === 'function') {
      lines = response.headers.getSetCookie();
    } else {
      const one = response.headers.get('set-cookie');
      if (one) lines = [one];
    }

    for (const line of lines) {
      const pair = String(line).split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) {
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  header() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

async function requestGenesis(jar, url, options = {}) {
  let target = new URL(url);
  let opts = { ...options };

  for (let hop = 0; hop < 8; hop++) {
    if (target.origin !== GENESIS_ORIGIN) {
      throw new Error('Genesis redirected outside the district portal.');
    }

    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 GradeUp',
      ...(opts.headers || {})
    };
    const cookie = jar.header();
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(target.href, {
      ...opts,
      headers,
      redirect: 'manual',
      cache: 'no-store'
    });
    jar.add(response);

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      target = new URL(location, target);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && opts.method === 'POST')) {
        opts = {};
      }
      continue;
    }
    return response;
  }

  throw new Error('Genesis returned too many redirects.');
}

function decodeEntities(value) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const hex = code[1].toLowerCase() === 'x';
      const number = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : all;
    }
    return Object.prototype.hasOwnProperty.call(named, code.toLowerCase()) ? named[code.toLowerCase()] : all;
  });
}

// Small HTML tree reader for Genesis's server-rendered tables. Scripts/styles are
// discarded first so JavaScript strings cannot be mistaken for page markup.
function parseHTML(source) {
  const html = String(source || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const root = { tag: '#root', attrs: {}, children: [], parent: null, text: '' };
  const stack = [root];
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let match;

  while ((match = tokens.exec(html))) {
    const token = match[0];
    if (token.startsWith('<!--') || /^<!/i.test(token)) continue;

    if (/^<\//.test(token)) {
      const closing = token.match(/^<\/\s*([\w:-]+)/);
      if (!closing) continue;
      const tag = closing[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (token[0] === '<') {
      const opening = token.match(/^<\s*([\w:-]+)/);
      if (!opening) continue;
      const tag = opening[1].toLowerCase();
      const attrText = token.slice(opening[0].length).replace(/\/?>\s*$/, '');
      const attrs = {};
      const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attr;
      while ((attr = attrPattern.exec(attrText))) {
        const key = attr[1].toLowerCase();
        attrs[key] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      const node = { tag, attrs, children: [], parent: stack[stack.length - 1], text: '' };
      node.parent.children.push(node);
      if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
      continue;
    }

    stack[stack.length - 1].children.push({
      tag: '#text', attrs: {}, children: [], parent: stack[stack.length - 1], text: decodeEntities(token)
    });
  }
  return root;
}

function descendants(node, predicate) {
  const out = [];
  const walk = current => {
    for (const child of current.children || []) {
      if (predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  return (node.children || []).map(textContent).join(' ');
}

function cleanText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

function closest(node, tag) {
  for (let current = node; current; current = current.parent) {
    if (current.tag === tag) return current;
  }
  return null;
}

function directChildren(node, tag) {
  return (node?.children || []).filter(child => child.tag === tag);
}

function parseNumber(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parsePercent(value) {
  const match = String(value || '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function parseGradeSummary(html) {
  const root = parseHTML(html);
  const clickNodes = descendants(root, node =>
    node.attrs && /goToCourseSummary\s*\(/i.test(node.attrs.onclick || '')
  );
  const byKey = new Map();

  for (const node of clickNodes) {
    const call = (node.attrs.onclick || '').match(/goToCourseSummary\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/i);
    if (!call) continue;
    const [, code, section] = call;
    const key = `${code}:${section}`;
    const value = cleanText(node);
    if (!value) continue;

    let course = byKey.get(key);
    if (!course) {
      course = { id: key, code, section, name: '', teacher: '', summaryGrade: null };
      byKey.set(key, course);
    }

    const gradeMatch = value.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|\([A-F][+-]?\))?/i);
    const isGradeOnly = gradeMatch && /^\s*\d{1,3}(?:\.\d+)?\s*(?:%|\([A-F][+-]?\))?\s*$/i.test(value);
    if (isGradeOnly) {
      if (course.summaryGrade === null) course.summaryGrade = Number(gradeMatch[1]);
    } else if (!course.name) {
      course.name = value;
      let card = node;
      while (card && !(card.tag === 'div' && /^Course:/i.test(card.attrs['aria-label'] || ''))) card = card.parent;
      if (card) {
        const teacherNode = descendants(card, child => child.tag === 'div' && /font-style\s*:\s*oblique/i.test(child.attrs.style || ''))[0];
        if (teacherNode) course.teacher = cleanText(teacherNode);
      }
    }
  }

  return Array.from(byKey.values()).filter(course => course.name);
}

function parseCourseOptions(html) {
  const root = parseHTML(html);
  const select = descendants(root, node => node.tag === 'select' && node.attrs.id === 'fldCourse')[0];
  if (!select) return [];
  return descendants(select, node => node.tag === 'option').map(option => {
    const value = option.attrs.value || '';
    const split = value.split(':');
    if (split.length !== 2 || !split[0] || !split[1]) return null;
    return { code: split[0], section: split[1], name: cleanText(option) };
  }).filter(Boolean);
}

function parseMarkingPeriods(html) {
  const root = parseHTML(html);
  const select = descendants(root, node => node.tag === 'select' && node.attrs.id === 'fldSwitchMP')[0];
  if (!select) return [];
  return descendants(select, node => node.tag === 'option')
    .map(option => ({
      id: option.attrs.value || '',
      label: cleanText(option),
      selected: Object.prototype.hasOwnProperty.call(option.attrs, 'selected')
    }))
    .filter(period => /^MP\d+$/i.test(period.id));
}

function tableRows(table) {
  if (!table) return [];
  return descendants(table, node => node.tag === 'tr' && closest(node, 'table') === table &&
    /(?:^|\s)listrow(?:even|odd)(?:\s|$)/i.test(node.attrs.class || '')
  );
}

function rowCells(row) {
  return directChildren(row, 'td');
}

function parseCategories(root) {
  const heading = descendants(root, node => node.tag === 'b' && /^Grading Information$/i.test(cleanText(node)))[0];
  const table = heading ? closest(heading, 'table') : null;
  if (!table) return [];

  return tableRows(table).map(row => {
    const cells = rowCells(row);
    if (cells.length < 3) return null;
    const bold = descendants(cells[0], node => node.tag === 'b')[0];
    const name = cleanText(bold || cells[0]);
    const weight = parsePercent(cleanText(cells[1]));
    const average = parsePercent(cleanText(cells[2]));
    if (!name || weight === null) return null;
    return { name, weight, average };
  }).filter(Boolean);
}

function parseAssignments(root) {
  const heading = descendants(root, node => node.tag === 'b' && /^Assignments$/i.test(cleanText(node)))[0];
  const table = heading ? closest(heading, 'table') : null;
  if (!table) return [];

  return tableRows(table).map(row => {
    const cells = rowCells(row);
    if (cells.length < 3) return null;
    const assignmentCell = cells[1];
    const categoryNode = descendants(assignmentCell, node => node.tag === 'div' &&
      /font-size\s*:\s*8pt/i.test(node.attrs.style || '') && /font-style\s*:\s*italic/i.test(node.attrs.style || '')
    )[0];
    const boldNodes = descendants(assignmentCell, node => node.tag === 'b');
    const name = boldNodes.length ? cleanText(boldNodes[boldNodes.length - 1]) : '';
    const category = categoryNode ? cleanText(categoryNode) : '';
    const gradeText = cleanText(cells[2]);
    const ratio = gradeText.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
    const statusMatch = gradeText.match(/\b(Missing|Incomplete|Exempt|Absent|M|I|E|A)\b/i);

    if (!name) return null;
    return {
      name,
      category,
      due: cleanText(cells[0]),
      earned: ratio ? Number(ratio[1]) : null,
      possible: ratio ? Number(ratio[2]) : null,
      percentage: parsePercent(gradeText),
      status: statusMatch ? statusMatch[1].toUpperCase() : '',
      gradeText
    };
  }).filter(Boolean);
}

function parseCourseSummary(html, periodId) {
  const root = parseHTML(html);
  const pageText = cleanText(root);
  const gradeMatch = pageText.match(/Marking\s+Period\s+\d+\s+Grade\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%/i);
  const gradeLetterMatch = pageText.match(/Marking\s+Period\s+\d+\s+Grade\s*:\s*\d{1,3}(?:\.\d+)?\s*%\s*([A-F][+-]?)/i);
  const postedMatch = pageText.match(/Last\s+grade\s+posted\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);

  return {
    period: periodId,
    grade: gradeMatch ? Number(gradeMatch[1]) : null,
    letter: gradeLetterMatch ? gradeLetterMatch[1].toUpperCase() : '',
    categories: parseCategories(root),
    assignments: parseAssignments(root),
    lastPosted: postedMatch ? postedMatch[1].trim() : ''
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function courseSummaryUrl(studentId, course, periodId) {
  const params = new URLSearchParams({
    tab1: 'studentdata',
    tab2: 'gradebook',
    tab3: 'coursesummary',
    studentid: String(studentId),
    action: 'form',
    courseCode: course.code,
    courseSection: course.section,
    mp: periodId
  });
  return `${HOST}/genesis/parents?${params.toString()}`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { u, p } = body || {};
  if (!u || !p || String(u).length > 100 || String(p).length > 200) {
    return res.status(400).json({ error: 'Enter your Genesis username and password.' });
  }

  try {
    const jar = new CookieJar();
    await requestGenesis(jar, `${HOST}/genesis/sis/view?gohome=true`);

    const loginResponse = await requestGenesis(jar, `${HOST}/genesis/sis/j_security_check?parents=Y`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: HOST,
        Referer: `${HOST}/genesis/sis/view?gohome=true`
      },
      body: new URLSearchParams({
        idTokenString: '',
        j_username: String(u).trim().toLowerCase(),
        j_password: String(p)
      }).toString()
    });

    let landingHtml = await loginResponse.text();
    let studentMatch = landingHtml.match(/[?&]studentid=(\d+)/i) || landingHtml.match(/studentid\s*[=:]\s*["']?(\d+)/i);
    if (!studentMatch) {
      const parents = await requestGenesis(jar, `${HOST}/genesis/parents`);
      landingHtml = await parents.text();
      studentMatch = landingHtml.match(/[?&]studentid=(\d+)/i) || landingHtml.match(/studentid\s*[=:]\s*["']?(\d+)/i);
    }
    if (!studentMatch || /name=["']j_password/i.test(landingHtml)) {
      return res.status(401).json({ error: 'Genesis login failed. Check your username and password.' });
    }

    const studentId = studentMatch[1];
    const gradeSummaryUrl = `${HOST}/genesis/parents?${new URLSearchParams({
      tab1: 'studentdata', tab2: 'gradebook', tab3: 'weeklysummary',
      studentid: studentId, action: 'form', mpToView: 'MP1'
    }).toString()}`;
    const gradeResponse = await requestGenesis(jar, gradeSummaryUrl);
    if (!gradeResponse.ok) throw new Error('Could not open the Genesis Grade Summary.');
    const gradeHtml = await gradeResponse.text();

    let courses = parseGradeSummary(gradeHtml);
    if (!courses.length) throw new Error('Could not identify courses in the Genesis Grade Summary.');
    if (courses.length > 50) throw new Error('The course list was larger than expected.');

    // The first Course Summary reveals the actual marking-period dropdown and the
    // student's course dropdown. Its response is reused instead of fetched twice.
    // Start with a course that has a posted overall grade when possible. Some
    // students may have a non-graded course in the summary that is not present
    // in the Course Summary dropdown.
    const firstCourse = courses.find(course => course.summaryGrade !== null) || courses[0];
    const firstPeriodResponse = await requestGenesis(jar, courseSummaryUrl(studentId, firstCourse, 'MP1'));
    if (!firstPeriodResponse.ok) throw new Error('Could not open the first Genesis Course Summary.');
    const firstHtml = await firstPeriodResponse.text();
    const markingPeriods = parseMarkingPeriods(firstHtml);
    if (!markingPeriods.length) throw new Error('Could not read the marking-period options from Genesis.');

    const known = new Set(courses.map(course => `${course.code}:${course.section}`));
    for (const option of parseCourseOptions(firstHtml)) {
      const key = `${option.code}:${option.section}`;
      if (!known.has(key)) {
        known.add(key);
        courses.push({ id: key, code: option.code, section: option.section, name: option.name, teacher: '', summaryGrade: null });
      }
    }

    const periodIds = markingPeriods.map(period => period.id);
    const first = parseCourseSummary(firstHtml, 'MP1');
    const results = {};
    results[`${firstCourse.code}:${firstCourse.section}:MP1`] = first;

    const jobs = [];
    for (const course of courses) {
      for (const periodId of periodIds) {
        if (course.code === firstCourse.code && course.section === firstCourse.section && periodId === 'MP1') continue;
        jobs.push({ course, periodId });
      }
    }

    const scanned = await mapLimit(jobs, 4, async job => {
      const key = `${job.course.code}:${job.course.section}:${job.periodId}`;
      try {
        const response = await requestGenesis(jar, courseSummaryUrl(studentId, job.course, job.periodId));
        if (!response.ok) {
          results[key] = { period: job.periodId, grade: null, letter: '', categories: [], assignments: [], lastPosted: '', unavailable: true };
          return;
        }
        const html = await response.text();
        results[key] = parseCourseSummary(html, job.periodId);
      } catch {
        results[key] = { period: job.periodId, grade: null, letter: '', categories: [], assignments: [], lastPosted: '', unavailable: true };
      }
    });

    const outputCourses = courses.map(course => {
      const periods = {};
      for (const periodId of periodIds) {
        periods[periodId] = results[`${course.code}:${course.section}:${periodId}`] || {
          period: periodId, grade: null, letter: '', categories: [], assignments: [], lastPosted: '', unavailable: true
        };
      }
      return {
        id: course.id,
        code: course.code,
        section: course.section,
        name: course.name,
        teacher: course.teacher,
        summaryGrade: course.summaryGrade,
        periods
      };
    });

    return res.status(200).json({
      success: true,
      markingPeriods: markingPeriods.map(period => ({ id: period.id, label: period.label })),
      classes: outputCourses
    });
  } catch (error) {
    // Do not return raw Genesis HTML, credentials, cookies, student IDs, or trace data.
    return res.status(502).json({ error: 'GradeUp could not finish syncing Genesis. Please try again later.' });
  }
};

// Export parser helpers for local syntax/fixture tests; the HTTP handler remains the default export.
module.exports.__test = { parseGradeSummary, parseMarkingPeriods, parseCourseSummary, parseCourseOptions };
