import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../src/veritio/auth";

export const { GET, POST } = toNextJsHandler(auth);
