import { hex } from "./helpers.js";

export class COFFFileHeader {
  private _machine: string;
  private _numberOfSections: number;
  private _timeDateStamp: number;
  private _pointerToSymbolTable: number;
  private _numberOfSymbols: number;
  private _sizeOfOptionalHeader: number;
  private _characteristics: number;

  public static get sizeOf() {
    return 20;
  }

  constructor(data: Buffer) {
    this._machine = MachineType.get(data.readUInt16LE(0)) ?? "";
    this._numberOfSections = data.readUInt16LE(2);
    this._timeDateStamp = data.readUInt32LE(4);
    this._pointerToSymbolTable = data.readUInt32LE(8);
    this._numberOfSymbols = data.readUInt32LE(12);
    this._sizeOfOptionalHeader = data.readUInt16LE(16);
    this._characteristics = data.readUInt16LE(18);
  }

  get machine() {
    return this._machine;
  }

  get numberOfSections() {
    return this._numberOfSections;
  }

  get timeDateStamp() {
    return this._timeDateStamp;
  }

  get pointerToSymbolTable() {
    return this._pointerToSymbolTable;
  }

  get numberOfSymbols() {
    return this._numberOfSymbols;
  }

  get sizeOfOptionalHeader() {
    return this._sizeOfOptionalHeader;
  }

  get characteristics() {
    return this._characteristics;
  }

  toString() {
    const date = new Date(this._timeDateStamp * 1000).toUTCString();
    return [
      `Machine:              ${this._machine}`,
      `NumberOfSections:     ${this._numberOfSections}`,
      `TimeDateStamp:        ${hex(this._timeDateStamp)} (${date})`,
      `PointerToSymbolTable: ${hex(this._pointerToSymbolTable)}`,
      `NumberOfSymbols:      ${this._numberOfSymbols}`,
      `SizeOfOptionalHeader: ${hex(this._sizeOfOptionalHeader, 4)}`,
      `Characteristics:      ${hex(this._characteristics, 4)}`,
    ].join('\n');
  }
}
export const MachineType: Map<number, string> = new Map();
MachineType.set(
  0x14c, `IMAGE_FILE_MACHINE_I386`
);

