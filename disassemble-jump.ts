import { EXEFile } from "./index";
import { Memory } from "./src/hardware/Memory";

// Get both the game exe and kernel32
const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const dllPath = "/data/Downloads/kernel32/kernel32.dll";

const exe = new EXEFile(exePath, ["/data/Downloads/kernel32"]);
const kernel32 = new EXEFile(dllPath);

const mem = new Memory(1024 * 1024 * 1024);

console.log("=== Loading KERNEL32 at 0x12000000 ===\n");

// Load KERNEL32 at 0x12000000 (where it ended up in our emulator)
const kernel32Base = 0x12000000;
const preferredBase = kernel32.optionalHeader.imageBase;
const relocationDelta = (kernel32Base - preferredBase) >>> 0;

console.log(`Preferred base: 0x${preferredBase.toString(16)}`);
console.log(`Actual base: 0x${kernel32Base.toString(16)}`);
console.log(`Relocation delta: 0x${relocationDelta.toString(16)}`);

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

// Now disassemble around the jump address
const jumpAddr = 0x12022cb0;

console.log(`\n=== Instruction at 0x${jumpAddr.toString(16)} ===\n`);

const bytes = [];
for (let i = 0; i < 16; i++) {
    bytes.push(mem.read8(jumpAddr + i));
}

console.log(`Raw bytes: ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

const firstByte = bytes[0];
const secondByte = bytes[1];

console.log(`\nFirst byte: 0x${firstByte.toString(16).padStart(2, '0')}`);

if (firstByte === 0xFF) {
    console.log("Opcode: FF (Extended instruction)");
    const modrm = secondByte;
    const mod = (modrm >> 6) & 0x3;
    const reg = (modrm >> 3) & 0x7;
    const rm = modrm & 0x7;

    console.log(`ModR/M: 0x${modrm.toString(16).padStart(2, '0')} (mod=${mod}, reg=${reg}, rm=${rm})`);

    const opcodes: { [key: number]: string } = {
        0: 'INC r/m32',
        1: 'DEC r/m32',
        2: 'CALL [r/m32] (near)',
        3: 'CALL [r/m32] (far)',
        4: 'JMP [r/m32] (near)',
        5: 'JMP [r/m32] (far)',
        6: 'PUSH [r/m32]',
        7: 'INVALID'
    };

    console.log(`Operation: ${opcodes[reg]}`);

    const regNames = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI'];

    if (mod === 3) {
        console.log(`Operand: ${regNames[rm]} register`);
    } else if (mod === 0) {
        if (rm === 5) {
            // [disp32]
            const disp32 = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
            console.log(`Operand: [0x${(disp32 >>> 0).toString(16).padStart(8, '0')}] (memory)`);
        } else {
            console.log(`Operand: [${regNames[rm]}] (memory)`);
        }
    } else if (mod === 1) {
        const disp8 = bytes[2];
        console.log(`Operand: [${regNames[rm]} + 0x${disp8.toString(16)}] (memory with byte offset)`);
    } else if (mod === 2) {
        const disp32 = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
        console.log(`Operand: [${regNames[rm]} + 0x${(disp32 >>> 0).toString(16)}] (memory with dword offset)`);
    }
}
