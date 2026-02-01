import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes, KernelStructures } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

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

const mem = new Memory(1024 * 1024 * 1024);
const cpu = new CPU(mem);

const kernelStructures = new KernelStructures(mem);
cpu.kernelStructures = kernelStructures;

exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Load sections
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Write IAT stubs
exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

registerAllOpcodes(cpu);

const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);

const stackBase = 0x1FFFFFF0;
const stackLimit = 0x1FF00000;
cpu.regs[REG.ESP] = stackBase;
cpu.regs[REG.EBP] = stackBase;

kernelStructures.initializeKernelStructures(stackBase, stackLimit);

// Trace with stack info
for (let i = 0; i < 30; i++) {
    const currentAddr = cpu.eip >>> 0;
    const currentDLL = exe.importResolver.findDLLForAddress(currentAddr);
    const location = currentDLL ? currentDLL.name : "Main executable";
    const esp = cpu.regs[REG.ESP];

    try {
        cpu.step();
        console.log(`[${String(i).padStart(2, " ")}] EIP=0x${currentAddr.toString(16).padStart(8, "0")} ESP=0x${esp.toString(16).padStart(8, "0")} @ ${location}`);
    } catch (err: any) {
        console.log(`[${String(i).padStart(2, " ")}] EIP=0x${currentAddr.toString(16).padStart(8, "0")} ESP=0x${esp.toString(16).padStart(8, "0")} @ ${location}`);
        console.log(`\nCRASH at 0x${currentAddr.toString(16)}`);
        console.log(`Error: ${err.message}`);

        // Dump stack
        console.log(`\n=== Stack Contents (ESP=0x${esp.toString(16).padStart(8, "0")}) ===`);
        for (let j = 0; j < 8; j++) {
            const stackAddr = esp + (j * 4);
            const value = mem.read32(stackAddr);
            console.log(`  [0x${stackAddr.toString(16).padStart(8, "0")}] = 0x${(value >>> 0).toString(16).padStart(8, "0")}`);
        }
        break;
    }
}
