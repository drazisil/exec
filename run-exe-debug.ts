import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

console.log("=== Loading PE File ===\n");
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
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

const mem = new Memory(512 * 1024 * 1024);
const cpu = new CPU(mem);

// Set memory so import resolver can load DLLs
exe.importResolver.setMemory(mem);

// Build the IAT map by loading real DLLs
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Register all opcodes
registerAllOpcodes(cpu);

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
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Write IAT stubs after loading sections
exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

// Set up CPU state
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);

// Stack at higher memory, but below 512MB
cpu.regs[REG.ESP] = 0x1FF00000;
cpu.regs[REG.EBP] = 0x1FF00000;

console.log("=== Starting Emulation (with trace) ===\n");

// Manual stepping with debug output
const maxSteps = 30;
for (let i = 0; i < maxSteps; i++) {
    const before = cpu.toString();
    try {
        cpu.step();
        console.log(`[${i}] ${before}`);
    } catch (err: any) {
        console.log(`[${i}] ${before}`);
        console.log(`\n[ERROR] ${err.message}`);

        // Try to provide context about the error address if it's an access error
        const errorMatch = err.message.match(/0x([0-9a-f]+)/i);
        if (errorMatch) {
            const addr = parseInt(errorMatch[1], 16);
            const dll = exe.importResolver.findDLLForAddress(addr);
            if (dll) {
                console.log(`        Address 0x${addr.toString(16)} is in ${dll.name}`);
                console.log(`        ${dll.name} range: 0x${dll.baseAddress.toString(16)}-0x${(dll.baseAddress + dll.size - 1).toString(16)}`);
            } else {
                console.log(`        Address 0x${addr.toString(16)} is not in any loaded DLL`);
                console.log(`        Valid DLL ranges:`);
                for (const mapping of exe.importResolver.getAddressMappings()) {
                    console.log(`          0x${mapping.baseAddress.toString(16)}-0x${mapping.endAddress.toString(16)} (${mapping.dllName})`);
                }
            }
        }
        break;
    }
}

console.log(`\n=== Stopped ===`);
console.log(`Steps executed: ${cpu.stepCount}`);
console.log(`Final state: ${cpu.toString()}`);
