import { EXEFile } from "./index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
]);

const dllLoader = exe.importResolver.getDLLLoader();

console.log("Before assignment:");
console.log(`  d3d8.dll => 0x${(dllLoader as any)._dllBases.get("d3d8.dll") || "NOT SET"}`);

dllLoader.assignDLLBase("d3d8.dll", 0x10000000);

console.log("\nAfter assignment:");
const bases = (dllLoader as any)._dllBases;
console.log(`  d3d8.dll => 0x${(bases.get("d3d8.dll") || "NOT SET").toString(16)}`);
