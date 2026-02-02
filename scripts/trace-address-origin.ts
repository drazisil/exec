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

console.log("=== Tracing Address 0x8b000000 Origin ===\n");

// The crash address
const crashAddr = 0x004a54f6;

// Read the instruction
const byte0 = mem.read8(crashAddr);
const byte1 = mem.read8(crashAddr + 1);
const byte2 = mem.read8(crashAddr + 2);
const byte3 = mem.read8(crashAddr + 3);
const byte4 = mem.read8(crashAddr + 4);
const byte5 = mem.read8(crashAddr + 5);

console.log(`Instruction at 0x${crashAddr.toString(16)}:`);
console.log(`Bytes: ${[byte0, byte1, byte2, byte3, byte4, byte5].map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`Opcode: 0x${byte0.toString(16).padStart(2, "0")} = TEST (r/m32, r32)`);
console.log(`ModR/M: 0x${byte1.toString(16).padStart(2, "0")}`);

const modrm = byte1;
const mod = (modrm >> 6) & 0x3;
const reg = (modrm >> 3) & 0x7;
const rm = modrm & 0x7;

console.log(`  mod=${mod}, reg=${reg}, rm=${rm}`);

// Parse displacement
if (mod === 2) {
    // 32-bit displacement follows
    const disp32 = mem.read32(crashAddr + 2);
    console.log(`\nThis is a [reg + disp32] addressing mode`);
    console.log(`Displacement (32-bit): 0x${(disp32 >>> 0).toString(16)}`);
    console.log(`Register (from ModR/M reg field): ECX (reg=${reg})`);

    if ((disp32 >>> 0) === 0x8b000000) {
        console.log(`\n✓ FOUND IT! The value 0x8b000000 is HARDCODED in the instruction!`);
        console.log(`It's a 32-bit displacement in the assembled machine code.`);

        // Calculate the actual file offset
        const textSectionStart = 0x401000;
        const offsetInText = crashAddr - textSectionStart;

        console.log(`\nInstruction location:`);
        console.log(`  Virtual address: 0x${crashAddr.toString(16)}`);
        console.log(`  Offset in .text: 0x${offsetInText.toString(16)}`);

        console.log(`\nThis hardcoded displacement might be:`);
        console.log(`1. A base address from a configuration or init code`);
        console.log(`2. Graphics card VRAM address mapping (common in old DirectX games)`);
        console.log(`3. Hardware device memory address (sound card, 3D accelerator, etc.)`);
        console.log(`4. Video memory for Direct3D or DirectSound operations`);
        console.log(`5. Game engine object heap or resource cache`);
        console.log(`6. Anti-cheat detection code checking for specific memory layout`);

        console.log(`\n=== Where Could This Address Come From? ===\n`);

        // Search for this value in the executable
        console.log(`Searching for 0x8b000000 in executable sections...`);
        let foundCount = 0;

        for (const section of exe.sectionHeaders) {
            const sectionStart = exe.optionalHeader.imageBase + section.virtualAddress;
            const sectionEnd = sectionStart + section.virtualSize;

            // Check if this is in the .data section or similar
            if (section.virtualSize > 0) {
                // We'll check the loaded data
                for (let i = 0; i < section.data.byteLength - 3; i++) {
                    const val = section.data[i] | (section.data[i+1] << 8) | (section.data[i+2] << 16) | (section.data[i+3] << 24);
                    if ((val >>> 0) === 0x8b000000) {
                        foundCount++;
                        const addr = sectionStart + i;
                        console.log(`  Found at: 0x${addr.toString(16)} (${section.name} + 0x${i.toString(16)})`);
                        if (foundCount >= 5) {
                            console.log(`  ... and possibly more`);
                            break;
                        }
                    }
                }
                if (foundCount >= 5) break;
            }
        }

        if (foundCount === 0) {
            console.log(`  Not found as static data - it's only in code as an immediate value`);
        }

        console.log(`\nTotal occurrences: ${foundCount}`);
    }
}

console.log(`\n=== Hypothesis ===\n`);
console.log(`The address 0x8b000000 is hardcoded in the game's executable.`);
console.log(`It's likely a reference to:`);
console.log(`- AGP aperture or VRAM base address (common for 3D graphics in old games)`);
console.log(`- DirectX device memory mapping`);
console.log(`- Old graphics card memory ranges that were standardized in the era`);
console.log(`\nMotor City Online is from 2001. In that era, graphics memory was often`);
console.log(`accessed at fixed addresses. DirectX or the game engine might have`);
console.log(`expected this memory to be mapped. Since it's not allocated in our`);
console.log(`emulator, the game crashes when it tries to access it.`);
