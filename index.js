import express from 'express';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';

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

const app = express();
const port = 5000;
app.use(cors());
app.use(express.json());

// db user load
app.get('/users', async (req, res) => {
  const result = await dbUsers.find().toArray();
  res.send(result);
});

// MENU POST API
app.post('/menus', async (req, res) => {
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
app.patch('/menus/:id', async (req, res) => {
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
app.delete('/menus/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ error: 'Invalid menu id.' });
  }
  const result = await menus.deleteOne({ _id: new ObjectId(req.params.id) });
  res.send(result);
  console.log('menu delete', result);
});

// orders related apis
app.post('/orders', async (req, res) => {
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
app.patch('/orders/:id', async (req, res) => {
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
app.get('/orders', async (req, res) => {
  const query = {};
  if (req.query.customerEmail) query.customerEmail = req.query.customerEmail;
  if (req.query.customerId) query.customerId = req.query.customerId;
  if (req.query.vendorEmail) query.vendorEmail = req.query.vendorEmail;
  if (req.query.vendorId) query.vendorId = req.query.vendorId;

  const result = await orders.find(query).toArray();
  res.send(result);
});

// Start
app.get('/', (req, res) => {
  res.send('Pizza Hut Api!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});