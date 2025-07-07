const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const  db  = require('./firebaseService');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

console.log("DB", db)
app.get('/', (req, res) => res.send('Habit Nudge API running ✅'));

// 📌 Create Habit
app.post('/createHabit', async (req, res) => {
  try {
    const { userId, title, frequency, reminderTime } = req.body;

    if (!userId || !title || !frequency || !reminderTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const docRef = db.collection('users')
      .doc(userId)
      .collection('habits')
      .doc(); // auto-generated habit ID

    await docRef.set({
      title,
      frequency,
      reminderTime,
      xp: 0,
      streak: 0,
      completionLog: [],
      createdAt: new Date()
    });

    res.status(200).json({ success: true, id: docRef.id });

  } catch (err) {
    console.error('🔥 Error in /createHabit:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
