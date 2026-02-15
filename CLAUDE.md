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

Emulator completes the **entire CRT startup** (mainCRTStartup → _initterm → main())
and enters game code. The Chat Filter worker thread runs cooperatively (1M steps per
Sleep() call from the main thread). The thread calls `DeleteFileA`, `CreateFileA`
(GENERIC_WRITE gets a fake handle), and is progressing through `Paths_Init()` which
checks the registry for installation data. Registry values are now loaded from
`registry.json` in the project root for easy editing.

The game outputs: `"Created Chat Filter thread, Handle = 0xBEEF"` and the thread
proceeds to initialize file logging and check installation paths via the registry.

### Win32 API Stub System
Instead of executing real DLL code (which needs Windows kernel structures), we
intercept IAT calls via `INT 0xFE` trampolines at `0x00200000`. Each stub is a
JS function that reads args from the stack, sets EAX, and does stdcall/cdecl cleanup.

**~160+ stubs implemented** covering:
- CRT startup: GetVersion, GetCommandLineA/W, GetStartupInfoA, HeapCreate/Alloc/Free
- String functions: MultiByteToWideChar, WideCharToMultiByte, LCMapStringA/W, lstrlenA
- Process/module: GetModuleHandleA/W, GetModuleFileNameA/W, GetCurrentProcessId
- Memory: VirtualAlloc/Free/Protect, HeapAlloc/Free/ReAlloc, LocalAlloc, GlobalAlloc
- Threading: CreateThread, ResumeThread, ExitThread, Sleep, WaitForSingleObject
- TLS: TlsAlloc/GetValue/SetValue/Free, InterlockedIncrement/Decrement/Exchange
- Sync: CreateMutexA, OpenMutexA, ReleaseMutex, CreateEventA, SetEvent, CloseHandle
- I/O: GetStdHandle, SetStdHandle, WriteFile, SetHandleCount, GetFileType, CreateFileA
- File ops: DeleteFileA/W, FindFirstFileA/W, FindNextFileA/W, FindClose, CompareFileTime
- Time: GetLocalTime, GetSystemTime, GetTickCount, QueryPerformanceCounter/Frequency
- Locale: GetACP, GetOEMCP, GetCPInfo, GetLocaleInfoA/W, CompareStringA/W
- Environment: GetEnvironmentStringsA/W, SetEnvironmentVariableA/W
- Directory: GetCurrentDirectoryA, SetCurrentDirectoryA, GetWindowsDirectoryA
- Error: GetLastError, SetLastError, IsProcessorFeaturePresent
- USER32: MessageBoxA/W, GetActiveWindow, GetLastActivePopup
- Registry: RegOpenKeyA/ExA, RegQueryValueA/ExA, RegCloseKey, RegSetValueExA
- INI files: GetPrivateProfileStringA/IntA, WritePrivateProfileStringA
- Misc: IsBadReadPtr/WritePtr/CodePtr, OutputDebugStringA, SetErrorMode
- CRT patches: _CrtDbgReport (suppresses debug assertions), _sbh_heap_init, __sbh_alloc_block

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
- **8-bit register encoding bugs**: readReg8/writeReg8 were reading low byte of the
  wrong GPR instead of AH/CH/DH/BH (e.g. rm=5 read EBP low instead of CH high).
  Fixed by adding proper readRM8/writeRM8/readReg8/writeReg8 helpers.
- **0x66 operand-size prefix ignored**: MOV r/m32,imm32 was consuming 4 bytes of
  immediate even with 0x66 prefix (should be 2), misaligning all subsequent EIPs.

- **HeapReAlloc missing data copy**: New block returned without copying old data,
  causing atexit function table to contain 0xCDCDCDCD (MSVC debug heap fill).
- **LDS/LES opcodes (0xC5/0xC4) missing**: Game code called LDS which halted; added
  both opcodes (ignoring segment register in flat memory model, just load 32-bit ptr).
- **DeleteFileA not stubbed**: Fell through to real KERNEL32→KERNELBASE→ntdll code
  which accessed uninitialized ntdll globals and crashed at 3.4M steps.
- **CreateFileA returning INVALID_HANDLE_VALUE for all**: Chat filter logging retried
  indefinitely; fixed to return fake handles (0x5000+) for GENERIC_WRITE operations.

### Step Count Progression
16 → 494 → 3043 → 8114 → 21094 → 22929 → 46,966 → 594,553 → 627,122 → 10,000,000+ → 3,887,539 (thread ran)
(594K = CRT finished, 627K = after _CrtDbgReport patch, 10M+ = game main loop with thread running)

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
    opcodes.ts      <- ~90+ x86-32 instruction handlers (incl. x87 FPU)
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
- Win32 API stubs: ~160+ functions stubbed with JS handlers via INT 0xFE
- x87 FPU: full emulation of 0xD8-0xDF (FLD/FST/FADD/FMUL/FDIV/FCOM/FNSTSW etc.)
- CPU: ~90+ opcodes, ModR/M addressing, segment overrides (FS/GS), 0x66 prefix
- TEB/PEB: allocated and initialized with stack bounds
- Bump allocator heap: HeapAlloc/LocalAlloc/GlobalAlloc share a bump allocator at 0x04000000
- CRT startup: fully completed through mainCRTStartup → main() → game init
- Game init: creates worker thread, outputs debug strings, enters main loop
- Electron: UI with canvas, stats sidebar, pause/step/reset controls
- VRAM visualizer: infrastructure ready but no game graphics yet

## What Doesn't Work Yet

1. **Paths_Init registry check** - Chat Filter thread calls Paths_Init() which reads
   install paths from registry. instLev=2 now works; SrcDrive and other keys added
   to registry.json. May still fail if other keys are missing.
2. **Some imports still unstubbed** - main exe has ~354 imports, most are stubbed but
   some less common ones may still hit real DLL code.
3. **No SEH (Structured Exception Handling)** - game code sets up SEH frames but
   we don't dispatch exceptions through them yet
4. **File I/O returns partial success** - CreateFileA returns fake handles for writes;
   ReadFile still returns failure. Game will need actual file reading for assets.
5. **No windowing** - USER32/GDI32 functions not yet stubbed
6. **VRAM visualization untested** - needs game to actually write pixels
7. **Debug CRT assertions suppressed** - _CrtDbgReport patched to return 0. The debug
   heap linked list (_pFirstBlock/_pLastBlock) isn't maintained by our bump allocator.

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

### Fake Registry (registry.json)
`registry.json` in the project root holds the fake Windows registry values served
to the game. Keys and value names are case-insensitive (normalized to lowercase).
Value types: 1=REG_SZ (string), 4=REG_DWORD (32-bit int). Keys starting with `_`
are treated as comments. Edit this file to add or change values without touching code.

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

1. **Get past Paths_Init** - Edit `registry.json` to add missing registry values
   until the "Registry is most likely incorrect" error goes away. Then see what
   the thread does next.

2. **File I/O** - Game will need CreateFileA, ReadFile, GetFileSize etc. to load
   assets. Need either a virtual filesystem or passthrough to real files on disk.

3. **Windowing stubs** - USER32 functions (CreateWindowExA, RegisterClassA,
   GetMessageA, DispatchMessageA) needed for the game's window creation.

4. **Implement basic SEH** - game code sets up SEH frames via FS:[0]. Need to
   dispatch exceptions through the SEH chain instead of crashing.

5. **Add more opcodes** - as execution progresses, new unknown opcodes will
   appear. Add them to src/emulator/opcodes.ts.
