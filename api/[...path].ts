import { appPromise } from "../server.js";

// Vercel's Node runtime calls this per-request instead of the app ever
// binding a real port — appPromise is built once and reused across warm
// invocations of the same instance, same as any other module-level cache.
export default async function handler(req: any, res: any) {
  const app = await appPromise;
  app(req, res);
}
