import { DataDirectory } from "./DataDirectory.ts";
import { hex } from "./helpers.ts";

export class OptionalHeader {
  // Standard fields
  private _magic: number;
  private _majorLinkerVersion: number;
  private _minorLinkerVersion: number;
  private _sizeOfCode: number;
  private _sizeOfInitializedData: number;
  private _sizeOfUninitializedData: number;
  private _addressOfEntryPoint: number;
  private _baseOfCode: number;
  private _baseOfData: number; // PE32 only


  // Windows-specific fields
  private _imageBase: number;
  private _sectionAlignment: number;
  private _fileAlignment: number;
  private _majorOperatingSystemVersion: number;
  private _minorOperatingSystemVersion: number;
  private _majorImageVersion: number;
  private _minorImageVersion: number;
  private _majorSubsystemVersion: number;
  private _minorSubsystemVersion: number;
  private _win32VersionValue: number;
  private _sizeOfImage: number;
  private _sizeOfHeaders: number;
  private _checkSum: number;
  private _subsystem: number;
  private _dllCharacteristics: number;
  private _sizeOfStackReserve: number;
  private _sizeOfStackCommit: number;
  private _sizeOfHeapReserve: number;
  private _sizeOfHeapCommit: number;
  private _loaderFlags: number;
  private _numberOfRvaAndSizes: number;

  // Data directories
  private _dataDirectories: DataDirectory[];

  constructor(data: Buffer) {
    // Standard fields (offsets 0-23 shared between PE32 and PE32+)
    this._magic = data.readUInt16LE(0);
    this._majorLinkerVersion = data.readUInt8(2);
    this._minorLinkerVersion = data.readUInt8(3);
    this._sizeOfCode = data.readUInt32LE(4);
    this._sizeOfInitializedData = data.readUInt32LE(8);
    this._sizeOfUninitializedData = data.readUInt32LE(12);
    this._addressOfEntryPoint = data.readUInt32LE(16);
    this._baseOfCode = data.readUInt32LE(20);

    if (this.isPE32Plus) {
      // PE32+: no BaseOfData, ImageBase is 8 bytes at offset 24
      this._baseOfData = 0;
      this._imageBase = Number(data.readBigUInt64LE(24));
    } else {
      // PE32: BaseOfData at offset 24, ImageBase at offset 28 (4 bytes each)
      this._baseOfData = data.readUInt32LE(24);
      this._imageBase = data.readUInt32LE(28);
    }

    // Offsets 32-70 are the same for both PE32 and PE32+
    this._sectionAlignment = data.readUInt32LE(32);
    this._fileAlignment = data.readUInt32LE(36);
    this._majorOperatingSystemVersion = data.readUInt16LE(40);
    this._minorOperatingSystemVersion = data.readUInt16LE(42);
    this._majorImageVersion = data.readUInt16LE(44);
    this._minorImageVersion = data.readUInt16LE(46);
    this._majorSubsystemVersion = data.readUInt16LE(48);
    this._minorSubsystemVersion = data.readUInt16LE(50);
    this._win32VersionValue = data.readUInt32LE(52);
    this._sizeOfImage = data.readUInt32LE(56);
    this._sizeOfHeaders = data.readUInt32LE(60);
    this._checkSum = data.readUInt32LE(64);
    this._subsystem = data.readUInt16LE(68);
    this._dllCharacteristics = data.readUInt16LE(70);

    if (this.isPE32Plus) {
      // PE32+: 8-byte stack/heap sizes
      this._sizeOfStackReserve = Number(data.readBigUInt64LE(72));
      this._sizeOfStackCommit = Number(data.readBigUInt64LE(80));
      this._sizeOfHeapReserve = Number(data.readBigUInt64LE(88));
      this._sizeOfHeapCommit = Number(data.readBigUInt64LE(96));
      this._loaderFlags = data.readUInt32LE(104);
      this._numberOfRvaAndSizes = data.readUInt32LE(108);
    } else {
      // PE32: 4-byte stack/heap sizes
      this._sizeOfStackReserve = data.readUInt32LE(72);
      this._sizeOfStackCommit = data.readUInt32LE(76);
      this._sizeOfHeapReserve = data.readUInt32LE(80);
      this._sizeOfHeapCommit = data.readUInt32LE(84);
      this._loaderFlags = data.readUInt32LE(88);
      this._numberOfRvaAndSizes = data.readUInt32LE(92);
    }

    // Parse data directories
    const ddOffset = this.isPE32Plus ? 112 : 96;
    this._dataDirectories = [];
    for (let i = 0; i < this._numberOfRvaAndSizes; i++) {
      const offset = ddOffset + i * DataDirectory.sizeOf;
      this._dataDirectories.push(
        new DataDirectory(data.subarray(offset, offset + DataDirectory.sizeOf), i)
      );
    }
  }

  get isPE32Plus() {
    return this._magic === 0x20b;
  }

  get sizeOf() {
    const base = this.isPE32Plus ? 112 : 96;
    return base + this._numberOfRvaAndSizes * DataDirectory.sizeOf;
  }

  get magic() { return this._magic; }
  get majorLinkerVersion() { return this._majorLinkerVersion; }
  get minorLinkerVersion() { return this._minorLinkerVersion; }
  get sizeOfCode() { return this._sizeOfCode; }
  get sizeOfInitializedData() { return this._sizeOfInitializedData; }
  get sizeOfUninitializedData() { return this._sizeOfUninitializedData; }
  get addressOfEntryPoint() { return this._addressOfEntryPoint; }
  get baseOfCode() { return this._baseOfCode; }
  get baseOfData() { return this._baseOfData; }
  get imageBase() { return this._imageBase; }
  get sectionAlignment() { return this._sectionAlignment; }
  get fileAlignment() { return this._fileAlignment; }
  get majorOperatingSystemVersion() { return this._majorOperatingSystemVersion; }
  get minorOperatingSystemVersion() { return this._minorOperatingSystemVersion; }
  get majorImageVersion() { return this._majorImageVersion; }
  get minorImageVersion() { return this._minorImageVersion; }
  get majorSubsystemVersion() { return this._majorSubsystemVersion; }
  get minorSubsystemVersion() { return this._minorSubsystemVersion; }
  get win32VersionValue() { return this._win32VersionValue; }
  get sizeOfImage() { return this._sizeOfImage; }
  get sizeOfHeaders() { return this._sizeOfHeaders; }
  get checkSum() { return this._checkSum; }
  get subsystem() { return this._subsystem; }
  get dllCharacteristics() { return this._dllCharacteristics; }
  get sizeOfStackReserve() { return this._sizeOfStackReserve; }
  get sizeOfStackCommit() { return this._sizeOfStackCommit; }
  get sizeOfHeapReserve() { return this._sizeOfHeapReserve; }
  get sizeOfHeapCommit() { return this._sizeOfHeapCommit; }
  get loaderFlags() { return this._loaderFlags; }
  get numberOfRvaAndSizes() { return this._numberOfRvaAndSizes; }
  get dataDirectories() { return this._dataDirectories; }

  toString() {
    const format = this.isPE32Plus ? 'PE32+' : 'PE32';
    const lines = [
      `Magic:                        ${hex(this._magic, 4)} (${format})`,
      `LinkerVersion:                ${this._majorLinkerVersion}.${this._minorLinkerVersion}`,
      `SizeOfCode:                   ${hex(this._sizeOfCode)}`,
      `SizeOfInitializedData:        ${hex(this._sizeOfInitializedData)}`,
      `SizeOfUninitializedData:      ${hex(this._sizeOfUninitializedData)}`,
      `AddressOfEntryPoint:          ${hex(this._addressOfEntryPoint)}`,
      `BaseOfCode:                   ${hex(this._baseOfCode)}`,
    ];
    if (!this.isPE32Plus) {
      lines.push(`BaseOfData:                   ${hex(this._baseOfData)}`);
    }
    lines.push(
      `ImageBase:                    ${hex(this._imageBase)}`,
      `SectionAlignment:             ${hex(this._sectionAlignment)}`,
      `FileAlignment:                ${hex(this._fileAlignment)}`,
      `OperatingSystemVersion:       ${this._majorOperatingSystemVersion}.${this._minorOperatingSystemVersion}`,
      `ImageVersion:                 ${this._majorImageVersion}.${this._minorImageVersion}`,
      `SubsystemVersion:             ${this._majorSubsystemVersion}.${this._minorSubsystemVersion}`,
      `Win32VersionValue:            ${this._win32VersionValue}`,
      `SizeOfImage:                  ${hex(this._sizeOfImage)}`,
      `SizeOfHeaders:                ${hex(this._sizeOfHeaders)}`,
      `CheckSum:                     ${hex(this._checkSum)}`,
      `Subsystem:                    ${hex(this._subsystem, 4)}`,
      `DllCharacteristics:           ${hex(this._dllCharacteristics, 4)}`,
      `SizeOfStackReserve:           ${hex(this._sizeOfStackReserve)}`,
      `SizeOfStackCommit:            ${hex(this._sizeOfStackCommit)}`,
      `SizeOfHeapReserve:            ${hex(this._sizeOfHeapReserve)}`,
      `SizeOfHeapCommit:             ${hex(this._sizeOfHeapCommit)}`,
      `LoaderFlags:                  ${hex(this._loaderFlags)}`,
      `NumberOfRvaAndSizes:          ${this._numberOfRvaAndSizes}`,
      ``,
      `Data Directories:`,
      ...this._dataDirectories.map((dd, i) => `  [${i.toString().padStart(2)}] ${dd}`)
    );
    return lines.join('\n');
  }
}
