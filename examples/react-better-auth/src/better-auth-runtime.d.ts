declare module "bun:sqlite" {
  export class Database {}
}

interface Timer {
  /** Keeps Better Auth's optional Node timer typing available in browser builds. */
  ref(): Timer
  /** Keeps Better Auth's optional Node timer typing available in browser builds. */
  unref(): Timer
  /** Keeps Better Auth's optional Node timer typing available in browser builds. */
  hasRef(): boolean
}
