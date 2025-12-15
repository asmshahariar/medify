import mongoose from 'mongoose';

const testSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  code: {
    type: String,
    unique: true
  },
  category: {
    type: String,
    enum: ['pathology', 'radiology', 'cardiology', 'other']
  },
  description: {
    type: String
  },
  price: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // in hours
    default: 24
  },
  preparation: {
    type: String
  },
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPackage: {
    type: Boolean,
    default: false
  },
  packageTests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Test'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const Test = mongoose.model('Test', testSchema);

export default Test;

