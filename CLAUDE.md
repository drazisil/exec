# x86 Emulator for Motor City Online

## CRITICAL: How to Run

```bash
# Native node TS execution (PREFERRED - no build step needed):
node run-exe.ts

# Or via npm script:
npm run run

# Electron app (requires build first):
npm run build && npm start
```

**DO NOT remove `"type": "module"` from package.json.**
**DO NOT change import extensions from `.ts` to `.js` in source files.**
The tsconfig uses `rewriteRelativeImportExtensions: true` to handle this for compiled output.

## Current Status

Emulator executes **~22,900+ instructions** through the MSVC CRT startup sequence
(mainCRTStartup). The CRT initialization is progressing through heap setup, string
functions, locale initialization, stdio setup, and more.

### Current Crash Point
```
Steps executed: 22929
EIP=0x22014197 (inside api-ms-win-core-synch-l1-1-0.dll)
Error: Unknown opcode 0xC5
```
This is IsBadReadPtr being called from the main exe's IAT, going into real KERNEL32
code. Being fixed by adding the IsBadReadPtr stub and many other CRT-critical stubs.

### Win32 API Stub System
Instead of executing real DLL code (which needs Windows kernel structures), we
intercept IAT calls via `INT 0xFE` trampolines at `0x00200000`. Each stub is a
JS function that reads args from the stack, sets EAX, and does stdcall/cdecl cleanup.

**~100+ stubs implemented** covering:
- CRT startup: GetVersion, GetCommandLineA/W, GetStartupInfoA, HeapCreate/Alloc/Free
- String functions: MultiByteToWideChar, WideCharToMultiByte, LCMapStringA/W, lstrlenA
- Process/module: GetModuleHandleA/W, GetModuleFileNameA/W, GetCurrentProcessId
- Memory: VirtualAlloc/Free/Protect, HeapAlloc/Free/ReAlloc, LocalAlloc, GlobalAlloc
- Threading: TlsAlloc/GetValue/SetValue/Free, InterlockedIncrement/Decrement/Exchange
- I/O: GetStdHandle, SetStdHandle, WriteFile, SetHandleCount, GetFileType
- Locale: GetACP, GetOEMCP, GetCPInfo, GetLocaleInfoA/W, CompareStringA/W
- Environment: GetEnvironmentStringsA/W, SetEnvironmentVariableA/W
- Misc: IsBadReadPtr/WritePtr/CodePtr, OutputDebugStringA, SetErrorMode

### DLL IAT Patching
The DLLLoader now tracks all IAT entries written during DLL loading and re-patches
them with stub addresses after stubs are registered. This prevents DLL→DLL calls
(e.g. msvcrt calling kernel32!TlsSetValue) from entering real DLL code. Currently
patches ~239 of ~7867 DLL IAT entries (the rest go to functions we haven't stubbed yet).

### Key Bugs Fixed
- **MOV r/m32,imm32 (0xC7) fetch ordering**: Was reading immediate before resolving
  the ModR/M addressing mode, causing wrong memory writes and stack corruption.
- **WideCharToMultiByte/MultiByteToWideChar wrong stack offsets**: Args were read at
  wrong ESP offsets (off by 4-8 bytes), causing massive memory corruption that
  overwrote the entire stub region.
- **LCMapStringW wrong offset**: cchSrc read from [ESP+12] instead of [ESP+16].
- **cdecl stubs calling cleanupStdcall**: _initterm, _initterm_e, __set_app_type,
  _except_handler3 are cdecl but had stdcall cleanup, double-popping the stack.
- **OR AL,imm8 (0x0C) mislabeled**: Was labeled AND and operated on full EAX.
- **Missing opcodes added**: AND AL,imm8 (0x24), SBB (0x19/0x1B), ADC (0x11/0x13).

### Step Count Progression
16 → 494 → 3043 → 8114 → 21094 → 22929 (and growing)

## Project Structure

```
run-exe.ts          <- Main standalone emulator runner
electron-main.ts    <- Electron app main process (has emulator too)
electron-preload.ts <- Electron IPC bridge
index.ts            <- Exports EXEFile and HTMLRenderer
public/index.html   <- Electron renderer UI

src/
  exefile.ts        <- PE file parser (main class: EXEFile)
  hardware/
    CPU.ts          <- x86-32 CPU: registers, flags, step(), fetch helpers
    Memory.ts       <- Linear address space with read/write 8/16/32
  kernel/
    KernelStructures.ts <- TEB/PEB allocation at 0x00320000/0x00300000
    ExceptionDiagnostics.ts <- Error reporting with address lookup
  loader/
    DLLLoader.ts    <- Loads real Windows DLLs, applies relocations
    ImportResolver.ts <- Resolves IAT entries, writes stubs
  emulator/
    opcodes.ts      <- ~60 x86-32 instruction handlers
    VRAMVisualizer.ts <- Memory write monitor for graphics
    index.ts        <- Central re-exports for all modules

scripts/            <- Old debug/trace scripts (moved out of root for cleanup)
```

## Memory Layout (2GB address space)

```
0x7FFFFFF0          Stack top (ESP initial value = memSize - 16)
0x7FFE0000          Stack limit (128KB below top)
0x34000000          IMPLODE.DLL (last DLL)
0x10000000-0x34xx   DLLs (16MB each, ~35 DLLs loaded)
0x04000000+         Heap (bump allocator, grows upward)
0x00400000          Main executable image base (MCity_d.exe)
0x00320000          TEB (Thread Environment Block)
0x00300000          PEB (Process Environment Block)
0x00201000-0x201FFF Stub data (strings, environment, fmode, etc.)
0x00200000-0x200FFF Win32 API stub trampolines (INT 0xFE; RET)
```

Stack is dynamically placed at `memSize - 16` so it scales with allocated memory.
run-exe.ts uses 2GB. Electron uses fallback (256MB down to 32MB).

## What Works

- PE parsing: all sections, headers, import/export tables
- DLL loading: 35 DLLs loaded from filesystem with base relocation
- IAT resolution: all 354 imports resolved, IAT stubs written
- DLL IAT patching: loaded DLLs' IATs redirected to stubs (239/7867 entries)
- API forwarding: api-ms-win-* DLLs forward to kernel32/ntdll/etc
- Win32 API stubs: ~100+ functions stubbed with JS handlers via INT 0xFE
- CPU: ~60 opcodes, ModR/M addressing, segment overrides (FS/GS)
- TEB/PEB: allocated and initialized with stack bounds
- Bump allocator heap: HeapAlloc/LocalAlloc/GlobalAlloc share a bump allocator at 0x04000000
- CRT startup: progressing through mainCRTStartup (~22,900 instructions)
- Electron: UI with canvas, stats sidebar, pause/step/reset controls
- VRAM visualizer: infrastructure ready but no game graphics yet

## What Doesn't Work Yet

1. **Execution still hitting real DLL code** - 298 main exe imports still unstubbed,
   plus DLL-internal calls. Each unstubbed call enters real x86 DLL code which hits
   unimplemented opcodes or accesses unmapped memory.
2. **Many opcodes still missing** - discovered incrementally as execution progresses
3. **No SEH (Structured Exception Handling)** - game code sets up SEH frames but
   we don't dispatch exceptions through them yet
4. **No file I/O** - CreateFileA, ReadFile, etc. not yet stubbed
5. **No windowing** - USER32/GDI32 functions not yet stubbed
6. **VRAM visualization untested** - needs game to actually write pixels

## Key Technical Details

### Import Resolution
DLLs are real Windows PE files loaded from `/data/Downloads/`. The loader:
1. Parses the DLL's PE headers
2. Loads sections into emulator memory at an available base address
3. Applies base relocations (type 3 HIGHLOW)
4. Resolves the DLL's own imports recursively
5. Writes IAT entries so the main exe can call DLL functions
6. After stubs are registered, re-patches DLL IAT entries to use stubs (patchDLLIATs)

### DLL Search Paths (in run-exe.ts)
The long array in run-exe.ts lists directories containing DLL files.
Each directory should contain the extracted DLL (without .dll extension in the path).

### Segment Overrides
FS register points to TEB base (0x00320000). When code does `FS:[offset]`,
the CPU adds TEB base to the offset. This is how Windows programs access
thread-local data.

## Commands for Debugging

```bash
# Run with full output:
node run-exe.ts

# Quick test (5 second timeout):
timeout 5 node run-exe.ts 2>&1 | tail -30

# Build for electron:
npm run build

# Run electron:
npm start
```

## Next Steps (Priority Order)

1. **Add more Win32 API stubs** - 298 main exe imports still unstubbed. As
   execution progresses, each new unstubbed call crashes into real DLL code.
   Priority stubs: IsBadReadPtr (current crash), then whatever CRT hits next.

2. **Add more opcodes** - as execution progresses, new unknown opcodes will
   appear. Add them to src/emulator/opcodes.ts. Recently added: AND AL (0x24),
   SBB (0x19/0x1B), ADC (0x11/0x13).

3. **Implement basic SEH** - game code sets up SEH frames via FS:[0]. Need to
   dispatch exceptions through the SEH chain instead of crashing.

4. **File I/O stubs** - game will need CreateFileA, ReadFile, GetFileSize, etc.
   These need a virtual filesystem or passthrough to real files.

5. **Windowing stubs** - USER32 functions (CreateWindowExA, RegisterClassA,
   GetMessageA, DispatchMessageA) needed for the game's main loop.
