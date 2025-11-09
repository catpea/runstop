import runstop from './index.js';

const users = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'user' }
];

for (const user of users) {
  const metadata = {
    timestamp: new Date(),
    processed: user.id
  };

  await runstop({
    user,
    metadata,
    remaining: users.length - user.id
  });

  console.log(`Processed user ${user.name}`);
}

console.log('Done!');
