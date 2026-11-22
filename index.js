import express from 'express';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const client = new MongoClient(
  `mongodb+srv://${process.env.MONGO_DB_NAME}:${process.env.MONGO_DB_PASS}@cluster0.buouugs.mongodb.net/`
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('You successfully connected to MongoDB!');
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db('PizzaHub-DataBase');
const dbUsers = database.collection('user');
const menus = database.collection('menu');
const orders = database.collection('orders');
const transactions = database.collection('transactions');

const app = express();
const port = 5000;
app.use(cors());
app.use(express.json());

// JWT secret - .env 
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

// VERIFY TOKEN middleware - Authorization: 

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'Unauthorized access.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    next();
  } catch {
    return res.status(401).send({ error: 'Invalid or expired token.' });
  }
}

// VERIFY ADMIN middleware - 

async function verifyAdmin(req, res, next) {
  const email = req.decoded?.email;
  const user = email ? await dbUsers.findOne({ email }) : null;

  if (!user || user.role !== 'admin') {
    return res.status(403).send({ error: 'Forbidden access.' });
  }
  next();
}

// JWT TOKEN API (public) -
app.post('/jwt', async (req, res) => {
  const { email, userId, role } = req.body;


  const user = email ? await dbUsers.findOne({ email }) : null;

  const payload = {
    email: email || user?.email || '',
    userId: userId || user?._id?.toString() || '',
    role: role || user?.role || '',
  };

  // Token sign - 7 din 
  const token = jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: '7d' });
  res.send({ token });
});

// db user load
app.get('/users', verifyToken, async (req, res) => {
  const result = await dbUsers.find().toArray();
  res.send(result);
});

// MENU POST API
app.post('/menus', verifyToken, async (req, res) => {
  const menuItems = req.body;
  menuItems.status = 'Pending';

  const result = await menus.insertOne(menuItems);
  res.send(result);
  console.log('menu post', result);
});

// GET MENU API
app.get('/menus', async (req, res) => {
  const query = {};

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.status) {
    query.status = req.query.status;
  }

  if (req.query.vendorEmail) {
    query.vendorEmail = req.query.vendorEmail;
  }
  if (req.query.vendorId) {
    query.vendorId = req.query.vendorId;
  }

  if (req.query.location) {
    query.location = { $regex: req.query.location, $options: 'i' };
  }

  if (req.query.search) {
    query.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { description: { $regex: req.query.search, $options: 'i' } },
      { category: { $regex: req.query.search, $options: 'i' } },
      { location: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const result = await menus.find(query).toArray();
  res.send(result);
});

// FEATURED MENU API
app.get('/menus/featured', async (req, res) => {
  const query = {
    $or: [{ status: 'Active' }, { status: 'Approved' }],
  };
  const result = await menus.find(query).limit(6).toArray();
  res.send(result);
});

// MENU DETAILS API
app.get('/menus/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid menu id.' });
  }
  const result = await menus.findOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
});

// MENU UPDATE API
app.patch('/menus/:id', verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid menu id.' });
  }

  const updateData = req.body;
  const allowedStatuses = ['Pending', 'Approved', 'Rejected', 'Active', 'Inactive'];
  if (updateData.status && !allowedStatuses.includes(updateData.status)) {
    return res.status(400).send({ error: 'Invalid status.' });
  }

  const result = await menus.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: updateData }
  );
  res.send(result);
  console.log('menu update', result);
});

// MENU DELETE API
app.delete('/menus/:id', verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid menu id.' });
  }
  const result = await menus.deleteOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
  console.log('menu delete', result);
});

// orders related apis
app.post('/orders', verifyToken, async (req, res) => {
  const order = req.body;
  order.status = 'Pending';
  order.createdAt = new Date().toISOString();

  let menu = null;
  if (order.itemId && ObjectId.isValid(order.itemId)) {
    menu = await menus.findOne({ _id: new ObjectId(order.itemId) });
  }

  if (menu) {
    order.vendorId = order.vendorId || menu.vendorId || null;
    order.vendorEmail = order.vendorEmail || menu.vendorEmail || null;
  }

  const isOwnItem =
    menu &&
    ((menu.vendorId && order.customerId && menu.vendorId === order.customerId) ||
      (menu.vendorEmail && order.customerEmail && menu.vendorEmail === order.customerEmail));

  if (isOwnItem) {
    return res
      .status(400)
      .send({ error: 'You cannot order your own menu item.' });
  }

  if (order.deliveryDate && order.customerId) {
    const duplicate = await orders.findOne({
      itemId: order.itemId,
      customerId: order.customerId,
      deliveryDate: order.deliveryDate,
      status: { $in: ['Pending', 'Accepted'] },
    });

    if (duplicate) {
      return res.status(400).send({
        error:
          'You already have an active order for this item on the same delivery date.',
      });
    }
  }

  const result = await orders.insertOne(order);
  res.send(result);
});

// order status update (Pending -> Accepted / Rejected / Cancelled)
app.patch('/orders/:id', verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid order id.' });
  }

  const { status, vendorId, vendorEmail } = req.body;
  const allowedStatuses = ['Accepted', 'Rejected', 'Cancelled'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).send({ error: 'Invalid status.' });
  }

  const existingOrder = await orders.findOne({ _id: new ObjectId(req.params.id) });
  if (!existingOrder) {
    return res.status(404).send({ error: 'Order not found.' });
  }

  if (existingOrder.status !== 'Pending') {
    return res.status(400).send({
      error: `Order is already ${existingOrder.status} and cannot be changed again.`,
    });
  }

  if (status === 'Accepted' || status === 'Rejected') {
    const isOwnerVendor =
      (vendorId && existingOrder.vendorId === vendorId) ||
      (vendorEmail && existingOrder.vendorEmail === vendorEmail);

    if (!isOwnerVendor) {
      return res
        .status(403)
        .send({ error: 'You cannot modify orders belonging to another vendor.' });
    }
  }

  const result = await orders.updateOne(
    { _id: new ObjectId(req.params.id), status: 'Pending' },
    { $set: { status, updatedAt: new Date().toISOString() } }
  );

  res.send(result);
  console.log('order status update', result);
});

// get orders
app.get('/orders', verifyToken, async (req, res) => {
  const query = {};
  if (req.query.customerEmail) query.customerEmail = req.query.customerEmail;
  if (req.query.customerId) query.customerId = req.query.customerId;
  if (req.query.vendorEmail) query.vendorEmail = req.query.vendorEmail;
  if (req.query.vendorId) query.vendorId = req.query.vendorId;

  const result = await orders.find(query).toArray();
  res.send(result);
});

// USER BLOCK / UNBLOCK API (Admin)
app.patch('/users/:id/block', verifyToken, verifyAdmin, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid user id.' });
  }

  const { isBlocked } = req.body;
  if (typeof isBlocked !== 'boolean') {
    return res.status(400).send({ error: 'isBlocked must be a boolean.' });
  }

  const targetUser = await dbUsers.findOne({ _id: new ObjectId(req.params.id) });
  if (!targetUser) {
    return res.status(404).send({ error: 'User not found.' });
  }

  if (targetUser.role === 'admin') {
    return res.status(403).send({ error: 'Admin account cannot be blocked.' });
  }

  const result = await dbUsers.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { isBlocked, updatedAt: new Date().toISOString() } }
  );

  res.send(result);
});

// CREATE STRIPE CHECKOUT SESSION (Vendor Premium Plan - $20)
app.post('/payments/create-checkout-session', verifyToken, async (req, res) => {
  try {
    const { userId, userEmail, userName, successUrl, cancelUrl } = req.body;

    if (!userId && !userEmail) {
      return res.status(400).send({ success: false, message: 'User ID or email is required.' });
    }

    const userFilter = ObjectId.isValid(userId)
      ? { _id: new ObjectId(userId) }
      : { email: userEmail };

    const targetUser = await dbUsers.findOne(userFilter);
    if (!targetUser) {
      return res.status(404).send({ success: false, message: 'User not found.' });
    }

    if (targetUser.isBlocked) {
      return res.status(403).send({ success: false, message: 'Blocked account cannot purchase subscription.' });
    }

    const clientOrigin = req.headers.origin || 'http://localhost:3000';
    const resolvedSuccessUrl =
      successUrl || `${clientOrigin}/dashboard/vendor/subscription?session_id={CHECKOUT_SESSION_ID}`;
    const resolvedCancelUrl =
      cancelUrl || `${clientOrigin}/dashboard/vendor/subscription?canceled=true`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: targetUser.email || userEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'PizzaHut Vendor Premium Plan',
              description: 'Unlimited active items, Premium vendor badge, Featured menu placement',
            },
            unit_amount: 2000, // $20.00 in cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: targetUser._id.toString(),
        userEmail: targetUser.email || userEmail || '',
        userName: targetUser.name || userName || '',
        plan: 'Premium',
      },
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
    });

    res.send({ success: true, url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Create checkout session error:', err);
    res.status(500).send({ success: false, message: err.message || 'Failed to create checkout session.' });
  }
});

// VERIFY STRIPE CHECKOUT & SAVE TRANSACTION
app.post('/payments/checkout-verify', verifyToken, async (req, res) => {
  try {
    const { sessionId, currentUserId } = req.body;

    if (!sessionId) {
      return res.send({ success: false, message: 'Session ID is required' });
    }

    const {
      status,
      payment_status,
      customer_email,
      metadata,
      payment_intent,
      amount_total,
    } = await stripe.checkout.sessions.retrieve(sessionId);

    if (currentUserId && metadata?.userId && currentUserId !== metadata.userId) {
      return res.status(403).send({
        success: false,
        message: 'Session does not belong to the currently logged in user',
      });
    }

    if (status === 'complete' && payment_status === 'paid') {
      const existingPayment = await transactions.findOne({ sessionId });
      if (existingPayment) {
        return res.send({ success: false, message: 'Payment already verified', payment: existingPayment });
      }

      const now = new Date().toISOString();
      const payment = {
        sessionId,
        status,
        payment_status,
        customer_email: customer_email || metadata?.userEmail || '',
        userId: metadata?.userId || '',
        userName: metadata?.userName || '',
        plan: metadata?.plan || 'Premium',
        amount: typeof amount_total === 'number' ? amount_total / 100 : 20,
        payment_date: now,
        createdAt: now,
        payment_intent,
      };

      const result = await transactions.insertOne(payment);

      let updateResult = null;
      if (metadata?.userId && ObjectId.isValid(metadata.userId)) {
        updateResult = await dbUsers.updateOne(
          { _id: new ObjectId(metadata.userId) },
          {
            $set: {
              premium: true,
              subscriptionPlan: 'Premium',
              updatedAt: now,
            },
          }
        );
      }

      return res.send({ success: true, result, updateResult, payment });
    }

    res.send({ success: false, message: 'Payment verification failed' });
  } catch (err) {
    console.error('Checkout verify error:', err);
    res.status(500).send({ success: false, message: err.message || 'Payment verification error' });
  }
});

// SWITCH TO FREE PLAN (Vendor)
app.post('/subscriptions/free', verifyToken, async (req, res) => {
  try {
    const { userId, userEmail } = req.body;

    if (!userId && !userEmail) {
      return res.status(400).send({ success: false, message: 'User ID or email is required.' });
    }

    const userFilter = ObjectId.isValid(userId)
      ? { _id: new ObjectId(userId) }
      : { email: userEmail };

    const targetUser = await dbUsers.findOne(userFilter);
    if (!targetUser) {
      return res.status(404).send({ success: false, message: 'User not found.' });
    }

    const updateResult = await dbUsers.updateOne(
      { _id: targetUser._id },
      {
        $set: {
          premium: false,
          subscriptionPlan: 'Free',
          updatedAt: new Date().toISOString(),
        },
      }
    );

    res.send({ success: true, updateResult });
  } catch (err) {
    console.error('Free plan update error:', err);
    res.status(500).send({ success: false, message: 'Failed to switch to Free plan.' });
  }
});

// GET ALL TRANSACTIONS (Admin & Overview)
app.get('/transactions', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const query = {};
    if (req.query.userId) query.userId = req.query.userId;
    if (req.query.customer_email) query.customer_email = req.query.customer_email;

    const result = await transactions.find(query).sort({ payment_date: -1 }).toArray();
    res.send(result);
  } catch (err) {
    console.error('Failed to fetch transactions:', err);
    res.status(500).send({ error: 'Failed to fetch transactions.' });
  }
});

// Start
app.get('/', (req, res) => {
  res.send('Pizza Hut Api!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});



export default app;