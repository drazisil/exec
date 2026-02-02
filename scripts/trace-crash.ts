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

// Track execution
let lastEIP = 0;
let errorCount = 0;

cpu.onException((error, cpu) => {
    console.log(`\n[ERROR AT EIP 0x${(cpu.eip >>> 0).toString(16).padStart(8, '0')}]`);
    console.log(`Message: ${error.message}`);
    console.log(`Register state:`);
    console.log(`  EAX: 0x${(cpu.regs[REG.EAX] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  ECX: 0x${(cpu.regs[REG.ECX] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  EDX: 0x${(cpu.regs[REG.EDX] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  EBX: 0x${(cpu.regs[REG.EBX] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  ESP: 0x${(cpu.regs[REG.ESP] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  EBP: 0x${(cpu.regs[REG.EBP] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  ESI: 0x${(cpu.regs[REG.ESI] >>> 0).toString(16).padStart(8, '0')}`);
    console.log(`  EDI: 0x${(cpu.regs[REG.EDI] >>> 0).toString(16).padStart(8, '0')}`);

    errorCount++;
    if (errorCount >= 1) {
        cpu.halted = true;
    }
});

// Load sections into memory
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

console.log("=== Starting Trace ===");
console.log(`Initial EIP: 0x${(cpu.eip >>> 0).toString(16).padStart(8, '0')}`);
console.log(`Initial ESP: 0x${(cpu.regs[REG.ESP] >>> 0).toString(16).padStart(8, '0')}`);
console.log();

try {
    // Run 1000 steps and capture each
    for (let i = 0; i < 1000 && !cpu.halted; i++) {
        lastEIP = cpu.eip >>> 0;

        // Fetch byte at EIP to determine if we can show it
        try {
            const opcode = mem.read8(cpu.eip);
            if (opcode === 0xCC) {
                console.log(`[${i}] EIP=0x${lastEIP.toString(16).padStart(8, '0')} OPCODE=0xCC (INT3)`);
            }
        } catch (e) {
            // Silent
        }

        cpu.step();

        // Show last few instructions before crash
        if (i > 980 && i < 1000) {
            console.log(`[${i}] EIP=0x${lastEIP.toString(16).padStart(8, '0')} => 0x${(cpu.eip >>> 0).toString(16).padStart(8, '0')}`);
        }
    }
} catch (err: any) {
    console.log(`\n[FATAL ERROR] ${err.message}`);
    console.log(`Last good EIP: 0x${lastEIP.toString(16).padStart(8, '0')}`);
    console.log(`Current EIP: 0x${(cpu.eip >>> 0).toString(16).padStart(8, '0')}`);
}

console.log(`\n=== Trace Complete ===`);
console.log(`Steps executed: ${cpu.stepCount}`);
console.log(`Final EIP: 0x${(cpu.eip >>> 0).toString(16).padStart(8, '0')}`);
