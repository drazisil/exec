import { EXEFile } from "./index.ts";

const dllPath = "/data/Downloads/kernel32/kernel32.dll";
const exe = new EXEFile(dllPath);

const preferredBase = exe.optionalHeader.imageBase;

console.log("=== Relocation Mismatch Analysis ===\n");
console.log(`KERNEL32 preferred base: 0x${preferredBase.toString(16)}`);
console.log(`KERNEL32 would be loaded at: 0x12000000 (if d3d8 is at 0x10000000)`);

const wrongDelta = (0x10000000 - preferredBase) >>> 0;  // What we calculated wrongly
const correctDelta = (0x12000000 - preferredBase) >>> 0; // What it should be

console.log(`\nRelocation delta if loaded at 0x10000000: 0x${wrongDelta.toString(16)}`);
console.log(`Relocation delta if loaded at 0x12000000: 0x${correctDelta.toString(16)}`);
console.log(`Difference: 0x${((wrongDelta - correctDelta) >>> 0).toString(16)}`);

// So if we applied the WRONG delta, all addresses would be off by:
const offset = ((0x10000000 - 0x12000000) >>> 0).toString(16);
console.log(`\nAll addresses would be off by: 0x${offset}`);

// That's -0x02000000, so an address at 0x12022cb0 would appear as:
const buggyAddr = (0x12022cb0 - 0x02000000) >>> 0;
console.log(`Address 0x12022cb0 with wrong delta would be: 0x${buggyAddr.toString(16)}`);
