const express = require('express');
const bodyParser = require('body-parser');
const KrakenClient = require('kraken-api');

const app = express();
app.use(bodyParser.text({ type: '*/*' })); // Handles plain text from TradingView

const PORT = process.env.PORT || 3000; // Important for hosting

// REPLACE THESE WITH YOUR REAL KRAKEN API KEYS (create on Kraken → Settings → API → Generate new key with trading permissions)
const key = 's7jGaGXgFLmd0PBGjwQcRiK8fv9Fz8F7AxCTNzHqFhObks8TmyNZvCTG';
const secret = 'zYnkU0xg5BJl9xb0JdesNejc9v5VzgpIWQZic0hjUs/uCDglWkgMFFQD2n1Ev4htHKQdZUN8gPtDVUvFzkjztQ==';
const kraken = new KrakenClient(key, secret);

// Trading pair, e.g., 'XXBTZUSD' for BTC/USD or 'XETHZUSD' for ETH/USD
const PAIR = 'XSOLZUSD';

app.post('/webhook', async (req, res) => {
  const message = req.body.trim();
  console.log('Received alert:', message);

  if (!message) {
    return res.status(400).send('Empty message');
  }

  // Parse Autoview-like syntax: b=buy/sell q=XX% t=market/limit p=price sl=XX% tp=XX%
  const params = {};
  message.split(' ').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) params[k] = v;
  });

  try {
    if (params.c === 'position') {
      // Close entire position (market)
      const closed = await closePosition(params.b); // b indicates direction for opposing close
      res.send(closed ? 'Position closed' : 'No position or error');
      return;
    }

    // Entry order
    const side = params.b === 'buy' ? 'buy' : 'sell';
    const type = params.t || 'market';
    const qtyPct = parseFloat(params.q) / 100;

    // Get USD balance for sizing (adjust for short if needed)
    const balance = await kraken.api('Balance');
    const usdBalance = parseFloat(balance.result.ZUSD || 0);

    let volume = (usdBalance * qtyPct) / (await getCurrentPrice()); // Approx volume in base currency

    const orderParams = {
      pair: PAIR,
      type: side,
      ordertype: type === 'limit' ? 'limit' : 'market',
      volume: volume.toFixed(8),
    };

    if (type === 'limit' && params.p) {
      orderParams.price = parseFloat(params.p);
    }

    // Place main entry order
    const order = await kraken.api('AddOrder', orderParams);
    console.log('Entry order:', order);

    // For SL/TP as percentages – Kraken doesn't have direct % attached, but we can calculate and place separate stop-loss orders
    if (params.sl || params.tp) {
      // Example: place a stop-loss-limit order after entry fills (simplified – in production monitor fill)
      // This is basic; for full automation you'd poll OpenOrders or use conditional orders
    }

    res.send('Order placed');
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Error placing order');
  }
});

async function getCurrentPrice() {
  const ticker = await kraken.api('Ticker', { pair: PAIR });
  return parseFloat(ticker.result[PAIR].c[0]);
}

async function closePosition(directionFromAlert) {
  // Simple full close – get open positions and close
  const trades = await kraken.api('OpenPositions');
  if (Object.keys(trades.result).length === 0) return false;

  // For spot, use market sell/buy to close – adjust logic as needed
  // Example market close:
  const side = directionFromAlert === 'buy' ? 'sell' : 'buy'; // opposing
  // Calculate volume from balance...
  // ...
  return true;
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));