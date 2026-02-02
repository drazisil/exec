import { EXEFile } from "./index";
import { Memory } from "./src/hardware/Memory";

const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const kernel32 = new EXEFile(dllPath);

const mem = new Memory(1024 * 1024 * 1024);

const kernel32Base = 0x12000000;
const preferredBase = kernel32.optionalHeader.imageBase;
const relocationDelta = (kernel32Base - preferredBase) >>> 0;

console.log("=== Loading KERNEL32 with relocations ===\n");

// Load sections
for (const section of kernel32.sectionHeaders) {
    const vaddr = kernel32Base + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Apply relocations
if (kernel32.baseRelocationTable) {
    for (const block of kernel32.baseRelocationTable.blocks) {
        for (const entry of block.entries) {
            const relocAddr = kernel32Base + block.pageRva + entry.offset;
            if (entry.type === 3) {
                const currentValue = mem.read32(relocAddr);
                const newValue = (currentValue + relocationDelta) >>> 0;
                mem.write32(relocAddr, newValue);
            }
        }
    }
}

// The indirect jump reads from 0x12081818
const jumpTableAddr = 0x12081818;

console.log(`Instruction: JMP [0x${jumpTableAddr.toString(16)}]`);
console.log(`Reading from: 0x${jumpTableAddr.toString(16)}\n`);

const targetAddr = mem.read32(jumpTableAddr);
console.log(`Value at 0x${jumpTableAddr.toString(16)}: 0x${(targetAddr >>> 0).toString(16)}`);

// Check what's at that address
const bytes = [];
for (let i = 0; i < 8; i++) {
    try {
        bytes.push(mem.read8(targetAddr + i));
    } catch (e) {
        bytes.push(0);
    }
}

console.log(`Bytes at target 0x${(targetAddr >>> 0).toString(16)}: ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

// Check if target is in KERNEL32
if (targetAddr >= kernel32Base && targetAddr < kernel32Base + 0x01000000) {
    console.log(`✓ Target is in KERNEL32 range`);
    const offset = targetAddr - kernel32Base;
    console.log(`  Offset in KERNEL32: 0x${offset.toString(16)}`);
} else if (targetAddr >= 0x400000 && targetAddr < 0x0e00000) {
    console.log(`✓ Target is in main executable range`);
} else {
    console.log(`✗ Target is in UNKNOWN area: 0x${(targetAddr >>> 0).toString(16)}`);
    console.log(`  This could be the problem!`);
}
