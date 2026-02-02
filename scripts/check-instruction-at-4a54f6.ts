import * as fs from "fs";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const data = fs.readFileSync(exePath);

// Parse PE
const dosHeader = data.readUInt16LE(0);
const peOffset = data.readUInt32LE(0x3c);
const machineType = data.readUInt16LE(peOffset + 4);
const numberOfSections = data.readUInt16LE(peOffset + 6);
const optionalHeaderSize = data.readUInt16LE(peOffset + 20);
const sectionHeaderOffset = peOffset + 24 + optionalHeaderSize;

// VA to file offset
const va = 0x004a54f6;
const imageBase = 0x400000;
const rva = va - imageBase;

console.log(`VA: 0x${va.toString(16)}, RVA: 0x${rva.toString(16)}`);

let fileOffset = null;
for (let i = 0; i < numberOfSections; i++) {
    const sectionOffset = sectionHeaderOffset + i * 40;
    const virtualSize = data.readUInt32LE(sectionOffset + 8);
    const virtualAddress = data.readUInt32LE(sectionOffset + 12);
    const rawSize = data.readUInt32LE(sectionOffset + 16);
    const rawPointer = data.readUInt32LE(sectionOffset + 20);

    if (rva >= virtualAddress && rva < virtualAddress + virtualSize) {
        fileOffset = rawPointer + (rva - virtualAddress);
        break;
    }
}

if (fileOffset !== null) {
    console.log(`File offset: 0x${fileOffset.toString(16)}`);
    const bytes = [];
    for (let i = 0; i < 32; i++) {
        bytes.push(data[fileOffset + i].toString(16).padStart(2, '0'));
    }
    console.log(`Bytes: ${bytes.join(' ')}`);

    // Decode the instructions
    console.log(`\nInstruction at 0x004a54f6:`);
    const byte0 = data[fileOffset];
    console.log(`  0x${byte0.toString(16).padStart(2, '0')} - TEST (0x85)`);

    if (byte0 === 0x85) {
        const modrm = data[fileOffset + 1];
        console.log(`  ModR/M: 0x${modrm.toString(16).padStart(2, '0')}`);

        const mod = (modrm >> 6) & 0x3;
        const reg = (modrm >> 3) & 0x7;
        const rm = modrm & 0x7;

        console.log(`    mod=${mod}, reg=${reg}, rm=${rm}`);

        // If mod=01 or mod=10, there's a displacement
        if (mod === 1) {
            const disp8 = data[fileOffset + 2];
            console.log(`    Displacement (8-bit): 0x${(disp8 < 128 ? disp8 : disp8 - 256).toString(16)}`);
        } else if (mod === 2) {
            const disp32 = data.readInt32LE(fileOffset + 2);
            console.log(`    Displacement (32-bit): 0x${(disp32 >>> 0).toString(16)}`);
        } else if (mod === 3) {
            console.log(`    Registers only`);
        }
    }
}
