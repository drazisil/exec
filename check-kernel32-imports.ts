import { EXEFile } from "./index.ts";

const kernel32 = new EXEFile("/data/Downloads/kernel32/kernel32.dll");

console.log("=== KERNEL32.dll Imports ===\n");

if (kernel32.importTable) {
    console.log(`Total imported DLLs: ${kernel32.importTable.descriptors.length}\n`);

    for (const descriptor of kernel32.importTable.descriptors) {
        console.log(`From: ${descriptor.dllName}`);
        console.log(`  Functions imported: ${descriptor.entries.length}`);

        // Show first few
        for (let i = 0; i < Math.min(5, descriptor.entries.length); i++) {
            const entry = descriptor.entries[i];
            console.log(`    - ${entry.name}`);
        }

        if (descriptor.entries.length > 5) {
            console.log(`    ... and ${descriptor.entries.length - 5} more`);
        }

        // Check the IAT RVAs
        const firstEntry = descriptor.entries[0];
        if (firstEntry) {
            console.log(`  IAT RVA range: 0x${firstEntry.iatRva.toString(16)} to 0x${(firstEntry.iatRva + descriptor.entries.length * 4 - 4).toString(16)}`);
        }

        console.log();
    }
} else {
    console.log("No import table found!");
}

// Now check: does 0x081818 fall in the IAT?
console.log("\n=== Checking if 0x081818 is in IAT ===\n");

if (kernel32.importTable) {
    const targetRVA = 0x081818;

    for (const descriptor of kernel32.importTable.descriptors) {
        for (const entry of descriptor.entries) {
            const iatStart = entry.iatRva;
            const iatEnd = entry.iatRva; // Each entry is one pointer (4 bytes)

            if (targetRVA === entry.iatRva) {
                console.log(`✓ Found! 0x${targetRVA.toString(16)} is the IAT entry for:`);
                console.log(`  DLL: ${descriptor.dllName}`);
                console.log(`  Function: ${entry.name}`);
                console.log(`  IAT RVA: 0x${entry.iatRva.toString(16)}`);
            }
        }
    }
}
