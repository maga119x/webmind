import "dotenv/config";
import { createApp } from "./app";
const { app } = await createApp();
await app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
