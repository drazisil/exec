import * as fs from "fs";

const kernel32Path = "/data/Downloads/kernel32/kernel32.dll";

if (!fs.existsSync(kernel32Path)) {
    console.log(`KERNEL32.dll not found at ${kernel32Path}`);
    process.exit(1);
}

const data = fs.readFileSync(kernel32Path);

// Parse PE header
const dosHeader = data.readUInt16LE(0);
if (dosHeader !== 0x5a4d) {
    console.log("Not a PE file");
    process.exit(1);
}

const peOffset = data.readUInt32LE(0x3c);
const peSignature = data.readUInt32LE(peOffset);
const machineType = data.readUInt16LE(peOffset + 4);
const numberOfSections = data.readUInt16LE(peOffset + 6);
const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
const optionalHeaderOffset = peOffset + 24;

const imageBase = data.readUInt32LE(optionalHeaderOffset + 28);
const sectionHeaderOffset = optionalHeaderOffset + optionalHeaderSize;

console.log(`=== KERNEL32.dll Analysis ===`);
console.log(`PE Offset: 0x${peOffset.toString(16)}`);
console.log(`Image Base: 0x${imageBase.toString(16)}`);
console.log(`Number of sections: ${numberOfSections}`);

// Find .reloc section
for (let i = 0; i < numberOfSections; i++) {
    const sectionOffset = sectionHeaderOffset + i * 40;
    const nameBytes = data.slice(sectionOffset, sectionOffset + 8);
    const name = nameBytes.toString('utf8').replace(/\0/g, '');
    const virtualSize = data.readUInt32LE(sectionOffset + 8);
    const virtualAddress = data.readUInt32LE(sectionOffset + 12);
    const rawSize = data.readUInt32LE(sectionOffset + 16);
    const rawPointer = data.readUInt32LE(sectionOffset + 20);

    if (name === ".reloc") {
        console.log(`\nFound .reloc section:`);
        console.log(`  VA: 0x${virtualAddress.toString(16)}`);
        console.log(`  Size: 0x${virtualSize.toString(16)}`);
        console.log(`  Raw Pointer: 0x${rawPointer.toString(16)}`);

        // Parse relocations
        let offset = rawPointer;
        const relocEndOffset = rawPointer + rawSize;
        let relocCount = 0;

        while (offset < relocEndOffset && relocCount < 50) {
            const pageRVA = data.readUInt32LE(offset);
            const blockSize = data.readUInt32LE(offset + 4);

            if (blockSize === 0) break;

            console.log(`\nRelocation block at RVA 0x${pageRVA.toString(16)}, size 0x${blockSize.toString(16)}`);

            const entryCount = (blockSize - 8) / 2;
            for (let j = 0; j < Math.min(entryCount, 10); j++) {
                const entryOffset = offset + 8 + j * 2;
                const entry = data.readUInt16LE(entryOffset);
                const type = (entry >> 12) & 0xf;
                const offset_in_block = entry & 0xfff;
                const relocatedAddr = pageRVA + offset_in_block;

                console.log(`  [${String(j).padStart(2)}] Type=${type} Offset=0x${offset_in_block.toString(16)} => VA=0x${relocatedAddr.toString(16)}`);
            }

            offset += blockSize;
            relocCount++;
        }
    }
}

// Now check what's at 0x17081818 - 0x17000000 (KERNEL32 base in memory)
const offsetInKernel32 = 0x17081818 - 0x17000000;
console.log(`\n=== Address 0x17081818 offset in KERNEL32 ===`);
console.log(`Offset: 0x${offsetInKernel32.toString(16)}`);

// Calculate what the RVA would be
const kernel32VA = 0x17000000; // Where it's loaded
const preferredBase = imageBase;
const relocationDelta = kernel32VA - preferredBase;
console.log(`Preferred base: 0x${preferredBase.toString(16)}`);
console.log(`Actual VA: 0x${kernel32VA.toString(16)}`);
console.log(`Relocation delta: 0x${(relocationDelta >>> 0).toString(16)}`);

// So RVA = 0x17081818 - 0x17000000
const rvaOfPointer = 0x81818;
console.log(`\nRVA of pointer: 0x${rvaOfPointer.toString(16)}`);
console.log(`Original value at that location (before relocation): should be 0x${(0xa54f0 - relocationDelta >>> 0).toString(16)}`);
