import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected!');

await mongoose.connection.collection('users').updateOne(
  { _id: new mongoose.Types.ObjectId('69cacc50c9b4b624e22031fb') },
  { $set: { 
    password: '$2b$10$HdK72CXuo8fOH5K8NFIwFuyuilWExS2dVyH6l.FSr12XNB0aloz3G',
    mustChangePassword: false
  }}
);

console.log('Password updated!');
process.exit(0);
