import { EXEFile } from "./index";
import { Memory } from "./src/emulator/index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
]);

const mem = new Memory(1024 * 1024 * 1024);

console.log("=== Loading sections ===\n");
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    console.log(`Loading ${section.name.padEnd(8)} to 0x${vaddr.toString(16).padStart(8, '0')} (${section.data.byteLength} bytes)`);
    mem.load(vaddr, section.data);
}

const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const imageBase = exe.optionalHeader.imageBase;
const entryVA = imageBase + entryRVA;

console.log(`\n=== Verifying entry point ===`);
console.log(`Entry point VA: 0x${(entryVA >>> 0).toString(16)}`);

const readBytes: number[] = [];
for (let i = 0; i < 16; i++) {
    readBytes.push(mem.read8(entryVA + i));
}

console.log(`Read from memory: ${readBytes.map((b: number) => b.toString(16).padStart(2, '0')).join(' ')}`);
console.log(`Expected from file: 55 8b ec 6a ff 68 90 3b 1f 01 68 b8 5e 9f 00 64`);

if (readBytes[0] === 0x55 && readBytes[1] === 0x8b && readBytes[2] === 0xec) {
    console.log("\n✓ Sections loaded correctly!");
} else {
    console.log("\n✗ Section data mismatch!");
}
