import { EXEFile } from "./index";
import { Memory } from "./src/emulator/index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Section Loading Verification ===\n");

const imageBase = exe.optionalHeader.imageBase;
const mem = new Memory(2 * 1024 * 1024 * 1024);

console.log(`Image Base: 0x${imageBase.toString(16)}\n`);

let totalVirtualSize = 0;
let totalLoadedSize = 0;

for (const section of exe.sectionHeaders) {
    const vaddr = imageBase + section.virtualAddress;
    const virtualEnd = vaddr + section.virtualSize;
    const dataSize = section.data.byteLength;
    const uninitSize = section.virtualSize - dataSize;

    totalVirtualSize += section.virtualSize;
    totalLoadedSize += dataSize;

    console.log(`${section.name.padEnd(8)}`);
    console.log(`  VA Range:   0x${vaddr.toString(16).padStart(8, '0')} - 0x${virtualEnd.toString(16).padStart(8, '0')} (0x${section.virtualSize.toString(16)} bytes virtual)`);
    console.log(`  Loaded:     0x${dataSize.toString(16)} bytes`);
    if (uninitSize > 0) {
        console.log(`  Uninit:     0x${uninitSize.toString(16)} bytes (auto-zeroed)`);
    }

    // Load into memory
    mem.load(vaddr, section.data);

    // Verify what we loaded
    try {
        const firstBytes = [];
        for (let i = 0; i < Math.min(16, dataSize); i++) {
            firstBytes.push(mem.read8(vaddr + i).toString(16).padStart(2, '0'));
        }
        console.log(`  First bytes: ${firstBytes.join(' ')}`);
    } catch (e) {
        console.log(`  ❌ Error reading back data`);
    }

    console.log();
}

console.log(`=== Totals ===`);
console.log(`Total virtual size:  0x${totalVirtualSize.toString(16)} bytes (${(totalVirtualSize / (1024 * 1024)).toFixed(2)} MB)`);
console.log(`Total loaded size:   0x${totalLoadedSize.toString(16)} bytes (${(totalLoadedSize / (1024 * 1024)).toFixed(2)} MB)`);
console.log(`Uninitialized:       0x${(totalVirtualSize - totalLoadedSize).toString(16)} bytes (${((totalVirtualSize - totalLoadedSize) / (1024 * 1024)).toFixed(2)} MB)`);

console.log(`\n=== Memory Check at Crash Address ===`);
const crashAddr = 0x004a54f6;
console.log(`Crash address: 0x${crashAddr.toString(16)}`);

try {
    const bytes = [];
    for (let i = 0; i < 16; i++) {
        bytes.push(mem.read8(crashAddr + i).toString(16).padStart(2, '0'));
    }
    console.log(`Data at crash address: ${bytes.join(' ')}`);
    console.log(`✓ Memory is readable at crash point`);
} catch (e) {
    console.log(`❌ Cannot read at crash address: ${e.message}`);
}

console.log(`\n=== Checking for gaps in memory ===`);
let lastEnd = imageBase;
for (const section of exe.sectionHeaders) {
    const vaddr = imageBase + section.virtualAddress;
    if (vaddr > lastEnd) {
        const gapSize = vaddr - lastEnd;
        console.log(`Gap: 0x${lastEnd.toString(16)} - 0x${vaddr.toString(16)} (0x${gapSize.toString(16)} bytes)`);
    }
    lastEnd = vaddr + section.virtualSize;
}
console.log(`Final address: 0x${lastEnd.toString(16)}`);
