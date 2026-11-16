/** Source fixture tool lookup only; never selects an application/data root. */
export function hcpSourceToolEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, LANG: "C" };
}
