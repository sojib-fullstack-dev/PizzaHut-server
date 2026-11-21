
import express from 'express';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors'


const client = new MongoClient(`mongodb+srv://${process.env.MONGO_DB_NAME}:${process.env.MONGO_DB_PASS}@cluster0.buouugs.mongodb.net/`);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient=await connectToMongoDB()
const database = connectedClient.db("PizzaHub-DataBase");
const dbUsers =database.collection('user')
const menus=database.collection('menu')
const orders = database.collection('orders');


const app = express()
const port = 5000
app.use(cors());
app.use(express.json())



// db user load
app.get('/users', async (req, res) => {
  const result = await dbUsers.find().toArray()
  res.send(result)
  // console.log(result)
})

// MENU POST API 

app.post('/menus', async (req,res)=>{
      const menuItems=req.body;
        const result=await menus.insertOne(menuItems);
        res.send(result)
        console.log('menu post',result)
})

  //  GET MENU API 
app.get('/menus', async (req, res) => {
  const query = {};

  console.log('queryString', req.query);

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.location) {
    query.location = { $regex: req.query.location, $options: 'i' };
  }

  if (req.query.search) {
    query.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { description: { $regex: req.query.search, $options: 'i' } },
      { category: { $regex: req.query.search, $options: 'i' } },
      { location: { $regex: req.query.search, $options: 'i' } }
    ];
  }

  const result = await menus.find(query).toArray();
  res.send(result);
});



// MENU DETAILS API 
app.get('/menus/:id', async (req, res) => {
  const result = await menus.findOne({ _id: new ObjectId(req.params.id) })
  res.send(result)
})

// MENU UPDATE API 
app.patch('/menus/:id', async (req, res) => {
  const updateData = req.body
  const result = await menus.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: updateData }
  )
  res.send(result)
  console.log('menu update', result)
})

// MENU DELETE API
app.delete('/menus/:id', async (req, res) => {
  const result = await menus.deleteOne({ _id: new ObjectId(req.params.id) })
  res.send(result)
  console.log('menu delete', result)
})

// orders related apis
app.post('/orders', async (req, res) => {
  const order = req.body;
  const result = await orders.insertOne(order);
  res.send(result);
});

//  get orders

app.get('/orders', async (req, res) => {
  
  const cursor = orders.find({});
  const result = await cursor.toArray();
  res.send(result);
});


  // Start 
app.get('/', (req, res) => {
  res.send('Pizza Hut Api!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})