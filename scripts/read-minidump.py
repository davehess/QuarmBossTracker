#!/usr/bin/env python3
"""Read a Zeal crash minidump and say WHO was on the stack.

    python3 scripts/read-minidump.py path/to/minidump.dmp

`DESIGN-crash-review.md` §5 originally listed dump analysis as out of scope
because symbolication needs a symbol server. That is true for function names and
line numbers — and it turns out we do not need them. A minidump carries the
module list with base addresses and sizes, so any address resolves to
`module+offset` with no symbols at all, and *which module* is the question we
actually keep asking: is this Zeal, the client, or Windows?

Proven on Razek's 2026-08-12 dump, which this answered outright: the fault was
raised by `rpcrt4.dll` under `wdmaud2.drv` under `winmmbase.dll` under
`mss32.dll` — the audio stack — with `Zeal.asi` loaded but appearing nowhere on
the crashing thread. See `DESIGN-crash-review.md` §8.

Stdlib only, so it runs anywhere the agent runs. Reads nothing but the file
given to it and never phones home — this is the "review it locally without
uploading anything" half of the design.
"""
import datetime
import re
import struct
import sys

# Stream types we care about (MINIDUMP_STREAM_TYPE).
THREAD_LIST, MODULE_LIST, EXCEPTION_STREAM, SYSTEM_INFO = 3, 4, 6, 7
UNLOADED_MODULE_LIST, MISC_INFO = 14, 15
ARCH = {0: 'x86', 5: 'ARM', 6: 'IA64', 9: 'x64', 12: 'ARM64'}

# Windows raises these through RaiseException with no parameters and the
# NONCONTINUABLE flag, which is what an RPC stub failure looks like from here.
KNOWN_CODES = {
    0xC0000005: 'EXCEPTION_ACCESS_VIOLATION — read/write of a bad address',
    0xC0000094: 'EXCEPTION_INT_DIVIDE_BY_ZERO',
    0xC00000FD: 'EXCEPTION_STACK_OVERFLOW',
    0xC0000409: 'STATUS_STACK_BUFFER_OVERRUN — /GS or __fastfail',
    0xE06D7363: 'C++ exception (throw) that nobody caught',
    0x6EF:      'RPC_X_SS_IN_NULL_CONTEXT — an RPC call was made with a NULL '
                'context handle (the server-side object it referred to is gone)',
    0x6BA:      'RPC_S_SERVER_UNAVAILABLE',
    0x6BE:      'RPC_S_CALL_FAILED',
}


class Dump:
    def __init__(self, path):
        self.b = open(path, 'rb').read()
        sig, _ver, nstreams, dir_rva = struct.unpack_from('<IIII', self.b, 0)
        if sig != 0x504D444D:                      # 'MDMP'
            raise SystemExit(f'{path}: not a minidump (signature {sig:#x})')
        self.written = datetime.datetime.utcfromtimestamp(self.u32(20))
        self.streams = {}
        for i in range(nstreams):
            st, size, rva = struct.unpack_from('<III', self.b, dir_rva + i * 12)
            self.streams.setdefault(st, (size, rva))
        self.modules = self._modules()

    def u32(self, o): return struct.unpack_from('<I', self.b, o)[0]
    def u64(self, o): return struct.unpack_from('<Q', self.b, o)[0]

    def _string(self, rva):
        n = self.u32(rva)
        return self.b[rva + 4:rva + 4 + n].decode('utf-16-le', 'replace')

    def _modules(self):
        if MODULE_LIST not in self.streams:
            return []
        _, r = self.streams[MODULE_LIST]
        out = []
        for i in range(self.u32(r)):
            o = r + 4 + i * 108                    # sizeof(MINIDUMP_MODULE)
            base, size, name_rva = self.u64(o), self.u32(o + 8), self.u32(o + 20)
            ms, ls = struct.unpack_from('<II', self.b, o + 24 + 8)   # VS_FIXEDFILEINFO
            ver = f'{ms >> 16}.{ms & 0xffff}.{ls >> 16}.{ls & 0xffff}'
            out.append((base, size, self._string(name_rva), ver))
        return sorted(out)

    def whose(self, addr):
        """Resolve an address to module+offset, or None if it is not code."""
        for base, size, name, _ in self.modules:
            if base <= addr < base + size:
                return f'{name.rsplit(chr(92), 1)[-1]}+0x{addr - base:x}'
        return None


def main(path):
    d = Dump(path)
    print(f'{path}\n  written {d.written}Z   {len(d.modules)} modules loaded')

    if SYSTEM_INFO in d.streams:
        _, r = d.streams[SYSTEM_INFO]
        arch, _lvl, _rev, ncpu, _pt, maj, mnr, build = struct.unpack_from('<HHHBBIII', d.b, r)
        print(f'  {ARCH.get(arch, arch)}  Windows {maj}.{mnr} build {build}  {ncpu} cpu')

    crash_tid = esp = None
    if EXCEPTION_STREAM in d.streams:
        _, r = d.streams[EXCEPTION_STREAM]
        crash_tid = d.u32(r)
        er = r + 8                                 # MINIDUMP_EXCEPTION
        code, flags, _nested, addr = struct.unpack_from('<IIQQ', d.b, er)
        print(f'\nEXCEPTION  thread {crash_tid:#x}')
        print(f'  code    0x{code:x}  {KNOWN_CODES.get(code, "(not a well-known code)")}')
        print(f'  flags   0x{flags:x}' + ('  NONCONTINUABLE — the process could not survive this'
                                          if flags & 1 else ''))
        print(f'  at      0x{addr:x}  {d.whose(addr)}')
        ctx_size, ctx = struct.unpack_from('<II', d.b, er + 152)
        if ctx_size >= 204:                        # x86 CONTEXT
            esp = d.u32(ctx + 196)
            print(f'  eip     0x{d.u32(ctx + 184):08x}  {d.whose(d.u32(ctx + 184))}')
            print(f'  esp     0x{esp:08x}   ebp 0x{d.u32(ctx + 180):08x}   esi 0x{d.u32(ctx + 160):08x}')

    if THREAD_LIST not in d.streams or crash_tid is None:
        return
    _, r = d.streams[THREAD_LIST]
    stack = None
    for i in range(d.u32(r)):
        o = r + 4 + i * 48                         # sizeof(MINIDUMP_THREAD)
        if d.u32(o) == crash_tid:
            stack = (d.u64(o + 24), *struct.unpack_from('<II', d.b, o + 32))
    if not stack:
        return
    start, size, rva = stack

    # No unwind info and no symbols, so this is the classic scan walk: every
    # 4-byte value on the thread's stack that lands inside a loaded module's
    # range. It OVER-reports — stale frames from earlier calls linger — so read
    # it as "who was involved", not as an exact call sequence. It never invents
    # a module, though: each hit was a real pointer really on this stack.
    hits = []
    for off in range(0, size - 3, 4):
        at = start + off
        if esp and at < esp:
            continue
        w = d.whose(d.u32(rva + off))
        if w:
            hits.append((at, w))

    print(f'\nSTACK SCAN  {len(hits)} code pointers at/above esp'
          f'  ({size} bytes from 0x{start:x})')
    freq = {}
    for _, w in hits:
        m = w.split('+')[0]
        freq[m] = freq.get(m, 0) + 1
    print('\n  who is on this stack (most frames first):')
    for m, c in sorted(freq.items(), key=lambda kv: -kv[1]):
        print(f'    {c:5d}  {m}')
    print('\n  frames, innermost first:')
    for at, w in hits[:80]:
        print(f'    [0x{at:08x}]  {w}')

    unloaded(d)
    audio_endpoints(d)


def unloaded(d):
    """Modules that were loaded and then went away before the crash.

    Free system-health signal: on Razek's dump the NVIDIA user-mode driver
    stack (`nvd3dum`, `nvgpucomp32`, `nvldumd`, `NvMemMapStorage`) had cycled
    3-4 times in under six minutes of process life. That is the D3D device
    being destroyed and rebuilt over and over — and since the GPU driver also
    publishes the HDMI/DisplayPort *audio* endpoints, it is the most plausible
    reason an audio session handle went stale underneath the client.
    """
    if UNLOADED_MODULE_LIST not in d.streams:
        return
    _, r = d.streams[UNLOADED_MODULE_LIST]
    hdr, ent, cnt = struct.unpack_from('<III', d.b, r)
    if not cnt:
        return
    seen = {}
    for i in range(cnt):
        o = r + hdr + i * ent
        nm = d._string(d.u32(o + 20)).rsplit('\\', 1)[-1]   # NOT +16
        seen[nm] = seen.get(nm, 0) + 1
    print(f'\nUNLOADED MODULES ({cnt}) — loaded, then went away before the crash:')
    for nm, c in sorted(seen.items(), key=lambda kv: -kv[1]):
        flag = '   <-- cycling; a device was being rebuilt repeatedly' if c >= 3 else ''
        print(f'    {c}x  {nm}{flag}')


def audio_endpoints(d):
    """Windows audio endpoint ids left in memory by the wdmaud RPC binding.

    Format is `...:{0.0.<flow>.00000000}.{guid}:<call>:...` where flow 0 is
    render (playback) and 1 is capture. This is how a generic "the audio stack
    faulted" becomes "it faulted on THIS device" — and the guid resolves to a
    friendly name with one local registry read the user can do themselves:

      HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\
        Render\\{guid}\\Properties  ->  {a45c254e-df1c-4efd-8020-67d146a850e0},2
    """
    found = {}
    for s in re.findall(rb'(?:[\x20-\x7e]\x00){10,}', d.b):
        t = s.decode('utf-16-le', 'replace')
        m = re.search(r'\{0\.0\.(\d)\.0+\}\.\{([0-9a-f-]{36})\}:(\w+)', t)
        if m:
            flow = 'RENDER (playback)' if m.group(1) == '0' else 'CAPTURE (mic)'
            found[(flow, m.group(2))] = m.group(3)
    if not found:
        return
    print('\nAUDIO ENDPOINTS this process had open:')
    for (flow, guid), call in sorted(found.items()):
        print(f'    {flow:18s} {{{guid}}}  via {call}')
    print('    (resolve a guid: reg query "HKLM\\SOFTWARE\\Microsoft\\Windows'
          '\\CurrentVersion\\MMDevices\\Audio\\Render\\{<guid>}\\Properties")')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
