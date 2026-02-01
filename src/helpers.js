export function get16(buffer, offset) {
    return buffer.readInt16LE(offset);
}
export function hex(value, pad = 8) {
    return '0x' + value.toString(16).toUpperCase().padStart(pad, '0');
}
export function rvaToOffset(rva, sections) {
    for (const section of sections) {
        const effectiveSize = Math.max(section.virtualSize, section.sizeOfRawData);
        if (rva >= section.virtualAddress && rva < section.virtualAddress + effectiveSize) {
            return section.pointerToRawData + (rva - section.virtualAddress);
        }
    }
    return -1;
}
