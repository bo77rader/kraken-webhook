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

const SYMBOL = 'SOL/USD:USD';

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

    let qStr = (params.q || '20').replace('%', '').trim();
    let qtyPct = parseFloat(qStr) / 100 || 0.2;

    console.log('Fetching balance...');
    const balance = await exchange.fetchBalance();
    console.log('Raw balance:', JSON.stringify(balance));

    const marginBalanceUSD = balance.free['USD'] || 0;
    console.log('Available margin USD:', marginBalanceUSD);

    if (marginBalanceUSD <= 0) throw new Error('No available margin balance');

    console.log('Fetching ticker...');
    const ticker = await exchange.fetchTicker(SYMBOL);
    console.log('Raw ticker:', JSON.stringify(ticker));

    const currentPrice = parseFloat(ticker.last || ticker.markPrice || 0);
    console.log('Current price:', currentPrice);

    if (currentPrice <= 0) throw new Error('Invalid price');

    console.log('Fetching positions...');
    const positions = await exchange.fetchPositions([SYMBOL]);
    console.log('Raw positions:', JSON.stringify(positions));

    const solPos = positions.find(p => p.symbol === SYMBOL) || { contracts: 0 };
    const currentSize = Math.abs(parseFloat(solPos.contracts || 0));
    const currentNotional = currentSize * currentPrice;

    qtyPct = Math.min(qtyPct, MAX_LEVERAGE);

    let proposedAdditionalNotional = qtyPct * marginBalanceUSD;

    const maxNotional = MAX_LEVERAGE * marginBalanceUSD;
    const maxAdditionalNotional = maxNotional - currentNotional;

    if (maxAdditionalNotional <= 0) throw new Error('Leverage cap exceeded');

    proposedAdditionalNotional = Math.min(proposedAdditionalNotional, maxAdditionalNotional);

    let contracts = Math.floor(proposedAdditionalNotional / currentPrice);

    if (contracts < 1) {
      console.log('Forcing min 1 contract');
      contracts = 1;
    }

    // Use CCXT precision for amount
    const amount = exchange.amountToPrecision(SYMBOL, contracts);
    console.log('Precise amount:', amount);

    let price = undefined;
    if (orderType === 'limit' && params.p) {
      price = exchange.priceToPrecision(SYMBOL, parseFloat(params.p));
      console.log('Precise limit price:', price);
    }

    const orderParams = { reduceOnly: false };

    console.log('Placing order:', side, orderType, amount, price ? 'at ' + price : 'market');
    const order = await exchange.createOrder(SYMBOL, orderType, side, amount, price, orderParams);
    console.log('Order result:', JSON.stringify(order));

    res.send(`Order placed: ${side} ${amount} contracts @ ${orderType === 'limit' ? price : 'market'}`);
  } catch (err) {
    console.error('Error:', err.message || JSON.stringify(err));
    res.status(500).send('Error: ' + (err.message || JSON.stringify(err)));
  }
});

async function closePosition(side) {
  try {
    const positions = await exchange.fetchPositions([SYMBOL]);
    const solPos = positions.find(p => p.symbol === SYMBOL);

    if (!solPos || Math.abs(parseFloat(solPos.contracts || 0)) === 0) return false;

    const closeSize = exchange.amountToPrecision(SYMBOL, Math.abs(parseFloat(solPos.contracts)));

    await exchange.createOrder(SYMBOL, 'market', side, closeSize, undefined, { reduceOnly: true });
    return true;
  } catch (err) {
    console.error('Close error:', err.message);
    return false;
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT} | Mode: ${IS_DEMO ? 'DEMO' : 'LIVE'}`));