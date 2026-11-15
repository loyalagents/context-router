import { request } from "node:https";
import type { AuthorizationRepository } from "./authority";

/** One owned worker; destinations are immutable fixture registrations, never input URLs. */
export function startNotifications(
  authority: AuthorizationRepository,
  ca: Buffer,
) {
  let stopped = false,
    running: Promise<void> | undefined,
    active: ReturnType<typeof request> | undefined;
  const deliver = (job: any): Promise<{ status: number; error?: string }> =>
    new Promise((resolve) => {
      const endpoint = new URL(job.endpoint);
      if (
        !authority.configuration.clients.some(
          (c) => c.notificationEndpoint === endpoint.href,
        ) ||
        endpoint.protocol !== "https:" ||
        !["client-a.hcp.test", "client-b.hcp.test"].includes(
          endpoint.hostname,
        ) ||
        endpoint.pathname !== "/revocations" ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.username ||
        endpoint.password
      ) {
        resolve({ status: 0 });
        return;
      }
      let settled = false,
        terminalStatus = 0;
      const finish = (result: { status: number; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        active = undefined;
        resolve(result);
      };
      const deadline = setTimeout(() => {
        active?.destroy();
        finish({ status: terminalStatus });
      }, 5000);
      active = request(
        endpoint,
        {
          method: "POST",
          agent: false,
          ca,
          servername: endpoint.hostname,
          minVersion: "TLSv1.2",
          headers: {
            "content-type": "application/secevent+jwt",
            "content-length": Buffer.byteLength(job.token),
          },
          lookup: (_hostname, options: any, callback: any) =>
            options.all
              ? callback(null, [{ address: "127.0.0.1", family: 4 }])
              : callback(null, "127.0.0.1", 4),
        },
        (res) => {
          if (res.statusCode === 202 || res.statusCode === 400)
            terminalStatus = res.statusCode;
          if (terminalStatus === 202) {
            res.destroy();
            finish({ status: 202 });
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 4096) {
              res.destroy();
              finish({ status: terminalStatus });
            } else chunks.push(chunk);
          });
          res.on("error", () => finish({ status: terminalStatus }));
          res.on("end", () => {
            let error: string | undefined;
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString());
              if (
                typeof parsed.err === "string" &&
                /^[a-z_]{1,80}$/.test(parsed.err)
              )
                error = parsed.err;
            } catch {
              /* An empty acknowledgement is valid. */
            }
            finish({ status: res.statusCode ?? 0, error });
          });
        },
      );
      active.on("error", () => finish({ status: terminalStatus }));
      active.end(job.token);
    });
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      const job = authority.prepareNotification();
      if (!job || stopped) return;
      const result = await deliver(job);
      if (!stopped)
        authority.finishNotification(job.grantId, result.status, result.error);
    })()
      .catch(() => {
        /* Local revocation already committed; retain the pending job. */
      })
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return {
    async close() {
      stopped = true;
      clearInterval(timer);
      active?.destroy();
      await running;
    },
  };
}
