const express = require('express');
const bodyParser = require('body-parser');
const ccxt = require('ccxt');

const app = express();
app.use(bodyParser.text({ type: '*/*' }));

const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
const IS_DEMO = true;

const API_KEY = '7l/19mgahFtopiis6jcf4Mr/TjBAVWM4hTng+Vjv62wb8Yrjy6TiDJ7v';
const API_SECRET = 'yCJ1NuOhKO0eocIyBo8yAp2VV+EdbmTpjuQ4gBcLkbMBXeVY5l3IXyQUScnq02rZcBF+PWGkQt7yAqs4EXPIoFzW';

const SYMBOL = 'PF_SOLUSD'; // Current Kraken SOL perpetual

const MAX_LEVERAGE = 10;

// Setup CCXT exchange
let exchange = new ccxt.krakenfutures({
  apiKey: API_KEY,
  secret: API_SECRET,
  enableRateLimit: true,
});

if (IS_DEMO) {
  exchange.setSandboxMode(true); // Uses demo URLs automatically
}

// =====================

app.post('/webhook', async (req, res) => {
  const message = req.body.trim();
  console.log('Received alert:', message);

  if (!message) {
    return res.status(400).send('Empty message');
  }

  const params = {};
  message.split(' ').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) params[k] = v;
  });

  try {
    if (params.c === 'position') {
      const closed = await closePosition(params.b === 'buy' ? 'sell' : 'buy');
      return res.send(closed ? 'Position closed' : 'No open position');
    }

    const side = params.b === 'buy' ? 'buy' : 'sell';
    const orderType = params.t === 'limit' ? 'limit' : 'market';
    let qtyPct = parseFloat(params.q) / 100;

    // Get available USD balance
    const balance = await exchange.fetchBalance();
    const marginBalanceUSD = balance.free.USD || balance.free.PUSD || 0; // USD or collateral

    if (marginBalanceUSD <= 0) throw new Error('No available margin balance');

    // Get mark price
    const ticker = await exchange.fetchTicker(SYMBOL);
    const currentPrice = ticker.mark || ticker.last;

    // Get current position
    const positions = await exchange.fetchPositions([SYMBOL]);
    const solPos = positions[0] || { contracts: 0 };
    const currentSize = Math.abs(solPos.contracts || 0);
    const currentNotional = currentSize * currentPrice;

    qtyPct = Math.min(qtyPct, MAX_LEVERAGE);

    let proposedAdditionalNotional = qtyPct * marginBalanceUSD;

    const maxNotional = MAX_LEVERAGE * marginBalanceUSD;
    const maxAdditionalNotional = maxNotional - currentNotional;

    if (maxAdditionalNotional <= 0) throw new Error('Leverage cap exceeded');

    proposedAdditionalNotional = Math.min(proposedAdditionalNotional, maxAdditionalNotional);

    let contracts = Math.floor(proposedAdditionalNotional / currentPrice);

    if (contracts < 1) throw new Error('Volume too small (min 1 contract)');

    // Place order
    const orderParams = {};
    if (orderType === 'limit' && params.p) {
      orderParams.price = parseFloat(params.p);
    }

    const order = await exchange.createOrder(SYMBOL, orderType, side, contracts, null, orderParams);

    console.log('Order result:', order);

    res.send(`Order placed: ${side} ${contracts} contracts @ ${orderType === 'limit' ? params.p : 'market'}`);
  } catch (err) {
    console.error('Error:', err.message || err);
    res.status(500).send('Error: ' + (err.message || err));
  }
});

async function closePosition(side) {
  const positions = await exchange.fetchPositions([SYMBOL]);
  const solPos = positions[0];
  if (!solPos || Math.abs(solPos.contracts || 0) === 0) return false;

  const closeSize = Math.abs(solPos.contracts);

  await exchange.createOrder(SYMBOL, 'market', side, closeSize, null, { reduceOnly: true });

  return true;
}

app.listen(PORT, () => console.log(`Server running on port ${PORT} | Mode: ${IS_DEMO ? 'DEMO' : 'LIVE'}`));
