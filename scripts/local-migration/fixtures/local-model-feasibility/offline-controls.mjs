import net from 'node:net';
import dgram from 'node:dgram';

const denied = (error) => ['EPERM', 'EACCES'].includes(error?.code);
export async function tcpDenied(options) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(options);
    const timer = setTimeout(() => socket.destroy(new Error('Negative control timed out')), 2000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Forbidden connection succeeded')); });
    socket.once('error', (error) => denied(error) ? resolve(error.code) : reject(new Error(`Negative control inconclusive: ${error.code ?? 'timeout'}`)));
    socket.once('close', () => clearTimeout(timer));
  });
}
export async function udpDenied() {
  const socket = dgram.createSocket('udp4');
  try {
    return await new Promise((resolve, reject) => {
      const fail = (error) => denied(error) ? resolve(error.code) : reject(new Error(`DNS transport denial inconclusive: ${error?.code}`));
      socket.once('error', fail);
      socket.send(Buffer.from([0]), 53, '192.0.2.1', (error) => error ? fail(error) : reject(new Error('Forbidden DNS transport succeeded')));
    });
  } finally { socket.close(); }
}
export async function offlineControls(port) {
  return {
    nonLoopback: await tcpDenied({ host: '192.0.2.1', port: 443 }),
    otherLoopbackPort: await tcpDenied({ host: '127.0.0.1', port: port === 49198 ? 49199 : 49198 }),
    dnsTransport: await udpDenied(),
    resolverUnixIpc: await tcpDenied({ path: '/var/run/mDNSResponder' }),
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(await offlineControls(Number(process.argv[2]))));
