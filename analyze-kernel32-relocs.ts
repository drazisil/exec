import { EXEFile } from "./index.ts";

const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const exe = new EXEFile(dllPath);

console.log("=== KERNEL32.dll Relocation Analysis ===\n");

if (!exe.baseRelocationTable) {
    console.log("No relocation table found!");
    process.exit(0);
}

const blocks = exe.baseRelocationTable.blocks;
console.log(`Total relocation blocks: ${blocks.length}\n`);

// Count relocation types
const typeCounts = new Map<number, number>();
const typeExamples = new Map<number, { addr: number; type: number; offset: number }[]>();

for (const block of blocks) {
    for (const entry of block.entries) {
        const count = typeCounts.get(entry.type) || 0;
        typeCounts.set(entry.type, count + 1);

        if (!typeExamples.has(entry.type)) {
            typeExamples.set(entry.type, []);
        }
        if (typeExamples.get(entry.type)!.length < 3) {
            typeExamples.get(entry.type)!.push({
                addr: block.pageRva + entry.offset,
                type: entry.type,
                offset: entry.offset,
            });
        }
    }
}

console.log("Relocation Types Used:");
for (const [type, count] of Array.from(typeCounts.entries()).sort((a, b) => a[0] - b[0])) {
    const typeName = getRelocationTypeName(type);
    console.log(`  Type ${type} (${typeName}): ${count} relocations`);

    const examples = typeExamples.get(type) || [];
    for (const ex of examples) {
        console.log(`    - Page RVA: 0x${(Math.floor(ex.addr / 0x1000) * 0x1000).toString(16).padStart(8, '0')}, Offset: 0x${ex.offset.toString(16).padStart(4, '0')}`);
    }
}

function getRelocationTypeName(type: number): string {
    switch (type) {
        case 0: return "ABS";
        case 1: return "HIGHLOW";
        case 2: return "HIGH";
        case 3: return "HIGHLOW";
        case 4: return "HIGHADJ";
        case 5: return "MIPS_JMPADDR";
        case 6: return "MIPS_JMPADDR16";
        case 7: return "IA64_IMM64";
        case 8: return "DIR64";
        case 9: return "HIGH3ADJ";
        case 10: return "THUMB_MOV32";
        case 11: return "THUMB_BRANCH20";
        case 12: return "THUMB_BRANCH24";
        case 13: return "THUMB_BLXI6";
        case 14: return "ARM_MOV32";
        case 15: return "ARM_BRANCH24T";
        case 16: return "ARM_BLX23T";
        case 17: return "ARM_MOV32T";
        default: return "UNKNOWN";
    }
}
