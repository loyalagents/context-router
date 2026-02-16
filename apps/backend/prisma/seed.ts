import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function generateApiKey(prefix: string): string {
  const key = `${prefix}-${randomBytes(16).toString('hex')}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error(`Invalid key format: ${key}`);
  }
  return key;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function main() {
  console.log('Seeding workshop database...\n');

  // --- Group A ---
  const groupAKey = generateApiKey('grp-a');
  const groupA = await prisma.apiKey.create({
    data: { keyHash: hashKey(groupAKey), groupName: 'Group A' },
  });

  const groupAUsers = await Promise.all([
    prisma.user.upsert({
      where: { email: 'alice@workshop.dev' },
      update: {},
      create: { email: 'alice@workshop.dev', firstName: 'Alice', lastName: 'Anderson' },
    }),
    prisma.user.upsert({
      where: { email: 'bob@workshop.dev' },
      update: {},
      create: { email: 'bob@workshop.dev', firstName: 'Bob', lastName: 'Brown' },
    }),
    prisma.user.upsert({
      where: { email: 'carol@workshop.dev' },
      update: {},
      create: { email: 'carol@workshop.dev', firstName: 'Carol', lastName: 'Chen' },
    }),
  ]);

  for (const user of groupAUsers) {
    await prisma.apiKeyUser.upsert({
      where: { apiKeyId_userId: { apiKeyId: groupA.id, userId: user.userId } },
      update: {},
      create: { apiKeyId: groupA.id, userId: user.userId },
    });
  }

  // --- Group B ---
  const groupBKey = generateApiKey('grp-b');
  const groupB = await prisma.apiKey.create({
    data: { keyHash: hashKey(groupBKey), groupName: 'Group B' },
  });

  const groupBUsers = await Promise.all([
    prisma.user.upsert({
      where: { email: 'dave@workshop.dev' },
      update: {},
      create: { email: 'dave@workshop.dev', firstName: 'Dave', lastName: 'Davis' },
    }),
    prisma.user.upsert({
      where: { email: 'eve@workshop.dev' },
      update: {},
      create: { email: 'eve@workshop.dev', firstName: 'Eve', lastName: 'Evans' },
    }),
    prisma.user.upsert({
      where: { email: 'frank@workshop.dev' },
      update: {},
      create: { email: 'frank@workshop.dev', firstName: 'Frank', lastName: 'Fisher' },
    }),
  ]);

  for (const user of groupBUsers) {
    await prisma.apiKeyUser.upsert({
      where: { apiKeyId_userId: { apiKeyId: groupB.id, userId: user.userId } },
      update: {},
      create: { apiKeyId: groupB.id, userId: user.userId },
    });
  }

  // --- Print credentials (only time plaintext keys are visible) ---
  console.log('='.repeat(60));
  console.log('WORKSHOP CREDENTIALS');
  console.log('='.repeat(60));

  console.log('\n--- Group A ---');
  console.log(`API Key: ${groupAKey}`);
  console.log('Users:');
  for (const user of groupAUsers) {
    console.log(`  ${user.firstName} ${user.lastName} (${user.email}) - ID: ${user.userId}`);
  }

  console.log('\n--- Group B ---');
  console.log(`API Key: ${groupBKey}`);
  console.log('Users:');
  for (const user of groupBUsers) {
    console.log(`  ${user.firstName} ${user.lastName} (${user.email}) - ID: ${user.userId}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Save these keys! They cannot be retrieved after this.');
  console.log('='.repeat(60));
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
