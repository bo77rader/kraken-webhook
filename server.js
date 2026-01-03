const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(bodyParser.text({ type: '*/*' }));

const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
// Set to true for demo (safe testing), false for live trading
const IS_DEMO = true;

// Your current Futures API keys (demo)
const API_KEY = '7l/19mgahFtopiis6jcf4Mr/TjBAVWM4hTng+Vjv62wb8Yrjy6TiDJ7v';
const API_SECRET = 'yCJ1NuOhKO0eocIyBo8yAp2VV+EdbmTpjuQ4gBcLkbMBXeVY5l3IXyQUScnq02rZcBF+PWGkQt7yAqs4EXPIoFzW';

// Base URL
const BASE_URL = IS_DEMO 
  ? 'https://demo-futures.kraken.com'
  : 'https://futures.kraken.com';

// Solana perpetual ticker (current)
const SYMBOL = 'PF_SOLUSD';

// Max leverage cap
const MAX_LEVERAGE = 10;

// =====================

app.post('/webhook', async (req, res) => {
  const message = req.body.trim();
  console.log('Received alert:', message);

  if (!message) {
    return res.status(400).send('Empty message');
  }

  // Parse Autoview-like syntax
  const params = {};
  message.split(' ').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) params[k] = v;
  });

  try {
    if (params.c === 'position') {
      // Close position (market)
      const closed = await closePosition(params.b === 'buy' ? 'sell' : 'buy');
      return res.send(closed ? 'Position closed' : 'No open position');
    }

    // Entry order
    const side = params.b === 'buy' ? 'buy' : 'sell';
    const orderType = params.t === 'limit' ? 'lmt' : 'mkt';
    let qtyPct = parseFloat(params.q) / 100;

    // Get margin balance
    const accounts = await futuresRequest('/api/v3/accounts', 'GET');
    const marginBalanceUSD = parseFloat(accounts.result.accounts.multiCollateral.balances.usd.availableBalance || 0);

    if (marginBalanceUSD <= 0) throw new Error('No available margin balance');

    // Get current mark price
    const tickerData = await futuresRequest('/api/v3/tickers', 'GET');
    const solTicker = tickerData.result.tickers.find(t => t.symbol === SYMBOL);
    if (!solTicker) throw new Error('SOL ticker not found');
    const currentPrice = parseFloat(solTicker.markPrice);

    // Get current position
    const positionsData = await futuresRequest('/api/v3/openpositions', 'GET');
    const solPos = positionsData.result.openPositions.find(p => p.symbol === SYMBOL) || {size: '0'};
    const currentSize = parseFloat(solPos.size);
    const currentNotional = Math.abs(currentSize) * currentPrice;

    qtyPct = Math.min(qtyPct, MAX_LEVERAGE);

    let proposedAdditionalNotional = qtyPct * marginBalanceUSD;

    const maxNotional = MAX_LEVERAGE * marginBalanceUSD;
    const maxAdditionalNotional = maxNotional - currentNotional;

    if (maxAdditionalNotional <= 0) throw new Error('Leverage cap exceeded, cannot open position');

    proposedAdditionalNotional = Math.min(proposedAdditionalNotional, maxAdditionalNotional);

    let contracts = Math.floor(proposedAdditionalNotional / currentPrice);

    if (contracts < 1) throw new Error('Calculated volume too small (min 1 contract)');

    const orderPayload = {
      orderType: orderType,
      symbol: SYMBOL,
      side: side,
      size: contracts.toString(),
    };

    if (orderType === 'lmt' && params.p) {
      orderPayload.limitPrice = parseFloat(params.p).toFixed(2);
    }

    const orderResult = await futuresRequest('/api/v3/sendorder', 'POST', orderPayload);
    console.log('Order result:', orderResult);

    res.send(`Order placed: ${side} ${contracts} contracts @ ${orderType === 'lmt' ? params.p : 'market'}`);
  } catch (err) {
    console.error('Error:', err.message || err);
    res.status(500).send('Error placing order: ' + (err.message || err));
  }
});

// Correct signed request per official Kraken Futures docs (postData + nonce + path concat)
async function futuresRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const nonce = Date.now().toString(); // ms as string
    let postData = '';

    if (data) {
      postData = new URLSearchParams(data).toString(); // URL-encoded form body
    }

    // Official order: postData + nonce + path
    const signString = postData + nonce + path;
    const sha256Digest = crypto.createHash('sha256').update(signString).digest();

    const secretBuffer = Buffer.from(API_SECRET, 'base64');
    const signature = crypto.createHmac('sha512', secretBuffer)
                            .update(sha256Digest)
                            .digest('base64');

    const options = {
      hostname: BASE_URL.replace('https://', ''),
      path: '/derivatives' + path,
      method: method,
      headers: {
        'APIKey': API_KEY,
        'Nonce': nonce,
        'Authent': signature,
      },
    };

    if (data) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.result === 'error') {
            reject(new Error(json.error || json.errorMessage || JSON.stringify(json)));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + body));
        }
      });
    });

    req.on('error', reject);

    if (data) req.write(postData);
    req.end();
  });
}

async function closePosition(side) {
  const positions = await futuresRequest('/api/v3/openpositions', 'GET');
  const solPos = positions.result.openPositions.find(p => p.symbol === SYMBOL);
  if (!solPos || parseFloat(solPos.size) === 0) return false;

  const closeSize = Math.abs(parseFloat(solPos.size)).toString();
  const closeSide = side;

  const closePayload = {
    orderType: 'mkt',
    symbol: SYMBOL,
    side: closeSide,
    size: closeSize,
    reduceOnly: true,
  };

  await futuresRequest('/api/v3/sendorder', 'POST', closePayload);
  return true;
}

app.listen(PORT, () => console.log(`Server running on port ${PORT} | Mode: ${IS_DEMO ? 'DEMO' : 'LIVE'}`));
