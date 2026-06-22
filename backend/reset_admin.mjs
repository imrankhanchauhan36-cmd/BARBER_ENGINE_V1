import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
console.log('Connected!')

const hash = await bcrypt.hash('Admin@12345', 10)
await mongoose.connection.collection('users').updateOne(
  { email: 'admin@barberapp.com' },
  { $set: { password: hash, loginAttempts: 0, lockUntil: null } }
)
console.log('Done! Hash:', hash)
process.exit(0)
