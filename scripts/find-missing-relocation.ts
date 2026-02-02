import * as fs from "fs";

const kernel32Path = "/data/Downloads/kernel32/kernel32.dll";

if (!fs.existsSync(kernel32Path)) {
    console.log(`KERNEL32.dll not found at ${kernel32Path}`);
    process.exit(1);
}

const data = fs.readFileSync(kernel32Path);

// Parse PE header
const dosHeader = data.readUInt16LE(0);
const peOffset = data.readUInt32LE(0x3c);
const machineType = data.readUInt16LE(peOffset + 4);
const numberOfSections = data.readUInt16LE(peOffset + 6);
const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
const optionalHeaderOffset = peOffset + 24;

const imageBase = data.readUInt32LE(optionalHeaderOffset + 28);
const sectionHeaderOffset = optionalHeaderOffset + optionalHeaderSize;

console.log(`=== Looking for relocation block covering 0x81818 ===`);
console.log(`Target RVA: 0x81818`);
console.log(`Which is in page range: 0x81000-0x81fff\n`);

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
        console.log(`Found .reloc section:`);

        let offset = rawPointer;
        const relocEndOffset = rawPointer + rawSize;
        let foundPage = false;

        while (offset < relocEndOffset) {
            const pageRVA = data.readUInt32LE(offset);
            const blockSize = data.readUInt32LE(offset + 4);

            if (blockSize === 0) break;

            // Check if this could be near 0x81818
            if (pageRVA >= 0x80000 && pageRVA <= 0x82000) {
                console.log(`\nPage RVA 0x${pageRVA.toString(16)}, Size 0x${blockSize.toString(16)}`);
                const entryCount = (blockSize - 8) / 2;
                for (let j = 0; j < entryCount; j++) {
                    const entryOffset = offset + 8 + j * 2;
                    const entry = data.readUInt16LE(entryOffset);
                    const type = (entry >> 12) & 0xf;
                    const reloc_offset = entry & 0xfff;
                    const relocAddr = pageRVA + reloc_offset;
                    console.log(`  Offset 0x${reloc_offset.toString(16)} => RVA 0x${relocAddr.toString(16)}`);
                }
                foundPage = true;
            }

            offset += blockSize;
        }

        if (!foundPage) {
            console.log(`\nNo relocation block covering 0x81000-0x81fff found!`);
        }

        // Check what's actually at 0x81818 in the file
        // First, find the section containing 0x81818
        console.log(`\n=== Checking what section contains 0x81818 ===`);
        for (let i = 0; i < numberOfSections; i++) {
            const sectionOffset = sectionHeaderOffset + i * 40;
            const nameBytes = data.slice(sectionOffset, sectionOffset + 8);
            const sectionName = nameBytes.toString('utf8').replace(/\0/g, '');
            const virtualSize = data.readUInt32LE(sectionOffset + 8);
            const virtualAddress = data.readUInt32LE(sectionOffset + 12);
            const rawSize = data.readUInt32LE(sectionOffset + 16);
            const rawPointer = data.readUInt32LE(sectionOffset + 20);

            if (0x81818 >= virtualAddress && 0x81818 < virtualAddress + virtualSize) {
                console.log(`Found in section: ${sectionName}`);
                console.log(`  Section VA: 0x${virtualAddress.toString(16)}`);
                console.log(`  Section size: 0x${virtualSize.toString(16)}`);
                const offsetInSection = 0x81818 - virtualAddress;
                const offsetInFile = rawPointer + offsetInSection;
                console.log(`  Offset in file: 0x${offsetInFile.toString(16)}`);
                console.log(`  Data at location:`);

                const val32 = data.readUInt32LE(offsetInFile);
                console.log(`    32-bit value: 0x${(val32 >>> 0).toString(16)}`);
                console.log(`    As signed: 0x${val32.toString(16)}`);

                // This value should have been adjusted by relocation delta
                // relocation delta = where it's loaded - preferred base
                // If it's loaded at 0x17000000 and preferred is 0x6b800000
                // delta = 0x17000000 - 0x6b800000 = -0x54800000 (or 0xab800000 unsigned)

                const delta = 0x17000000 - 0x6b800000;
                const relocated = val32 + delta;
                console.log(`\n  If we apply delta (0x${(delta >>> 0).toString(16)}):`);
                console.log(`    Original: 0x${(val32 >>> 0).toString(16)}`);
                console.log(`    After relocation: 0x${(relocated >>> 0).toString(16)}`);
            }
        }
    }
}
