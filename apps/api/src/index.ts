import Fastify from "fastify";
import cors from "@fastify/cors";
import { CreateRunSchema } from "@acme/core/src/contracts";

const app = Fastify({ logger: true });

// Allow calls from the browser during local dev (React on 5173 etc.)
await app.register(cors, { origin: true });

app.get("/health", async () => {
  return { ok: true };
});

// Create run (stub for now)
app.post("/runs", async (request, reply) => {
  const parsed = CreateRunSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  return reply.status(201).send({
    message: "Run accepted (stub)",
    received: parsed.data
  });
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
