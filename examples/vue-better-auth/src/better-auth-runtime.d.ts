declare module "bun:sqlite" {
  export class Database {}
}

interface Timer {
  ref(): Timer
  unref(): Timer
  hasRef(): boolean
}
