import { SectionHeader } from "./SectionHeader.ts";


export function get16(buffer: Buffer, offset: number) {
  return buffer.readInt16LE(offset);
}export function hex(value: number, pad = 8) {
  return '0x' + value.toString(16).toUpperCase().padStart(pad, '0');
}

export function rvaToOffset(rva: number, sections: SectionHeader[]): number {
  for (const section of sections) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.virtualSize) {
      return section.pointerToRawData + (rva - section.virtualAddress);
    }
  }
  return -1;
}

