import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes, setupExceptionDiagnostics, KernelStructures } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

console.log("=== Loading PE File ===\n");
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
    "/data/Downloads",
    "/data/Downloads/msvcrt",
    "/data/Downloads/kernel32",
    "/data/Downloads/ntdll",
    "/data/Downloads/user32",
    "/data/Downloads/shell32",
    "/data/Downloads/gdi32",
    "/data/Downloads/comctl32",
    "/data/Downloads/comdlg32",
    "/data/Downloads/advapi32",
    "/data/Downloads/ole32",
    "/data/Downloads/oleaut32",
    "/data/Downloads/rpcrt4",
    "/data/Downloads/dsound",
    "/data/Downloads/dinput",
    "/data/Downloads/dinput8",
    "/data/Downloads/winmm",
    "/data/Downloads/wininet",
    "/data/Downloads/wsock32",
    "/data/Downloads/version",
    "/data/Downloads/ifc22",
    "/data/Downloads/d3d8",
]);

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

// Create emulator with 1GB memory (needed for many DLLs)
const mem = new Memory(1024 * 1024 * 1024);
const cpu = new CPU(mem);

// Initialize kernel structures (TEB/PEB)
const kernelStructures = new KernelStructures(mem);
cpu.kernelStructures = kernelStructures;

// Set memory so import resolver can load DLLs
exe.importResolver.setMemory(mem);

// Pre-assign base addresses for critical system DLLs only
// This ensures they have predictable addresses for correct relocations
const dllLoader = exe.importResolver.getDLLLoader();
const criticalDLLs: [string, number][] = [
    ["ADVAPI32.dll", 0x10000000],
    ["KERNEL32.dll", 0x11000000],
    ["MSVCRT.dll", 0x12000000],
    ["NTDLL.dll", 0x13000000],
    ["USER32.dll", 0x14000000],
    ["GDI32.dll", 0x15000000],
    ["SHELL32.dll", 0x16000000],
    ["ole32.dll", 0x17000000],
    ["OLEAUT32.dll", 0x18000000],
];

for (const [dll, base] of criticalDLLs) {
    dllLoader.assignDLLBase(dll, base);
}

// Reset the next available base to just after our critical DLLs
// This prevents non-critical DLLs from claiming the same space
(dllLoader as any)._nextDLLBase = 0x19000000; // Start after oleaut32 at 0x18000000

console.log(`\n=== Pre-assigned critical system DLLs ===\n`);

// Build the IAT map by loading real DLLs
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Register all opcodes
registerAllOpcodes(cpu);

// Set up exception diagnostics
setupExceptionDiagnostics(cpu, exe.importResolver);

// Set up interrupt handler for INT 3 (breakpoint) and INT 0x20 (DOS exit)
cpu.onInterrupt((intNum, cpu) => {
    if (intNum === 0xCC || intNum === 0x03) {
        console.log(`\n[BREAKPOINT] INT3 at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
        cpu.halted = true;
    } else if (intNum === 0x20) {
        console.log(`\n[EXIT] INT 0x20 at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
        cpu.halted = true;
    } else {
        throw new Error(`Unhandled interrupt INT 0x${intNum.toString(16)} at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
    }
});

// Load sections into memory
console.log("\n=== Loading Sections ===");
let totalLoaded = 0;
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    console.log(`  ${section.name.padEnd(8)} @ 0x${vaddr.toString(16).padStart(8, "0")} (${section.data.byteLength} bytes)`);
    mem.load(vaddr, section.data);
    totalLoaded += section.data.byteLength;
}
console.log(`Total: ${totalLoaded} bytes`);

// Write IAT stubs after loading sections
exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

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

// Stack at higher memory, but below 512MB
const stackBase = 0x1FFFFFF0;
const stackLimit = 0x1FF00000;
cpu.regs[REG.ESP] = stackBase;
cpu.regs[REG.EBP] = stackBase;

// Initialize TEB/PEB with actual stack information
kernelStructures.initializeKernelStructures(stackBase, stackLimit);

console.log("\n=== Starting Emulation ===\n");
console.log(`Initial state: ${cpu.toString()}\n`);

try {
    cpu.run(100_000);
} catch (err: any) {
    console.log(`\n[ERROR] ${err.message}`);
    console.log(`State at error: ${cpu.toString()}`);
}

console.log(`\n=== Emulation Complete ===`);
console.log(`Steps executed: ${cpu.stepCount}`);
console.log(`Final state: ${cpu.toString()}`);
