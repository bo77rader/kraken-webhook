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

const SYMBOL = 'PF_SOLUSD';

const MAX_LEVERAGE = 10;

// Setup CCXT
let exchange = new ccxt.krakenfutures({
  apiKey: API_KEY,
  secret: API_SECRET,
  enableRateLimit: true,
});

if (IS_DEMO) {
  exchange.setSandboxMode(true);
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
    let qtyPct = parseFloat(params.q) / 100 || 0.1; // default to 10% if missing

    console.log('Fetching balance...');
    const balance = await exchange.fetchBalance();
    console.log('Raw balance response:', JSON.stringify(balance));

    const marginBalanceUSD = balance['USD']?.free || balance['PUSD']?.free || balance.info?.availableBalance || 0;
    console.log('Available margin USD:', marginBalanceUSD);

    if (marginBalanceUSD <= 0) throw new Error('No available margin balance');

    console.log('Fetching ticker...');
    const ticker = await exchange.fetchTicker(SYMBOL);
    console.log('Raw ticker response:', JSON.stringify(ticker));

    const currentPrice = ticker.last || ticker.bid || ticker.ask || ticker.markPrice || 0;
    console.log('Current price:', currentPrice);

    if (currentPrice <= 0) throw new Error('Invalid price from ticker');

    console.log('Fetching positions...');
    const positions = await exchange.fetchPositions([SYMBOL]);
    console.log('Raw positions response:', JSON.stringify(positions));

    const solPos = positions.find(p => p.symbol === SYMBOL) || { contracts: 0 };
    const currentSize = Math.abs(solPos.contracts || 0);
    const currentNotional = currentSize * currentPrice;
    console.log('Current position size (contracts):', currentSize);
    console.log('Current notional:', currentNotional);

    qtyPct = Math.min(qtyPct, MAX_LEVERAGE);
    console.log('Effective qtyPct (leverage):', qtyPct);

    let proposedAdditionalNotional = qtyPct * marginBalanceUSD;
    console.log('Proposed additional notional:', proposedAdditionalNotional);

    const maxNotional = MAX_LEVERAGE * marginBalanceUSD;
    const maxAdditionalNotional = maxNotional - currentNotional;
    console.log('Max additional notional (leverage cap):', maxAdditionalNotional);

    if (maxAdditionalNotional <= 0) throw new Error('Leverage cap exceeded');

    proposedAdditionalNotional = Math.min(proposedAdditionalNotional, maxAdditionalNotional);

    let contracts = Math.floor(proposedAdditionalNotional / currentPrice);
    console.log('Calculated contracts:', contracts);

    // Force minimum 1 contract to avoid "too small" and for testing
    if (contracts < 1) {
      console.log('Contracts too small - forcing to 1 for testing');
      contracts = 1;
    }

    const orderParams = { reduceOnly: false };
    if (orderType === 'limit' && params.p) {
      orderParams.price = parseFloat(params.p);
    }

    console.log('Placing order:', side, orderType, contracts, 'contracts');
    const order = await exchange.createOrder(SYMBOL, orderType, side, contracts.toString(), null, orderParams);
    console.log('Order result:', JSON.stringify(order));

    res.send(`Order placed: ${side} ${contracts} contracts @ ${orderType === 'limit' ? params.p : 'market'}`);
  } catch (err) {
    console.error('Full error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).send('Error: ' + (err.message || JSON.stringify(err)));
  }
});

async function closePosition(side) {
  try {
    console.log('Fetching positions for close...');
    const positions = await exchange.fetchPositions([SYMBOL]);
    console.log('Raw positions for close:', JSON.stringify(positions));

    const solPos = positions.find(p => p.symbol === SYMBOL);
    if (!solPos || Math.abs(solPos.contracts || 0) === 0) {
      console.log('No position to close');
      return false;
    }

    const closeSize = Math.abs(solPos.contracts).toString();
    console.log('Closing position with size:', closeSize);

    await exchange.createOrder(SYMBOL, 'market', side, closeSize, null, { reduceOnly: true });
    console.log('Close order sent');
    return true;
  } catch (err) {
    console.error('Close error:', err);
    return false;
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT} | Mode: ${IS_DEMO ? 'DEMO' : 'LIVE'}`));