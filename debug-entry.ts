import { EXEFile } from "./index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
]);

console.log("=== Entry Point Analysis ===\n");
const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const imageBase = exe.optionalHeader.imageBase;
const entryVA = imageBase + entryRVA;

console.log(`Entry point RVA: 0x${entryRVA.toString(16)}`);
console.log(`Image base: 0x${imageBase.toString(16)}`);
console.log(`Entry point VA: 0x${(entryVA >>> 0).toString(16)}`);

console.log("\n=== Sections ===");
for (const section of exe.sectionHeaders) {
    const startRVA = section.virtualAddress;
    const endRVA = section.virtualAddress + section.virtualSize;
    const inSection = entryRVA >= startRVA && entryRVA < endRVA;

    console.log(`${section.name.padEnd(8)} RVA: 0x${startRVA.toString(16).padStart(8, '0')}-0x${endRVA.toString(16).padStart(8, '0')} ${inSection ? "◄ ENTRY POINT" : ""}`);
    console.log(`             Characteristics: 0x${section.characteristics.toString(16).padStart(8, '0')} (${section.characteristics & 0x20000000 ? "Execute" : "NoExecute"}, ${section.characteristics & 0x40000000 ? "Read" : "NoRead"})`);
}

// Check what data is at the entry point in the raw section data
const entrySection = exe.sectionHeaders.find(s =>
    entryRVA >= s.virtualAddress &&
    entryRVA < s.virtualAddress + s.virtualSize
);

if (entrySection) {
    const offsetInSection = entryRVA - entrySection.virtualAddress;
    const firstBytes = entrySection.data.slice(offsetInSection, offsetInSection + 16);
    console.log(`\n=== Bytes at Entry Point (in ${entrySection.name}) ===`);
    console.log(`Offset in section: 0x${offsetInSection.toString(16)}`);
    console.log(`Raw bytes: ${Array.from(firstBytes).map((b: number) => b.toString(16).padStart(2, '0')).join(' ')}`);
}
