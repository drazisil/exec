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

console.log("=== Initial State ===\n");
console.log(`Entry point: 0x${eip.toString(16)}`);
console.log(`Initial EIP: 0x${cpu.eip.toString(16)}`);
console.log(`Initial ESP: 0x${cpu.regs[REG.ESP].toString(16)}`);
console.log(`Initial EBP: 0x${cpu.regs[REG.EBP].toString(16)}`);
console.log(`FS register: (TEB at 0x00320000)`);

console.log("\n=== First 50 Instructions ===\n");

for (let i = 0; i < 50; i++) {
    const currentAddr = cpu.eip >>> 0;
    const currentDLL = exe.importResolver.findDLLForAddress(currentAddr);
    const location = currentDLL ? currentDLL.name : "Main executable";
    const esp = cpu.regs[REG.ESP];
    const eax = cpu.regs[REG.EAX];
    const ebp = cpu.regs[REG.EBP];

    const opcode = mem.read8(currentAddr);
    const opStr = opcode.toString(16).padStart(2, '0');

    try {
        cpu.step();

        // Print instruction info
        const stackValue = esp < 0x1FFFFFF0 ? mem.read32(esp) : 0;
        console.log(`[${String(i).padStart(2, " ")}] 0x${currentAddr.toString(16).padStart(8, "0")} (${opStr}) @ ${location.padEnd(16)} EAX=0x${eax.toString(16).padStart(8, "0")} EBP=0x${ebp.toString(16).padStart(8, "0")} [ESP]=0x${stackValue.toString(16).padStart(8, "0")}`);
    } catch (err: any) {
        console.log(`[${String(i).padStart(2, " ")}] 0x${currentAddr.toString(16).padStart(8, "0")} (${opStr}) @ ${location.padEnd(16)} ❌ CRASH`);
        console.log(`\nError: ${err.message}`);
        console.log(`\nStack contents at crash (ESP=0x${esp.toString(16).padStart(8, "0")}):`);
        for (let j = 0; j < 16; j++) {
            const addr = esp + j * 4;
            try {
                const val = mem.read32(addr);
                const valDLL = exe.importResolver.findDLLForAddress(val);
                const valLoc = valDLL ? valDLL.name : (val > 0x400000 && val < 0x40000000 ? "Main exe" : "Unknown");
                console.log(`  [0x${addr.toString(16).padStart(8, "0")}] = 0x${(val >>> 0).toString(16).padStart(8, "0")} @ ${valLoc}`);
            } catch (e) {
                console.log(`  [0x${addr.toString(16).padStart(8, "0")}] = <unreadable>`);
            }
        }
        break;
    }
}
