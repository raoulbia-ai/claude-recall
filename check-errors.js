const { QueueSystem } = require('./dist/services/queue-system');

const queueSystem = QueueSystem.getInstance();

// Check retrying messages
const retrying = queueSystem.executeQuery(
  "SELECT * FROM queue_messages WHERE status = 'retrying' ORDER BY id DESC LIMIT 3"
);

console.log('Retrying messages:');
retrying.forEach(msg => {
  console.log(`ID: ${msg.id}, Type: ${msg.message_type}, Attempts: ${msg.attempts}`);
  console.log(`Payload: ${msg.payload}`);
  console.log('---');
});

// Check dead letter queue
const dlq = queueSystem.executeQuery(
  "SELECT * FROM dead_letter_queue ORDER BY id DESC LIMIT 3"
);

console.log('\nDead letter queue:');
if (dlq.length === 0) {
  console.log('Empty');
} else {
  dlq.forEach(msg => {
    console.log(`Error: ${msg.error_message}`);
    console.log(`Payload: ${msg.payload}`);
    console.log('---');
  });
}
