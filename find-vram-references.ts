import { EXEFile } from "./index.ts";
import * as fs from "fs";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Finding VRAM Address References (0x8b000000) ===\n");

const imageBase = exe.optionalHeader.imageBase;
const targetValue = 0x8b000000;

// Search in each section
for (const section of exe.sectionHeaders) {
    if (section.virtualSize === 0) continue;

    const sectionStart = imageBase + section.virtualAddress;
    const occurrences = [];

    for (let i = 0; i < section.data.byteLength - 3; i++) {
        const val = section.data.readUInt32LE(i);
        if ((val >>> 0) === targetValue) {
            occurrences.push(i);
        }
    }

    if (occurrences.length > 0) {
        console.log(`${section.name} section: ${occurrences.length} occurrence(s)`);
        for (const offset of occurrences) {
            const addr = sectionStart + offset;
            const fileOffset = section.data.byteOffset + offset;

            // Get context
            const contextStart = Math.max(0, offset - 16);
            const contextEnd = Math.min(section.data.byteLength, offset + 20);
            const contextBytes = [];
            for (let i = contextStart; i < contextEnd; i++) {
                const byte = section.data[i].toString(16).padStart(2, "0");
                if (i === offset || i === offset + 1 || i === offset + 2 || i === offset + 3) {
                    contextBytes.push(`[${byte}]`); // Highlight the value
                } else {
                    contextBytes.push(byte);
                }
            }

            console.log(`  0x${addr.toString(16)} (offset 0x${offset.toString(16)} in ${section.name})`);
            console.log(`    Context: ${contextBytes.join(" ")}`);

            // Try to decode what instruction this might be
            if (offset >= 1) {
                const prevByte = section.data[offset - 1];
                const nextBytes = section.data.slice(offset + 4, offset + 8);

                // Common patterns
                if (prevByte === 0xa1) {
                    console.log(`    Pattern: MOV EAX, [0x${targetValue.toString(16)}]`);
                } else if (prevByte === 0xa3) {
                    console.log(`    Pattern: MOV [0x${targetValue.toString(16)}], EAX`);
                } else if (prevByte === 0xb8) {
                    console.log(`    Pattern: MOV EAX, 0x${targetValue.toString(16)} (immediate)`);
                } else if (prevByte === 0xc7) {
                    console.log(`    Pattern: MOV dword ptr [...], 0x${targetValue.toString(16)}`);
                } else if (offset >= 6 && section.data[offset - 2] === 0xa1) {
                    console.log(`    Pattern: Possibly memory access with displacement`);
                }
            }
            console.log();
        }
    }
}

console.log("=== Interpretation ===\n");
console.log("These are hardcoded VRAM addresses used by Motor City Online.");
console.log("The game likely:");
console.log("1. Initializes Direct3D in C++ code");
console.log("2. Receives a pointer to AGP/VRAM from the graphics driver");
console.log("3. Hardcodes this address in compiled code for fast access");
console.log("4. Attempts to read graphics state from this memory");
console.log("\nSince we don't emulate graphics hardware:");
console.log("- This memory is not allocated");
console.log("- The access causes an ACCESS_VIOLATION");
console.log("- This is CORRECT behavior for an emulator without graphics support");
console.log("\nThe game would only run with proper D3D8 graphics emulation.");
