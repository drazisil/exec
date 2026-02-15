"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get16 = get16;
exports.hex = hex;
exports.rvaToOffset = rvaToOffset;
function get16(buffer, offset) {
    return buffer.readInt16LE(offset);
}
function hex(value, pad) {
    if (pad === void 0) { pad = 8; }
    return '0x' + value.toString(16).toUpperCase().padStart(pad, '0');
}
function rvaToOffset(rva, sections) {
    for (var _i = 0, sections_1 = sections; _i < sections_1.length; _i++) {
        var section = sections_1[_i];
        var effectiveSize = Math.max(section.virtualSize, section.sizeOfRawData);
        if (rva >= section.virtualAddress && rva < section.virtualAddress + effectiveSize) {
            return section.pointerToRawData + (rva - section.virtualAddress);
        }
    }
    return -1;
}
