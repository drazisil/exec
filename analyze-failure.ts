import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

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

exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);
registerAllOpcodes(cpu);

// Load sections
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);
cpu.regs[REG.ESP] = 0x1FF00000;
cpu.regs[REG.EBP] = 0x1FF00000;

console.log("\n=== Execution Analysis ===\n");

// Run until error
let errorAddr: number | null = null;
let errorStep = 0;
for (let i = 0; i < 30; i++) {
    try {
        cpu.step();
    } catch (err: any) {
        errorStep = i;
        const match = err.message.match(/0x([0-9a-f]+)/i);
        if (match) {
            errorAddr = parseInt(match[1], 16);
        }
        break;
    }
}

console.log(`Error occurred at step ${errorStep}`);
console.log(`CPU state before failure:`);
console.log(`  EIP: 0x${cpu.eip.toString(16).padStart(8, "0")}`);
console.log(`  ESP: 0x${cpu.regs[REG.ESP].toString(16).padStart(8, "0")}`);
console.log(`  EBP: 0x${cpu.regs[REG.EBP].toString(16).padStart(8, "0")}`);

if (errorAddr) {
    console.log(`\nError accessing address: 0x${errorAddr.toString(16).padStart(8, "0")}`);
    console.log(`Memory bounds: 0x00000000-0x${(512 * 1024 * 1024 - 1).toString(16).padStart(8, "0")}`);
    console.log(`Offset from start: 0x${errorAddr.toString(16)} (${(errorAddr / (1024*1024)).toFixed(1)}MB)`);

    // Check if it's related to a register
    const possibleRegs = [
        ["EAX", cpu.regs[REG.EAX]],
        ["ECX", cpu.regs[REG.ECX]],
        ["EDX", cpu.regs[REG.EDX]],
        ["EBX", cpu.regs[REG.EBX]],
        ["ESP", cpu.regs[REG.ESP]],
        ["EBP", cpu.regs[REG.EBP]],
        ["ESI", cpu.regs[REG.ESI]],
        ["EDI", cpu.regs[REG.EDI]],
    ] as const;

    console.log(`\nRegister analysis:`);
    for (const [name, val] of possibleRegs) {
        if (mem.isValidAddress(val)) {
            console.log(`  ${name}: 0x${(val >>> 0).toString(16).padStart(8, "0")} (VALID)`);
        } else {
            console.log(`  ${name}: 0x${(val >>> 0).toString(16).padStart(8, "0")} (INVALID - out of bounds)`);
        }
    }

    // Check which DLL we're currently in
    const currentDLL = exe.importResolver.findDLLForAddress(cpu.eip);
    console.log(`\nCurrent location: ${currentDLL ? currentDLL.name : "Main executable"}`);
}
