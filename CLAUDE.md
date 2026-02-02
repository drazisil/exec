# x86 Emulator for Motor City Online

## CRITICAL: How to Run

```bash
# Native node TS execution (PREFERRED - no build step needed):
node --experimental-transform-types run-exe.ts

# Or via npm script:
npm run run

# Electron app (requires build first):
npm run build && npm start
```

**DO NOT remove `"type": "module"` from package.json.**
**DO NOT change import extensions from `.ts` to `.js` in source files.**
The tsconfig uses `rewriteRelativeImportExtensions: true` to handle this for compiled output.

## Current Crash - KERNEL32.dll GetVersion

Emulator executes **16 instructions** (14 CRT startup + CALL into KERNEL32.dll!GetVersion)
then crashes inside KERNEL32:
```
EIP: 0x004a54fc (return address in main exe after the CALL)
Error: read32: address 0x8b000000 outside bounds [0, 0x80000000)
```

### Entry Point Disassembly (MSVC CRT startup at 0x009fc980):
```asm
PUSH EBP                          ; 55
MOV EBP, ESP                      ; 8b ec
PUSH -1                           ; 6a ff
PUSH 0x011f3b90                   ; 68 90 3b 1f 01   (SEH handler address)
PUSH 0x009f5eb8                   ; 68 b8 5e 9f 00   (SEH filter)
MOV EAX, FS:[0]                   ; 64 a1 00000000   (read current SEH chain)
PUSH EAX                          ; 50
MOV FS:[0], ESP                   ; 64 89 25 00000000 (install SEH frame)
ADD ESP, -0x5C                    ; 83 c4 a4          (allocate locals)
PUSH EBX                          ; 53
PUSH ESI                          ; 56
PUSH EDI                          ; 57
MOV [EBP-0x18], ESP               ; 89 65 e8
CALL [0x020f4e2c]                 ; ff 15 2c4e0f02   => KERNEL32!GetVersion
```

### Root Cause
The CALL goes into real KERNEL32.dll code at 0x21022cb0. That code tries to access
internal Windows NT structures (KUSER_SHARED_DATA at 0x7FFE0000, PEB fields, etc.)
that we haven't set up. The 0x8b000000 access is KERNEL32 trying to read something
from a relocated pointer in its own data that points outside our 2GB address space.

### Solution: Win32 API Stubs
Instead of executing real KERNEL32 code, we need to **intercept IAT calls** and
return fake values. For GetVersion: return 0x0A000000 (Windows 10) or similar.

The approach:
1. Create a stub system that intercepts CALL [IAT_addr] instructions
2. Instead of jumping to real DLL code, execute a JS function that returns the value
3. Start with the CRT startup functions: GetVersion, GetCommandLineA, GetStartupInfoA
4. Each stub pushes a return value into EAX and does a RET

### Fixes Made This Session
- **Fixed FS segment override bug**: 0xA1 (MOV EAX, [disp32]) and 0xA3 (MOV [disp32], EAX)
  were not applying FS/GS segment overrides. Now FS:[0] reads correctly from TEB.
- **Fixed process.exit(1)** in ExceptionDiagnostics - now uses cpu.halted = true so
  step count and final state are printed.
- **Made applySegmentOverride public** on CPU class so opcodes can use it directly.

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
    opcodes.ts      <- ~55 x86-32 instruction handlers
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
0x00400000          Main executable image base (MCity_d.exe)
0x00320000          TEB (Thread Environment Block)
0x00300000          PEB (Process Environment Block)
```

Stack is dynamically placed at `memSize - 16` so it scales with allocated memory.
run-exe.ts uses 2GB. Electron uses fallback (256MB down to 32MB).

## What Works

- PE parsing: all sections, headers, import/export tables
- DLL loading: 35 DLLs loaded from filesystem with base relocation
- IAT resolution: all 354 imports resolved, IAT stubs written
- API forwarding: api-ms-win-* DLLs forward to kernel32/ntdll/etc
- CPU: ~55 opcodes, ModR/M addressing, segment overrides (FS/GS)
- TEB/PEB: allocated and initialized with stack bounds
- Electron: UI with canvas, stats sidebar, pause/step/reset controls
- VRAM visualizer: infrastructure ready but no game graphics yet

## What Doesn't Work Yet

1. **Execution crashes after 16 instructions** - see "Current Crash" above
2. **Many opcodes still missing** - will discover as execution progresses
3. **No SEH (Structured Exception Handling)** - game likely needs this
4. **No Win32 API emulation** - DLL code is loaded but API calls do nothing useful
5. **VRAM visualization untested** - needs game to actually write pixels

## Key Technical Details

### Import Resolution
DLLs are real Windows PE files loaded from `/data/Downloads/`. The loader:
1. Parses the DLL's PE headers
2. Loads sections into emulator memory at an available base address
3. Applies base relocations (type 3 HIGHLOW)
4. Resolves the DLL's own imports recursively
5. Writes IAT entries so the main exe can call DLL functions

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
node --experimental-transform-types run-exe.ts

# Quick test (5 second timeout):
timeout 5 node --experimental-transform-types run-exe.ts 2>&1 | tail -30

# Build for electron:
npm run build

# Run electron:
npm start
```

## Next Steps (Priority Order)

1. **Fix the 16-instruction crash** - verify opcode decoding is correct for all
   16 instructions from entry point. The crash at 0x8b000000 is suspicious -
   likely a mis-decoded instruction causing wrong memory access.

2. **Add more opcodes** - as execution progresses, new unknown opcodes will
   appear. Add them to src/emulator/opcodes.ts.

3. **Implement basic SEH** - game code will likely set up exception handlers
   via FS:[0] (TEB.ExceptionList). Need to support PUSH/MOV to set up SEH chain
   and dispatch exceptions through it.

4. **Win32 API stubs** - eventually need to stub out kernel32 functions like
   GetModuleHandle, GetProcAddress, VirtualAlloc, etc. These are what the game
   actually calls through the IAT.
