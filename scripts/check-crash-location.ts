import { EXEFile } from "./index";
import { Memory } from "./src/hardware/Memory";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, ["/home/drazisil/mco-source/MCity"]);

const mem = new Memory(1024 * 1024 * 1024);

console.log("=== Crash Address 0x000a54f0 Analysis ===\n");

const crashAddr = 0x000a54f0;
const imageBase = exe.optionalHeader.imageBase;
const crashRVA = crashAddr - imageBase;

console.log(`Crash VA: 0x${crashAddr.toString(16)}`);
console.log(`Image base: 0x${imageBase.toString(16)}`);
console.log(`Crash RVA: 0x${crashRVA.toString(16)}`);

// Load sections to check
for (const section of exe.sectionHeaders) {
    const vaddr = imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Check what's at the crash address
const opcode = mem.read8(crashAddr);
const nextBytes = [];
for (let i = 0; i < 16; i++) {
    nextBytes.push(mem.read8(crashAddr + i));
}

console.log(`\nOpcode at crash: 0x${opcode.toString(16).padStart(2, '0')}`);
console.log(`Next 16 bytes: ${nextBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

if (opcode === 0x00) {
    console.log("\n⚠ This is a NULL byte - possibly uninitialized data or a padding area");
    console.log("Could indicate:");
    console.log("  1. Bad pointer/address calculation");
    console.log("  2. Stack corruption");
    console.log("  3. Jump into data section instead of code");
}
