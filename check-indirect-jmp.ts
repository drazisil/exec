import { EXEFile } from "./index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Checking relocation at 0xa54f0 ===\n");

// Find which section contains 0xa54f0
const targetAddr = 0xa54f0;
const imageBase = exe.optionalHeader.imageBase;

console.log(`Target address: 0x${targetAddr.toString(16)}`);
console.log(`Image base: 0x${imageBase.toString(16)}`);

// Calculate RVA
const rva = targetAddr - imageBase;
console.log(`As RVA: 0x${rva.toString(16)}`);

// Find section
for (const section of exe.sectionHeaders) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.virtualSize) {
        console.log(`\nFound in section: ${section.name}`);
        console.log(`  VA: 0x${section.virtualAddress.toString(16)}`);
        console.log(`  Size: 0x${section.virtualSize.toString(16)}`);
        console.log(`  Offset in section: 0x${(rva - section.virtualAddress).toString(16)}`);

        const offset = rva - section.virtualAddress;
        console.log(`\nData at that location:`);
        const sectionData = section.data;
        console.log(`  Bytes: ${Array.from(sectionData.slice(offset, offset + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        break;
    }
}

// Now check what's being pointed to FROM 0x17081818
console.log(`\n=== Checking pointer at 0x17081818 ===`);
console.log(`This address is in KERNEL32.dll`);
console.log(`It contains: 0xa54f0`);
console.log(`0xa54f0 = main exe address`);

// The question is: where should it point?
console.log(`\n=== Finding the actual target ===`);
console.log(`Looking for exports/functions that might be referenced here...`);

// This appears to be an IAT entry or jump table
// The issue might be that this is NOT a relocation in KERNEL32, but rather
// an entry that should have been filled in by the import resolver
