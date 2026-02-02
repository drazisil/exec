import { EXEFile } from "./index";
import { Memory } from "./src/hardware/Memory";

const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const exe = new EXEFile(dllPath);

const mem = new Memory(1024 * 1024 * 1024);

// Load KERNEL32 at its preferred base first
const preferredBase = exe.optionalHeader.imageBase;
console.log(`KERNEL32 preferred base: 0x${preferredBase.toString(16)}`);

// Try to load at preferred base
for (const section of exe.sectionHeaders) {
    const vaddr = preferredBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

// Apply relocations
if (exe.baseRelocationTable) {
    const relocationDelta = 0; // Loading at preferred base
    for (const block of exe.baseRelocationTable.blocks) {
        for (const entry of block.entries) {
            const relocAddr = preferredBase + block.pageRva + entry.offset;
            if (entry.type === 3) {
                const currentValue = mem.read32(relocAddr);
                const newValue = (currentValue + relocationDelta) >>> 0;
                mem.write32(relocAddr, newValue);
            }
        }
    }
}

// Now check what's at the jump address
const jumpAddr = 0x12022cb0;
const jumpAddrInKernel32 = jumpAddr - 0x12000000; // Offset within KERNEL32 in our 32-bit space
const rvaInKernel32 = jumpAddrInKernel32;

console.log(`\n=== Checking jump address in KERNEL32 ===`);
console.log(`Jump address in emulator: 0x${jumpAddr.toString(16)}`);
console.log(`KERNEL32 loaded at: 0x${preferredBase.toString(16)} (assuming we loaded at preferred)`);
console.log(`Offset in KERNEL32: 0x${rvaInKernel32.toString(16)}`);

// But we actually loaded KERNEL32 at 0x12000000 in our emulator, not at its preferred base
const actualKernel32Base = 0x12000000;
const actualAddr = actualKernel32Base + (jumpAddr - actualKernel32Base);

console.log(`\nActually loaded at: 0x${actualKernel32Base.toString(16)}`);
console.log(`Actual offset: 0x${(jumpAddr - actualKernel32Base).toString(16)}`);

const bytes = [];
for (let i = 0; i < 8; i++) {
    try {
        const b = mem.read8(jumpAddr + i);
        bytes.push(b.toString(16).padStart(2, '0'));
    } catch (e) {
        bytes.push("??");
    }
}

console.log(`\nBytes at 0x${jumpAddr.toString(16)}: ${bytes.join(' ')}`);

// The instruction at 0x12022cb0
if (bytes[0] === 'ff') {
    const modrm = parseInt(bytes[1] || '00', 16);
    const mod = (modrm >> 6) & 0x3;
    const opcode = (modrm >> 3) & 0x7;
    const rm = modrm & 0x7;

    console.log(`\nInstruction: FF ${modrm.toString(16).padStart(2, '0')}`);
    console.log(`  mod=${mod}, opcode=${opcode}, rm=${rm}`);

    const opcodeNames: {[key: number]: string} = {
        0: 'INC',
        1: 'DEC',
        2: 'CALL [r/m32]',
        3: 'CALL FAR [r/m32]',
        4: 'JMP [r/m32]',
        5: 'JMP FAR [r/m32]',
        6: 'PUSH [r/m32]',
        7: 'Invalid'
    };

    console.log(`  Likely: ${opcodeNames[opcode]}`);
}

// Check what value would be at the address if this is a [r/m32] access
if (parseInt(bytes[0] || '00', 16) === 0xff && (parseInt(bytes[1] || '00', 16) & 0x38) === 0x20) {
    // CALL [r/m32] - need to figure out which register
    const modrm = parseInt(bytes[1] || '00', 16);
    const rm = modrm & 0x7;
    const mod = (modrm >> 6) & 0x3;

    const regNames = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];
    console.log(`\nThis appears to be: CALL [${regNames[rm]}] with mod=${mod}`);
}
