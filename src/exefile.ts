import { readFileSync } from "node:fs";

export class NotEnoughBytesError extends Error {
  has: number;
  need: number;

  constructor(has: number, need: number) {
    super();
    this.has = has;
    this.need = need;
  }
}

const MachineType: Map<number, string> = new Map()
MachineType.set(
    0x14c, `IMAGE_FILE_MACHINE_I386`
)

class COFFFileHeader {
    private _machine: string

    public static get sizeOf() {
        return 6
    }

    constructor(data: Buffer) {
        this._machine = MachineType.get(data.readInt16LE(4)) ?? ""
    }

    get machine() {
        return this._machine
    }

    toString() {
        return `Machine: ${this._machine}`
    }
}

export class EXEFile {
  private _filePath = "";
  private _fileImage: Buffer = Buffer.alloc(0);
  private _imageSize = 0;
  private _peStartOffset= 0
  private _coffFileHEader: COFFFileHeader

  constructor(filePath: string) {
    this._filePath = filePath;
    console.log(`loading ${this._filePath}`);
    this._fileImage = (readFileSync(this._filePath)) as unknown as Buffer;
    this._imageSize = this._fileImage.byteLength;
    this._peStartOffset = get16(this._fileImage, 0x3c)
    this._coffFileHEader = new COFFFileHeader(this._fileImage.subarray(this._peStartOffset, this._peStartOffset + COFFFileHeader.sizeOf))
  }


  get filePath() {
    return this._filePath;
  }


  get sizeOnDisk() {
    return this._imageSize;
  }

  get fileSignature() {
    return this._fileImage.subarray(0, 2).toString()
  }

  get peStartOffset() {
    return this._peStartOffset
  }

  get machineType() {
    return this._coffFileHEader.machine
  }
}

  function get16(buffer: Buffer, offset: number) {
    return buffer.readInt16LE(offset)
  }

