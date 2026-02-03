# Debugger CLI Implementation Plan

This document provides step-by-step instructions to consolidate the 50+ ad-hoc debug scripts into a unified CLI tool.

## Goal

Replace this:
```bash
node --experimental-transform-types scripts/trace-crash.ts
node --experimental-transform-types scripts/memory-map.ts
node --experimental-transform-types scripts/identify-crash-module.ts
# ... 50 more scripts with duplicated boilerplate
```

With this:
```bash
node --experimental-transform-types dbg.ts trace 1000
node --experimental-transform-types dbg.ts map
node --experimental-transform-types dbg.ts module 0x004a54f6
```

---

## File Structure to Create

```
src/debugger/
  index.ts              # CLI entry point (parses args, dispatches commands)
  EmulatorContext.ts    # Shared setup (eliminates all boilerplate)
  commands/
    index.ts            # Re-exports all commands
    trace.ts            # Run N steps with execution trace
    memory.ts           # Inspect memory at address
    disasm.ts           # Disassemble instructions
    module.ts           # Identify which module owns an address
    imports.ts          # List imports
    map.ts              # Show memory map
    regs.ts             # Show register state
    stack.ts            # Show stack frames

dbg.ts                  # Thin wrapper that imports src/debugger/index.ts
debug.config.json       # User configuration (paths, memory size)
```

---

## Step 1: Create the Config File

**File: `debug.config.json.example`**

This is an example config users copy to `debug.config.json` and customize.

```json
{
  "exePath": "/path/to/MCity_d.exe",
  "dllPaths": [
    "/path/to/game/folder/",
    "/path/to/system32/",
    "/path/to/msvcrt/"
  ],
  "memorySize": 2147483648
}
```

**Notes:**
- `memorySize` is in bytes (2147483648 = 2GB)
- `dllPaths` are searched in order when loading DLLs
- The actual `debug.config.json` should be in `.gitignore`

**Add to `.gitignore`:**
```
debug.config.json
```

---

## Step 2: Create EmulatorContext.ts

**File: `src/debugger/EmulatorContext.ts`**

This class encapsulates ALL the boilerplate that's currently duplicated in every script.

```typescript
import { readFileSync, existsSync } from "node:fs";
import { EXEFile } from "../exefile.ts";
import { CPU } from "../hardware/CPU.ts";
import { Memory } from "../hardware/Memory.ts";
import { registerAllOpcodes } from "../emulator/opcodes.ts";
import { KernelStructures } from "../kernel/KernelStructures.ts";
import { Win32Stubs, registerCRTStartupStubs } from "../kernel/Win32Stubs.ts";
import { setupExceptionDiagnostics } from "../kernel/ExceptionDiagnostics.ts";
import { REG } from "../hardware/CPU.ts";

export interface DebugConfig {
  exePath: string;
  dllPaths: string[];
  memorySize: number;
}

const DEFAULT_CONFIG: DebugConfig = {
  exePath: "./MCity_d.exe",
  dllPaths: [],
  memorySize: 512 * 1024 * 1024, // 512MB fallback
};

export function loadConfig(configPath = "./debug.config.json"): DebugConfig {
  if (!existsSync(configPath)) {
    console.warn(`Warning: ${configPath} not found, using defaults`);
    console.warn(`Copy debug.config.json.example to debug.config.json and customize it`);
    return DEFAULT_CONFIG;
  }
  
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error(`Error loading ${configPath}:`, err);
    return DEFAULT_CONFIG;
  }
}

export class EmulatorContext {
  readonly exe: EXEFile;
  readonly mem: Memory;
  readonly cpu: CPU;
  readonly stubs: Win32Stubs;
  readonly config: DebugConfig;
  
  private _initialized = false;

  constructor(config: DebugConfig) {
    this.config = config;
    
    // Load executable with DLL search paths
    console.log(`Loading: ${config.exePath}`);
    this.exe = new EXEFile(config.exePath, config.dllPaths);
    
    // Create memory
    console.log(`Allocating: ${(config.memorySize / 1024 / 1024).toFixed(0)}MB memory`);
    this.mem = new Memory(config.memorySize);
    
    // Create CPU
    this.cpu = new CPU(this.mem);
    
    // Initialize kernel structures
    const kernel = new KernelStructures(this.mem);
    this.cpu.kernelStructures = kernel;
    
    // Set up import resolver
    this.exe.importResolver.setMemory(this.mem);
    this.exe.importResolver.buildIATMap(this.exe.importTable, this.exe.optionalHeader.imageBase);
    
    // Load sections into memory
    for (const section of this.exe.sectionHeaders) {
      const vaddr = this.exe.optionalHeader.imageBase + section.virtualAddress;
      this.mem.load(vaddr, section.data);
    }
    
    // Set up Win32 stubs
    this.stubs = new Win32Stubs(this.mem);
    registerCRTStartupStubs(this.stubs, this.mem);
    this.stubs.install(this.cpu);
    
    // Write IAT stubs
    this.exe.importResolver.writeIATStubs(
      this.mem,
      this.exe.optionalHeader.imageBase,
      this.exe.importTable,
      this.stubs
    );
    
    // Register opcodes
    registerAllOpcodes(this.cpu);
    
    // Set up exception diagnostics
    setupExceptionDiagnostics(this.cpu, this.exe.importResolver);
    
    // Initialize CPU state
    const stackBase = this.mem.size - 16;
    const stackLimit = stackBase - (128 * 1024);
    
    this.cpu.eip = this.exe.optionalHeader.imageBase + this.exe.optionalHeader.addressOfEntryPoint;
    this.cpu.regs[REG.ESP] = stackBase >>> 0;
    this.cpu.regs[REG.EBP] = stackBase >>> 0;
    
    kernel.initializeKernelStructures(stackBase, stackLimit);
    
    this._initialized = true;
    console.log(`Entry point: 0x${this.cpu.eip.toString(16).padStart(8, "0")}`);
    console.log(`Stack: 0x${stackBase.toString(16).padStart(8, "0")}`);
    console.log();
  }

  /**
   * Find which module (exe or DLL) owns an address
   */
  findModule(address: number): { name: string; section?: string; offset: number } | null {
    // Check main exe sections
    const base = this.exe.optionalHeader.imageBase;
    for (const section of this.exe.sectionHeaders) {
      const start = base + section.virtualAddress;
      const end = start + section.virtualSize;
      if (address >= start && address < end) {
        return {
          name: "MCity_d.exe",
          section: section.name,
          offset: address - start,
        };
      }
    }
    
    // Check loaded DLLs
    for (const mapping of this.exe.importResolver.getAddressMappings()) {
      if (address >= mapping.baseAddress && address < mapping.endAddress) {
        return {
          name: mapping.dllName,
          offset: address - mapping.baseAddress,
        };
      }
    }
    
    return null;
  }

  /**
   * Format an address with module info
   */
  formatAddress(address: number): string {
    const mod = this.findModule(address);
    const hex = `0x${(address >>> 0).toString(16).padStart(8, "0")}`;
    if (mod) {
      const section = mod.section ? ` ${mod.section}` : "";
      return `${hex} (${mod.name}${section}+0x${mod.offset.toString(16)})`;
    }
    return hex;
  }
}
```

**Key points:**
- Constructor does ALL the setup that was duplicated in every script
- `findModule()` is a utility many commands will use
- `formatAddress()` makes output more readable
- Reads config from JSON file so paths aren't hardcoded

---

## Step 3: Create Command Files

### `src/debugger/commands/map.ts`

Shows the memory map of all loaded modules.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";

export function map(ctx: EmulatorContext): void {
  console.log("=== Memory Map ===\n");
  
  // Main executable
  const base = ctx.exe.optionalHeader.imageBase;
  console.log("Main Executable:");
  for (const section of ctx.exe.sectionHeaders) {
    const start = base + section.virtualAddress;
    const end = start + section.virtualSize;
    const size = section.virtualSize;
    console.log(
      `  ${section.name.padEnd(8)} 0x${start.toString(16).padStart(8, "0")} - 0x${end.toString(16).padStart(8, "0")} (${(size / 1024).toFixed(1)}KB)`
    );
  }
  
  console.log("\nLoaded DLLs:");
  const mappings = ctx.exe.importResolver.getAddressMappings();
  
  // Sort by base address
  const sorted = [...mappings].sort((a, b) => a.baseAddress - b.baseAddress);
  
  for (const m of sorted) {
    const size = m.endAddress - m.baseAddress;
    console.log(
      `  0x${m.baseAddress.toString(16).padStart(8, "0")} - 0x${m.endAddress.toString(16).padStart(8, "0")} (${(size / 1024 / 1024).toFixed(1)}MB) ${m.dllName}`
    );
  }
  
  console.log(`\nStack: 0x${(ctx.mem.size - 128 * 1024).toString(16).padStart(8, "0")} - 0x${(ctx.mem.size - 1).toString(16).padStart(8, "0")}`);
  console.log(`Total memory: ${(ctx.mem.size / 1024 / 1024).toFixed(0)}MB`);
}
```

---

### `src/debugger/commands/memory.ts`

Hex dump of memory at an address.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";

export function memory(ctx: EmulatorContext, address: number, size = 128): void {
  console.log(`\nMemory at ${ctx.formatAddress(address)}:\n`);
  
  for (let i = 0; i < size; i += 16) {
    const addr = address + i;
    const hex: string[] = [];
    const ascii: string[] = [];
    
    for (let j = 0; j < 16; j++) {
      try {
        const byte = ctx.mem.read8(addr + j);
        hex.push(byte.toString(16).padStart(2, "0"));
        ascii.push(byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".");
      } catch {
        hex.push("??");
        ascii.push("?");
      }
    }
    
    console.log(
      `${addr.toString(16).padStart(8, "0")}  ${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}  |${ascii.join("")}|`
    );
  }
}
```

---

### `src/debugger/commands/module.ts`

Identify which module owns an address.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";

export function module(ctx: EmulatorContext, address: number): void {
  console.log(`\nLooking up address: 0x${address.toString(16).padStart(8, "0")}\n`);
  
  const mod = ctx.findModule(address);
  
  if (mod) {
    console.log(`Found in: ${mod.name}`);
    if (mod.section) {
      console.log(`Section:  ${mod.section}`);
    }
    console.log(`Offset:   0x${mod.offset.toString(16)}`);
  } else {
    console.log("Not found in any loaded module");
    console.log("\nPossible regions:");
    console.log(`  Stub region:  0x00200000 - 0x00210000`);
    console.log(`  Heap region:  0x04000000+`);
    console.log(`  Stack region: 0x${(ctx.mem.size - 128 * 1024).toString(16)} - 0x${ctx.mem.size.toString(16)}`);
  }
}
```

---

### `src/debugger/commands/regs.ts`

Show CPU register state.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";
import { REG } from "../../hardware/CPU.ts";

export function regs(ctx: EmulatorContext): void {
  const cpu = ctx.cpu;
  
  console.log("\n=== CPU Registers ===\n");
  
  // General purpose registers
  console.log("General Purpose:");
  console.log(`  EAX: 0x${(cpu.regs[REG.EAX] >>> 0).toString(16).padStart(8, "0")}  ECX: 0x${(cpu.regs[REG.ECX] >>> 0).toString(16).padStart(8, "0")}`);
  console.log(`  EDX: 0x${(cpu.regs[REG.EDX] >>> 0).toString(16).padStart(8, "0")}  EBX: 0x${(cpu.regs[REG.EBX] >>> 0).toString(16).padStart(8, "0")}`);
  console.log(`  ESP: 0x${(cpu.regs[REG.ESP] >>> 0).toString(16).padStart(8, "0")}  EBP: 0x${(cpu.regs[REG.EBP] >>> 0).toString(16).padStart(8, "0")}`);
  console.log(`  ESI: 0x${(cpu.regs[REG.ESI] >>> 0).toString(16).padStart(8, "0")}  EDI: 0x${(cpu.regs[REG.EDI] >>> 0).toString(16).padStart(8, "0")}`);
  
  // Instruction pointer
  console.log(`\nInstruction Pointer:`);
  console.log(`  EIP: ${ctx.formatAddress(cpu.eip)}`);
  
  // Flags
  console.log(`\nFlags: 0x${cpu.eflags.toString(16).padStart(8, "0")}`);
  const flags: string[] = [];
  if (cpu.eflags & 0x0001) flags.push("CF");
  if (cpu.eflags & 0x0040) flags.push("ZF");
  if (cpu.eflags & 0x0080) flags.push("SF");
  if (cpu.eflags & 0x0800) flags.push("OF");
  if (cpu.eflags & 0x0004) flags.push("PF");
  if (cpu.eflags & 0x0010) flags.push("AF");
  console.log(`  Set: ${flags.length > 0 ? flags.join(" ") : "(none)"}`);
  
  // Step count
  console.log(`\nSteps executed: ${cpu.stepCount}`);
}
```

---

### `src/debugger/commands/trace.ts`

Execute N steps with optional tracing.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";
import { REG } from "../../hardware/CPU.ts";

interface TraceOptions {
  steps: number;
  verbose?: boolean;
  showLast?: number; // Show last N instructions before stop
}

export function trace(ctx: EmulatorContext, options: TraceOptions): void {
  const { steps, verbose = false, showLast = 20 } = options;
  const cpu = ctx.cpu;
  
  console.log(`=== Tracing ${steps} steps ===\n`);
  
  const history: string[] = [];
  let lastEIP = cpu.eip;
  let errorMessage = "";
  
  cpu.onException((error, cpu) => {
    errorMessage = error.message;
    cpu.halted = true;
  });
  
  const startTime = Date.now();
  
  for (let i = 0; i < steps && !cpu.halted; i++) {
    lastEIP = cpu.eip >>> 0;
    
    // Build trace line
    const line = `[${i}] EIP=${ctx.formatAddress(lastEIP)}`;
    
    if (verbose) {
      console.log(line);
    } else {
      // Keep history for end-of-trace dump
      history.push(line);
      if (history.length > showLast) {
        history.shift();
      }
    }
    
    try {
      cpu.step();
    } catch (err: any) {
      errorMessage = err.message;
      break;
    }
  }
  
  const elapsed = Date.now() - startTime;
  
  // If not verbose, show the last N instructions
  if (!verbose && history.length > 0) {
    console.log(`... (showing last ${history.length} instructions)\n`);
    for (const line of history) {
      console.log(line);
    }
  }
  
  console.log();
  console.log("=== Trace Complete ===");
  console.log(`Steps executed: ${cpu.stepCount}`);
  console.log(`Time: ${elapsed}ms (${(cpu.stepCount / elapsed * 1000).toFixed(0)} steps/sec)`);
  console.log(`Final EIP: ${ctx.formatAddress(cpu.eip)}`);
  
  if (errorMessage) {
    console.log(`\nError: ${errorMessage}`);
  }
  
  if (cpu.halted) {
    console.log(`\nCPU halted.`);
  }
}
```

---

### `src/debugger/commands/imports.ts`

List imports, optionally filtered by DLL.

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";

export function imports(ctx: EmulatorContext, filterDll?: string): void {
  if (!ctx.exe.importTable) {
    console.log("No import table found");
    return;
  }
  
  console.log("\n=== Imports ===\n");
  
  const dlls: Map<string, string[]> = new Map();
  
  for (const desc of ctx.exe.importTable.descriptors) {
    const dllName = desc.dllName.toLowerCase();
    
    // Apply filter if specified
    if (filterDll && !dllName.includes(filterDll.toLowerCase())) {
      continue;
    }
    
    if (!dlls.has(desc.dllName)) {
      dlls.set(desc.dllName, []);
    }
    
    for (const entry of desc.entries) {
      dlls.get(desc.dllName)!.push(entry.name);
    }
  }
  
  let totalImports = 0;
  
  for (const [dll, funcs] of dlls) {
    console.log(`${dll}: ${funcs.length} imports`);
    
    // Show first 10 functions
    const preview = funcs.slice(0, 10);
    console.log(`  ${preview.join(", ")}${funcs.length > 10 ? ", ..." : ""}`);
    console.log();
    
    totalImports += funcs.length;
  }
  
  console.log(`Total: ${totalImports} imports from ${dlls.size} DLLs`);
}
```

---

### `src/debugger/commands/disasm.ts`

Basic disassembly (just show bytes for now - full disassembly is complex).

```typescript
import type { EmulatorContext } from "../EmulatorContext.ts";

export function disasm(ctx: EmulatorContext, address: number, count = 10): void {
  console.log(`\nDisassembly at ${ctx.formatAddress(address)}:\n`);
  
  let addr = address;
  
  for (let i = 0; i < count; i++) {
    // Read up to 15 bytes (max x86 instruction length)
    const bytes: number[] = [];
    for (let j = 0; j < 8; j++) {
      try {
        bytes.push(ctx.mem.read8(addr + j));
      } catch {
        bytes.push(0);
      }
    }
    
    const bytesHex = bytes.slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join(" ");
    
    // Very basic opcode identification
    const opcode = bytes[0];
    let mnemonic = `db 0x${opcode.toString(16)}`;
    let size = 1;
    
    // Common opcodes (extend as needed)
    if (opcode >= 0x50 && opcode <= 0x57) {
      const reg = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"][opcode - 0x50];
      mnemonic = `PUSH ${reg}`;
      size = 1;
    } else if (opcode >= 0x58 && opcode <= 0x5F) {
      const reg = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"][opcode - 0x58];
      mnemonic = `POP ${reg}`;
      size = 1;
    } else if (opcode >= 0xB8 && opcode <= 0xBF) {
      const reg = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"][opcode - 0xB8];
      const imm = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
      mnemonic = `MOV ${reg}, 0x${(imm >>> 0).toString(16)}`;
      size = 5;
    } else if (opcode === 0xC3) {
      mnemonic = "RET";
      size = 1;
    } else if (opcode === 0xCC) {
      mnemonic = "INT 3";
      size = 1;
    } else if (opcode === 0xCD) {
      mnemonic = `INT 0x${bytes[1].toString(16)}`;
      size = 2;
    } else if (opcode === 0xE8) {
      const rel = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
      const target = (addr + 5 + rel) >>> 0;
      mnemonic = `CALL 0x${target.toString(16)}`;
      size = 5;
    } else if (opcode === 0xE9) {
      const rel = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
      const target = (addr + 5 + rel) >>> 0;
      mnemonic = `JMP 0x${target.toString(16)}`;
      size = 5;
    } else if (opcode === 0xEB) {
      const rel = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
      const target = (addr + 2 + rel) >>> 0;
      mnemonic = `JMP SHORT 0x${target.toString(16)}`;
      size = 2;
    } else if (opcode === 0x90) {
      mnemonic = "NOP";
      size = 1;
    } else if (opcode === 0xFF) {
      const modrm = bytes[1];
      const reg = (modrm >> 3) & 7;
      if (reg === 2) mnemonic = "CALL [...]";
      else if (reg === 4) mnemonic = "JMP [...]";
      else if (reg === 6) mnemonic = "PUSH [...]";
      size = 2; // Simplified
    }
    
    console.log(
      `${addr.toString(16).padStart(8, "0")}  ${bytesHex.padEnd(20)} ${mnemonic}`
    );
    
    addr += size;
  }
  
  console.log("\n(Note: This is a basic disassembler. Complex instructions may be wrong.)");
}
```

---

### `src/debugger/commands/index.ts`

Re-export all commands.

```typescript
export { map } from "./map.ts";
export { memory } from "./memory.ts";
export { module } from "./module.ts";
export { regs } from "./regs.ts";
export { trace } from "./trace.ts";
export { imports } from "./imports.ts";
export { disasm } from "./disasm.ts";
```

---

## Step 4: Create the CLI Entry Point

**File: `src/debugger/index.ts`**

```typescript
import { parseArgs } from "node:util";
import { EmulatorContext, loadConfig } from "./EmulatorContext.ts";
import * as commands from "./commands/index.ts";

function printUsage(): void {
  console.log(`
Usage: node --experimental-transform-types dbg.ts <command> [options]

Commands:
  trace [steps]           Run N steps (default: 1000)
  trace -v [steps]        Run N steps with verbose output
  memory <address> [size] Hex dump at address (default: 128 bytes)
  disasm <address> [n]    Disassemble N instructions (default: 10)
  module <address>        Identify which module owns an address
  imports [dll]           List imports (optionally filter by DLL)
  map                     Show memory map
  regs                    Show CPU register state

Options:
  -c, --config <path>     Config file (default: ./debug.config.json)
  -h, --help              Show this help

Examples:
  dbg.ts trace 5000
  dbg.ts memory 0x00200000 256
  dbg.ts module 0x004a54f6
  dbg.ts imports kernel32
`);
}

function parseAddress(str: string): number {
  if (str.startsWith("0x") || str.startsWith("0X")) {
    return parseInt(str, 16);
  }
  return parseInt(str, 10);
}

export function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c", default: "./debug.config.json" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    process.exit(0);
  }

  const [command, ...args] = positionals;
  const config = loadConfig(values.config as string);
  
  // Create context (this loads the exe and sets everything up)
  const ctx = new EmulatorContext(config);

  switch (command) {
    case "trace":
      commands.trace(ctx, {
        steps: parseInt(args[0]) || 1000,
        verbose: values.verbose as boolean,
      });
      break;

    case "memory":
    case "mem":
      if (!args[0]) {
        console.error("Usage: memory <address> [size]");
        process.exit(1);
      }
      commands.memory(ctx, parseAddress(args[0]), parseInt(args[1]) || 128);
      break;

    case "disasm":
    case "dis":
      if (!args[0]) {
        console.error("Usage: disasm <address> [count]");
        process.exit(1);
      }
      commands.disasm(ctx, parseAddress(args[0]), parseInt(args[1]) || 10);
      break;

    case "module":
    case "mod":
      if (!args[0]) {
        console.error("Usage: module <address>");
        process.exit(1);
      }
      commands.module(ctx, parseAddress(args[0]));
      break;

    case "imports":
    case "imp":
      commands.imports(ctx, args[0]);
      break;

    case "map":
      commands.map(ctx);
      break;

    case "regs":
    case "reg":
      commands.regs(ctx);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// Run if executed directly
main();
```

---

## Step 5: Create the Entry Script

**File: `dbg.ts` (in project root)**

```typescript
#!/usr/bin/env node
import "./src/debugger/index.ts";
```

That's it - just imports and runs the debugger.

---

## Step 6: Add npm Script

Add to `package.json` in the `"scripts"` section:

```json
{
  "scripts": {
    "dbg": "node --experimental-transform-types dbg.ts"
  }
}
```

Now you can run:
```bash
npm run dbg -- trace 5000
npm run dbg -- map
npm run dbg -- module 0x004a54f6
```

(The `--` is needed to pass args through npm to the script)

---

## Step 7: Test It

1. Create your `debug.config.json` from the example
2. Run each command to verify it works:

```bash
# Should show help
npm run dbg -- --help

# Should show memory map
npm run dbg -- map

# Should show register state
npm run dbg -- regs

# Should trace 100 instructions
npm run dbg -- trace 100

# Should dump memory at stub region
npm run dbg -- memory 0x00200000

# Should list imports
npm run dbg -- imports
npm run dbg -- imports kernel32
```

---

## Step 8: Clean Up (Optional)

Once the debugger CLI is working and you're happy with it:

1. Archive the old scripts:
   ```bash
   mkdir scripts/archive
   mv scripts/*.ts scripts/archive/
   ```

2. Or delete them entirely if you're confident the new tool covers everything.

---

## Implementation Order

Suggested order to implement (each step should be testable):

1. `debug.config.json.example` + `.gitignore` update
2. `src/debugger/EmulatorContext.ts`
3. `src/debugger/commands/map.ts` + test with `npm run dbg -- map`
4. `src/debugger/commands/regs.ts` + test
5. `src/debugger/commands/memory.ts` + test
6. `src/debugger/commands/module.ts` + test
7. `src/debugger/commands/imports.ts` + test
8. `src/debugger/commands/trace.ts` + test
9. `src/debugger/commands/disasm.ts` + test
10. Full CLI in `src/debugger/index.ts`
11. `dbg.ts` entry script
12. npm script

---

## Tips

- **If imports fail**: Check that the paths in `tsconfig.json` match what you're importing. The `#hardware/*` subpath imports should work.

- **If config loading fails**: Make sure `debug.config.json` is valid JSON. Use `JSON.parse()` in Node REPL to test it.

- **If EXEFile constructor fails**: The DLL paths in your config might be wrong. Check that the directories exist.

- **To add a new command**: 
  1. Create `src/debugger/commands/yourcommand.ts`
  2. Export it from `src/debugger/commands/index.ts`
  3. Add a case in the switch statement in `src/debugger/index.ts`

---

## Future Enhancements

Once the basic CLI works, you could add:

- **Breakpoints**: `dbg.ts break 0x00401000` then `dbg.ts run`
- **Watchpoints**: `dbg.ts watch 0x04000000 4` to break on memory writes
- **Stack trace**: `dbg.ts stack` to show call stack
- **Step into/over**: `dbg.ts step` vs `dbg.ts next`
- **Symbol loading**: Read debug info from PDB files
- **Interactive mode**: REPL-style interface

But start with the basics and make sure they work first!
