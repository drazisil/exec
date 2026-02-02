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

console.log("=== Identifying Module at Crash Address ===\n");

// Build a map of which module owns which address
interface AddressRange {
    name: string;
    start: number;
    end: number;
    type: string;
}

const ranges: AddressRange[] = [];

// Add main exe sections
const exeBase = exe.optionalHeader.imageBase;
console.log(`Main EXE base: 0x${exeBase.toString(16)}\n`);

for (const section of exe.sectionHeaders) {
    const sectionStart = exeBase + section.virtualAddress;
    const sectionEnd = exeBase + section.virtualAddress + section.virtualSize;
    ranges.push({
        name: "MCity_d.exe",
        start: sectionStart,
        end: sectionEnd,
        type: section.name,
    });
    console.log(`EXE ${section.name}: 0x${sectionStart.toString(16)} - 0x${sectionEnd.toString(16)}`);
}

// Function to find which module owns an address
function findModule(addr: number): AddressRange | undefined {
    for (const range of ranges) {
        if (addr >= range.start && addr < range.end) {
            return range;
        }
    }
    return undefined;
}

// Check the crash address
const crashAddr = 0x004a54f6;
const crashModule = findModule(crashAddr);

console.log(`Crash address: 0x${crashAddr.toString(16)}`);
if (crashModule) {
    console.log(`✓ Found in: ${crashModule.name} (${crashModule.type})`);
    console.log(`  Range: 0x${crashModule.start.toString(16)} - 0x${crashModule.end.toString(16)}`);
    console.log(`  Offset: 0x${(crashAddr - crashModule.start).toString(16)}`);
} else {
    console.log(`✗ Not found in any loaded module`);
}

// Read the instruction at crash address
console.log(`\nInstruction bytes at crash point:`);
try {
    const bytes = [];
    for (let i = 0; i < 6; i++) {
        bytes.push(mem.read8(crashAddr + i).toString(16).padStart(2, '0'));
    }
    console.log(`${bytes.join(' ')}`);
    console.log(`= TEST [ECX + 0x8b000000], EAX`);
} catch (e) {
    console.log(`Error reading: ${e.message}`);
}

console.log(`\n=== All Loaded Modules ===\n`);
for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const size = (range.end - range.start) / (1024 * 1024);
    console.log(`0x${range.start.toString(16).padStart(8, '0')} - 0x${range.end.toString(16).padStart(8, '0')} (${size.toFixed(2)} MB) ${range.name} (${range.type})`);
}

console.log(`\n=== Answer ===`);
if (crashModule && crashModule.name === "MCity_d.exe") {
    console.log(`The address 0x${crashAddr.toString(16)} is REQUESTED BY THE EXE`);
} else if (crashModule) {
    console.log(`The address 0x${crashAddr.toString(16)} is REQUESTED BY: ${crashModule.name}`);
} else {
    console.log(`The address 0x${crashAddr.toString(16)} location is UNKNOWN`);
}
