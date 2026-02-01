import { EXEFile } from "./index.ts";
import { DLLLoader } from "./src/loader/DLLLoader.ts";
import { Memory } from "./src/hardware/Memory.ts";

const mem = new Memory(1024 * 1024 * 1024);
const loader = new DLLLoader(["/data/Downloads/kernel32"]);
const kernel32 = loader.loadDLL("KERNEL32.dll", mem);

if (!kernel32) {
    console.log("Failed to load KERNEL32");
    process.exit(1);
}

console.log("\n=== Relocation Verification ===\n");

// Load the DLL directly to check relocations
const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const exe = new EXEFile(dllPath);

const preferredBase = exe.optionalHeader.imageBase;
const loadedBase = kernel32.baseAddress;
const relocationDelta = (loadedBase - preferredBase) >>> 0;

console.log(`Preferred base: 0x${preferredBase.toString(16)}`);
console.log(`Loaded at: 0x${loadedBase.toString(16)}`);
console.log(`Relocation delta: 0x${relocationDelta.toString(16)}\n`);

// Pick a few relocation entries and verify they were applied
if (exe.baseRelocationTable) {
    const firstBlock = exe.baseRelocationTable.blocks[0];
    console.log(`First relocation block page: 0x${firstBlock.pageRva.toString(16)}`);
    console.log(`Entries in first block: ${firstBlock.entries.length}\n`);

    // Check first 5 relocations
    for (let i = 0; i < Math.min(5, firstBlock.entries.length); i++) {
        const entry = firstBlock.entries[i];
        const rva = firstBlock.pageRva + entry.offset;
        const relocationAddr = loadedBase + rva;

        // The file would have had this value before relocation
        const sectionWithRVA = exe.sectionHeaders.find(s =>
            rva >= s.virtualAddress && rva < s.virtualAddress + s.virtualSize
        );

        if (sectionWithRVA) {
            const offsetInSection = rva - sectionWithRVA.virtualAddress;
            const originalValue = sectionWithRVA.data.readUInt32LE(offsetInSection);
            const expectedAfterRelocation = (originalValue + relocationDelta) >>> 0;
            const actualInMemory = mem.read32(relocationAddr);

            console.log(`Entry ${i}:`);
            console.log(`  RVA: 0x${rva.toString(16).padStart(8, '0')}`);
            console.log(`  Memory address: 0x${relocationAddr.toString(16)}`);
            console.log(`  Original value in file: 0x${originalValue.toString(16).padStart(8, '0')}`);
            console.log(`  Expected after relocation: 0x${expectedAfterRelocation.toString(16).padStart(8, '0')}`);
            console.log(`  Actual in memory: 0x${actualInMemory.toString(16).padStart(8, '0')}`);
            console.log(`  Match: ${actualInMemory === expectedAfterRelocation ? "✓" : "✗"}\n`);
        }
    }
}
