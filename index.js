
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

app.get('/menus', async (req, res) => {
  const result = await menus.find().toArray()
  res.send(result)
  // console.log(result)
})

// MENU DETAILS API (single item - view er jonno)
app.get('/menus/:id', async (req, res) => {
  const result = await menus.findOne({ _id: new ObjectId(req.params.id) })
  res.send(result)
})

// MENU UPDATE API (edit er jonno)
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





  // Start 
app.get('/', (req, res) => {
  res.send('Pizza Hut Api!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})