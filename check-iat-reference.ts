import { EXEFile } from "./index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Checking main exe imports ===\n");

if (exe.importTable) {
    let iatCount = 0;
    for (const descriptor of exe.importTable.descriptors) {
        for (const entry of descriptor.entries) {
            // Check if any IAT entry might be at or near this address
            if (iatCount < 20) {
                console.log(`Import ${iatCount}: ${descriptor.dllName}!${entry.name}`);
                console.log(`  IAT RVA: 0x${entry.iatRva.toString(16)}`);
                console.log(`  IAT Address: 0x${(0x400000 + entry.iatRva).toString(16)}`);
                iatCount++;
            }
        }
    }
}
