import { EXEFile } from "./index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
]);

const crashAddr = 0x000a54f0;
const imageBase = exe.optionalHeader.imageBase;
const crashRVA = crashAddr - imageBase;

console.log(`=== Crash Address Analysis ===\n`);
console.log(`Crash VA: 0x${crashAddr.toString(16)}`);
console.log(`Image base: 0x${imageBase.toString(16)}`);
console.log(`Crash RVA: 0x${crashRVA.toString(16)}`);

// Find which section contains this
const section = exe.sectionHeaders.find(s =>
    crashRVA >= s.virtualAddress &&
    crashRVA < s.virtualAddress + s.virtualSize
);

if (section) {
    const offsetInSection = crashRVA - section.virtualAddress;
    console.log(`\nSection: ${section.name}`);
    console.log(`Offset in section: 0x${offsetInSection.toString(16)}`);
    const bytes = Array.from(section.data.slice(offsetInSection, offsetInSection + 16)).map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`Bytes at offset: ${bytes}`);
} else {
    console.log(`\n✗ Address is NOT in any section!`);
    console.log(`Sections:`);
    for (const s of exe.sectionHeaders) {
        const startRVA = s.virtualAddress;
        const endRVA = s.virtualAddress + s.virtualSize;
        console.log(`  ${s.name.padEnd(8)} RVA: 0x${startRVA.toString(16).padStart(8, '0')}-0x${endRVA.toString(16).padStart(8, '0')}`);
    }
}
