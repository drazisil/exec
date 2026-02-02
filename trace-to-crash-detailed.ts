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

const mem = new Memory(2 * 1024 * 1024 * 1024);
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

exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);
registerAllOpcodes(cpu);

// Setup state
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);

const stackBase = 0x1FFFFFF0;
const stackLimit = 0x1FF00000;
cpu.regs[REG.ESP] = stackBase;
cpu.regs[REG.EBP] = stackBase;

kernelStructures.initializeKernelStructures(stackBase, stackLimit);

console.log("=== Tracing to crash at 0x8b000000 ===\n");

// Add a custom exception handler to capture the crash
let crashInstruction = 0;
const originalHandler = cpu.onException.bind(cpu);
cpu.onException = (callback) => {
    // Intercept to get our info first
    callback((code, cpu) => {
        console.log(`\n✗ CRASH: ${code}`);
        console.log(`At instruction attempt #${cpu.stepCount}`);
        console.log(`EIP: 0x${cpu.eip.toString(16)}`);
        console.log(`Registers at crash:`);
        console.log(`  EAX: 0x${cpu.regs[REG.EAX].toString(16)}`);
        console.log(`  EBX: 0x${cpu.regs[REG.EBX].toString(16)}`);
        console.log(`  ECX: 0x${cpu.regs[REG.ECX].toString(16)}`);
        console.log(`  EDX: 0x${cpu.regs[REG.EDX].toString(16)}`);
        console.log(`  ESI: 0x${cpu.regs[REG.ESI].toString(16)}`);
        console.log(`  EDI: 0x${cpu.regs[REG.EDI].toString(16)}`);
        console.log(`  EBP: 0x${cpu.regs[REG.EBP].toString(16)}`);
        console.log(`  ESP: 0x${cpu.regs[REG.ESP].toString(16)}`);
    });
    originalHandler(callback);
};

try {
    cpu.run(100_000);
} catch (e) {
    // Handler already logged it
}
