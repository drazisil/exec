import { EXEFile } from "./index.ts";
import { Memory } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

const mem = new Memory(2 * 1024 * 1024 * 1024);

// Load sections
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

const crashAddr = 0x004a54f6;

console.log("=== Decoding Crash Instruction ===\n");
console.log(`Address: 0x${crashAddr.toString(16)}\n`);

const bytes = [];
for (let i = 0; i < 6; i++) {
    bytes.push(mem.read8(crashAddr + i));
}

console.log(`Raw bytes: ${bytes.map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`Hex string: ${Buffer.from(bytes).toString("hex")}\n`);

// Decode manually
const byte0 = bytes[0]; // 0x85
const byte1 = bytes[1]; // 0xa1
const byte2 = bytes[2]; // 0x00
const byte3 = bytes[3]; // 0x00
const byte4 = bytes[4]; // 0x00
const byte5 = bytes[5]; // 0x8b

console.log("=== Instruction Decode ===\n");
console.log(`Byte 0: 0x${byte0.toString(16)} = TEST opcode (r/m32, r32)`);
console.log(`Byte 1: 0x${byte1.toString(16)} = ModR/M byte`);
console.log(`  Bytes 2-5: 0x${byte2.toString(16)}${byte3.toString(16)}${byte4.toString(16)}${byte5.toString(16)} = 32-bit displacement\n`);

// Parse ModR/M
const modrm = byte1;
const mod = (modrm >> 6) & 0x3;
const reg = (modrm >> 3) & 0x7;
const rm = modrm & 0x7;

const regNames = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"];

console.log(`ModR/M breakdown (0x${modrm.toString(16)}):`);
console.log(`  mod = ${mod} = ${["[reg]", "[reg+disp8]", "[reg+disp32]", "reg"][""]}`);
console.log(`  reg = ${reg} = ${regNames[reg]} (source operand)`);
console.log(`  r/m = ${rm} = ${regNames[rm]} (destination operand)\n`);

// Parse displacement (little-endian)
const disp32LE = Buffer.from([byte2, byte3, byte4, byte5]).readUInt32LE(0);
console.log(`Displacement (little-endian): 0x${(disp32LE >>> 0).toString(16)}`);

console.log(`\n=== Full Instruction ===\n`);

if (mod === 2 && rm === 1) {
    // [ECX + disp32]
    console.log(`TEST [ECX + 0x${(disp32LE >>> 0).toString(16)}], ${regNames[reg]}`);
    console.log(`\nWith ECX = 0x00000000:`);
    console.log(`  Address accessed = 0x00000000 + 0x${(disp32LE >>> 0).toString(16)} = 0x${(disp32LE >>> 0).toString(16)}`);
    console.log(`\nThis address (0x${(disp32LE >>> 0).toString(16)}) is in kernel-mode space!`);
    console.log(`Result: CPU raises EXCEPTION_ACCESS_VIOLATION`);
}

console.log(`\n=== Analysis ===\n`);
console.log(`The value 0x${(disp32LE >>> 0).toString(16)} is a LITERAL in the machine code.`);
console.log(`This is an absolute memory address hardcoded by the compiler/linker.`);
console.log(`\nPossible origins:`);
console.log(`1. Compiler generated this to test a specific hardware address`);
console.log(`2. Assembly code inline in the source`);
console.log(`3. Data layout / object structure offset`);
console.log(`4. Pointer that was supposed to be relocated (relocation error)`);
console.log(`5. Graphics/hardware memory reference (AGP VRAM)`);
