import { EXEFile } from "./index.ts";
import { CPU, Memory, REG, registerAllOpcodes } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

console.log("=== Loading PE File ===\n");
const exe = new EXEFile(exePath);

console.log(`Entry point RVA: 0x${exe.optionalHeader.addressOfEntryPoint.toString(16)}`);
console.log(`Image base: 0x${exe.optionalHeader.imageBase.toString(16)}`);
console.log(`Sections: ${exe.sectionHeaders.length}`);

// Find which section contains entry point
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const entrySection = exe.sectionHeaders.find(s =>
    entryRVA >= s.virtualAddress &&
    entryRVA < s.virtualAddress + s.virtualSize
);
console.log(`Entry point in section: ${entrySection?.name || "NOT FOUND"}`);

// Create emulator with 512MB memory
const mem = new Memory(512 * 1024 * 1024);
const cpu = new CPU(mem);

// Register all opcodes
registerAllOpcodes(cpu);

// Set up interrupt handler for INT 3 (breakpoint) and INT 0x20 (DOS exit)
cpu.onInterrupt((intNum, cpu) => {
    if (intNum === 0xCC || intNum === 0x03) {
        console.log(`\n[BREAKPOINT] INT3 at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
        cpu.halted = true;
    } else if (intNum === 0x20) {
        console.log(`\n[EXIT] INT 0x20 at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
        cpu.halted = true;
    } else {
        throw new Error(`Unhandled interrupt INT 0x${intNum.toString(16)} at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
    }
});

// Load sections into memory
console.log("\n=== Loading Sections ===");
let totalLoaded = 0;
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    console.log(`  ${section.name.padEnd(8)} @ 0x${vaddr.toString(16).padStart(8, "0")} (${section.data.byteLength} bytes)`);
    mem.load(vaddr, section.data);
    totalLoaded += section.data.byteLength;
}
console.log(`Total: ${totalLoaded} bytes`);

// Set up CPU state
// Entry point is an RVA; find its actual memory address
if (!entrySection) {
    throw new Error(`Entry point RVA 0x${entryRVA.toString(16)} not in any section!`);
}
// RVA (Relative Virtual Address) is already relative to imageBase
// So we just add them directly
const eip = exe.optionalHeader.imageBase + entryRVA;
console.log(`DEBUG: Setting EIP = imageBase(${exe.optionalHeader.imageBase}) + entryRVA(${entryRVA}) = ${eip} (0x${(eip >>> 0).toString(16)})`);
cpu.eip = (eip >>> 0);

// Stack at higher memory, but below 512MB
cpu.regs[REG.ESP] = 0x1FF00000;
cpu.regs[REG.EBP] = 0x1FF00000;

console.log("\n=== Starting Emulation ===\n");
console.log(`Initial state: ${cpu.toString()}\n`);

try {
    cpu.run(100_000);
} catch (err: any) {
    console.log(`\n[ERROR] ${err.message}`);
    console.log(`State at error: ${cpu.toString()}`);
}

console.log(`\n=== Emulation Complete ===`);
console.log(`Steps executed: ${cpu.stepCount}`);
console.log(`Final state: ${cpu.toString()}`);
