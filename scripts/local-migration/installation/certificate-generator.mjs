// P1 fixture only, copied into the reviewed private dependency closure.
// Not a production dependency or session initializer.
import 'reflect-metadata';
import { webcrypto, randomBytes } from 'node:crypto';
import { X509CertificateGenerator, BasicConstraintsExtension, SubjectAlternativeNameExtension } from '@peculiar/x509';

export async function generateCertificateFixture({ now = Math.floor(Date.now() / 1000) * 1000, ip = '127.0.0.1', ca = true } = {}) {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const certificate = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=ContextRouterLocal', keys,
    notBefore: new Date(now), notAfter: new Date(now + 86_400_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [new BasicConstraintsExtension(ca, undefined, true),
      new SubjectAlternativeNameExtension([{ type: 'ip', value: ip }])],
  }, webcrypto);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  der.fill(0);
  return { certificate: certificate.toString('pem') + '\n', privateKey, apiKey: randomBytes(32).toString('hex') };
}
