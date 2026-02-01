
export class NotEnoughBytesError extends Error {
  has: number;
  need: number;

  constructor(has: number, need: number) {
    super();
    this.has = has;
    this.need = need;
  }
}
