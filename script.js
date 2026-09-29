(() => {
  'use strict';

  const ORG = 'comm1t-club';
  const API = 'https://api.github.com';

  // Repos that are infrastructure, not projects.
  const EXCLUDED_REPOS = ['assets', `${ORG}.github.io`, '.github'];

  // The club roster shown on the site. Org membership is private for most
  // members, so the API can't list them for anonymous visitors; profiles are
  // refreshed live from the API when possible.
  const MEMBERS = [
    {
      login: 'ArnoldT01', name: 'Arnold', public_repos: 17,
      bio: 'Full-Stack Software Engineer | 3+ years exp | .NET | C# | Java ...',
      location: 'Pretoria, Gauteng, South Africa', blog: 'arnoldt01.github.io',
      avatar_url: 'https://avatars.githubusercontent.com/u/139617269?v=4',
    },
    {
      login: '01Syntax', name: 'Syntax', public_repos: 8, company: 'KwanTech Solutions',
      bio: 'Hi, I’m Kwanele Eugene Khumalo. I specialize in crafting efficient, scalable software solutions. From desktop apps to mobile and web apps.',
      avatar_url: 'https://avatars.githubusercontent.com/u/139629272?v=4',
    },
    {
      login: 'KayAugust', name: 'Kay_August', public_repos: 1,
      avatar_url: 'https://avatars.githubusercontent.com/u/139628872?v=4',
    },
  ];

  // Only public repos are ever shown; used when the API is unreachable.
  const FALLBACK_REPOS = [];

  const LANG_COLORS = {
    TypeScript: '#3178c6', JavaScript: '#f1e05a', HTML: '#e34c26', CSS: '#563d7c',
    SCSS: '#c6538c', Python: '#3572A5', Java: '#b07219', 'C#': '#178600',
    Go: '#00ADD8', Rust: '#dea584', C: '#555555', 'C++': '#f34b7d', Kotlin: '#A97BFF',
    Dart: '#00B4AB', Shell: '#89e051', PHP: '#4F5D95', Ruby: '#701516',
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const isMember = (login) => MEMBERS.some((m) => m.login.toLowerCase() === String(login).toLowerCase());

  // ---------- GitHub fetching (cached for an hour to spare the rate limit) ----------

  const CACHE_KEY = 'cc-cache-v1';
  const CACHE_TTL = 60 * 60 * 1000;

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && Date.now() - c.at < CACHE_TTL) return c;
    } catch (_) { /* storage unavailable */ }
    return null;
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), ...data })); } catch (_) { /* ignore */ }
  }

  async function gh(path) {
    const res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }

  async function loadMembers() {
    const members = await Promise.all(MEMBERS.map(async (m) => {
      try { return { ...m, ...(await gh(`/users/${m.login}`)) }; } catch (_) { return m; }
    }));
    return members.sort((a, b) => (b.public_repos || 0) - (a.public_repos || 0));
  }

  async function loadRepos() {
    const all = await gh(`/orgs/${ORG}/repos?per_page=100&sort=created&direction=asc`);
    const repos = all.filter((r) => !r.fork && !r.archived && !r.private && r.size > 0
      && !EXCLUDED_REPOS.includes(r.name.toLowerCase()));

    return Promise.all(repos.map(async (r) => {
      const [languages, contributors] = await Promise.all([
        gh(`/repos/${ORG}/${r.name}/languages`).catch(() => ({})),
        gh(`/repos/${ORG}/${r.name}/contributors?per_page=100`).catch(() => []),
      ]);
      return {
        name: r.name, description: r.description, html_url: r.html_url, homepage: r.homepage,
        language: r.language, stargazers_count: r.stargazers_count, forks_count: r.forks_count,
        size: r.size, created_at: r.created_at, pushed_at: r.pushed_at, languages,
        contributors: contributors.map((c) => c.login),
      };
    }));
  }

  async function loadData() {
    const cached = readCache();
    if (cached) return { ...cached, source: 'cache' };

    const [members, repos] = await Promise.all([
      loadMembers(),
      loadRepos().catch(() => null),
    ]);
    const data = { members, repos: repos || FALLBACK_REPOS };
    if (repos) writeCache(data);
    return { ...data, source: repos ? 'github' : 'offline' };
  }

  // ---------- rendering ----------

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function renderBoot(data) {
    const lines = [
      ['OK', 'Booting commit-club kernel 2026.09'],
      ['OK', `Mounted github.com/${ORG}`],
      ['OK', `Loaded ${data.members.length} members`],
      ['OK', `Indexed ${data.repos.length} project${data.repos.length === 1 ? '' : 's'}`],
      [data.source === 'offline' ? '!!' : 'OK', data.source === 'offline'
        ? 'GitHub API unreachable, using bundled snapshot'
        : `Data source: ${data.source === 'cache' ? 'local cache (≤1h old)' : 'live GitHub API'}`],
      ['OK', 'Ready.'],
    ];
    const el = $('#boot');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = 0;
    const tick = () => {
      if (i >= lines.length) return;
      const [status, msg] = lines[i++];
      el.insertAdjacentHTML('beforeend',
        `[ <span class="${status === 'OK' ? 'ok' : 'err'}">${status}</span> ] ${esc(msg)}\n`);
      if (reduce) tick(); else setTimeout(tick, 110);
    };
    tick();
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // A git-log style graph: one commit per project, newest first, on top of the club's root commit.
  function renderGraph(repos) {
    const newest = [...repos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const items = newest.map((r, i) => `<li>
        <span class="node"></span>
        <div class="msg">
          ${i === 0 ? '<span class="ref">HEAD → main</span>' : ''}<a href="#repo-${esc(r.name)}">feat: ${esc(r.name)}</a>
          <span class="sub">${[r.language, `created ${fmtDate(r.created_at)}`].filter(Boolean).map(esc).join(' · ')}</span>
        </div>
      </li>`);
    items.push(`<li class="root">
        <span class="node"></span>
        <div class="msg">
          ${repos.length ? '' : '<span class="ref">HEAD → main</span>'}init: commit club
          <span class="sub">github.com/${ORG}</span>
        </div>
      </li>`);
    $('#graph').innerHTML = items.join('');
  }

  function renderMembers(members) {
    $('#member-list').innerHTML = members.map((m) => {
      const extra = [m.company, m.location].filter(Boolean).map(esc).join(' · ');
      const bio = m.bio || extra
        ? `<p class="bio">${esc(m.bio || '')}${extra ? `<span>${extra}</span>` : ''}</p>` : '';
      return `<li class="member">
          <img src="${esc(m.avatar_url)}&s=96" alt="" loading="lazy">
          <div class="who">
            <a href="https://github.com/${esc(m.login)}" target="_blank" rel="noopener">${esc(m.name || m.login)}</a>
            <span class="handle">@${esc(m.login)}</span>
          </div>
          <div class="count">${m.public_repos ?? 0}<small>repos</small></div>
          ${bio}
        </li>`;
    }).join('');
  }

  function renderProjects(repos) {
    if (!repos.length) {
      $('#project-list').innerHTML = `<div class="empty">
          total 0<br>
          Nothing public yet. The next repo the club pushes shows up here automatically.
        </div>`;
      return;
    }
    $('#project-list').innerHTML = repos.map((r) => {
      const langs = Object.entries(r.languages || {});
      const total = langs.reduce((s, [, v]) => s + v, 0) || 1;
      const bar = langs.map(([l, v]) =>
        `<span style="width:${(v / total * 100).toFixed(2)}%;background:${LANG_COLORS[l] || '#888'}" title="${esc(l)}"></span>`).join('');
      const legend = langs.map(([l, v]) =>
        `<span><i style="background:${LANG_COLORS[l] || '#888'}"></i>${esc(l)} ${(v / total * 100).toFixed(1)}%</span>`).join('');
      const crew = (r.contributors || []).filter(isMember)
        .map((c) => `<a href="https://github.com/${esc(c)}" target="_blank" rel="noopener">@${esc(c)}</a>`).join(', ');
      return `<article class="project" id="repo-${esc(r.name)}">
          <h3><span class="perm">drwxr-xr-x</span><a href="${esc(r.html_url)}" target="_blank" rel="noopener">${esc(r.name)}/</a></h3>
          <p>${esc(r.description || 'No description yet.')}</p>
          ${langs.length ? `<div class="langbar">${bar}</div><div class="langs">${legend}</div>` : ''}
          <p class="meta">
            created <b>${fmtDate(r.created_at)}</b> · last push <b>${fmtDate(r.pushed_at)}</b>
            · <b>${r.stargazers_count}★</b>
            ${crew ? `<br>by ${crew}` : ''}
            ${r.homepage ? `<br><a href="${esc(r.homepage)}" target="_blank" rel="noopener">live demo →</a>` : ''}
          </p>
        </article>`;
    }).join('');
  }

  // Number keys 1-5 jump to sections, and the nav highlights the section in view.
  function initNav() {
    const links = [...document.querySelectorAll('nav a[data-key]')];
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      const link = links.find((a) => a.dataset.key === e.key);
      if (link) { e.preventDefault(); link.click(); }
    });
    const onScroll = () => {
      let current = links[0];
      for (const a of links) {
        const sec = document.querySelector(a.getAttribute('href'));
        if (sec && sec.getBoundingClientRect().top < window.innerHeight * 0.35) current = a;
      }
      links.forEach((a) => a.classList.toggle('active', a === current));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- terminal ----------

  function initTerminal(data) {
    const out = $('#term-out');
    const input = $('#term-input');
    const body = $('#term-body');
    const history = [];
    let hIdx = 0;

    const print = (text, cls = '') => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      div.innerHTML = text;
      out.appendChild(div);
      body.scrollTop = body.scrollHeight;
    };

    const LOGO = [
      '     ___ ___  __  __ __  __ _ _____ ',
      '    / __/ _ \\|  \\/  |  \\/  / |_   _|',
      '   | (_| (_) | |\\/| | |\\/| | | | |  ',
      '    \\___\\___/|_|  |_|_|  |_|_| |_|  ',
      '              c  l  u  b',
    ].join('\n');

    const commands = {
      help: () => [
        'available commands:',
        '  whoami          what is commit club?',
        '  members         list club members',
        '  projects | ls   list projects',
        '  open &lt;name&gt;     open a member or project on GitHub',
        '  logo            print the club logo',
        '  date            print the date',
        '  clear           clear the screen',
      ].join('\n'),
      whoami: () => 'Commit Club: a crew of developers who learn by building, one commit at a time.',
      members: () => data.members.map((m) => `  <a href="https://github.com/${esc(m.login)}" target="_blank" rel="noopener">@${esc(m.login).padEnd(12)}</a> ${esc(m.name || '')}`).join('\n'),
      projects: () => data.repos.length
        ? data.repos.map((r) => `  <a href="#repo-${esc(r.name)}">${esc(r.name)}/</a>  <span class="muted">${esc(r.language || '')}</span>`).join('\n')
        : 'no projects yet',
      ls: () => commands.projects(),
      logo: () => LOGO,
      date: () => new Date().toString(),
      clear: () => { out.innerHTML = ''; return null; },
      sudo: () => ['nice try. this incident will be reported.', 'err'],
      open: (arg) => {
        if (!arg) return ['usage: open &lt;member|project&gt;', 'err'];
        const a = arg.toLowerCase();
        const m = data.members.find((x) => x.login.toLowerCase() === a.replace(/^@/, ''));
        const r = data.repos.find((x) => x.name.toLowerCase() === a);
        const url = m ? `https://github.com/${m.login}` : r ? r.html_url : null;
        if (!url) return [`open: ${esc(arg)}: not found`, 'err'];
        window.open(url, '_blank', 'noopener');
        return `opening ${esc(url)} ...`;
      },
    };

    const run = (raw) => {
      const line = raw.trim();
      print(`<span class="prompt">guest@comm1t-club:~$</span> ${esc(line)}`, 'in');
      if (!line) return;
      history.push(line);
      hIdx = history.length;
      const [cmd, ...args] = line.split(/\s+/);
      const fn = commands[cmd.toLowerCase()];
      if (!fn) { print(`${esc(cmd)}: command not found. try <code>help</code>`, 'err'); return; }
      const res = fn(args.join(' '));
      if (res == null) return;
      Array.isArray(res) ? print(res[0], res[1]) : print(res);
    };

    $('#term-form').addEventListener('submit', (e) => {
      e.preventDefault();
      run(input.value);
      input.value = '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && hIdx > 0) { input.value = history[--hIdx]; e.preventDefault(); }
      if (e.key === 'ArrowDown') { hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ''; e.preventDefault(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const v = input.value.toLowerCase();
        const match = Object.keys(commands).find((c) => c.startsWith(v));
        if (v && match) input.value = match;
      }
    });
    body.addEventListener('click', () => { if (!window.getSelection().toString()) input.focus({ preventScroll: true }); });

    print(LOGO, 'logo');
    print('welcome, guest. type <code>help</code> to get started.');
  }

  // ---------- boot ----------

  function render(data) {
    renderBoot(data);
    renderGraph(data.repos);
    renderMembers(data.members);
    renderProjects(data.repos);
    $('#status-members').textContent = plural(data.members.length, 'member');
    $('#status-projects').textContent = plural(data.repos.length, 'project');
    initTerminal(data);
  }

  initNav();

  loadData()
    .catch(() => ({
      members: MEMBERS,
      repos: FALLBACK_REPOS,
      source: 'offline',
    }))
    .then(render);
})();
