# x86 Emulator - Claude Development Log

## Current Status

### Working Features
- PE file parsing and section loading
- Real DLL loading from filesystem with export extraction
- Virtual address space (512MB: 0x00000000-0x1fffffff)
- Memory mapping for DLLs with 16MB per DLL (0x10000000-0x1fffffff)
- Stack at 0x1ff00000-0x1fffffff (128KB)
- **Base relocation support** - DLLs now relocated to emulator's address space
- ~55+ x86-32 instruction opcodes
- ModR/M addressing with various modes
- Exception handling callback system
- Kernel structures (TEB/PEB) at 0x00300000-0x0033ffff
- **Segment override tracking** (FS/GS prefixes recognized and applied)

### Recent Fixes (This Session)
1. **Module Organization** - Reorganized from `src/emulator/` to:
   - `src/hardware/` - CPU and Memory (x86-32 hardware simulation)
   - `src/kernel/` - ExceptionDiagnostics and KernelStructures (OS integration)
   - `src/loader/` - DLLLoader and ImportResolver (PE/DLL management)
   - `src/emulator/` - opcodes.ts and central exports

2. **Kernel Structures** - Implemented TEB/PEB allocation
   - TEB at 0x00320000 with proper field layout per Windows spec
   - Fields: ExceptionList, StackBase, StackLimit, SubSystemTib, Self pointer, etc.
   - PEB at 0x00300000 for process-level data
   - FS register points to TEB base for segment-relative addressing

3. **Base Relocations** - Fixed critical DLL loading issue
   - DLLs now have hardcoded addresses properly adjusted
   - Example: kernel32.dll (preferred 0x6b800000) relocated to 0x12000000
   - Relocation delta applied to all HIGHLOW (type 3) relocations
   - DLL code now executes with correct memory references

4. **Segment Override Support**
   - CPU tracks FS/GS prefix bytes (0x64, 0x65)
   - Memory addressing applies segment base when override active
   - Segment override cleared after each instruction

### Known Issues / Next Steps

#### Fixed: Ordinal Imports (This Session)
- DLLs export functions both by name and by ordinal number
- Ordinal imports are specified as "Ordinal #N" in import tables
- Fixed DLLLoader to extract and store both named and ordinal exports
- Result: ordinal import resolution now working (e.g., comctl32.dll!Ordinal #17)

#### Fixed: All Import Resolution (This Session)
- Root problem was address space exhaustion (512MB too small)
- Found all three "missing" DLLs in /data/Downloads/Motor City Online/
- Increased memory to 1GB to accommodate all DLLs
- All 354 imports now successfully resolved (19 DLLs loaded)
- WININET, IFC22, and IMPLODE DLLs all load and export correctly

**Result**: Game executable can now jump into kernel32.dll code with all imports
properly resolved. Current crash at 0x000a54f0 is likely an unimplemented
instruction or error in a resolved DLL function, not an unresolved import.

#### Segment-Relative Addressing
- TEB allocation is ready (0x00320000)
- FS override tracking is ready
- Still needs: actual FS-relative memory access in real code
- Current test doesn't exercise FS:[offset] addressing yet

### Files Modified This Session

**New:**
- `src/kernel/KernelStructures.ts` - TEB/PEB allocation and management
- `CLAUDE.md` - This file

**Updated:**
- `src/hardware/CPU.ts` - Added kernelStructures field, segment override tracking, applySegmentOverride method
- `src/loader/DLLLoader.ts` - Added base relocation support + fixed ordinal export extraction
- `run-exe.ts` - Initialize KernelStructures with stack bounds
- `src/emulator/index.ts` - Updated architecture diagram, export KernelStructures
- `src/kernel/index.ts` - Export KernelStructures
- `ARCHITECTURE.md` - Updated module naming (processor → hardware)
- `CLAUDE.md` - Updated known issues and progress notes

**Moved:**
- `src/processor/` → `src/hardware/` (CPU.ts, Memory.ts, index.ts)

### Architecture Notes

```
┌─────────────────────────────────┐
│      EXEFile (PE Parser)        │
└─────────────┬───────────────────┘
              │
  ┌───────────┼───────────┬──────────┐
  │           │           │          │
┌─▼─────┐ ┌──▼──────┐ ┌──▼──────┐ ┌─▼──────┐
│Loader │ │Hardware │ │ Kernel  │ │Emulator│
├───────┤ ├─────────┤ ├─────────┤ ├────────┤
│DLL*   │ │Memory   │ │TEB/PEB  │ │Opcodes │
│Import │ │CPU      │ │Diagnost*│ │        │
│Resolve│ │         │ │         │ │        │
└───────┘ └─────────┘ └─────────┘ └────────┘
  *New    Pure hw    *New         No changes
```

### Virtual Address Space Layout

```
0x1ff00000-0x1fffffff   Stack (128KB)
0x1f000000-0x1fffffff   VERSION.dll
...
0x10000000-0x10ffffff   d3d8.dll (first DLL)
0x00320000-0x0033ffff   TEB (Thread Environment Block)
0x00300000-0x0031ffff   PEB (Process Environment Block)
0x00400000-0x013fffff   Main executable (MCity_d.exe)
0x00000000-0x002fffff   Kernel structures & reserved
```

### Windows x86-32 Internals Used

**TEB (Thread Environment Block)** - Per-thread kernel data
- Offset 0x00: ExceptionList (SEH frame)
- Offset 0x04: StackBase (high address)
- Offset 0x08: StackLimit (low address)
- Offset 0x0C: SubSystemTib
- Offset 0x18: Self (pointer to TEB)
- Offset 0x30: ProcessEnvironmentBlock (PEB pointer)

**FS Segment** - Points to TEB base in user-mode
- FS:[0x00] = ExceptionList (SEH)
- FS:[0x04] = StackBase
- FS:[0x08] = StackLimit
- FS:[0x30] = PEB pointer

**Base Relocations** - Adjust absolute addresses when DLL loaded at different base
- Type 0 (ABS): No relocation needed
- Type 3 (HIGHLOW): 32-bit absolute address (add relocation delta)

### Testing Commands

```bash
# Run main emulator
node run-exe.ts

# Trace execution to failure point
node trace-to-failure.ts

# Memory layout visualization (if exists)
node memory-map.ts
```

### Next Session Priorities

1. **Handle unresolved imports gracefully**
   - Create mock stubs for missing DLLs (ifc22.dll, implode.dll)
   - Or locate actual DLL files

2. **Debug the jump to 0x000a54f0**
   - This appears to be a NULL import function pointer
   - Need to trace which import it is and why it's unresolved

3. **Test actual FS-relative access**
   - Create a test that exercises FS:[offset] addressing
   - Verify TEB/PEB fields are accessible

4. **Improve diagnostics**
   - Better error messages for unresolved imports
   - Trace which instruction caused the problem
