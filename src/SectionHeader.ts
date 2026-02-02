import { hex } from "./helpers.js";


export class SectionHeader {
  private _name: string;
  private _virtualSize: number;
  private _virtualAddress: number;
  private _sizeOfRawData: number;
  private _pointerToRawData: number;
  private _pointerToRelocations: number;
  private _pointerToLinenumbers: number;
  private _numberOfRelocations: number;
  private _numberOfLinenumbers: number;
  private _characteristics: number;
  private _data: Buffer = Buffer.alloc(0);

  public static get sizeOf() {
    return 40;
  }

  constructor(data: Buffer) {
    this._name = data.subarray(0, 8).toString('utf8').replace(/\0+$/, '');
    this._virtualSize = data.readUInt32LE(8);
    this._virtualAddress = data.readUInt32LE(12);
    this._sizeOfRawData = data.readUInt32LE(16);
    this._pointerToRawData = data.readUInt32LE(20);
    this._pointerToRelocations = data.readUInt32LE(24);
    this._pointerToLinenumbers = data.readUInt32LE(28);
    this._numberOfRelocations = data.readUInt16LE(32);
    this._numberOfLinenumbers = data.readUInt16LE(34);
    this._characteristics = data.readUInt32LE(36);
  }

  resolve(fileImage: Buffer) {
    if (this._pointerToRawData === 0 || this._sizeOfRawData === 0) return;
    this._data = fileImage.subarray(this._pointerToRawData, this._pointerToRawData + this._sizeOfRawData);
  }

  get name() { return this._name; }
  get virtualSize() { return this._virtualSize; }
  get virtualAddress() { return this._virtualAddress; }
  get sizeOfRawData() { return this._sizeOfRawData; }
  get pointerToRawData() { return this._pointerToRawData; }
  get pointerToRelocations() { return this._pointerToRelocations; }
  get pointerToLinenumbers() { return this._pointerToLinenumbers; }
  get numberOfRelocations() { return this._numberOfRelocations; }
  get numberOfLinenumbers() { return this._numberOfLinenumbers; }
  get characteristics() { return this._characteristics; }
  get data() { return this._data; }

  toString() {
    const lines = [
      `Name:                 ${this._name}`,
      `VirtualSize:          ${hex(this._virtualSize)}`,
      `VirtualAddress:       ${hex(this._virtualAddress)}`,
      `SizeOfRawData:        ${hex(this._sizeOfRawData)}`,
      `PointerToRawData:     ${hex(this._pointerToRawData)}`,
      `PointerToRelocations: ${hex(this._pointerToRelocations)}`,
      `PointerToLinenumbers: ${hex(this._pointerToLinenumbers)}`,
      `NumberOfRelocations:  ${this._numberOfRelocations}`,
      `NumberOfLinenumbers:  ${this._numberOfLinenumbers}`,
      `Characteristics:      ${hex(this._characteristics)}`,
    ];
    if (this._data.length > 0) {
      lines.push('');
      for (let i = 0; i < this._data.length; i += 16) {
        const chunk = this._data.subarray(i, Math.min(i + 16, this._data.length));
        const hexBytes = Array.from(chunk).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        const ascii = Array.from(chunk).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.').join('');
        lines.push(`    ${hex(i, 8)}  ${hexBytes.padEnd(47)}  ${ascii}`);
      }
    }
    return lines.join('\n');
  }
}
