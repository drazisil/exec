import { EXEFile } from "./index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

const imageBase = exe.optionalHeader.imageBase;

let maxAddr = imageBase;
let maxSection = "";

for (const section of exe.sectionHeaders) {
    const endAddr = imageBase + section.virtualAddress + section.virtualSize;
    if (endAddr > maxAddr) {
        maxAddr = endAddr;
        maxSection = section.name;
    }
}

console.log(`=== Main Executable Address Range ===`);
console.log(`Image Base: 0x${imageBase.toString(16)}`);
console.log(`Max Address (end of ${maxSection} section): 0x${maxAddr.toString(16)}`);
console.log(`Size needed: 0x${(maxAddr - imageBase).toString(16)} bytes`);
console.log(`Size in MB: ${((maxAddr - imageBase) / (1024 * 1024)).toFixed(2)} MB`);

console.log(`\n=== Problem Address ===`);
console.log(`Game tries to access: 0x8b000000`);
console.log(`This is: ${0x8b000000} bytes = ${(0x8b000000 / (1024 * 1024 * 1024)).toFixed(2)} GB`);
console.log(`Our allocation: 1GB = 0x40000000 bytes`);
console.log(`Shortfall: ${(0x8b000000 - 0x40000000) / (1024 * 1024 * 1024)} GB`);

console.log(`\nThe address 0x8b000000 appears to be ABSOLUTE, not relative to game base`);
console.log(`This is likely data/allocated memory that the game expects at a specific address`);
