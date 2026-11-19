
import express from 'express';
import 'dotenv/config'
import { MongoClient } from 'mongodb';
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



const app = express()
const port = 5000
app.use(cors());
app.use(express.json())











  // Start 
app.get('/', (req, res) => {
  res.send('Pizza Hut Api!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})