# x86 Emulator Architecture

## Directory Organization

The emulator is organized into four functional modules:

```
src/
├── hardware/        # x86-32 hardware simulation
│   ├── Memory.ts       - Virtual memory/address space (512MB)
│   ├── CPU.ts          - x86 processor state machine
│   └── index.ts        - Public hardware API
│
├── kernel/          # OS integration and diagnostics
│   ├── ExceptionDiagnostics.ts - Crash analysis and diagnostics
│   └── index.ts        - Public kernel API
│
├── loader/          # PE and DLL loading
│   ├── DLLLoader.ts    - Windows DLL loader (filesystem)
│   ├── ImportResolver.ts - Import table resolution
│   └── index.ts        - Public loader API
│
├── emulator/        # Instruction implementation
│   ├── opcodes.ts      - x86 instruction handlers (~55+ opcodes)
│   └── index.ts        - Public emulator API (aggregates all)
│
└── exefile.ts       # PE format parser (entry point)
```

## Module Responsibilities

### Hardware Module
**x86-32 hardware simulation** - simulates the processor and memory subsystem

- **Memory.ts**: 512MB virtual address space
  - Bounds checking on read/write
  - Address validation methods
  - Memory bounds queries

- **CPU.ts**: x86-32 processor emulation
  - 8 general-purpose registers (EAX-EDI)
  - EIP (instruction pointer) and EFLAGS
  - Fetch-decode-execute cycle
  - ModR/M decoding for addressing modes
  - Flag calculations (ZF, SF, CF, OF)
  - Exception callback system

### Kernel Module
**OS integration and diagnostics** - provides debugging and kernel-level analysis

- **ExceptionDiagnostics.ts**: Automated crash analysis
  - Memory access diagnostics
  - Segment-relative address detection (FS/GS)
  - Register validation
  - CPU state dumping
  - DLL ownership identification

### Loader Module
**PE and DLL management** - handles file loading and import resolution

- **DLLLoader.ts**: Dynamic library loader
  - Filesystem-based DLL discovery
  - Section loading into memory
  - Export table extraction
  - Virtual address space allocation (16MB per DLL)
  - Address-to-DLL mapping

- **ImportResolver.ts**: Import resolution
  - Import table parsing
  - Import Address Table (IAT) population
  - Real function address lookup
  - DLL lifecycle management

### Emulator Module
**Instruction implementation** - handles x86 instruction execution

- **opcodes.ts**: x86 instruction handlers
  - Data movement (MOV, LEA)
  - Arithmetic (ADD, SUB, CMP, INC, DEC)
  - Logic (AND, OR, XOR, TEST)
  - Shifts (ROL, ROR, RCL, RCR, SHL, SHR, SAR)
  - Stack operations (PUSH, POP)
  - Control flow (CALL, RET, JMP, Jcc)
  - Group opcodes (0x81, 0x83, 0xC1, 0xFF)
  - Miscellaneous (NOP, HLT, INT)

## Data Flow

```
PE File
  ↓
EXEFile (parse)
  ├─→ Section headers
  ├─→ Import table
  └─→ Entry point RVA
      ↓
Loader
  ├─→ ImportResolver
  │    ├─→ DLLLoader
  │    │    └─→ Load DLLs from disk
  │    └─→ Populate IAT with real addresses
  └─→ Load executable sections into Memory
      ↓
Kernel
  ├─→ Memory (512MB virtual address space)
  │    ├─→ 0x00400000-0x013fffff: Main executable
  │    ├─→ 0x10000000-0x1fffffff: Loaded DLLs
  │    └─→ 0x1ff00000-0x1fffffff: Stack
  │
  └─→ CPU
       ├─→ Fetch instruction from Memory
       ├─→ Decode opcode
       ├─→ Execute handler from Emulator
       └─→ Update state (registers, flags)
           ↓
Exception (bounds check fail)
  ↓
ExceptionDiagnostics
  ├─→ Extract error address
  ├─→ Query DLL ownership
  ├─→ Validate registers
  └─→ Print diagnostic report
```

## Virtual Address Space

```
0x1ff00000 ┌──────────────────┐
           │     Stack        │  (128KB, grows down)
0x1f000000 ├──────────────────┤
           │  VERSION.dll     │  (16MB allocated per DLL)
0x1e000000 ├──────────────────┤
           │  WSOCK32.dll     │
...        ...
0x12000000 ├──────────────────┤
           │  KERNEL32.dll    │
0x11000000 ├──────────────────┤
           │  COMCTL32.dll    │
0x10000000 ├──────────────────┤
           │   (Reserved)     │
0x00400000 ├──────────────────┤
           │  Main executable │  (16MB allocated)
0x00000000 └──────────────────┘
```

## Exception Handling

When a memory access error occurs:

1. **Memory bounds check** fails during read/write
2. **CPU.step()** catches the exception
3. **handleException()** invokes registered handler
4. **ExceptionDiagnostics** analyzes the error:
   - Identifies segment-relative addresses (FS/GS-based)
   - Lists common TEB/PEB field offsets
   - Validates register values
   - Shows current execution context
   - Lists valid DLL ranges

## Key Design Decisions

✅ **Pure kernel**: CPU and Memory don't know about DLLs
✅ **Address mapping**: DLLLoader maintains virtual address ranges
✅ **Lazy loading**: DLLs only loaded when needed
✅ **Real code execution**: Uses actual Windows DLL code, not stubs
✅ **Extensible instructions**: Easy to add new opcodes
✅ **Diagnostic first**: Crashes provide meaningful context

## Integration Points

### EXEFile → Loader
```typescript
const exe = new EXEFile(path, dllSearchPaths);
exe.importResolver.setMemory(memory);
exe.importResolver.buildIATMap(exe.importTable, imageBase);
```

### Loader → Kernel
```typescript
registerAllOpcodes(cpu);
setupExceptionDiagnostics(cpu, exe.importResolver);
cpu.run(maxSteps);
```

## Future Extensions

- **TEB/PEB support**: Allocate kernel structures
- **Syscall interception**: Hook INT 2E for kernel calls
- **Thread-local storage**: FS segment support
- **Heap management**: VirtualAlloc/HeapAlloc stubs
- **API interception**: Monitor DLL function calls
