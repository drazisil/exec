import { EXEFile } from "./index";
import { CPU, Memory, REG, registerAllOpcodes, KernelStructures } from "./src/emulator/index";

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

console.log("=== Checking KERNEL32.dll call instruction ===\n");

// Step to instruction 14 (the CALL instruction)
for (let i = 0; i < 14; i++) {
    try {
        cpu.step();
    } catch (e: any) {
        console.log(`Error at step ${i}: ${e.message}`);
        break;
    }
}

console.log(`Current EIP: 0x${cpu.eip.toString(16)}`);
console.log(`Next instruction bytes:`);
const bytes = [];
for (let i = 0; i < 20; i++) {
    try {
        bytes.push(mem.read8(cpu.eip + i).toString(16).padStart(2, '0'));
    } catch (e) {
        bytes.push('??');
    }
}
console.log(`  ${bytes.join(' ')}`);

// Check what the CALL instruction does
console.log(`\nAnalyzing CALL at 0x${cpu.eip.toString(16)}:`);
const opcode = mem.read8(cpu.eip);
console.log(`Opcode: 0x${opcode.toString(16)}`);

if (opcode === 0xFF) {
    // ModR/M byte
    const modrm = mem.read8(cpu.eip + 1);
    console.log(`ModR/M: 0x${modrm.toString(16)}`);

    const mod = (modrm >> 6) & 0x3;
    const reg = (modrm >> 3) & 0x7;
    const rm = modrm & 0x7;

    console.log(`  mod=${mod}, reg=${reg}, rm=${rm}`);

    if (reg === 2) {
        console.log(`  Instruction: CALL [indirect]`);
    } else if (reg === 4) {
        console.log(`  Instruction: JMP [indirect]`);
    }

    // Extract the address being called
    if (mod === 0 && rm === 5) {
        // Direct address
        const addr = mem.read32(cpu.eip + 2);
        console.log(`\nDirect address: 0x${(addr >>> 0).toString(16)}`);

        // Check what's at that address
        const val = mem.read32(addr);
        console.log(`Value at that address: 0x${(val >>> 0).toString(16)}`);

        const valDLL = exe.importResolver.findDLLForAddress(val);
        console.log(`Points to: ${valDLL ? valDLL.name : "Main exe or unknown"}`);
    }
}

// Execute and see what happens
console.log(`\n=== Stepping once more to execute CALL ===`);
try {
    cpu.step();
    console.log(`After CALL: EIP=0x${cpu.eip.toString(16)}`);
} catch (e: any) {
    console.log(`CRASH: ${e.message}`);
    console.log(`EIP at crash: 0x${cpu.eip.toString(16)}`);
}
