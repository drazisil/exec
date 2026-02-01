import { EXEFile } from "./index.ts";

const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const kernel32 = new EXEFile(dllPath);

console.log("=== Checking Relocation Table ===\n");

const kernel32Base = 0x12000000;
const preferredBase = kernel32.optionalHeader.imageBase;

// The address that needs to be checked: 0x12081818
// In the file, this would be RVA: 0x081818
const targetRVA = 0x081818;
const offset = 0x18; // offset within the page

console.log(`Address in emulator: 0x12081818`);
console.log(`RVA in DLL: 0x${targetRVA.toString(16)}`);
console.log(`Page RVA: 0x${(targetRVA & ~0xFFF).toString(16)}`);
console.log(`Offset in page: 0x${offset.toString(16)}`);

// Find relocation entry for this address
if (kernel32.baseRelocationTable) {
    console.log(`\nTotal relocation blocks: ${kernel32.baseRelocationTable.blocks.length}`);

    let found = false;
    for (const block of kernel32.baseRelocationTable.blocks) {
        if (block.pageRva === (targetRVA & ~0xFFF)) {
            console.log(`\n✓ Found relocation block for page 0x${block.pageRva.toString(16)}`);
            console.log(`  Entries in block: ${block.entries.length}`);

            for (const entry of block.entries) {
                if (entry.offset === offset) {
                    console.log(`  ✓ Found entry at offset 0x${entry.offset.toString(16)}`);
                    console.log(`    Type: ${entry.type} (${entry.type === 3 ? 'HIGHLOW (32-bit)' : 'OTHER'})`);
                    found = true;
                }
            }

            if (!found) {
                console.log(`  ✗ No entry at offset 0x${offset.toString(16)}`);
                console.log(`  Available offsets:`);
                let count = 0;
                for (const entry of block.entries) {
                    if (count < 10) {
                        console.log(`    - 0x${entry.offset.toString(16)} (type ${entry.type})`);
                        count++;
                    }
                }
                if (block.entries.length > 10) {
                    console.log(`    ... and ${block.entries.length - 10} more`);
                }
            }
            break;
        }
    }

    if (!found) {
        console.log(`\n✗ No relocation block found for page 0x${(targetRVA & ~0xFFF).toString(16)}`);
    }
}

// Now check what VALUE is at 0x081818 in the file
console.log(`\n=== Checking Original Value ===`);

// Find which section contains this RVA
for (const section of kernel32.sectionHeaders) {
    const sectionStart = section.virtualAddress;
    const sectionEnd = section.virtualAddress + section.virtualSize;

    if (targetRVA >= sectionStart && targetRVA < sectionEnd) {
        const offsetInSection = targetRVA - sectionStart;
        const value = section.data.readUInt32LE(offsetInSection);

        console.log(`Found in section: ${section.name}`);
        console.log(`Offset in section: 0x${offsetInSection.toString(16)}`);
        console.log(`Value in file: 0x${(value >>> 0).toString(16)}`);
        console.log(`After relocation (delta 0xa6800000): 0x${((value + 0xa6800000) >>> 0).toString(16)}`);

        // Check if this looks like it should be relocated
        if (value >= preferredBase && value < preferredBase + 0x01000000) {
            console.log(`\n✓ This LOOKS like an address that should be relocated!`);
            console.log(`  Original points into KERNEL32 at preferred base`);
        } else {
            console.log(`\n✗ This doesn't look like a KERNEL32 address`);
            console.log(`  Preferred base is 0x${preferredBase.toString(16)}`);
            console.log(`  Value 0x${(value >>> 0).toString(16)} doesn't match that range`);
        }
    }
}
