const crypto = require('crypto');

const API_KEY = '7l/19mgahFtopiis6jcf4Mr/TjBAVWM4hTng+Vjv62wb8Yrjy6TiDJ7v';
const API_SECRET = 'yCJ1NuOhKO0eocIyBo8yAp2VV+EdbmTpjuQ4gBcLkbMBXeVY5l3IXyQUScnq02rZcBF+PWGkQt7yAqs4EXPIoFzW';

const path = '/api/v3/accounts';
const nonce = Date.now();  // Fresh ms timestamp

const postData = '';  // Empty for GET
const signString = nonce.toString() + postData;
const sha256Digest = crypto.createHash('sha256').update(signString).digest();
const messageBuffer = Buffer.concat([Buffer.from(path), sha256Digest]);

const secretBuffer = Buffer.from(API_SECRET, 'base64');
const signature = crypto.createHmac('sha512', secretBuffer).update(messageBuffer).digest('base64');

console.log('Fresh Nonce:', nonce);
console.log('Fresh Authent:', signature);
console.log('\n--- COPY AND PASTE THIS SINGLE LINE INTO PowerShell IMMEDIATELY ---');
console.log(`curl.exe -X GET "https://demo-futures.kraken.com/derivatives${path}" -H "APIKey: ${API_KEY}" -H "Nonce: ${nonce}" -H "Authent: ${signature}" -v`);