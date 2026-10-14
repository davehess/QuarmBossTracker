// test/_tray-menu-harness.js — builds Mimic's REAL tray menu template under stubs.
//
// buildTrayMenu (apps/mimic/main.js) is sliced out of the source and run with every free identifier
// answered by a stub, so the test sees the template Electron would be handed — labels, order,
// checkbox state, and each click handler — without booting Electron. Not a spec file.
//
// How the stubbing works: the block runs inside `with (env)`, where `env` claims every name that is
// not a real JS global. A name with an explicit stub gets it; any other name becomes a function
// whose identity is its name, so `click: openSettings` is observable as "ref:openSettings" and a
// swapped handler shows up as a different reference.

export const START = 'function _sortOverlayMenuItems(menu) {';
export const END = '  tray.setToolTip(tooltipFor(s));\n}';

function refStub(name) {
  const f = function () {};
  Object.defineProperty(f, 'name', { value: name });
  f.__ref = name;
  return f;
}

// flag=true turns every boolean setting on, flag=false off — a checkbox bound to the wrong setting
// (or bound to nothing) shows up as a difference between the two scenarios.
export function scenario({ platform = 'win32', version = '2.7.7', localOnly = false, agentOnly = false,
  flag = true, updatePending = null, uninstaller = true } = {}) {
  const status = new Proxy({
    agentPort: 7777, localOnly, runMode: agentOnly ? 'agent' : 'full', tellsMode: 'local',
    tellsDmPausedUntil: 0, mapMode: 'window',
  }, { get: (t, k) => (k in t ? t[k] : flag) });
  const cfg = new Proxy({ runMode: agentOnly ? 'agent' : 'full' }, { get: (t, k) => (k in t ? t[k] : flag) });
  return { platform, version, status, cfg, agentOnly, updatePending, uninstaller, flag };
}

export function buildTemplate(src, sc) {
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('tray harness: buildTrayMenu block not found');
  const block = src.slice(a, b + END.length);
  let captured = null;
  const explicit = {
    process: { platform: sc.platform },
    Menu: { buildFromTemplate: (t) => { captured = t; return t; } },
    tray: { setToolTip() {}, setContextMenu() {} },
    app: { getVersion: () => sc.version },
    currentStatus: () => sc.status,
    _agentOnly: () => sc.agentOnly,
    loadConfig: () => sc.cfg,
    updatePending: sc.updatePending,
    autoUpdater: { quitAndInstall() {} },
    _dockedKeys: () => [],
    _charProfileTrayItems: () => [],
    _damageAlertHotkeyLabelNow: () => 'Ctrl+Shift+D',
    _hideAllHotkeyMenuLabel: () => 'Ctrl+Shift+H',
    _fmtPauseClock: () => '9:00',
    _uninstallerPath: () => (sc.uninstaller ? 'C:\\uninstall.exe' : null),
    _updateTrack: () => (sc.flag ? 'alpha' : 'stable'),
    tooltipFor: () => 'tip',
    _canvasArrange: false,
    setupMode: false,
    _hideAllActive: false,
  };
  const globals = new Set(Object.getOwnPropertyNames(globalThis));
  const env = new Proxy({}, {
    has: (_, k) => typeof k === 'string' && (k in explicit || !globals.has(k)) && k !== 'arguments',
    get: (_, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in explicit) return explicit[k];
      return refStub(String(k));
    },
  });
  // eslint-disable-next-line no-new-func
  const run = new Function('__env', `with (__env) {\n${block}\nreturn buildTrayMenu;\n}`);
  run(env)();
  if (!captured) throw new Error('tray harness: buildTrayMenu never called Menu.buildFromTemplate');
  return captured;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// One comparable record per item. `click` is the stub's name for a bare reference (`click: openSettings`)
// and the whitespace-normalised source for an inline handler.
export function describe(item) {
  const r = { label: item.label };
  for (const k of ['type', 'checked', 'enabled', 'visible', 'accelerator']) if (item[k] !== undefined) r[k] = item[k];
  if (item.submenu) r.submenu = true;
  if (typeof item.click === 'function') r.click = item.click.__ref ? 'ref:' + item.click.__ref : norm(item.click.toString());
  return r;
}

// Every non-separator item at any depth, as comparable JSON strings (sorted: only position changed).
export function flatten(template) {
  const out = [];
  const walk = (items) => {
    for (const it of items) {
      if (!it || it.type === 'separator') continue;
      out.push(JSON.stringify(describe(it)));
      if (Array.isArray(it.submenu)) walk(it.submenu);
    }
  };
  walk(template);
  return out.sort();
}

export const SCENARIOS = {
  'win32 full, stable, flags on': () => scenario({}),
  'win32 full, flags off': () => scenario({ flag: false }),
  'win32 beta build, local only, update pending, no uninstaller': () =>
    scenario({ version: '3.0.0-beta.4', localOnly: true, flag: false, updatePending: { version: '9.9.9' }, uninstaller: false }),
  'win32 agent only': () => scenario({ agentOnly: true }),
  'linux full': () => scenario({ platform: 'linux' }),
};
