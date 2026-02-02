import { EXEFile } from "./index";
import { CPU, Memory, REG, registerAllOpcodes, setupExceptionDiagnostics, KernelStructures } from "./src/emulator/index";

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
    "/data/Downloads/kernelbase(1)",
    "/data/Downloads/api-ms-win-core-apiquery-l1-1-0",
    "/data/Downloads/api-ms-win-core-console-l1-1-0",
    "/data/Downloads/api-ms-win-core-datetime-l1-1-0",
    "/data/Downloads/api-ms-win-core-errorhandling-l1-1-1",
    "/data/Downloads/api-ms-win-core-namedpipe-l1-1-0",
    "/data/Downloads/api-ms-win-core-processthreads-l1-1-0",
    "/data/Downloads/api-ms-win-core-processthreads-l1-1-2",
    "/data/Downloads/api-ms-win-core-profile-l1-1-0",
    "/data/Downloads/api-ms-win-core-rtlsupport-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-ansi-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-l1-2-0",
    "/data/Downloads/api-ms-win-core-sysinfo-l1-2-1",
    "/data/Downloads/api-ms-win-core-util-l1-1-0",
]);

// Create memory with 2GB
const mem = new Memory(2 * 1024 * 1024 * 1024);
const cpu = new CPU(mem);

// Initialize kernel structures
const kernelStructures = new KernelStructures(mem);
cpu.kernelStructures = kernelStructures;

// Set memory so import resolver can load DLLs
exe.importResolver.setMemory(mem);

// Build the IAT map
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Register opcodes
registerAllOpcodes(cpu);

// Set up exception diagnostics
setupExceptionDiagnostics(cpu, exe.importResolver);

// Track errors
let errorCount = 0;
cpu.onException((error, cpu) => {
    errorCount++;
    console.log(`[EXCEPTION ${errorCount}] ${error.message}`);
    if (errorCount >= 1) {
        cpu.halted = true;
    }
});

// Load sections into memory
console.log("=== Loading Sections ===");
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Write IAT stubs
exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

// Set up CPU state
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);

// Stack at top of allocated memory
const memSize = mem.size;
const stackBase = memSize - 16;
const stackLimit = memSize - (128 * 1024);
cpu.regs[REG.ESP] = stackBase >>> 0;
cpu.regs[REG.EBP] = stackBase >>> 0;

// Initialize kernel structures
kernelStructures.initializeKernelStructures(stackBase, stackLimit);

console.log("\n=== Looking for crash instruction at 0x4a54fc ===");
const crashAddr = 0x004a54fc;
const imageBase = exe.optionalHeader.imageBase;

// Convert to RVA
const rva = crashAddr - imageBase;
console.log(`Crash address: 0x${crashAddr.toString(16).padStart(8, '0')}`);
console.log(`Image base: 0x${imageBase.toString(16).padStart(8, '0')}`);
console.log(`RVA: 0x${rva.toString(16).padStart(8, '0')}`);

// Find which section
const section = exe.sectionHeaders.find(s =>
    rva >= s.virtualAddress &&
    rva < s.virtualAddress + s.data.byteLength
);

if (section) {
    console.log(`Found in section: ${section.name}`);
    const offsetInSection = rva - section.virtualAddress;
    console.log(`Offset in section: 0x${offsetInSection.toString(16).padStart(8, '0')}`);

    // Get the bytes
    const bytes: number[] = [];
    for (let i = 0; i < 32 && offsetInSection + i < section.data.byteLength; i++) {
        bytes.push(section.data[offsetInSection + i]);
    }

    console.log(`\nBytes at crash location:`);
    console.log(bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));

    // Try to disassemble
    console.log(`\nDisassembly (first bytes):`);
    console.log(`0x${crashAddr.toString(16).padStart(8, '0')}: ${disassemble(bytes)}`);
}

// Helper to disassemble basic x86
function disassemble(bytes: number[]): string {
    if (bytes.length === 0) return "???";

    const opcodes: any = {
        0x55: "PUSH EBP",
        0x8B: "MOV (ModR/M follows)",
        0x6A: "PUSH imm8",
        0xFF: "JMP/CALL (ModR/M follows)",
        0x50: "PUSH EAX",
        0x51: "PUSH ECX",
        0x52: "PUSH EDX",
        0x53: "PUSH EBX",
        0x54: "PUSH ESP",
        0x56: "PUSH ESI",
        0x57: "PUSH EDI",
        0x90: "NOP",
        0xCC: "INT3",
        0xC3: "RET",
    };

    const byte0 = bytes[0];
    if (opcodes[byte0]) {
        return opcodes[byte0];
    }

    return `UNKNOWN 0x${byte0.toString(16).padStart(2, '0')}`;
}
