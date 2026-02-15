import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes, setupExceptionDiagnostics, KernelStructures, Win32Stubs, registerCRTStartupStubs, patchCRTInternals } from "./src/emulator/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Resolve exe path: CLI arg takes priority, then emulator.json, then error
let exePath: string = process.argv[2] ?? "";
if (!exePath) {
    try {
        const cfg = JSON.parse(readFileSync(join(process.cwd(), "emulator.json"), "utf8"));
        exePath = (cfg.exePath as string) ?? "";
    } catch { /* emulator.json optional */ }
}
if (!exePath) {
    throw new Error("No exe path specified. Pass as CLI argument or set 'exePath' in emulator.json");
}

console.log("=== Loading PE File ===\n");
const exe = new EXEFile(exePath, []);

console.log(`Entry point RVA: 0x${exe.optionalHeader.addressOfEntryPoint.toString(16)}`);
console.log(`Image base: 0x${exe.optionalHeader.imageBase.toString(16)}`);
console.log(`Sections: ${exe.sectionHeaders.length}`);

// Find which section contains entry point
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const entrySection = exe.sectionHeaders.find(s =>
    entryRVA >= s.virtualAddress &&
    entryRVA < s.virtualAddress + s.virtualSize
);
console.log(`Entry point in section: ${entrySection?.name || "NOT FOUND"}`);

// Create emulator with 2GB memory (needed for DLLs + game heap allocation)
// The game appears to expect memory at high addresses for heap/data allocation
const mem = new Memory(2 * 1024 * 1024 * 1024);
const cpu = new CPU(mem);

// Initialize kernel structures (TEB/PEB)
const kernelStructures = new KernelStructures(mem);
cpu.kernelStructures = kernelStructures;

// Set memory so import resolver can load DLLs
exe.importResolver.setMemory(mem);

// Build the IAT map by loading real DLLs (Windows-style preferred base loading)
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Register all opcodes
registerAllOpcodes(cpu);

// Set up Win32 API stubs (must be before exception diagnostics and interrupt handlers)
const win32Stubs = new Win32Stubs(mem);
registerCRTStartupStubs(win32Stubs, mem);

// Set up exception diagnostics
setupExceptionDiagnostics(cpu, exe.importResolver);

// Install Win32 stub interrupt handler (INT 0xFE) - must be after exception diagnostics
// since it chains to any previous interrupt handler
win32Stubs.install(cpu);

// Load sections into memory
console.log("\n=== Loading Sections ===");
let totalLoaded = 0;
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    console.log(`  ${section.name.padEnd(8)} @ 0x${vaddr.toString(16).padStart(8, "0")} (${section.data.byteLength} bytes, virtual size: ${section.virtualSize} bytes)`);
    mem.load(vaddr, section.data);
    totalLoaded += section.data.byteLength;

    // Zero-initialize any uninitialized portion of the section
    if (section.virtualSize > section.data.byteLength) {
        const uninitSize = section.virtualSize - section.data.byteLength;
        console.log(`    Note: Section has ${uninitSize} bytes of uninitialized data (auto-zeroed)`);
    }
}
console.log(`Total loaded: ${totalLoaded} bytes`);

// Write IAT entries after loading sections (stubs override real DLL addresses)
exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable, win32Stubs);

// Patch internal CRT functions that can't be intercepted via IAT
patchCRTInternals(win32Stubs);

// Set up CPU state
// Entry point is an RVA; find its actual memory address
if (!entrySection) {
    throw new Error(`Entry point RVA 0x${entryRVA.toString(16)} not in any section!`);
}
// RVA (Relative Virtual Address) is already relative to imageBase
// So we just add them directly
const eip = exe.optionalHeader.imageBase + entryRVA;
console.log(`DEBUG: Setting EIP = imageBase(${exe.optionalHeader.imageBase}) + entryRVA(${entryRVA}) = ${eip} (0x${(eip >>> 0).toString(16)})`);
cpu.eip = (eip >>> 0);

// Write a HLT instruction at a sentinel address so when mainCRTStartup returns,
// it hits HLT instead of executing from address 0
const SENTINEL_ADDR = 0x001FF000;  // Just below stub region
mem.write8(SENTINEL_ADDR, 0xF4);   // HLT opcode

// Stack at top of allocated memory
const memSize = mem.size;
const stackBase = memSize - 16;  // Leave some headroom
const stackLimit = memSize - (128 * 1024);  // 128KB stack
cpu.regs[REG.ESP] = stackBase >>> 0;
cpu.regs[REG.EBP] = stackBase >>> 0;

// Push sentinel return address so mainCRTStartup returns to HLT
cpu.regs[REG.ESP] -= 4;
mem.write32(cpu.regs[REG.ESP], SENTINEL_ADDR);

// Initialize TEB/PEB with actual stack information
kernelStructures.initializeKernelStructures(stackBase, stackLimit);

console.log("\n=== Starting Emulation ===\n");
console.log(`Initial state: ${cpu.toString()}\n`);

// Build a set of valid EIP ranges (sections + DLL ranges + stub region)
const validRanges: Array<[number, number, string]> = [];

// Main exe sections
for (const section of exe.sectionHeaders) {
    const start = exe.optionalHeader.imageBase + section.virtualAddress;
    const end = start + section.virtualSize;
    validRanges.push([start, end, `exe:${section.name}`]);
}

// DLL ranges
console.log("\n=== DLL Address Mappings ===");
for (const mapping of exe.importResolver.getAddressMappings()) {
    validRanges.push([mapping.baseAddress, mapping.endAddress, `dll:${mapping.dllName}`]);
    console.log(`  0x${mapping.baseAddress.toString(16).padStart(8,'0')}-0x${mapping.endAddress.toString(16).padStart(8,'0')} ${mapping.dllName}`);
}

// Stub region: MAX_STUBS (4096) × STUB_SIZE (32) = 0x20000 bytes from STUB_BASE
validRanges.push([0x00200000, 0x00220000, "stubs"]);
// Sentinel HLT address
validRanges.push([SENTINEL_ADDR, SENTINEL_ADDR + 1, "sentinel-hlt"]);
// Thread sentinel address
validRanges.push([0x001FE000, 0x001FE004, "thread-sentinel"]);
// Thread stack region
validRanges.push([0x05000000, 0x05100000, "thread-stacks"]);

function isValidEIP(eip: number): string | null {
    for (const [start, end, name] of validRanges) {
        if (eip >= start && eip < end) return name;
    }
    return null;
}

cpu.enableTrace(5000);

let lastValidStep = 0;
let lastValidEIP = 0;
let lastValidRegion = "";
let detectedRunaway = false;

try {
    // Custom run loop with EIP validity checking
    const maxSteps = 500_000_000;
    let stepCount = 0;
    while (!cpu.halted && stepCount < maxSteps) {
        const eipBefore = cpu.eip;
        cpu.step();
        stepCount++;

        const region = isValidEIP(cpu.eip);
        if (region) {
            lastValidStep = stepCount;
            lastValidEIP = eipBefore;
            lastValidRegion = region;
        } else if (!detectedRunaway && stepCount > 100) {
            // EIP is outside all valid regions - this is the transition point
            detectedRunaway = true;
            console.log(`\n!!! RUNAWAY DETECTED at step ${stepCount} !!!`);
            console.log(`  Current EIP: 0x${(cpu.eip >>> 0).toString(16).padStart(8, "0")} (INVALID)`);
            console.log(`  Last valid step: ${lastValidStep}, EIP: 0x${(lastValidEIP >>> 0).toString(16).padStart(8, "0")} in ${lastValidRegion}`);
            console.log(`  State: ${cpu.toString()}`);

            // Dump bytes at current EIP
            const bytes: string[] = [];
            for (let i = 0; i < 16; i++) {
                bytes.push(cpu.memory.read8(cpu.eip + i).toString(16).padStart(2, "0"));
            }
            console.log(`  Bytes at EIP: ${bytes.join(" ")}`);

            // Continue for a few more steps to see the pattern, then stop
            const extraSteps = 20;
            for (let i = 0; i < extraSteps && !cpu.halted; i++) {
                cpu.step();
                stepCount++;
            }
            break;
        }
    }
    if (stepCount >= maxSteps) {
        console.log(`Execution limit reached (${maxSteps} steps)`);
    }
} catch (err: any) {
    console.log(`\n[ERROR] ${err.message}`);
    console.log(`State at error: ${cpu.toString()}`);
    if (detectedRunaway) {
        console.log(`  (Runaway was detected at step ${lastValidStep + 1})`);
    }
}

// Dump stub call log
console.log(`\n--- Win32 Stub Call Log (last 50) ---`);
for (const call of win32Stubs.getCallLog()) {
    console.log(`  ${call}`);
}

// Dump trace on halt/error
console.log(`\n--- Instruction Trace (last 200) ---`);
for (const line of cpu.dumpTrace()) {
    console.log(`  ${line}`);
}

console.log(`\n=== Emulation Complete ===`);
console.log(`Steps executed: ${cpu.stepCount}`);
console.log(`Final state: ${cpu.toString()}`);
