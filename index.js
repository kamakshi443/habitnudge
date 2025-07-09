const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const db = require('./firebaseService');
const verifyToken = require('./authMiddleware');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

console.log("db--", db)
app.get('/', (req, res) => res.send('Habit Nudge API running ✅'));

// ------------------------ AUTH ------------------------
// POST /auth/register
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, userId, password, referredBy } = req.body;

    if (!name || !email || !userId || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const userRef = db.collection('users').doc(userId);
    const existing = await userRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await userRef.set({
      name,
      email,
      password: hashedPassword,
      referredBy: referredBy || null,
      xp: 0,
      badges: [],
      createdAt: new Date()
    });

    // Optional referral reward
    if (referredBy) {
      const referrerRef = db.collection('users').doc(referredBy);
      const referrer = await referrerRef.get();
      if (referrer.exists) {
        await referrerRef.update({
          xp: (referrer.data().xp || 0) + 20,
        });
      }
    }

    res.status(201).json({ success: true, message: "User registered" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/auth/login', async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({ error: "UserId and password required" });
    }

    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    const user = doc.data();

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: userId, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        xp: user.xp,
        badges: user.badges
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------ USER ------------------------
app.get('/users/:id', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.id).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user: userDoc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:id', verifyToken, async (req, res) => {
  try {
    const userRef = db.collection('users').doc(req.params.id);
    const doc = await userRef.get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });
    await userRef.update(req.body);
    res.status(200).json({ success: true, message: "User updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------ HABITS ------------------------
app.post('/createHabit', verifyToken, async (req, res) => {
  try {
    const { userId, title, frequency, reminderTime } = req.body;
    if (!userId || !title || !frequency || !reminderTime) return res.status(400).json({ error: 'Missing fields' });

    const docRef = db.collection('users').doc(userId).collection('habits').doc();
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/habits/:userId', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.params.userId).collection('habits').get();
    const habits = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ habits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/habit/:userId/:habitId', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.userId).collection('habits').doc(req.params.habitId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Habit not found' });
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/habit/:userId/:habitId/update', async (req, res) => {
  const { userId, habitId } = req.params;
  let updateData = req.body;

  // Filter out undefined values
  updateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, v]) => v !== undefined)
  );

  try {
    const habitRef = db.collection('users').doc(userId).collection('habits').doc(habitId);
    await habitRef.update(updateData);
    res.status(200).json({ success: true, message: "Habit updated successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getBonusXP(streak) {
  const bonuses = {
    5: 20,
    10: 30,
    20: 50,
    30: 75
  };
  return bonuses[streak] || 0;
}

app.put('/habit/:userId/:habitId/complete', verifyToken, async (req, res) => {
  try {
    const { userId, habitId } = req.params;
    const habitRef = db.collection('users').doc(userId).collection('habits').doc(habitId);
    const doc = await habitRef.get();

    if (!doc.exists) return res.status(404).json({ error: 'Habit not found' });

    const habit = doc.data();
    const today = new Date().toISOString().split('T')[0];
    const alreadyCompletedToday = (habit.completionLog || []).includes(today);

    if (alreadyCompletedToday) return res.status(400).json({ message: 'Habit already completed today' });

    const updatedLog = [...(habit.completionLog || []), today];
    const newStreak = habit.streak + 1;
    const bonusXP = getBonusXP(newStreak);
    const baseXP = 10;
    const totalXP = habit.xp + baseXP + bonusXP;

    await habitRef.update({
      completionLog: updatedLog,
      xp: totalXP,
      streak: newStreak
    });

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const currentUserXP = userDoc.exists ? (userDoc.data().xp || 0) : 0;
    await userRef.update({ xp: currentUserXP + baseXP + bonusXP });

    res.status(200).json({
      success: true,
      message: `Habit completed. +${baseXP} XP${bonusXP > 0 ? ` +${bonusXP} bonus XP` : ''}`,
      newStreak,
      xpGained: baseXP + bonusXP
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/habit/:userId/:habitId', verifyToken, async (req, res) => {
  try {
    await db.collection('users').doc(req.params.userId).collection('habits').doc(req.params.habitId).delete();
    res.status(200).json({ success: true, message: "Habit deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------ GAMIFICATION ------------------------
// To add XP to a user's profile.
// This could be triggered when a user completes a habit, earns a bonus, or receives a reward.
//  Common Use Cases:
// When a user completes a daily habit
// When a user shares the app and gets referral XP
// When a user hits a streak milestone
// When a user levels up
app.post('/users/:userId/xp', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount = 10 } = req.body;
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });

    const xp = (doc.data().xp || 0) + amount;
    await userRef.update({ xp });

    res.status(200).json({ success: true, xp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:userId/badges', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.userId).get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ badges: doc.data().badges || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------ DASHBOARD ------------------------
app.get('/dashboard/:userId', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.params.userId).collection('habits').get();
    const today = new Date().toISOString().split('T')[0];
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const mondayISO = monday.toISOString().split('T')[0];

    let stats = {
      totalHabits: 0,
      totalXP: 0,
      longestStreak: 0,
      completedToday: 0,
      completedThisWeek: 0,
      missedToday: 0
    };

    snapshot.forEach(doc => {
      const h = doc.data();
      stats.totalHabits++;
      stats.totalXP += h.xp || 0;
      stats.longestStreak = Math.max(stats.longestStreak, h.streak || 0);
      const log = h.completionLog || [];
      if (log.includes(today)) stats.completedToday++;
      else stats.missedToday++;
      stats.completedThisWeek += log.filter(d => d >= mondayISO && d <= today).length;
    });

    res.status(200).json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------ NUDGES ------------------------
app.post('/users/:userId/habits/:habitId/nudges', verifyToken, async (req, res) => {
  try {
    const { userId, habitId } = req.params;
    const { message, type = 'manual' } = req.body;

    if (!message) return res.status(400).json({ error: "Nudge message is required" });

    const nudgeRef = db
      .collection('users')
      .doc(userId)
      .collection('habits')
      .doc(habitId)
      .collection('nudges')
      .doc();

    await nudgeRef.set({ message, type, createdAt: new Date() });

    res.status(201).json({ success: true, id: nudgeRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:userId/habits/:habitId/nudges', verifyToken, async (req, res) => {
  try {
    const { userId, habitId } = req.params;

    const nudgesSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('habits')
      .doc(habitId)
      .collection('nudges')
      .orderBy('createdAt', 'desc')
      .get();

    const nudges = [];
    nudgesSnapshot.forEach(doc => nudges.push({ id: doc.id, ...doc.data() }));

    res.status(200).json({ nudges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const dailyQuotes = [
  "Keep going, you're doing great! 🌟",
  "One small habit a day leads to big changes! 💪",
  "Your consistency defines your success. 🚀",
  "Believe in the power of daily progress. 🌱",
  "Tiny steps every day. That’s the secret. 🧠"
];

app.get('/users/:userId/daily-nudge', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });

    const nudgesRef = db.collection('users').doc(userId).collection('dailyNudges').doc(today);
    const nudgeDoc = await nudgesRef.get();

    if (nudgeDoc.exists) return res.status(200).json({ nudge: nudgeDoc.data().message });

    const quote = dailyQuotes[Math.floor(Math.random() * dailyQuotes.length)];
    await nudgesRef.set({ message: quote, createdAt: new Date() });

    res.status(200).json({ nudge: quote });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark a user as pro: true in Firestore if they subscribe.

// 🔧 Add Route to Upgrade

// PUT /users/:id/upgrade
app.put('/users/:id/upgrade', async (req, res) => {
  try {
    const userId = req.params.id;
    const userRef = db.collection('users').doc(userId);

    const doc = await userRef.get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    await userRef.update({ pro: true });

    res.status(200).json({ success: true, message: "User upgraded to Pro" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// You can now conditionally unlock:

// Unlimited habits

// Custom themes

// AI Nudges

// Detailed analytics

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));