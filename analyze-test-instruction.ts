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
    console.log("=== TEST instruction at 0x004a54f6 ===\n");

    const byte0 = data[fileOffset];
    const byte1 = data[fileOffset + 1];
    const byte2 = data[fileOffset + 2];
    const byte3 = data[fileOffset + 3];
    const byte4 = data[fileOffset + 4];
    const byte5 = data[fileOffset + 5];

    console.log(`Opcode bytes: ${[byte0, byte1, byte2, byte3, byte4, byte5].map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ")}`);
    console.log();

    // Parse
    console.log(`Byte 0: 0x${byte0.toString(16).padStart(2, "0")} = TEST instruction`);

    if (byte0 === 0x85) {
        const modrm = byte1;
        console.log(`Byte 1 (ModR/M): 0x${modrm.toString(16).padStart(2, "0")}`);

        const mod = (modrm >> 6) & 0x3;
        const reg = (modrm >> 3) & 0x7;
        const rm = modrm & 0x7;

        console.log(`  mod=${mod} (${mod === 0 ? "[reg]" : mod === 1 ? "[reg+disp8]" : mod === 2 ? "[reg+disp32]" : "reg"})`);
        console.log(`  reg=${reg}`);
        console.log(`  rm=${rm}`);

        const regNames = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"];
        console.log(`\nInstruction: TEST ${regNames[reg]}, ${regNames[rm]}`);

        if (mod === 2) {
            // 32-bit displacement
            const disp32 = data.readInt32LE(fileOffset + 2);
            console.log(`Displacement (32-bit): 0x${(disp32 >>> 0).toString(16)}`);

            const addr = (disp32 + 0) >>> 0; // +0 because RM reg is uninitialized at runtime
            console.log(`\nCalculated address: [${regNames[rm]} + 0x${(disp32 >>> 0).toString(16)}]`);
            console.log(`At runtime, if ${regNames[rm]} = 0x00000000, address would be: 0x${(disp32 >>> 0).toString(16)}`);

            if ((disp32 >>> 0) === 0x8b000000) {
                console.log(`\n✓ MATCH! This is where 0x8b000000 comes from!`);
                console.log(`\nWhat Windows would do:`);
                console.log(`1. CPU would attempt to read 4 bytes from 0x8b000000`);
                console.log(`2. This address is unmapped in the process's virtual address space`);
                console.log(`3. CPU raises a page fault exception`);
                console.log(`4. OS catches it and checks if it's legitimate:`);
                console.log(`   - If in allocated but uncommitted memory: commit it`);
                console.log(`   - If in guard page: expand stack`);
                console.log(`   - Otherwise: kill the process with ACCESS_VIOLATION`);
                console.log(`\nIn this case, 0x8b000000 is clearly invalid:`);
                console.log(`- Way outside normal user-mode address space (should be < 0x7fffffff on 32-bit)`);
                console.log(`- Not aligned to page boundaries for heap allocation`);
                console.log(`- Would result in: STATUS_ACCESS_VIOLATION (0xC0000005)`);
            }
        }
    }
}
