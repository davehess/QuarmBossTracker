// test/minidump-review.test.js — reading a Zeal minidump well enough to tell a
// raider what broke, with no symbol server and no npm dependency.
//
// WHY THIS EXISTS: crash_reason.txt for Razek's 2026-08-12 crash said, in full,
// "0x6ef in kernelbase.dll". Nobody can act on that. The minidump in the same
// zip named the audio stack, the exact playback device, and a graphics driver
// that had reset four times in under six minutes. The design doc had listed
// dump reading as out of scope because symbolication needs symbols — true for
// function names, wrong for "which subsystem", which is the question people ask.
//
// The fixtures here are SYNTHETIC minidumps built byte by byte, because the real
// dump is 1.1 MB of somebody's process memory and does not belong in the repo.
// Every offset asserted below is a real MINIDUMP struct offset; two of them
// (MINIDUMP_THREAD's stack descriptor, MINIDUMP_UNLOADED_MODULE's name RVA) were
// off by 8 and 4 in the first cut and produced confident nonsense, which is
// exactly what these pin.
//
// Run: npx vitest run test/minidump-review.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
// Each end marker is the literal's OWN terminator. Using a generic '\n}' here
// silently swallowed everything up to the next function and produced a syntax
// error rather than a wrong answer — worth the specificity.
const block =
  sliceBlock(src, 'const MD_STREAM = {', 'MISC_INFO: 15 };') +
  sliceBlock(src, 'const MD_CODES = {', '\n};') +
  sliceBlock(src, 'const MD_SUBSYSTEMS = [', '\n];') +
  sliceBlock(src, 'function _mdSubsystem', '\n}') +
  sliceBlock(src, 'function _readMinidump', '\n}') +
  sliceBlock(src, 'function _crashVerdict', '\n}');
// eslint-disable-next-line no-new-func
const { _readMinidump, _crashVerdict, _mdSubsystem } = new Function(
  block + '\nreturn { _readMinidump, _crashVerdict, _mdSubsystem };',
)();

// --- a minimal but structurally real minidump builder ----------------------
// Layout: header, stream directory, then each stream's payload. Everything is
// little-endian and RVAs are absolute file offsets, same as the real format.
function buildDump({ modules = [], exception = null, stack = [], esp = 0x1000,
                     unloaded = [], createdDelta = 0, endpointStr = null, oddAlign = false } = {}) {
  const chunks = [];
  let cursor = 0;
  const put = (b) => { const rva = cursor; chunks.push(b); cursor += b.length; return rva; };
  const pad = () => { while (cursor % 4) put(Buffer.alloc(1)); };

  const header = Buffer.alloc(32);
  header.write('MDMP', 0, 'ascii');
  header.writeUInt32LE(0xa793, 4);                 // version
  const written = 1_800_000_100;
  header.writeUInt32LE(written, 20);               // TimeDateStamp
  put(header);

  const streams = [];                              // {type, rva, size}
  const dirRva = cursor;
  const STREAM_COUNT = 5;
  put(Buffer.alloc(STREAM_COUNT * 12));            // reserve the directory

  const mdString = (s) => {
    const u = Buffer.from(s, 'utf16le');
    const b = Buffer.alloc(4 + u.length + 2);
    b.writeUInt32LE(u.length, 0);
    u.copy(b, 4);
    return put(b);
  };

  // MODULE_LIST (4): count + N * 108-byte MINIDUMP_MODULE
  const nameRvas = modules.map(m => mdString(m.name));
  pad();
  const modRva = cursor;
  const modBuf = Buffer.alloc(4 + modules.length * 108);
  modBuf.writeUInt32LE(modules.length, 0);
  modules.forEach((m, i) => {
    const o = 4 + i * 108;
    modBuf.writeUInt32LE(m.base, o);               // BaseOfImage (low 32 of 64)
    modBuf.writeUInt32LE(m.size, o + 8);           // SizeOfImage
    modBuf.writeUInt32LE(nameRvas[i], o + 20);     // ModuleNameRva
    modBuf.writeUInt32LE(0x00060002, o + 32);      // VS_FIXEDFILEINFO FileVersionMS
    modBuf.writeUInt32LE(0x65f40000, o + 36);      //                  FileVersionLS
  });
  put(modBuf);
  streams.push({ type: 4, rva: modRva, size: modBuf.length });

  // stack memory, then THREAD_LIST (3): 48-byte MINIDUMP_THREAD
  pad();
  const stackBytes = Buffer.alloc(stack.length * 4);
  stack.forEach((v, i) => stackBytes.writeUInt32LE(v >>> 0, i * 4));
  const stackRva = put(stackBytes);
  pad();
  const thrRva = cursor;
  const thrBuf = Buffer.alloc(4 + 48);
  thrBuf.writeUInt32LE(1, 0);
  thrBuf.writeUInt32LE(0x1234, 4);                 // ThreadId
  thrBuf.writeUInt32LE(esp, 4 + 24);               // Stack.StartOfMemoryRange
  thrBuf.writeUInt32LE(stackBytes.length, 4 + 32); // Stack.Memory.DataSize
  thrBuf.writeUInt32LE(stackRva, 4 + 36);          // Stack.Memory.Rva
  put(thrBuf);
  streams.push({ type: 3, rva: thrRva, size: thrBuf.length });

  // EXCEPTION (6): tid, alignment, MINIDUMP_EXCEPTION(152), context location
  pad();
  const ctxRva = put(Buffer.alloc(716));           // x86 CONTEXT
  chunks[chunks.length - 1].writeUInt32LE(esp, 196); // CONTEXT.Esp
  pad();
  const exRva = cursor;
  const exBuf = Buffer.alloc(8 + 152 + 8);
  exBuf.writeUInt32LE(0x1234, 0);                  // ThreadId
  if (exception) {
    exBuf.writeUInt32LE(exception.code >>> 0, 8);        // ExceptionCode
    exBuf.writeUInt32LE(exception.flags || 0, 12);       // ExceptionFlags
    exBuf.writeUInt32LE(exception.address >>> 0, 8 + 16); // ExceptionAddress
  }
  exBuf.writeUInt32LE(716, 8 + 152);               // ThreadContext.DataSize
  exBuf.writeUInt32LE(ctxRva, 8 + 156);            // ThreadContext.Rva
  put(exBuf);
  streams.push({ type: 6, rva: exRva, size: exBuf.length });

  // UNLOADED_MODULES (14): header/entry/count then 24-byte entries
  const unlRvas = unloaded.map(n => mdString(n));
  pad();
  const unlRva = cursor;
  const unlBuf = Buffer.alloc(12 + unloaded.length * 24);
  unlBuf.writeUInt32LE(12, 0);
  unlBuf.writeUInt32LE(24, 4);
  unlBuf.writeUInt32LE(unloaded.length, 8);
  unloaded.forEach((_, i) => unlBuf.writeUInt32LE(unlRvas[i], 12 + i * 24 + 20)); // ModuleNameRva
  put(unlBuf);
  streams.push({ type: 14, rva: unlRva, size: unlBuf.length });

  // MISC_INFO (15)
  pad();
  const miscRva = cursor;
  const misc = Buffer.alloc(24);
  misc.writeUInt32LE(24, 0);
  misc.writeUInt32LE(written - createdDelta, 12);  // ProcessCreateTime
  put(misc);
  streams.push({ type: 15, rva: miscRva, size: misc.length });

  // `oddAlign` shifts the endpoint strings onto an ODD byte offset, which is
  // where they really sat in the dump this was modelled on. A reader that
  // decodes the buffer as utf16le from offset 0 only sees even-aligned strings
  // and finds nothing here — silently, which is how it shipped the first time.
  if (endpointStr) {
    if (oddAlign && cursor % 2 === 0) put(Buffer.alloc(1));
    put(Buffer.from(endpointStr, 'utf16le'));
  }

  const out = Buffer.concat(chunks);
  out.writeUInt32LE(streams.length, 8);
  out.writeUInt32LE(dirRva, 12);
  streams.forEach((s, i) => {
    const o = dirRva + i * 12;
    out.writeUInt32LE(s.type, o);
    out.writeUInt32LE(s.size, o + 4);
    out.writeUInt32LE(s.rva, o + 8);
  });
  return out;
}

const AUDIO_MODULES = [
  { name: 'eqgame.exe',    base: 0x00400000, size: 0x0453000 },
  { name: 'Zeal.asi',      base: 0x51fd0000, size: 0x0b16000 },
  { name: 'mss32.dll',     base: 0x21100000, size: 0x005f000 },
  { name: 'winmmbase.dll', base: 0x541e0000, size: 0x0026000 },
  { name: 'wdmaud2.drv',   base: 0x54160000, size: 0x001e000 },
  { name: 'rpcrt4.dll',    base: 0x75c60000, size: 0x00bc000 },
  { name: 'KERNELBASE.dll', base: 0x76360000, size: 0x0200000 },
];

// The real crash: RaiseException in KERNELBASE, stack dominated by the audio
// shim under RPC, with Zeal loaded but absent.
const razekish = () => buildDump({
  modules: AUDIO_MODULES,
  exception: { code: 0x6ef, flags: 1, address: 0x764c9f54 },
  esp: 0x1000,
  stack: [
    0x764c9f54,                                    // KERNELBASE (RaiseException)
    0x75c75569, 0x75c75506, 0x75cb57a9,            // rpcrt4
    0x54162543, 0x54162536, 0x54162710, 0x5416249a, 0x5416265e,  // wdmaud2 x5
    0x541ed96a, 0x541f3b7b,                        // winmmbase
    0x211179bd,                                    // mss32
    0x0054e92f, 0x004d4eb3,                        // eqgame
  ],
  unloaded: ['nvd3dum.dll', 'nvd3dum.dll', 'nvd3dum.dll', 'nvgpucomp32.dll', 'D3D11.DLL'],
  createdDelta: 340,                               // 5m40s of process life
  endpointStr: 'x:{0.0.0.00000000}.{9f0d0636-5fdf-4de9-b052-834835a41ca2}:wodMessage:0'
             + ' y:{0.0.1.00000000}.{8220f162-a788-4e8c-95ab-c47c9acaaa66}:widMessage:0',
  oddAlign: true,        // as they really were — see buildDump
});

describe('_readMinidump — structure', () => {
  it('rejects anything that is not a minidump instead of throwing', () => {
    expect(_readMinidump(null)).toBeNull();
    expect(_readMinidump(Buffer.alloc(4))).toBeNull();
    expect(_readMinidump(Buffer.from('not a dump at all, really'))).toBeNull();
    expect(_readMinidump(Buffer.concat([Buffer.from('MDMP'), Buffer.alloc(200)]))).not.toBeUndefined();
  });

  it('reads the module list with base, size and version', () => {
    const d = _readMinidump(razekish());
    expect(d.modules).toHaveLength(AUDIO_MODULES.length);
    const zeal = d.modules.find(m => m.name === 'Zeal.asi');
    expect(zeal.base).toBe(0x51fd0000);
    expect(zeal.version).toBe('6.2.26100.0');
  });

  it('resolves the faulting address to its module', () => {
    const d = _readMinidump(razekish());
    expect(d.exception.module).toBe('KERNELBASE.dll');
    expect(d.exception.code_hex).toBe('0x6ef');
    expect(d.exception.noncontinuable).toBe(true);
    expect(d.exception.plain).toMatch(/already gone away/);
  });

  it('scan-walks the crashing thread and counts who is on the stack', () => {
    const d = _readMinidump(razekish());
    // MINIDUMP_THREAD's stack descriptor sits at +24/+32/+36, not +16/+24/+32 —
    // the off-by-8 version read a garbage length and found nothing.
    expect(d.onStack.get('wdmaud2.drv')).toBe(5);
    expect(d.onStack.get('rpcrt4.dll')).toBe(3);
    expect(d.onStack.has('Zeal.asi')).toBe(false);
  });

  it('counts repeated unloads, reading the name RVA at +20', () => {
    const d = _readMinidump(razekish());
    expect(d.unloaded.get('nvd3dum.dll')).toBe(3);
    expect(d.unloaded.get('D3D11.DLL')).toBe(1);
  });

  it('finds endpoints on an ODD byte alignment (the real dump had them there)', () => {
    // Same dump, both alignments — a single-alignment reader passes one and
    // silently returns [] for the other.
    for (const oddAlign of [false, true]) {
      const d = _readMinidump(buildDump({
        modules: AUDIO_MODULES, esp: 0x1000, stack: [0x764c9f54],
        exception: { code: 0x6ef, flags: 1, address: 0x764c9f54 },
        endpointStr: 'q:{0.0.0.00000000}.{9f0d0636-5fdf-4de9-b052-834835a41ca2}:wodMessage:0',
        oddAlign,
      }));
      expect(d.endpoints, `oddAlign=${oddAlign}`).toHaveLength(1);
    }
  });

  it('recovers process uptime and the audio endpoints', () => {
    const d = _readMinidump(razekish());
    expect(d.uptimeSec).toBe(340);
    const play = d.endpoints.find(e => e.flow === 'playback');
    expect(play.guid).toBe('9f0d0636-5fdf-4de9-b052-834835a41ca2');
    expect(play.call).toBe('wodMessage');
    expect(d.endpoints.filter(e => e.flow === 'capture')).toHaveLength(1);
  });
});

describe('_mdSubsystem', () => {
  it('maps modules to something a raider recognises', () => {
    expect(_mdSubsystem('Zeal.asi')).toBe('Zeal');
    expect(_mdSubsystem('wdmaud2.drv')).toBe('Windows audio');
    expect(_mdSubsystem('mss32.dll')).toBe('the game audio engine');
    expect(_mdSubsystem('nvd3dum.dll')).toBe('the graphics driver');
    expect(_mdSubsystem('eqgame.exe')).toBe('the EverQuest client');
    expect(_mdSubsystem('somethingelse.dll')).toBeNull();
  });
});

describe('_crashVerdict', () => {
  it('names the audio stack and clears Zeal when Zeal is loaded but absent', () => {
    const v = _crashVerdict({ game_state: 'ff' }, _readMinidump(razekish()));
    expect(v.subsystem).toBe('Windows audio');
    expect(v.blames_us).toBe(false);
    expect(v.notes.join(' ')).toMatch(/NOT involved/);
    expect(v.notes.join(' ')).toMatch(/sound problem/);
    expect(v.notes.join(' ')).toMatch(/zoning/);
  });

  it('hands over the exact registry lookup for the playback device', () => {
    const v = _crashVerdict(null, _readMinidump(razekish()));
    const checks = v.checks.join('\n');
    expect(checks).toMatch(/MMDevices\\Audio\\Render\\\{9f0d0636-5fdf-4de9-b052-834835a41ca2\}/);
    expect(checks).toMatch(/a45c254e-df1c-4efd-8020-67d146a850e0/);
  });

  it('surfaces graphics-driver churn with the time window', () => {
    const v = _crashVerdict(null, _readMinidump(razekish()));
    expect(v.notes.join(' ')).toMatch(/graphics driver reset itself several times in 6 minutes/);
    expect(v.checks.join(' ')).toMatch(/windowed or borderless/);
  });

  it('DOES implicate Zeal when Zeal is actually on the stack', () => {
    const d = _readMinidump(buildDump({
      modules: AUDIO_MODULES,
      exception: { code: 0xc0000005, flags: 0, address: 0x51fd1234 },
      esp: 0x1000,
      stack: [0x51fd1234, 0x51fd5678, 0x51fd9abc, 0x0054e92f],
    }));
    const v = _crashVerdict(null, d);
    expect(v.blames_us).toBe(true);
    expect(v.subsystem).toBe('Zeal');
    expect(v.notes.join(' ')).toMatch(/may be involved/);
  });

  it('says so plainly when there is no readable dump', () => {
    const v = _crashVerdict({ game_state: 'ff' }, null);
    expect(v.headline).toMatch(/Could not read the crash dump/);
    expect(v.blames_us).toBeNull();
  });

  it('never blames Zeal when Zeal was not even loaded', () => {
    const d = _readMinidump(buildDump({
      modules: AUDIO_MODULES.filter(m => m.name !== 'Zeal.asi'),
      exception: { code: 0xc0000005, flags: 0, address: 0x00401000 },
      esp: 0x1000,
      stack: [0x00401000, 0x0054e92f],
    }));
    const v = _crashVerdict(null, d);
    expect(v.blames_us).toBeNull();               // unknown, NOT false
    expect(v.notes.join(' ')).not.toMatch(/Zeal/);
  });
});
