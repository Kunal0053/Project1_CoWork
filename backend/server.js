const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const fs = require("fs");
require("dotenv").config();

const app = express();

// ================== MIDDLEWARE ==================
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// ================== CONFIG ==================
const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";
const SECRET = "mysecretkey";

// ================== MONGODB ==================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => {
  console.log("❌ MongoDB Error:", err.message);
  process.exit(1);
});

// ================== FILE UPLOAD ==================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

// ================== SCHEMAS ==================
const WorkerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  skill: { type: String, required: true },
  location: { type: String, required: true },
  rating: { type: Number, default: 0 },

  document: String,
  photo: String,

  status: { type: String, default: "pending" },

  // 🔥 AUTH
  email: { type: String, unique: true },
  password: String,

  // 🔥 DASHBOARD DATA
  earnings: { type: Number, default: 0 },
  gigs: { type: Number, default: 0 }

}, { timestamps: true });

const BookingSchema = new mongoose.Schema({
  workerName: String,
  skill: String,
  location: String,
  time: { type: Date, default: Date.now }
});

const Worker = mongoose.model("Worker", WorkerSchema);
const Booking = mongoose.model("Booking", BookingSchema);

// ================== AUTH MIDDLEWARE ==================
function verifyAdmin(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(403).json({ message: "No token" });

  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

// ================== ADMIN LOGIN ==================
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ role: "admin" }, SECRET, { expiresIn: "1h" });
    return res.json({ token });
  }

  res.status(401).json({ message: "Invalid credentials" });
});

// ================== WORKER REGISTER ==================
app.post(
  "/worker/register",
  upload.fields([
    { name: "document", maxCount: 1 },
    { name: "photo", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const existing = await Worker.findOne({ email: req.body.email });

      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const worker = new Worker({
        name: req.body.name,
        skill: req.body.skill,
        location: req.body.location,
        email: req.body.email,
        password: req.body.password,
        document: req.files?.document?.[0]?.filename || null,
        photo: req.files?.photo?.[0]?.filename || null,
        status: "pending"
      });

      await worker.save();

      res.json({ message: "Registered! Wait for admin approval" });

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ================== WORKER LOGIN ==================
app.post("/worker/login", async (req, res) => {
  const { email, password } = req.body;

  const worker = await Worker.findOne({ email, password });

  if (!worker) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ id: worker._id }, SECRET);

  res.json({ token, worker });
});

// ================== WORKER DASHBOARD ==================
app.get("/worker/dashboard/:id", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    res.json(worker);
  } catch {
    res.status(500).json({ message: "Error fetching dashboard" });
  }
});

// ================== USER ==================
app.get("/workers/:skill", async (req, res) => {
  try {
    const workers = await Worker.find({
      skill: req.params.skill,
      status: "approved"
    });

    res.json(workers);

  } catch {
    res.status(500).json({ message: "Error fetching workers" });
  }
});

// ================== ADMIN ==================
app.get("/admin/all-workers", verifyAdmin, async (req, res) => {
  const workers = await Worker.find();
  res.json(workers);
});

app.get("/admin/pending", verifyAdmin, async (req, res) => {
  const workers = await Worker.find({ status: "pending" });
  res.json(workers);
});

app.put("/admin/approve/:id", verifyAdmin, async (req, res) => {
  await Worker.findByIdAndUpdate(req.params.id, { status: "approved" });
  res.json({ message: "Approved" });
});

app.put("/admin/reject/:id", verifyAdmin, async (req, res) => {
  await Worker.findByIdAndUpdate(req.params.id, { status: "rejected" });
  res.json({ message: "Rejected" });
});

app.delete("/admin/delete/:id", verifyAdmin, async (req, res) => {
  const worker = await Worker.findById(req.params.id);

  if (!worker) return res.status(404).json({ message: "Not found" });

  if (worker.photo && fs.existsSync("uploads/" + worker.photo)) {
    fs.unlinkSync("uploads/" + worker.photo);
  }

  if (worker.document && fs.existsSync("uploads/" + worker.document)) {
    fs.unlinkSync("uploads/" + worker.document);
  }

  await Worker.findByIdAndDelete(req.params.id);

  res.json({ message: "Deleted successfully" });
});

// ================== BOOKINGS ==================
app.post("/book", async (req, res) => {
  try {
    const booking = new Booking(req.body);
    await booking.save();

    // 🔥 Update worker stats
    await Worker.findOneAndUpdate(
      { name: req.body.workerName },
      {
        $inc: {
          earnings: 200,
          gigs: 1
        }
      }
    );

    res.json({ message: "Booking saved" });

  } catch {
    res.status(500).json({ message: "Error saving booking" });
  }
});

app.get("/admin/bookings", verifyAdmin, async (req, res) => {
  const bookings = await Booking.find();
  res.json(bookings);
});

// ================== SERVER ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});